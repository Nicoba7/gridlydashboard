import { describe, expect, it } from "vitest";
import type { CommandExecutionRequest } from "../application/controlLoopExecution/types";
import { adaptLegacyExecutionRequests } from "../application/controlLoopExecution/edge/legacyExecutionCompatibilityAdapter";
import { evaluateCanonicalExecutionEligibility } from "../application/controlLoopExecution/executionAuthority";

function buildRequest(overrides: Partial<CommandExecutionRequest> = {}): CommandExecutionRequest {
  return {
    opportunityId: "op-1",
    executionRequestId: "exec-1",
    requestId: "exec-1",
    idempotencyKey: "idem-1",
    decisionId: "decision-1",
    targetDeviceId: "battery",
    planId: "plan-1",
    requestedAt: "2026-03-16T10:05:00.000Z",
    commandId: "cmd-1",
    canonicalCommand: {
      kind: "set_mode",
      targetDeviceId: "battery",
      mode: "charge",
      effectiveWindow: {
        startAt: "2026-03-16T10:00:00.000Z",
        endAt: "2026-03-16T10:30:00.000Z",
      },
    },
    ...overrides,
  };
}

describe("legacyExecutionCompatibilityAdapter", () => {
  it("upgrades decision-bound legacy requests to canonical opportunity identity", () => {
    const adapted = adaptLegacyExecutionRequests([
      buildRequest({ opportunityId: undefined }),
    ]);

    expect(adapted).toHaveLength(1);
    expect(adapted[0].opportunityId).toBe("plan-1:decision:decision-1:command:cmd-1");
    expect(adapted[0].opportunityProvenance).toEqual({
      kind: "compatibility_canonicalized",
      canonicalizedFromLegacy: true,
      legacySourceType: "command_execution_request",
      adaptationReason: "missing_opportunity_id",
      sourceCommandLineage: {
        planId: "plan-1",
        decisionId: "decision-1",
        commandId: "cmd-1",
        targetDeviceId: "battery",
        sourceOpportunityId: undefined,
      },
      canonicalizationVersion: "legacy-opportunity-canonicalization.v1",
    });

    const eligibility = evaluateCanonicalExecutionEligibility(adapted[0]);
    expect(eligibility.allowed).toBe(true);
    expect(eligibility.mode).toBe("full_canonical");
  });

  it("canonicalizes identical legacy retries deterministically", () => {
    const request = buildRequest({ opportunityId: undefined });
    const [first] = adaptLegacyExecutionRequests([request]);
    const [second] = adaptLegacyExecutionRequests([request]);

    expect(first.opportunityId).toBe(second.opportunityId);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.executionRequestId).toBe(second.executionRequestId);
  });

  it("preserves native canonical provenance when opportunity identity already exists", () => {
    const [adapted] = adaptLegacyExecutionRequests([buildRequest({ opportunityId: "opp-1" })]);

    expect(adapted.opportunityId).toBe("opp-1");
    expect(adapted.opportunityProvenance).toEqual({
      kind: "native_canonical",
      canonicalizedFromLegacy: false,
    });
  });

  it("allows decision-missing legacy request via compatibility opportunity-bound authority", () => {
    const adapted = adaptLegacyExecutionRequests([
      buildRequest({ opportunityId: undefined, decisionId: undefined }),
    ]);

    const eligibility = evaluateCanonicalExecutionEligibility(adapted[0]);
    expect(adapted[0].opportunityProvenance?.kind).toBe("compatibility_canonicalized");
    expect(adapted[0].opportunityId).toBe("plan-1:command:cmd-1");
    expect(eligibility.allowed).toBe(true);
    expect(eligibility.mode).toBe("partial_decision_bound");
    expect(eligibility.reasonCode).toBe("EXECUTION_AUTHORITY_PARTIAL_IDENTITY_MODE");
  });
});
