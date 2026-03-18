import { describe, it, expect } from "vitest";
import { projectJournal } from "../application/controlLoopExecution/stages/projectJournal";

function buildCanonicalRuntimeSignals(overrides?: {
  householdObjectiveSummary?: {
    objectiveMode: "savings" | "earnings" | "balanced";
    hasExportIntent: boolean;
    hasImportAvoidanceIntent: boolean;
  };
}) {
  return {
    outcomeSignals: [],
    executionEvidenceSummary: {
      hasUncertainExecutionEvidence: false,
    },
    nextCycleExecutionCaution: "normal" as const,
    householdObjectiveSummary: overrides?.householdObjectiveSummary ?? {
      objectiveMode: "savings" as const,
      hasExportIntent: false,
      hasImportAvoidanceIntent: true,
    },
    householdObjectiveConfidence: "clear" as const,
  };
}

function buildRuntimeJournalProjectionPayload(overrides?: {
  householdObjectiveSummary?: {
    objectiveMode: "savings" | "earnings" | "balanced";
    hasExportIntent: boolean;
    hasImportAvoidanceIntent: boolean;
  };
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
        householdObjectiveSummary: overrides?.householdObjectiveSummary,
      }),
    },
  };
}

describe("projectJournal cycle heartbeat household objective projection", () => {
  it("projects householdObjectiveSummary when present", () => {
    const output = projectJournal(buildRuntimeJournalProjectionPayload({
      householdObjectiveSummary: {
        objectiveMode: "balanced",
        hasExportIntent: true,
        hasImportAvoidanceIntent: true,
      },
    }));

    expect(output.cycleHeartbeat.householdObjectiveSummary).toEqual({
      objectiveMode: "balanced",
      hasExportIntent: true,
      hasImportAvoidanceIntent: true,
    });
  });

  it("preserves objectiveMode values without recomputation", () => {
    const values: Array<"savings" | "earnings" | "balanced"> = [
      "savings",
      "earnings",
      "balanced",
    ];

    values.forEach((objectiveMode) => {
      const output = projectJournal(buildRuntimeJournalProjectionPayload({
        householdObjectiveSummary: {
          objectiveMode,
          hasExportIntent: objectiveMode !== "savings",
          hasImportAvoidanceIntent: objectiveMode !== "earnings",
        },
      }));

      expect(output.cycleHeartbeat.householdObjectiveSummary?.objectiveMode).toBe(objectiveMode);
    });
  });

  it("does not mutate householdObjectiveSummary input", () => {
    const summary = {
      objectiveMode: "earnings" as const,
      hasExportIntent: true,
      hasImportAvoidanceIntent: false,
    };
    const original = JSON.stringify(summary);

    projectJournal(buildRuntimeJournalProjectionPayload({ householdObjectiveSummary: summary }));

    expect(JSON.stringify(summary)).toBe(original);
  });

  it("remains backward compatible when summary is omitted", () => {
    const output = projectJournal(buildRuntimeJournalProjectionPayload({
      householdObjectiveSummary: {
        objectiveMode: "savings",
        hasExportIntent: false,
        hasImportAvoidanceIntent: true,
      },
    }));

    expect(output.cycleHeartbeat.householdObjectiveSummary).toEqual({
      objectiveMode: "savings",
      hasExportIntent: false,
      hasImportAvoidanceIntent: true,
    });
  });
});
