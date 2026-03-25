import type { OptimizerAction, OptimizationMode, PlanningConfidenceLevel } from "../../domain/optimizer";
import type { CanonicalDeviceCommand } from "./canonicalCommand";

/**
 * A candidate command competing for execution on a single device slot.
 *
 * Economic scores are sourced from the matched OptimizerDecision in the
 * canonical cycle financial context. All values are in pence per kWh.
 */
export interface EconomicActionCandidate {
  opportunityId: string;
  /** Transitional compatibility metadata for execution-edge joins only. */
  executionRequestId?: string;
  decisionId?: string;
  targetDeviceId: string;
  /** Resolved optimizer action for this candidate. Undefined when unmatched. */
  action?: OptimizerAction;
  command: CanonicalDeviceCommand;
  /** Effective stored-energy value after degradation cost (primary score). */
  effectiveStoredEnergyValue?: number;
  /** Net stored-energy value before degradation weighting (secondary score). */
  netStoredEnergyValue?: number;
  /** Marginal import-avoidance value (tertiary score). */
  marginalImportAvoidance?: number;
  /** Marginal export-opportunity value (informational). */
  marginalExportValue?: number;
}

export type EconomicPreferenceReasonCode =
  | "INFERIOR_ECONOMIC_VALUE"
  | "ECONOMIC_PREFERENCE_TIE_BROKEN";

export interface EconomicActionRejection {
  opportunityId: string;
  /** Transitional compatibility metadata for execution-edge joins only. */
  executionRequestId?: string;
  reasonCode: EconomicPreferenceReasonCode;
  /** By how many p/kWh the selected candidate is economically superior. */
  inferiorByPencePerKwh?: number;
  /** Human-readable explanation of why this candidate was not selected. */
  selectionReason: string;
}

export interface EconomicActionPreferenceResult {
  preferredOpportunityId: string;
  /** Transitional compatibility metadata for execution-edge joins only. */
  preferredRequestId?: string;
  rejections: EconomicActionRejection[];
  /** Economic score of the selected candidate, in p/kWh. */
  selectionScore: number;
  /** Human-readable explanation of the selection decision. */
  selectionReason: string;
  /**
   * True when low planning confidence forced a conservative fallback selection
   * rather than a purely economic one.
   */
  isFallback: boolean;
  alternativesConsidered: number;
}

export interface EconomicPreferenceContext {
  planningConfidenceLevel?: PlanningConfidenceLevel;
  optimizationMode?: OptimizationMode;
}

/**
 * Returns the primary economic score for a candidate.
 *
 * Priority: effectiveStoredEnergyValue → netStoredEnergyValue → marginalImportAvoidance.
 * All values in pence per kWh. Returns 0 when no data is present.
 */
export function scoreEconomicActionCandidate(candidate: EconomicActionCandidate): number {
  if (candidate.effectiveStoredEnergyValue !== undefined) {
    return candidate.effectiveStoredEnergyValue;
  }
  if (candidate.netStoredEnergyValue !== undefined) {
    return candidate.netStoredEnergyValue;
  }
  if (candidate.marginalImportAvoidance !== undefined) {
    return candidate.marginalImportAvoidance;
  }
  if (candidate.marginalExportValue !== undefined) {
    return candidate.marginalExportValue;
  }
  return 0;
}

export function hasEconomicSignal(candidate: EconomicActionCandidate): boolean {
  return (
    candidate.effectiveStoredEnergyValue !== undefined ||
    candidate.netStoredEnergyValue !== undefined ||
    candidate.marginalImportAvoidance !== undefined ||
    candidate.marginalExportValue !== undefined
  );
}

export function isHoldLikeEconomicAction(action?: OptimizerAction): boolean {
  return action === "hold" || action === undefined;
}

/**
 * Pure economic action preference evaluator.
 *
 * Selects the economically preferred candidate from a set of valid alternatives
 * targeting the same device slot. Returns `null` when no selection is needed
 * (0 or 1 candidates, or no economic data available).
 *
 * When planning confidence is low, falls back to the safest (hold-like) option
 * instead of the highest-value one, preserving Aveum's conservative-first
 * dispatch behaviour under uncertain financial inputs.
 *
 * This function is hardware-agnostic. It depends only on canonical economic
 * values from the optimizer decision record, never on integration-specific data.
 */
export function evaluateEconomicActionPreference(
  candidates: EconomicActionCandidate[],
  context: EconomicPreferenceContext,
): EconomicActionPreferenceResult | null {
  if (candidates.length <= 1) {
    return null;
  }

  // Only engage when at least one candidate carries meaningful economic data.
  // When no data is available, let the existing conflict-detection policy handle ordering.
  const hasEconomicData = candidates.some(
    (c) => hasEconomicSignal(c),
  );

  if (!hasEconomicData) {
    return null;
  }

  // Under low planning confidence, prefer the safest (hold-like) action to
  // avoid dispatching aggressive commands whose economic case is uncertain.
  if (context.planningConfidenceLevel === "low") {
    const safest = candidates.find((c) => isHoldLikeEconomicAction(c.action)) ?? candidates[0];

    const rejections = candidates
      .filter((c) => c.opportunityId !== safest.opportunityId)
      .map((c): EconomicActionRejection => ({
        opportunityId: c.opportunityId,
        executionRequestId: c.executionRequestId,
        reasonCode: "INFERIOR_ECONOMIC_VALUE",
        selectionReason:
          "Low planning confidence: conservative action preferred over higher-nominal-value alternative.",
      }));

    return {
      preferredOpportunityId: safest.opportunityId,
      preferredRequestId: safest.executionRequestId,
      rejections,
      selectionScore: scoreEconomicActionCandidate(safest),
      selectionReason: "Low planning confidence: conservative fallback action selected.",
      isFallback: true,
      alternativesConsidered: candidates.length,
    };
  }

  // Normal confidence: score all candidates and select the highest-value one.
  // Deterministic tiebreak preserves the original evaluation order (optimizer
  // decision ordering is treated as the tiebreaker authority).
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreEconomicActionCandidate(candidate),
      originalIndex: candidates.indexOf(candidate),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.originalIndex - b.originalIndex;
    });

  const winner = scored[0];

  const rejections = scored.slice(1).map(({ candidate, score }): EconomicActionRejection => {
    const isTied = score === winner.score;
    return {
      opportunityId: candidate.opportunityId,
      executionRequestId: candidate.executionRequestId,
      reasonCode: isTied ? "ECONOMIC_PREFERENCE_TIE_BROKEN" : "INFERIOR_ECONOMIC_VALUE",
      inferiorByPencePerKwh: isTied ? undefined : winner.score - score,
      selectionReason: isTied
        ? `Equal economic value (${winner.score.toFixed(2)} p/kWh); earlier-evaluated candidate preferred by evaluation order.`
        : `Inferior economic value: ${score.toFixed(2)} p/kWh vs selected ${winner.score.toFixed(2)} p/kWh.`,
    };
  });

  const actionLabel = winner.candidate.action ?? winner.candidate.command.kind;
  const hasTie = scored.length > 1 && scored[1].score === winner.score;

  return {
    preferredOpportunityId: winner.candidate.opportunityId,
    preferredRequestId: winner.candidate.executionRequestId,
    rejections,
    selectionScore: winner.score,
    selectionReason: hasTie
      ? `Economically equivalent actions: ${actionLabel} retained by evaluation order.`
      : `Economically preferred action selected: ${actionLabel} with expected value ${winner.score.toFixed(2)} p/kWh.`,
    isFallback: false,
    alternativesConsidered: candidates.length,
  };
}
