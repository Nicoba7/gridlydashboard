import { describe, expect, it, vi } from "vitest";
import type { SystemState } from "../domain";
import type { OptimizerDecision, OptimizerOutput } from "../domain/optimizer";
import { runControlLoopExecutionService } from "../application/controlLoopExecution/service";
import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  DeviceCommandExecutor,
} from "../application/controlLoopExecution/types";
import { InMemoryDeviceCapabilitiesProvider } from "../capabilities/deviceCapabilitiesProvider";
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

function buildDecision(id: string, deviceId: string): OptimizerDecision {
  return {
    decisionId: id,
    startAt: "2026-03-16T10:00:00.000Z",
    endAt: "2026-03-16T10:30:00.000Z",
    executionWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    action: "charge_battery",
    targetDeviceIds: [deviceId],
    targetDevices: [{ deviceId }],
    reason: "Test",
    confidence: 0.8,
  };
}

function buildOutput(commands: OptimizerOutput["recommendedCommands"], decisions?: OptimizerDecision[]): OptimizerOutput {
  const normalizedDecisions = decisions ?? [buildDecision("decision-1", "battery")];
  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: "plan-1",
    generatedAt: "2026-03-16T10:00:00.000Z",
    planningWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    status: "ok",
    headline: "Test",
    decisions: normalizedDecisions,
    recommendedCommands: commands,
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

function buildExecutor() {
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
  return { executor, execute };
}

function buildCapabilitiesProvider() {
  return new InMemoryDeviceCapabilitiesProvider([
    {
      deviceId: "battery",
      supportedCommandKinds: ["set_mode", "set_power_limit"],
      supportedModes: ["charge", "discharge"],
      powerRangeW: { min: 500, max: 7000 },
      minimumCommandWindowMinutes: 15,
      supportsOverlappingWindows: true,
      supportsImmediateExecution: true,
      schemaVersion: "capabilities.v1",
    },
    {
      deviceId: "ev",
      supportedCommandKinds: ["set_mode"],
      supportedModes: ["charge", "stop"],
      minimumCommandWindowMinutes: 15,
      supportsOverlappingWindows: true,
      supportsImmediateExecution: true,
      schemaVersion: "capabilities.v1",
    },
  ]);
}

describe("runControlLoopExecutionService reconciliation", () => {
  it("executes when shadow is missing", async () => {
    const { executor, execute } = buildExecutor();
    const shadowStore = new InMemoryDeviceShadowStore();
    const output = buildOutput([
      {
        commandId: "cmd-1",
        deviceId: "battery",
        issuedAt: "2026-03-16T10:00:00.000Z",
        type: "set_mode",
        mode: "charge",
        effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
      },
    ]);

    const result = await runControlLoopExecutionService(
      { now: "2026-03-16T10:05:00.000Z", systemState: buildSystemState(), optimizerOutput: output },
      executor,
      buildCapabilitiesProvider(),
      shadowStore,
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.executionResults[0].status).toBe("issued");
  });

  it("skips when shadow already satisfies command", async () => {
    const { executor, execute } = buildExecutor();
    const shadowStore = new InMemoryDeviceShadowStore();
    shadowStore.setDeviceState("battery", {
      deviceId: "battery",
      lastKnownMode: "charge",
      lastKnownWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
      lastUpdatedAt: "2026-03-16T10:04:00.000Z",
      stateSource: "execution_result",
      schemaVersion: "device-shadow.v1",
    });
    const output = buildOutput([
      {
        commandId: "cmd-1",
        deviceId: "battery",
        issuedAt: "2026-03-16T10:00:00.000Z",
        type: "set_mode",
        mode: "charge",
        effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
      },
    ]);

    const result = await runControlLoopExecutionService(
      { now: "2026-03-16T10:05:00.000Z", systemState: buildSystemState(), optimizerOutput: output },
      executor,
      buildCapabilitiesProvider(),
      shadowStore,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(result.executionResults[0].status).toBe("skipped");
    expect(result.executionResults[0].reasonCodes).toContain("ALREADY_SATISFIED");
  });

  it("executes when power mismatches", async () => {
    const { executor, execute } = buildExecutor();
    const shadowStore = new InMemoryDeviceShadowStore();
    shadowStore.setDeviceState("battery", {
      deviceId: "battery",
      lastKnownPowerW: 2000,
      lastUpdatedAt: "2026-03-16T10:04:00.000Z",
      stateSource: "execution_result",
      schemaVersion: "device-shadow.v1",
    });
    const output = buildOutput([
      {
        commandId: "cmd-p",
        deviceId: "battery",
        issuedAt: "2026-03-16T10:00:00.000Z",
        type: "set_power_limit",
        powerW: 3000,
        effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
      },
    ]);

    await runControlLoopExecutionService(
      { now: "2026-03-16T10:05:00.000Z", systemState: buildSystemState(), optimizerOutput: output },
      executor,
      buildCapabilitiesProvider(),
      shadowStore,
    );

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("executes when mode mismatches", async () => {
    const { executor, execute } = buildExecutor();
    const shadowStore = new InMemoryDeviceShadowStore();
    shadowStore.setDeviceState("battery", {
      deviceId: "battery",
      lastKnownMode: "discharge",
      lastKnownWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
      lastUpdatedAt: "2026-03-16T10:04:00.000Z",
      stateSource: "execution_result",
      schemaVersion: "device-shadow.v1",
    });
    const output = buildOutput([
      {
        commandId: "cmd-1",
        deviceId: "battery",
        issuedAt: "2026-03-16T10:00:00.000Z",
        type: "set_mode",
        mode: "charge",
        effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
      },
    ]);

    await runControlLoopExecutionService(
      { now: "2026-03-16T10:05:00.000Z", systemState: buildSystemState(), optimizerOutput: output },
      executor,
      buildCapabilitiesProvider(),
      shadowStore,
    );

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("executes when shadow is incomplete", async () => {
    const { executor, execute } = buildExecutor();
    const shadowStore = new InMemoryDeviceShadowStore();
    shadowStore.setDeviceState("battery", {
      deviceId: "battery",
      lastKnownWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
      lastUpdatedAt: "2026-03-16T10:04:00.000Z",
      stateSource: "execution_result",
      schemaVersion: "device-shadow.v1",
    });
    const output = buildOutput([
      {
        commandId: "cmd-1",
        deviceId: "battery",
        issuedAt: "2026-03-16T10:00:00.000Z",
        type: "set_mode",
        mode: "charge",
        effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
      },
    ]);

    await runControlLoopExecutionService(
      { now: "2026-03-16T10:05:00.000Z", systemState: buildSystemState(), optimizerOutput: output },
      executor,
      buildCapabilitiesProvider(),
      shadowStore,
    );

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("reconciles multiple devices independently", async () => {
    const { executor, execute } = buildExecutor();
    const shadowStore = new InMemoryDeviceShadowStore();
    shadowStore.setDeviceState("battery", {
      deviceId: "battery",
      lastKnownMode: "charge",
      lastKnownWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
      lastUpdatedAt: "2026-03-16T10:04:00.000Z",
      stateSource: "execution_result",
      schemaVersion: "device-shadow.v1",
    });

    const output = buildOutput(
      [
        {
          commandId: "cmd-battery",
          deviceId: "battery",
          issuedAt: "2026-03-16T10:00:00.000Z",
          type: "set_mode",
          mode: "charge",
          effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
        },
        {
          commandId: "cmd-ev",
          deviceId: "ev",
          issuedAt: "2026-03-16T10:00:00.000Z",
          type: "set_mode",
          mode: "charge",
          effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
        },
      ],
      [buildDecision("decision-battery", "battery"), buildDecision("decision-ev", "ev")],
    );

    const result = await runControlLoopExecutionService(
      { now: "2026-03-16T10:05:00.000Z", systemState: buildSystemState(), optimizerOutput: output },
      executor,
      buildCapabilitiesProvider(),
      shadowStore,
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toHaveLength(1);
    expect(result.executionResults.some((item) => item.status === "skipped")).toBe(true);
    expect(result.executionResults.some((item) => item.status === "issued")).toBe(true);
  });
});
