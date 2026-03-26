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
import type { StoredUser } from "./register";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const KV_KEY = "aveum:users";

async function readStoredUsers(): Promise<StoredUser[]> {
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

    const snapshot = getCanonicalSimulationSnapshot(now);
    const optimizerOutput = optimize({
      systemState: snapshot.systemState,
      forecasts: snapshot.forecasts,
      tariffSchedule,
      constraints: {
        mode: optimizationMode,
        allowGridBatteryCharging: true,
        allowBatteryExport: true,
        allowAutomaticEvCharging: true,
      },
    });

    const dailySavingsReport = buildDailySavingsReport({
      optimizerOutput,
      tariffSchedule,
      setAndForgetNetCostPence: 0,
    });

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
        dailySavingsReport,
        now.toISOString().slice(0, 10),
        smtpConfig,
      );
      emailSent = result.sent;
    }

    // ── Track result to Notion ───────────────────────────────────────────────
    const netCostPence =
      optimizerOutput.summary.expectedImportCostPence -
      optimizerOutput.summary.expectedExportRevenuePence;

    const trackingOutcome = await trackDailyResult({
      userName: config.userName,
      notifyEmail: config.notifyEmail,
      dateIso: now.toISOString().slice(0, 10),
      report: dailySavingsReport,
      netCostPence,
      evTargetAchieved: config.devices?.includes("ev") ? true : null,
      emailSent,
    });

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
