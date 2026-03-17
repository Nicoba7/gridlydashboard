import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  DeviceCommandExecutor,
  ExecutionEconomicArbitrationTrace,
} from "../types";
import type { RuntimeExecutionPosture } from "../executionPolicyTypes";
import type {
  ExecutionPlan,
  ExecutionResult,
  RejectedOpportunity,
} from "../pipelineTypes";

function withExecutionPosture(
  results: CommandExecutionResult[],
  executionPosture: RuntimeExecutionPosture,
): CommandExecutionResult[] {
  return results.map((result) => ({
    ...result,
    executionPosture,
  }));
}

function attachEconomicArbitrationTraces(
  results: CommandExecutionResult[],
  traces: Map<string, ExecutionEconomicArbitrationTrace>,
): CommandExecutionResult[] {
  return results.map((result) => {
    const economicArbitration = traces.get(result.executionRequestId);
    return economicArbitration ? { ...result, economicArbitration } : result;
  });
}

function mapFailedResults(
  requests: CommandExecutionRequest[],
  error: unknown,
): CommandExecutionResult[] {
  const message = error instanceof Error ? error.message : "Device command execution failed.";

  return requests.map((request) => ({
    opportunityId: request.opportunityId,
    executionRequestId: request.executionRequestId,
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    decisionId: request.decisionId,
    targetDeviceId: request.targetDeviceId,
    commandId: request.commandId,
    deviceId: request.targetDeviceId,
    status: "failed",
    message,
    errorCode: "EXECUTOR_ERROR",
    reasonCodes: ["EXECUTOR_ERROR"],
  }));
}

function classifyExecutionResultKind(results: CommandExecutionResult[]): "executed" | "partially_executed" {
  const allIssued = results.length > 0 && results.every((result) => result.status === "issued");
  return allIssued ? "executed" : "partially_executed";
}

export interface ExecutePlanInput {
  /** Canonical execution plan from planning stage. */
  plan: ExecutionPlan;
  /** Transitional edge payload for adapter dispatch only; not canonical plan state. */
  dispatchableRequests: CommandExecutionRequest[];
  executor: DeviceCommandExecutor;
  /** Transitional request-centric outcomes accumulated before adapter dispatch. */
  preExecutionOutcomes: CommandExecutionResult[];
  selectedEconomicTraces: Map<string, ExecutionEconomicArbitrationTrace>;
  executionPosture: RuntimeExecutionPosture;
  /** Canonical rejections accumulated across upstream stages in deterministic order. */
  rejectedOpportunities: RejectedOpportunity[];
}

export interface ExecutePlanOutput {
  execution: ExecutionResult;
  outcomes: CommandExecutionResult[];
  dispatchableRequests: CommandExecutionRequest[];
  adapterResults: CommandExecutionResult[];
}

/**
 * Executes a canonical plan through the adapter boundary and shapes execution outcomes.
 *
 * Owns: adapter invocation, adapter-result collection, and canonical
 * `ExecutionResult` shaping.
 *
 * Must not: perform economic reasoning or alter opportunity selection.
 *
 * Invariants:
 * - non-executable plans do not dispatch adapter requests
 * - executable plans should provide at least one dispatchable request
 * - compatibility outcomes remain edge-only and are never written into canonical plan types
 */
export async function executePlan(
  params: ExecutePlanInput,
): Promise<ExecutePlanOutput> {
  if (params.plan.kind === "non_executable") {
    const safeDispatchableRequests = [] as CommandExecutionRequest[];
    return {
      execution: {
        kind: "non_executed",
        executionPlan: params.plan,
        householdDecision: params.plan.householdDecision,
        selectedOpportunityId: undefined,
        commandResults: [],
        rejectedOpportunities: params.rejectedOpportunities,
        executionPosture: params.executionPosture,
      },
      outcomes: withExecutionPosture([...params.preExecutionOutcomes], params.executionPosture),
      dispatchableRequests: safeDispatchableRequests,
      adapterResults: [],
    };
  }

  const executablePlan = params.plan;
  const dispatchableRequests = params.dispatchableRequests;
  if (dispatchableRequests.length === 0) {
    return {
      execution: {
        kind: "non_executed",
        executionPlan: {
          kind: "non_executable",
          householdDecision: {
            kind: "no_action",
            rejectedOpportunities: params.rejectedOpportunities,
            reasonCodes: ["EXECUTION_PLAN_EMPTY_COMMAND_SET"],
            decisionReason: "No executable commands remained after execution planning.",
          },
          reasonCodes: ["EXECUTION_PLAN_EMPTY_COMMAND_SET"],
          decisionReason: "No executable commands remained after execution planning.",
          commands: [],
        },
        householdDecision: {
          kind: "no_action",
          rejectedOpportunities: params.rejectedOpportunities,
          reasonCodes: ["EXECUTION_PLAN_EMPTY_COMMAND_SET"],
          decisionReason: "No executable commands remained after execution planning.",
        },
        selectedOpportunityId: undefined,
        commandResults: [],
        rejectedOpportunities: params.rejectedOpportunities,
        executionPosture: params.executionPosture,
      },
      outcomes: withExecutionPosture([...params.preExecutionOutcomes], params.executionPosture),
      dispatchableRequests: [],
      adapterResults: [],
    };
  }

  try {
    const adapterResults = attachEconomicArbitrationTraces(
      await params.executor.execute(dispatchableRequests),
      params.selectedEconomicTraces,
    );

    const outcomes = withExecutionPosture(
      [...params.preExecutionOutcomes, ...adapterResults],
      params.executionPosture,
    );

    const kind = classifyExecutionResultKind(adapterResults);
    const execution: ExecutionResult = {
      kind,
      executionPlan: executablePlan,
      householdDecision: executablePlan.householdDecision,
      selectedOpportunityId: executablePlan.selectedOpportunityId,
      commandResults: adapterResults,
      rejectedOpportunities: params.rejectedOpportunities,
      executionPosture: params.executionPosture,
    };

    return {
      execution,
      outcomes,
      dispatchableRequests,
      adapterResults,
    };
  } catch (error) {
    const adapterResults = attachEconomicArbitrationTraces(
      mapFailedResults(dispatchableRequests, error),
      params.selectedEconomicTraces,
    );

    const outcomes = withExecutionPosture(
      [...params.preExecutionOutcomes, ...adapterResults],
      params.executionPosture,
    );

    return {
      execution: {
        kind: "partially_executed",
        executionPlan: executablePlan,
        householdDecision: executablePlan.householdDecision,
        selectedOpportunityId: executablePlan.selectedOpportunityId,
        commandResults: adapterResults,
        rejectedOpportunities: params.rejectedOpportunities,
        executionPosture: params.executionPosture,
      },
      outcomes,
      dispatchableRequests,
      adapterResults,
    };
  }
}
