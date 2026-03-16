import type { GridlyPlanSummary, PlanSummary, PlanWithSessions } from "../lib/gridlyPlan";
import type { OptimizerInput, OptimizerOutput } from "../domain";
import { optimize } from "./engine";
import { buildCanonicalPlan } from "./planBuilder";

export interface LegacyPlanUiResult {
  optimizerOutput: OptimizerOutput;
  plan: PlanWithSessions;
  summary: PlanSummary;
  gridlySummary: GridlyPlanSummary;
}

/**
 * Temporary bridge for current Plan UI screens.
 *
 * - Runs the canonical optimizer entry point for the new system contract
 * - Returns legacy plan artifacts so existing cards/view-models can stay unchanged
 */
export function optimizeForLegacyPlanUi(input: OptimizerInput): LegacyPlanUiResult {
  const optimizerOutput = optimize(input);
  const bridge = buildCanonicalPlan(input);

  return {
    optimizerOutput,
    plan: bridge.legacyPlan,
    summary: bridge.legacySummary,
    gridlySummary: bridge.legacyGridlySummary,
  };
}