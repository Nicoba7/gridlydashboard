import type { CycleHeartbeatEntry, ExecutionJournalEntry } from "./executionJournal";

type Listener = () => void;

let latestCycleHeartbeat: CycleHeartbeatEntry | undefined;
let recentCycleHeartbeats: CycleHeartbeatEntry[] = [];
let recentExecutionOutcomes: ExecutionJournalEntry[] = [];
const listeners = new Set<Listener>();
const MAX_RECENT_CYCLE_HEARTBEATS = 5;
const MAX_RECENT_EXECUTION_OUTCOMES = 6;

/**
 * First shared runtime/session seam for latest cycle heartbeat truth.
 *
 * Runtime or journal-owning layers may write to this source.
 * UI layers may subscribe and render it, but must never compute or produce it.
 */
export function getLatestCycleHeartbeat(): CycleHeartbeatEntry | undefined {
  return latestCycleHeartbeat;
}

export function getRecentCycleHeartbeats(): CycleHeartbeatEntry[] {
  return recentCycleHeartbeats;
}

export function getRecentExecutionOutcomes(): ExecutionJournalEntry[] {
  return recentExecutionOutcomes;
}

export function pushRecentExecutionOutcomes(entries: ExecutionJournalEntry[]): void {
  if (entries.length === 0) {
    return;
  }

  const normalizedEntries = entries.map((entry) => ({ ...entry }));
  const deduped = [...normalizedEntries, ...recentExecutionOutcomes]
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.entryId === entry.entryId) === index);

  recentExecutionOutcomes = deduped.slice(0, MAX_RECENT_EXECUTION_OUTCOMES);
  listeners.forEach((listener) => listener());
}

export function setLatestCycleHeartbeat(entry: CycleHeartbeatEntry | undefined): void {
  latestCycleHeartbeat = entry ? { ...entry } : undefined;

  if (!entry) {
    recentCycleHeartbeats = [];
    recentExecutionOutcomes = [];
    listeners.forEach((listener) => listener());
    return;
  }

  const normalizedEntry = { ...entry };
  recentCycleHeartbeats = [normalizedEntry, ...recentCycleHeartbeats]
    .slice(0, MAX_RECENT_CYCLE_HEARTBEATS);

  listeners.forEach((listener) => listener());
}

export function subscribeLatestCycleHeartbeat(listener: Listener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}