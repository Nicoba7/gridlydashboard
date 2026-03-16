import type { ControlLoopResult } from "../../controlLoop/controlLoop";
import type { OptimizerOutput } from "../../domain/optimizer";
import type { CommandExecutionRequest } from "./types";

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
  | "POLICY_BLOCKED";

export interface ExecutionPolicyDecision {
  allowed: boolean;
  reasonCodes: ExecutionPolicyReasonCode[];
}

export interface ExecutionPolicyEvaluationInput {
  now: string;
  request: CommandExecutionRequest;
  controlLoopResult: ControlLoopResult;
  optimizerOutput: OptimizerOutput;
  reservedDeviceIds?: Set<string>;
}
