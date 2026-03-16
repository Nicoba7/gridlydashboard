import { describe, expect, it } from "vitest";
import { projectExecutionOutcome } from "../application/controlLoopExecution/projectExecutionOutcome";
import type { CommandExecutionResult } from "../application/controlLoopExecution/types";

function buildResult(overrides?: Partial<CommandExecutionResult>): CommandExecutionResult {
  return {
    executionRequestId: "exec-1",
    requestId: "exec-1",
    idempotencyKey: "idem-1",
    decisionId: "decision-1",
    targetDeviceId: "battery",
    commandId: "cmd-1",
    deviceId: "battery",
    status: "issued",
    ...overrides,
  };
}

describe("projectExecutionOutcome", () => {
  it("projects issued outcomes as acknowledged and shadow-updatable", () => {
    const projection = projectExecutionOutcome(buildResult({ status: "issued" }));

    expect(projection.acknowledgementStatus).toBe("acknowledged");
    expect(projection.shouldUpdateShadow).toBe(true);
    expect(projection.reasonCodes).toEqual(["OUTCOME_ACKNOWLEDGED"]);
  });

  it("projects skipped outcomes as pending and non-updatable", () => {
    const projection = projectExecutionOutcome(buildResult({ status: "skipped" }));

    expect(projection.acknowledgementStatus).toBe("pending");
    expect(projection.shouldUpdateShadow).toBe(false);
    expect(projection.reasonCodes).toEqual(["OUTCOME_SKIPPED"]);
  });

  it("projects failed outcomes as not acknowledged and non-updatable", () => {
    const projection = projectExecutionOutcome(buildResult({ status: "failed" }));

    expect(projection.acknowledgementStatus).toBe("not_acknowledged");
    expect(projection.shouldUpdateShadow).toBe(false);
    expect(projection.reasonCodes).toEqual(["OUTCOME_NOT_ACKNOWLEDGED"]);
  });
});
