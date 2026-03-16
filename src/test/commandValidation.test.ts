import { describe, expect, it } from "vitest";
import type { CanonicalDeviceCommand } from "../application/controlLoopExecution/canonicalCommand";
import type { DeviceCapabilities } from "../capabilities/deviceCapabilities";
import { validateCanonicalCommandAgainstCapabilities } from "../application/controlLoopExecution/commandValidation";

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

function buildCapabilities(overrides?: Partial<DeviceCapabilities>): DeviceCapabilities {
  return {
    deviceId: "battery",
    supportedCommandKinds: ["set_mode", "set_power_limit", "schedule_window"],
    powerRangeW: { min: 500, max: 7000 },
    supportedModes: ["charge", "discharge"],
    minimumCommandWindowMinutes: 15,
    supportsOverlappingWindows: true,
    supportsImmediateExecution: true,
    schemaVersion: "capabilities.v1",
    ...overrides,
  };
}

describe("validateCanonicalCommandAgainstCapabilities", () => {
  it("returns CAPABILITIES_NOT_FOUND when missing", () => {
    const result = validateCanonicalCommandAgainstCapabilities(buildCommand(), undefined);

    expect(result.valid).toBe(false);
    expect(result.reasonCodes).toEqual(["CAPABILITIES_NOT_FOUND"]);
  });

  it("returns COMMAND_KIND_NOT_SUPPORTED when command kind unsupported", () => {
    const result = validateCanonicalCommandAgainstCapabilities(
      buildCommand({ kind: "refresh_state" }),
      buildCapabilities({ supportedCommandKinds: ["set_mode"] }),
    );

    expect(result.valid).toBe(false);
    expect(result.reasonCodes).toContain("COMMAND_KIND_NOT_SUPPORTED");
  });

  it("returns MODE_NOT_SUPPORTED when mode is not allowed", () => {
    const result = validateCanonicalCommandAgainstCapabilities(
      buildCommand({ mode: "eco" }),
      buildCapabilities({ supportedModes: ["charge"] }),
    );

    expect(result.valid).toBe(false);
    expect(result.reasonCodes).toContain("MODE_NOT_SUPPORTED");
  });

  it("returns POWER_SETPOINT_OUT_OF_RANGE when setpoint is outside range", () => {
    const result = validateCanonicalCommandAgainstCapabilities(
      buildCommand({ kind: "set_power_limit", powerW: 9000 }),
      buildCapabilities(),
    );

    expect(result.valid).toBe(false);
    expect(result.reasonCodes).toContain("POWER_SETPOINT_OUT_OF_RANGE");
  });

  it("returns WINDOW_TOO_SHORT when command window is shorter than minimum", () => {
    const result = validateCanonicalCommandAgainstCapabilities(
      buildCommand({
        effectiveWindow: {
          startAt: "2026-03-16T10:00:00.000Z",
          endAt: "2026-03-16T10:05:00.000Z",
        },
      }),
      buildCapabilities({ minimumCommandWindowMinutes: 15 }),
    );

    expect(result.valid).toBe(false);
    expect(result.reasonCodes).toContain("WINDOW_TOO_SHORT");
  });
});
