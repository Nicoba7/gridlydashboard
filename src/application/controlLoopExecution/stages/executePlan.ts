import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  DeviceCommandExecutor,
  ExecutionEconomicArbitrationTrace,
} from "../types";
import type { RuntimeExecutionPosture } from "../executionPolicyTypes";
import type {
  EligibleOpportunity,
  ExecutionEdgeContext,
  ExecutionPlan,
  ExecutionResult,
  RejectedOpportunity,
} from "../pipelineTypes";
import {
  buildExecutionEdgeContextsFromPlan,
  buildExecutionRequestsFromContexts,
} from "../edge/buildExecutionRequestsFromPlan";

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
  contextByExecutionRequestId: Map<string, ExecutionEdgeContext>,
  traces: Map<string, ExecutionEconomicArbitrationTrace>,
): CommandExecutionResult[] {
  return results.map((result) => {
    const context = contextByExecutionRequestId.get(result.executionRequestId);
    const economicArbitration = context ? traces.get(context.opportunityId) : undefined;
    return economicArbitration ? { ...result, economicArbitration } : result;
  });
}

function normalizeAdapterResults(
  results: CommandExecutionResult[],
  contextByExecutionRequestId: Map<string, ExecutionEdgeContext>,
): CommandExecutionResult[] {
  return results.map((result) => {
    const context = contextByExecutionRequestId.get(result.executionRequestId);
    if (!context) {
      return result;
    }

    return {
      ...result,
      opportunityId: context.opportunityId,
      opportunityProvenance: context.opportunityProvenance,
      requestId: result.requestId ?? context.executionRequestId,
      idempotencyKey: result.idempotencyKey ?? context.idempotencyKey,
      decisionId: context.decisionId,
      targetDeviceId: context.targetDeviceId,
      commandId: context.commandId,
      deviceId: context.targetDeviceId,
      reasonCodes: result.reasonCodes,
    };
  });
}

function evaluateExecutionAuthorityContexts(
  contexts: ExecutionEdgeContext[],
): {
  dispatchable: ExecutionEdgeContext[];
  rejectedOutcomes: CommandExecutionResult[];
} {
  const dispatchable: ExecutionEdgeContext[] = [];
  const rejectedOutcomes: CommandExecutionResult[] = [];

  for (const context of contexts) {
    if (context.executionAuthorityMode === "insufficient_identity") {
      rejectedOutcomes.push({
        opportunityId: context.opportunityId,
        executionRequestId: context.executionRequestId,
        requestId: context.executionRequestId,
        idempotencyKey: context.idempotencyKey,
        decisionId: context.decisionId,
        targetDeviceId: context.targetDeviceId,
        commandId: context.commandId,
        deviceId: context.targetDeviceId,
        status: "skipped",
        message:
          "Execution authority denied: canonical identity chain incomplete (requires at least decisionId + planId).",
        errorCode: "EXECUTION_AUTHORITY_IDENTITY_INSUFFICIENT",
        reasonCodes: ["EXECUTION_AUTHORITY_IDENTITY_INSUFFICIENT"],
      });
      continue;
    }

    dispatchable.push(context);
  }

  return { dispatchable, rejectedOutcomes };
}

function mapFailedResults(
  contexts: ExecutionEdgeContext[],
  error: unknown,
): CommandExecutionResult[] {
  const message = error instanceof Error ? error.message : "Device command execution failed.";

  return contexts.map((context) => ({
    opportunityId: context.opportunityId,
    executionRequestId: context.executionRequestId,
    requestId: context.executionRequestId,
    idempotencyKey: context.idempotencyKey,
    decisionId: context.decisionId,
    targetDeviceId: context.targetDeviceId,
    commandId: context.commandId,
    deviceId: context.targetDeviceId,
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
  /** Canonical opportunities selected for execution planning dispatch. */
  dispatchableOpportunities: EligibleOpportunity[];
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
  executionEdgeContexts: ExecutionEdgeContext[];
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
    const safeExecutionEdgeContexts = [] as ExecutionEdgeContext[];
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
      executionEdgeContexts: safeExecutionEdgeContexts,
      adapterResults: [],
    };
  }

  const executablePlan = params.plan;
  const rawExecutionEdgeContexts = buildExecutionEdgeContextsFromPlan(
    executablePlan,
    params.dispatchableOpportunities,
  );
  const authorityEvaluation = evaluateExecutionAuthorityContexts(rawExecutionEdgeContexts);
  const executionEdgeContexts = authorityEvaluation.dispatchable;
  const dispatchableRequests = buildExecutionRequestsFromContexts(executionEdgeContexts);
  const contextByExecutionRequestId = new Map(
    executionEdgeContexts.map((context) => [context.executionRequestId, context]),
  );

  if (dispatchableRequests.length === 0) {
    const authorityOutcomes = withExecutionPosture(
      authorityEvaluation.rejectedOutcomes,
      params.executionPosture,
    );

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
      outcomes: withExecutionPosture(
        [...params.preExecutionOutcomes, ...authorityOutcomes],
        params.executionPosture,
      ),
      executionEdgeContexts: [],
      adapterResults: authorityOutcomes,
    };
  }

  try {
    const adapterResults = attachEconomicArbitrationTraces(
      normalizeAdapterResults(
        await params.executor.execute(dispatchableRequests),
        contextByExecutionRequestId,
      ),
      contextByExecutionRequestId,
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
      executionEdgeContexts,
      adapterResults,
    };
  } catch (error) {
    const adapterResults = attachEconomicArbitrationTraces(
      mapFailedResults(executionEdgeContexts, error),
      contextByExecutionRequestId,
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
      executionEdgeContexts,
      adapterResults,
    };
  }
}
