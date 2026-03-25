import type { AveumPlanSummary, PlanSummary, PlanWithSessions } from "../types/planCompat";
import type { CanonicalValueLedger, OptimizerInput, OptimizerOutput } from "../domain";
import { mapValueLedgerToCustomerValueSummary } from "../domain";
import { optimize } from "./engine";
import { buildCanonicalPlan } from "./planBuilder";
import { buildCanonicalValueLedger } from "../application/runtime/buildCanonicalValueLedger";

export interface LegacyPlanUiResult {
  optimizerOutput: OptimizerOutput;
  plan: PlanWithSessions;
  summary: PlanSummary;
  gridlySummary: AveumPlanSummary;
}

function buildEmptyLegacyPlan(): PlanWithSessions {
  const plan = [] as PlanWithSessions;
  plan.sessions = [];
  return plan;
}

function buildDefaultLegacySummary(
  optimizerOutput: OptimizerOutput,
  valueLedger: CanonicalValueLedger,
): PlanSummary {
  // Accounting authority comes from canonical value ledger.
  // Optimizer summary remains planning telemetry and headline support.
  const customerValue = mapValueLedgerToCustomerValueSummary(valueLedger);

  return {
    projectedEarnings: customerValue.projectedEarningsGbp,
    projectedSavings: customerValue.projectedSavingsGbp,
    cheapestSlot: "--:--",
    cheapestPrice: 0,
    peakSlot: "--:--",
    peakPrice: 0,
    mode: "BALANCED",
    batteryReserveTargetPct: 30,
    batteryReserveStartPct: 30,
    batteryCyclesPlanned: Math.max(0, Math.round(optimizerOutput.summary.expectedBatteryCycles ?? 0)),
    evSlotsPlanned: 0,
    estimatedImportSpend: customerValue.estimatedImportSpendGbp,
    estimatedExportRevenue: customerValue.projectedEarningsGbp,
    rationale: [optimizerOutput.headline],
  };
}

function buildDefaultAveumSummary(
  optimizerOutput: OptimizerOutput,
  valueLedger: CanonicalValueLedger,
): AveumPlanSummary {
  const customerValue = mapValueLedgerToCustomerValueSummary(valueLedger);

  return {
    planHeadline: optimizerOutput.headline,
    keyOutcomes: [optimizerOutput.headline],
    intent: "avoid_peak_import",
    customerReason: optimizerOutput.headline,
    estimatedValue: customerValue.projectedSavingsGbp,
    showSolarInsight: true,
    showPriceChart: true,
    showInsightCard: true,
  };
}

/**
 * Temporary bridge for current Plan UI screens.
 *
 * - Runs the canonical optimizer entry point for the new system contract
 * - Returns legacy plan artifacts so existing cards/view-models can stay unchanged
 */
export function optimizeForLegacyPlanUi(input: OptimizerInput): LegacyPlanUiResult {
  const optimizerOutput = optimize(input);
  const valueLedger = buildCanonicalValueLedger({
    optimizationMode: input.constraints.mode,
    optimizerOutput,
    forecasts: input.forecasts,
    tariffSchedule: input.tariffSchedule,
  });
  void buildCanonicalPlan(input);
  const plan = buildEmptyLegacyPlan();
  const summary = buildDefaultLegacySummary(optimizerOutput, valueLedger);
  const gridlySummary = buildDefaultAveumSummary(optimizerOutput, valueLedger);

  return {
    optimizerOutput,
    plan,
    summary,
    gridlySummary,
  };
}