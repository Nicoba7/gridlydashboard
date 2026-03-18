import { describe, expect, it, vi } from "vitest";
import type { SystemState } from "../domain";
import type { OptimizerDecision, OptimizerOutput } from "../domain/optimizer";
import { runControlLoopExecutionService } from "../application/controlLoopExecution/service";
import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  DeviceCommandExecutor,
} from "../application/controlLoopExecution/types";
import { InMemoryDeviceShadowStore } from "../shadow/deviceShadowStore";

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

function buildDecision(id: string, deviceId: string, start: string, end: string): OptimizerDecision {
  return {
    decisionId: id,
    startAt: start,
    endAt: end,
    executionWindow: { startAt: start, endAt: end },
    action: "charge_battery",
    targetDeviceIds: [deviceId],
    targetDevices: [{ deviceId }],
    reason: "Test",
    confidence: 0.8,
  };
}

function buildOutput(multiDevice = false): OptimizerOutput {
  const start = "2026-03-16T10:00:00.000Z";
  const end = "2026-03-16T10:30:00.000Z";
  const decisions = multiDevice
    ? [buildDecision("decision-battery", "battery", start, end), buildDecision("decision-ev", "ev", start, end)]
    : [buildDecision("decision-1", "battery", start, end)];

  const recommendedCommands = multiDevice
    ? [
      {
        commandId: "cmd-battery",
        deviceId: "battery",
        issuedAt: start,
        type: "set_mode" as const,
        mode: "charge" as const,
        effectiveWindow: { startAt: start, endAt: end },
      },
      {
        commandId: "cmd-ev",
        deviceId: "ev",
        issuedAt: start,
        type: "set_mode" as const,
        mode: "charge" as const,
        effectiveWindow: { startAt: start, endAt: end },
      },
    ]
    : [
      {
        commandId: "cmd-1",
        deviceId: "battery",
        issuedAt: start,
        type: "set_mode" as const,
        mode: "charge" as const,
        effectiveWindow: { startAt: start, endAt: end },
      },
    ];

  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: "plan-1",
    generatedAt: start,
    planningWindow: { startAt: start, endAt: end },
    status: "ok",
    headline: "Test",
    decisions,
    recommendedCommands,
    summary: {
      expectedImportCostPence: 100,
      expectedExportRevenuePence: 10,
      planningNetRevenueSurplusPence: -90,
    },
    diagnostics: [],
    feasibility: { executable: true, reasonCodes: ["PLAN_COMPUTED"] },
    assumptions: [],
    warnings: [],
    confidence: 0.8,
  };
}

describe("runControlLoopExecutionService shadow updates", () => {
  it("writes shadow state after successful execution", async () => {
    const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
      requests.map((request): CommandExecutionResult => ({
        executionRequestId: request.executionRequestId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        decisionId: request.decisionId,
        targetDeviceId: request.targetDeviceId,
        commandId: request.commandId,
        deviceId: request.targetDeviceId,
        status: "issued",
      })),
    );
    const executor: DeviceCommandExecutor = { execute };
    const shadowStore = new InMemoryDeviceShadowStore();

    await runControlLoopExecutionService(
      { now: "2026-03-16T10:05:00.000Z", systemState: buildSystemState(), optimizerOutput: buildOutput() },
      executor,
      undefined,
      shadowStore,
    );

    const shadow = shadowStore.getDeviceState("battery");
    expect(shadow).toBeDefined();
    expect(shadow?.lastKnownMode).toBe("charge");
    expect(shadow?.stateSource).toBe("execution_result");
  });

  it("does not write shadow state for failed execution", async () => {
    const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
      requests.map((request): CommandExecutionResult => ({
        executionRequestId: request.executionRequestId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        decisionId: request.decisionId,
        targetDeviceId: request.targetDeviceId,
        commandId: request.commandId,
        deviceId: request.targetDeviceId,
        status: "failed",
        errorCode: "COMMAND_FAILED",
      })),
    );
    const executor: DeviceCommandExecutor = { execute };
    const shadowStore = new InMemoryDeviceShadowStore();

    await runControlLoopExecutionService(
      { now: "2026-03-16T10:05:00.000Z", systemState: buildSystemState(), optimizerOutput: buildOutput() },
      executor,
      undefined,
      shadowStore,
    );

    expect(shadowStore.getDeviceState("battery")).toBeUndefined();
  });

  it("does not write shadow state for skipped execution", async () => {
    const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
      requests.map((request): CommandExecutionResult => ({
        executionRequestId: request.executionRequestId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        decisionId: request.decisionId,
        targetDeviceId: request.targetDeviceId,
        commandId: request.commandId,
        deviceId: request.targetDeviceId,
        status: "skipped",
        reasonCodes: ["ALREADY_SATISFIED"],
      })),
    );
    const executor: DeviceCommandExecutor = { execute };
    const shadowStore = new InMemoryDeviceShadowStore();

    await runControlLoopExecutionService(
      { now: "2026-03-16T10:05:00.000Z", systemState: buildSystemState(), optimizerOutput: buildOutput() },
      executor,
      undefined,
      shadowStore,
    );

    expect(shadowStore.getDeviceState("battery")).toBeUndefined();
  });

  it("updates independent shadow entries for multiple devices", async () => {
    const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
      requests.map((request): CommandExecutionResult => ({
        executionRequestId: request.executionRequestId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        decisionId: request.decisionId,
        targetDeviceId: request.targetDeviceId,
        commandId: request.commandId,
        deviceId: request.targetDeviceId,
        status: "issued",
      })),
    );
    const executor: DeviceCommandExecutor = { execute };
    const shadowStore = new InMemoryDeviceShadowStore();

    await runControlLoopExecutionService(
      { now: "2026-03-16T10:05:00.000Z", systemState: buildSystemState(), optimizerOutput: buildOutput(true) },
      executor,
      undefined,
      shadowStore,
    );

    const all = shadowStore.getAllDeviceStates();
    expect(all.battery).toBeDefined();
    expect(all.ev).toBeDefined();
  });

  it("preserves correlation fields into shadow state", async () => {
    const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
      requests.map((request): CommandExecutionResult => ({
        executionRequestId: request.executionRequestId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        decisionId: request.decisionId,
        targetDeviceId: request.targetDeviceId,
        commandId: request.commandId,
        deviceId: request.targetDeviceId,
        status: "issued",
      })),
    );
    const executor: DeviceCommandExecutor = { execute };
    const shadowStore = new InMemoryDeviceShadowStore();

    await runControlLoopExecutionService(
      { now: "2026-03-16T10:05:00.000Z", systemState: buildSystemState(), optimizerOutput: buildOutput() },
      executor,
      undefined,
      shadowStore,
    );

    const shadow = shadowStore.getDeviceState("battery");
    expect(shadow?.lastExecutionRequestId).toBeDefined();
    expect(shadow?.lastDecisionId).toBe("decision-1");
  });
});
