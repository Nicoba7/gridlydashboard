import { describe, expect, it } from "vitest";
import { mapValueLedgerToCustomerValueSummary } from "../domain/customerValueSummary";
import type { CanonicalValueLedger } from "../domain/valueLedger";

function buildLedger(overrides: Partial<CanonicalValueLedger> = {}): CanonicalValueLedger {
  return {
    optimizationMode: "balanced",
    estimatedImportCostPence: 1234,
    estimatedExportRevenuePence: 456,
    estimatedBatteryDegradationCostPence: 12,
    estimatedNetCostPence: 790,
    baselineType: "hold_current_state",
    baselineNetCostPence: 1000,
    baselineImportCostPence: 1300,
    baselineExportRevenuePence: 300,
    baselineBatteryDegradationCostPence: 0,
    estimatedSavingsVsBaselinePence: 210,
    assumptions: [],
    caveats: [],
    confidence: 0.8,
    ...overrides,
  };
}

describe("mapValueLedgerToCustomerValueSummary", () => {
  it("maps canonical ledger accounting fields to customer-facing values", () => {
    const summary = mapValueLedgerToCustomerValueSummary(
      buildLedger({
        estimatedImportCostPence: 1234,
        estimatedExportRevenuePence: 456,
        estimatedNetCostPence: 790,
        estimatedSavingsVsBaselinePence: 210,
      }),
    );

    expect(summary.estimatedImportSpendGbp).toBe(12.34);
    expect(summary.projectedEarningsGbp).toBe(4.56);
    expect(summary.projectedSavingsGbp).toBe(2.1);
  });

  it("clamps projected savings at zero when ledger shows negative savings vs baseline", () => {
    const summary = mapValueLedgerToCustomerValueSummary(
      buildLedger({ estimatedSavingsVsBaselinePence: -333 }),
    );

    expect(summary.projectedSavingsGbp).toBe(0);
  });
});
