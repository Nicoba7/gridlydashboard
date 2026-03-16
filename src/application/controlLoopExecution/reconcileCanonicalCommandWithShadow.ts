import type { CanonicalDeviceCommand } from "./canonicalCommand";
import type { CanonicalDeviceShadowState } from "../../shadow/deviceShadow";
import type {
  CanonicalCommandReconciliationReasonCode,
  CanonicalCommandReconciliationResult,
} from "./reconciliationTypes";

function pushExecute(
  reason: CanonicalCommandReconciliationReasonCode,
): CanonicalCommandReconciliationResult {
  return {
    action: "execute",
    reasonCodes: [reason],
  };
}

function windowsEqual(
  first?: { startAt: string; endAt: string },
  second?: { startAt: string; endAt: string },
): boolean {
  if (!first || !second) {
    return false;
  }

  return first.startAt === second.startAt && first.endAt === second.endAt;
}

/**
 * Pure desired-vs-believed reconciliation for canonical commands.
 */
export function reconcileCanonicalCommandWithShadow(
  command: CanonicalDeviceCommand,
  shadow: CanonicalDeviceShadowState | undefined,
  _now?: string,
): CanonicalCommandReconciliationResult {
  if (!shadow) {
    return pushExecute("SHADOW_STATE_MISSING");
  }

  if (shadow.deviceId !== command.targetDeviceId) {
    return pushExecute("SHADOW_STATE_INCOMPLETE");
  }

  if (command.kind === "set_mode") {
    if (!shadow.lastKnownMode) {
      return pushExecute("SHADOW_STATE_INCOMPLETE");
    }

    if (shadow.lastKnownMode !== command.mode) {
      return pushExecute("MODE_MISMATCH");
    }

    if (command.effectiveWindow && !windowsEqual(command.effectiveWindow, shadow.lastKnownWindow)) {
      return pushExecute("WINDOW_MISMATCH");
    }

    return {
      action: "skip",
      reasonCodes: ["ALREADY_SATISFIED"],
    };
  }

  if (command.kind === "set_power_limit") {
    if (shadow.lastKnownPowerW === undefined) {
      return pushExecute("SHADOW_STATE_INCOMPLETE");
    }

    if (shadow.lastKnownPowerW !== command.powerW) {
      return pushExecute("POWER_MISMATCH");
    }

    if (command.effectiveWindow && !windowsEqual(command.effectiveWindow, shadow.lastKnownWindow)) {
      return pushExecute("WINDOW_MISMATCH");
    }

    return {
      action: "skip",
      reasonCodes: ["ALREADY_SATISFIED"],
    };
  }

  if (command.kind === "schedule_window") {
    if (!shadow.lastKnownWindow || !shadow.lastKnownMode) {
      return pushExecute("SHADOW_STATE_INCOMPLETE");
    }

    if (!windowsEqual(command.effectiveWindow, shadow.lastKnownWindow)) {
      return pushExecute("WINDOW_MISMATCH");
    }

    if ((command.targetMode ?? shadow.lastKnownMode) !== shadow.lastKnownMode) {
      return pushExecute("MODE_MISMATCH");
    }

    return {
      action: "skip",
      reasonCodes: ["ALREADY_SATISFIED"],
    };
  }

  return pushExecute("COMMAND_NOT_RECONCILABLE");
}
