import { describe, it, expect } from "vitest";
import { deriveNextCycleExecutionCaution } from "../application/controlLoopExecution/service";

describe("deriveNextCycleExecutionCaution", () => {
  it("returns caution when hasUncertainExecutionEvidence is true", () => {
    const summary = {
      hasUncertainExecutionEvidence: true,
    };

    const result = deriveNextCycleExecutionCaution(summary);

    expect(result.nextCycleExecutionCaution).toBe("caution");
  });

  it("returns normal when hasUncertainExecutionEvidence is false", () => {
    const summary = {
      hasUncertainExecutionEvidence: false,
    };

    const result = deriveNextCycleExecutionCaution(summary);

    expect(result.nextCycleExecutionCaution).toBe("normal");
  });

  it("returns consistent result for same input", () => {
    const summary = {
      hasUncertainExecutionEvidence: true,
    };

    const result1 = deriveNextCycleExecutionCaution(summary);
    const result2 = deriveNextCycleExecutionCaution(summary);

    expect(result1.nextCycleExecutionCaution).toBe(result2.nextCycleExecutionCaution);
    expect(result1.nextCycleExecutionCaution).toBe("caution");
  });

  it("does not mutate input summary", () => {
    const summary = {
      hasUncertainExecutionEvidence: true,
    };
    const originalValue = summary.hasUncertainExecutionEvidence;

    deriveNextCycleExecutionCaution(summary);

    expect(summary.hasUncertainExecutionEvidence).toBe(originalValue);
  });

  it("returns properly structured result object", () => {
    const summary = {
      hasUncertainExecutionEvidence: false,
    };

    const result = deriveNextCycleExecutionCaution(summary);

    expect(result).toHaveProperty("nextCycleExecutionCaution");
    expect(typeof result.nextCycleExecutionCaution).toBe("string");
    expect(["normal", "caution"]).toContain(result.nextCycleExecutionCaution);
  });
});
