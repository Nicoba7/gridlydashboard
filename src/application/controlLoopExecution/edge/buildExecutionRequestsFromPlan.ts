import type { CanonicalDeviceCommand } from "../canonicalCommand";
import type {
  EligibleOpportunity,
  ExecutionEdgeContext,
  ExecutionPlan,
} from "../pipelineTypes";
import type { CommandExecutionRequest } from "../types";
import { evaluateCanonicalExecutionEligibility } from "../executionAuthority";

function commandIntentDescriptor(command: CanonicalDeviceCommand): string {
  switch (command.kind) {
    case "set_mode":
      return `${command.kind}:${command.mode}`;
    case "set_power_limit":
      return `${command.kind}:${command.powerW}`;
    case "set_target_soc":
      return `${command.kind}:${command.targetSocPercent}`;
    case "set_reserve_soc":
      return `${command.kind}:${command.reserveSocPercent}`;
    case "schedule_window":
      return `${command.kind}:${command.targetMode ?? "unspecified"}`;
    default:
      return command.kind;
  }
}

export function buildExecutionIdentity(opportunity: EligibleOpportunity): {
  executionRequestId: string;
  idempotencyKey: string;
} {
  const window = opportunity.canonicalCommand.effectiveWindow;
  const intent = commandIntentDescriptor(opportunity.canonicalCommand);
  const startAt = window?.startAt ?? "immediate";
  const endAt = window?.endAt ?? "open";
  const identityAnchor = opportunity.opportunityId ?? opportunity.decisionId;
  const semanticKey = [
    identityAnchor ?? "unmatched",
    opportunity.targetDeviceId,
    intent,
    startAt,
    endAt,
  ].join(":");

  return {
    executionRequestId: `${opportunity.planId}:${semanticKey}`,
    idempotencyKey: semanticKey,
  };
}

export function buildExecutionEdgeContext(
  opportunity: EligibleOpportunity,
): ExecutionEdgeContext {
  const identity = buildExecutionIdentity(opportunity);
  return {
    opportunityId: opportunity.opportunityId,
    opportunityProvenance: opportunity.opportunityProvenance,
    decisionId: opportunity.decisionId,
    planId: opportunity.planId,
    executionAuthorityMode: opportunity.executionAuthorityMode,
    canonicalCommand: opportunity.canonicalCommand,
    targetDeviceId: opportunity.targetDeviceId,
    executionRequestId: identity.executionRequestId,
    requestedAt: opportunity.requestedAt,
    commandId: opportunity.commandId,
    idempotencyKey: identity.idempotencyKey,
  };
}

export function buildExecutionEdgeContextsFromRequests(
  requests: CommandExecutionRequest[],
): ExecutionEdgeContext[] {
  return requests
    .map((request) => {
      const authority = evaluateCanonicalExecutionEligibility(request);
      const canonicalOpportunityId = authority.allowed && authority.canonicalOpportunityId
        ? authority.canonicalOpportunityId
        : `${request.planId}:incomplete_identity:${request.commandId}`;
      return {
        opportunityId: canonicalOpportunityId,
        opportunityProvenance: request.opportunityProvenance ?? {
          kind: "native_canonical",
          canonicalizedFromLegacy: false,
        },
        decisionId: request.decisionId,
        planId: request.planId,
        executionAuthorityMode: authority.allowed ? authority.mode : "insufficient_identity",
        canonicalCommand: request.canonicalCommand,
        targetDeviceId: request.targetDeviceId,
        executionRequestId: request.executionRequestId,
        requestedAt: request.requestedAt,
        commandId: request.commandId,
        idempotencyKey: request.idempotencyKey,
      };
    });
}

/**
 * Execution-edge translator from canonical opportunities to canonical execution contexts.
 */
export function buildExecutionEdgeContextsFromPlan(
  plan: ExecutionPlan,
  dispatchableOpportunities: EligibleOpportunity[],
): ExecutionEdgeContext[] {
  if (plan.kind !== "executable") {
    return [];
  }

  return dispatchableOpportunities.map((opportunity) => buildExecutionEdgeContext(opportunity));
}

export function buildExecutionRequestsFromContexts(
  contexts: ExecutionEdgeContext[],
): CommandExecutionRequest[] {
  return contexts.map((context) => ({
    opportunityId: context.opportunityId,
    opportunityProvenance: context.opportunityProvenance,
    executionRequestId: context.executionRequestId,
    requestId: context.executionRequestId,
    idempotencyKey: context.idempotencyKey,
    decisionId: context.decisionId,
    targetDeviceId: context.targetDeviceId,
    planId: context.planId,
    requestedAt: context.requestedAt,
    commandId: context.commandId,
    canonicalCommand: context.canonicalCommand,
  }));
}
