import type { ExecutionJournalEntry } from "../../journal/executionJournal";
import {
  toActionDisplayLabel,
  toConfidenceDisplayLabel,
  toEvidenceDisplayLabel,
  toStatusDisplayLabel,
} from "./executionOutcomeDisplayNames";

export interface LatestExecutionOutcomeDetailReadModel {
  id: string;
  recordedAtLabel: string;
  targetDeviceId: string;
  /** Pilot-facing display label. Canonical command kind/mode unchanged on source entry. */
  commandLabel: string;
  /** Pilot-facing display label. Canonical status unchanged on source entry. */
  outcomeStatus: string;
  /** Pilot-facing display label. Canonical confidence value unchanged on source entry. */
  executionConfidence?: string;
  /** Pilot-facing display label. Canonical evidence value unchanged on source entry. */
  executionEvidence?: string;
}

function toRecordedAtLabel(recordedAt: string): string {
  const date = new Date(recordedAt);
  if (Number.isNaN(date.getTime())) return recordedAt;

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// Presentation-only mapping. Canonical command record is read but never written.
function toCommandLabel(entry: ExecutionJournalEntry): string {
  const commandKind = entry.canonicalCommand.kind;
  const commandMode = "mode" in entry.canonicalCommand ? entry.canonicalCommand.mode : undefined;
  return toActionDisplayLabel(commandKind, commandMode);
}

export function buildLatestExecutionOutcomeDetailReadModel(
  recentExecutionOutcomes: ExecutionJournalEntry[],
): LatestExecutionOutcomeDetailReadModel | undefined {
  if (recentExecutionOutcomes.length === 0) {
    return undefined;
  }

  const latest = recentExecutionOutcomes.reduce((currentLatest, candidate) => {
    return candidate.recordedAt > currentLatest.recordedAt ? candidate : currentLatest;
  }, recentExecutionOutcomes[0]);

  return {
    id: latest.entryId,
    recordedAtLabel: toRecordedAtLabel(latest.recordedAt),
    targetDeviceId: latest.targetDeviceId,
    commandLabel: toCommandLabel(latest),
    outcomeStatus: toStatusDisplayLabel(latest.status),
    // Presentation-only wording at the read-model boundary; runtime/journal truth is unchanged.
    executionConfidence: toConfidenceDisplayLabel(latest.executionConfidence),
    executionEvidence: toEvidenceDisplayLabel(latest.telemetryCoherence),
  };
}
