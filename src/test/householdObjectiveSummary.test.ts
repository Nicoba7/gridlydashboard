import { describe, expect, it } from "vitest";
import type { ExecutionCycleDecisionSummary } from "../journal/executionJournal";
import { deriveHouseholdObjectiveSummary } from "../application/controlLoopExecution/service";

function buildDecision(overrides?: Partial<ExecutionCycleDecisionSummary>): ExecutionCycleDecisionSummary {
  return {
    decisionId: "decision-1",
    action: "charge_battery",
    targetDeviceIds: ["battery"],
    ...overrides,
  };
}

describe("deriveHouseholdObjectiveSummary", () => {
  it("defaults to savings when there are no decisions", () => {
    const result = deriveHouseholdObjectiveSummary([]);

    expect(result).toEqual({
      objectiveMode: "savings",
      hasExportIntent: false,
      hasImportAvoidanceIntent: false,
    });
  });

  it("derives earnings for export-only intent", () => {
    const decisions = [
      buildDecision({
        marginalExportValue: 8,
      }),
    ];

    const result = deriveHouseholdObjectiveSummary(decisions);

    expect(result).toEqual({
      objectiveMode: "earnings",
      hasExportIntent: true,
      hasImportAvoidanceIntent: false,
    });
  });

  it("derives savings for import-avoidance-only intent", () => {
    const decisions = [
      buildDecision({
        marginalImportAvoidance: 9,
      }),
    ];

    const result = deriveHouseholdObjectiveSummary(decisions);

    expect(result).toEqual({
      objectiveMode: "savings",
      hasExportIntent: false,
      hasImportAvoidanceIntent: true,
    });
  });

  it("derives balanced when both export and import-avoidance intents are present", () => {
    const decisions = [
      buildDecision({
        marginalExportValue: 7,
      }),
      buildDecision({
        decisionId: "decision-2",
        marginalImportAvoidance: 6,
      }),
    ];

    const result = deriveHouseholdObjectiveSummary(decisions);

    expect(result).toEqual({
      objectiveMode: "balanced",
      hasExportIntent: true,
      hasImportAvoidanceIntent: true,
    });
  });

  it("does not mutate input decisions", () => {
    const decisions = [
      buildDecision({
        marginalExportValue: 6,
      }),
    ];
    const original = JSON.stringify(decisions);

    deriveHouseholdObjectiveSummary(decisions);

    expect(JSON.stringify(decisions)).toBe(original);
  });
});
