import { describe, expect, it } from "vitest";
import type { DeviceState, SystemState } from "../domain";
import type { OptimizerDecision, OptimizerOutput } from "../domain/optimizer";
import { ManualIntervalScheduler } from "../application/continuousLoop/intervalScheduler";
import { runContinuousRuntime } from "../application/runtime/runContinuousRuntime";
import { InMemoryExecutionJournalStore } from "../journal/executionJournalStore";
import {
  createSimulatedEnergySiteIntegration,
  type SimulatedCycleScenario,
  type SimulatedEnergySiteTrace,
} from "../integrations/simulated/simulatedEnergySiteIntegration";

function buildSiteDevices(includeEv: boolean): DeviceState[] {
  const devices: DeviceState[] = [
    {
      deviceId: "battery_1",
      kind: "battery",
      brand: "Sim",
      name: "Battery One",
      connectionStatus: "online",
      lastUpdatedAt: "2026-03-16T10:00:00.000Z",
      capabilities: ["set_mode", "refresh_state", "read_soc"],
    },
    {
      deviceId: "battery_2",
      kind: "battery",
      brand: "Sim",
      name: "Battery Two",
      connectionStatus: "online",
      lastUpdatedAt: "2026-03-16T10:00:00.000Z",
      capabilities: ["set_mode", "refresh_state", "read_soc"],
    },
    {
      deviceId: "solar_inverter",
      kind: "solar_inverter",
      brand: "Sim",
      name: "Solar Inverter",
      connectionStatus: "online",
      lastUpdatedAt: "2026-03-16T10:00:00.000Z",
      capabilities: ["refresh_state", "read_power"],
    },
    {
      deviceId: "flexible_load",
      kind: "gateway",
      brand: "Sim",
      name: "Flexible Load",
      connectionStatus: "online",
      lastUpdatedAt: "2026-03-16T10:00:00.000Z",
      capabilities: ["refresh_state"],
    },
    {
      deviceId: "grid_export_control",
      kind: "smart_meter",
      brand: "Sim",
      name: "Grid Export Control",
      connectionStatus: "online",
      lastUpdatedAt: "2026-03-16T10:00:00.000Z",
      capabilities: ["set_mode", "refresh_state", "read_power"],
    },
  ];

  if (includeEv) {
    devices.push({
      deviceId: "ev_charger",
      kind: "ev_charger",
      brand: "Tesla",
      name: "EV Charger",
      connectionStatus: "online",
      lastUpdatedAt: "2026-03-16T10:00:00.000Z",
      capabilities: ["schedule_window", "refresh_state", "read_soc"],
      connected: true,
    });
  }

  return devices;
}

function buildFreshness(
  capturedAt: string,
  devices: DeviceState[],
  status: "fresh" | "stale",
): SimulatedCycleScenario["observedFreshness"] {
  return {
    capturedAt,
    maxAgeSeconds: 300,
    overallStatus: status,
    counts:
      status === "fresh"
        ? { fresh: devices.length, stale: 0, missing: 0, unknown: 0 }
        : { fresh: 0, stale: devices.length, missing: 0, unknown: 0 },
    devices: devices.map((device) => ({
      deviceId: device.deviceId,
      status,
      lastTelemetryAt: status === "fresh" ? capturedAt : "2026-03-16T10:05:00.000Z",
      ageSeconds: status === "fresh" ? 0 : 900,
    })),
  };
}

function buildSystemState(nowIso: string, includeEv: boolean, solarGenerationW: number): SystemState {
  const devices = buildSiteDevices(includeEv);

  return {
    siteId: "site-hostile",
    capturedAt: nowIso,
    timezone: "Europe/London",
    devices,
    homeLoadW: 2200,
    solarGenerationW,
    batteryPowerW: 0,
    evChargingPowerW: includeEv ? 7000 : 0,
    gridPowerW: 1400,
    batterySocPercent: 62,
    batteryCapacityKwh: 20,
    evConnected: includeEv,
  };
}

function buildDecision(input: {
  id: string;
  action: OptimizerDecision["action"];
  targets: string[];
  reason: string;
  expectedBatterySocPercent?: number;
}): OptimizerDecision {
  return {
    decisionId: input.id,
    startAt: "2026-03-16T10:00:00.000Z",
    endAt: "2026-03-16T11:00:00.000Z",
    executionWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T11:00:00.000Z",
    },
    action: input.action,
    targetDeviceIds: input.targets,
    targetDevices: input.targets.map((deviceId) => ({ deviceId })),
    reason: input.reason,
    expectedBatterySocPercent: input.expectedBatterySocPercent,
    confidence: 0.86,
  };
}

function buildPlan(input: {
  planId: string;
  generatedAt: string;
  decisions: OptimizerDecision[];
  commands: OptimizerOutput["recommendedCommands"];
}): OptimizerOutput {
  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: input.planId,
    generatedAt: input.generatedAt,
    planningWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T11:00:00.000Z",
    },
    status: "ok",
    headline: "Hostile multi-asset runtime simulation",
    decisions: input.decisions,
    recommendedCommands: input.commands,
    summary: {
      expectedImportCostPence: 150,
      expectedExportRevenuePence: 40,
      planningNetRevenueSurplusPence: -110,
    },
    diagnostics: [],
    feasibility: { executable: true, reasonCodes: ["PLAN_COMPUTED"] },
    assumptions: [],
    warnings: [],
    confidence: 0.85,
  };
}

function buildCycleScenarios(): SimulatedCycleScenario[] {
  const devicesA = buildSiteDevices(true);
  const devicesC = buildSiteDevices(false);

  return [
    {
      cycleLabel: "A",
      systemState: buildSystemState("2026-03-16T10:05:00.000Z", true, 1200),
      observedBatterySocPercent: 62,
      observedChargingState: "idle",
      observedFreshness: buildFreshness("2026-03-16T10:05:00.000Z", devicesA, "fresh"),
    },
    {
      cycleLabel: "B",
      systemState: buildSystemState("2026-03-16T10:10:00.000Z", true, 1300),
      observedBatterySocPercent: 61,
      observedChargingState: "idle",
      observedFreshness: buildFreshness("2026-03-16T10:10:00.000Z", devicesA, "fresh"),
    },
    {
      cycleLabel: "C",
      systemState: buildSystemState("2026-03-16T10:15:00.000Z", false, 3800),
      observedBatterySocPercent: 67,
      observedChargingState: "charging",
      observedFreshness: buildFreshness("2026-03-16T10:15:00.000Z", devicesC, "fresh"),
    },
    {
      cycleLabel: "D",
      systemState: buildSystemState("2026-03-16T10:20:00.000Z", false, 4000),
      telemetryStale: true,
      observedBatterySocPercent: 67,
      observedChargingState: "unknown",
      observedFreshness: buildFreshness("2026-03-16T10:20:00.000Z", devicesC, "stale"),
    },
    {
      cycleLabel: "E",
      systemState: buildSystemState("2026-03-16T10:25:00.000Z", false, 4200),
      observedBatterySocPercent: 70,
      observedChargingState: "charging",
      observedFreshness: buildFreshness("2026-03-16T10:25:00.000Z", devicesC, "fresh"),
    },
  ];
}

function buildPlans(): OptimizerOutput[] {
  const planA = buildPlan({
    planId: "plan-A",
    generatedAt: "2026-03-16T10:00:00.000Z",
    decisions: [
      buildDecision({
        id: "decision-a-battery-discharge",
        action: "discharge_battery",
        targets: ["battery_1"],
        reason: "Cycle A battery discharge requested",
        expectedBatterySocPercent: 70,
      }),
      buildDecision({
        id: "decision-a-ev-charge",
        action: "charge_ev",
        targets: ["ev_charger"],
        reason: "Cycle A EV charge requested",
      }),
      buildDecision({
        id: "decision-a-export",
        action: "export_to_grid",
        targets: ["solar_inverter", "grid_export_control"],
        reason: "Cycle A solar export enabled",
      }),
    ],
    commands: [
      {
        commandId: "cmd-a-battery-discharge",
        deviceId: "battery_1",
        issuedAt: "2026-03-16T10:05:00.000Z",
        type: "set_mode",
        mode: "discharge",
        effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
      },
      {
        commandId: "cmd-a-ev-charge",
        deviceId: "ev_charger",
        issuedAt: "2026-03-16T10:05:00.000Z",
        type: "schedule_window",
        window: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
        targetMode: "charge",
        effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
      },
      {
        commandId: "cmd-a-export",
        deviceId: "grid_export_control",
        issuedAt: "2026-03-16T10:05:00.000Z",
        type: "set_mode",
        mode: "export",
        effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
      },
    ],
  });

  const planB = buildPlan({
    planId: "plan-B",
    generatedAt: "2026-03-16T09:00:00.000Z",
    decisions: [
      buildDecision({
        id: "decision-b-battery-refresh",
        action: "hold",
        targets: ["battery_2"],
        reason: "Cycle B battery command succeeds",
      }),
      buildDecision({
        id: "decision-b-ev-refresh",
        action: "hold",
        targets: ["ev_charger"],
        reason: "Cycle B EV command fails",
      }),
      buildDecision({
        id: "decision-b-export",
        action: "export_to_grid",
        targets: ["solar_inverter", "grid_export_control"],
        reason: "Cycle B solar export suppressed by guardrail",
      }),
    ],
    commands: [
      {
        commandId: "cmd-b-battery-refresh",
        deviceId: "battery_2",
        issuedAt: "2026-03-16T10:10:00.000Z",
        type: "refresh_state",
        effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
      },
      {
        commandId: "cmd-b-ev-refresh",
        deviceId: "ev_charger",
        issuedAt: "2026-03-16T10:10:00.000Z",
        type: "refresh_state",
        effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
      },
      {
        commandId: "cmd-b-export",
        deviceId: "grid_export_control",
        issuedAt: "2026-03-16T10:10:00.000Z",
        type: "set_mode",
        mode: "export",
        effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
      },
    ],
  });

  const planC = buildPlan({
    planId: "plan-C",
    generatedAt: "2026-03-16T10:15:00.000Z",
    decisions: [
      buildDecision({
        id: "decision-c-battery-charge",
        action: "charge_battery",
        targets: ["battery_1"],
        reason: "Cycle C replan after EV unplugged and higher solar",
        expectedBatterySocPercent: 68,
      }),
      buildDecision({
        id: "decision-c-flexible-load",
        action: "hold",
        targets: ["flexible_load"],
        reason: "Cycle C flexible load telemetry refresh",
      }),
      buildDecision({
        id: "decision-c-solar-refresh",
        action: "hold",
        targets: ["solar_inverter"],
        reason: "Cycle C solar refresh",
      }),
    ],
    commands: [
      {
        commandId: "cmd-c-battery-charge",
        deviceId: "battery_1",
        issuedAt: "2026-03-16T10:15:00.000Z",
        type: "set_mode",
        mode: "charge",
        effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
      },
      {
        commandId: "cmd-c-flexible-load-refresh",
        deviceId: "flexible_load",
        issuedAt: "2026-03-16T10:15:00.000Z",
        type: "refresh_state",
        effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
      },
      {
        commandId: "cmd-c-solar-refresh",
        deviceId: "solar_inverter",
        issuedAt: "2026-03-16T10:15:00.000Z",
        type: "refresh_state",
        effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
      },
    ],
  });

  return [planA, planB, planC];
}

describe("hostile multi-asset runtime", () => {
  it("stresses heterogeneous cycles and preserves canonical coherence when Tesla is optional/failing/disappears", async () => {
    const scenarios = buildCycleScenarios();
    const plans = buildPlans();

    const trace: SimulatedEnergySiteTrace = {
      executedCycleLabels: [],
      cycleContexts: [],
      cycleSummaries: [],
      buildPlanCount: 0,
    };

    const journal = new InMemoryExecutionJournalStore();
    const scheduler = new ManualIntervalScheduler();

    const times = [
      "2026-03-16T10:05:00.000Z",
      "2026-03-16T10:10:00.000Z",
      "2026-03-16T10:15:00.000Z",
      "2026-03-16T10:20:00.000Z",
      "2026-03-16T10:25:00.000Z",
    ];
    let tickIndex = 0;

    const runtime = await runContinuousRuntime({
      source: {
        GRIDLY_SITE_ID: "site-hostile",
      },
      integration: createSimulatedEnergySiteIntegration([
        { cycleLabel: "A" },
        {
          cycleLabel: "B",
          outcomesByDeviceId: {
            ev_charger: "failed",
          },
        },
        { cycleLabel: "C" },
        { cycleLabel: "D" },
        { cycleLabel: "E" },
      ]),
      integrationDependencies: {
        cycleScenarios: scenarios,
        plansByBuildOrder: plans,
        journalStore: journal,
        trace,
      },
      launcherDependencies: {
        journalStore: journal,
        scheduler,
        nowFn: () => new Date(times[Math.min(tickIndex, times.length - 1)]),
      },
    });

    await runtime.start(); // Cycle A
    tickIndex = 1;
    await scheduler.tick(); // Cycle B
    tickIndex = 2;
    await scheduler.tick(); // Cycle C
    tickIndex = 3;
    await scheduler.tick(); // Cycle D
    tickIndex = 4;
    await scheduler.tick(); // Cycle E

    const state = runtime.getState();
    expect(state.cycleCount).toBe(5);

    expect(trace.executedCycleLabels).toEqual(["A", "B", "C", "D", "E"]);
    expect(trace.buildPlanCount).toBeGreaterThanOrEqual(3);

    expect(trace.cycleContexts[1].replanTriggered).toBe(true);
    expect(trace.cycleContexts[2].replanTriggered).toBe(true);
    expect(trace.cycleContexts[2].replanReason).toContain("Prior command execution failed");
    expect(trace.cycleContexts[2].planFreshnessStatus).toBe("fresh");

    expect(trace.cycleSummaries[0].issuedCommandCount).toBeGreaterThanOrEqual(3);
    expect(trace.cycleSummaries[1].issuedCommandCount).toBe(1);
    expect(trace.cycleSummaries[1].skippedCommandCount).toBe(1);
    expect(trace.cycleSummaries[1].failedCommandCount).toBe(1);
    expect(trace.cycleSummaries[2].issuedCommandCount).toBeGreaterThanOrEqual(2);
    expect(trace.cycleSummaries[3].issuedCommandCount).toBe(0);
    expect(trace.cycleSummaries[3].skippedCommandCount).toBeGreaterThanOrEqual(1);
    expect(trace.cycleSummaries[4].issuedCommandCount).toBeGreaterThanOrEqual(2);

    const heartbeats = journal.getCycleHeartbeats();
    expect(heartbeats).toHaveLength(5);

    expect(heartbeats[1].executionPosture).toBe("conservative");
    expect(heartbeats[1].commandsIssued).toBe(1);
    expect(heartbeats[1].commandsSkipped).toBe(1);
    expect(heartbeats[1].commandsFailed).toBe(1);
    expect(heartbeats[1].commandsSuppressed).toBe(1);
    expect(heartbeats[1].economicSnapshot?.valueSeekingExecutionDeferred).toBe(true);

    expect(heartbeats[2].executionPosture).toBe("normal");
    expect(heartbeats[2].commandsFailed).toBe(0);

    expect(heartbeats[3].executionPosture).toBe("hold_only");
    expect(heartbeats[3].failClosedTriggered).toBe(true);
    expect(heartbeats[3].commandsSuppressed).toBeGreaterThanOrEqual(1);

    expect(heartbeats[4].executionPosture).toBe("normal");
    expect(heartbeats[4].failClosedTriggered).toBe(false);
    expect(heartbeats[4].commandsIssued).toBeGreaterThanOrEqual(2);
    expect(heartbeats[4].economicSnapshot?.hasValueSeekingDecisions).toBe(true);
    expect(heartbeats[4].economicSnapshot?.valueSeekingExecutionDeferred).toBe(false);
    expect(heartbeats[4].economicSnapshot?.estimatedSavingsVsBaselinePence).toBeDefined();

    const entries = journal.getAll();
    expect(entries.length).toBeGreaterThanOrEqual(10);

    entries.forEach((entry) => {
      expect(entry.cycleId).toBeTruthy();
      expect(entry.targetDeviceId).toBeTruthy();
      expect(entry.canonicalCommand.kind).toBeTruthy();
      expect(entry.status).toMatch(/issued|skipped|failed/);
    });

    const suppressed = entries.filter((entry) => entry.status === "skipped");
    expect(suppressed.some((entry) => (entry.reasonCodes ?? []).some((code) => code.startsWith("RUNTIME_")))).toBe(
      true,
    );

    const failures = entries.filter((entry) => entry.status === "failed");
    expect(failures.some((entry) => entry.executionError === "COMMAND_FAILED")).toBe(true);

    const cycleCDecisionTargets = trace.cycleContexts[2].currentPlan.decisions.flatMap(
      (decision) => decision.targetDeviceIds,
    );
    expect(cycleCDecisionTargets.includes("ev_charger")).toBe(false);

    runtime.stop();
  });
});
