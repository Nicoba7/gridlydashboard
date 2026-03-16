import type { CanonicalDeviceCommand } from "./canonicalCommand";
import type { CommandExecutionResult } from "./types";
import type { CanonicalDeviceShadowState } from "../../shadow/deviceShadow";

/**
 * Pure projector from command execution outcomes into canonical shadow updates.
 */
export function projectExecutionToDeviceShadow(
  existing: CanonicalDeviceShadowState | undefined,
  canonicalCommand: CanonicalDeviceCommand,
  executionResult: CommandExecutionResult,
  now: string,
): CanonicalDeviceShadowState | undefined {
  if (executionResult.status !== "issued") {
    return undefined;
  }

  const next: CanonicalDeviceShadowState = {
    deviceId: canonicalCommand.targetDeviceId,
    lastKnownCommand: canonicalCommand,
    lastKnownMode: existing?.lastKnownMode,
    lastKnownPowerW: existing?.lastKnownPowerW,
    lastKnownWindow: canonicalCommand.effectiveWindow,
    lastExecutionRequestId: executionResult.executionRequestId,
    lastDecisionId: executionResult.decisionId,
    lastUpdatedAt: now,
    stateSource: "execution_result",
    schemaVersion: "device-shadow.v1",
  };

  if (canonicalCommand.kind === "start_charging") {
    next.lastKnownMode = "charge";
  } else if (canonicalCommand.kind === "stop_charging") {
    next.lastKnownMode = "stop";
  } else if (canonicalCommand.kind === "set_mode") {
    next.lastKnownMode = canonicalCommand.mode;
  } else if (canonicalCommand.kind === "schedule_window") {
    next.lastKnownMode = canonicalCommand.targetMode ?? existing?.lastKnownMode;
  } else if (canonicalCommand.kind === "set_power_limit") {
    next.lastKnownPowerW = canonicalCommand.powerW;
  }

  return next;
}
