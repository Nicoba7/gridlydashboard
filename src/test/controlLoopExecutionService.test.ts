import { describe, expect, it, vi } from "vitest";
import type { SystemState } from "../domain";
import type { OptimizerDecision, OptimizerOpportunity, OptimizerOutput } from "../domain/optimizer";
import {
  buildCommandExecutionIdentity,
} from "../application/controlLoopExecution/identity";
import { mapToCanonicalDeviceCommand } from "../application/controlLoopExecution/canonicalCommand";
import { runControlLoopExecutionService } from "../application/controlLoopExecution/service";
import { InMemoryDeviceCapabilitiesProvider } from "../capabilities/deviceCapabilitiesProvider";
import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  DeviceCommandExecutor,
} from "../application/controlLoopExecution/types";

function buildSystemState(): SystemState {
  return {
    siteId: "site-1",
    capturedAt: "2026-03-16T10:00:00.000Z",
    timezone: "Europe/London",
    devices: [],
    homeLoadW: 1200,
    solarGenerationW: 800,
    batteryPowerW: 0,
    evChargingPowerW: 0,
    gridPowerW: 400,
  };
}

function buildDecision(windowStart: string, windowEnd: string): OptimizerDecision {
  return {
    decisionId: "decision-1",
    startAt: windowStart,
    endAt: windowEnd,
    executionWindow: { startAt: windowStart, endAt: windowEnd },
    action: "charge_battery",
    targetDeviceIds: ["battery"],
    targetDevices: [
      {
        deviceId: "battery",
        kind: "battery",
        requiredCapabilities: ["set_mode"],
      },
    ],
    reason: "Charge in low-cost slot",
    confidence: 0.8,
  };
}

function buildOutput(options?: {
  decisions?: OptimizerDecision[];
  withCommand?: boolean;
  opportunities?: OptimizerOpportunity[];
}): OptimizerOutput {
  const decisions = options?.decisions ?? [];
  const withCommand = options?.withCommand ?? false;

  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: "plan-1",
    generatedAt: "2026-03-16T10:00:00.000Z",
    planningWindow: decisions.length
      ? {
        startAt: decisions[0].startAt,
        endAt: decisions[decisions.length - 1].endAt,
      }
      : undefined,
    status: "ok",
    headline: "Test plan",
    decisions,
    opportunities: options?.opportunities,
    recommendedCommands: withCommand
      ? [
        {
          commandId: "cmd-1",
          deviceId: "battery",
          issuedAt: "2026-03-16T10:00:00.000Z",
          type: "set_mode",
          mode: "charge",
          effectiveWindow: {
            startAt: "2026-03-16T10:00:00.000Z",
            endAt: "2026-03-16T10:30:00.000Z",
          },
          reason: "Charge in low-cost slot",
        },
      ]
      : [],
    summary: {
      expectedImportCostPence: 100,
      expectedExportRevenuePence: 20,
      expectedNetValuePence: -80,
    },
    diagnostics: [],
    feasibility: {
      executable: true,
      reasonCodes: ["PLAN_COMPUTED"],
    },
    assumptions: [],
    warnings: [],
    confidence: 0.8,
  };
}

function buildRawCommand(overrides?: Partial<NonNullable<OptimizerOutput["recommendedCommands"]>[number]>) {
  return {
    commandId: "cmd-1",
    deviceId: "battery",
    issuedAt: "2026-03-16T10:00:00.000Z",
    type: "set_mode" as const,
    mode: "charge" as const,
    effectiveWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    ...overrides,
  };
}

describe("runControlLoopExecutionService", () => {
  it("does not call executor when there are no commands to issue", async () => {
    const execute = vi.fn(async (_requests: CommandExecutionRequest[]) => [] as CommandExecutionResult[]);
    const executor: DeviceCommandExecutor = { execute };

    const result = await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:00:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput(),
      },
      executor,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(result.executionResults).toEqual([]);
    expect(result.controlLoopResult.commandsToIssue).toEqual([]);
  });

  it("calls executor with canonical requests for active commands", async () => {
    const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
      requests.map((request) => ({
        executionRequestId: request.executionRequestId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        decisionId: request.decisionId,
        targetDeviceId: request.targetDeviceId,
        commandId: request.commandId,
        deviceId: request.canonicalCommand.targetDeviceId,
        status: "issued" as const,
      })),
    );
    const executor: DeviceCommandExecutor = { execute };

    const result = await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput({
          decisions: [buildDecision("2026-03-16T10:00:00.000Z", "2026-03-16T10:30:00.000Z")],
          withCommand: true,
        }),
      },
      executor,
    );

    expect(execute).toHaveBeenCalledTimes(1);
    const requests = execute.mock.calls[0][0] as CommandExecutionRequest[];
    expect(requests).toHaveLength(1);
    expect(requests[0].planId).toBe("plan-1");
    expect(requests[0].commandId).toBe("cmd-1");
    expect(requests[0].decisionId).toBe("decision-1");
    expect(requests[0].targetDeviceId).toBe("battery");
    expect(requests[0].canonicalCommand.kind).toBe("set_mode");
    expect(requests[0].canonicalCommand.targetDeviceId).toBe("battery");
    expect("command" in requests[0]).toBe(false);
    expect(requests[0].executionRequestId).toContain("plan-1");
    expect(requests[0].idempotencyKey).toContain("plan-1:decision:decision-1:command:cmd-1:battery:set_mode:charge");
    expect(result.controlLoopResult.commandsToIssue).toHaveLength(1);
    expect(result.executionResults[0].status).toBe("issued");
    expect(result.executionResults[0].executionRequestId).toBe(requests[0].executionRequestId);
    expect(result.executionResults[0].idempotencyKey).toBe(requests[0].idempotencyKey);
  });

  it("builds execution requests directly from active optimizer opportunities", async () => {
    const decision = buildDecision("2026-03-16T10:00:00.000Z", "2026-03-16T10:30:00.000Z");
    const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
      requests.map((request) => ({
        opportunityId: request.opportunityId,
        executionRequestId: request.executionRequestId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        decisionId: request.decisionId,
        targetDeviceId: request.targetDeviceId,
        commandId: request.commandId,
        deviceId: request.canonicalCommand.targetDeviceId,
        status: "issued" as const,
      })),
    );
    const executor: DeviceCommandExecutor = { execute };

    const result = await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput({
          decisions: [decision],
          withCommand: true,
          opportunities: [
            {
              opportunityId: "opp-1",
              decisionId: decision.decisionId,
              action: decision.action,
              targetDeviceId: "battery",
              targetKind: "battery",
              requiredCapabilities: ["set_mode"],
              command: buildRawCommand(),
              economicSignals: {
                effectiveStoredEnergyValuePencePerKwh: 12,
              },
              planningConfidenceLevel: "high",
              decisionReason: decision.reason,
            },
          ],
        }),
      },
      executor,
    );

    const requests = execute.mock.calls[0][0] as CommandExecutionRequest[];
    expect(requests[0].opportunityId).toBe("opp-1");
    expect(requests[0].idempotencyKey).toContain("opp-1:battery:set_mode:charge");
    expect(result.controlLoopResult.activeOpportunities).toHaveLength(1);
    expect(result.executionResults[0].opportunityId).toBe("opp-1");
  });

  it("surfaces executor failures as failed execution results", async () => {
    const execute = vi.fn(async () => {
      throw new Error("Executor offline");
    });
    const executor: DeviceCommandExecutor = { execute };

    const result = await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput({
          decisions: [buildDecision("2026-03-16T10:00:00.000Z", "2026-03-16T10:30:00.000Z")],
          withCommand: true,
        }),
      },
      executor,
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.controlLoopResult.commandsToIssue).toHaveLength(1);
    expect(result.executionResults).toHaveLength(1);
    expect(result.executionResults[0].status).toBe("failed");
    expect(result.executionResults[0].errorCode).toBe("EXECUTOR_ERROR");
    expect(result.executionResults[0].decisionId).toBe("decision-1");
    expect(result.executionResults[0].targetDeviceId).toBe("battery");
  });

  it("builds a stable idempotency key for the same command intent", () => {
    const decision = buildDecision("2026-03-16T10:00:00.000Z", "2026-03-16T10:30:00.000Z");
    const firstCommand = mapToCanonicalDeviceCommand(buildRawCommand());
    const secondCommand = mapToCanonicalDeviceCommand(buildRawCommand({ commandId: "cmd-2", issuedAt: "2026-03-16T09:59:00.000Z" }));

    const first = buildCommandExecutionIdentity("plan-1", firstCommand, decision);
    const second = buildCommandExecutionIdentity("plan-2", secondCommand, decision);

    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.executionRequestId).not.toBe(second.executionRequestId);
  });

  it("changes idempotency key when timing or target changes", () => {
    const decision = buildDecision("2026-03-16T10:00:00.000Z", "2026-03-16T10:30:00.000Z");
    const baseCommand = mapToCanonicalDeviceCommand(buildRawCommand());

    const shiftedCommand = mapToCanonicalDeviceCommand(buildRawCommand({
      effectiveWindow: {
        startAt: "2026-03-16T10:30:00.000Z",
        endAt: "2026-03-16T11:00:00.000Z",
      },
    }));
    const retargetedCommand = mapToCanonicalDeviceCommand(buildRawCommand({
      deviceId: "ev",
    }));
    const semanticChangeCommand = mapToCanonicalDeviceCommand(buildRawCommand({ mode: "discharge" }));

    const baseIdentity = buildCommandExecutionIdentity("plan-1", baseCommand, decision);
    const shiftedIdentity = buildCommandExecutionIdentity("plan-1", shiftedCommand, decision);
    const retargetedIdentity = buildCommandExecutionIdentity("plan-1", retargetedCommand, decision);
    const semanticChangeIdentity = buildCommandExecutionIdentity("plan-1", semanticChangeCommand, decision);

    expect(baseIdentity.idempotencyKey).not.toBe(shiftedIdentity.idempotencyKey);
    expect(baseIdentity.idempotencyKey).not.toBe(retargetedIdentity.idempotencyKey);
    expect(baseIdentity.idempotencyKey).not.toBe(semanticChangeIdentity.idempotencyKey);
  });

  it("maps raw device commands into canonical commands deterministically", () => {
    const raw = buildRawCommand();
    const canonical = mapToCanonicalDeviceCommand(raw);

    expect(canonical).toEqual({
      kind: "set_mode",
      targetDeviceId: "battery",
      effectiveWindow: {
        startAt: "2026-03-16T10:00:00.000Z",
        endAt: "2026-03-16T10:30:00.000Z",
      },
      mode: "charge",
    });
  });

  it("arbitrates only among eligible opportunities and still executes a viable lower-value alternative", async () => {
    const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
      requests.map((request) => ({
        executionRequestId: request.executionRequestId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        decisionId: request.decisionId,
        targetDeviceId: request.targetDeviceId,
        commandId: request.commandId,
        deviceId: request.targetDeviceId,
        status: "issued" as const,
      })),
    );
    const executor: DeviceCommandExecutor = { execute };
    const capabilitiesProvider = new InMemoryDeviceCapabilitiesProvider([
      {
        deviceId: "battery",
        supportedCommandKinds: ["set_mode"],
        supportedModes: ["charge"],
        supportsImmediateExecution: true,
        schemaVersion: "capabilities.v1",
      },
    ]);

    const optimizerOutput: OptimizerOutput = {
      schemaVersion: "optimizer-output.v1.1",
      plannerVersion: "canonical-runtime.v1",
      planId: "plan-eligibility-before-arbitration",
      generatedAt: "2026-03-16T10:00:00.000Z",
      planningWindow: {
        startAt: "2026-03-16T10:00:00.000Z",
        endAt: "2026-03-16T10:30:00.000Z",
      },
      status: "ok",
      headline: "Eligibility should precede arbitration",
      decisions: [
        {
          decisionId: "decision-low",
          startAt: "2026-03-16T10:00:00.000Z",
          endAt: "2026-03-16T10:30:00.000Z",
          executionWindow: {
            startAt: "2026-03-16T10:00:00.000Z",
            endAt: "2026-03-16T10:30:00.000Z",
          },
          action: "charge_battery",
          targetDeviceIds: ["battery"],
          targetDevices: [{ deviceId: "battery", kind: "battery", requiredCapabilities: ["set_mode"] }],
          reason: "Lower-value but eligible charge action.",
          effectiveStoredEnergyValuePencePerKwh: 5,
          confidence: 0.9,
        },
        {
          decisionId: "decision-high",
          startAt: "2026-03-16T10:00:00.000Z",
          endAt: "2026-03-16T10:30:00.000Z",
          executionWindow: {
            startAt: "2026-03-16T10:01:00.000Z",
            endAt: "2026-03-16T10:29:00.000Z",
          },
          action: "discharge_battery",
          targetDeviceIds: ["battery"],
          targetDevices: [{ deviceId: "battery", kind: "battery", requiredCapabilities: ["set_mode"] }],
          reason: "Higher-value but ineligible discharge action.",
          effectiveStoredEnergyValuePencePerKwh: 15,
          confidence: 0.9,
        },
      ],
      recommendedCommands: [
        {
          commandId: "cmd-low",
          deviceId: "battery",
          issuedAt: "2026-03-16T10:00:00.000Z",
          type: "set_mode",
          mode: "charge",
          effectiveWindow: {
            startAt: "2026-03-16T10:00:00.000Z",
            endAt: "2026-03-16T10:30:00.000Z",
          },
        },
        {
          commandId: "cmd-high",
          deviceId: "battery",
          issuedAt: "2026-03-16T10:00:00.000Z",
          type: "set_mode",
          mode: "discharge",
          effectiveWindow: {
            startAt: "2026-03-16T10:01:00.000Z",
            endAt: "2026-03-16T10:29:00.000Z",
          },
        },
      ],
      summary: {
        expectedImportCostPence: 100,
        expectedExportRevenuePence: 20,
        expectedNetValuePence: -80,
      },
      diagnostics: [],
      feasibility: {
        executable: true,
        reasonCodes: ["PLAN_COMPUTED"],
      },
      assumptions: [],
      warnings: [],
      confidence: 0.9,
    };

    const result = await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput,
      },
      executor,
      capabilitiesProvider,
      undefined,
      undefined,
      {
        optimizationMode: "balanced",
        valueLedger: {
          optimizationMode: "balanced",
          estimatedImportCostPence: 100,
          estimatedExportRevenuePence: 20,
          estimatedBatteryDegradationCostPence: 2,
          estimatedNetCostPence: 82,
          baselineType: "hold_current_state",
          baselineNetCostPence: 95,
          baselineImportCostPence: 95,
          baselineExportRevenuePence: 20,
          baselineBatteryDegradationCostPence: 0,
          estimatedSavingsVsBaselinePence: 13,
          assumptions: [],
          caveats: [],
          confidence: 0.9,
        },
      },
    );

    expect(execute).toHaveBeenCalledTimes(1);
    const dispatchedRequests = execute.mock.calls[0][0] as CommandExecutionRequest[];
    expect(dispatchedRequests).toHaveLength(1);
    expect(dispatchedRequests[0].commandId).toBe("cmd-low");

    const issued = result.executionResults.find((entry) => entry.commandId === "cmd-low");
    const rejectedHighValue = result.executionResults.find((entry) => entry.commandId === "cmd-high");

    expect(issued?.status).toBe("issued");
    expect(issued?.reasonCodes).toBeUndefined();
    expect(rejectedHighValue?.status).toBe("failed");
    expect(rejectedHighValue?.reasonCodes).toEqual(["MODE_NOT_SUPPORTED"]);
    expect(rejectedHighValue?.errorCode).toBe("MODE_NOT_SUPPORTED");
    expect(issued?.reasonCodes?.includes("INFERIOR_ECONOMIC_VALUE")).not.toBe(true);
  });

  describe("executionEvidenceSummary", () => {
    it("should include executionEvidenceSummary in result when no requests executed", async () => {
      const execute = vi.fn(async () => [] as CommandExecutionResult[]);
      const executor: DeviceCommandExecutor = { execute };

      const result = await runControlLoopExecutionService(
        {
          now: "2026-03-16T10:00:00.000Z",
          systemState: buildSystemState(),
          optimizerOutput: buildOutput(),
        },
        executor,
      );

      expect(result.executionEvidenceSummary).toBeDefined();
      expect(result.executionEvidenceSummary.hasUncertainExecutionEvidence).toBe(false);
    });

    it("should report false when all outcomes have confirmed confidence", async () => {
      const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
        requests.map((request) => ({
          executionRequestId: request.executionRequestId,
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          decisionId: request.decisionId,
          targetDeviceId: request.targetDeviceId,
          commandId: request.commandId,
          deviceId: request.canonicalCommand.targetDeviceId,
          status: "issued" as const,
          executionConfidence: "confirmed" as const,
        })),
      );
      const executor: DeviceCommandExecutor = { execute };

      const result = await runControlLoopExecutionService(
        {
          now: "2026-03-16T10:05:00.000Z",
          systemState: buildSystemState(),
          optimizerOutput: buildOutput({
            decisions: [buildDecision("2026-03-16T10:00:00.000Z", "2026-03-16T10:30:00.000Z")],
            withCommand: true,
          }),
        },
        executor,
      );

      expect(result.executionEvidenceSummary.hasUncertainExecutionEvidence).toBe(false);
    });

    it("should include executionEvidenceSummary as a required result field", async () => {
      const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
        requests.map((request) => ({
          executionRequestId: request.executionRequestId,
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          decisionId: request.decisionId,
          targetDeviceId: request.targetDeviceId,
          commandId: request.commandId,
          deviceId: request.canonicalCommand.targetDeviceId,
          status: "issued" as const,
        })),
      );
      const executor: DeviceCommandExecutor = { execute };

      const result = await runControlLoopExecutionService(
        {
          now: "2026-03-16T10:05:00.000Z",
          systemState: buildSystemState(),
          optimizerOutput: buildOutput({
            decisions: [buildDecision("2026-03-16T10:00:00.000Z", "2026-03-16T10:30:00.000Z")],
            withCommand: true,
          }),
        },
        executor,
      );

      // Verify the summary field exists and is properly structured
      expect(result.executionEvidenceSummary).toBeDefined();
      expect(typeof result.executionEvidenceSummary.hasUncertainExecutionEvidence).toBe("boolean");
    });

    it("should report false when executionConfidence is undefined", async () => {
      const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
        requests.map((request) => ({
          executionRequestId: request.executionRequestId,
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          decisionId: request.decisionId,
          targetDeviceId: request.targetDeviceId,
          commandId: request.commandId,
          deviceId: request.canonicalCommand.targetDeviceId,
          status: "issued" as const,
          executionConfidence: undefined,
        })),
      );
      const executor: DeviceCommandExecutor = { execute };

      const result = await runControlLoopExecutionService(
        {
          now: "2026-03-16T10:05:00.000Z",
          systemState: buildSystemState(),
          optimizerOutput: buildOutput({
            decisions: [buildDecision("2026-03-16T10:00:00.000Z", "2026-03-16T10:30:00.000Z")],
            withCommand: true,
          }),
        },
        executor,
      );

      expect(result.executionEvidenceSummary.hasUncertainExecutionEvidence).toBe(false);
    });
  });

  describe("nextCycleExecutionCaution", () => {
    it("should include nextCycleExecutionCaution in result when no requests executed", async () => {
      const execute = vi.fn(async () => [] as CommandExecutionResult[]);
      const executor: DeviceCommandExecutor = { execute };

      const result = await runControlLoopExecutionService(
        {
          now: "2026-03-16T10:00:00.000Z",
          systemState: buildSystemState(),
          optimizerOutput: buildOutput(),
        },
        executor,
      );

      expect(result.nextCycleExecutionCaution).toBeDefined();
      expect(["normal", "caution"]).toContain(result.nextCycleExecutionCaution);
    });

    it("should report normal caution when evidence summary is not uncertain", async () => {
      const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
        requests.map((request) => ({
          executionRequestId: request.executionRequestId,
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          decisionId: request.decisionId,
          targetDeviceId: request.targetDeviceId,
          commandId: request.commandId,
          deviceId: request.canonicalCommand.targetDeviceId,
          status: "issued" as const,
          executionConfidence: "confirmed" as const,
        })),
      );
      const executor: DeviceCommandExecutor = { execute };

      const result = await runControlLoopExecutionService(
        {
          now: "2026-03-16T10:05:00.000Z",
          systemState: buildSystemState(),
          optimizerOutput: buildOutput({
            decisions: [buildDecision("2026-03-16T10:00:00.000Z", "2026-03-16T10:30:00.000Z")],
            withCommand: true,
          }),
        },
        executor,
      );

      expect(result.nextCycleExecutionCaution).toBe("normal");
    });

    it("should wire caution signal from evidence summary", async () => {
      // This test verifies the caution signal is correctly derived from the evidence summary.
      // Both test paths (no execution and normal execution) should produce the signal
      // based on whatever uncertainty was computed upstream.
      const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
        requests.map((request) => ({
          executionRequestId: request.executionRequestId,
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          decisionId: request.decisionId,
          targetDeviceId: request.targetDeviceId,
          commandId: request.commandId,
          deviceId: request.canonicalCommand.targetDeviceId,
          status: "issued" as const,
        })),
      );
      const executor: DeviceCommandExecutor = { execute };

      // Test with confirmed outcomes (no uncertainty)
      const resultNormal = await runControlLoopExecutionService(
        {
          now: "2026-03-16T10:05:00.000Z",
          systemState: buildSystemState(),
          optimizerOutput: buildOutput({
            decisions: [buildDecision("2026-03-16T10:00:00.000Z", "2026-03-16T10:30:00.000Z")],
            withCommand: true,
          }),
        },
        executor,
      );

      // Both evidence summary and caution signal should be consistent
      expect(resultNormal.executionEvidenceSummary.hasUncertainExecutionEvidence).toBe(false);
      expect(resultNormal.nextCycleExecutionCaution).toBe("normal");
    });
  });

  describe("householdObjectiveSummary", () => {
    it("includes householdObjectiveSummary with sensible defaults when no decisions are active", async () => {
      const execute = vi.fn(async (_requests: CommandExecutionRequest[]) => [] as CommandExecutionResult[]);
      const executor: DeviceCommandExecutor = { execute };

      const result = await runControlLoopExecutionService(
        {
          now: "2026-03-16T10:00:00.000Z",
          systemState: buildSystemState(),
          optimizerOutput: buildOutput(),
        },
        executor,
      );

      expect(result.householdObjectiveSummary).toEqual({
        objectiveMode: "savings",
        hasExportIntent: false,
        hasImportAvoidanceIntent: false,
      });
    });

    it("derives balanced objective when both export and import-avoidance signals are present", async () => {
      const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
        requests.map((request) => ({
          executionRequestId: request.executionRequestId,
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          decisionId: request.decisionId,
          targetDeviceId: request.targetDeviceId,
          commandId: request.commandId,
          deviceId: request.canonicalCommand.targetDeviceId,
          status: "issued" as const,
        })),
      );
      const executor: DeviceCommandExecutor = { execute };

      const decision = buildDecision("2026-03-16T10:00:00.000Z", "2026-03-16T10:30:00.000Z");
      const enrichedDecision: OptimizerDecision = {
        ...decision,
        marginalExportValuePencePerKwh: 6,
        marginalImportAvoidancePencePerKwh: 8,
      };

      const result = await runControlLoopExecutionService(
        {
          now: "2026-03-16T10:05:00.000Z",
          systemState: buildSystemState(),
          optimizerOutput: buildOutput({
            decisions: [enrichedDecision],
            withCommand: true,
          }),
        },
        executor,
      );

      expect(result.householdObjectiveSummary).toEqual({
        objectiveMode: "balanced",
        hasExportIntent: true,
        hasImportAvoidanceIntent: true,
      });
    });
  });

  describe("householdObjectiveConfidence", () => {
    it("exposes empty confidence when there is no objective intent", async () => {
      const execute = vi.fn(async (_requests: CommandExecutionRequest[]) => [] as CommandExecutionResult[]);
      const executor: DeviceCommandExecutor = { execute };

      const result = await runControlLoopExecutionService(
        {
          now: "2026-03-16T10:00:00.000Z",
          systemState: buildSystemState(),
          optimizerOutput: buildOutput(),
        },
        executor,
      );

      expect(result.householdObjectiveConfidence).toBe("empty");
    });

    it("exposes clear confidence for one-sided objective intent", async () => {
      const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
        requests.map((request) => ({
          executionRequestId: request.executionRequestId,
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          decisionId: request.decisionId,
          targetDeviceId: request.targetDeviceId,
          commandId: request.commandId,
          deviceId: request.canonicalCommand.targetDeviceId,
          status: "issued" as const,
        })),
      );
      const executor: DeviceCommandExecutor = { execute };

      const decision = buildDecision("2026-03-16T10:00:00.000Z", "2026-03-16T10:30:00.000Z");
      const savingsOnlyDecision: OptimizerDecision = {
        ...decision,
        marginalExportValuePencePerKwh: 0,
        marginalImportAvoidancePencePerKwh: 8,
      };

      const result = await runControlLoopExecutionService(
        {
          now: "2026-03-16T10:05:00.000Z",
          systemState: buildSystemState(),
          optimizerOutput: buildOutput({
            decisions: [savingsOnlyDecision],
            withCommand: true,
          }),
        },
        executor,
      );

      expect(result.householdObjectiveSummary.objectiveMode).toBe("savings");
      expect(result.householdObjectiveConfidence).toBe("clear");
    });

    it("exposes mixed confidence for balanced objective intent", async () => {
      const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
        requests.map((request) => ({
          executionRequestId: request.executionRequestId,
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          decisionId: request.decisionId,
          targetDeviceId: request.targetDeviceId,
          commandId: request.commandId,
          deviceId: request.canonicalCommand.targetDeviceId,
          status: "issued" as const,
        })),
      );
      const executor: DeviceCommandExecutor = { execute };

      const decision = buildDecision("2026-03-16T10:00:00.000Z", "2026-03-16T10:30:00.000Z");
      const balancedDecision: OptimizerDecision = {
        ...decision,
        marginalExportValuePencePerKwh: 6,
        marginalImportAvoidancePencePerKwh: 8,
      };

      const result = await runControlLoopExecutionService(
        {
          now: "2026-03-16T10:05:00.000Z",
          systemState: buildSystemState(),
          optimizerOutput: buildOutput({
            decisions: [balancedDecision],
            withCommand: true,
          }),
        },
        executor,
      );

      expect(result.householdObjectiveSummary.objectiveMode).toBe("balanced");
      expect(result.householdObjectiveConfidence).toBe("mixed");
    });
  });
});
