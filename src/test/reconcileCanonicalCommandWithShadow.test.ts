import { describe, expect, it } from "vitest";
import type { CanonicalDeviceCommand } from "../application/controlLoopExecution/canonicalCommand";
import type { CanonicalDeviceShadowState } from "../shadow/deviceShadow";
import { reconcileCanonicalCommandWithShadow } from "../application/controlLoopExecution/reconcileCanonicalCommandWithShadow";

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

function buildShadow(overrides?: Partial<CanonicalDeviceShadowState>): CanonicalDeviceShadowState {
  return {
    deviceId: "battery",
    lastKnownCommand: buildCommand(),
    lastKnownMode: "charge",
    lastKnownPowerW: 2000,
    lastKnownWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    lastUpdatedAt: "2026-03-16T10:05:00.000Z",
    stateSource: "execution_result",
    schemaVersion: "device-shadow.v1",
    ...overrides,
  };
}

describe("reconcileCanonicalCommandWithShadow", () => {
  it("defaults to execute when shadow is missing", () => {
    const result = reconcileCanonicalCommandWithShadow(buildCommand(), undefined);

    expect(result.action).toBe("execute");
    expect(result.reasonCodes).toContain("SHADOW_STATE_MISSING");
  });

  it("skips when set_mode is already satisfied with matching window", () => {
    const result = reconcileCanonicalCommandWithShadow(buildCommand(), buildShadow());

    expect(result.action).toBe("skip");
    expect(result.reasonCodes).toEqual(["ALREADY_SATISFIED"]);
  });

  it("executes when power setpoint mismatches", () => {
    const result = reconcileCanonicalCommandWithShadow(
      buildCommand({ kind: "set_power_limit", powerW: 3000 }),
      buildShadow({ lastKnownPowerW: 2000 }),
    );

    expect(result.action).toBe("execute");
    expect(result.reasonCodes).toContain("POWER_MISMATCH");
  });

  it("executes when mode mismatches", () => {
    const result = reconcileCanonicalCommandWithShadow(
      buildCommand({ mode: "discharge" }),
      buildShadow({ lastKnownMode: "charge" }),
    );

    expect(result.action).toBe("execute");
    expect(result.reasonCodes).toContain("MODE_MISMATCH");
  });

  it("executes when shadow is incomplete", () => {
    const result = reconcileCanonicalCommandWithShadow(
      buildCommand(),
      buildShadow({ lastKnownMode: undefined }),
    );

    expect(result.action).toBe("execute");
    expect(result.reasonCodes).toContain("SHADOW_STATE_INCOMPLETE");
  });
});
