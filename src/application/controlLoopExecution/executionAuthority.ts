import type { CommandExecutionRequest } from "./types";

export type ExecutionAuthorityMode =
  | "full_canonical"
  | "partial_decision_bound"
  | "insufficient_identity";

export type ExecutionAuthorityReasonCode =
  | "EXECUTION_AUTHORITY_IDENTITY_INSUFFICIENT"
  | "EXECUTION_AUTHORITY_PARTIAL_IDENTITY_MODE";

export interface CanonicalExecutionEligibility {
  mode: ExecutionAuthorityMode;
  allowed: boolean;
  canonicalOpportunityId?: string;
  reasonCode?: ExecutionAuthorityReasonCode;
  decisionReason: string;
}

/**
 * Canonical execution authority contract.
 *
 * Identity precedence: opportunityId -> decisionId -> planId.
 * Execution artifacts (executionRequestId/idempotencyKey) are never authority inputs.
 */
export function evaluateCanonicalExecutionEligibility(
  request: Pick<
    CommandExecutionRequest,
    "opportunityId" | "opportunityProvenance" | "decisionId" | "planId" | "commandId"
  >,
): CanonicalExecutionEligibility {
  if (request.opportunityId && request.decisionId && request.planId) {
    return {
      mode: "full_canonical",
      allowed: true,
      canonicalOpportunityId: request.opportunityId,
      decisionReason: "Full canonical identity present for execution authority.",
    };
  }

  if (request.opportunityId && request.planId) {
    const isCompatibilityCanonicalized =
      request.opportunityProvenance?.kind === "compatibility_canonicalized";

    if (!isCompatibilityCanonicalized) {
      return {
        mode: "insufficient_identity",
        allowed: false,
        canonicalOpportunityId: `${request.planId}:incomplete_identity:${request.commandId}`,
        reasonCode: "EXECUTION_AUTHORITY_IDENTITY_INSUFFICIENT",
        decisionReason:
          "Execution authority denied: opportunity-bound identity without decisionId is reserved for compatibility-canonicalized requests.",
      };
    }

    return {
      mode: "partial_decision_bound",
      allowed: true,
      canonicalOpportunityId: request.opportunityId,
      reasonCode: "EXECUTION_AUTHORITY_PARTIAL_IDENTITY_MODE",
      decisionReason:
        "Opportunity-bound canonical identity accepted at compatibility boundary (opportunityId + planId).",
    };
  }

  if (request.decisionId && request.planId) {
    return {
      mode: "partial_decision_bound",
      allowed: true,
      canonicalOpportunityId: `${request.planId}:decision:${request.decisionId}:command:${request.commandId}`,
      reasonCode: "EXECUTION_AUTHORITY_PARTIAL_IDENTITY_MODE",
      decisionReason:
        "Partial canonical identity accepted at compatibility boundary (decisionId + planId).",
    };
  }

  const fallbackPlanId = request.planId || "plan-unknown";
  const fallbackCommandId = request.commandId || "command-unknown";

  return {
    mode: "insufficient_identity",
    allowed: false,
    canonicalOpportunityId: `${fallbackPlanId}:incomplete_identity:${fallbackCommandId}`,
    reasonCode: "EXECUTION_AUTHORITY_IDENTITY_INSUFFICIENT",
    decisionReason:
      "Execution authority denied: canonical identity chain incomplete (requires at least decisionId + planId).",
  };
}
