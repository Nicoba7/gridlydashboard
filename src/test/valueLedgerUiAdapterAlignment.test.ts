import { describe, expect, it } from "vitest";
import {
  buildHomeOptimizerInput,
  buildHomeUiViewModel,
  buildIndexUiViewModel,
  optimizeForLegacyPlanUi,
} from "../optimizer";
import type { OptimizerOutput } from "../domain/optimizer";
import type { CanonicalValueLedger } from "../domain/valueLedger";
import { buildCanonicalValueLedger } from "../application/runtime/buildCanonicalValueLedger";
import { mapValueLedgerToCustomerValueSummary } from "../domain/customerValueSummary";

function buildOptimizerOutput(overrides: Partial<OptimizerOutput> = {}): OptimizerOutput {
  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: "plan-test",
    generatedAt: "2026-03-16T10:00:00.000Z",
    status: "ok",
    headline: "Holding for better window",
    decisions: [],
    recommendedCommands: [],
    summary: {
      expectedImportCostPence: 9999,
      expectedExportRevenuePence: 8888,
      planningNetRevenueSurplusPence: 7777,
      expectedBatteryDegradationCostPence: 0,
    },
    diagnostics: [],
    feasibility: {
      executable: true,
      reasonCodes: ["PLAN_COMPUTED"],
    },
    assumptions: [],
    warnings: [],
    confidence: 0.9,
    ...overrides,
  };
}

function buildLedger(overrides: Partial<CanonicalValueLedger> = {}): CanonicalValueLedger {
  return {
    optimizationMode: "balanced",
    estimatedImportCostPence: 1200,
    estimatedExportRevenuePence: 340,
    estimatedBatteryDegradationCostPence: 40,
    estimatedNetCostPence: 900,
    baselineType: "hold_current_state",
    baselineNetCostPence: 1400,
    baselineImportCostPence: 1500,
    baselineExportRevenuePence: 100,
    baselineBatteryDegradationCostPence: 0,
    estimatedSavingsVsBaselinePence: 500,
    assumptions: [],
    caveats: [],
    confidence: 0.85,
    ...overrides,
  };
}

describe("value ledger alignment across UI adapters", () => {
  it("derives Home view customer value from canonical ledger rather than optimizer summary fields", () => {
    const output = buildOptimizerOutput();
    const ledger = buildLedger();
    const customer = mapValueLedgerToCustomerValueSummary(ledger);

    const view = buildHomeUiViewModel(output, ledger);

    expect(view.value.savingsToday).toBe(customer.projectedSavingsGbp);
    expect(view.value.earningsToday).toBe(customer.projectedEarningsGbp);
  });

  it("derives Index savings estimate from canonical ledger", () => {
    const output = buildOptimizerOutput();
    const ledger = buildLedger({ estimatedSavingsVsBaselinePence: 321 });
    const customer = mapValueLedgerToCustomerValueSummary(ledger);

    const view = buildIndexUiViewModel(output, ledger);

    expect(view.savingsEstimate).toBe(customer.projectedSavingsGbp);
  });

  it("derives legacy Plan summary value fields from canonical ledger mapping", () => {
    const input = buildHomeOptimizerInput({
      now: new Date("2026-03-16T10:00:00.000Z"),
      connectedDeviceIds: ["battery", "grid", "solar"],
      planningMode: "balanced",
      rates: [
        { time: "00:00", pence: 12 },
        { time: "00:30", pence: 18 },
        { time: "01:00", pence: 24 },
        { time: "01:30", pence: 10 },
      ],
      batteryStartPct: 55,
      batteryCapacityKwh: 13.5,
      batteryReservePct: 30,
      solarForecastKwh: 8,
      exportPriceRatio: 0.72,
    });

    const result = optimizeForLegacyPlanUi(input);
    const ledger = buildCanonicalValueLedger({
      optimizationMode: input.constraints.mode,
      optimizerOutput: result.optimizerOutput,
      forecasts: input.forecasts,
      tariffSchedule: input.tariffSchedule,
    });
    const customer = mapValueLedgerToCustomerValueSummary(ledger);

    expect(result.summary.projectedSavings).toBe(customer.projectedSavingsGbp);
    expect(result.summary.projectedEarnings).toBe(customer.projectedEarningsGbp);
    expect(result.summary.estimatedImportSpend).toBe(customer.estimatedImportSpendGbp);
    expect(result.summary.estimatedExportRevenue).toBe(customer.projectedEarningsGbp);
    expect(result.gridlySummary.estimatedValue).toBe(customer.projectedSavingsGbp);
  });
});
