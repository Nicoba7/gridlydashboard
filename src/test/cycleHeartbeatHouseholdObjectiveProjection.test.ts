import { describe, it, expect } from "vitest";
import { projectJournal } from "../application/controlLoopExecution/stages/projectJournal";

describe("projectJournal cycle heartbeat household objective projection", () => {
  it("projects householdObjectiveSummary when present", () => {
    const output = projectJournal({
      executionEdgeContexts: [],
      outcomes: [],
      recordedAt: "2026-03-16T10:05:00.000Z",
      executionPosture: "normal",
      failClosedTriggered: false,
      rejectedOpportunities: [],
      legacyCompatibilityOutcomes: [],
      householdObjectiveSummary: {
        objectiveMode: "balanced",
        hasExportIntent: true,
        hasImportAvoidanceIntent: true,
      },
    });

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
      const output = projectJournal({
        executionEdgeContexts: [],
        outcomes: [],
        recordedAt: "2026-03-16T10:05:00.000Z",
        executionPosture: "normal",
        failClosedTriggered: false,
        rejectedOpportunities: [],
        legacyCompatibilityOutcomes: [],
        householdObjectiveSummary: {
          objectiveMode,
          hasExportIntent: objectiveMode !== "savings",
          hasImportAvoidanceIntent: objectiveMode !== "earnings",
        },
      });

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

    projectJournal({
      executionEdgeContexts: [],
      outcomes: [],
      recordedAt: "2026-03-16T10:05:00.000Z",
      executionPosture: "normal",
      failClosedTriggered: false,
      rejectedOpportunities: [],
      legacyCompatibilityOutcomes: [],
      householdObjectiveSummary: summary,
    });

    expect(JSON.stringify(summary)).toBe(original);
  });

  it("remains backward compatible when summary is omitted", () => {
    const output = projectJournal({
      executionEdgeContexts: [],
      outcomes: [],
      recordedAt: "2026-03-16T10:05:00.000Z",
      executionPosture: "normal",
      failClosedTriggered: false,
      rejectedOpportunities: [],
      legacyCompatibilityOutcomes: [],
    });

    expect(output.cycleHeartbeat.householdObjectiveSummary).toBeUndefined();
  });
});
