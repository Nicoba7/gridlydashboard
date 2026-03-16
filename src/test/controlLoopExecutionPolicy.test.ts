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

function buildOutput(commands: OptimizerOutput["recommendedCommands"], overrides?: Partial<OptimizerOutput>): OptimizerOutput {
  return {
    planId: "plan-1",
    generatedAt: "2026-03-16T10:00:00.000Z",
    status: "ok",
    headline: "Test",
    decisions: [buildDecision("decision-1", "battery")],
    recommendedCommands: commands,
    summary: {
      expectedImportCostPence: 100,
      expectedExportRevenuePence: 10,
      expectedNetValuePence: -90,
    },
    diagnostics: [],
    confidence: 0.8,
    planningWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    feasibility: { executable: true, reasonCodes: ["PLAN_COMPUTED"] },
    ...overrides,
  };
}

function buildCapabilitiesProvider() {
  return new InMemoryDeviceCapabilitiesProvider([
    {
      deviceId: "battery",
      supportedCommandKinds: ["set_mode", "schedule_window"],
      supportedModes: ["charge", "discharge"],
      minimumCommandWindowMinutes: 5,
      supportsOverlappingWindows: true,
      supportsImmediateExecution: true,
      schemaVersion: "capabilities.v1",
    },
  ]);
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

describe("runControlLoopExecutionService policy", () => {
  it("denies inactive execution window and does not dispatch", async () => {
    const { executor, execute } = buildExecutor();
    const journal = new InMemoryExecutionJournalStore();

    const result = await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:40:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput([
          {
            commandId: "cmd-1",
            deviceId: "battery",
            issuedAt: "2026-03-16T10:00:00.000Z",
            type: "schedule_window",
            effectiveWindow: { startAt: "2026-03-16T10:35:00.000Z", endAt: "2026-03-16T10:45:00.000Z" },
            window: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
            targetMode: "charge",
          },
        ]),
      },
      executor,
      buildCapabilitiesProvider(),
      undefined,
      journal,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(result.executionResults[0].status).toBe("skipped");
    expect(result.executionResults[0].reasonCodes).toContain("EXECUTION_WINDOW_NOT_ACTIVE");
    expect(journal.getAll()).toHaveLength(1);
  });

  it("denies when planning window expired and does not dispatch", async () => {
    const { executor, execute } = buildExecutor();

    const result = await runControlLoopExecutionService(
      {
        now: "2026-03-16T11:10:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput(
          [
            {
              commandId: "cmd-1",
              deviceId: "battery",
              issuedAt: "2026-03-16T10:00:00.000Z",
              type: "set_mode",
              mode: "charge",
              effectiveWindow: { startAt: "2026-03-16T11:00:00.000Z", endAt: "2026-03-16T11:30:00.000Z" },
            },
          ],
          {
            planningWindow: {
              startAt: "2026-03-16T10:00:00.000Z",
              endAt: "2026-03-16T10:30:00.000Z",
            },
          },
        ),
      },
      executor,
      buildCapabilitiesProvider(),
    );

    expect(execute).not.toHaveBeenCalled();
    expect(result.executionResults[0].reasonCodes).toContain("PLANNING_WINDOW_EXPIRED");
  });

  it("denies when plan infeasible and does not dispatch", async () => {
    const { executor, execute } = buildExecutor();

    const result = await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput(
          [
            {
              commandId: "cmd-1",
              deviceId: "battery",
              issuedAt: "2026-03-16T10:00:00.000Z",
              type: "set_mode",
              mode: "charge",
              effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
            },
          ],
          {
            feasibility: {
              executable: false,
              reasonCodes: ["PLAN_INFEASIBLE"],
            },
          },
        ),
      },
      executor,
      buildCapabilitiesProvider(),
    );

    expect(execute).not.toHaveBeenCalled();
    expect(result.executionResults[0].reasonCodes).toContain("PLAN_INFEASIBLE");
  });

  it("allows first command and denies same-device conflict in same batch", async () => {
    const { executor, execute } = buildExecutor();
    const result = await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: {
          ...buildOutput([
            {
              commandId: "cmd-1",
              deviceId: "battery",
              issuedAt: "2026-03-16T10:00:00.000Z",
              type: "set_mode",
              mode: "charge",
              effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
            },
            {
              commandId: "cmd-2",
              deviceId: "battery",
              issuedAt: "2026-03-16T10:00:00.000Z",
              type: "set_mode",
              mode: "discharge",
              effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
            },
          ]),
          decisions: [buildDecision("decision-1", "battery"), buildDecision("decision-2", "battery")],
        },
      },
      executor,
      buildCapabilitiesProvider(),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toHaveLength(1);
    expect(result.executionResults.some((entry) => entry.reasonCodes?.includes("CONFLICTING_COMMAND_FOR_DEVICE"))).toBe(true);
  });

  it("allows valid command and dispatches normally", async () => {
    const { executor, execute } = buildExecutor();

    const result = await runControlLoopExecutionService(
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
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.executionResults[0].status).toBe("issued");
  });
});
