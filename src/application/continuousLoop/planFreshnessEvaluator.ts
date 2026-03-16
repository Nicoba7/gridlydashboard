import type { PlanFreshnessStatus, ReplanTrigger } from "./controlLoopRunnerTypes";

export interface PlanFreshnessEvaluation {
  status: PlanFreshnessStatus;
  /** Plan age in seconds at evaluation time. 0 when no plan exists. */
  planAgeSeconds: number;
  /** Primary replan trigger code for this evaluation. */
  replanTrigger?: ReplanTrigger;
  /** Human-readable reason string for persisting in journal context. */
  replanReason?: string;
}

/**
 * Evaluates how fresh the current plan is relative to the runtime clock.
 *
 * Freshness buckets:
 *   - absent  : no planGeneratedAt — the loop has never computed a plan
 *   - fresh   : age ≤ thresholdSeconds
 *   - stale   : thresholdSeconds < age ≤ 2 × thresholdSeconds
 *   - expired : age > 2 × thresholdSeconds
 *
 * "stale" triggers an opportunistic replan attempt. "expired" triggers a
 * hard replan attempt. In both cases the existing plan is retained as
 * fallback if the replan throws.
 */
export function evaluatePlanFreshness(
  planGeneratedAt: string | undefined,
  nowIso: string,
  thresholdSeconds: number,
): PlanFreshnessEvaluation {
  if (!planGeneratedAt) {
    return {
      status: "absent",
      planAgeSeconds: 0,
      replanTrigger: "no_plan",
      replanReason: "No plan has been generated yet.",
    };
  }

  const planMs = new Date(planGeneratedAt).getTime();
  const nowMs = new Date(nowIso).getTime();
  const planAgeSeconds = Math.max(0, (nowMs - planMs) / 1000);
  const thresholdMinutes = Math.round(thresholdSeconds / 60);
  const ageMinutes = Math.round(planAgeSeconds / 60);

  if (planAgeSeconds > thresholdSeconds * 2) {
    return {
      status: "expired",
      planAgeSeconds,
      replanTrigger: "expired_plan",
      replanReason: `Plan expired: ${ageMinutes} minutes old (threshold ${thresholdMinutes} minutes).`,
    };
  }

  if (planAgeSeconds > thresholdSeconds) {
    return {
      status: "stale",
      planAgeSeconds,
      replanTrigger: "stale_plan",
      replanReason: `Plan stale: ${ageMinutes} minutes old (threshold ${thresholdMinutes} minutes).`,
    };
  }

  return { status: "fresh", planAgeSeconds };
}
