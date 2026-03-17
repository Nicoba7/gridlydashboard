import { describe, expect, it } from "vitest";
import { deriveHouseholdObjectiveConfidence } from "../application/controlLoopExecution/service";

describe("deriveHouseholdObjectiveConfidence", () => {
  it("returns empty when objective has no intent signals", () => {
    const summary = {
      objectiveMode: "savings" as const,
      hasExportIntent: false,
      hasImportAvoidanceIntent: false,
    };

    const result = deriveHouseholdObjectiveConfidence(summary);

    expect(result).toEqual({ householdObjectiveConfidence: "empty" });
  });

  it("returns clear for savings-only intent", () => {
    const summary = {
      objectiveMode: "savings" as const,
      hasExportIntent: false,
      hasImportAvoidanceIntent: true,
    };

    const result = deriveHouseholdObjectiveConfidence(summary);

    expect(result).toEqual({ householdObjectiveConfidence: "clear" });
  });

  it("returns clear for earnings-only intent", () => {
    const summary = {
      objectiveMode: "earnings" as const,
      hasExportIntent: true,
      hasImportAvoidanceIntent: false,
    };

    const result = deriveHouseholdObjectiveConfidence(summary);

    expect(result).toEqual({ householdObjectiveConfidence: "clear" });
  });

  it("returns mixed for balanced/both-intent objective", () => {
    const summary = {
      objectiveMode: "balanced" as const,
      hasExportIntent: true,
      hasImportAvoidanceIntent: true,
    };

    const result = deriveHouseholdObjectiveConfidence(summary);

    expect(result).toEqual({ householdObjectiveConfidence: "mixed" });
  });

  it("does not mutate input summary", () => {
    const summary = {
      objectiveMode: "earnings" as const,
      hasExportIntent: true,
      hasImportAvoidanceIntent: false,
    };
    const before = JSON.stringify(summary);

    deriveHouseholdObjectiveConfidence(summary);

    expect(JSON.stringify(summary)).toBe(before);
  });
});
