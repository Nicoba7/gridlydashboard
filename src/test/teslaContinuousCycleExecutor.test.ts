import { describe, expect, it, vi } from "vitest";
import type { DeviceState } from "../domain";
import type { OptimizerOutput } from "../domain/optimizer";
import type {
  CycleContext,
  ContinuousLoopState,
} from "../application/continuousLoop/controlLoopRunnerTypes";
import { runContinuousLoopTick } from "../application/continuousLoop/controlLoopRunner";
import { TeslaChargingRealAdapter } from "../adapters/tesla/TeslaChargingRealAdapter";
import { InMemoryObservedDeviceStateStore } from "../observed/observedDeviceStateStore";
import type { CommandExecutionRequest, DeviceCommandExecutor } from "../application/controlLoopExecution/types";
import { InMemoryExecutionJournalStore } from "../journal/executionJournalStore";
import type { TeslaSingleRunRuntime } from "../application/runtime/teslaSingleRunBootstrap";
import { runSingleTeslaCycle } from "../application/runtime/runSingleTeslaCycle";
import { TeslaContinuousCycleExecutor } from "../application/runtime/teslaContinuousCycleExecutor";

function buildDevices(vehicleId: string): DeviceState[] {
  return [
    {
      deviceId: vehicleId,
      kind: "ev_charger",
      brand: "Tesla",
      name: "Tesla Vehicle Charger",
      connectionStatus: "online",
      lastUpdatedAt: "2026-03-16T10:00:00.000Z",
      capabilities: ["start_stop", "read_soc", "read_power", "set_mode"],
    },
  ];
}

function buildPlan(vehicleId: string): OptimizerOutput {
  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: "plan-continuous",
    generatedAt: "2026-03-16T08:00:00.000Z",
    planningWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    status: "ok",
    headline: "Continuous executor plan",
    decisions: [
      {
        decisionId: "decision-1",
        startAt: "2026-03-16T10:00:00.000Z",
        endAt: "2026-03-16T10:30:00.000Z",
        executionWindow: {
          startAt: "2026-03-16T10:00:00.000Z",
          endAt: "2026-03-16T10:30:00.000Z",
        },
        action: "charge_ev",
        targetDeviceIds: [vehicleId],
        targetDevices: [{ deviceId: vehicleId, kind: "ev_charger", requiredCapabilities: ["set_mode"] }],
        reason: "Charge EV",
        confidence: 0.8,
      },
    ],
    recommendedCommands: [
      {
        commandId: "cmd-1",
        deviceId: vehicleId,
        issuedAt: "2026-03-16T10:00:00.000Z",
        type: "set_mode",
        mode: "charge",
        effectiveWindow: {
          startAt: "2026-03-16T10:00:00.000Z",
          endAt: "2026-03-16T10:30:00.000Z",
        },
      },
    ],
    summary: {
      expectedImportCostPence: 100,
      expectedExportRevenuePence: 0,
      planningNetRevenueSurplusPence: -100,
    },
    diagnostics: [],
    feasibility: { executable: true, reasonCodes: ["PLAN_COMPUTED"] },
    assumptions: [],
    warnings: [],
    confidence: 0.8,
  };
}

function buildRuntimeHarness(vehicleId: string) {
  const observedStateStore = new InMemoryObservedDeviceStateStore();
  const journalStore = new InMemoryExecutionJournalStore();
  const executeSpy = vi.fn(async (_requests: CommandExecutionRequest[]) => []);
  const executor: DeviceCommandExecutor = { execute: executeSpy };

  const teslaAdapter = new TeslaChargingRealAdapter({
    supportedVehicleIds: [vehicleId],
    client: {
      startCharging: vi.fn(async () => ({ result: true, reason: "ok" })),
      stopCharging: vi.fn(async () => ({ result: true, reason: "ok" })),
      readChargingTelemetry: vi.fn(async () => ({
        vehicleId,
        timestamp: "2026-03-16T10:05:00.000Z",
        chargingState: "Charging",
        chargePortLatch: "Engaged",
        chargerPowerKw: 7,
        batteryLevel: 68,
      })),
    },
  });

  let capturedRunCycleInput: unknown;

  const runtime: TeslaSingleRunRuntime = {
    config: {
      accessToken: "token",
      vehicleId,
      timeoutMs: 10_000,
    },
    teslaAdapter,
    observedStateStore,
    executor,
    async runCycle(input) {
      capturedRunCycleInput = input;
      return runSingleTeslaCycle({
        ...input,
        teslaVehicleId: vehicleId,
        teslaAdapter,
        observedStateStore,
        executor,
      });
    },
  };

  return {
    runtime,
    journalStore,
    executeSpy,
    getCapturedRunCycleInput: () => capturedRunCycleInput,
  };
}

function buildCycleFinancialContext() {
  return {
    optimizationMode: "balanced" as const,
    valueLedger: {
      optimizationMode: "balanced" as const,
      estimatedImportCostPence: 100,
      estimatedExportRevenuePence: 0,
      estimatedBatteryDegradationCostPence: 1,
      estimatedNetCostPence: 101,
      baselineType: "hold_current_state" as const,
      baselineNetCostPence: 110,
      baselineImportCostPence: 110,
      baselineExportRevenuePence: 0,
      baselineBatteryDegradationCostPence: 0,
      estimatedSavingsVsBaselinePence: 9,
      assumptions: [],
      caveats: [],
      confidence: 0.8,
    },
  };
}

describe("TeslaContinuousCycleExecutor", () => {
  it("threads CycleContext runtime truth into strict live execution mode", async () => {
    const vehicleId = "tesla-vehicle-1";
    const plan = buildPlan(vehicleId);
    const harness = buildRuntimeHarness(vehicleId);

    const cycleExecutor = new TeslaContinuousCycleExecutor({
      runtime: harness.runtime,
      buildPlan: async () => plan,
      resolveExecutionEnvironment: () => ({
        siteId: "site-1",
        timezone: "Europe/London",
        devices: buildDevices(vehicleId),
        journalStore: harness.journalStore,
        cycleFinancialContext: buildCycleFinancialContext(),
      }),
    });

    const ctx: CycleContext = {
      cycleId: "cycle-site-1-20260316T100500Z",
      nowIso: "2026-03-16T10:05:00.000Z",
      currentPlan: plan,
      isReplan: false,
      planAgeSeconds: 3900,
      planFreshnessStatus: "expired",
      replanTriggered: true,
      replanTrigger: "expired_plan",
      replanReason: "Plan expired",
      stalePlanReuseCount: 2,
      safeHoldMode: true,
      stalePlanWarning: "Safe-hold mode active",
    };

    await cycleExecutor.execute(ctx);

    const captured = harness.getCapturedRunCycleInput() as {
      runtimeGuardrailContext: {
        safeHoldMode?: boolean;
        planFreshnessStatus?: string;
        replanTrigger?: string;
        stalePlanReuseCount?: number;
        stalePlanWarning?: string;
      };
      runtimeExecutionMode?: string;
    };

    expect(captured.runtimeExecutionMode).toBe("continuous_live_strict");
    expect(captured.runtimeGuardrailContext).toEqual({
      safeHoldMode: true,
      planFreshnessStatus: "expired",
      replanTrigger: "expired_plan",
      stalePlanReuseCount: 2,
      stalePlanWarning: "Safe-hold mode active",
    });
  });

  it("suppresses aggressive live dispatch when continuous runtime enters safeHoldMode", async () => {
    const vehicleId = "tesla-vehicle-1";
    const plan = buildPlan(vehicleId);
    const harness = buildRuntimeHarness(vehicleId);

    const cycleExecutor = new TeslaContinuousCycleExecutor({
      runtime: harness.runtime,
      buildPlan: async () => {
        throw new Error("replan failed");
      },
      resolveExecutionEnvironment: () => ({
        siteId: "site-1",
        timezone: "Europe/London",
        devices: buildDevices(vehicleId),
        journalStore: harness.journalStore,
        cycleFinancialContext: buildCycleFinancialContext(),
      }),
    });

    const currentState: ContinuousLoopState = {
      status: "running",
      cycleCount: 0,
      consecutiveFailures: 0,
      planGeneratedAt: "2026-03-16T08:00:00.000Z",
      stalePlanCycleCount: 2,
    };

    const result = await runContinuousLoopTick(
      {
        currentState,
        currentPlan: plan,
        siteId: "site-1",
        nowIso: "2026-03-16T10:05:00.000Z",
        maxConsecutiveFailures: 5,
        planFreshnessThresholdSeconds: 1800,
        stalePlanMaxCycles: 3,
      },
      cycleExecutor,
    );

    expect(harness.executeSpy).not.toHaveBeenCalled();
    expect(result.summary.status).toBe("ok");
    expect(result.summary.issuedCommandCount).toBe(0);
    expect(result.summary.skippedCommandCount).toBe(1);
    expect(result.summary.failedCommandCount).toBe(0);
    expect(result.summary.planFreshnessStatus).toBe("expired");
    expect(result.summary.stalePlanReuseCount).toBe(3);

    const entries = harness.journalStore.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].recordedAt).toBe("2026-03-16T10:05:00.000Z");
    expect(entries[0].reasonCodes).toEqual([
      "RUNTIME_CONSERVATIVE_MODE_ACTIVE",
      "RUNTIME_SAFE_HOLD_ACTIVE",
      "RUNTIME_PLAN_EXPIRED",
      "RUNTIME_REPLAN_GUARD_ACTIVE",
    ]);
    expect(entries[0].cycleFinancialContext?.runtimeExecutionPosture).toBe("hold_only");
  });
});
