import type { ExecutionCycleFinancialContext } from "../../../journal/executionJournal";
import {
  evaluateEconomicActionPreference,
  scoreEconomicActionCandidate,
  type EconomicActionCandidate,
} from "../evaluateEconomicActionPreference";
import type {
  CommandExecutionResult,
  ExecutionEconomicArbitrationTrace,
} from "../types";
import type {
  EconomicArbitrationSelection,
  EconomicPrerejection,
  EligibleOpportunity,
  ExecutionEdgeContext,
  OpportunityReasonCode,
  RejectedOpportunity,
} from "../pipelineTypes";

/**
 * Resolves economic contention only among eligible opportunities for the same device.
 *
 * Owns: device-local economic ranking and prerejection trace creation.
 *
 * Must not: re-run eligibility checks, make household-wide decisions, or dispatch adapters.
 *
 * Outputs canonical prerejections plus selected economic traces for downstream stages.
 */
export function arbitrateDeviceOpportunities(
  opportunities: EligibleOpportunity[],
  financialContext: ExecutionCycleFinancialContext,
): EconomicArbitrationSelection {
  const prerejections = new Map<string, EconomicPrerejection>();
  const selectedTraces = new Map<string, ExecutionEconomicArbitrationTrace>();

  const byDevice = new Map<string, EligibleOpportunity[]>();
  for (const opportunity of opportunities) {
    const targetDeviceId = opportunity.targetDeviceId;
    if (!targetDeviceId) {
      continue;
    }

    const group = byDevice.get(targetDeviceId) ?? [];
    group.push(opportunity);
    byDevice.set(targetDeviceId, group);
  }

  for (const deviceOpportunities of byDevice.values()) {
    if (deviceOpportunities.length <= 1) {
      continue;
    }

    const candidates: EconomicActionCandidate[] = deviceOpportunities
      .map((opportunity) => opportunity.economicCandidate)
      .filter((candidate): candidate is EconomicActionCandidate => candidate !== undefined);

    if (candidates.length <= 1) {
      continue;
    }

    const preference = evaluateEconomicActionPreference(candidates, {
      planningConfidenceLevel: financialContext.planningConfidenceLevel,
      optimizationMode: financialContext.optimizationMode,
    });

    if (!preference) {
      continue;
    }

    const selectedCandidate = candidates.find(
      (candidate) => candidate.opportunityId === preference.preferredOpportunityId,
    );

    if (!selectedCandidate) {
      continue;
    }

    selectedTraces.set(selectedCandidate.opportunityId, {
      comparisonScope: "device",
      selectedOpportunityId: selectedCandidate.opportunityId,
      selectedExecutionRequestId: selectedCandidate.executionRequestId,
      selectedDecisionId: selectedCandidate.decisionId,
      selectedTargetDeviceId: selectedCandidate.targetDeviceId,
      selectedAction: selectedCandidate.action,
      selectedScorePencePerKwh: preference.selectionScore,
      selectionReason: preference.selectionReason,
      alternativesConsidered: preference.alternativesConsidered,
    });

    for (const rejection of preference.rejections) {
      const rejectedCandidate = candidates.find(
        (candidate) => candidate.opportunityId === rejection.opportunityId,
      );
      const prerejectionKey = rejectedCandidate?.opportunityId ?? rejection.opportunityId;
      if (!prerejectionKey) {
        continue;
      }

      prerejections.set(prerejectionKey, {
        reasonCodes: ["INFERIOR_ECONOMIC_VALUE"],
        economicArbitration: {
          comparisonScope: "device",
          selectedOpportunityId: selectedCandidate.opportunityId,
          selectedExecutionRequestId: selectedCandidate.executionRequestId,
          selectedDecisionId: selectedCandidate.decisionId,
          selectedTargetDeviceId: selectedCandidate.targetDeviceId,
          selectedAction: selectedCandidate.action,
          selectedScorePencePerKwh: preference.selectionScore,
          candidateScorePencePerKwh: rejectedCandidate
            ? scoreEconomicActionCandidate(rejectedCandidate)
            : undefined,
          scoreDeltaPencePerKwh: rejection.inferiorByPencePerKwh,
          selectionReason: preference.selectionReason,
          comparisonReason: rejection.selectionReason,
          alternativesConsidered: preference.alternativesConsidered,
        },
      });
    }
  }

  return { prerejections, selectedTraces };
}

export interface DeviceArbitrationPrerejectionMapping {
  /** Canonical device-arbitration rejections. */
  rejected: RejectedOpportunity[];
  /** Transitional edge payload for request-centric adapter/journal/store compatibility. */
  compatibilityOutcomes: CommandExecutionResult[];
}

/**
 * Compatibility mapper owned by device arbitration stage.
 *
 * Keeps prerejection shaping out of the controller while preserving existing
 * request-centric edge payloads. These outcomes are not canonical runtime objects.
 */
export function mapDeviceArbitrationPrerejections(
  prerejections: Map<string, EconomicPrerejection>,
  edgeContextLookup: Map<string, ExecutionEdgeContext>,
): DeviceArbitrationPrerejectionMapping {
  const rejected: RejectedOpportunity[] = [];
  const compatibilityOutcomes: CommandExecutionResult[] = [];

  prerejections.forEach((prerejection, opportunityId) => {
    const context = edgeContextLookup.get(opportunityId);
    if (!context) {
      return;
    }

    const reasonCodes = prerejection.reasonCodes as OpportunityReasonCode[];
    rejected.push({
      opportunityId: context.opportunityId,
      decisionId: context.decisionId,
      targetDeviceId: context.targetDeviceId,
      stage: "device_arbitration",
      reasonCodes,
      decisionReason: "Command denied by canonical execution policy.",
      economicArbitration: prerejection.economicArbitration,
    });

    compatibilityOutcomes.push({
      opportunityId: context.opportunityId,
      executionRequestId: context.executionRequestId,
      requestId: context.executionRequestId,
      idempotencyKey: context.idempotencyKey,
      decisionId: context.decisionId,
      targetDeviceId: context.targetDeviceId,
      commandId: context.commandId,
      deviceId: context.targetDeviceId,
      status: "skipped",
      message: "Command denied by canonical execution policy.",
      errorCode: reasonCodes[0],
      reasonCodes,
      economicArbitration: prerejection.economicArbitration,
    });
  });

  return { rejected, compatibilityOutcomes };
}