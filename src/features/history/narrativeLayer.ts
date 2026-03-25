import type { CycleHeartbeatEntry } from "../../journal/executionJournal";
import type { LatestExecutionOutcomeDetailReadModel } from "./latestExecutionOutcomeDetailReadModel";
import type { LatestOutcomeExpectationComparisonReadModel } from "./latestOutcomeExpectationComparisonReadModel";
import type { RecentExecutionOutcomeHistoryItem } from "./recentExecutionOutcomesReadModel";
import type { RecentOutcomeCountersReadModel } from "./recentOutcomeCountersReadModel";

export interface CurrentPosture {
  summary: string;
  status: "acting" | "waiting" | "monitoring" | "holding";
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface RecentOutcome {
  summary: string;
  result: "worked" | "adjusted" | "skipped" | "failed";
  impact: string;
}

export interface MonitoringState {
  summary: string;
}

export interface BuildCurrentPostureInput {
  latestCycleHeartbeat?: CycleHeartbeatEntry;
  latestExecutionOutcome?: LatestExecutionOutcomeDetailReadModel;
}

export interface BuildRecentOutcomeInput {
  latestExecutionOutcome?: LatestExecutionOutcomeDetailReadModel;
  expectedVsActual?: LatestOutcomeExpectationComparisonReadModel;
}

export interface BuildMonitoringStateInput {
  latestCycleHeartbeat?: CycleHeartbeatEntry;
  recentCycleHeartbeats?: CycleHeartbeatEntry[];
  recentExecutionOutcomes?: RecentExecutionOutcomeHistoryItem[];
  accountabilityCounters?: RecentOutcomeCountersReadModel;
}

const CONFIDENCE_BY_OBJECTIVE: Record<
  NonNullable<CycleHeartbeatEntry["householdObjectiveConfidence"]>,
  CurrentPosture["confidence"]
> = {
  clear: "high",
  mixed: "medium",
  empty: "low",
};

const CONFIDENCE_BY_CAUTION: Record<
  NonNullable<CycleHeartbeatEntry["nextCycleExecutionCaution"]>,
  CurrentPosture["confidence"]
> = {
  normal: "high",
  caution: "medium",
};

const STATUS_BY_POSTURE: Record<CycleHeartbeatEntry["executionPosture"], CurrentPosture["status"]> = {
  normal: "acting",
  conservative: "waiting",
  hold_only: "holding",
};

const RESULT_BY_OUTCOME_STATUS: Record<string, RecentOutcome["result"]> = {
  Sent: "worked",
  Skipped: "skipped",
  Failed: "failed",
  issued: "worked",
  skipped: "skipped",
  failed: "failed",
};

function toCurrentPostureConfidence(heartbeat?: CycleHeartbeatEntry): CurrentPosture["confidence"] {
  if (!heartbeat) return "medium";

  if (heartbeat.householdObjectiveConfidence) {
    return CONFIDENCE_BY_OBJECTIVE[heartbeat.householdObjectiveConfidence];
  }

  if (heartbeat.nextCycleExecutionCaution) {
    return CONFIDENCE_BY_CAUTION[heartbeat.nextCycleExecutionCaution];
  }

  return "medium";
}

function toCurrentPostureStatus(heartbeat?: CycleHeartbeatEntry): CurrentPosture["status"] {
  if (!heartbeat) return "monitoring";
  return STATUS_BY_POSTURE[heartbeat.executionPosture] ?? "monitoring";
}

function toCurrentPostureReason(
  heartbeat?: CycleHeartbeatEntry,
  latestExecutionOutcome?: LatestExecutionOutcomeDetailReadModel,
): string {
  if (heartbeat?.replanReason) return heartbeat.replanReason;
  if (heartbeat?.stalePlanWarning) return heartbeat.stalePlanWarning;

  if (heartbeat?.nextCycleExecutionCaution === "caution") {
    return "Aveum is being more careful right now.";
  }

  if (latestExecutionOutcome?.outcomeStatus) {
    return `Recent Result: ${latestExecutionOutcome.outcomeStatus}.`;
  }

  return "Using the latest home energy picture.";
}

function toCurrentPostureSummary(
  status: CurrentPosture["status"],
  confidence: CurrentPosture["confidence"],
): string {
  if (status === "acting") return `Aveum is acting now (${confidence} confidence).`;
  if (status === "waiting") return `Waiting for a better window (${confidence} confidence).`;
  if (status === "holding") return `Holding steady for now (${confidence} confidence).`;
  return `Keeping a close watch (${confidence} confidence).`;
}

function toRecentOutcomeResult(
  latestExecutionOutcome?: LatestExecutionOutcomeDetailReadModel,
): RecentOutcome["result"] {
  if (!latestExecutionOutcome?.outcomeStatus) return "adjusted";
  return RESULT_BY_OUTCOME_STATUS[latestExecutionOutcome.outcomeStatus] ?? "adjusted";
}

function toRecentOutcomeSummary(
  latestExecutionOutcome?: LatestExecutionOutcomeDetailReadModel,
  expectedVsActual?: LatestOutcomeExpectationComparisonReadModel,
): string {
  if (!latestExecutionOutcome?.outcomeStatus) {
    return "No recent action result yet.";
  }

  const result = toRecentOutcomeResult(latestExecutionOutcome);
  const plannedAction = expectedVsActual?.expectedCommandLabel || "That action";

  if (result === "worked") return `${plannedAction} worked.`;
  if (result === "skipped") return `${plannedAction} was skipped.`;
  if (result === "failed") return `${plannedAction} failed.`;
  return `${plannedAction} was adjusted.`;
}

function toRecentOutcomeImpact(
  expectedVsActual?: LatestOutcomeExpectationComparisonReadModel,
): string {
  if (!expectedVsActual) {
    return "No extra detail yet.";
  }

  const confidence = expectedVsActual.actualExecutionConfidence;
  const evidence = expectedVsActual.actualExecutionEvidence;

  if (confidence && evidence) return `Confidence: ${confidence}. Evidence: ${evidence}.`;
  if (confidence) return `Confidence: ${confidence}.`;
  if (evidence) return `Evidence: ${evidence}.`;
  return "No extra detail yet.";
}

export function buildCurrentPosture(input: BuildCurrentPostureInput): CurrentPosture {
  const confidence = toCurrentPostureConfidence(input.latestCycleHeartbeat);
  const status = toCurrentPostureStatus(input.latestCycleHeartbeat);
  const reason = toCurrentPostureReason(input.latestCycleHeartbeat, input.latestExecutionOutcome);

  return {
    summary: toCurrentPostureSummary(status, confidence),
    status,
    confidence,
    reason,
  };
}

export function buildRecentOutcome(input: BuildRecentOutcomeInput): RecentOutcome {
  const result = toRecentOutcomeResult(input.latestExecutionOutcome);

  return {
    summary: toRecentOutcomeSummary(input.latestExecutionOutcome, input.expectedVsActual),
    result,
    impact: toRecentOutcomeImpact(input.expectedVsActual),
  };
}

export function buildMonitoringState(input: BuildMonitoringStateInput): MonitoringState {
  const latestCaution = input.latestCycleHeartbeat?.nextCycleExecutionCaution;
  const failedCount = input.accountabilityCounters?.failed ?? 0;
  const uncertainCount = input.accountabilityCounters?.evidenceUncertain ?? 0;

  if (latestCaution === "caution") {
    return { summary: "Watching closely while Aveum is being more careful right now." };
  }

  if (failedCount > 0) {
    return { summary: "Watching closely after a recent issue." };
  }

  if (uncertainCount > 0) {
    return { summary: "Watching closely because a recent result needs review." };
  }

  return { summary: "Keeping a close watch on your home energy." };
}