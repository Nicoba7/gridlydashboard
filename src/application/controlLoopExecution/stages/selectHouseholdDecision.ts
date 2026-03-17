import type { ExecutionCycleFinancialContext } from "../../../journal/executionJournal";
import { evaluateHouseholdEconomicOpportunity } from "../evaluateHouseholdEconomicOpportunity";
import type { EconomicActionCandidate } from "../evaluateEconomicActionPreference";
import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  ExecutionEconomicArbitrationTrace,
} from "../types";
import type {
  EconomicArbitrationSelection,
  EconomicPrerejection,
  EligibleOpportunity,
  OpportunityReasonCode,
  RejectedOpportunity,
} from "../pipelineTypes";

/**
 * Selects the single household-level economic winner from already eligible,
 * device-arbitrated opportunities.
 *
 * Owns: cross-asset economic comparison and household-level prerejection traces.
 *
 * Must not: revisit eligibility, dispatch adapters, or invent new opportunities.
 */
export function selectHouseholdDecision(
  opportunities: EligibleOpportunity[],
  financialContext: ExecutionCycleFinancialContext,
): EconomicArbitrationSelection {
  const prerejections = new Map<string, EconomicPrerejection>();
  const selectedTraces = new Map<string, ExecutionEconomicArbitrationTrace>();

  const candidates: EconomicActionCandidate[] = opportunities
    .map((opportunity) => opportunity.economicCandidate)
    .filter((candidate): candidate is EconomicActionCandidate => candidate !== undefined);

  const arbitration = evaluateHouseholdEconomicOpportunity(candidates, {
    planningConfidenceLevel: financialContext.planningConfidenceLevel,
    optimizationMode: financialContext.optimizationMode,
  });

  if (!arbitration) {
    return { prerejections, selectedTraces };
  }

  const selectedCandidate = candidates.find(
    (candidate) => candidate.executionRequestId === arbitration.preferredRequestId,
  );

  if (!selectedCandidate) {
    return { prerejections, selectedTraces };
  }

  selectedTraces.set(selectedCandidate.executionRequestId, {
    comparisonScope: "household",
    selectedOpportunityId: selectedCandidate.opportunityId,
    selectedExecutionRequestId: selectedCandidate.executionRequestId,
    selectedDecisionId: selectedCandidate.decisionId,
    selectedTargetDeviceId: selectedCandidate.targetDeviceId,
    selectedAction: selectedCandidate.action,
    selectedScorePencePerKwh: arbitration.selectionScore,
    selectionReason: arbitration.selectionReason,
    alternativesConsidered: arbitration.alternativesConsidered,
  });

  arbitration.rejections.forEach((rejection) => {
    prerejections.set(rejection.executionRequestId, {
      reasonCodes: ["INFERIOR_HOUSEHOLD_ECONOMIC_VALUE"],
      economicArbitration: {
        comparisonScope: "household",
        selectedOpportunityId: selectedCandidate.opportunityId,
        selectedExecutionRequestId: selectedCandidate.executionRequestId,
        selectedDecisionId: selectedCandidate.decisionId,
        selectedTargetDeviceId: selectedCandidate.targetDeviceId,
        selectedAction: selectedCandidate.action,
        selectedScorePencePerKwh: arbitration.selectionScore,
        candidateScorePencePerKwh: rejection.candidateScore,
        scoreDeltaPencePerKwh: rejection.inferiorByPencePerKwh,
        selectionReason: arbitration.selectionReason,
        comparisonReason: rejection.selectionReason,
        alternativesConsidered: arbitration.alternativesConsidered,
      },
    });
  });

  return { prerejections, selectedTraces };
}

export interface HouseholdDecisionPrerejectionMapping {
  /** Canonical household-decision rejections. */
  rejected: RejectedOpportunity[];
  /** Transitional edge payload for request-centric adapter/journal/store compatibility. */
  compatibilityOutcomes: CommandExecutionResult[];
}

/**
 * Compatibility mapper owned by household decision stage.
 *
 * Keeps prerejection shaping out of the controller while preserving existing
 * request-centric edge payloads. These outcomes are not canonical runtime objects.
 */
export function mapHouseholdDecisionPrerejections(
  prerejections: Map<string, EconomicPrerejection>,
  requestLookup: Map<string, CommandExecutionRequest>,
): HouseholdDecisionPrerejectionMapping {
  const rejected: RejectedOpportunity[] = [];
  const compatibilityOutcomes: CommandExecutionResult[] = [];

  prerejections.forEach((prerejection, executionRequestId) => {
    const request = requestLookup.get(executionRequestId);
    if (!request) {
      return;
    }

    const reasonCodes = prerejection.reasonCodes as OpportunityReasonCode[];
    rejected.push({
      opportunityId: request.opportunityId ?? request.executionRequestId,
      decisionId: request.decisionId,
      targetDeviceId: request.targetDeviceId,
      stage: "household_decision",
      reasonCodes,
      decisionReason: "Command denied by canonical execution policy.",
      economicArbitration: prerejection.economicArbitration,
    });

    compatibilityOutcomes.push({
      opportunityId: request.opportunityId,
      executionRequestId: request.executionRequestId,
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      decisionId: request.decisionId,
      targetDeviceId: request.targetDeviceId,
      commandId: request.commandId,
      deviceId: request.targetDeviceId,
      status: "skipped",
      message: "Command denied by canonical execution policy.",
      errorCode: reasonCodes[0],
      reasonCodes,
      economicArbitration: prerejection.economicArbitration,
    });
  });

  return { rejected, compatibilityOutcomes };
}