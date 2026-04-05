// api/cron.ts — Vercel cron endpoint
// Reads registered users from Vercel KV and runs the Aveum optimizer
// for each user in sequence.
// Triggered daily at 01:00 UTC by the schedule in vercel.json.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";
import { optimize } from "../src/optimizer/engine";
import { getCanonicalSimulationSnapshot } from "../src/simulator";
import { buildDailySavingsReport } from "../src/features/report/dailySavingsReport";
import { sendMorningReport } from "../src/features/notifications/morningEmailReport";
import { trackDailyResult } from "../src/features/analytics/userTracker";
import type { OptimizationMode, TariffSchedule } from "../src/domain";
import type { StoredUser } from "./users";
import type { DailyResult } from "./results";
import nodemailer from "nodemailer";
import { getDailyConsumptionProfile } from "../src/integrations/octopus/consumptionService";
import {
  detectOctopusPowerUpEvents,
  formatPowerUpAlertMessage,
  type OctopusPowerUpEvent,
} from "../src/features/powerup/octopusPowerUpDetector";
import {
  calculateSavingSessionActions,
  formatSavingSessionEmail,
  getRecentSavingSessions,
  getUpcomingSavingSessions,
  joinSavingSession,
} from "../src/features/savingSessions/savingSessionsService";
import {
  fetchSolcastForecast,
  forecastPointsToSlotArray,
} from "../src/integrations/solcast/solcastAdapter";
import { getOutdoorTemperatureForecast } from "../src/integrations/weather/weatherService";
import {
  getLearnedDepartureDistribution,
  recordDeparture,
} from "../src/features/learning/departureLearner";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const KV_KEY = "aveum:users";

export async function readStoredUsers(): Promise<StoredUser[]> {
  try {
    const raw = await redis.lrange<string>(KV_KEY, 0, -1);
    return raw.map((entry) => JSON.parse(entry) as StoredUser);
  } catch {
    return [];
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

// StoredUser is imported from register.ts; UserConfig adds optional SMTP overrides
// that won't be present in the file but can be injected via env vars.
type UserConfig = StoredUser & {
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  fromEmail?: string;
};

interface PowerUpSweepUserResult {
  userId: string;
  accountNumber: string;
  detectedEvents: number;
  scheduledCommands: number;
  notificationSent: boolean;
  error?: string;
}

export interface PowerUpSweepResult {
  checkedUsers: number;
  triggeredUsers: number;
  results: PowerUpSweepUserResult[];
}

interface UserRunResult {
  octopusAccountNumber: string;
  status: "ok" | "error";
  optimizerStatus?: string;
  decisionCount?: number;
  savedTodayPence?: number;
  emailSent?: boolean;
  tracked?: boolean;
  error?: string;
}

// ── Octopus helpers (same as run-optimizer.ts) ────────────────────────────────

const AGILE_PRODUCT = "AGILE-FLEX-22-11-25";
const EXPORT_PRODUCT = "OUTGOING-LITE-FIX-12M-23-09-12";

function buildAgileUrl(region: string, now: Date): string {
  const from = new Date(now);
  from.setMinutes(from.getMinutes() < 30 ? 0 : 30, 0, 0);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  const tariffCode = `E-1R-${AGILE_PRODUCT}-${region}`;
  return (
    `https://api.octopus.energy/v1/products/${AGILE_PRODUCT}/electricity-tariffs/` +
    `${tariffCode}/standard-unit-rates/?period_from=${from.toISOString()}&period_to=${to.toISOString()}&page_size=96`
  );
}

function buildExportUrl(region: string, now: Date): string {
  const from = new Date(now);
  from.setMinutes(from.getMinutes() < 30 ? 0 : 30, 0, 0);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  const tariffCode = `G-1R-${EXPORT_PRODUCT}-${region}`;
  return (
    `https://api.octopus.energy/v1/products/${EXPORT_PRODUCT}/electricity-tariffs/` +
    `${tariffCode}/standard-unit-rates/?period_from=${from.toISOString()}&period_to=${to.toISOString()}&page_size=96`
  );
}

function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(apiKey + ":").toString("base64")}`;
}

interface OctopusRateResult {
  valid_from: string;
  valid_to: string;
  value_inc_vat: number;
}

interface OctopusRatesResponse {
  results?: OctopusRateResult[];
}

async function fetchRates(url: string, apiKey: string): Promise<OctopusRateResult[]> {
  const res = await fetch(url, { headers: { Authorization: authHeader(apiKey) } });
  if (!res.ok) throw new Error(`Octopus fetch failed (${res.status})`);
  const data = (await res.json()) as OctopusRatesResponse;
  return [...(data.results ?? [])].sort(
    (a, b) => new Date(a.valid_from).getTime() - new Date(b.valid_from).getTime(),
  );
}

function toTariffRates(results: OctopusRateResult[]) {
  return results.map((r) => ({
    startAt: r.valid_from,
    endAt: r.valid_to,
    unitRatePencePerKwh: Number(r.value_inc_vat),
    source: "live" as const,
  }));
}

function toOptimizationMode(raw: string | undefined): OptimizationMode {
  const valid: OptimizationMode[] = ["cost", "balanced", "carbon", "self_consumption"];
  const normalised = raw?.trim().toLowerCase() as OptimizationMode | undefined;
  return normalised && valid.includes(normalised) ? normalised : "balanced";
}

function isDaytimeSweepWindow(now: Date): boolean {
  const hour = now.getUTCHours();
  return hour >= 6 && hour <= 22;
}

async function sendPowerUpAlertEmail(config: UserConfig, event: OctopusPowerUpEvent): Promise<boolean> {
  const smtpHost = config.smtpHost || process.env.AVEUM_SMTP_HOST;
  const smtpUser = config.smtpUser || process.env.AVEUM_SMTP_USER;
  const smtpPass = config.smtpPass || process.env.AVEUM_SMTP_PASS;
  const notifyEmail = config.notifyEmail || process.env.AVEUM_NOTIFY_EMAIL;

  if (!smtpHost || !smtpUser || !smtpPass || !notifyEmail) {
    return false;
  }

  const smtpPort = config.smtpPort ?? parseInt(process.env.AVEUM_SMTP_PORT ?? "587", 10);
  const fromEmail = config.fromEmail || process.env.AVEUM_FROM_EMAIL || smtpUser;
  const message = formatPowerUpAlertMessage(event);

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number.isFinite(smtpPort) ? smtpPort : 587,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  await transporter.sendMail({
    from: `"Aveum" <${fromEmail}>`,
    to: notifyEmail,
    subject: "Aveum — Free electricity detected",
    text: message,
    html: `<p>${message}</p>`,
  });

  return true;
}

async function sendSavingSessionEmail(config: UserConfig, html: string): Promise<boolean> {
  const smtpHost = config.smtpHost || process.env.AVEUM_SMTP_HOST;
  const smtpUser = config.smtpUser || process.env.AVEUM_SMTP_USER;
  const smtpPass = config.smtpPass || process.env.AVEUM_SMTP_PASS;
  const notifyEmail = config.notifyEmail || process.env.AVEUM_NOTIFY_EMAIL;

  if (!smtpHost || !smtpUser || !smtpPass || !notifyEmail) {
    return false;
  }

  const smtpPort = config.smtpPort ?? parseInt(process.env.AVEUM_SMTP_PORT ?? "587", 10);
  const fromEmail = config.fromEmail || process.env.AVEUM_FROM_EMAIL || smtpUser;
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number.isFinite(smtpPort) ? smtpPort : 587,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  await transporter.sendMail({
    from: `"Aveum" <${fromEmail}>`,
    to: notifyEmail,
    subject: "Aveum — Saving Session joined",
    text: "Saving Session joined. Aveum has scheduled your battery and EV actions automatically.",
    html,
  });

  return true;
}

function buildPowerUpChargeCommands(
  config: UserConfig,
  event: OctopusPowerUpEvent,
): Array<Record<string, unknown>> {
  const snapshot = applyUserEvConfiguration(getCanonicalSimulationSnapshot(new Date(event.startAt)), config);
  const commands: Array<Record<string, unknown>> = [];

  for (const device of snapshot.systemState.devices) {
    if (device.connectionStatus !== "online" && device.connectionStatus !== "degraded") {
      continue;
    }

    if (device.kind === "battery") {
      commands.push({
        deviceId: device.deviceId,
        type: "set_mode",
        mode: "charge",
        startAt: event.startAt,
        endAt: event.endAt,
        reason: "Octopus Power-Up free window",
      });
    }

    if (device.kind === "ev_charger") {
      commands.push({
        deviceId: device.deviceId,
        type: "schedule_window",
        targetMode: "charge",
        startAt: event.startAt,
        endAt: event.endAt,
        reason: "Octopus Power-Up free window",
      });
    }
  }

  return commands;
}

export async function runPowerUpSweepForUsers(
  userConfigs: UserConfig[],
  now: Date,
): Promise<PowerUpSweepResult> {
  if (!isDaytimeSweepWindow(now)) {
    return {
      checkedUsers: 0,
      triggeredUsers: 0,
      results: [],
    };
  }

  const results: PowerUpSweepUserResult[] = [];

  for (const config of userConfigs) {
    if (!config.octopusApiKey || !config.octopusAccountNumber) {
      continue;
    }

    try {
      const detection = await detectOctopusPowerUpEvents({
        apiKey: config.octopusApiKey,
        accountNumber: config.octopusAccountNumber,
        now,
        lookaheadHours: 2,
      });

      const activeEvent = detection.activeOrUpcomingEvents[0];
      if (!activeEvent) {
        results.push({
          userId: config.userId,
          accountNumber: config.octopusAccountNumber,
          detectedEvents: 0,
          scheduledCommands: 0,
          notificationSent: false,
        });
        continue;
      }

      const commands = buildPowerUpChargeCommands(config, activeEvent);
      await redis.set(
        `aveum:powerup:commands:${config.userId}`,
        JSON.stringify({
          generatedAt: now.toISOString(),
          event: activeEvent,
          commands,
        }),
      );

      let notificationSent = false;
      try {
        notificationSent = await sendPowerUpAlertEmail(config, activeEvent);
      } catch {
        notificationSent = false;
      }

      results.push({
        userId: config.userId,
        accountNumber: config.octopusAccountNumber,
        detectedEvents: detection.activeOrUpcomingEvents.length,
        scheduledCommands: commands.length,
        notificationSent,
      });
    } catch (error: unknown) {
      results.push({
        userId: config.userId,
        accountNumber: config.octopusAccountNumber,
        detectedEvents: 0,
        scheduledCommands: 0,
        notificationSent: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    checkedUsers: results.length,
    triggeredUsers: results.filter((result) => result.detectedEvents > 0).length,
    results,
  };
}

function applyUserEvConfiguration(snapshot: ReturnType<typeof getCanonicalSimulationSnapshot>, config: UserConfig) {
  const evDevice = snapshot.systemState.devices.find((device) => device.kind === "ev_charger");

  if (!evDevice) {
    return snapshot;
  }

  const deviceLevelV2h = config.deviceConfigs?.find((deviceConfig) => deviceConfig.kind === "ev_charger");
  const v2hCapable = deviceLevelV2h?.v2hCapable ?? config.v2hCapable ?? false;
  const v2hMinSocPercent = deviceLevelV2h?.v2hMinSocPercent ?? config.v2hMinSocPercent ?? 30;

  evDevice.capabilities = v2hCapable
    ? Array.from(new Set([...evDevice.capabilities, "vehicle_to_home"]))
    : evDevice.capabilities.filter((capability) => capability !== "vehicle_to_home");

  evDevice.metadata = {
    ...(evDevice.metadata ?? {}),
    v2hCapable,
    v2hMinSocPercent,
  };

  return snapshot;
}

// ── Per-user optimizer run ─────────────────────────────────────────────────────

async function runForUser(config: UserConfig, now: Date): Promise<UserRunResult> {
  const accountRef = config.octopusAccountNumber;
  try {
    const region = config.region?.trim() || "C";
    const optimizationMode = toOptimizationMode(config.optimizationMode);

    // Fetch import rates (required); export rates optional
    const importResults = await fetchRates(buildAgileUrl(region, now), config.octopusApiKey);
    let exportResults: OctopusRateResult[] = [];
    try {
      exportResults = await fetchRates(buildExportUrl(region, now), config.octopusApiKey);
    } catch {
      // continue without export rates
    }

    const tariffSchedule: TariffSchedule = {
      tariffId: `octopus-agile-${region.toLowerCase()}`,
      provider: "Octopus",
      name: `Agile ${AGILE_PRODUCT}`,
      regionCode: region,
      currency: "GBP",
      updatedAt: now.toISOString(),
      importRates: toTariffRates(importResults),
      ...(exportResults.length ? { exportRates: toTariffRates(exportResults) } : {}),
    };

    const snapshot = applyUserEvConfiguration(getCanonicalSimulationSnapshot(now), config);
    const typicalLoadKwhPerSlot = await getDailyConsumptionProfile(
      config.octopusApiKey,
      config.octopusAccountNumber,
    );
    const hasHeatPump = snapshot.systemState.devices.some((d) => d.kind === "heat_pump");

    // Feature 1: Solcast solar forecast
    let solarForecastKwhPerSlot: number[] | undefined;
    const solcastApiKey = process.env.SOLCAST_API_KEY?.trim();
    const solcastResourceId = process.env.SOLCAST_RESOURCE_ID?.trim();
    if (solcastApiKey && solcastResourceId) {
      try {
        const points = await fetchSolcastForecast({ apiKey: solcastApiKey, resourceId: solcastResourceId });
        solarForecastKwhPerSlot = forecastPointsToSlotArray(points);
      } catch {
        // Best-effort; continue without forecast.
      }
    }

    // Feature 2: Weather outdoor temperature for COP adjustment
    let outdoorTemperatureForecastC: number[] | undefined;
    const weatherLat = process.env.WEATHER_LAT ? parseFloat(process.env.WEATHER_LAT) : undefined;
    const weatherLon = process.env.WEATHER_LON ? parseFloat(process.env.WEATHER_LON) : undefined;
    if (hasHeatPump && weatherLat != null && weatherLon != null && Number.isFinite(weatherLat) && Number.isFinite(weatherLon)) {
      const forecast = await getOutdoorTemperatureForecast(weatherLat, weatherLon);
      outdoorTemperatureForecastC = forecast ?? undefined;
    }

    // Feature 6: EV departure time learning
    let learnedDepartureMinutesMean: number | undefined;
    let learnedDepartureMinutesStdDev: number | undefined;
    const hasEv = snapshot.systemState.devices.some((d) => d.kind === "ev_charger");
    if (hasEv) {
      const dist = await getLearnedDepartureDistribution(config.userId, redis).catch(() => null);
      if (dist) {
        learnedDepartureMinutesMean = dist.mean;
        learnedDepartureMinutesStdDev = dist.stdDev;
      }
    }

    const optimizerOutput = optimize({
      systemState: snapshot.systemState,
      forecasts: snapshot.forecasts,
      tariffSchedule,
      constraints: {
        mode: optimizationMode,
        allowGridBatteryCharging: true,
        allowBatteryExport: true,
        allowAutomaticEvCharging: true,
        solarDivertEnabled: true,
        ...(config.departureTime ? { evReadyBy: config.departureTime } : {}),
        ...(config.targetSocPercent != null ? { evTargetSocPercent: config.targetSocPercent } : {}),
      },
      typicalLoadKwhPerSlot,
      ...(hasHeatPump ? { heatPumpCop: 3.5, thermalCoastHours: 3, hotWaterPreHeatBudgetKwh: 2.0 } : {}),
      ...(solarForecastKwhPerSlot ? { solarForecastKwhPerSlot } : {}),
      ...(outdoorTemperatureForecastC ? { outdoorTemperatureForecastC } : {}),
      ...(learnedDepartureMinutesMean != null && learnedDepartureMinutesStdDev != null
        ? { learnedDepartureMinutesMean, learnedDepartureMinutesStdDev }
        : {}),
    });

    const dailySavingsReport = buildDailySavingsReport({
      optimizerOutput,
      tariffSchedule,
      setAndForgetNetCostPence: 0,
    });

    const snapshotForSavingSessions = applyUserEvConfiguration(getCanonicalSimulationSnapshot(now), config);
    let savingSessionTrackerNote = "Saving Session: none.";

    try {
      const upcomingSavingSessions = await getUpcomingSavingSessions(
        config.octopusApiKey,
        config.octopusAccountNumber,
      );

      const next24hMs = now.getTime() + 24 * 60 * 60 * 1000;
      const nearestSession = upcomingSavingSessions.find((session) => {
        const startMs = new Date(session.startAt).getTime();
        return Number.isFinite(startMs) && startMs <= next24hMs;
      });

      if (nearestSession) {
        const joinOutcome = await joinSavingSession(
          config.octopusApiKey,
          config.octopusAccountNumber,
          nearestSession.id,
        );

        const actionPlan = calculateSavingSessionActions(
          nearestSession,
          snapshotForSavingSessions.systemState.devices,
        );

        await redis.set(
          `aveum:saving-sessions:${config.userId}:${nearestSession.id}`,
          JSON.stringify({
            joinedAt: now.toISOString(),
            session: nearestSession,
            joinOutcome,
            actions: actionPlan.actions,
            explanation: actionPlan.explanation,
          }),
        );

        const estimatedEarningPounds = Number(
          (nearestSession.rewardPerKwhInOctopoints * 0.008 * Math.max(1, actionPlan.actions.length)).toFixed(2),
        );

        if (joinOutcome.joined) {
          void sendSavingSessionEmail(
            config,
            formatSavingSessionEmail(nearestSession, actionPlan.actions, estimatedEarningPounds),
          ).catch(() => undefined);
        }

        savingSessionTrackerNote = `Saving Session: ${joinOutcome.joined ? "joined" : "join failed"} (${joinOutcome.message}). Actions: ${actionPlan.actions.length}.`;
      }
    } catch (error: unknown) {
      savingSessionTrackerNote = `Saving Session: check failed (${error instanceof Error ? error.message : String(error)}).`;
    }

    let reportForEmail = dailySavingsReport;
    try {
      const powerUpDetection = await detectOctopusPowerUpEvents({
        apiKey: config.octopusApiKey,
        accountNumber: config.octopusAccountNumber,
        now,
        lookaheadHours: 0,
      });

      if (powerUpDetection.overnightEvents.length > 0) {
        reportForEmail = {
          ...dailySavingsReport,
          powerUpOvernightSummary: {
            count: powerUpDetection.overnightEvents.length,
            chargedKwh: powerUpDetection.overnightChargedKwhEstimate,
          },
        };
      }
    } catch {
      // Best-effort enrichment only.
    }

    try {
      const recentSavingSessions = await getRecentSavingSessions(
        config.octopusApiKey,
        config.octopusAccountNumber,
      );

      const overnightStart = new Date(now);
      overnightStart.setUTCHours(0, 0, 0, 0);
      overnightStart.setUTCDate(overnightStart.getUTCDate() - 1);
      const overnightEnd = new Date(now);
      overnightEnd.setUTCHours(6, 0, 0, 0);

      const participated = recentSavingSessions.find((session) => {
        const endMs = new Date(session.endAt).getTime();
        return (
          Number.isFinite(endMs)
          && endMs >= overnightStart.getTime()
          && endMs <= overnightEnd.getTime()
          && /joined|participated|completed/i.test(session.joinStatus)
        );
      });

      if (participated) {
        const estimatedEarningPounds = Number((participated.rewardPerKwhInOctopoints * 0.008).toFixed(2));
        reportForEmail = {
          ...reportForEmail,
          savingSessionOvernightSummary: {
            participated: true,
            estimatedEarningPounds,
          },
        };
      }
    } catch {
      // Best-effort enrichment only.
    }

    // Feature 7: Track cumulative battery cycle count and inject milestone notes
    // into the report before sending the email.
    let cyclesMilestoneNote: string | undefined;
    try {
      const cyclesKey = `aveum:battery:${config.userId}:cycles`;
      const estimatedNewCycles = optimizerOutput.summary.expectedBatteryCycles ?? 0;
      if (estimatedNewCycles > 0) {
        const storedRaw = await redis.get<string>(cyclesKey);
        const previousCycles = storedRaw ? parseFloat(storedRaw) : 0;
        const updatedCycles = previousCycles + estimatedNewCycles;
        await redis.set(cyclesKey, String(updatedCycles.toFixed(2)));

        if (previousCycles < 500 && updatedCycles >= 500) {
          cyclesMilestoneNote = `Battery milestone: your battery has now completed 500 full charge-discharge cycles. Aveum will begin applying a modest wear adjustment to protect long-term capacity.`;
        } else if (previousCycles < 1000 && updatedCycles >= 1000) {
          cyclesMilestoneNote = `Battery milestone: 1,000 cycles reached. Aveum has raised the degradation threshold — only high-value arbitrage windows will trigger battery cycling from here.`;
        }
      }
    } catch {
      // Best-effort.
    }

    if (cyclesMilestoneNote) {
      reportForEmail = {
        ...reportForEmail,
        nightlyNarrative: `${cyclesMilestoneNote} ${reportForEmail.nightlyNarrative}`,
      };
    }

    // Send email if SMTP is configured for this user (falls back to global env vars)
    const smtpHost = config.smtpHost || process.env.AVEUM_SMTP_HOST;
    const smtpUser = config.smtpUser || process.env.AVEUM_SMTP_USER;
    const smtpPass = config.smtpPass || process.env.AVEUM_SMTP_PASS;
    const notifyEmail = config.notifyEmail || process.env.AVEUM_NOTIFY_EMAIL;

    let emailSent = false;
    if (smtpHost && smtpUser && smtpPass && notifyEmail) {
      const smtpConfig = {
        smtpHost,
        smtpPort: config.smtpPort ?? parseInt(process.env.AVEUM_SMTP_PORT ?? "587", 10),
        smtpUser,
        smtpPass,
        notifyEmail,
        fromEmail: config.fromEmail || process.env.AVEUM_FROM_EMAIL,
      };
      const result = await sendMorningReport(
        reportForEmail,
        now.toISOString().slice(0, 10),
        smtpConfig,
      );
      emailSent = result.sent;
    }

    // ── Track result to Notion ───────────────────────────────────────────────
    const netCostPence =
      optimizerOutput.summary.expectedImportCostPence -
      optimizerOutput.summary.expectedExportRevenuePence;

    // Feature 6: Record observed EV departure when a departure time is configured.
    if (hasEv && config.departureTime) {
      try {
        const [hours, minutes] = config.departureTime.split(":").map(Number);
        if (Number.isFinite(hours) && Number.isFinite(minutes)) {
          await recordDeparture(config.userId, hours * 60 + minutes, redis);
        }
      } catch {
        // Best-effort.
      }
    }

    const trackingOutcome = await trackDailyResult({
      userName: config.userName,
      notifyEmail: config.notifyEmail,
      dateIso: now.toISOString().slice(0, 10),
      report: dailySavingsReport,
      netCostPence,
      evTargetAchieved: config.devices?.includes("ev") ? true : null,
      emailSent,
      savingSessionLog: savingSessionTrackerNote,
    });

    // ── Persist daily result for dashboard read-back ─────────────────────────
    const dailyResult: DailyResult = {
      date: now.toISOString().slice(0, 10),
      savedTodayPence: dailySavingsReport.savedTodayPence,
      earnedFromExportPence: dailySavingsReport.earnedFromExportPence,
      netCostPence,
      oneLiner: dailySavingsReport.oneLiner,
      evTargetAchieved: config.devices?.includes("ev") ? true : null,
      cheapestSlotTime: dailySavingsReport.cheapestSlotUsed?.time ?? null,
      cheapestSlotPence: dailySavingsReport.cheapestSlotUsed?.pricePencePerKwh ?? null,
      peakAvoidedTime: dailySavingsReport.batteryDischargedAt?.time ?? null,
      peakAvoidedPence: dailySavingsReport.batteryDischargedAt?.pricePencePerKwh ?? null,
    };
    try {
      const resultsKey = `aveum:results:${config.userId}`;
      await redis.lpush(resultsKey, JSON.stringify(dailyResult));
      // Keep at most 90 days of history
      await redis.ltrim(resultsKey, 0, 89);
    } catch {
      // Non-blocking — result persistence failure doesn't abort the cron run
    }

    return {
      octopusAccountNumber: accountRef,
      status: "ok",
      optimizerStatus: optimizerOutput.status,
      decisionCount: optimizerOutput.decisions.length,
      savedTodayPence: dailySavingsReport.savedTodayPence,
      emailSent,
      tracked: trackingOutcome.tracked,
    };
  } catch (err: unknown) {
    return {
      octopusAccountNumber: accountRef,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Cron handler ───────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel cron sends GET; protect against accidental direct calls in production
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const userConfigs: UserConfig[] = await readStoredUsers();
  if (userConfigs.length === 0) {
    return res.status(200).json({
      ran: 0,
      message: "No registered users found in /tmp/aveum-users.json — nothing to do.",
      results: [],
    });
  }

  const now = new Date();
  const results: UserRunResult[] = [];

  for (const config of userConfigs) {
    if (!config.octopusApiKey || !config.octopusAccountNumber) {
      results.push({
        octopusAccountNumber: config.octopusAccountNumber ?? "unknown",
        status: "error",
        error: "Missing octopusApiKey or octopusAccountNumber",
      });
      continue;
    }
    const result = await runForUser(config, now);
    results.push(result);
  }

  const okCount = results.filter((r) => r.status === "ok").length;
  const errorCount = results.length - okCount;

  return res.status(200).json({
    ran: results.length,
    ok: okCount,
    errors: errorCount,
    ranAt: now.toISOString(),
    results,
  });
}
