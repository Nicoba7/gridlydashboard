import { describe, expect, it } from "vitest";
import { toExecutionJournalEntry } from "../application/controlLoopExecution/toExecutionJournalEntry";
import type { CanonicalDeviceCommand } from "../application/controlLoopExecution/canonicalCommand";
import type { CommandExecutionResult } from "../application/controlLoopExecution/types";

function buildCommand(overrides?: Partial<CanonicalDeviceCommand>): CanonicalDeviceCommand {
  return {
    kind: "set_mode",
    targetDeviceId: "battery",
    effectiveWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    mode: "charge",
    ...overrides,
  } as CanonicalDeviceCommand;
}

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

describe("toExecutionJournalEntry", () => {
  it("maps preflight validation failures to preflight stage", () => {
    const entry = toExecutionJournalEntry(
      buildCommand(),
      buildResult({ status: "failed", reasonCodes: ["COMMAND_KIND_NOT_SUPPORTED"] }),
      "2026-03-16T10:05:00.000Z",
    );

    expect(entry.stage).toBe("preflight_validation");
    expect(entry.status).toBe("failed");
    expect(entry.acknowledgementStatus).toBe("not_acknowledged");
    expect(entry.reasonCodes).toEqual(["COMMAND_KIND_NOT_SUPPORTED"]);
  });

  it("maps reconciliation skips to reconciliation stage", () => {
    const entry = toExecutionJournalEntry(
      buildCommand(),
      buildResult({ status: "skipped", reasonCodes: ["ALREADY_SATISFIED"] }),
      "2026-03-16T10:05:00.000Z",
    );

    expect(entry.stage).toBe("reconciliation");
    expect(entry.status).toBe("skipped");
    expect(entry.acknowledgementStatus).toBe("pending");
  });

  it("maps dispatch outcomes to dispatch stage", () => {
    const entry = toExecutionJournalEntry(
      buildCommand(),
      buildResult({ status: "issued", reasonCodes: undefined }),
      "2026-03-16T10:05:00.000Z",
    );

    expect(entry.stage).toBe("dispatch");
    expect(entry.acknowledgementStatus).toBe("acknowledged");
    expect(entry.executionRequestId).toBe("exec-1");
    expect(entry.idempotencyKey).toBe("idem-1");
  });
});
