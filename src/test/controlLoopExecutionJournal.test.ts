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
import { InMemoryExecutionJournalStore } from "../journal/executionJournalStore";

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
      expectedNetValuePence: -90,
    },
    diagnostics: [],
    feasibility: { executable: true, reasonCodes: ["PLAN_COMPUTED"] },
    assumptions: [],
    warnings: [],
    confidence: 0.8,
  };
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
      supportedModes: ["charge"],
      minimumCommandWindowMinutes: 15,
      supportsOverlappingWindows: true,
      supportsImmediateExecution: true,
      schemaVersion: "capabilities.v1",
    },
  ]);
}

describe("runControlLoopExecutionService journal", () => {
  it("records journal entry for preflight-invalid command", async () => {
    const execute = vi.fn(async (_requests: CommandExecutionRequest[]) => [] as CommandExecutionResult[]);
    const executor: DeviceCommandExecutor = { execute };
    const journal = new InMemoryExecutionJournalStore();
    const provider = new InMemoryDeviceCapabilitiesProvider([]);

    await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput([
          {
            commandId: "cmd-1",
            deviceId: "battery",
            issuedAt: "2026-03-16T10:00:00.000Z",
            type: "set_mode",
            mode: "charge",
            effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
          },
        ]),
      },
      executor,
      provider,
      undefined,
      journal,
    );

    expect(execute).not.toHaveBeenCalled();
    const entries = journal.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].stage).toBe("preflight_validation");
    expect(entries[0].reasonCodes).toContain("CAPABILITIES_NOT_FOUND");
  });

  it("records journal entry for reconciliation skip", async () => {
    const execute = vi.fn(async (_requests: CommandExecutionRequest[]) => [] as CommandExecutionResult[]);
    const executor: DeviceCommandExecutor = { execute };
    const journal = new InMemoryExecutionJournalStore();
    const shadowStore = new InMemoryDeviceShadowStore();
    shadowStore.setDeviceState("battery", {
      deviceId: "battery",
      lastKnownMode: "charge",
      lastKnownWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
      lastUpdatedAt: "2026-03-16T10:04:00.000Z",
      stateSource: "execution_result",
      schemaVersion: "device-shadow.v1",
    });

    await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput([
          {
            commandId: "cmd-1",
            deviceId: "battery",
            issuedAt: "2026-03-16T10:00:00.000Z",
            type: "set_mode",
            mode: "charge",
            effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
          },
        ]),
      },
      executor,
      buildCapabilitiesProvider(),
      shadowStore,
      journal,
    );

    expect(execute).not.toHaveBeenCalled();
    const entries = journal.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].stage).toBe("reconciliation");
    expect(entries[0].status).toBe("skipped");
    expect(entries[0].acknowledgementStatus).toBe("pending");
  });

  it("records journal entry for successful dispatch", async () => {
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
    const journal = new InMemoryExecutionJournalStore();

    await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput([
          {
            commandId: "cmd-1",
            deviceId: "battery",
            issuedAt: "2026-03-16T10:00:00.000Z",
            type: "set_mode",
            mode: "charge",
            effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
          },
        ]),
      },
      executor,
      buildCapabilitiesProvider(),
      undefined,
      journal,
    );

    const entries = journal.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].stage).toBe("dispatch");
    expect(entries[0].status).toBe("issued");
    expect(entries[0].acknowledgementStatus).toBe("acknowledged");
  });

  it("records journal entry for failed dispatch", async () => {
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
        reasonCodes: ["COMMAND_FAILED"],
        errorCode: "COMMAND_FAILED",
      })),
    );
    const executor: DeviceCommandExecutor = { execute };
    const journal = new InMemoryExecutionJournalStore();

    await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput([
          {
            commandId: "cmd-1",
            deviceId: "battery",
            issuedAt: "2026-03-16T10:00:00.000Z",
            type: "set_mode",
            mode: "charge",
            effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
          },
        ]),
      },
      executor,
      buildCapabilitiesProvider(),
      undefined,
      journal,
    );

    const entries = journal.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].stage).toBe("dispatch");
    expect(entries[0].status).toBe("failed");
    expect(entries[0].acknowledgementStatus).toBe("not_acknowledged");
    expect(entries[0].reasonCodes).toContain("COMMAND_FAILED");
  });

  it("appends independent entries for multiple commands", async () => {
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
    const journal = new InMemoryExecutionJournalStore();
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

    await runControlLoopExecutionService(
      { now: "2026-03-16T10:05:00.000Z", systemState: buildSystemState(), optimizerOutput: output },
      executor,
      buildCapabilitiesProvider(),
      shadowStore,
      journal,
    );

    const entries = journal.getAll();
    expect(entries).toHaveLength(2);
    expect(entries.some((entry) => entry.status === "skipped")).toBe(true);
    expect(entries.some((entry) => entry.status === "issued")).toBe(true);
    entries.forEach((entry) => {
      expect(entry.executionRequestId).toBeTruthy();
      expect(entry.idempotencyKey).toBeTruthy();
      expect(entry.targetDeviceId).toBeTruthy();
    });
  });
});
