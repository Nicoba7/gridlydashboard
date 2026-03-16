import type { CanonicalDeviceCommand } from "./canonicalCommand";
import type { CommandExecutionResult } from "./types";

/**
 * Canonical acknowledgement interpretation status.
 *
 * This is execution-outcome interpretation, not vendor transport data or telemetry.
 */
export type CommandAcknowledgementStatus =
  | "acknowledged"
  | "pending"
  | "not_acknowledged"
  | "unknown";

export type CommandOutcomeProjectionReasonCode =
  | "OUTCOME_ACKNOWLEDGED"
  | "OUTCOME_SKIPPED"
  | "OUTCOME_NOT_ACKNOWLEDGED"
  | "OUTCOME_UNKNOWN";

export interface CommandOutcomeProjection {
  acknowledgementStatus: CommandAcknowledgementStatus;
  shouldUpdateShadow: boolean;
  reasonCodes: CommandOutcomeProjectionReasonCode[];
}

/**
 * Pure interpretation from command execution outcome to acknowledgement semantics.
 */
export function projectExecutionOutcome(
  executionResult: CommandExecutionResult,
  _canonicalCommand?: CanonicalDeviceCommand,
): CommandOutcomeProjection {
  if (executionResult.status === "issued") {
    return {
      acknowledgementStatus: "acknowledged",
      shouldUpdateShadow: true,
      reasonCodes: ["OUTCOME_ACKNOWLEDGED"],
    };
  }

  if (executionResult.status === "skipped") {
    return {
      acknowledgementStatus: "pending",
      shouldUpdateShadow: false,
      reasonCodes: ["OUTCOME_SKIPPED"],
    };
  }

  if (executionResult.status === "failed") {
    return {
      acknowledgementStatus: "not_acknowledged",
      shouldUpdateShadow: false,
      reasonCodes: ["OUTCOME_NOT_ACKNOWLEDGED"],
    };
  }

  return {
    acknowledgementStatus: "unknown",
    shouldUpdateShadow: false,
    reasonCodes: ["OUTCOME_UNKNOWN"],
  };
}
