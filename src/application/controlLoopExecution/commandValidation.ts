import type { CanonicalDeviceCommand } from "./canonicalCommand";
import type { DeviceCapabilities } from "../../capabilities/deviceCapabilities";

export type CanonicalCommandValidationReasonCode =
  | "CAPABILITIES_NOT_FOUND"
  | "COMMAND_KIND_NOT_SUPPORTED"
  | "POWER_SETPOINT_OUT_OF_RANGE"
  | "MODE_NOT_SUPPORTED"
  | "WINDOW_TOO_SHORT"
  | "OVERLAPPING_WINDOW_NOT_SUPPORTED"
  | "INVALID_COMMAND_FOR_DEVICE";

export interface CanonicalCommandValidationResult {
  valid: boolean;
  reasonCodes: CanonicalCommandValidationReasonCode[];
}

function windowDurationMinutes(command: CanonicalDeviceCommand): number | undefined {
  if (!command.effectiveWindow) {
    return undefined;
  }

  const startMs = new Date(command.effectiveWindow.startAt).getTime();
  const endMs = new Date(command.effectiveWindow.endAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }

  return (endMs - startMs) / 60000;
}

/**
 * Pure preflight validation of canonical commands against canonical capabilities.
 */
export function validateCanonicalCommandAgainstCapabilities(
  command: CanonicalDeviceCommand,
  capabilities: DeviceCapabilities | undefined,
  now?: string,
): CanonicalCommandValidationResult {
  const reasonCodes: CanonicalCommandValidationReasonCode[] = [];

  if (!capabilities) {
    return {
      valid: false,
      reasonCodes: ["CAPABILITIES_NOT_FOUND"],
    };
  }

  if (capabilities.deviceId !== command.targetDeviceId) {
    reasonCodes.push("INVALID_COMMAND_FOR_DEVICE");
  }

  if (!capabilities.supportedCommandKinds.includes(command.kind)) {
    reasonCodes.push("COMMAND_KIND_NOT_SUPPORTED");
  }

  if (command.kind === "set_mode" && capabilities.supportedModes && !capabilities.supportedModes.includes(command.mode)) {
    reasonCodes.push("MODE_NOT_SUPPORTED");
  }

  if (
    command.kind === "schedule_window" &&
    command.targetMode &&
    capabilities.supportedModes &&
    !capabilities.supportedModes.includes(command.targetMode)
  ) {
    reasonCodes.push("MODE_NOT_SUPPORTED");
  }

  if (command.kind === "set_power_limit" && capabilities.powerRangeW) {
    if (command.powerW < capabilities.powerRangeW.min || command.powerW > capabilities.powerRangeW.max) {
      reasonCodes.push("POWER_SETPOINT_OUT_OF_RANGE");
    }
  }

  const durationMinutes = windowDurationMinutes(command);
  if (
    durationMinutes !== undefined &&
    capabilities.minimumCommandWindowMinutes !== undefined &&
    durationMinutes < capabilities.minimumCommandWindowMinutes
  ) {
    reasonCodes.push("WINDOW_TOO_SHORT");
  }

  if (
    durationMinutes !== undefined &&
    capabilities.supportsOverlappingWindows === false &&
    now &&
    command.effectiveWindow
  ) {
    const nowMs = new Date(now).getTime();
    const startMs = new Date(command.effectiveWindow.startAt).getTime();
    if (Number.isFinite(nowMs) && Number.isFinite(startMs) && startMs < nowMs) {
      reasonCodes.push("OVERLAPPING_WINDOW_NOT_SUPPORTED");
    }
  }

  if (!command.effectiveWindow && capabilities.supportsImmediateExecution === false) {
    reasonCodes.push("INVALID_COMMAND_FOR_DEVICE");
  }

  return {
    valid: reasonCodes.length === 0,
    reasonCodes,
  };
}
