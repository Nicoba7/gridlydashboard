import type { CanonicalDeviceCommand } from "../application/controlLoopExecution/canonicalCommand";
import type { CommandAcknowledgementStatus } from "../application/controlLoopExecution/projectExecutionOutcome";
import type { CommandExecutionStatus } from "../application/controlLoopExecution/types";

/**
 * Canonical historical record of per-request execution outcomes.
 *
 * This is a system-level journal entry, not a vendor transport log.
 */
export interface ExecutionJournalEntry {
  entryId: string;
  recordedAt: string;
  decisionId?: string;
  executionRequestId: string;
  idempotencyKey: string;
  targetDeviceId: string;
  canonicalCommand: CanonicalDeviceCommand;
  status: CommandExecutionStatus;
  acknowledgementStatus?: CommandAcknowledgementStatus;
  reasonCodes?: string[];
  stage?: "preflight_validation" | "reconciliation" | "dispatch";
  schemaVersion: string;
}
