import { describe, expect, it } from "vitest";
import { projectJournal } from "../application/controlLoopExecution/stages/projectJournal";
import type { CommandExecutionRequest } from "../application/controlLoopExecution/types";
import type { RejectedOpportunity } from "../application/controlLoopExecution/pipelineTypes";

const request: CommandExecutionRequest = {
  opportunityId: "opp-1",
  executionRequestId: "req-1",
  requestId: "req-1",
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
  },
};

describe("projectJournal stage", () => {
  it("dedupes rejections deterministically when reason code order differs", () => {
    const rejectedA: RejectedOpportunity = {
      opportunityId: "opp-1",
      decisionId: "decision-1",
      targetDeviceId: "battery",
      stage: "eligibility",
      reasonCodes: ["COMMAND_STALE", "OBSERVED_STATE_STALE"],
      decisionReason: "Denied",
    };

    const rejectedB: RejectedOpportunity = {
      ...rejectedA,
      reasonCodes: ["OBSERVED_STATE_STALE", "COMMAND_STALE"],
    };

    const output = projectJournal({
      executionEdgeContexts: [
        {
          opportunityId: "opp-1",
          decisionId: "decision-1",
          planId: "plan-1",
          executionAuthorityMode: "full_canonical",
          canonicalCommand: request.canonicalCommand,
          targetDeviceId: "battery",
          executionRequestId: "req-1",
          requestedAt: "2026-03-16T10:05:00.000Z",
          commandId: "cmd-1",
          idempotencyKey: "idem-1",
        },
      ],
      outcomes: [],
      recordedAt: "2026-03-16T10:05:00.000Z",
      executionPosture: "normal",
      failClosedTriggered: false,
      rejectedOpportunities: [rejectedA, rejectedB],
      legacyCompatibilityOutcomes: [],
    });

    expect(output.projection.narrative.eligibilityRejections).toHaveLength(1);
  });

  it("marks incomplete identity when context is missing without promoting executionRequestId", () => {
    const output = projectJournal({
      executionEdgeContexts: [],
      outcomes: [],
      recordedAt: "2026-03-16T10:05:00.000Z",
      executionPosture: "normal",
      failClosedTriggered: false,
      rejectedOpportunities: [],
      legacyCompatibilityOutcomes: [
        {
          executionRequestId: "req-unknown",
          requestId: "req-unknown",
          idempotencyKey: "idem-unknown",
          targetDeviceId: "battery",
          commandId: "cmd-unknown",
          deviceId: "battery",
          status: "skipped",
          reasonCodes: ["COMMAND_STALE"],
          message: "denied",
        },
      ],
    });

    expect(output.projection.narrative.eligibilityRejections).toHaveLength(1);
    expect(output.projection.narrative.eligibilityRejections[0].opportunityId).toBe("incomplete_identity");
    expect(output.projection.narrative.eligibilityRejections[0].opportunityId).not.toBe("req-unknown");
  });
});
