import type { OptimizerAction, OptimizerDecision, OptimizerOutput } from "../domain";

export type IndexRecommendationAction = "charge" | "discharge" | "hold" | "import" | "export";

export interface IndexRecommendation {
  action: IndexRecommendationAction;
  reason: string;
}

export interface IndexUiViewModel {
  headline: string;
  subheadline: string;
  actionCount: number;
  confidenceLabel: "Low confidence" | "Moderate confidence" | "High confidence";
  savingsEstimate: number;
  currentRecommendation: IndexRecommendation;
  nextActions: IndexRecommendation[];
  trustMessage: string;
}

function toLegacyAction(action: OptimizerAction): IndexRecommendationAction {
  if (action === "charge_battery" || action === "charge_ev") return "charge";
  if (action === "export_to_grid") return "export";
  if (action === "discharge_battery" || action === "consume_solar") return "discharge";
  return "hold";
}

function toConfidenceLabel(score: number): "Low confidence" | "Moderate confidence" | "High confidence" {
  if (score < 0.4) return "Low confidence";
  if (score < 0.75) return "Moderate confidence";
  return "High confidence";
}

function mapDecision(decision: OptimizerDecision): IndexRecommendation {
  return {
    action: toLegacyAction(decision.action),
    reason: decision.reason,
  };
}

/**
 * Bridge canonical optimizer output to the existing Index page view model.
 */
export function buildIndexUiViewModel(output: OptimizerOutput): IndexUiViewModel {
  const currentDecision = output.decisions[0];
  const nextActions = output.decisions
    .slice(1)
    .filter((decision) => decision.action !== "hold")
    .slice(0, 2)
    .map(mapDecision);

  const currentRecommendation: IndexRecommendation = currentDecision
    ? mapDecision(currentDecision)
    : {
      action: "hold",
      reason: output.headline,
    };

  return {
    headline: output.headline,
    subheadline: currentRecommendation.reason,
    actionCount: output.decisions.length,
    confidenceLabel: toConfidenceLabel(output.confidence),
    savingsEstimate: Number(Math.max(0, output.summary.expectedNetValuePence / 100).toFixed(2)),
    currentRecommendation,
    nextActions,
    trustMessage: output.diagnostics[0]?.message ?? output.headline,
  };
}