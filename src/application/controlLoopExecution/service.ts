import type { ControlLoopInput, ControlLoopResult } from "../../controlLoop/controlLoop";
import { runControlLoop } from "../../controlLoop/controlLoop";
import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  DeviceCommandExecutor,
} from "./types";
import { mapToCanonicalDeviceCommand } from "./canonicalCommand";
import { buildCommandExecutionIdentity, matchDecisionForCommand } from "./identity";
import type { DeviceCapabilitiesProvider } from "../../capabilities/deviceCapabilitiesProvider";
import {
  validateCanonicalCommandAgainstCapabilities,
  type CanonicalCommandValidationReasonCode,
} from "./commandValidation";
import type { DeviceShadowStore } from "../../shadow/deviceShadowStore";
import { projectExecutionToDeviceShadow } from "./projectExecutionToDeviceShadow";
import { reconcileCanonicalCommandWithShadow } from "./reconcileCanonicalCommandWithShadow";
import type { ExecutionJournalStore } from "../../journal/executionJournalStore";
import { toExecutionJournalEntry } from "./toExecutionJournalEntry";
import { evaluateExecutionPolicy } from "./evaluateExecutionPolicy";
import type { ExecutionPolicyReasonCode } from "./executionPolicyTypes";
import { projectExecutionOutcome } from "./projectExecutionOutcome";

export interface ControlLoopExecutionServiceResult {
  controlLoopResult: ControlLoopResult;
  executionResults: CommandExecutionResult[];
}

function mapPreflightFailure(
  request: CommandExecutionRequest,
  reasonCodes: CanonicalCommandValidationReasonCode[],
  message: string,
): CommandExecutionResult {
  return {
    executionRequestId: request.executionRequestId,
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    decisionId: request.decisionId,
    targetDeviceId: request.targetDeviceId,
    commandId: request.commandId,
    deviceId: request.targetDeviceId,
    status: "failed",
    message,
    errorCode: reasonCodes[0],
    reasonCodes,
  };
}

function mapReconciliationSkip(
  request: CommandExecutionRequest,
  reasonCodes: string[],
): CommandExecutionResult {
  return {
    executionRequestId: request.executionRequestId,
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    decisionId: request.decisionId,
    targetDeviceId: request.targetDeviceId,
    commandId: request.commandId,
    deviceId: request.targetDeviceId,
    status: "skipped",
    message: "Command skipped by canonical shadow reconciliation.",
    errorCode: reasonCodes[0],
    reasonCodes,
  };
}

function mapPolicyDenied(
  request: CommandExecutionRequest,
  reasonCodes: ExecutionPolicyReasonCode[],
): CommandExecutionResult {
  return {
    executionRequestId: request.executionRequestId,
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    decisionId: request.decisionId,
    targetDeviceId: request.targetDeviceId,
    commandId: request.commandId,
    deviceId: request.targetDeviceId,
    status: "skipped",
    message: "Command denied by canonical execution policy.",
    errorCode: reasonCodes[0],
    reasonCodes,
  };
}

function appendJournalEntries(
  journalStore: ExecutionJournalStore | undefined,
  requestLookup: Map<string, CommandExecutionRequest>,
  outcomes: CommandExecutionResult[],
  recordedAt: string,
): void {
  if (!journalStore || !outcomes.length) {
    return;
  }

  outcomes.forEach((outcome) => {
    const request = requestLookup.get(outcome.executionRequestId);
    if (!request) {
      return;
    }

    journalStore.append(
      toExecutionJournalEntry(request.canonicalCommand, outcome, recordedAt),
    );
  });
}

function mapRequests(input: ControlLoopInput, result: ControlLoopResult): CommandExecutionRequest[] {
  return result.commandsToIssue.map((command) => {
    const canonicalCommand = mapToCanonicalDeviceCommand(command);
    const matchedDecision = matchDecisionForCommand(canonicalCommand, result.activeDecisions);
    const identity = buildCommandExecutionIdentity(input.optimizerOutput.planId, canonicalCommand, matchedDecision);

    return {
      executionRequestId: identity.executionRequestId,
      requestId: identity.executionRequestId,
      idempotencyKey: identity.idempotencyKey,
      decisionId: identity.decisionId,
      targetDeviceId: identity.targetDeviceId,
      planId: input.optimizerOutput.planId,
      requestedAt: input.now,
      commandId: command.commandId,
      canonicalCommand,
    };
  });
}

function mapFailedResults(
  requests: CommandExecutionRequest[],
  error: unknown,
): CommandExecutionResult[] {
  const message = error instanceof Error ? error.message : "Device command execution failed.";

  return requests.map((request) => ({
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

/**
 * Thin application seam between canonical planning/control and future live command adapters.
 * See docs/architecture/execution-architecture.md for the orchestration boundary.
 */
export async function runControlLoopExecutionService(
  input: ControlLoopInput,
  executor: DeviceCommandExecutor,
  capabilitiesProvider?: DeviceCapabilitiesProvider,
  shadowStore?: DeviceShadowStore,
  journalStore?: ExecutionJournalStore,
): Promise<ControlLoopExecutionServiceResult> {
  const controlLoopResult = runControlLoop(input);
  const requests = mapRequests(input, controlLoopResult);
  const requestLookup = new Map(requests.map((request) => [request.executionRequestId, request]));

  if (requests.length === 0) {
    return {
      controlLoopResult,
      executionResults: [],
    };
  }

  const preflightFailures: CommandExecutionResult[] = [];
  const reconciliationSkips: CommandExecutionResult[] = [];
  const policyDenials: CommandExecutionResult[] = [];
  const dispatchableRequests: CommandExecutionRequest[] = [];
  const reservedDeviceIds = new Set<string>();

  for (const request of requests) {
    if (!capabilitiesProvider) {
      dispatchableRequests.push(request);
      continue;
    }

    const capabilities = capabilitiesProvider.getCapabilities(request.targetDeviceId);
    const validation = validateCanonicalCommandAgainstCapabilities(
      request.canonicalCommand,
      capabilities,
      input.now,
    );

    if (!validation.valid) {
      preflightFailures.push(
        mapPreflightFailure(
          request,
          validation.reasonCodes,
          "Command failed canonical preflight validation.",
        ),
      );
      continue;
    }

    if (shadowStore) {
      const existingShadow = shadowStore.getDeviceState(request.targetDeviceId);
      const reconciliation = reconcileCanonicalCommandWithShadow(
        request.canonicalCommand,
        existingShadow,
        input.now,
      );

      if (reconciliation.action === "skip") {
        reconciliationSkips.push(
          mapReconciliationSkip(request, reconciliation.reasonCodes),
        );
        continue;
      }
    }

    const policyDecision = evaluateExecutionPolicy({
      now: input.now,
      request,
      controlLoopResult,
      optimizerOutput: input.optimizerOutput,
      reservedDeviceIds,
    });

    if (!policyDecision.allowed) {
      policyDenials.push(mapPolicyDenied(request, policyDecision.reasonCodes));
      continue;
    }

    reservedDeviceIds.add(request.targetDeviceId);

    dispatchableRequests.push(request);
  }

  if (!dispatchableRequests.length) {
    const outcomes = [...preflightFailures, ...reconciliationSkips, ...policyDenials];
    appendJournalEntries(journalStore, requestLookup, outcomes, input.now);

    return {
      controlLoopResult,
      executionResults: outcomes,
    };
  }

  try {
    const executionResults = await executor.execute(dispatchableRequests);
    const outcomes = [...preflightFailures, ...reconciliationSkips, ...policyDenials, ...executionResults];

    appendJournalEntries(journalStore, requestLookup, outcomes, input.now);

    if (shadowStore) {
      const requestByExecutionId = new Map(
        dispatchableRequests.map((request) => [request.executionRequestId, request]),
      );

      executionResults.forEach((result) => {
        const request = requestByExecutionId.get(result.executionRequestId);
        if (!request) {
          return;
        }

        const outcomeProjection = projectExecutionOutcome(result, request.canonicalCommand);
        if (!outcomeProjection.shouldUpdateShadow) {
          return;
        }

        const existing = shadowStore.getDeviceState(request.targetDeviceId);
        const projected = projectExecutionToDeviceShadow(
          existing,
          request.canonicalCommand,
          result,
          input.now,
        );

        if (projected) {
          shadowStore.setDeviceState(request.targetDeviceId, projected);
        }
      });
    }

    return {
      controlLoopResult,
      executionResults: outcomes,
    };
  } catch (error) {
    const failedResults = mapFailedResults(dispatchableRequests, error);
    const outcomes = [
      ...preflightFailures,
      ...reconciliationSkips,
      ...policyDenials,
      ...failedResults,
    ];

    appendJournalEntries(journalStore, requestLookup, outcomes, input.now);

    return {
      controlLoopResult,
      executionResults: outcomes,
    };
  }
}
