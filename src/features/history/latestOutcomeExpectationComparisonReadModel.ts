import type { ExecutionJournalEntry } from "../../journal/executionJournal";
import {
  toActionDisplayLabel,
  toConfidenceDisplayLabel,
  toEvidenceDisplayLabel,
  toStatusDisplayLabel,
} from "./executionOutcomeDisplayNames";

export interface LatestOutcomeExpectationComparisonReadModel {
  recordedAtLabel: string;
  /** Pilot-facing display label. Canonical command kind/mode unchanged on source entry. */
  expectedCommandLabel: string;
  expectedTargetDeviceId: string;
  /** Pilot-facing display label. Canonical status unchanged on source entry. */
  actualOutcomeStatus: string;
  /** Pilot-facing display label. Canonical confidence value unchanged on source entry. */
  actualExecutionConfidence?: string;
  /** Pilot-facing display label. Canonical evidence value unchanged on source entry. */
  actualExecutionEvidence?: string;
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

export function buildLatestOutcomeExpectationComparisonReadModel(
  recentExecutionOutcomes: ExecutionJournalEntry[],
): LatestOutcomeExpectationComparisonReadModel | undefined {
  if (recentExecutionOutcomes.length === 0) {
    return undefined;
  }

  const latest = recentExecutionOutcomes.reduce((currentLatest, candidate) => {
    return candidate.recordedAt > currentLatest.recordedAt ? candidate : currentLatest;
  }, recentExecutionOutcomes[0]);

  return {
    recordedAtLabel: toRecordedAtLabel(latest.recordedAt),
    expectedCommandLabel: toCommandLabel(latest),
    expectedTargetDeviceId: latest.targetDeviceId,
    actualOutcomeStatus: toStatusDisplayLabel(latest.status),
    // Presentation-only wording at the read-model boundary; runtime/journal truth is unchanged.
    actualExecutionConfidence: toConfidenceDisplayLabel(latest.executionConfidence),
    actualExecutionEvidence: toEvidenceDisplayLabel(latest.telemetryCoherence),
  };
}
