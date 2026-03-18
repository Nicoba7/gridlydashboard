import { describe, expect, it } from "vitest";
import type { Forecasts, TariffSchedule } from "../domain";
import type { OptimizerOutput } from "../domain/optimizer";
import { buildCanonicalValueLedger } from "../application/runtime/buildCanonicalValueLedger";

function buildForecasts(load: number[], solar: number[]): Forecasts {
  const start = new Date("2026-03-16T10:00:00.000Z").getTime();

  return {
    generatedAt: "2026-03-16T10:00:00.000Z",
    horizonStartAt: "2026-03-16T10:00:00.000Z",
    horizonEndAt: new Date(start + load.length * 30 * 60 * 1000).toISOString(),
    slotDurationMinutes: 30,
    householdLoadKwh: load.map((value, index) => ({
      startAt: new Date(start + index * 30 * 60 * 1000).toISOString(),
      endAt: new Date(start + (index + 1) * 30 * 60 * 1000).toISOString(),
      value,
      confidence: 0.9,
    })),
    solarGenerationKwh: solar.map((value, index) => ({
      startAt: new Date(start + index * 30 * 60 * 1000).toISOString(),
      endAt: new Date(start + (index + 1) * 30 * 60 * 1000).toISOString(),
      value,
      confidence: 0.9,
    })),
    carbonIntensity: load.map((_, index) => ({
      startAt: new Date(start + index * 30 * 60 * 1000).toISOString(),
      endAt: new Date(start + (index + 1) * 30 * 60 * 1000).toISOString(),
      value: 180,
      confidence: 0.9,
    })),
  };
}

function buildTariffSchedule(importRates: number[], exportRates?: number[]): TariffSchedule {
  const start = new Date("2026-03-16T10:00:00.000Z").getTime();

  return {
    tariffId: "tariff-1",
    provider: "Gridly",
    name: "Synthetic",
    currency: "GBP",
    updatedAt: "2026-03-16T10:00:00.000Z",
    importRates: importRates.map((rate, index) => ({
      startAt: new Date(start + index * 30 * 60 * 1000).toISOString(),
      endAt: new Date(start + (index + 1) * 30 * 60 * 1000).toISOString(),
      unitRatePencePerKwh: rate,
      source: "live",
    })),
    exportRates: exportRates?.map((rate, index) => ({
      startAt: new Date(start + index * 30 * 60 * 1000).toISOString(),
      endAt: new Date(start + (index + 1) * 30 * 60 * 1000).toISOString(),
      unitRatePencePerKwh: rate,
      source: "live",
    })),
  };
}

function buildOptimizerOutput(summary: {
  expectedImportCostPence: number;
  expectedExportRevenuePence: number;
  planningNetRevenueSurplusPence: number;
  expectedBatteryDegradationCostPence?: number;
}): OptimizerOutput {
  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: "plan-1",
    generatedAt: "2026-03-16T10:00:00.000Z",
    status: "ok",
    headline: "test",
    decisions: [],
    recommendedCommands: [],
    summary,
    diagnostics: [],
    feasibility: {
      executable: true,
      reasonCodes: ["PLAN_COMPUTED"],
    },
    assumptions: [],
    warnings: [],
    confidence: 0.82,
  };
}

describe("buildCanonicalValueLedger", () => {
  it("builds canonical value summary with hold_current_state baseline", () => {
    const ledger = buildCanonicalValueLedger({
      optimizationMode: "cost",
      optimizerOutput: buildOptimizerOutput({
        expectedImportCostPence: 120,
        expectedExportRevenuePence: 40,
        planningNetRevenueSurplusPence: -80,
      }),
      forecasts: buildForecasts([2, 1], [0, 3]),
      tariffSchedule: buildTariffSchedule([20, 10], [8, 12]),
    });

    expect(ledger.optimizationMode).toBe("cost");
    expect(ledger.estimatedImportCostPence).toBe(120);
    expect(ledger.estimatedExportRevenuePence).toBe(40);
    expect(ledger.estimatedBatteryDegradationCostPence).toBe(0);
    expect(ledger.estimatedNetCostPence).toBe(80);
    expect(ledger.baselineType).toBe("hold_current_state");
    expect(ledger.baselineImportCostPence).toBe(40);
    expect(ledger.baselineExportRevenuePence).toBe(24);
    expect(ledger.baselineBatteryDegradationCostPence).toBe(0);
    expect(ledger.baselineNetCostPence).toBe(16);
    expect(ledger.estimatedSavingsVsBaselinePence).toBe(-64);
    expect(ledger.confidence).toBe(0.82);
  });

  it("adds explicit caveat when export rates are unavailable", () => {
    const ledger = buildCanonicalValueLedger({
      optimizationMode: "balanced",
      optimizerOutput: buildOptimizerOutput({
        expectedImportCostPence: 90,
        expectedExportRevenuePence: 0,
        planningNetRevenueSurplusPence: -90,
      }),
      forecasts: buildForecasts([1], [2]),
      tariffSchedule: buildTariffSchedule([30]),
    });

    expect(ledger.baselineExportRevenuePence).toBe(0);
    expect(ledger.baselineBatteryDegradationCostPence).toBe(0);
    expect(ledger.caveats).toContain(
      "Baseline export revenue assumes zero value when export tariff slots are unavailable.",
    );
    expect(ledger.assumptions).toContain(
      "No export tariff schedule was available; baseline export value is conservatively treated as zero.",
    );
  });

  it("includes optimizer degradation cost in estimated net cost and savings", () => {
    const ledger = buildCanonicalValueLedger({
      optimizationMode: "cost",
      optimizerOutput: buildOptimizerOutput({
        expectedImportCostPence: 100,
        expectedExportRevenuePence: 20,
        planningNetRevenueSurplusPence: -82,
        expectedBatteryDegradationCostPence: 2,
      }),
      forecasts: buildForecasts([1], [0]),
      tariffSchedule: buildTariffSchedule([30], [8]),
    });

    expect(ledger.estimatedBatteryDegradationCostPence).toBe(2);
    expect(ledger.estimatedNetCostPence).toBe(82);
    expect(ledger.assumptions).toContain(
      "Estimated optimized value includes battery degradation cost for planned discharge throughput.",
    );
  });
});
