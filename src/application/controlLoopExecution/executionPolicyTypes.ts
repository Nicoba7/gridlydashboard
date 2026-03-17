import type { ControlLoopResult } from "../../controlLoop/controlLoop";
import type { OptimizerOutput } from "../../domain/optimizer";
import type { ObservedStateFreshnessSummary } from "../../domain/observedStateFreshness";
import type { CanonicalDeviceCommand } from "./canonicalCommand";
import type {
  PlanFreshnessStatus,
  ReplanTrigger,
} from "../continuousLoop/controlLoopRunnerTypes";

/**
 * Platform-level policy gate reason codes.
 *
 * This is canonical policy logic, separate from capability validation and adapters.
 */
export type ExecutionPolicyReasonCode =
  | "EXECUTION_WINDOW_NOT_ACTIVE"
  | "PLANNING_WINDOW_EXPIRED"
  | "PLAN_INFEASIBLE"
  | "NO_ACTIONABLE_DECISION"
  | "CONFLICTING_COMMAND_FOR_DEVICE"
  | "COMMAND_STALE"
  | "OBSERVED_STATE_MISSING"
  | "OBSERVED_STATE_STALE"
  | "OBSERVED_STATE_UNKNOWN"
  | "ECONOMIC_INPUTS_UNCERTAIN"
  | "ECONOMIC_TARIFF_INPUT_MISSING"
  | "ECONOMIC_CONFIDENCE_LOW"
  | "INFERIOR_ECONOMIC_VALUE"
  | "INFERIOR_HOUSEHOLD_ECONOMIC_VALUE"
  | "RUNTIME_CONSERVATIVE_MODE_ACTIVE"
  | "RUNTIME_SAFE_HOLD_ACTIVE"
  | "RUNTIME_PLAN_EXPIRED"
  | "RUNTIME_STALE_PLAN_REUSE"
  | "RUNTIME_REPLAN_GUARD_ACTIVE"
  | "RUNTIME_CONTEXT_MISSING"
  | "POLICY_BLOCKED";

export interface ExecutionPolicyDecision {
  allowed: boolean;
  reasonCodes: ExecutionPolicyReasonCode[];
}

export interface ExecutionPolicyEvaluationInput {
  now: string;
  request: {
    decisionId?: string;
    targetDeviceId: string;
    requestedAt: string;
    canonicalCommand: CanonicalDeviceCommand;
  };
  controlLoopResult: ControlLoopResult;
  optimizerOutput: OptimizerOutput;
  observedStateFreshness?: ObservedStateFreshnessSummary;
  reservedDeviceIds?: Set<string>;
}

export interface RuntimeExecutionGuardrailContext {
  safeHoldMode?: boolean;
  planFreshnessStatus?: PlanFreshnessStatus;
  replanTrigger?: ReplanTrigger;
  stalePlanReuseCount?: number;
  stalePlanWarning?: string;
}

export type RuntimeExecutionPosture = "normal" | "conservative" | "hold_only";

export type RuntimeExecutionMode = "standard" | "continuous_live_strict";
