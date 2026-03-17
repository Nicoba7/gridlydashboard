import { describe, expect, it } from "vitest";
import { projectJournal } from "../application/controlLoopExecution/stages/projectJournal";

describe("projectJournal cycle heartbeat household objective confidence projection", () => {
  it("projects clear confidence correctly", () => {
    const output = projectJournal({
      executionEdgeContexts: [],
      outcomes: [],
      recordedAt: "2026-03-16T10:05:00.000Z",
      executionPosture: "normal",
      failClosedTriggered: false,
      rejectedOpportunities: [],
      legacyCompatibilityOutcomes: [],
      householdObjectiveConfidence: "clear",
    });

    expect(output.cycleHeartbeat.householdObjectiveConfidence).toBe("clear");
  });

  it("projects mixed confidence correctly", () => {
    const output = projectJournal({
      executionEdgeContexts: [],
      outcomes: [],
      recordedAt: "2026-03-16T10:05:00.000Z",
      executionPosture: "normal",
      failClosedTriggered: false,
      rejectedOpportunities: [],
      legacyCompatibilityOutcomes: [],
      householdObjectiveConfidence: "mixed",
    });

    expect(output.cycleHeartbeat.householdObjectiveConfidence).toBe("mixed");
  });

  it("projects empty confidence correctly", () => {
    const output = projectJournal({
      executionEdgeContexts: [],
      outcomes: [],
      recordedAt: "2026-03-16T10:05:00.000Z",
      executionPosture: "normal",
      failClosedTriggered: false,
      rejectedOpportunities: [],
      legacyCompatibilityOutcomes: [],
      householdObjectiveConfidence: "empty",
    });

    expect(output.cycleHeartbeat.householdObjectiveConfidence).toBe("empty");
  });

  it("remains backward compatible when confidence is omitted", () => {
    const output = projectJournal({
      executionEdgeContexts: [],
      outcomes: [],
      recordedAt: "2026-03-16T10:05:00.000Z",
      executionPosture: "normal",
      failClosedTriggered: false,
      rejectedOpportunities: [],
      legacyCompatibilityOutcomes: [],
    });

    expect(output.cycleHeartbeat.householdObjectiveConfidence).toBeUndefined();
  });

  it("does not mutate input parameters", () => {
    const input = {
      executionEdgeContexts: [] as any[],
      outcomes: [] as any[],
      recordedAt: "2026-03-16T10:05:00.000Z",
      executionPosture: "normal" as const,
      failClosedTriggered: false,
      rejectedOpportunities: [] as any[],
      legacyCompatibilityOutcomes: [] as any[],
      householdObjectiveConfidence: "mixed" as const,
    };

    const before = JSON.stringify(input);

    projectJournal(input);

    expect(JSON.stringify(input)).toBe(before);
    expect(input.householdObjectiveConfidence).toBe("mixed");
  });
});
