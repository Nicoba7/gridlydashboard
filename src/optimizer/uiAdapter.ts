import type { GridlyPlanSummary, PlanSummary, PlanWithSessions } from "../types/planCompat";
import type { OptimizerInput, OptimizerOutput } from "../domain";
import { optimize } from "./engine";
import { buildCanonicalPlan } from "./planBuilder";

export interface LegacyPlanUiResult {
  optimizerOutput: OptimizerOutput;
  plan: PlanWithSessions;
  summary: PlanSummary;
  gridlySummary: GridlyPlanSummary;
}

function buildEmptyLegacyPlan(): PlanWithSessions {
  const plan = [] as PlanWithSessions;
  plan.sessions = [];
  return plan;
}

function buildDefaultLegacySummary(optimizerOutput: OptimizerOutput): PlanSummary {
  // TODO: remove once optimizer output fully covers this
  return {
    projectedEarnings: Number((optimizerOutput.summary.expectedExportRevenuePence / 100).toFixed(2)),
    projectedSavings: Number((Math.max(0, optimizerOutput.summary.expectedNetValuePence) / 100).toFixed(2)),
    cheapestSlot: "--:--",
    cheapestPrice: 0,
    peakSlot: "--:--",
    peakPrice: 0,
    mode: "BALANCED",
    batteryReserveTargetPct: 30,
    batteryReserveStartPct: 30,
    batteryCyclesPlanned: Math.max(0, Math.round(optimizerOutput.summary.expectedBatteryCycles ?? 0)),
    evSlotsPlanned: 0,
    estimatedImportSpend: Number((optimizerOutput.summary.expectedImportCostPence / 100).toFixed(2)),
    estimatedExportRevenue: Number((optimizerOutput.summary.expectedExportRevenuePence / 100).toFixed(2)),
    rationale: [optimizerOutput.headline],
  };
}

function buildDefaultGridlySummary(optimizerOutput: OptimizerOutput): GridlyPlanSummary {
  // TODO: remove once optimizer output fully covers this
  return {
    planHeadline: optimizerOutput.headline,
    keyOutcomes: [optimizerOutput.headline],
    intent: "avoid_peak_import",
    customerReason: optimizerOutput.headline,
    estimatedValue: Number((optimizerOutput.summary.expectedNetValuePence / 100).toFixed(2)),
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
  void buildCanonicalPlan(input);
  const plan = buildEmptyLegacyPlan();
  const summary = buildDefaultLegacySummary(optimizerOutput);
  const gridlySummary = buildDefaultGridlySummary(optimizerOutput);

  return {
    optimizerOutput,
    plan,
    summary,
    gridlySummary,
  };
}