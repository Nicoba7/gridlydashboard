import { describe, expect, it } from "vitest";
import type { DeviceState } from "../domain";
import type { OptimizerDecision, OptimizerOutput } from "../domain/optimizer";
import { InMemoryObservedDeviceStateStore } from "../observed/observedDeviceStateStore";
import { ingestCanonicalTelemetry } from "../application/telemetry/ingestionService";
import { buildControlLoopInputFromObservedState } from "../application/telemetry/buildControlLoopInputFromObservedState";

function buildDevices(): DeviceState[] {
  return [
    {
      deviceId: "battery",
      kind: "battery",
      brand: "AveumSim",
      name: "Home Battery",
      connectionStatus: "online",
      lastUpdatedAt: "2026-03-16T10:00:00.000Z",
      capabilities: ["read_power", "read_soc", "set_mode"],
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
    targetDeviceIds: ["battery"],
    targetDevices: [{ deviceId: "battery" }],
    reason: "Charge in low-cost slot",
    confidence: 0.9,
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
        deviceId: "battery",
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
      expectedImportCostPence: 10,
      expectedExportRevenuePence: 1,
      planningNetRevenueSurplusPence: -9,
    },
    diagnostics: [],
    feasibility: { executable: true, reasonCodes: ["PLAN_COMPUTED"] },
    assumptions: [],
    warnings: [],
    confidence: 0.8,
  };
}

describe("buildControlLoopInputFromObservedState", () => {
  it("builds ControlLoopInput using observed state aggregates", () => {
    const store = new InMemoryObservedDeviceStateStore();
    ingestCanonicalTelemetry(
      [
        {
          deviceId: "battery",
          timestamp: "2026-03-16T10:02:00.000Z",
          batterySocPercent: 62,
          batteryPowerW: -1400,
          solarGenerationW: 1100,
          gridImportPowerW: 700,
          schemaVersion: "telemetry.v1",
        },
      ],
      store,
    );

    const input = buildControlLoopInputFromObservedState({
      now: "2026-03-16T10:05:00.000Z",
      siteId: "site-1",
      timezone: "Europe/London",
      devices: buildDevices(),
      optimizerOutput: buildOptimizerOutput(),
      observedStateStore: store,
    });

    expect(input.now).toBe("2026-03-16T10:05:00.000Z");
    expect(input.optimizerOutput.planId).toBe("plan-1");
    expect(input.systemState.siteId).toBe("site-1");
    expect(input.systemState.batterySocPercent).toBe(62);
    expect(input.systemState.solarGenerationW).toBe(1100);
    expect(input.systemState.batteryPowerW).toBe(-1400);
    expect(input.systemState.gridPowerW).toBe(700);
    expect(input.observedStateFreshness?.overallStatus).toBe("fresh");
    expect(input.observedStateFreshness?.counts.fresh).toBe(1);
    expect(input.telemetryHealth?.overallStatus).toBe("healthy");
    expect(input.telemetryHealth?.counts.healthy).toBe(1);
  });

  it("passes through optional control-loop deviceTelemetry context", () => {
    const store = new InMemoryObservedDeviceStateStore();
    const input = buildControlLoopInputFromObservedState({
      now: "2026-03-16T10:05:00.000Z",
      siteId: "site-1",
      timezone: "Europe/London",
      devices: buildDevices(),
      optimizerOutput: buildOptimizerOutput(),
      observedStateStore: store,
      deviceTelemetry: {
        battery: {
          lastSeenAt: "2026-03-16T10:04:00.000Z",
          online: true,
        },
      },
    });

    expect(input.deviceTelemetry?.battery?.online).toBe(true);
    expect(input.systemState.homeLoadW).toBe(0);
    expect(input.observedStateFreshness?.overallStatus).toBe("missing");
    expect(input.observedStateFreshness?.counts.missing).toBe(1);
    expect(input.telemetryHealth?.overallStatus).toBe("unavailable");
  });

  it("marks stale observed state when freshness max age is exceeded", () => {
    const store = new InMemoryObservedDeviceStateStore();
    ingestCanonicalTelemetry(
      [
        {
          deviceId: "battery",
          timestamp: "2026-03-16T10:00:00.000Z",
          batterySocPercent: 62,
          schemaVersion: "telemetry.v1",
        },
      ],
      store,
    );

    const input = buildControlLoopInputFromObservedState({
      now: "2026-03-16T10:10:00.000Z",
      siteId: "site-1",
      timezone: "Europe/London",
      devices: buildDevices(),
      optimizerOutput: buildOptimizerOutput(),
      observedStateStore: store,
      freshnessMaxAgeSeconds: 60,
    });

    expect(input.observedStateFreshness?.overallStatus).toBe("stale");
    expect(input.observedStateFreshness?.counts.stale).toBe(1);
    expect(input.observedStateFreshness?.devices[0].status).toBe("stale");
    expect(input.telemetryHealth?.overallStatus).toBe("degraded");
    expect(input.telemetryHealth?.devices[0].reasonCodes).toContain("OBSERVED_STATE_STALE");
  });

  it("marks telemetry health degraded when recent invalid telemetry outcomes exist", () => {
    const store = new InMemoryObservedDeviceStateStore();
    ingestCanonicalTelemetry(
      [
        {
          deviceId: "battery",
          timestamp: "2026-03-16T10:03:00.000Z",
          batterySocPercent: 62,
          schemaVersion: "telemetry.v1",
        },
      ],
      store,
    );

    const input = buildControlLoopInputFromObservedState({
      now: "2026-03-16T10:05:00.000Z",
      siteId: "site-1",
      timezone: "Europe/London",
      devices: buildDevices(),
      optimizerOutput: buildOptimizerOutput(),
      observedStateStore: store,
      recentTelemetryIngestionOutcomes: [
        {
          deviceId: "battery",
          timestamp: "2026-03-16T10:04:00.000Z",
          status: "rejected_invalid",
          reasonCode: "INVALID_TIMESTAMP",
        },
      ],
    });

    expect(input.observedStateFreshness?.overallStatus).toBe("fresh");
    expect(input.telemetryHealth?.overallStatus).toBe("degraded");
    expect(input.telemetryHealth?.devices[0].reasonCodes).toEqual(["INVALID_TELEMETRY_HISTORY"]);
  });
});
