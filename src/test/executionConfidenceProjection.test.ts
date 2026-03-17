import { describe, expect, it } from "vitest";
import { toExecutionJournalEntry } from "../application/controlLoopExecution/toExecutionJournalEntry";
import type { CommandExecutionResult } from "../application/controlLoopExecution/types";

function buildExecutionResult(overrides?: Partial<CommandExecutionResult>): CommandExecutionResult {
  return {
    opportunityId: "opp-1",
    executionRequestId: "exec-1",
    requestId: "exec-1",
    idempotencyKey: "plan-1:decision-1:cmd-1",
    decisionId: "decision-1",
    targetDeviceId: "battery",
    commandId: "cmd-1",
    deviceId: "battery",
    status: "issued",
    ...overrides,
  };
}

const canonicalCommand = {
  kind: "set_mode" as const,
  targetDeviceId: "battery",
  mode: "charge" as const,
};

describe("executionConfidence projection through journal", () => {
  it("projects executionConfidence when set to confirmed", () => {
    const result = buildExecutionResult({
      telemetryCoherence: "coherent",
      executionConfidence: "confirmed",
    });

    const entry = toExecutionJournalEntry(canonicalCommand, result, "2026-03-17T10:05:00.000Z");

    expect(entry.telemetryCoherence).toBe("coherent");
    expect(entry.executionConfidence).toBe("confirmed");
  });

  it("projects executionConfidence when set to uncertain", () => {
    const result = buildExecutionResult({
      telemetryCoherence: "stale",
      executionConfidence: "uncertain",
    });

    const entry = toExecutionJournalEntry(canonicalCommand, result, "2026-03-17T10:05:00.000Z");

    expect(entry.telemetryCoherence).toBe("stale");
    expect(entry.executionConfidence).toBe("uncertain");
  });

  it("projects telemetryCoherence without executionConfidence when absent", () => {
    const result = buildExecutionResult({
      telemetryCoherence: "delayed",
      executionConfidence: undefined,
    });

    const entry = toExecutionJournalEntry(canonicalCommand, result, "2026-03-17T10:05:00.000Z");

    expect(entry.telemetryCoherence).toBe("delayed");
    expect(entry.executionConfidence).toBeUndefined();
  });

  it("remains undefined for both fields when neither is set", () => {
    const result = buildExecutionResult({
      telemetryCoherence: undefined,
      executionConfidence: undefined,
    });

    const entry = toExecutionJournalEntry(canonicalCommand, result, "2026-03-17T10:05:00.000Z");

    expect(entry.telemetryCoherence).toBeUndefined();
    expect(entry.executionConfidence).toBeUndefined();
  });

  it("projects both fields for failed execution outcomes", () => {
    const result = buildExecutionResult({
      status: "failed",
      telemetryCoherence: "delayed",
      executionConfidence: "uncertain",
    });

    const entry = toExecutionJournalEntry(canonicalCommand, result, "2026-03-17T10:05:00.000Z");

    expect(entry.status).toBe("failed");
    expect(entry.telemetryCoherence).toBe("delayed");
    expect(entry.executionConfidence).toBe("uncertain");
  });

  it("does not alter telemetryCoherence or executionConfidence during projection", () => {
    const result = buildExecutionResult({
      telemetryCoherence: "coherent",
      executionConfidence: "confirmed",
    });

    const entry = toExecutionJournalEntry(canonicalCommand, result, "2026-03-17T10:05:00.000Z");

    expect(entry.telemetryCoherence).toStrictEqual(result.telemetryCoherence);
    expect(entry.executionConfidence).toStrictEqual(result.executionConfidence);
  });
});
