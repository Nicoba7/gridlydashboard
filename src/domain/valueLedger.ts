import type { OptimizationMode } from "./optimizer";

export type ValueLedgerBaselineType = "hold_current_state";

export interface CanonicalValueLedger {
  optimizationMode: OptimizationMode;
  estimatedImportCostPence: number;
  estimatedExportRevenuePence: number;
  estimatedBatteryDegradationCostPence: number;
  estimatedNetCostPence: number;
  baselineType: ValueLedgerBaselineType;
  baselineNetCostPence: number;
  baselineImportCostPence: number;
  baselineExportRevenuePence: number;
  baselineBatteryDegradationCostPence: number;
  estimatedSavingsVsBaselinePence: number;
  assumptions: string[];
  caveats: string[];
  confidence: number;
}
