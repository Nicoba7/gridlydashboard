import type { OptimizerAction } from "../../domain/optimizer";
import {
  hasEconomicSignal,
  scoreEconomicActionCandidate,
  type EconomicActionCandidate,
  type EconomicPreferenceContext,
} from "./evaluateEconomicActionPreference";

export interface HouseholdEconomicOpportunityRejection {
  opportunityId: string;
  /** Transitional compatibility metadata for execution-edge joins only. */
  executionRequestId?: string;
  candidateScore: number;
  inferiorByPencePerKwh?: number;
  selectionReason: string;
}

export interface HouseholdEconomicOpportunityResult {
  preferredOpportunityId: string;
  /** Transitional compatibility metadata for execution-edge joins only. */
  preferredRequestId?: string;
  selectionScore: number;
  selectionReason: string;
  alternativesConsidered: number;
  rejections: HouseholdEconomicOpportunityRejection[];
}

const HOUSEHOLD_VALUE_SEEKING_ACTIONS = new Set<OptimizerAction>([
  "charge_battery",
  "discharge_battery",
  "charge_ev",
  "export_to_grid",
]);

function isHouseholdValueSeekingAction(action?: OptimizerAction): boolean {
  return action !== undefined && HOUSEHOLD_VALUE_SEEKING_ACTIONS.has(action);
}

/**
 * Pure household-level economic arbitration.
 *
 * Compares already-canonical, economically meaningful opportunities across
 * different devices and selects the single highest-value household action.
 * Returns null when arbitration should abstain:
 * - fewer than two value-seeking candidates across distinct devices
 * - insufficient economic signals
 * - low planning confidence, allowing existing conservative guardrails to win
 */
export function evaluateHouseholdEconomicOpportunity(
  candidates: EconomicActionCandidate[],
  context: EconomicPreferenceContext,
): HouseholdEconomicOpportunityResult | null {
  if (context.planningConfidenceLevel === "low") {
    return null;
  }

  const meaningfulCandidates = candidates.filter(
    (candidate) => isHouseholdValueSeekingAction(candidate.action) && hasEconomicSignal(candidate),
  );

  if (meaningfulCandidates.length <= 1) {
    return null;
  }

  const distinctDeviceIds = new Set(meaningfulCandidates.map((candidate) => candidate.targetDeviceId));
  if (distinctDeviceIds.size <= 1) {
    return null;
  }

  const scored = meaningfulCandidates
    .map((candidate, originalIndex) => ({
      candidate,
      score: scoreEconomicActionCandidate(candidate),
      originalIndex,
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.originalIndex - right.originalIndex;
    });

  const winner = scored[0];

  return {
    preferredOpportunityId: winner.candidate.opportunityId,
    preferredRequestId: winner.candidate.executionRequestId,
    selectionScore: winner.score,
    selectionReason: `Highest-value household opportunity selected: ${winner.candidate.action} on ${winner.candidate.targetDeviceId} at ${winner.score.toFixed(2)} p/kWh.`,
    alternativesConsidered: scored.length,
    rejections: scored.slice(1).map(({ candidate, score }) => ({
      opportunityId: candidate.opportunityId,
      executionRequestId: candidate.executionRequestId,
      candidateScore: score,
      inferiorByPencePerKwh: winner.score === score ? undefined : winner.score - score,
      selectionReason:
        winner.score === score
          ? `Equal household value (${winner.score.toFixed(2)} p/kWh); earlier opportunity retained by deterministic evaluation order.`
          : `Inferior household economic value: ${score.toFixed(2)} p/kWh vs selected ${winner.score.toFixed(2)} p/kWh.`,
    })),
  };
}