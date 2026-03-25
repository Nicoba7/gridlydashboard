import "dotenv/config";
import { buildDailySavingsReport } from "../features/report/dailySavingsReport";
import { readMorningEmailConfigFromEnv, sendMorningReport } from "../features/notifications/morningEmailReport";
import type { OptimizerOutput } from "../domain/optimizer";
import type { TariffSchedule } from "../domain/tariff";

// ── Mock timestamps ────────────────────────────────────────────────────────────

const NOW = new Date();
const today = NOW.toISOString().slice(0, 10); // YYYY-MM-DD

function slot(hhmm: string, durationMins = 30): { startAt: string; endAt: string } {
  const [hh, mm] = hhmm.split(":").map(Number);
  const start = new Date(`${today}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000Z`);
  const end = new Date(start.getTime() + durationMins * 60 * 1000);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

// ── Mock tariff schedule ───────────────────────────────────────────────────────
// Covers each decision slot with a matching import rate.

const chargeBatterySlot   = slot("01:30"); // 2.3p
const dischargeSlot       = slot("17:30"); // 34p
const chargeEvSlot        = slot("02:00"); // 2.8p

// Pad the day with a default 24p rate across the full 24h, then override the three slots.
function buildDayRates(): TariffSchedule["importRates"] {
  const rates: TariffSchedule["importRates"] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const s = new Date(`${today}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`);
      const e = new Date(s.getTime() + 30 * 60 * 1000);
      rates.push({ startAt: s.toISOString(), endAt: e.toISOString(), unitRatePencePerKwh: 24 });
    }
  }
  // Override specific slots
  for (const rate of rates) {
    if (rate.startAt === chargeBatterySlot.startAt) rate.unitRatePencePerKwh = 2.3;
    if (rate.startAt === dischargeSlot.startAt)     rate.unitRatePencePerKwh = 34;
    if (rate.startAt === chargeEvSlot.startAt)      rate.unitRatePencePerKwh = 2.8;
  }
  return rates;
}

const tariffSchedule: TariffSchedule = {
  importRates: buildDayRates(),
  exportRates: [],
};

// ── Mock optimizer output ──────────────────────────────────────────────────────

const mockOptimizerOutput: OptimizerOutput = {
  planId: "test-plan-001",
  generatedAt: NOW.toISOString(),
  status: "optimal",
  headline: "Charged battery at 2.3p, discharged at 34p, EV charged at 2.8p.",
  decisions: [
    {
      decisionId: "d-charge-battery",
      ...chargeBatterySlot,
      executionWindow: chargeBatterySlot,
      action: "charge_battery",
      targetDeviceIds: ["mock-battery"],
      reason: "Cheapest import window — 2.3p/kWh.",
      expectedImportKwh: 3.5,
      expectedBatterySocPercent: 95,
      confidence: 0.97,
    },
    {
      decisionId: "d-discharge-battery",
      ...dischargeSlot,
      executionWindow: dischargeSlot,
      action: "discharge_battery",
      targetDeviceIds: ["mock-battery"],
      reason: "Peak price window — 34p/kWh. Avoid grid import.",
      expectedImportKwh: 0,
      expectedBatterySocPercent: 40,
      confidence: 0.95,
    },
    {
      decisionId: "d-charge-ev",
      ...chargeEvSlot,
      executionWindow: chargeEvSlot,
      action: "charge_ev",
      targetDeviceIds: ["mock-ev"],
      reason: "Cheap overnight window — 2.8p/kWh.",
      expectedImportKwh: 7.4,
      expectedEvSocPercent: 80,
      confidence: 0.93,
    },
  ],
  recommendedCommands: [],
  summary: {
    expectedImportCostPence: 58,   // ~(3.5 × 2.3) + (7.4 × 2.8) = 8.05 + 20.72 ≈ 29p charge; rest of day ~29p
    expectedExportRevenuePence: 0,
    planningNetRevenueSurplusPence: 742,
  },
  diagnostics: [],
};

// ── Run ────────────────────────────────────────────────────────────────────────

const report = buildDailySavingsReport({
  optimizerOutput: mockOptimizerOutput,
  tariffSchedule,
  setAndForgetNetCostPence: 800,
});

console.log("\n── Daily Savings Report ──────────────────────────────────────");
console.log(JSON.stringify(report, null, 2));

const config = readMorningEmailConfigFromEnv(process.env as any);
const result = await sendMorningReport(report, NOW.toISOString(), config);

console.log("\n── Send Result ───────────────────────────────────────────────");
console.log(JSON.stringify(result, null, 2));
