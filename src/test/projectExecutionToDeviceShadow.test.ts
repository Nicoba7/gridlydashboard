import { describe, expect, it } from "vitest";
import type { CanonicalDeviceCommand } from "../application/controlLoopExecution/canonicalCommand";
import type { CommandExecutionResult } from "../application/controlLoopExecution/types";
import { projectExecutionToDeviceShadow } from "../application/controlLoopExecution/projectExecutionToDeviceShadow";

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

describe("projectExecutionToDeviceShadow", () => {
  it("projects successful execution into a canonical shadow state", () => {
    const projected = projectExecutionToDeviceShadow(
      undefined,
      buildCommand(),
      buildResult(),
      "2026-03-16T10:05:00.000Z",
    );

    expect(projected).toEqual({
      deviceId: "battery",
      lastKnownCommand: buildCommand(),
      lastKnownMode: "charge",
      lastKnownPowerW: undefined,
      lastKnownWindow: {
        startAt: "2026-03-16T10:00:00.000Z",
        endAt: "2026-03-16T10:30:00.000Z",
      },
      lastExecutionRequestId: "exec-1",
      lastDecisionId: "decision-1",
      lastUpdatedAt: "2026-03-16T10:05:00.000Z",
      stateSource: "execution_result",
      schemaVersion: "device-shadow.v1",
    });
  });

  it("does not project failed execution", () => {
    const projected = projectExecutionToDeviceShadow(
      undefined,
      buildCommand(),
      buildResult({ status: "failed" }),
      "2026-03-16T10:05:00.000Z",
    );

    expect(projected).toBeUndefined();
  });

  it("preserves prior fields where command does not overwrite them", () => {
    const existing = {
      deviceId: "battery",
      lastKnownMode: "discharge",
      lastKnownPowerW: 2200,
      lastUpdatedAt: "2026-03-16T09:00:00.000Z",
      stateSource: "execution_result" as const,
      schemaVersion: "device-shadow.v1",
    };

    const projected = projectExecutionToDeviceShadow(
      existing,
      buildCommand({ kind: "refresh_state" }),
      buildResult(),
      "2026-03-16T10:05:00.000Z",
    );

    expect(projected?.lastKnownMode).toBe("discharge");
    expect(projected?.lastKnownPowerW).toBe(2200);
  });
});
