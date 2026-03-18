/**
 * Presentation-only display name mapping for execution outcome labels.
 *
 * Canonical storage values on ExecutionJournalEntry are never changed here.
 * This file is the correct place for action/result wording — not components,
 * not the runtime, and not the journal schema.
 *
 * Extend mappings here as new canonical command kinds or modes are introduced.
 */

/**
 * Returns a pilot-facing action label for a canonical command kind + optional mode.
 * Raw values are preserved in the canonical command record; this is display only.
 */
export function toActionDisplayLabel(kind: string, mode?: string): string {
  if (kind === "set_mode") {
    if (mode === "charge") return "Start charging";
    if (mode === "discharge") return "Start discharging";
    if (mode === "hold") return "Hold";
    if (mode === "export") return "Start exporting";
    if (mode === "idle") return "Set to idle";
  }
  // Fallback: preserve raw canonical form so nothing is silently hidden
  return mode ? `${kind} ${mode}` : kind;
}

/**
 * Returns a pilot-facing result label for a canonical execution status.
 * Raw status is preserved on the journal entry; this is display only.
 */
export function toStatusDisplayLabel(status: string): string {
  if (status === "issued") return "Sent";
  if (status === "skipped") return "Skipped";
  if (status === "failed") return "Failed";
  // Fallback: preserve raw canonical form
  return status;
}

/**
 * Returns a pilot-facing confidence label for a canonical execution confidence value.
 * Raw confidence values are preserved in runtime/journal storage; this is display only.
 */
export function toConfidenceDisplayLabel(confidence?: string): string | undefined {
  if (!confidence) return undefined;
  if (confidence === "confirmed") return "Verified";
  if (confidence === "uncertain") return "Needs review";
  // Fallback: preserve raw canonical form
  return confidence;
}

/**
 * Returns a pilot-facing evidence label for a canonical telemetry coherence value.
 * Raw evidence values are preserved in runtime/journal storage; this is display only.
 */
export function toEvidenceDisplayLabel(evidence?: string): string | undefined {
  if (!evidence) return undefined;
  if (evidence === "coherent") return "Device confirmed";
  if (evidence === "stale") return "Out of date";
  // Fallback: preserve raw canonical form
  return evidence;
}
