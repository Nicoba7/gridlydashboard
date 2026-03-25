/**
 * Explanation helper entry point for Aveum.
 *
 * Intended purpose:
 * - translate optimization output into user-facing explanations
 * - centralize rationale text generation for consistency across features
 */

import type { Diagnostic, AveumOutput, Recommendation } from "../types";

export type PlanExplanation = {
  summary: string;
  shortReason?: string;
  recommendationCount: number;
  diagnostics: Diagnostic[];
  confidenceLabel?: string;
};

function toConfidenceLabel(confidence: number | undefined): string | undefined {
  if (confidence === undefined) {
    return undefined;
  }

  // Keep wording plain and predictable for clear UX messaging.
  if (confidence < 0.4) {
    return "Low confidence";
  }

  if (confidence < 0.75) {
    return "Moderate confidence";
  }

  return "High confidence";
}

export function explainPlan(output: AveumOutput): PlanExplanation {
  const firstRecommendation: Recommendation | undefined = output.recommendations[0];
  const summary =
    output.headline ??
    (firstRecommendation
      ? `Aveum generated ${output.recommendations.length} recommendation(s), starting with '${firstRecommendation.action}'.`
      : "Aveum did not generate recommendations for this plan yet.");

  return {
    summary,
    shortReason: firstRecommendation?.reason,
    recommendationCount: output.recommendations.length,
    diagnostics: output.diagnostics,
    confidenceLabel: toConfidenceLabel(output.confidence),
  };
}
