import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DeviceState, SystemState } from "../domain";
import type { OptimizerOutput } from "../domain/optimizer";
import type { CanonicalValueLedger } from "../domain/valueLedger";
import type { CycleContext, ContinuousLoopState } from "../application/continuousLoop/controlLoopRunnerTypes";
import { runContinuousLoopTick } from "../application/continuousLoop/controlLoopRunner";
import { runControlLoopExecutionService } from "../application/controlLoopExecution/service";
import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  DeviceCommandExecutor,
} from "../application/controlLoopExecution/types";
import { InMemoryObservedDeviceStateStore } from "../observed/observedDeviceStateStore";
import { TeslaChargingRealAdapter } from "../adapters/tesla/TeslaChargingRealAdapter";
import { runSingleTeslaCycle } from "../application/runtime/runSingleTeslaCycle";
import { TeslaContinuousCycleExecutor } from "../application/runtime/teslaContinuousCycleExecutor";
import type { TeslaSingleRunRuntime } from "../application/runtime/teslaSingleRunBootstrap";
import { FileExecutionJournalStore } from "../journal/fileExecutionJournalStore";

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function buildSystemState(): SystemState {
  return {
    siteId: "site-1",
    capturedAt: "2026-03-16T10:00:00.000Z",
    timezone: "Europe/London",
    devices: [],
    homeLoadW: 1200,
    solarGenerationW: 0,
    batteryPowerW: 0,
    evChargingPowerW: 0,
    gridPowerW: 1200,
  };
}

function buildPlan(vehicleId: string, includeCommand = true): OptimizerOutput {
  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: "plan-continuous-accountability",
    generatedAt: "2026-03-16T10:00:00.000Z",
    planningWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    status: "ok",
    headline: "Continuous accountability plan",
    decisions: includeCommand
      ? [
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
            confidence: 0.85,
          },
        ]
      : [],
    recommendedCommands: includeCommand
      ? [
          {
            commandId: "cmd-1",
            deviceId: vehicleId,
            issuedAt: "2026-03-16T10:05:00.000Z",
            type: "set_mode",
            mode: "charge",
            effectiveWindow: {
              startAt: "2026-03-16T10:00:00.000Z",
              endAt: "2026-03-16T10:30:00.000Z",
            },
          },
        ]
      : [],
    summary: {
      expectedImportCostPence: 90,
      expectedExportRevenuePence: 0,
      planningNetRevenueSurplusPence: -90,
    },
    diagnostics: [],
    feasibility: { executable: true, reasonCodes: ["PLAN_COMPUTED"] },
    assumptions: [],
    warnings: [],
    confidence: 0.85,
  };
}

function buildValueLedger(savingsPence: number): CanonicalValueLedger {
  return {
    optimizationMode: "balanced",
    estimatedImportCostPence: 90,
    estimatedExportRevenuePence: 0,
    estimatedBatteryDegradationCostPence: 1,
    estimatedNetCostPence: 91,
    baselineType: "hold_current_state",
    baselineNetCostPence: 100,
    baselineImportCostPence: 100,
    baselineExportRevenuePence: 0,
    baselineBatteryDegradationCostPence: 0,
    estimatedSavingsVsBaselinePence: savingsPence,
    assumptions: [],
    caveats: [],
    confidence: 0.8,
  };
}

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

function buildRuntime(vehicleId: string, executor: DeviceCommandExecutor): TeslaSingleRunRuntime {
  const observedStateStore = new InMemoryObservedDeviceStateStore();

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

  return {
    config: {
      accessToken: "token",
      vehicleId,
      timeoutMs: 10_000,
    },
    teslaAdapter,
    observedStateStore,
    executor,
    async runCycle(input) {
      return runSingleTeslaCycle({
        ...input,
        teslaVehicleId: vehicleId,
        teslaAdapter,
        observedStateStore,
        executor,
      });
    },
  };
}

describe("continuous live accountability", () => {
  it("persists command journal + heartbeat + economic snapshot for a successful continuous cycle", async () => {
    const dir = createTempDir("gridly-live-cycle-");

    try {
      const journalStore = new FileExecutionJournalStore({ directoryPath: dir });
      const vehicleId = "tesla-vehicle-1";
      const plan = buildPlan(vehicleId, true);
      const executor: DeviceCommandExecutor = {
        execute: vi.fn(async (requests: CommandExecutionRequest[]) =>
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
        ),
      };

      const runtime = buildRuntime(vehicleId, executor);

      const cycleExecutor = new TeslaContinuousCycleExecutor({
        runtime,
        buildPlan: async () => plan,
        resolveExecutionEnvironment: () => ({
          siteId: "site-1",
          timezone: "Europe/London",
          devices: buildDevices(vehicleId),
          journalStore,
          cycleFinancialContext: {
            optimizationMode: "balanced",
            valueLedger: buildValueLedger(9),
          },
        }),
      });

      const currentState: ContinuousLoopState = {
        status: "running",
        cycleCount: 0,
        consecutiveFailures: 0,
        planGeneratedAt: "2026-03-16T10:00:00.000Z",
        stalePlanCycleCount: 0,
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

      expect(result.summary.status).toBe("ok");
      expect(result.summary.issuedCommandCount).toBe(1);

      const entries = journalStore.getAll();
      const heartbeats = journalStore.getCycleHeartbeats();
      expect(entries).toHaveLength(1);
      expect(heartbeats).toHaveLength(1);
      expect(heartbeats[0].economicSnapshot?.estimatedSavingsVsBaselinePence).toBe(9);

      const reloaded = new FileExecutionJournalStore({ directoryPath: dir });
      expect(reloaded.getAll()).toHaveLength(1);
      expect(reloaded.getCycleHeartbeats()).toHaveLength(1);
      expect(reloaded.getCycleHeartbeats()[0].entryKind).toBe("cycle_heartbeat");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists fail-closed suppression when strict mode has missing runtime context", async () => {
    const dir = createTempDir("gridly-fail-closed-");

    try {
      const journalStore = new FileExecutionJournalStore({ directoryPath: dir });
      const executor: DeviceCommandExecutor = { execute: vi.fn(async () => []) };
      const plan = buildPlan("battery", true);

      await runControlLoopExecutionService(
        {
          now: "2026-03-16T10:05:00.000Z",
          systemState: buildSystemState(),
          optimizerOutput: {
            ...plan,
            decisions: [
              {
                ...plan.decisions[0],
                action: "charge_battery",
                targetDeviceIds: ["battery"],
                targetDevices: [{ deviceId: "battery" }],
              },
            ],
            recommendedCommands: [
              {
                commandId: "cmd-1",
                deviceId: "battery",
                issuedAt: "2026-03-16T10:05:00.000Z",
                type: "set_mode",
                mode: "charge",
                effectiveWindow: {
                  startAt: "2026-03-16T10:00:00.000Z",
                  endAt: "2026-03-16T10:30:00.000Z",
                },
              },
            ],
          },
        },
        executor,
        undefined,
        undefined,
        journalStore,
        {
          optimizationMode: "balanced",
          valueLedger: buildValueLedger(4),
        },
        undefined,
        "continuous_live_strict",
        { cycleId: "cycle-fail-closed" },
      );

      const entries = journalStore.getAll();
      const heartbeats = journalStore.getCycleHeartbeats();

      expect(entries).toHaveLength(1);
      expect(entries[0].reasonCodes).toContain("RUNTIME_CONTEXT_MISSING");
      expect(heartbeats).toHaveLength(1);
      expect(heartbeats[0].failClosedTriggered).toBe(true);
      expect(heartbeats[0].commandsSuppressed).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists heartbeat and economic snapshot for no-command cycles", async () => {
    const dir = createTempDir("gridly-no-command-");

    try {
      const journalStore = new FileExecutionJournalStore({ directoryPath: dir });
      const executor: DeviceCommandExecutor = { execute: vi.fn(async () => []) };
      const noCommandPlan = buildPlan("battery", false);

      await runControlLoopExecutionService(
        {
          now: "2026-03-16T10:05:00.000Z",
          systemState: buildSystemState(),
          optimizerOutput: noCommandPlan,
        },
        executor,
        undefined,
        undefined,
        journalStore,
        {
          optimizationMode: "balanced",
          valueLedger: buildValueLedger(0),
        },
        undefined,
        "standard",
        { cycleId: "cycle-no-command" },
      );

      const entries = journalStore.getAll();
      const heartbeats = journalStore.getCycleHeartbeats();

      expect(entries).toHaveLength(0);
      expect(heartbeats).toHaveLength(1);
      expect(heartbeats[0].commandsIssued).toBe(0);
      expect(heartbeats[0].economicSnapshot?.optimizationMode).toBe("balanced");
      expect(heartbeats[0].economicSnapshot?.hasValueSeekingDecisions).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
