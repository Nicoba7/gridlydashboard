import type { ControlLoopInput, ControlLoopResult } from "../../../controlLoop/controlLoop";
import { evaluateExecutionPolicy } from "../evaluateExecutionPolicy";
import type { ExecutionPolicyReasonCode } from "../executionPolicyTypes";
import type {
  CommandExecutionResult,
} from "../types";
import { buildExecutionIdentity } from "../edge/buildExecutionRequestsFromPlan";
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
  opportunity: EligibleOpportunity,
  reasonCodes: OpportunityReasonCode[],
  decisionReason: string,
): RejectedOpportunity {
  return {
    opportunityId: opportunity.opportunityId,
    decisionId: opportunity.decisionId,
    targetDeviceId: opportunity.targetDeviceId,
    stage: "execution_planning",
    reasonCodes,
    decisionReason,
  };
}

function mapPlanningDeniedOutcome(
  opportunity: EligibleOpportunity,
  reasonCodes: OpportunityReasonCode[],
): CommandExecutionResult {
  const identity = buildExecutionIdentity(opportunity);

  return {
    opportunityId: opportunity.opportunityId,
    executionRequestId: identity.executionRequestId,
    requestId: identity.executionRequestId,
    idempotencyKey: identity.idempotencyKey,
    decisionId: opportunity.decisionId,
    targetDeviceId: opportunity.targetDeviceId,
    commandId: opportunity.commandId,
    deviceId: opportunity.targetDeviceId,
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
        selectedOpportunity.targetDeviceId,
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
  dispatchableOpportunities: EligibleOpportunity[];
  /** Transitional edge payload for request-centric journal/adapter/store compatibility. */
  compatibilityOutcomes: CommandExecutionResult[];
}

/**
 * Converts final selected opportunities into the canonical execution-plan boundary.
 *
 * Owns: reserved-device conflict handling and command-set construction for
 * downstream adapter execution.
  * - `plan.kind === "non_executable"` implies no dispatchable opportunities
 * Must not: perform new economic reasoning or call adapters.
 *
 * Invariants:
 * - `plan.kind === "executable"` implies `dispatchableOpportunities.length > 0`
 * - compatibility outcomes are edge-only transitional payloads and do not
 *   participate in canonical decision semantics.
 */
export function buildExecutionPlan(
  params: BuildExecutionPlanInput,
): BuildExecutionPlanOutput {
  const dispatchableOpportunities: EligibleOpportunity[] = [];
  const reservedDeviceIds = new Set<string>();
  const rejected: RejectedOpportunity[] = [];
  const compatibilityOutcomes: CommandExecutionResult[] = [];

  for (const opportunity of params.opportunities) {
    const policyDecision = evaluateExecutionPolicy({
      now: params.input.now,
      request: {
        decisionId: opportunity.decisionId,
        targetDeviceId: opportunity.targetDeviceId,
        requestedAt: opportunity.requestedAt,
        canonicalCommand: opportunity.canonicalCommand,
      },
      controlLoopResult: params.controlLoopResult,
      optimizerOutput: params.input.optimizerOutput,
      observedStateFreshness: params.input.observedStateFreshness,
      reservedDeviceIds,
    });

    if (!policyDecision.allowed) {
      compatibilityOutcomes.push(
        mapPlanningDeniedOutcome(
          opportunity,
          policyDecision.reasonCodes as OpportunityReasonCode[],
        ),
      );
      rejected.push(
        buildPlanningRejection(
          opportunity,
          policyDecision.reasonCodes as ExecutionPolicyReasonCode[],
          "Command denied by canonical execution policy.",
        ),
      );
      continue;
    }

    reservedDeviceIds.add(opportunity.targetDeviceId);
    dispatchableOpportunities.push(opportunity);
  }

  if (!dispatchableOpportunities.length) {
    return {
      plan: buildNonExecutablePlan(rejected),
      rejected,
      dispatchableOpportunities,
      compatibilityOutcomes,
    };
  }

  const selectedOpportunity = dispatchableOpportunities[0];
  if (!selectedOpportunity) {
    return {
      plan: buildNonExecutablePlan(rejected),
      rejected,
      dispatchableOpportunities: [],
      compatibilityOutcomes,
    };
  }

  return {
    plan: {
      kind: "executable",
      householdDecision: toCompatibilitySelectedDecision(selectedOpportunity, rejected),
      selectedOpportunityId: selectedOpportunity.opportunityId,
      selectedDecisionId: selectedOpportunity.decisionId,
      commands: dispatchableOpportunities.map((opportunity) => opportunity.canonicalCommand),
    },
    rejected,
    dispatchableOpportunities,
    compatibilityOutcomes,
  };
}
