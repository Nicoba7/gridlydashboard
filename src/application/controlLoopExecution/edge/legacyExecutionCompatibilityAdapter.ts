import type {
  CommandExecutionRequest,
  ExecutionOpportunityProvenance,
} from "../types";

function commandIntentDescriptor(command: CommandExecutionRequest["canonicalCommand"]): string {
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

function buildSemanticExecutionIdentity(request: CommandExecutionRequest): {
  executionRequestId: string;
  idempotencyKey: string;
} {
  const window = request.canonicalCommand.effectiveWindow;
  const intent = commandIntentDescriptor(request.canonicalCommand);
  const startAt = window?.startAt ?? "immediate";
  const endAt = window?.endAt ?? "open";
  const semanticKey = [
    request.opportunityId ?? request.decisionId ?? "unmatched",
    request.targetDeviceId,
    intent,
    startAt,
    endAt,
  ].join(":");

  return {
    executionRequestId: `${request.planId}:${semanticKey}`,
    idempotencyKey: semanticKey,
  };
}

/**
 * Explicit compatibility boundary for legacy command-only optimizer pathways.
 *
 * Canonical runtime stages require opportunity-first identity. This adapter
 * upgrades legacy request payloads by deriving a stable opportunityId from
 * plan/decision lineage before canonical stage processing begins.
 */
export function adaptLegacyExecutionRequests(
  requests: CommandExecutionRequest[],
): CommandExecutionRequest[] {
  return requests.map((request) => {
    const wasMissingOpportunityId = !request.opportunityId;
    const upgradedOpportunityId = request.opportunityId
      ?? (request.decisionId
        ? `${request.planId}:decision:${request.decisionId}:command:${request.commandId}`
        : `${request.planId}:command:${request.commandId}`);

    const opportunityProvenance: ExecutionOpportunityProvenance = request.opportunityProvenance
      ?? (wasMissingOpportunityId
        ? {
            kind: "compatibility_canonicalized",
            canonicalizedFromLegacy: true,
            legacySourceType: "command_execution_request",
            adaptationReason: "missing_opportunity_id",
            sourceCommandLineage: {
              planId: request.planId,
              decisionId: request.decisionId,
              commandId: request.commandId,
              targetDeviceId: request.targetDeviceId,
              sourceOpportunityId: request.opportunityId,
            },
            canonicalizationVersion: "legacy-opportunity-canonicalization.v1",
          }
        : {
            kind: "native_canonical",
            canonicalizedFromLegacy: false,
          });

    const upgraded = {
      ...request,
      opportunityId: upgradedOpportunityId,
      opportunityProvenance,
    };

    const identity = buildSemanticExecutionIdentity(upgraded);
    return {
      ...upgraded,
      executionRequestId: identity.executionRequestId,
      requestId: identity.executionRequestId,
      idempotencyKey: identity.idempotencyKey,
    };
  });
}
