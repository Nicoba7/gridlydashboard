import { describe, expect, it, vi } from "vitest";
import type { SystemState } from "../domain";
import type { OptimizerDecision, OptimizerOutput } from "../domain/optimizer";
import { runControlLoopExecutionService } from "../application/controlLoopExecution/service";
import type { CommandExecutionRequest, DeviceCommandExecutor } from "../application/controlLoopExecution/types";
import { InMemoryDeviceCapabilitiesProvider } from "../capabilities/deviceCapabilitiesProvider";

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
    targetDevices: [{ deviceId: "battery" }],
    reason: "Charge in low-cost slot",
    confidence: 0.8,
  };
}

function buildOutputForCommand(commandOverrides?: Partial<OptimizerOutput["recommendedCommands"][number]>): OptimizerOutput {
  const decision = buildDecision("2026-03-16T10:00:00.000Z", "2026-03-16T10:30:00.000Z");

  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: "plan-1",
    generatedAt: "2026-03-16T10:00:00.000Z",
    planningWindow: {
      startAt: decision.startAt,
      endAt: decision.endAt,
    },
    status: "ok",
    headline: "Test plan",
    decisions: [decision],
    recommendedCommands: [
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
        ...commandOverrides,
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
    confidence: 0.8,
  };
}

function buildExecutor() {
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
  return { executor, execute };
}

function runWithOutput(
  output: OptimizerOutput,
  provider = new InMemoryDeviceCapabilitiesProvider([
    {
      deviceId: "battery",
      supportedCommandKinds: ["set_mode", "set_power_limit"],
      powerRangeW: { min: 500, max: 5000 },
      supportedModes: ["charge", "discharge"],
      minimumCommandWindowMinutes: 15,
      supportsOverlappingWindows: true,
      supportsImmediateExecution: true,
      schemaVersion: "capabilities.v1",
    },
  ]),
) {
  const { executor, execute } = buildExecutor();

  const promise = runControlLoopExecutionService(
    {
      now: "2026-03-16T10:05:00.000Z",
      systemState: buildSystemState(),
      optimizerOutput: output,
    },
    executor,
    provider,
  );

  return { promise, execute };
}

describe("runControlLoopExecutionService preflight", () => {
  it("fails when capabilities are missing", async () => {
    const provider = new InMemoryDeviceCapabilitiesProvider([]);
    const { promise, execute } = runWithOutput(buildOutputForCommand(), provider);
    const result = await promise;

    expect(execute).not.toHaveBeenCalled();
    expect(result.executionResults).toHaveLength(1);
    expect(result.executionResults[0].errorCode).toBe("CAPABILITIES_NOT_FOUND");
    expect(result.executionResults[0].reasonCodes).toContain("CAPABILITIES_NOT_FOUND");
  });

  it("fails unsupported command kind before dispatch", async () => {
    const { promise, execute } = runWithOutput(
      buildOutputForCommand({ type: "refresh_state" }),
    );
    const result = await promise;

    expect(execute).not.toHaveBeenCalled();
    expect(result.executionResults[0].errorCode).toBe("COMMAND_KIND_NOT_SUPPORTED");
  });

  it("fails unsupported mode before dispatch", async () => {
    const { promise, execute } = runWithOutput(
      buildOutputForCommand({ mode: "eco" }),
    );
    const result = await promise;

    expect(execute).not.toHaveBeenCalled();
    expect(result.executionResults[0].reasonCodes).toContain("MODE_NOT_SUPPORTED");
  });

  it("fails power setpoint out of range before dispatch", async () => {
    const { promise, execute } = runWithOutput(
      buildOutputForCommand({ type: "set_power_limit", powerW: 9000 }),
    );
    const result = await promise;

    expect(execute).not.toHaveBeenCalled();
    expect(result.executionResults[0].reasonCodes).toContain("POWER_SETPOINT_OUT_OF_RANGE");
  });

  it("executes valid command when preflight passes", async () => {
    const { promise, execute } = runWithOutput(buildOutputForCommand());
    const result = await promise;

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.executionResults).toHaveLength(1);
    expect(result.executionResults[0].status).toBe("issued");
  });
});
