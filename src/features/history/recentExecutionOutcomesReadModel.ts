import type { ExecutionJournalEntry } from "../../journal/executionJournal";
import {
  toConfidenceDisplayLabel,
  toEvidenceDisplayLabel,
  toStatusDisplayLabel,
} from "./executionOutcomeDisplayNames";

export interface RecentExecutionOutcomeHistoryItem {
  id: string;
  recordedAtLabel: string;
  targetDeviceId: string;
  /** Pilot-facing display label. Canonical status unchanged on source entry. */
  status: string;
  /** Pilot-facing display label. Canonical confidence value unchanged on source entry. */
  executionConfidence?: string;
  /** Pilot-facing display label. Canonical evidence value unchanged on source entry. */
  telemetryCoherence?: string;
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

export function buildRecentExecutionOutcomesReadModel(
  recentExecutionOutcomes: ExecutionJournalEntry[],
): RecentExecutionOutcomeHistoryItem[] {
  return recentExecutionOutcomes
    .slice(0, 5)
    .map((entry) => ({
      id: entry.entryId,
      recordedAtLabel: toRecordedAtLabel(entry.recordedAt),
      targetDeviceId: entry.targetDeviceId,
      // Presentation-only mapping. Canonical status preserved on source entry.
      status: toStatusDisplayLabel(entry.status),
      // Presentation-only wording at the read-model boundary; runtime/journal truth is unchanged.
      executionConfidence: toConfidenceDisplayLabel(entry.executionConfidence),
      telemetryCoherence: toEvidenceDisplayLabel(entry.telemetryCoherence),
    }));
}
