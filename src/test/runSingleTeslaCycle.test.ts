import { describe, expect, it, vi } from "vitest";
import type { DeviceState } from "../domain";
import type { OptimizerDecision, OptimizerOutput } from "../domain/optimizer";
import { DeviceAdapterRegistry } from "../adapters/adapterRegistry";
import { LiveAdapterDeviceCommandExecutor } from "../application/controlLoopExecution/liveAdapterExecutor";
import { TeslaChargingRealAdapter } from "../adapters/tesla/TeslaChargingRealAdapter";
import { InMemoryObservedDeviceStateStore } from "../observed/observedDeviceStateStore";
import { runSingleTeslaCycle } from "../application/runtime/runSingleTeslaCycle";

function buildDevices(): DeviceState[] {
  return [
    {
      deviceId: "tesla-vehicle-1",
      kind: "ev_charger",
      brand: "Tesla",
      name: "Tesla Vehicle Charger",
      connectionStatus: "online",
      lastUpdatedAt: "2026-03-16T10:00:00.000Z",
      capabilities: ["start_stop", "read_soc", "read_power"],
    },
  ];
}

function buildDecision(): OptimizerDecision {
  return {
    decisionId: "decision-1",
    startAt: "2026-03-16T10:00:00.000Z",
    endAt: "2026-03-16T10:30:00.000Z",
    executionWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    action: "charge_battery",
    targetDeviceIds: ["tesla-vehicle-1"],
    targetDevices: [{ deviceId: "tesla-vehicle-1" }],
    reason: "Charge EV in low-cost slot",
    confidence: 0.85,
  };
}

function buildOptimizerOutput(): OptimizerOutput {
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
    decisions: [buildDecision()],
    recommendedCommands: [
      {
        commandId: "cmd-1",
        deviceId: "tesla-vehicle-1",
        issuedAt: "2026-03-16T10:00:00.000Z",
        type: "start_charging",
        effectiveWindow: {
          startAt: "2026-03-16T10:00:00.000Z",
          endAt: "2026-03-16T10:30:00.000Z",
        },
      },
    ],
    summary: {
      expectedImportCostPence: 120,
      expectedExportRevenuePence: 0,
      planningNetRevenueSurplusPence: -120,
    },
    diagnostics: [],
    feasibility: { executable: true, reasonCodes: ["PLAN_COMPUTED"] },
    assumptions: [],
    warnings: [],
    confidence: 0.8,
  };
}

describe("runSingleTeslaCycle", () => {
  it("runs observe -> decide -> act once and returns structured result", async () => {
    const teslaAdapter = new TeslaChargingRealAdapter({
      supportedVehicleIds: ["tesla-vehicle-1"],
      client: {
        startCharging: vi.fn(async () => ({ result: true, reason: "ok" })),
        stopCharging: vi.fn(async () => ({ result: true, reason: "ok" })),
        readChargingTelemetry: vi.fn(async () => ({
          vehicleId: "tesla-vehicle-1",
          timestamp: "2026-03-16T10:05:00.000Z",
          chargingState: "Charging",
          chargePortLatch: "Engaged",
          chargerPowerKw: 7,
          batteryLevel: 68,
        })),
      },
    });

    const registry = new DeviceAdapterRegistry([teslaAdapter]);
    const executor = new LiveAdapterDeviceCommandExecutor(registry);
    const observedStateStore = new InMemoryObservedDeviceStateStore();

    const result = await runSingleTeslaCycle({
      now: "2026-03-16T10:05:00.000Z",
      siteId: "site-1",
      timezone: "Europe/London",
      devices: buildDevices(),
      optimizerOutput: buildOptimizerOutput(),
      teslaVehicleId: "tesla-vehicle-1",
      teslaAdapter,
      observedStateStore,
      executor,
    });

    expect(result.telemetryIngestionResult.ingestedCount).toBe(1);
    expect(result.telemetryIngestionResult.acceptedCount).toBe(1);
    expect(result.controlLoopResult.commandsToIssue).toHaveLength(1);
    expect(result.executionSummary.total).toBe(1);
    expect(result.executionSummary.issued).toBe(1);
    expect(result.executionSummary.executionPosture).toBe("normal");
    expect(observedStateStore.getDeviceState("tesla-vehicle-1")?.batterySocPercent).toBe(68);
  });

  it("propagates telemetry transport failure and does not mutate observed state", async () => {
    const teslaAdapter = new TeslaChargingRealAdapter({
      supportedVehicleIds: ["tesla-vehicle-1"],
      client: {
        startCharging: vi.fn(async () => ({ result: true, reason: "ok" })),
        stopCharging: vi.fn(async () => ({ result: true, reason: "ok" })),
        readChargingTelemetry: vi.fn(async () => {
          throw new Error("telemetry unavailable");
        }),
      },
    });

    const registry = new DeviceAdapterRegistry([teslaAdapter]);
    const executor = new LiveAdapterDeviceCommandExecutor(registry);
    const observedStateStore = new InMemoryObservedDeviceStateStore();

    await expect(
      runSingleTeslaCycle({
        now: "2026-03-16T10:05:00.000Z",
        siteId: "site-1",
        timezone: "Europe/London",
        devices: buildDevices(),
        optimizerOutput: buildOptimizerOutput(),
        teslaVehicleId: "tesla-vehicle-1",
        teslaAdapter,
        observedStateStore,
        executor,
      }),
    ).rejects.toThrow("telemetry unavailable");

    expect(observedStateStore.getDeviceState("tesla-vehicle-1")).toBeUndefined();
  });
});
