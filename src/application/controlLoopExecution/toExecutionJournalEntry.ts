import type { ExecutionJournalEntry } from "../../journal/executionJournal";
import type { CanonicalDeviceCommand } from "./canonicalCommand";
import type { CommandExecutionResult } from "./types";
import { projectExecutionOutcome } from "./projectExecutionOutcome";

const PREFLIGHT_REASON_CODES = new Set([
  "CAPABILITIES_NOT_FOUND",
  "COMMAND_KIND_NOT_SUPPORTED",
  "POWER_SETPOINT_OUT_OF_RANGE",
  "MODE_NOT_SUPPORTED",
  "WINDOW_TOO_SHORT",
  "OVERLAPPING_WINDOW_NOT_SUPPORTED",
  "INVALID_COMMAND_FOR_DEVICE",
]);

const RECONCILIATION_REASON_CODES = new Set([
  "ALREADY_SATISFIED",
  "SHADOW_STATE_MISSING",
  "SHADOW_STATE_INCOMPLETE",
  "POWER_MISMATCH",
  "MODE_MISMATCH",
  "WINDOW_MISMATCH",
  "COMMAND_NOT_RECONCILABLE",
]);

const POLICY_REASON_CODES = new Set([
  "EXECUTION_WINDOW_NOT_ACTIVE",
  "PLANNING_WINDOW_EXPIRED",
  "PLAN_INFEASIBLE",
  "NO_ACTIONABLE_DECISION",
  "CONFLICTING_COMMAND_FOR_DEVICE",
  "COMMAND_STALE",
  "POLICY_BLOCKED",
]);

function inferStage(reasonCodes: string[] | undefined, status: CommandExecutionResult["status"]) {
  const codes = reasonCodes ?? [];

  if (codes.some((code) => PREFLIGHT_REASON_CODES.has(code))) {
    return "preflight_validation" as const;
  }

  if (codes.some((code) => POLICY_REASON_CODES.has(code))) {
    return "dispatch" as const;
  }

  if (status === "skipped" || codes.some((code) => RECONCILIATION_REASON_CODES.has(code))) {
    return "reconciliation" as const;
  }

  return "dispatch" as const;
}

/**
 * Pure projection from per-request execution outcomes to canonical journal entries.
 */
export function toExecutionJournalEntry(
  canonicalCommand: CanonicalDeviceCommand,
  executionResult: CommandExecutionResult,
  recordedAt: string,
): ExecutionJournalEntry {
  const outcomeProjection = projectExecutionOutcome(executionResult, canonicalCommand);

  return {
    entryId: `${executionResult.executionRequestId}:${recordedAt}`,
    recordedAt,
    decisionId: executionResult.decisionId,
    executionRequestId: executionResult.executionRequestId,
    idempotencyKey: executionResult.idempotencyKey,
    targetDeviceId: executionResult.targetDeviceId,
    canonicalCommand,
    status: executionResult.status,
    acknowledgementStatus: outcomeProjection.acknowledgementStatus,
    reasonCodes: executionResult.reasonCodes,
    stage: inferStage(executionResult.reasonCodes, executionResult.status),
    schemaVersion: "execution-journal.v1",
  };
}
