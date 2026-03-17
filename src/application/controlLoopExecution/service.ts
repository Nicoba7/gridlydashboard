import type { ControlLoopInput, ControlLoopResult } from "../../controlLoop/controlLoop";
import { runControlLoop } from "../../controlLoop/controlLoop";
import type { OptimizerOpportunity } from "../../domain/optimizer";
import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  DeviceCommandExecutor,
  ExecutionEconomicArbitrationTrace,
} from "./types";
import { mapToCanonicalDeviceCommand } from "./canonicalCommand";
import { buildCommandExecutionIdentity, matchDecisionForCommand } from "./identity";
import type { DeviceCapabilitiesProvider } from "../../capabilities/deviceCapabilitiesProvider";
import type { DeviceShadowStore } from "../../shadow/deviceShadowStore";
import { projectExecutionToDeviceShadow } from "./projectExecutionToDeviceShadow";
import type { ExecutionJournalStore } from "../../journal/executionJournalStore";
import type {
  ExecutionCycleDecisionSummary,
  ExecutionCycleFinancialContext,
} from "../../journal/executionJournal";
import type {
  RuntimeExecutionMode,
  RuntimeExecutionPosture,
  RuntimeExecutionGuardrailContext,
} from "./executionPolicyTypes";
import { projectExecutionOutcome } from "./projectExecutionOutcome";
import { classifyRuntimeExecutionPosture } from "./classifyRuntimeExecutionPosture";
import type { EconomicPrerejection, RejectedOpportunity } from "./pipelineTypes";
import { buildExecutionEdgeContextsFromRequests } from "./edge/buildExecutionRequestsFromPlan";
import { adaptLegacyExecutionRequests } from "./edge/legacyExecutionCompatibilityAdapter";
import {
  evaluateOpportunityEligibility,
} from "./stages/evaluateOpportunityEligibility";
import {
  arbitrateDeviceOpportunities,
  mapDeviceArbitrationPrerejections,
} from "./stages/arbitrateDeviceOpportunities";
import {
  mapHouseholdDecisionPrerejections,
  selectHouseholdDecision,
} from "./stages/selectHouseholdDecision";
import { buildExecutionPlan } from "./stages/buildExecutionPlan";
import { executePlan } from "./stages/executePlan";
import { projectJournal } from "./stages/projectJournal";

export interface ControlLoopExecutionServiceResult {
  controlLoopResult: ControlLoopResult;
  executionResults: CommandExecutionResult[];
  executionPosture: RuntimeExecutionPosture;
}

/** Persists already-projected journal payloads; schema shaping stays outside the store. */
function persistJournalProjection(
  journalStore: ExecutionJournalStore | undefined,
  projection: ReturnType<typeof projectJournal>,
): void {
  if (!journalStore) {
    return;
  }

  projection.journalEntries.forEach((entry) => {
    journalStore.append(entry);
  });

  journalStore.appendHeartbeat(projection.cycleHeartbeat);
}

/**
 * Controller-local helper to keep stage rejection accumulation order explicit.
 * No business rules belong here; stages own rejection semantics.
 */
function appendStageAccumulation(
  rejectedAccumulator: RejectedOpportunity[],
  compatibilityAccumulator: CommandExecutionResult[],
  stage: {
    rejected: RejectedOpportunity[];
    compatibilityOutcomes: CommandExecutionResult[];
  },
): void {
  rejectedAccumulator.push(...stage.rejected);
  compatibilityAccumulator.push(...stage.compatibilityOutcomes);
}

function buildCycleDecisionSummaries(controlLoopResult: ControlLoopResult): ExecutionCycleDecisionSummary[] {
  return controlLoopResult.activeDecisions.map((decision) => ({
    decisionId: decision.decisionId,
    action: decision.action,
    targetDeviceIds: [...decision.targetDeviceIds],
    marginalImportAvoidance: decision.marginalImportAvoidancePencePerKwh,
    marginalExportValue: decision.marginalExportValuePencePerKwh,
    grossStoredEnergyValue: decision.grossStoredEnergyValuePencePerKwh,
    netStoredEnergyValue: decision.netStoredEnergyValuePencePerKwh,
    batteryDegradationCost: decision.batteryDegradationCostPencePerKwh,
    effectiveStoredEnergyValue: decision.effectiveStoredEnergyValuePencePerKwh,
    planningConfidenceLevel: decision.planningConfidenceLevel,
    conservativeAdjustmentApplied: decision.conservativeAdjustmentApplied,
    conservativeAdjustmentReason: decision.conservativeAdjustmentReason,
    decisionReason: decision.reason,
  }));
}

function mapRequests(input: ControlLoopInput, result: ControlLoopResult): CommandExecutionRequest[] {
  if (result.activeOpportunities.length > 0) {
    return result.activeOpportunities.map((opportunity) =>
      mapOpportunityToRequest(input, result, opportunity),
    );
  }

  return result.commandsToIssue.map((command) => {
    const canonicalCommand = mapToCanonicalDeviceCommand(command);
    const matchedDecision = matchDecisionForCommand(canonicalCommand, result.activeDecisions);
    const identity = buildCommandExecutionIdentity(input.optimizerOutput.planId, canonicalCommand, matchedDecision);

    return {
      opportunityId: identity.opportunityId,
      opportunityProvenance: identity.opportunityId
        ? {
            kind: "native_canonical",
            canonicalizedFromLegacy: false,
          }
        : undefined,
      executionRequestId: identity.executionRequestId,
      requestId: identity.executionRequestId,
      idempotencyKey: identity.idempotencyKey,
      decisionId: identity.decisionId,
      targetDeviceId: identity.targetDeviceId,
      planId: input.optimizerOutput.planId,
      requestedAt: input.now,
      commandId: command.commandId,
      canonicalCommand,
    };
  });
}

function mapOpportunityToRequest(
  input: ControlLoopInput,
  result: ControlLoopResult,
  opportunity: OptimizerOpportunity,
): CommandExecutionRequest {
  const canonicalCommand = mapToCanonicalDeviceCommand(opportunity.command);
  const matchedDecision = opportunity.decisionId
    ? result.activeDecisions.find((decision) => decision.decisionId === opportunity.decisionId)
    : matchDecisionForCommand(canonicalCommand, result.activeDecisions);
  const identity = buildCommandExecutionIdentity(
    input.optimizerOutput.planId,
    canonicalCommand,
    matchedDecision,
    opportunity.opportunityId,
  );

  return {
    opportunityId: opportunity.opportunityId,
    opportunityProvenance: {
      kind: "native_canonical",
      canonicalizedFromLegacy: false,
    },
    executionRequestId: identity.executionRequestId,
    requestId: identity.executionRequestId,
    idempotencyKey: identity.idempotencyKey,
    decisionId: identity.decisionId,
    targetDeviceId: identity.targetDeviceId,
    planId: input.optimizerOutput.planId,
    requestedAt: input.now,
    commandId: opportunity.command.commandId,
    canonicalCommand,
  };
}

/**
 * Thin pipeline controller between canonical planning/control and adapter execution.
 *
 * This function orchestrates stage invocation, accumulation, persistence, and
 * shadow updates. It must not introduce economic reasoning or stage-local policy.
 * See docs/architecture/execution-architecture.md for the wider execution boundary.
 */
export async function runControlLoopExecutionService(
  input: ControlLoopInput,
  executor: DeviceCommandExecutor,
  capabilitiesProvider?: DeviceCapabilitiesProvider,
  shadowStore?: DeviceShadowStore,
  journalStore?: ExecutionJournalStore,
  cycleFinancialContext?: Omit<ExecutionCycleFinancialContext, "decisionsTaken">,
  runtimeGuardrailContext?: RuntimeExecutionGuardrailContext,
  runtimeExecutionMode: RuntimeExecutionMode = "standard",
  cycleHeartbeatMeta?: { cycleId?: string; replanReason?: string },
): Promise<ControlLoopExecutionServiceResult> {
  const controlLoopResult = runControlLoop(input);
  const missingRuntimeContextInStrictMode =
    runtimeExecutionMode === "continuous_live_strict" && !runtimeGuardrailContext;

  const postureClassification = missingRuntimeContextInStrictMode
    ? {
      posture: "hold_only" as const,
      reasonCodes: [
        "RUNTIME_CONSERVATIVE_MODE_ACTIVE" as const,
        "RUNTIME_CONTEXT_MISSING" as const,
      ],
      warning:
        "Runtime guardrail context missing in continuous live mode. Live dispatch suppressed.",
    }
    : classifyRuntimeExecutionPosture(runtimeGuardrailContext);

  const executionPosture = postureClassification.posture;
  const enrichedCycleFinancialContext = cycleFinancialContext
    ? {
      ...cycleFinancialContext,
      decisionsTaken: buildCycleDecisionSummaries(controlLoopResult),
      runtimeExecutionPosture: executionPosture,
      runtimeExecutionReasonCodes: postureClassification.reasonCodes,
      runtimeExecutionWarning: postureClassification.warning,
    }
    : undefined;

  const requests = adaptLegacyExecutionRequests(mapRequests(input, controlLoopResult));
  const executionEdgeContexts = buildExecutionEdgeContextsFromRequests(requests);
  const contextByExecutionRequestId = new Map(
    executionEdgeContexts.map((context) => [context.executionRequestId, context]),
  );
  const contextByOpportunityId = new Map(
    executionEdgeContexts.map((context) => [context.opportunityId, context]),
  );

  if (requests.length === 0) {
    const journalProjection = projectJournal({
      executionEdgeContexts,
      outcomes: [],
      recordedAt: input.now,
      executionPosture,
      runtimeGuardrailContext,
      failClosedTriggered: missingRuntimeContextInStrictMode,
      cycleHeartbeatMeta,
      cycleFinancialContext: enrichedCycleFinancialContext,
      rejectedOpportunities: [],
      legacyCompatibilityOutcomes: [],
    });
    persistJournalProjection(journalStore, journalProjection);

    return {
      controlLoopResult,
      executionResults: [],
      executionPosture,
    };
  }

  const eligibilityEvaluation = evaluateOpportunityEligibility({
    requests,
    input,
    controlLoopResult,
    capabilitiesProvider,
    shadowStore,
    runtimeGuardrailContext,
    executionPosture,
    postureClassification,
    missingRuntimeContextInStrictMode,
    cycleFinancialContext: enrichedCycleFinancialContext,
  });
  const eligibleOpportunities = eligibilityEvaluation.eligible;
  // Ordering invariant for accumulation: eligibility -> device -> household -> planning.
  // This ordering is intentionally preserved for downstream compatibility/journal pathways.
  const rejectedOpportunities: RejectedOpportunity[] = [...eligibilityEvaluation.rejected];
  const policyDenials: CommandExecutionResult[] = [...eligibilityEvaluation.compatibilityOutcomes];

  const deviceEconomicArbitration = enrichedCycleFinancialContext
    ? arbitrateDeviceOpportunities(eligibleOpportunities, enrichedCycleFinancialContext)
    : {
        prerejections: new Map<string, EconomicPrerejection>(),
        selectedTraces: new Map<string, ExecutionEconomicArbitrationTrace>(),
      };

  const postDeviceEligibleOpportunities = eligibleOpportunities.filter(
    (opportunity) => !deviceEconomicArbitration.prerejections.has(opportunity.opportunityId),
  );

  const householdEconomicArbitration = enrichedCycleFinancialContext
    ? selectHouseholdDecision(postDeviceEligibleOpportunities, enrichedCycleFinancialContext)
    : {
        prerejections: new Map<string, EconomicPrerejection>(),
        selectedTraces: new Map<string, ExecutionEconomicArbitrationTrace>(),
      };

  const deviceArbitrationMapping = mapDeviceArbitrationPrerejections(
    deviceEconomicArbitration.prerejections,
    contextByOpportunityId,
  );
  appendStageAccumulation(rejectedOpportunities, policyDenials, deviceArbitrationMapping);

  const householdDecisionMapping = mapHouseholdDecisionPrerejections(
    householdEconomicArbitration.prerejections,
    contextByOpportunityId,
  );
  appendStageAccumulation(rejectedOpportunities, policyDenials, householdDecisionMapping);

  const selectedEconomicTraces = new Map<string, ExecutionEconomicArbitrationTrace>([
    ...deviceEconomicArbitration.selectedTraces,
    ...householdEconomicArbitration.selectedTraces,
  ]);

  const finalEligibleOpportunities = postDeviceEligibleOpportunities.filter(
    (opportunity) => !householdEconomicArbitration.prerejections.has(opportunity.opportunityId),
  );

  const executionPlanStage = buildExecutionPlan({
    opportunities: finalEligibleOpportunities,
    input,
    controlLoopResult,
  });
  appendStageAccumulation(rejectedOpportunities, policyDenials, executionPlanStage);

  const executedPlan = await executePlan({
    plan: executionPlanStage.plan,
    dispatchableOpportunities: executionPlanStage.dispatchableOpportunities,
    executor,
    preExecutionOutcomes: policyDenials,
    selectedEconomicTraces,
    executionPosture,
    rejectedOpportunities,
  });

  const journalProjection = projectJournal({
    executionEdgeContexts,
    outcomes: executedPlan.outcomes,
    recordedAt: input.now,
    executionPosture,
    runtimeGuardrailContext,
    failClosedTriggered: missingRuntimeContextInStrictMode,
    cycleHeartbeatMeta,
    cycleFinancialContext: enrichedCycleFinancialContext,
    executionPlan: executionPlanStage.plan,
    executionResult: executedPlan.execution,
    rejectedOpportunities: executedPlan.execution.rejectedOpportunities,
    legacyCompatibilityOutcomes: policyDenials,
  });
  persistJournalProjection(journalStore, journalProjection);

  if (shadowStore) {
    const contextByExecutionId = new Map(
      executedPlan.executionEdgeContexts.map((context) => [context.executionRequestId, context]),
    );

    executedPlan.adapterResults.forEach((result) => {
      const context = contextByExecutionId.get(result.executionRequestId)
        ?? contextByExecutionRequestId.get(result.executionRequestId);
      if (!context) {
        return;
      }

      const outcomeProjection = projectExecutionOutcome(result, context.canonicalCommand);
      if (!outcomeProjection.shouldUpdateShadow) {
        return;
      }

      const existing = shadowStore.getDeviceState(context.targetDeviceId);
      const projected = projectExecutionToDeviceShadow(
        existing,
        context.canonicalCommand,
        result,
        input.now,
      );

      if (projected) {
        shadowStore.setDeviceState(context.targetDeviceId, projected);
      }
    });
  }

  return {
    controlLoopResult,
    executionResults: executedPlan.outcomes,
    executionPosture,
  };
}
