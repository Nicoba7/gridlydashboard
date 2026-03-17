import { describe, expect, it, vi } from "vitest";
import { executePlan } from "../application/controlLoopExecution/stages/executePlan";
import type {
  EligibleOpportunity,
  ExecutablePlan,
  RejectedOpportunity,
} from "../application/controlLoopExecution/pipelineTypes";
import type { DeviceCommandExecutor } from "../application/controlLoopExecution/types";

const dispatchableOpportunities: EligibleOpportunity[] = [
  {
    opportunityId: "opp-1",
    opportunityProvenance: {
      kind: "native_canonical",
      canonicalizedFromLegacy: false,
    },
    decisionId: "decision-1",
    targetDeviceId: "battery",
    canonicalCommand: {
      kind: "set_mode",
      targetDeviceId: "battery",
      mode: "charge",
    },
    commandId: "cmd-1",
    planId: "plan-1",
    requestedAt: "2026-03-16T10:05:00.000Z",
    executionAuthorityMode: "full_canonical",
    eligibilityBasis: {
      runtimeGuardrailPassed: true,
      capabilityValidationPassed: true,
      reconciliationPassed: true,
      executionPolicyPassed: true,
      observedStateStatus: "fresh",
    },
  },
];

const plan: ExecutablePlan = {
  kind: "executable",
  householdDecision: {
    kind: "selected_opportunity",
    selectedOpportunity: {
      opportunityId: "opp-1",
      decisionId: "decision-1",
      targetDeviceId: "battery",
      eligible: {
        opportunityId: "opp-1",
        opportunityProvenance: {
          kind: "native_canonical",
          canonicalizedFromLegacy: false,
        },
        decisionId: "decision-1",
        targetDeviceId: "battery",
        canonicalCommand: dispatchableOpportunities[0].canonicalCommand,
        commandId: "cmd-1",
        planId: "plan-1",
        requestedAt: "2026-03-16T10:05:00.000Z",
        executionAuthorityMode: "full_canonical",
        eligibilityBasis: {
          runtimeGuardrailPassed: true,
          capabilityValidationPassed: true,
          reconciliationPassed: true,
          executionPolicyPassed: true,
          observedStateStatus: "fresh",
        },
      },
      deviceArbitration: {
        arbitrationScope: "device",
        deviceContentionKey: "battery",
        alternativesConsidered: 1,
        decisionReason: "selected",
      },
    },
    rejectedOpportunities: [],
    decisionReason: "selected",
  },
  selectedOpportunityId: "opp-1",
  selectedDecisionId: "decision-1",
  commands: [dispatchableOpportunities[0].canonicalCommand],
};

const rejected: RejectedOpportunity[] = [
  {
    opportunityId: "opp-r-1",
    decisionId: "decision-r-1",
    targetDeviceId: "ev",
    stage: "execution_planning",
    reasonCodes: ["CONFLICTING_COMMAND_FOR_DEVICE"],
    decisionReason: "Conflict",
  },
];

describe("executePlan stage", () => {
  it("preserves selectedOpportunityId and returns executed result", async () => {
    const executor: DeviceCommandExecutor = {
      execute: vi.fn(async (requests) =>
        requests.map((request) => ({
          opportunityId: request.opportunityId,
          executionRequestId: request.executionRequestId,
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          decisionId: request.decisionId,
          targetDeviceId: request.targetDeviceId,
          commandId: request.commandId,
          deviceId: request.targetDeviceId,
          status: "issued" as const,
        })),
      ),
    };

    const output = await executePlan({
      plan,
      dispatchableOpportunities,
      executor,
      preExecutionOutcomes: [],
      selectedEconomicTraces: new Map(),
      executionPosture: "normal",
      rejectedOpportunities: rejected,
    });

    expect(output.execution.kind).toBe("executed");
    expect(output.execution.selectedOpportunityId).toBe("opp-1");
    expect(output.execution.rejectedOpportunities).toEqual(rejected);
  });

  it("uses canonical context identity even when adapter result identity is missing or incorrect", async () => {
    const executor: DeviceCommandExecutor = {
      execute: vi.fn(async (requests) =>
        requests.map((request) => ({
          opportunityId: request.executionRequestId,
          executionRequestId: request.executionRequestId,
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          decisionId: undefined,
          targetDeviceId: "incorrect-device",
          commandId: "incorrect-command",
          deviceId: "incorrect-device",
          status: "issued" as const,
        })),
      ),
    };

    const output = await executePlan({
      plan,
      dispatchableOpportunities,
      executor,
      preExecutionOutcomes: [],
      selectedEconomicTraces: new Map(),
      executionPosture: "normal",
      rejectedOpportunities: rejected,
    });

    expect(output.adapterResults).toHaveLength(1);
    expect(output.adapterResults[0].opportunityId).toBe("opp-1");
    expect(output.adapterResults[0].opportunityProvenance).toEqual({
      kind: "native_canonical",
      canonicalizedFromLegacy: false,
    });
    expect(output.adapterResults[0].decisionId).toBe("decision-1");
    expect(output.adapterResults[0].targetDeviceId).toBe("battery");
    expect(output.adapterResults[0].commandId).toBe("cmd-1");
  });


  it("returns non_executed result for non-executable plan", async () => {
    const executor: DeviceCommandExecutor = {
      execute: vi.fn(async () => []),
    };

    const output = await executePlan({
      plan: {
        kind: "non_executable",
        householdDecision: {
          kind: "no_action",
          rejectedOpportunities: rejected,
          reasonCodes: ["EXECUTION_PLAN_EMPTY_COMMAND_SET"],
          decisionReason: "No executable commands remained after execution planning.",
        },
        reasonCodes: ["EXECUTION_PLAN_EMPTY_COMMAND_SET"],
        decisionReason: "No executable commands remained after execution planning.",
        commands: [],
      },
      dispatchableOpportunities: [],
      executor,
      preExecutionOutcomes: [],
      selectedEconomicTraces: new Map(),
      executionPosture: "normal",
      rejectedOpportunities: rejected,
    });

    expect(output.execution.kind).toBe("non_executed");
    expect(output.execution.rejectedOpportunities).toEqual(rejected);
  });

  it("fails closed to non_executed when executable plan has no dispatchable requests", async () => {
    const executor: DeviceCommandExecutor = {
      execute: vi.fn(async () => []),
    };

    const output = await executePlan({
      plan,
      dispatchableOpportunities: [],
      executor,
      preExecutionOutcomes: [],
      selectedEconomicTraces: new Map(),
      executionPosture: "normal",
      rejectedOpportunities: rejected,
    });

    expect(executor.execute).not.toHaveBeenCalled();
    expect(output.execution.kind).toBe("non_executed");
    expect(output.executionEdgeContexts).toEqual([]);
  });

  it("ignores dispatchable requests when plan is non-executable", async () => {
    const executor: DeviceCommandExecutor = {
      execute: vi.fn(async () => []),
    };

    const output = await executePlan({
      plan: {
        kind: "non_executable",
        householdDecision: {
          kind: "no_action",
          rejectedOpportunities: rejected,
          reasonCodes: ["EXECUTION_PLAN_EMPTY_COMMAND_SET"],
          decisionReason: "No executable commands remained after execution planning.",
        },
        reasonCodes: ["EXECUTION_PLAN_EMPTY_COMMAND_SET"],
        decisionReason: "No executable commands remained after execution planning.",
        commands: [],
      },
      dispatchableOpportunities,
      executor,
      preExecutionOutcomes: [],
      selectedEconomicTraces: new Map(),
      executionPosture: "normal",
      rejectedOpportunities: rejected,
    });

    expect(executor.execute).not.toHaveBeenCalled();
    expect(output.execution.kind).toBe("non_executed");
    expect(output.executionEdgeContexts).toEqual([]);
  });
});
