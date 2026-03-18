import type { CycleHeartbeatEntry } from "../../journal/executionJournal";

export interface RecentCycleHistoryItem {
  id: string;
  recordedAtLabel: string;
  nextCycleExecutionCaution?: CycleHeartbeatEntry["nextCycleExecutionCaution"];
  householdObjectiveConfidence?: CycleHeartbeatEntry["householdObjectiveConfidence"];
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

export function buildRecentCycleHistoryReadModel(
  recentCycleHeartbeats: CycleHeartbeatEntry[],
): RecentCycleHistoryItem[] {
  return recentCycleHeartbeats
    .slice(0, 5)
    .map((heartbeat, index) => ({
      id: heartbeat.cycleId ?? `${heartbeat.recordedAt}-${index}`,
      recordedAtLabel: toRecordedAtLabel(heartbeat.recordedAt),
      nextCycleExecutionCaution: heartbeat.nextCycleExecutionCaution,
      householdObjectiveConfidence: heartbeat.householdObjectiveConfidence,
    }));
}