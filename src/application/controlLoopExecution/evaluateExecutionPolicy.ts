import type { ExecutionPolicyDecision, ExecutionPolicyEvaluationInput } from "./executionPolicyTypes";

function toMillis(value: string): number {
  return new Date(value).getTime();
}

function isNowInWindow(nowMs: number, startAt: string, endAt: string): boolean {
  const startMs = toMillis(startAt);
  const endMs = toMillis(endAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return false;
  }

  return nowMs >= startMs && nowMs < endMs;
}

/**
 * Pure platform policy evaluator run after validation/reconciliation and before dispatch.
 */
export function evaluateExecutionPolicy(input: ExecutionPolicyEvaluationInput): ExecutionPolicyDecision {
  const reasonCodes: ExecutionPolicyDecision["reasonCodes"] = [];
  const nowMs = toMillis(input.now);

  if (!Number.isFinite(nowMs)) {
    return {
      allowed: false,
      reasonCodes: ["POLICY_BLOCKED"],
    };
  }

  if (input.optimizerOutput.feasibility && !input.optimizerOutput.feasibility.executable) {
    reasonCodes.push("PLAN_INFEASIBLE");
  }

  const planningWindow = input.optimizerOutput.planningWindow;
  if (planningWindow) {
    const planningEndMs = toMillis(planningWindow.endAt);
    if (Number.isFinite(planningEndMs) && nowMs >= planningEndMs) {
      reasonCodes.push("PLANNING_WINDOW_EXPIRED");
    }
  }

  const effectiveWindow = input.request.canonicalCommand.effectiveWindow;
  if (effectiveWindow && !isNowInWindow(nowMs, effectiveWindow.startAt, effectiveWindow.endAt)) {
    reasonCodes.push("EXECUTION_WINDOW_NOT_ACTIVE");
  }

  const requestedAtMs = toMillis(input.request.requestedAt);
  if (Number.isFinite(requestedAtMs) && nowMs - requestedAtMs > 60 * 60 * 1000) {
    reasonCodes.push("COMMAND_STALE");
  }

  const hasActionableDecision = input.controlLoopResult.activeDecisions.some((decision) => {
    if (input.request.decisionId) {
      return decision.decisionId === input.request.decisionId;
    }

    return decision.targetDeviceIds.includes(input.request.targetDeviceId);
  });

  if (!hasActionableDecision) {
    reasonCodes.push("NO_ACTIONABLE_DECISION");
  }

  if (input.reservedDeviceIds?.has(input.request.targetDeviceId)) {
    reasonCodes.push("CONFLICTING_COMMAND_FOR_DEVICE");
  }

  return {
    allowed: reasonCodes.length === 0,
    reasonCodes,
  };
}
