import { describe, it, expect } from "vitest";
import { summarizeExecutionEvidenceConfidence } from "../application/controlLoopExecution/stages/assessExecutionEvidenceCoherence";
import type { CommandExecutionResult } from "../application/controlLoopExecution/types";

const mockOutcome = (overrides?: Partial<CommandExecutionResult>): CommandExecutionResult => ({
  opportunityId: "opp-1",
  executionRequestId: "req-1",
  requestId: "req-1",
  idempotencyKey: "idem-1",
  targetDeviceId: "device-1",
  commandId: "cmd-1",
  deviceId: "device-1",
  status: "issued",
  ...overrides,
});

describe("summarizeExecutionEvidenceConfidence", () => {
  it("should return true if one outcome has uncertain confidence", () => {
    const outcomes = [
      mockOutcome({ executionConfidence: "uncertain" }),
    ];

    const summary = summarizeExecutionEvidenceConfidence(outcomes);

    expect(summary.hasUncertainExecutionEvidence).toBe(true);
  });

  it("should return false if all outcomes have confirmed confidence", () => {
    const outcomes = [
      mockOutcome({ executionConfidence: "confirmed" }),
      mockOutcome({ executionConfidence: "confirmed" }),
      mockOutcome({ executionConfidence: "confirmed" }),
    ];

    const summary = summarizeExecutionEvidenceConfidence(outcomes);

    expect(summary.hasUncertainExecutionEvidence).toBe(false);
  });

  it("should return false if all outcomes have undefined confidence", () => {
    const outcomes = [
      mockOutcome({ executionConfidence: undefined }),
      mockOutcome({ executionConfidence: undefined }),
      mockOutcome({ executionConfidence: undefined }),
    ];

    const summary = summarizeExecutionEvidenceConfidence(outcomes);

    expect(summary.hasUncertainExecutionEvidence).toBe(false);
  });

  it("should return true if mixed outcomes include at least one uncertain", () => {
    const outcomes = [
      mockOutcome({ executionConfidence: "confirmed" }),
      mockOutcome({ executionConfidence: "uncertain" }),
      mockOutcome({ executionConfidence: "confirmed" }),
    ];

    const summary = summarizeExecutionEvidenceConfidence(outcomes);

    expect(summary.hasUncertainExecutionEvidence).toBe(true);
  });

  it("should return false if empty array", () => {
    const outcomes: CommandExecutionResult[] = [];

    const summary = summarizeExecutionEvidenceConfidence(outcomes);

    expect(summary.hasUncertainExecutionEvidence).toBe(false);
  });

  it("should not mutate input outcomes", () => {
    const outcomes = [
      mockOutcome({ executionConfidence: "confirmed" }),
      mockOutcome({ executionConfidence: "uncertain" }),
    ];

    const originalFirstConfidence = outcomes[0].executionConfidence;
    const originalSecondConfidence = outcomes[1].executionConfidence;

    summarizeExecutionEvidenceConfidence(outcomes);

    expect(outcomes[0].executionConfidence).toBe(originalFirstConfidence);
    expect(outcomes[1].executionConfidence).toBe(originalSecondConfidence);
  });

  it("should return consistent structure", () => {
    const outcomes = [mockOutcome()];

    const summary = summarizeExecutionEvidenceConfidence(outcomes);

    expect(summary).toHaveProperty("hasUncertainExecutionEvidence");
    expect(typeof summary.hasUncertainExecutionEvidence).toBe("boolean");
  });
});
