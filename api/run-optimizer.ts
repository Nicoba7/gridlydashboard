// api/run-optimizer.ts — Vercel serverless function
// Runs the Aveum optimizer for a given user config and sends the morning email.
// POST /api/run-optimizer
// Body: { octopusApiKey, octopusAccountNumber, region?, optimizationMode?, notifyEmail? }

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { optimize } from "../src/optimizer/engine";
import { getCanonicalSimulationSnapshot } from "../src/simulator";
import { buildDailySavingsReport } from "../src/features/report/dailySavingsReport";
import {
  buildMorningEmailContent,
  sendMorningReport,
} from "../src/features/notifications/morningEmailReport";
import type { OptimizationMode, TariffSchedule } from "../src/domain";

// ── Types ──────────────────────────────────────────────────────────────────────

interface RunOptimizerRequestBody {
  octopusApiKey: string;
  octopusAccountNumber: string;
  region?: string;           // Octopus region code, e.g. "C" (default)
  optimizationMode?: string; // "cost" | "balanced" | "carbon" | "self_consumption"
  notifyEmail?: string;      // override recipient address
}

interface OctopusRateResult {
  valid_from: string;
  valid_to: string;
  value_inc_vat: number;
}

interface OctopusRatesResponse {
  results?: OctopusRateResult[];
}

// ── Octopus helpers ────────────────────────────────────────────────────────────

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

async function fetchRates(url: string, apiKey: string): Promise<OctopusRateResult[]> {
  const res = await fetch(url, { headers: { Authorization: authHeader(apiKey) } });
  if (!res.ok) throw new Error(`Octopus fetch failed (${res.status}) for ${url}`);
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

// ── Validation ─────────────────────────────────────────────────────────────────

function toOptimizationMode(raw: string | undefined): OptimizationMode {
  const valid: OptimizationMode[] = ["cost", "balanced", "carbon", "self_consumption"];
  const normalised = raw?.trim().toLowerCase() as OptimizationMode | undefined;
  return normalised && valid.includes(normalised) ? normalised : "balanced";
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body as RunOptimizerRequestBody;

  if (!body?.octopusApiKey) {
    return res.status(400).json({ error: "octopusApiKey is required" });
  }
  if (!body?.octopusAccountNumber) {
    return res.status(400).json({ error: "octopusAccountNumber is required" });
  }

  const now = new Date();
  const region = body.region?.trim() || "C";
  const optimizationMode = toOptimizationMode(body.optimizationMode);

  try {
    // ── 1. Fetch Octopus Agile rates ─────────────────────────────────────────
    const importResults = await fetchRates(buildAgileUrl(region, now), body.octopusApiKey);

    let exportResults: OctopusRateResult[] = [];
    try {
      exportResults = await fetchRates(buildExportUrl(region, now), body.octopusApiKey);
    } catch {
      // Export rates optional — continue without them
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

    // ── 2. Build OptimizerInput using simulated system state & forecasts ──────
    const snapshot = getCanonicalSimulationSnapshot(now);

    const optimizerInput = {
      systemState: snapshot.systemState,
      forecasts: snapshot.forecasts,
      tariffSchedule,
      constraints: {
        mode: optimizationMode,
        allowGridBatteryCharging: true,
        allowBatteryExport: true,
        allowAutomaticEvCharging: true,
      },
    };

    // ── 3. Run optimizer ──────────────────────────────────────────────────────
    const optimizerOutput = optimize(optimizerInput);

    // ── 4. Build savings report ───────────────────────────────────────────────
    const dailySavingsReport = buildDailySavingsReport({
      optimizerOutput,
      tariffSchedule,
      setAndForgetNetCostPence: 0,
    });

    // ── 5. Send morning email (if SMTP is configured) ─────────────────────────
    const smtpHost = process.env.AVEUM_SMTP_HOST;
    const smtpUser = process.env.AVEUM_SMTP_USER;
    const smtpPass = process.env.AVEUM_SMTP_PASS;
    const notifyEmail = body.notifyEmail || process.env.AVEUM_NOTIFY_EMAIL;

    let emailResult: { sent: boolean; skippedReason?: string } = {
      sent: false,
      skippedReason: "SMTP not configured",
    };

    if (smtpHost && smtpUser && smtpPass && notifyEmail) {
      const smtpConfig = {
        smtpHost,
        smtpPort: parseInt(process.env.AVEUM_SMTP_PORT ?? "587", 10),
        smtpUser,
        smtpPass,
        notifyEmail,
        fromEmail: process.env.AVEUM_FROM_EMAIL,
      };
      emailResult = await sendMorningReport(
        dailySavingsReport,
        now.toISOString().slice(0, 10),
        smtpConfig,
      );
    }

    // ── 6. Respond ────────────────────────────────────────────────────────────
    return res.status(200).json({
      status: "ok",
      optimizerStatus: optimizerOutput.status,
      headline: optimizerOutput.headline,
      decisionCount: optimizerOutput.decisions.length,
      tariff: {
        importRateCount: tariffSchedule.importRates.length,
        exportRateCount: tariffSchedule.exportRates?.length ?? 0,
        region,
      },
      dailySavingsReport,
      emailResult,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}
