import type { ExecutionJournalEntry } from "../../journal/executionJournal";

export interface RecentOutcomeCountersReadModel {
  issued: number;
  skipped: number;
  failed: number;
  evidenceConfirmed: number;
  evidenceUncertain: number;
}

export function buildRecentOutcomeCountersReadModel(
  recentExecutionOutcomes: ExecutionJournalEntry[],
): RecentOutcomeCountersReadModel {
  return recentExecutionOutcomes.reduce<RecentOutcomeCountersReadModel>(
    (acc, entry) => {
      if (entry.status === "issued") acc.issued += 1;
      if (entry.status === "skipped") acc.skipped += 1;
      if (entry.status === "failed") acc.failed += 1;
      if (entry.executionConfidence === "confirmed") acc.evidenceConfirmed += 1;
      if (entry.executionConfidence === "uncertain") acc.evidenceUncertain += 1;
      return acc;
    },
    {
      issued: 0,
      skipped: 0,
      failed: 0,
      evidenceConfirmed: 0,
      evidenceUncertain: 0,
    },
  );
}
