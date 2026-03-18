import { describe, it, expect } from "vitest";
import { projectJournal } from "../application/controlLoopExecution/stages/projectJournal";

function buildCanonicalRuntimeSignals(overrides?: {
  nextCycleExecutionCaution?: "normal" | "caution";
}) {
  return {
    outcomeSignals: [],
    executionEvidenceSummary: {
      hasUncertainExecutionEvidence: overrides?.nextCycleExecutionCaution === "caution",
    },
    nextCycleExecutionCaution: overrides?.nextCycleExecutionCaution ?? "normal",
    householdObjectiveSummary: {
      objectiveMode: "savings" as const,
      hasExportIntent: false,
      hasImportAvoidanceIntent: true,
    },
    householdObjectiveConfidence: "clear" as const,
  };
}

function buildRuntimeJournalProjectionPayload(overrides?: {
  nextCycleExecutionCaution?: "normal" | "caution";
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
        nextCycleExecutionCaution: overrides?.nextCycleExecutionCaution,
      }),
    },
  };
}

describe("projectJournal cycle heartbeat caution projection", () => {
  it("projects 'caution' when nextCycleExecutionCaution is caution", () => {
    const output = projectJournal(buildRuntimeJournalProjectionPayload({ nextCycleExecutionCaution: "caution" }));

    expect(output.cycleHeartbeat.nextCycleExecutionCaution).toBe("caution");
  });

  it("projects 'normal' when nextCycleExecutionCaution is normal", () => {
    const output = projectJournal(buildRuntimeJournalProjectionPayload({ nextCycleExecutionCaution: "normal" }));

    expect(output.cycleHeartbeat.nextCycleExecutionCaution).toBe("normal");
  });

  it("projects undefined when nextCycleExecutionCaution is omitted", () => {
    const output = projectJournal(buildRuntimeJournalProjectionPayload({ nextCycleExecutionCaution: "normal" }));
    expect(output.cycleHeartbeat.nextCycleExecutionCaution).toBe("normal");
  });

  it("maintains field in projection output alongside other heartbeat fields", () => {
    const output = projectJournal(buildRuntimeJournalProjectionPayload({ nextCycleExecutionCaution: "caution" }));

    // Verify the heartbeat contains canonical fields alongside the new caution field
    expect(output.cycleHeartbeat).toHaveProperty("entryKind", "cycle_heartbeat");
    expect(output.cycleHeartbeat).toHaveProperty("recordedAt");
    expect(output.cycleHeartbeat).toHaveProperty("executionPosture");
    expect(output.cycleHeartbeat).toHaveProperty("hasUncertainExecutionEvidence");
    expect(output.cycleHeartbeat).toHaveProperty("nextCycleExecutionCaution", "caution");
    expect(output.cycleHeartbeat).toHaveProperty("schemaVersion");
  });

  it("does not mutate input parameters during projection", () => {
    const input = buildRuntimeJournalProjectionPayload({ nextCycleExecutionCaution: "normal" });

    const originalCaution = input.runtimeOutcomeProjection.canonicalRuntimeSignals.nextCycleExecutionCaution;

    projectJournal(input);

    expect(input.runtimeOutcomeProjection.canonicalRuntimeSignals.nextCycleExecutionCaution).toBe(originalCaution);
    expect(input.runtimeOutcomeProjection.canonicalRuntimeSignals.nextCycleExecutionCaution).toBe("normal");
  });

  it("preserves the caution value through the full projection path to output", () => {
    const output = projectJournal(buildRuntimeJournalProjectionPayload({ nextCycleExecutionCaution: "caution" }));

    // Verify value is present in both the cycleHeartbeat return and in projection.cycleHeartbeat
    expect(output.cycleHeartbeat.nextCycleExecutionCaution).toBe("caution");
    expect(output.projection.cycleHeartbeat.nextCycleExecutionCaution).toBe("caution");
    expect(output.cycleHeartbeat === output.projection.cycleHeartbeat).toBe(true);
  });
});
