import type { CanonicalValueLedger } from "./valueLedger";

export interface CustomerValueSummary {
  /** Estimated savings vs hold-current-state baseline, in GBP. Derived from ledger.estimatedSavingsVsBaselinePence. */
  projectedSavingsGbp: number;
  /** Estimated export revenue, in GBP. Derived from ledger.estimatedExportRevenuePence. */
  projectedEarningsGbp: number;
  /** Estimated import spend, in GBP. Derived from ledger.estimatedImportCostPence. */
  estimatedImportSpendGbp: number;
}

function toGbp(valuePence: number): number {
  return Number((valuePence / 100).toFixed(2));
}

/**
 * Canonical customer-facing value translation.
 *
 * Accounting authority lives in CanonicalValueLedger.
 * Optimizer summary remains planning telemetry and must not be reinterpreted
 * directly by UI/compatibility adapters as accounting truth.
 */
export function mapValueLedgerToCustomerValueSummary(
  ledger: CanonicalValueLedger,
): CustomerValueSummary {
  return {
    projectedSavingsGbp: toGbp(Math.max(0, ledger.estimatedSavingsVsBaselinePence)),
    projectedEarningsGbp: toGbp(Math.max(0, ledger.estimatedExportRevenuePence)),
    estimatedImportSpendGbp: toGbp(Math.max(0, ledger.estimatedImportCostPence)),
  };
}