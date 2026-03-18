import { describe, expect, it } from "vitest";
import { projectJournal } from "../application/controlLoopExecution/stages/projectJournal";
import type { CommandExecutionRequest, CommandExecutionResult } from "../application/controlLoopExecution/types";
import type { ExecutionEdgeContext, RejectedOpportunity } from "../application/controlLoopExecution/pipelineTypes";
import type { RuntimeOutcomeProjectionRecord } from "../application/controlLoopExecution/runtimeJournalProjectionPayload";

function buildCanonicalRuntimeSignals(overrides?: {
  outcomeSignals?: Array<{
    executionRequestId: string;
    telemetryCoherence?: "coherent" | "delayed" | "contradictory" | "stale";
    executionConfidence?: "confirmed" | "uncertain";
  }>;
}) {
  return {
    outcomeSignals: overrides?.outcomeSignals ?? [],
    executionEvidenceSummary: {
      hasUncertainExecutionEvidence: false,
    },
    nextCycleExecutionCaution: "normal" as const,
    householdObjectiveSummary: {
      objectiveMode: "savings" as const,
      hasExportIntent: false,
      hasImportAvoidanceIntent: true,
    },
    householdObjectiveConfidence: "clear" as const,
  };
}

function buildRuntimeJournalProjectionPayload(overrides?: {
  compatibilityExecutionEdgeContexts?: ExecutionEdgeContext[];
  outcomeRecords?: RuntimeOutcomeProjectionRecord[];
  rejectedOpportunities?: RejectedOpportunity[];
  legacyCompatibilityOutcomes?: CommandExecutionResult[];
}) {
  return {
    recordedAt: "2026-03-16T10:05:00.000Z",
    executionPosture: "normal" as const,
    failClosedTriggered: false,
    rejectedOpportunities: overrides?.rejectedOpportunities ?? [],
    legacyCompatibilityOutcomes: overrides?.legacyCompatibilityOutcomes ?? [],
    runtimeOutcomeProjection: {
      outcomeRecords: overrides?.outcomeRecords ?? [],
      compatibilityExecutionEdgeContexts: overrides?.compatibilityExecutionEdgeContexts ?? [],
      canonicalRuntimeSignals: buildCanonicalRuntimeSignals(),
    },
  };
}

function buildOutcomeRecord(overrides?: {
  executionRequestId?: string;
  outcomeExecutionRequestId?: string;
  edgeExecutionRequestId?: string;
  signalExecutionRequestId?: string;
}) {
  const executionRequestId = overrides?.executionRequestId ?? "req-1";
  const outcomeExecutionRequestId = overrides?.outcomeExecutionRequestId ?? executionRequestId;
  const edgeExecutionRequestId = overrides?.edgeExecutionRequestId ?? executionRequestId;
  const signalExecutionRequestId = overrides?.signalExecutionRequestId ?? executionRequestId;

  return {
    executionRequestId,
    executionEdgeContext: {
      opportunityId: "opp-1",
      decisionId: "decision-1",
      planId: "plan-1",
      executionAuthorityMode: "full_canonical" as const,
      canonicalCommand: request.canonicalCommand,
      targetDeviceId: "battery",
      executionRequestId: edgeExecutionRequestId,
      requestedAt: "2026-03-16T10:05:00.000Z",
      commandId: "cmd-1",
      idempotencyKey: "idem-1",
      opportunityProvenance: {
        kind: "native_canonical" as const,
        canonicalizedFromLegacy: false,
      },
    },
    outcome: {
      executionRequestId: outcomeExecutionRequestId,
      requestId: outcomeExecutionRequestId,
      idempotencyKey: "idem-1",
      targetDeviceId: "battery",
      commandId: "cmd-1",
      deviceId: "battery",
      status: "issued" as const,
    },
    runtimeOutcomeSignal: {
      executionRequestId: signalExecutionRequestId,
      telemetryCoherence: "coherent" as const,
      executionConfidence: "confirmed" as const,
    },
  };
}

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
  it("accepts structurally coherent runtime projection payload unchanged", () => {
    const coherentRecord = buildOutcomeRecord();
    const payload = buildRuntimeJournalProjectionPayload({
      compatibilityExecutionEdgeContexts: [coherentRecord.executionEdgeContext],
      outcomeRecords: [coherentRecord],
    });

    expect(() => projectJournal(payload)).not.toThrow();
  });

  it("rejects missing runtime outcome signal coverage for outcome executionRequestId", () => {
    const mismatchedSignalRecord = buildOutcomeRecord({
      executionRequestId: "req-1",
      signalExecutionRequestId: "req-2",
    });
    const payload = buildRuntimeJournalProjectionPayload({
      compatibilityExecutionEdgeContexts: [mismatchedSignalRecord.executionEdgeContext],
      outcomeRecords: [mismatchedSignalRecord],
    });

    expect(() => projectJournal(payload)).toThrowError(/Projection payload integrity violation/);
    expect(() => projectJournal(payload)).toThrowError(/missing runtime outcome signal coverage/i);
  });

  it("rejects duplicate correlated entries by executionRequestId", () => {
    const firstRecord = buildOutcomeRecord({ executionRequestId: "req-1" });
    const duplicateRecord = buildOutcomeRecord({ executionRequestId: "req-1" });
    const payload = buildRuntimeJournalProjectionPayload({
      compatibilityExecutionEdgeContexts: [firstRecord.executionEdgeContext],
      outcomeRecords: [firstRecord, duplicateRecord],
    });

    expect(() => projectJournal(payload)).toThrowError(/Projection payload integrity violation/);
    expect(() => projectJournal(payload)).toThrowError(/duplicate runtime outcome projection records/i);
  });

  it("persists runtime payload outcome signals unchanged in journal entries", () => {
    const coherentRecord = buildOutcomeRecord();
    coherentRecord.outcome.telemetryCoherence = "stale";
    coherentRecord.outcome.executionConfidence = "uncertain";
    coherentRecord.runtimeOutcomeSignal.telemetryCoherence = "coherent";
    coherentRecord.runtimeOutcomeSignal.executionConfidence = "confirmed";

    const output = projectJournal(buildRuntimeJournalProjectionPayload({
      compatibilityExecutionEdgeContexts: [coherentRecord.executionEdgeContext],
      outcomeRecords: [coherentRecord],
    }));

    expect(output.journalEntries).toHaveLength(1);
    expect(output.journalEntries[0].telemetryCoherence).toBe("coherent");
    expect(output.journalEntries[0].executionConfidence).toBe("confirmed");
  });

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

    const output = projectJournal(buildRuntimeJournalProjectionPayload({
      compatibilityExecutionEdgeContexts: [
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
      outcomeRecords: [],
      rejectedOpportunities: [rejectedA, rejectedB],
      legacyCompatibilityOutcomes: [],
    }));

    expect(output.projection.narrative.eligibilityRejections).toHaveLength(1);
  });

  it("marks incomplete identity when context is missing without promoting executionRequestId", () => {
    const output = projectJournal(buildRuntimeJournalProjectionPayload({
      compatibilityExecutionEdgeContexts: [],
      outcomeRecords: [],
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
    }));

    expect(output.projection.narrative.eligibilityRejections).toHaveLength(1);
    expect(output.projection.narrative.eligibilityRejections[0].opportunityId).toBe("incomplete_identity");
    expect(output.projection.narrative.eligibilityRejections[0].opportunityId).not.toBe("req-unknown");
  });
});
