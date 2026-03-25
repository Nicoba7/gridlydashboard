import { describe, expect, it } from "vitest";
import { buildDailySavingsReport } from "../features/report/dailySavingsReport";
import type { OptimizerOutput } from "../domain/optimizer";
import type { TariffSchedule } from "../domain/tariff";

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeTariff(slots: { startAt: string; endAt: string; rate: number }[]): TariffSchedule {
  return {
    tariffId: "test-tariff",
    provider: "Test",
    name: "Test Tariff",
    currency: "GBP",
    updatedAt: "2026-03-25T00:00:00Z",
    importRates: slots.map(({ startAt, endAt, rate }) => ({
      startAt,
      endAt,
      unitRatePencePerKwh: rate,
      source: "live" as const,
    })),
  };
}

function makeDecision(
  action: string,
  startAt: string,
  endAt: string,
): OptimizerOutput["decisions"][number] {
  return {
    decisionId: `d-${startAt}`,
    startAt,
    endAt,
    executionWindow: { startAt, endAt },
    action: action as OptimizerOutput["decisions"][number]["action"],
    targetDeviceIds: ["inverter-1"],
    reason: "test",
    confidence: 0.9,
  };
}

function makeOptimizerOutput(
  decisions: OptimizerOutput["decisions"],
  importCostPence: number,
  exportRevenuePence: number,
): OptimizerOutput {
  return {
    planId: "plan-1",
    generatedAt: "2026-03-25T00:00:00Z",
    status: "ok",
    headline: "Test plan",
    decisions,
    recommendedCommands: [],
    summary: {
      expectedImportCostPence: importCostPence,
      expectedExportRevenuePence: exportRevenuePence,
      planningNetRevenueSurplusPence: exportRevenuePence - importCostPence,
    },
    diagnostics: [],
    confidence: 0.9,
  };
}

// ── Shared tariff: cheap overnight, peak evening ──────────────────────────────

const TARIFF = makeTariff([
  { startAt: "2026-03-25T01:00:00Z", endAt: "2026-03-25T01:30:00Z", rate: 2.3 },
  { startAt: "2026-03-25T01:30:00Z", endAt: "2026-03-25T02:00:00Z", rate: 3.1 },
  { startAt: "2026-03-25T07:00:00Z", endAt: "2026-03-25T07:30:00Z", rate: 12.0 },
  { startAt: "2026-03-25T17:00:00Z", endAt: "2026-03-25T17:30:00Z", rate: 34.0 },
  { startAt: "2026-03-25T17:30:00Z", endAt: "2026-03-25T18:00:00Z", rate: 28.0 },
]);

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("buildDailySavingsReport", () => {
  it("calculates savedTodayPence as set-and-forget minus aveum net cost", () => {
    const output = makeOptimizerOutput([], 350, 44);
    // aveum net = 350 - 44 = 306p; set-and-forget = 500p; saved = 194p
    const report = buildDailySavingsReport({
      optimizerOutput: output,
      tariffSchedule: TARIFF,
      setAndForgetNetCostPence: 500,
    });

    expect(report.savedTodayPence).toBe(194);
  });

  it("passes through earnedFromExportPence from optimizer summary", () => {
    const output = makeOptimizerOutput([], 200, 44);
    const report = buildDailySavingsReport({
      optimizerOutput: output,
      tariffSchedule: TARIFF,
      setAndForgetNetCostPence: 300,
    });

    expect(report.earnedFromExportPence).toBe(44);
  });

  it("identifies cheapest charge slot among charge_battery decisions", () => {
    const decisions = [
      makeDecision("charge_battery", "2026-03-25T01:30:00Z", "2026-03-25T02:00:00Z"), // 3.1p
      makeDecision("charge_battery", "2026-03-25T01:00:00Z", "2026-03-25T01:30:00Z"), // 2.3p ← cheapest
    ];
    const output = makeOptimizerOutput(decisions, 300, 0);
    const report = buildDailySavingsReport({
      optimizerOutput: output,
      tariffSchedule: TARIFF,
      setAndForgetNetCostPence: 500,
    });

    expect(report.cheapestSlotUsed).not.toBeNull();
    expect(report.cheapestSlotUsed?.pricePencePerKwh).toBe(2.3);
    expect(report.cheapestSlotUsed?.time).toBe("01:00");
  });

  it("identifies peak discharge slot among discharge_battery decisions", () => {
    const decisions = [
      makeDecision("discharge_battery", "2026-03-25T17:00:00Z", "2026-03-25T17:30:00Z"), // 34p ← peak
      makeDecision("discharge_battery", "2026-03-25T17:30:00Z", "2026-03-25T18:00:00Z"), // 28p
    ];
    const output = makeOptimizerOutput(decisions, 300, 0);
    const report = buildDailySavingsReport({
      optimizerOutput: output,
      tariffSchedule: TARIFF,
      setAndForgetNetCostPence: 500,
    });

    expect(report.batteryDischargedAt).not.toBeNull();
    expect(report.batteryDischargedAt?.pricePencePerKwh).toBe(34);
  });

  it("averages EV charge slot prices and uses first slot time", () => {
    const decisions = [
      makeDecision("charge_ev", "2026-03-25T07:00:00Z", "2026-03-25T07:30:00Z"), // 12p
      makeDecision("charge_ev", "2026-03-25T01:00:00Z", "2026-03-25T01:30:00Z"), // 2.3p
    ];
    const output = makeOptimizerOutput(decisions, 300, 0);
    const report = buildDailySavingsReport({
      optimizerOutput: output,
      tariffSchedule: TARIFF,
      setAndForgetNetCostPence: 400,
    });

    expect(report.evChargedAt).not.toBeNull();
    // First decision's slot time
    expect(report.evChargedAt?.time).toBe("07:00");
    // Average of 12 and 2.3 = 7.15, rounded to 1dp = 7.2
    expect(report.evChargedAt?.pricePencePerKwh).toBe(7.2);
  });

  it("returns nulls when no battery or EV actions are planned", () => {
    const output = makeOptimizerOutput([], 300, 0);
    const report = buildDailySavingsReport({
      optimizerOutput: output,
      tariffSchedule: TARIFF,
      setAndForgetNetCostPence: 300,
    });

    expect(report.cheapestSlotUsed).toBeNull();
    expect(report.batteryDischargedAt).toBeNull();
    expect(report.evChargedAt).toBeNull();
  });

  describe("oneLiner", () => {
    it("includes charge and discharge prices and savings amount", () => {
      const decisions = [
        makeDecision("charge_battery", "2026-03-25T01:00:00Z", "2026-03-25T01:30:00Z"),
        makeDecision("discharge_battery", "2026-03-25T17:00:00Z", "2026-03-25T17:30:00Z"),
      ];
      const output = makeOptimizerOutput(decisions, 306, 44);
      const report = buildDailySavingsReport({
        optimizerOutput: output,
        tariffSchedule: TARIFF,
        setAndForgetNetCostPence: 500,
      });

      // savedTodayPence = 500 - (306 - 44) = 238p = £2.38
      expect(report.oneLiner).toContain("2.3p");
      expect(report.oneLiner).toContain("34.0p");
      expect(report.oneLiner).toContain("£2.38");
    });

    it("mentions export earnings when no battery actions but export revenue exists", () => {
      const output = makeOptimizerOutput([], 100, 80);
      const report = buildDailySavingsReport({
        optimizerOutput: output,
        tariffSchedule: TARIFF,
        setAndForgetNetCostPence: 120,
      });

      // savedTodayPence = 120 - (100 - 80) = 100p = £1.00
      expect(report.oneLiner).toContain("£0.80"); // export earnings
    });

    it("produces monitoring fallback when nothing was saved", () => {
      const output = makeOptimizerOutput([], 400, 0);
      const report = buildDailySavingsReport({
        optimizerOutput: output,
        tariffSchedule: TARIFF,
        setAndForgetNetCostPence: 400,
      });

      expect(report.oneLiner).toMatch(/monitoring|opportunity/i);
    });
  });

  describe("nightlyNarrative", () => {
    it("is a non-empty string", () => {
      const output = makeOptimizerOutput([], 300, 0);
      const report = buildDailySavingsReport({
        optimizerOutput: output,
        tariffSchedule: TARIFF,
        setAndForgetNetCostPence: 300,
      });

      expect(typeof report.nightlyNarrative).toBe("string");
      expect(report.nightlyNarrative.length).toBeGreaterThan(10);
    });

    it("mentions charge price and peak discharge price when both occurred", () => {
      const decisions = [
        makeDecision("charge_battery", "2026-03-25T01:00:00Z", "2026-03-25T01:30:00Z"),
        makeDecision("discharge_battery", "2026-03-25T17:00:00Z", "2026-03-25T17:30:00Z"),
      ];
      const output = makeOptimizerOutput(decisions, 300, 0);
      const report = buildDailySavingsReport({
        optimizerOutput: output,
        tariffSchedule: TARIFF,
        setAndForgetNetCostPence: 500,
      });

      expect(report.nightlyNarrative).toContain("2.3p");
      expect(report.nightlyNarrative).toContain("34.0p");
    });

    it("includes savings amount when positive savings occurred", () => {
      const output = makeOptimizerOutput([], 200, 0);
      const report = buildDailySavingsReport({
        optimizerOutput: output,
        tariffSchedule: TARIFF,
        setAndForgetNetCostPence: 400,
      });

      expect(report.nightlyNarrative).toContain("£2.00");
    });
  });
});
