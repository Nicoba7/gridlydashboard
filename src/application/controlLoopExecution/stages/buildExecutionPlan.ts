import type { ControlLoopInput, ControlLoopResult } from "../../../controlLoop/controlLoop";
import { evaluateExecutionPolicy } from "../evaluateExecutionPolicy";
import type { ExecutionPolicyReasonCode } from "../executionPolicyTypes";
import type {
  CommandExecutionRequest,
  CommandExecutionResult,
} from "../types";
import type {
  DeviceArbitratedOpportunity,
  EligibleOpportunity,
  ExecutionPlan,
  NoActionDecision,
  OpportunityReasonCode,
  RejectedOpportunity,
  SelectedOpportunityDecision,
} from "../pipelineTypes";

function buildPlanningRejection(
  request: CommandExecutionRequest,
  reasonCodes: OpportunityReasonCode[],
  decisionReason: string,
): RejectedOpportunity {
  return {
    opportunityId: request.opportunityId ?? request.executionRequestId,
    decisionId: request.decisionId,
    targetDeviceId: request.targetDeviceId,
    stage: "execution_planning",
    reasonCodes,
    decisionReason,
  };
}

function mapPlanningDeniedOutcome(
  request: CommandExecutionRequest,
  reasonCodes: OpportunityReasonCode[],
): CommandExecutionResult {
  return {
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
  };
}

function toCompatibilitySelectedDecision(
  selectedOpportunity: EligibleOpportunity,
  rejected: RejectedOpportunity[],
): SelectedOpportunityDecision {
  const selected: DeviceArbitratedOpportunity = {
    opportunityId: selectedOpportunity.opportunityId,
    decisionId: selectedOpportunity.decisionId,
    targetDeviceId: selectedOpportunity.targetDeviceId,
    eligible: selectedOpportunity,
    deviceArbitration: {
      arbitrationScope: "device",
      deviceContentionKey:
        selectedOpportunity.targetDeviceId ?? selectedOpportunity.request.targetDeviceId,
      alternativesConsidered: 1,
      decisionReason: "Selected for execution planning dispatch.",
    },
  };

  return {
    kind: "selected_opportunity",
    selectedOpportunity: selected,
    rejectedOpportunities: rejected,
    decisionReason: "Execution planning selected dispatchable opportunity set.",
  };
}

function buildNonExecutablePlan(rejected: RejectedOpportunity[]): ExecutionPlan {
  const reasonCodes = Array.from(
    new Set(rejected.flatMap((item) => item.reasonCodes)),
  );
  const nonExecutableReasonCodes =
    reasonCodes.length > 0
      ? reasonCodes
      : (["EXECUTION_PLAN_EMPTY_COMMAND_SET"] satisfies OpportunityReasonCode[]);

  const householdDecision: NoActionDecision = {
    kind: "no_action",
    rejectedOpportunities: rejected,
    reasonCodes: nonExecutableReasonCodes,
    decisionReason: "No executable commands remained after execution planning.",
  };

  return {
    kind: "non_executable",
    householdDecision,
    reasonCodes: nonExecutableReasonCodes,
    decisionReason: householdDecision.decisionReason,
    commands: [],
  };
}

export interface BuildExecutionPlanInput {
  opportunities: EligibleOpportunity[];
  input: ControlLoopInput;
  controlLoopResult: ControlLoopResult;
}

export interface BuildExecutionPlanOutput {
  /** Canonical plan artifact consumed by downstream execution stage. */
  plan: ExecutionPlan;
  /** Canonical rejected opportunities owned by execution planning stage. */
  rejected: RejectedOpportunity[];
  /** Transitional edge payload for adapter execution input; not part of canonical plan model. */
  dispatchableRequests: CommandExecutionRequest[];
  /** Transitional edge payload for request-centric journal/adapter/store compatibility. */
  compatibilityOutcomes: CommandExecutionResult[];
}

/**
 * Converts final selected opportunities into the canonical execution-plan boundary.
 *
 * Owns: reserved-device conflict handling and command-set construction for
 * downstream adapter execution.
 *
 * Must not: perform new economic reasoning or call adapters.
 *
 * Invariants:
 * - `plan.kind === "executable"` implies `dispatchableRequests.length > 0`
 * - compatibility outcomes are edge-only transitional payloads and do not
 *   participate in canonical decision semantics.
 */
export function buildExecutionPlan(
  params: BuildExecutionPlanInput,
): BuildExecutionPlanOutput {
  const dispatchableRequests: CommandExecutionRequest[] = [];
  const reservedDeviceIds = new Set<string>();
  const rejected: RejectedOpportunity[] = [];
  const compatibilityOutcomes: CommandExecutionResult[] = [];

  for (const opportunity of params.opportunities) {
    const policyDecision = evaluateExecutionPolicy({
      now: params.input.now,
      request: opportunity.request,
      controlLoopResult: params.controlLoopResult,
      optimizerOutput: params.input.optimizerOutput,
      observedStateFreshness: params.input.observedStateFreshness,
      reservedDeviceIds,
    });

    if (!policyDecision.allowed) {
      compatibilityOutcomes.push(
        mapPlanningDeniedOutcome(
          opportunity.request,
          policyDecision.reasonCodes as OpportunityReasonCode[],
        ),
      );
      rejected.push(
        buildPlanningRejection(
          opportunity.request,
          policyDecision.reasonCodes as ExecutionPolicyReasonCode[],
          "Command denied by canonical execution policy.",
        ),
      );
      continue;
    }

    reservedDeviceIds.add(opportunity.request.targetDeviceId);
    dispatchableRequests.push(opportunity.request);
  }

  if (!dispatchableRequests.length) {
    return {
      plan: buildNonExecutablePlan(rejected),
      rejected,
      dispatchableRequests,
      compatibilityOutcomes,
    };
  }

  const selectedRequest = dispatchableRequests[0];
  if (!selectedRequest) {
    return {
      plan: buildNonExecutablePlan(rejected),
      rejected,
      dispatchableRequests: [],
      compatibilityOutcomes,
    };
  }

  const selectedOpportunity =
    params.opportunities.find(
      (opportunity) =>
        opportunity.request.executionRequestId === selectedRequest.executionRequestId,
    ) ?? params.opportunities[0];

  if (!selectedOpportunity) {
    return {
      plan: buildNonExecutablePlan(rejected),
      rejected,
      dispatchableRequests: [],
      compatibilityOutcomes,
    };
  }

  return {
    plan: {
      kind: "executable",
      householdDecision: toCompatibilitySelectedDecision(selectedOpportunity, rejected),
      selectedOpportunityId: selectedRequest.opportunityId,
      selectedDecisionId: selectedRequest.decisionId,
      commands: dispatchableRequests.map((request) => request.canonicalCommand),
    },
    rejected,
    dispatchableRequests,
    compatibilityOutcomes,
  };
}
