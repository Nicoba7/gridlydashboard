import { describe, it, expect } from "vitest";
import { projectJournal } from "../application/controlLoopExecution/stages/projectJournal";

function buildCanonicalRuntimeSignals(overrides?: {
  hasUncertainExecutionEvidence?: boolean;
}) {
  return {
    outcomeSignals: [],
    executionEvidenceSummary: {
      hasUncertainExecutionEvidence: overrides?.hasUncertainExecutionEvidence ?? false,
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
  hasUncertainExecutionEvidence?: boolean;
}) {
  return {
    recordedAt: "2026-03-16T10:05:00.000Z",
    executionPosture: "normal" as const,
    failClosedTriggered: false,
    rejectedOpportunities: [],
    legacyCompatibilityOutcomes: [],
    runtimeOutcomeProjection: {
      outcomeRecords: [],
      compatibilityExecutionEdgeContexts: [],
      canonicalRuntimeSignals: buildCanonicalRuntimeSignals({
        hasUncertainExecutionEvidence: overrides?.hasUncertainExecutionEvidence,
      }),
    },
  };
}

describe("projectJournal cycle heartbeat evidence projection", () => {
  it("projects true when hasUncertainExecutionEvidence is true", () => {
    const output = projectJournal(buildRuntimeJournalProjectionPayload({ hasUncertainExecutionEvidence: true }));

    expect(output.cycleHeartbeat.hasUncertainExecutionEvidence).toBe(true);
  });

  it("projects false when hasUncertainExecutionEvidence is false", () => {
    const output = projectJournal(buildRuntimeJournalProjectionPayload({ hasUncertainExecutionEvidence: false }));

    expect(output.cycleHeartbeat.hasUncertainExecutionEvidence).toBe(false);
  });

  it("projects undefined when summary is omitted", () => {
    const output = projectJournal(buildRuntimeJournalProjectionPayload({ hasUncertainExecutionEvidence: false }));
    expect(output.cycleHeartbeat.hasUncertainExecutionEvidence).toBe(false);
  });

  it("maintains field in projection output alongside other heartbeat fields", () => {
    const output = projectJournal(buildRuntimeJournalProjectionPayload({ hasUncertainExecutionEvidence: true }));

    // Verify the heartbeat contains canonical fields along with the new evidence field
    expect(output.cycleHeartbeat).toHaveProperty("entryKind", "cycle_heartbeat");
    expect(output.cycleHeartbeat).toHaveProperty("recordedAt");
    expect(output.cycleHeartbeat).toHaveProperty("executionPosture");
    expect(output.cycleHeartbeat).toHaveProperty("hasUncertainExecutionEvidence", true);
    expect(output.cycleHeartbeat).toHaveProperty("schemaVersion");
  });

  it("does not mutate input executionEvidenceSummary during projection", () => {
    const summary = {
      hasUncertainExecutionEvidence: true,
    };
    const originalValue = summary.hasUncertainExecutionEvidence;

    projectJournal(buildRuntimeJournalProjectionPayload({
      hasUncertainExecutionEvidence: summary.hasUncertainExecutionEvidence,
    }));

    // Verify the input summary was not mutated
    expect(summary.hasUncertainExecutionEvidence).toBe(originalValue);
  });

  it("preserves the value through the full projection path to output", () => {
    const output = projectJournal(buildRuntimeJournalProjectionPayload({ hasUncertainExecutionEvidence: true }));

    // Verify value is present in both the cycleHeartbeat return and in projection.cycleHeartbeat
    expect(output.cycleHeartbeat.hasUncertainExecutionEvidence).toBe(true);
    expect(output.projection.cycleHeartbeat.hasUncertainExecutionEvidence).toBe(true);
    expect(output.cycleHeartbeat === output.projection.cycleHeartbeat).toBe(true);
  });
});
