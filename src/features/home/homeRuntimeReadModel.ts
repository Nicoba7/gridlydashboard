import type { OptimizerOutput, PlanningConfidenceLevel } from "../../domain";
import type { CycleHeartbeatEntry } from "../../journal/executionJournal";

export interface HomeRuntimeReadModel {
  // Planning-runtime posture truth (from canonical optimizer output).
  currentDecisionReason: string;
  planningConfidenceLevel?: PlanningConfidenceLevel;
  conservativeAdjustmentApplied?: boolean;
  conservativeAdjustmentReason?: string;

  // Cycle-heartbeat truth (from canonical journal projection).
  nextCycleExecutionCaution?: CycleHeartbeatEntry["nextCycleExecutionCaution"];
  householdObjectiveConfidence?: CycleHeartbeatEntry["householdObjectiveConfidence"];
}

function toPlanningConfidenceLabel(level: PlanningConfidenceLevel): "High" | "Medium" | "Low" {
  if (level === "high") return "High";
  if (level === "medium") return "Medium";
  return "Low";
}

export function buildHomeRuntimeReadModel(input: {
  optimizerOutput: OptimizerOutput;
  latestCycleHeartbeat?: CycleHeartbeatEntry;
}): HomeRuntimeReadModel & { planningConfidenceLabel?: "High" | "Medium" | "Low" } {
  const planningConfidenceLevel = input.optimizerOutput.planningConfidenceLevel;

  return {
    currentDecisionReason: input.optimizerOutput.decisions[0]?.reason ?? input.optimizerOutput.headline,
    planningConfidenceLevel,
    planningConfidenceLabel: planningConfidenceLevel
      ? toPlanningConfidenceLabel(planningConfidenceLevel)
      : undefined,
    conservativeAdjustmentApplied: input.optimizerOutput.conservativeAdjustmentApplied,
    conservativeAdjustmentReason: input.optimizerOutput.conservativeAdjustmentReason,
    nextCycleExecutionCaution: input.latestCycleHeartbeat?.nextCycleExecutionCaution,
    householdObjectiveConfidence: input.latestCycleHeartbeat?.householdObjectiveConfidence,
  };
}