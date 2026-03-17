import type { ControlLoopInput, ControlLoopResult } from "../../../controlLoop/controlLoop";
import type { DeviceCapabilitiesProvider } from "../../../capabilities/deviceCapabilitiesProvider";
import type { DeviceShadowStore } from "../../../shadow/deviceShadowStore";
import type { ExecutionCycleFinancialContext } from "../../../journal/executionJournal";
import {
  validateCanonicalCommandAgainstCapabilities,
  type CanonicalCommandValidationReasonCode,
} from "../commandValidation";
import { reconcileCanonicalCommandWithShadow } from "../reconcileCanonicalCommandWithShadow";
import { evaluateExecutionPolicy } from "../evaluateExecutionPolicy";
import { evaluateRuntimeExecutionGuardrail } from "../evaluateRuntimeExecutionGuardrail";
import { classifyRuntimeExecutionPosture } from "../classifyRuntimeExecutionPosture";
import type {
  ExecutionPolicyReasonCode,
  RuntimeExecutionPosture,
  RuntimeExecutionGuardrailContext,
} from "../executionPolicyTypes";
import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  ExecutionEconomicArbitrationTrace,
} from "../types";
import type {
  EligibleOpportunity,
  OpportunityReasonCode,
  RejectedOpportunity,
} from "../pipelineTypes";
import type { EconomicActionCandidate } from "../evaluateEconomicActionPreference";
import { evaluateCanonicalExecutionEligibility } from "../executionAuthority";

function buildEconomicCandidate(
  request: CommandExecutionRequest,
  financialContext: ExecutionCycleFinancialContext,
): EconomicActionCandidate {
  const decision = request.decisionId
    ? financialContext.decisionsTaken.find((item) => item.decisionId === request.decisionId)
    : undefined;

  const authority = evaluateCanonicalExecutionEligibility(request);

  return {
    opportunityId: authority.canonicalOpportunityId ?? `${request.planId}:incomplete_identity:${request.commandId}`,
    executionRequestId: request.executionRequestId,
    decisionId: request.decisionId,
    targetDeviceId: request.targetDeviceId,
    action: decision?.action as EconomicActionCandidate["action"],
    command: request.canonicalCommand,
    effectiveStoredEnergyValue: decision?.effectiveStoredEnergyValue,
    netStoredEnergyValue: decision?.netStoredEnergyValue,
    marginalImportAvoidance: decision?.marginalImportAvoidance,
    marginalExportValue: decision?.marginalExportValue,
  };
}

function buildRejectedOpportunity(
  request: CommandExecutionRequest,
  stage: RejectedOpportunity["stage"],
  reasonCodes: OpportunityReasonCode[],
  decisionReason: string,
  economicArbitration?: ExecutionEconomicArbitrationTrace,
): RejectedOpportunity {
  const authority = evaluateCanonicalExecutionEligibility(request);

  return {
    opportunityId: authority.canonicalOpportunityId ?? `${request.planId}:incomplete_identity:${request.commandId}`,
    decisionId: request.decisionId,
    targetDeviceId: request.targetDeviceId,
    stage,
    reasonCodes,
    decisionReason,
    economicArbitration,
  };
}

export interface EvaluateOpportunityEligibilityInput {
  requests: CommandExecutionRequest[];
  input: ControlLoopInput;
  controlLoopResult: ControlLoopResult;
  capabilitiesProvider?: DeviceCapabilitiesProvider;
  shadowStore?: DeviceShadowStore;
  runtimeGuardrailContext?: RuntimeExecutionGuardrailContext;
  executionPosture: RuntimeExecutionPosture;
  postureClassification: ReturnType<typeof classifyRuntimeExecutionPosture> | {
    posture: "hold_only";
    reasonCodes: readonly ["RUNTIME_CONSERVATIVE_MODE_ACTIVE", "RUNTIME_CONTEXT_MISSING"];
    warning: string;
  };
  missingRuntimeContextInStrictMode: boolean;
  cycleFinancialContext?: ExecutionCycleFinancialContext;
}

export interface EvaluateOpportunityEligibilityOutput {
  /** Canonical opportunities that passed all eligibility checks. */
  eligible: EligibleOpportunity[];
  /** Canonical eligibility-stage rejections only. */
  rejected: RejectedOpportunity[];
  /** Transitional edge payload for request-centric adapter/journal/store compatibility. */
  compatibilityOutcomes: CommandExecutionResult[];
}

/**
 * Evaluates raw execution requests into canonical eligible/rejected opportunities.
 *
 * Owns: runtime guardrail checks, capability validation, shadow reconciliation,
 * and execution-policy gating.
 *
 * Must not: perform economic arbitration or adapter dispatch.
 *
 * Outputs:
 * - canonical eligible/rejected opportunity sets
 * - edge-only compatibility outcomes for current request-centric consumers
 */
export function evaluateOpportunityEligibility(
  params: EvaluateOpportunityEligibilityInput,
): EvaluateOpportunityEligibilityOutput {
  const eligible: EligibleOpportunity[] = [];
  const rejected: RejectedOpportunity[] = [];
  const compatibilityOutcomes: CommandExecutionResult[] = [];

  const pushRejected = (
    request: CommandExecutionRequest,
    reasonCodes: OpportunityReasonCode[],
    decisionReason: string,
    status: "failed" | "skipped",
    message: string,
    errorCode?: string,
    economicArbitration?: ExecutionEconomicArbitrationTrace,
  ) => {
    rejected.push(
      buildRejectedOpportunity(
        request,
        "eligibility",
        reasonCodes,
        decisionReason,
        economicArbitration,
      ),
    );
    compatibilityOutcomes.push({
      opportunityId: request.opportunityId,
      executionRequestId: request.executionRequestId,
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      decisionId: request.decisionId,
      targetDeviceId: request.targetDeviceId,
      commandId: request.commandId,
      deviceId: request.targetDeviceId,
      status,
      message,
      errorCode,
      reasonCodes,
      economicArbitration,
    });
  };

  for (const request of params.requests) {
    if (params.missingRuntimeContextInStrictMode) {
      pushRejected(
        request,
        [...params.postureClassification.reasonCodes],
        "Runtime guardrail context missing in strict mode.",
        "skipped",
        "Command denied by canonical execution policy.",
        params.postureClassification.reasonCodes[0],
      );
      continue;
    }

    const matchedDecision = request.decisionId
      ? params.controlLoopResult.activeDecisions.find((decision) => decision.decisionId === request.decisionId)
      : undefined;

    const runtimeGuardrailDecision = evaluateRuntimeExecutionGuardrail({
      command: request.canonicalCommand,
      decisionAction: matchedDecision?.action,
      cycleFinancialContext: params.cycleFinancialContext,
      runtimeContext: params.runtimeGuardrailContext,
      runtimePosture: params.executionPosture,
      postureClassification: params.postureClassification,
    });

    if (runtimeGuardrailDecision.policy === "suppress") {
      pushRejected(
        request,
        runtimeGuardrailDecision.reasonCodes,
        runtimeGuardrailDecision.reason ?? "Runtime guardrail suppressed command.",
        "skipped",
        "Command denied by canonical execution policy.",
        runtimeGuardrailDecision.reasonCodes[0],
      );
      continue;
    }

    if (params.capabilitiesProvider) {
      const capabilities = params.capabilitiesProvider.getCapabilities(request.targetDeviceId);
      const validation = validateCanonicalCommandAgainstCapabilities(
        request.canonicalCommand,
        capabilities,
        params.input.now,
      );

      if (!validation.valid) {
        const reasonCodes = validation.reasonCodes as CanonicalCommandValidationReasonCode[];
        pushRejected(
          request,
          reasonCodes,
          "Command failed canonical preflight validation.",
          "failed",
          "Command failed canonical preflight validation.",
          reasonCodes[0],
        );
        continue;
      }
    }

    if (params.shadowStore) {
      const existingShadow = params.shadowStore.getDeviceState(request.targetDeviceId);
      const reconciliation = reconcileCanonicalCommandWithShadow(
        request.canonicalCommand,
        existingShadow,
        params.input.now,
      );

      if (reconciliation.action === "skip") {
        pushRejected(
          request,
          reconciliation.reasonCodes as OpportunityReasonCode[],
          "Command skipped by canonical shadow reconciliation.",
          "skipped",
          "Command skipped by canonical shadow reconciliation.",
          reconciliation.reasonCodes[0],
        );
        continue;
      }
    }

    const policyDecision = evaluateExecutionPolicy({
      now: params.input.now,
      request,
      controlLoopResult: params.controlLoopResult,
      optimizerOutput: params.input.optimizerOutput,
      observedStateFreshness: params.input.observedStateFreshness,
    });

    if (!policyDecision.allowed) {
      const reasonCodes = policyDecision.reasonCodes as ExecutionPolicyReasonCode[];
      pushRejected(
        request,
        reasonCodes,
        "Command denied by canonical execution policy.",
        "skipped",
        "Command denied by canonical execution policy.",
        reasonCodes[0],
      );
      continue;
    }

    const authority = evaluateCanonicalExecutionEligibility(request);
    if (!authority.allowed) {
      const reasonCode = authority.reasonCode ?? "EXECUTION_AUTHORITY_IDENTITY_INSUFFICIENT";
      pushRejected(
        request,
        [reasonCode],
        authority.decisionReason,
        "skipped",
        authority.decisionReason,
        reasonCode,
      );
      continue;
    }

    eligible.push({
      opportunityId: authority.canonicalOpportunityId ?? `${request.planId}:incomplete_identity:${request.commandId}`,
      opportunityProvenance: request.opportunityProvenance ?? {
        kind: "native_canonical",
        canonicalizedFromLegacy: false,
      },
      decisionId: request.decisionId,
      targetDeviceId: request.targetDeviceId,
      canonicalCommand: request.canonicalCommand,
      commandId: request.commandId,
      planId: request.planId,
      requestedAt: request.requestedAt,
      executionAuthorityMode: authority.mode,
      matchedDecisionAction: matchedDecision?.action,
      economicCandidate: params.cycleFinancialContext
        ? buildEconomicCandidate(request, params.cycleFinancialContext)
        : undefined,
      eligibilityBasis: {
        runtimeGuardrailPassed: true,
        capabilityValidationPassed: true,
        reconciliationPassed: true,
        executionPolicyPassed: true,
        observedStateStatus: params.input.observedStateFreshness?.devices.find(
          (entry) => entry.deviceId === request.targetDeviceId,
        )?.status,
      },
    });
  }

  return { eligible, rejected, compatibilityOutcomes };
}