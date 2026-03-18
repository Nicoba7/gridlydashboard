import { describe, expect, it } from "vitest";
import { projectJournal } from "../application/controlLoopExecution/stages/projectJournal";

function buildCanonicalRuntimeSignals(overrides?: {
  householdObjectiveConfidence?: "clear" | "mixed" | "empty";
}) {
  return {
    outcomeSignals: [],
    executionEvidenceSummary: {
      hasUncertainExecutionEvidence: false,
    },
    nextCycleExecutionCaution: "normal" as const,
    householdObjectiveSummary: {
      objectiveMode: "savings" as const,
      hasExportIntent: false,
      hasImportAvoidanceIntent: true,
    },
    householdObjectiveConfidence: overrides?.householdObjectiveConfidence ?? "clear",
  };
}

function buildRuntimeJournalProjectionPayload(overrides?: {
  householdObjectiveConfidence?: "clear" | "mixed" | "empty";
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
        householdObjectiveConfidence: overrides?.householdObjectiveConfidence,
      }),
    },
  };
}

describe("projectJournal cycle heartbeat household objective confidence projection", () => {
  it("projects clear confidence correctly", () => {
    const output = projectJournal(buildRuntimeJournalProjectionPayload({ householdObjectiveConfidence: "clear" }));

    expect(output.cycleHeartbeat.householdObjectiveConfidence).toBe("clear");
  });

  it("projects mixed confidence correctly", () => {
    const output = projectJournal(buildRuntimeJournalProjectionPayload({ householdObjectiveConfidence: "mixed" }));

    expect(output.cycleHeartbeat.householdObjectiveConfidence).toBe("mixed");
  });

  it("projects empty confidence correctly", () => {
    const output = projectJournal(buildRuntimeJournalProjectionPayload({ householdObjectiveConfidence: "empty" }));

    expect(output.cycleHeartbeat.householdObjectiveConfidence).toBe("empty");
  });

  it("remains backward compatible when confidence is omitted", () => {
    const output = projectJournal(buildRuntimeJournalProjectionPayload({ householdObjectiveConfidence: "clear" }));

    expect(output.cycleHeartbeat.householdObjectiveConfidence).toBe("clear");
  });

  it("does not mutate input parameters", () => {
    const input = buildRuntimeJournalProjectionPayload({ householdObjectiveConfidence: "mixed" });

    const before = JSON.stringify(input);

    projectJournal(input);

    expect(JSON.stringify(input)).toBe(before);
    expect(input.runtimeOutcomeProjection.canonicalRuntimeSignals.householdObjectiveConfidence).toBe("mixed");
  });
});
