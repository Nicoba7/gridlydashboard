/**
 * Desired-vs-believed command reconciliation result.
 *
 * This is canonical Gridly logic and does not use vendor telemetry payloads.
 */
export type CanonicalCommandReconciliationAction = "execute" | "skip";

export type CanonicalCommandReconciliationReasonCode =
  | "ALREADY_SATISFIED"
  | "SHADOW_STATE_MISSING"
  | "SHADOW_STATE_INCOMPLETE"
  | "POWER_MISMATCH"
  | "MODE_MISMATCH"
  | "WINDOW_MISMATCH"
  | "COMMAND_NOT_RECONCILABLE";

export interface CanonicalCommandReconciliationResult {
  action: CanonicalCommandReconciliationAction;
  reasonCodes: CanonicalCommandReconciliationReasonCode[];
}
