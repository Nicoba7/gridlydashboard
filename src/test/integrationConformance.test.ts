import { describe, expect, it } from "vitest";
import type { DeviceState, SystemState } from "../domain";
import type { OptimizerDecision, OptimizerOutput } from "../domain/optimizer";
import { createTeslaRuntimeIntegration } from "../integrations/tesla/teslaRuntimeIntegration";
import {
  createSimulatedEnergySiteIntegration,
  type SimulatedCycleScenario,
} from "../integrations/simulated/simulatedEnergySiteIntegration";
import type {
  ContinuousRuntimeIntegration,
  AveumContinuousRuntimeSource,
  PreparedContinuousRuntimeIntegration,
} from "../application/runtime/runContinuousRuntime";
import { InMemoryObservedDeviceStateStore } from "../observed/observedDeviceStateStore";
import { DeviceAdapterRegistry } from "../adapters/adapterRegistry";
import { TeslaChargingRealAdapter } from "../adapters/tesla/TeslaChargingRealAdapter";
import { LiveAdapterDeviceCommandExecutor } from "../application/controlLoopExecution/liveAdapterExecutor";
import { runSingleTeslaCycle } from "../application/runtime/runSingleTeslaCycle";
import { SimulatedDeviceAdapter } from "../adapters/simulated/SimulatedDeviceAdapter";
import { runControlLoopExecutionService } from "../application/controlLoopExecution/service";
import { InMemoryDeviceCapabilitiesProvider } from "../capabilities/deviceCapabilitiesProvider";
import type { ExecutionJournalStore } from "../journal/executionJournalStore";
import {
  assertIntegrationConformance,
  runIntegrationConformanceScenario,
  type IntegrationConformanceScenario,
} from "./harness/integrationConformanceHarness";

function buildFreshnessSummary(
  capturedAt: string,
  devices: DeviceState[],
  statusByDeviceId: Record<string, "fresh" | "stale" | "missing" | "unknown">,
) {
  const counts = {
    fresh: 0,
    stale: 0,
    missing: 0,
    unknown: 0,
  };

  const freshnessDevices = devices.map((device) => {
    const status = statusByDeviceId[device.deviceId] ?? "fresh";
    counts[status] += 1;

    if (status === "missing") {
      return {
        deviceId: device.deviceId,
        status,
      };
    }

    return {
      deviceId: device.deviceId,
      status,
      lastTelemetryAt: status === "stale" ? "2026-03-16T09:00:00.000Z" : capturedAt,
      ageSeconds: status === "stale" ? 4800 : 0,
    };
  });

  const overallStatus = counts.unknown > 0
    ? "unknown"
    : counts.missing > 0
      ? "missing"
      : counts.stale > 0
        ? "stale"
        : "fresh";

  return {
    capturedAt,
    maxAgeSeconds: 300,
    overallStatus,
    counts,
    devices: freshnessDevices,
  };
}

function buildDecision(input: {
  decisionId: string;
  action: OptimizerDecision["action"];
  targetDeviceId: string;
  reason: string;
  effectiveStoredEnergyValuePencePerKwh?: number;
  netStoredEnergyValuePencePerKwh?: number;
  executionWindowOverride?: { startAt: string; endAt: string };
}): OptimizerDecision {
  const executionWindow = input.executionWindowOverride ?? {
    startAt: "2026-03-16T09:00:00.000Z",
    endAt: "2026-03-16T12:30:00.000Z",
  };
  return {
    decisionId: input.decisionId,
    startAt: "2026-03-16T09:00:00.000Z",
    endAt: "2026-03-16T12:30:00.000Z",
    executionWindow,
    action: input.action,
    targetDeviceIds: [input.targetDeviceId],
    targetDevices: [{ deviceId: input.targetDeviceId }],
    reason: input.reason,
    effectiveStoredEnergyValuePencePerKwh: input.effectiveStoredEnergyValuePencePerKwh,
    netStoredEnergyValuePencePerKwh: input.netStoredEnergyValuePencePerKwh,
    confidence: 0.86,
  };
}

function buildPlan(input: {
  planId: string;
  generatedAt: string;
  decision?: OptimizerDecision;
  command?: OptimizerOutput["recommendedCommands"][number];
  decisions?: OptimizerDecision[];
  commands?: OptimizerOutput["recommendedCommands"];
  planningInputCoverage?: OptimizerOutput["planningInputCoverage"];
  planningConfidenceLevel?: OptimizerOutput["planningConfidenceLevel"];
  conservativeAdjustmentApplied?: boolean;
  conservativeAdjustmentReason?: string;
  warnings?: string[];
}): OptimizerOutput {
  const decisions = input.decisions ?? (input.decision ? [input.decision] : []);
  const recommendedCommands = input.commands ?? (input.command ? [input.command] : []);

  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: input.planId,
    generatedAt: input.generatedAt,
    planningWindow: {
      startAt: "2026-03-16T09:00:00.000Z",
      endAt: "2026-03-16T12:30:00.000Z",
    },
    status: "ok",
    headline: "Integration conformance plan",
    decisions,
    recommendedCommands,
    summary: {
      expectedImportCostPence: 90,
      expectedExportRevenuePence: 12,
      planningNetRevenueSurplusPence: -78,
    },
    diagnostics: [],
    planningInputCoverage: input.planningInputCoverage,
    planningConfidenceLevel: input.planningConfidenceLevel,
    conservativeAdjustmentApplied: input.conservativeAdjustmentApplied,
    conservativeAdjustmentReason: input.conservativeAdjustmentReason,
    feasibility: { executable: true, reasonCodes: ["PLAN_COMPUTED"] },
    assumptions: [],
    warnings: input.warnings ?? [],
    confidence: 0.84,
  };
}

function buildUncertainEconomicCoverage(): NonNullable<OptimizerOutput["planningInputCoverage"]> {
  return {
    plannedSlotCount: 4,
    tariffImport: {
      availableSlots: 0,
      totalPlannedSlots: 4,
      coveragePercent: 0,
    },
    tariffExport: {
      availableSlots: 0,
      totalPlannedSlots: 4,
      coveragePercent: 0,
    },
    forecastLoad: {
      availableSlots: 4,
      totalPlannedSlots: 4,
      coveragePercent: 100,
    },
    forecastSolar: {
      availableSlots: 4,
      totalPlannedSlots: 4,
      coveragePercent: 100,
    },
    fallbackSlotCount: 4,
    fallbackByType: {
      exportRateSlots: 4,
      loadForecastSlots: 0,
      solarForecastSlots: 0,
    },
    caveats: ["Tariff inputs unavailable; conservative fallback applied."],
  };
}

function buildStorageSystemState(nowIso: string, deviceId: string): SystemState {
  return {
    siteId: "site-storage-stub",
    capturedAt: nowIso,
    timezone: "Europe/London",
    devices: [
      {
        deviceId,
        kind: "battery",
        brand: "Stub",
        name: "Storage Stub Battery",
        connectionStatus: "online",
        lastUpdatedAt: nowIso,
        capabilities: ["set_mode", "read_soc", "refresh_state"],
      },
    ],
    homeLoadW: 1600,
    solarGenerationW: 300,
    batteryPowerW: 0,
    evChargingPowerW: 0,
    gridPowerW: 1300,
    batterySocPercent: 54,
    batteryCapacityKwh: 11,
  };
}

interface StorageStubCycleScenario {
  cycleLabel: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  systemState: SystemState;
  observedFreshness: ReturnType<typeof buildFreshnessSummary>;
}

interface StorageStubIntegrationDependencies {
  cycleScenarios: StorageStubCycleScenario[];
  plansByBuildOrder: OptimizerOutput[];
  journalStore: ExecutionJournalStore;
}

function buildStorageCapabilitiesProvider(devices: DeviceState[]) {
  return new InMemoryDeviceCapabilitiesProvider(
    devices.map((device) => {
      if (device.capabilities.includes("set_mode")) {
        return {
          deviceId: device.deviceId,
          supportedCommandKinds: ["set_mode", "refresh_state"],
          supportedModes: ["charge", "discharge", "export", "hold"],
          minimumCommandWindowMinutes: 15,
          supportsOverlappingWindows: true,
          supportsImmediateExecution: true,
          schemaVersion: "capabilities.v1",
        };
      }

      if (device.capabilities.includes("schedule_window")) {
        return {
          deviceId: device.deviceId,
          supportedCommandKinds: ["schedule_window", "refresh_state"],
          supportedModes: ["charge"],
          minimumCommandWindowMinutes: 15,
          supportsOverlappingWindows: true,
          supportsImmediateExecution: true,
          schemaVersion: "capabilities.v1",
        };
      }

      return {
        deviceId: device.deviceId,
        supportedCommandKinds: ["refresh_state"],
        supportsImmediateExecution: true,
        schemaVersion: "capabilities.v1",
      };
    }),
  );
}

function createStorageStubIntegration(): ContinuousRuntimeIntegration<
  AveumContinuousRuntimeSource,
  StorageStubIntegrationDependencies
> {
  return {
    async prepare(input): Promise<PreparedContinuousRuntimeIntegration> {
      if (!input.dependencies) {
        throw new Error("Storage stub integration requires dependencies.");
      }

      const dependencies = input.dependencies;
      const handledDeviceIds = dependencies.cycleScenarios.flatMap((cycle) =>
        cycle.systemState.devices.map((device) => device.deviceId),
      );

      const adapter = new SimulatedDeviceAdapter({
        supportedDeviceIds: handledDeviceIds,
        supportedCommandKinds: ["set_mode", "refresh_state"],
      });
      const registry = new DeviceAdapterRegistry([adapter]);
      const executor = new LiveAdapterDeviceCommandExecutor(registry);

      let cycleIndex = 0;
      let buildPlanCount = 0;

      return {
        cycleExecutor: {
          async buildPlan() {
            const fallbackIndex = dependencies.plansByBuildOrder.length - 1;
            const selected = dependencies.plansByBuildOrder[Math.min(buildPlanCount, fallbackIndex)];
            buildPlanCount += 1;
            return selected;
          },

          async execute(ctx) {
            const scenario = dependencies.cycleScenarios[Math.min(cycleIndex, dependencies.cycleScenarios.length - 1)];
            cycleIndex += 1;

            const capabilitiesProvider = buildStorageCapabilitiesProvider(scenario.systemState.devices);

            const execution = await runControlLoopExecutionService(
              {
                now: ctx.nowIso,
                systemState: scenario.systemState,
                optimizerOutput: ctx.currentPlan,
                observedStateFreshness: scenario.observedFreshness,
              },
              executor,
              capabilitiesProvider,
              undefined,
              dependencies.journalStore,
              {
                optimizationMode: "balanced",
                valueLedger: {
                  optimizationMode: "balanced",
                  estimatedImportCostPence: 90,
                  estimatedExportRevenuePence: 12,
                  estimatedBatteryDegradationCostPence: 2,
                  estimatedNetCostPence: 80,
                  baselineType: "hold_current_state",
                  baselineNetCostPence: 94,
                  baselineImportCostPence: 94,
                  baselineExportRevenuePence: 12,
                  baselineBatteryDegradationCostPence: 0,
                  estimatedSavingsVsBaselinePence: 14,
                  assumptions: [],
                  caveats: [],
                  confidence: 0.82,
                },
                planningInputCoverage: ctx.currentPlan.planningInputCoverage,
                planningConfidenceLevel: ctx.currentPlan.planningConfidenceLevel,
                conservativeAdjustmentApplied: ctx.currentPlan.conservativeAdjustmentApplied,
                conservativeAdjustmentReason: ctx.currentPlan.conservativeAdjustmentReason,
                planningAssumptions: ctx.currentPlan.assumptions,
                planningWarnings: ctx.currentPlan.warnings,
              },
              {
                safeHoldMode: ctx.safeHoldMode,
                planFreshnessStatus: ctx.planFreshnessStatus,
                replanTrigger: ctx.replanTrigger,
                stalePlanReuseCount: ctx.stalePlanReuseCount,
                stalePlanWarning: ctx.stalePlanWarning,
              },
              input.runtimeExecutionMode,
              {
                cycleId: ctx.cycleId,
                replanReason: ctx.replanReason,
              },
            );

            return {
              cycleId: ctx.cycleId,
              nowIso: ctx.nowIso,
              status: "ok" as const,
              replanRequired: false,
              issuedCommandCount: execution.executionResults.filter((item) => item.status === "issued").length,
              skippedCommandCount: execution.executionResults.filter((item) => item.status === "skipped").length,
              failedCommandCount: execution.executionResults.filter((item) => item.status === "failed").length,
              journalEntriesWritten: execution.executionResults.length,
              planAgeSeconds: ctx.planAgeSeconds,
              planFreshnessStatus: ctx.planFreshnessStatus,
              replanTriggered: ctx.replanTriggered,
              replanTrigger: ctx.replanTrigger,
              replanReason: ctx.replanReason,
              stalePlanReuseCount: ctx.stalePlanReuseCount,
            };
          },
        },
        loopConfig: {
          siteId: input.source.GRIDLY_SITE_ID?.trim() || "site-storage-stub",
        },
      };
    },
  };
}

describe("integration conformance suite", () => {
  it("validates canonical runtime invariants for simulated energy integration", async () => {
    const cycleTimes = [
      "2026-03-16T10:05:00.000Z",
      "2026-03-16T10:15:00.000Z",
      "2026-03-16T10:25:00.000Z",
      "2026-03-16T10:35:00.000Z",
      "2026-03-16T10:45:00.000Z",
      "2026-03-16T10:55:00.000Z",
      "2026-03-16T11:05:00.000Z",
    ];

    const deviceId = "battery_1";
    const device: DeviceState = {
      deviceId,
      kind: "battery",
      brand: "Sim",
      name: "Sim Battery",
      connectionStatus: "online",
      lastUpdatedAt: cycleTimes[0],
      capabilities: ["set_mode", "refresh_state", "read_soc"],
    };
    const crossAssetDevices: DeviceState[] = [
      device,
      {
        deviceId: "grid_export_control",
        kind: "smart_meter",
        brand: "Sim",
        name: "Export Control",
        connectionStatus: "online",
        lastUpdatedAt: cycleTimes[6],
        capabilities: ["set_mode", "refresh_state", "read_power"],
      },
      {
        deviceId: "ev_charger",
        kind: "ev_charger",
        brand: "Sim",
        name: "Site EV Charger",
        connectionStatus: "online",
        lastUpdatedAt: cycleTimes[6],
        capabilities: ["schedule_window", "refresh_state", "read_soc"],
        connected: true,
      },
    ];

    const cycleScenarios: SimulatedCycleScenario[] = cycleTimes.map((cycleTime, index) => ({
      cycleLabel: (["A", "B", "C", "D", "E", "F", "G"] as const)[index],
      systemState: {
        siteId: "site-sim-conformance",
        capturedAt: cycleTime,
        timezone: "Europe/London",
        devices: [device],
        homeLoadW: 1800,
        solarGenerationW: 400,
        batteryPowerW: 0,
        evChargingPowerW: 0,
        gridPowerW: 1400,
        batterySocPercent: 58,
        batteryCapacityKwh: 13.5,
      },
      observedFreshness: buildFreshnessSummary(
        cycleTime,
        [device],
        index === 1 ? { [deviceId]: "stale" } : { [deviceId]: "fresh" },
      ),
    }));

    cycleScenarios[6] = {
      cycleLabel: "G",
      systemState: {
        siteId: "site-sim-conformance",
        capturedAt: cycleTimes[6],
        timezone: "Europe/London",
        devices: crossAssetDevices,
        homeLoadW: 1500,
        solarGenerationW: 5200,
        batteryPowerW: 0,
        evChargingPowerW: 0,
        gridPowerW: -900,
        batterySocPercent: 74,
        batteryCapacityKwh: 13.5,
        evConnected: true,
      },
      observedFreshness: buildFreshnessSummary(
        cycleTimes[6],
        crossAssetDevices,
        {
          [deviceId]: "fresh",
          grid_export_control: "fresh",
          ev_charger: "fresh",
        },
      ),
    };

    const plans: OptimizerOutput[] = [
      buildPlan({
        planId: "sim-plan-A",
        generatedAt: cycleTimes[0],
        decision: buildDecision({
          decisionId: "sim-decision-a",
          action: "charge_battery",
          targetDeviceId: deviceId,
          reason: "cycle A issue",
        }),
        command: {
          commandId: "sim-cmd-a",
          deviceId,
          issuedAt: cycleTimes[0],
          type: "set_mode",
          mode: "charge",
          effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
        },
      }),
      buildPlan({
        planId: "sim-plan-B",
        generatedAt: cycleTimes[1],
        decisions: [
          buildDecision({
            decisionId: "sim-decision-b-hold",
            action: "hold",
            targetDeviceId: deviceId,
            reason: "cycle B stale observed state should block hold-like control",
          }),
          buildDecision({
            decisionId: "sim-decision-b-econ",
            action: "charge_battery",
            targetDeviceId: deviceId,
            reason: "cycle B economic uncertainty should block aggressive dispatch",
          }),
        ],
        commands: [
          {
            commandId: "sim-cmd-b-hold",
            deviceId,
            issuedAt: cycleTimes[1],
            type: "set_mode",
            mode: "hold",
            effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
          },
          {
            commandId: "sim-cmd-b-econ",
            deviceId,
            issuedAt: cycleTimes[1],
            type: "set_mode",
            mode: "charge",
            effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
          },
        ],
        planningInputCoverage: buildUncertainEconomicCoverage(),
        planningConfidenceLevel: "low",
        conservativeAdjustmentApplied: true,
        conservativeAdjustmentReason: "Tariff coverage unavailable.",
        warnings: ["Economic uncertainty active."],
      }),
      buildPlan({
        planId: "sim-plan-C",
        generatedAt: cycleTimes[2],
        decision: buildDecision({
          decisionId: "sim-decision-c",
          action: "charge_battery",
          targetDeviceId: deviceId,
          reason: "cycle C recovery",
        }),
        command: {
          commandId: "sim-cmd-c",
          deviceId,
          issuedAt: cycleTimes[2],
          type: "set_mode",
          mode: "charge",
          effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
        },
      }),
      buildPlan({
        planId: "sim-plan-D",
        generatedAt: cycleTimes[3],
        decision: buildDecision({
          decisionId: "sim-decision-d",
          action: "hold",
          targetDeviceId: deviceId,
          reason: "cycle D preflight invalid command",
        }),
        command: {
          commandId: "sim-cmd-d",
          deviceId,
          issuedAt: cycleTimes[3],
          type: "set_power_limit",
          powerW: 3200,
          effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
        },
      }),
      buildPlan({
        planId: "sim-plan-E",
        generatedAt: cycleTimes[4],
        decisions: [
          buildDecision({
            decisionId: "sim-decision-e-1",
            action: "hold",
            targetDeviceId: deviceId,
            reason: "cycle E first refresh command",
          }),
          buildDecision({
            decisionId: "sim-decision-e-2",
            action: "hold",
            targetDeviceId: deviceId,
            reason: "cycle E second refresh command should conflict",
          }),
        ],
        commands: [
          {
            commandId: "sim-cmd-e-1",
            deviceId,
            issuedAt: cycleTimes[4],
            type: "refresh_state",
            effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
          },
          {
            commandId: "sim-cmd-e-2",
            deviceId,
            issuedAt: cycleTimes[4],
            type: "refresh_state",
            effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
          },
        ],
      }),
      // Cycle F: two competing commands for the same device with different economic values.
      // The runtime must select the economically superior action (discharge_battery over charge_battery).
      buildPlan({
        planId: "sim-plan-F",
        generatedAt: cycleTimes[5],
        decisions: [
          buildDecision({
            decisionId: "sim-decision-f-low",
            action: "charge_battery",
            targetDeviceId: deviceId,
            reason: "cycle F lower-value option: charge at current import rate",
            effectiveStoredEnergyValuePencePerKwh: 4.8,
            executionWindowOverride: { startAt: "2026-03-16T10:50:00.000Z", endAt: "2026-03-16T11:50:00.000Z" },
          }),
          buildDecision({
            decisionId: "sim-decision-f-high",
            action: "discharge_battery",
            targetDeviceId: deviceId,
            reason: "cycle F higher-value option: export at peak rate",
            effectiveStoredEnergyValuePencePerKwh: 16.5,
            executionWindowOverride: { startAt: "2026-03-16T10:55:00.000Z", endAt: "2026-03-16T11:55:00.000Z" },
          }),
        ],
        commands: [
          {
            commandId: "sim-cmd-f-low",
            deviceId,
            issuedAt: cycleTimes[5],
            type: "set_mode",
            mode: "charge",
            effectiveWindow: { startAt: "2026-03-16T10:50:00.000Z", endAt: "2026-03-16T11:50:00.000Z" },
          },
          {
            commandId: "sim-cmd-f-high",
            deviceId,
            issuedAt: cycleTimes[5],
            type: "set_mode",
            mode: "discharge",
            effectiveWindow: { startAt: "2026-03-16T10:55:00.000Z", endAt: "2026-03-16T11:55:00.000Z" },
          },
        ],
      }),
      buildPlan({
        planId: "sim-plan-G",
        generatedAt: cycleTimes[6],
        decisions: [
          buildDecision({
            decisionId: "sim-decision-g-export",
            action: "export_to_grid",
            targetDeviceId: "grid_export_control",
            reason: "cycle G higher-value option: export excess solar to grid peak window",
            effectiveStoredEnergyValuePencePerKwh: 19.4,
            executionWindowOverride: { startAt: "2026-03-16T11:05:00.000Z", endAt: "2026-03-16T12:05:00.000Z" },
          }),
          buildDecision({
            decisionId: "sim-decision-g-ev",
            action: "charge_ev",
            targetDeviceId: "ev_charger",
            reason: "cycle G lower-value option: charge EV during exportable solar period",
            effectiveStoredEnergyValuePencePerKwh: 8.2,
            executionWindowOverride: { startAt: "2026-03-16T11:05:00.000Z", endAt: "2026-03-16T12:05:00.000Z" },
          }),
        ],
        commands: [
          {
            commandId: "sim-cmd-g-export",
            deviceId: "grid_export_control",
            issuedAt: cycleTimes[6],
            type: "set_mode",
            mode: "export",
            effectiveWindow: { startAt: "2026-03-16T11:05:00.000Z", endAt: "2026-03-16T12:05:00.000Z" },
          },
          {
            commandId: "sim-cmd-g-ev",
            deviceId: "ev_charger",
            issuedAt: cycleTimes[6],
            type: "schedule_window",
            window: { startAt: "2026-03-16T11:05:00.000Z", endAt: "2026-03-16T12:05:00.000Z" },
            targetMode: "charge",
            effectiveWindow: { startAt: "2026-03-16T11:05:00.000Z", endAt: "2026-03-16T12:05:00.000Z" },
          },
        ],
      }),
    ];

    const scenario: IntegrationConformanceScenario<AveumContinuousRuntimeSource, unknown> = {
      suiteName: "simulated-energy-site",
      source: {
        GRIDLY_SITE_ID: "site-sim-conformance",
        GRIDLY_CONTINUOUS_FRESHNESS_THRESHOLD_SECONDS: "1",
      },
      integration: createSimulatedEnergySiteIntegration([
        { cycleLabel: "A" },
        { cycleLabel: "B" },
        { cycleLabel: "C" },
        { cycleLabel: "D" },
        { cycleLabel: "E" },
        { cycleLabel: "F" },
        { cycleLabel: "G" },
      ]),
      integrationDependencies: (journalStore) => ({
        cycleScenarios,
        plansByBuildOrder: plans,
        journalStore,
      }),
      cycleTimesIso: cycleTimes,
      expectedMappedDeviceIds: [deviceId, "grid_export_control", "ev_charger"],
      staleObservedStateCycleIndex: 1,
      economicUncertaintyCycleIndex: 1,
      conflictingCommandCycleIndex: 4,
      protectiveCycleIndex: 1,
      recoveryCycleIndex: 2,
      capabilityFailureCycleIndex: 3,
      expectedCapabilityFailureReasonCode: "COMMAND_KIND_NOT_SUPPORTED",
      economicPreferenceCycleIndex: 5,
      crossAssetEconomicCycleIndex: 6,
    };

    const report = await runIntegrationConformanceScenario(scenario);
    assertIntegrationConformance(scenario, report);
  });

  it("validates canonical runtime invariants for Tesla integration", async () => {
    const cycleTimes = [
      "2026-03-16T10:10:00.000Z",
      "2026-03-16T10:20:00.000Z",
      "2026-03-16T10:30:00.000Z",
      "2026-03-16T10:40:00.000Z",
      "2026-03-16T10:50:00.000Z",
      "2026-03-16T11:00:00.000Z",
      "2026-03-16T11:10:00.000Z",
    ];
    const teslaVehicleId = "tesla-vehicle-1";

    const plans: OptimizerOutput[] = [
      buildPlan({
        planId: "tesla-plan-A",
        generatedAt: cycleTimes[0],
        decision: buildDecision({
          decisionId: "tesla-decision-a",
          action: "charge_ev",
          targetDeviceId: teslaVehicleId,
          reason: "cycle A charge",
        }),
        command: {
          commandId: "tesla-cmd-a",
          deviceId: teslaVehicleId,
          issuedAt: cycleTimes[0],
          type: "start_charging",
          effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
        },
      }),
      buildPlan({
        planId: "tesla-plan-B",
        generatedAt: cycleTimes[1],
        decisions: [
          buildDecision({
            decisionId: "tesla-decision-b-hold",
            action: "hold",
            targetDeviceId: teslaVehicleId,
            reason: "cycle B stale observed state should block hold-mode command",
          }),
          buildDecision({
            decisionId: "tesla-decision-b-econ",
            action: "charge_ev",
            targetDeviceId: teslaVehicleId,
            reason: "cycle B economic uncertainty should block aggressive command",
          }),
        ],
        commands: [
          {
            commandId: "tesla-cmd-b-hold",
            deviceId: teslaVehicleId,
            issuedAt: cycleTimes[1],
            type: "set_mode",
            mode: "hold",
            effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
          },
          {
            commandId: "tesla-cmd-b-econ",
            deviceId: teslaVehicleId,
            issuedAt: cycleTimes[1],
            type: "start_charging",
            effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
          },
        ],
        planningInputCoverage: buildUncertainEconomicCoverage(),
        planningConfidenceLevel: "low",
        conservativeAdjustmentApplied: true,
        conservativeAdjustmentReason: "Tariff import signal unavailable.",
        warnings: ["Economic uncertainty active."],
      }),
      buildPlan({
        planId: "tesla-plan-C",
        generatedAt: cycleTimes[2],
        decision: buildDecision({
          decisionId: "tesla-decision-c",
          action: "charge_ev",
          targetDeviceId: teslaVehicleId,
          reason: "cycle C telemetry recovery",
        }),
        command: {
          commandId: "tesla-cmd-c",
          deviceId: teslaVehicleId,
          issuedAt: cycleTimes[2],
          type: "start_charging",
          effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
        },
      }),
      buildPlan({
        planId: "tesla-plan-D",
        generatedAt: cycleTimes[3],
        decision: buildDecision({
          decisionId: "tesla-decision-d",
          action: "hold",
          targetDeviceId: teslaVehicleId,
          reason: "cycle D invalid schedule command",
        }),
        command: {
          commandId: "tesla-cmd-d",
          deviceId: teslaVehicleId,
          issuedAt: cycleTimes[3],
          type: "schedule_window",
          window: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
          targetMode: "charge",
          effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
        },
      }),
      buildPlan({
        planId: "tesla-plan-E",
        generatedAt: cycleTimes[4],
        decisions: [
          buildDecision({
            decisionId: "tesla-decision-e-1",
            action: "hold",
            targetDeviceId: teslaVehicleId,
            reason: "cycle E first refresh command",
          }),
          buildDecision({
            decisionId: "tesla-decision-e-2",
            action: "hold",
            targetDeviceId: teslaVehicleId,
            reason: "cycle E second refresh should conflict",
          }),
        ],
        commands: [
          {
            commandId: "tesla-cmd-e-1",
            deviceId: teslaVehicleId,
            issuedAt: cycleTimes[4],
            type: "refresh_state",
            effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
          },
          {
            commandId: "tesla-cmd-e-2",
            deviceId: teslaVehicleId,
            issuedAt: cycleTimes[4],
            type: "refresh_state",
            effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T11:00:00.000Z" },
          },
        ],
      }),
      // Cycle F: two competing commands for the Tesla vehicle.
      // hold (low value) vs charge_ev (higher value) — runtime must prefer charging.
      buildPlan({
        planId: "tesla-plan-F",
        generatedAt: cycleTimes[5],
        decisions: [
          buildDecision({
            decisionId: "tesla-decision-f-low",
            action: "hold",
            targetDeviceId: teslaVehicleId,
            reason: "cycle F lower-value option: maintain hold state",
            effectiveStoredEnergyValuePencePerKwh: 0.0,
            executionWindowOverride: { startAt: "2026-03-16T10:55:00.000Z", endAt: "2026-03-16T11:55:00.000Z" },
          }),
          buildDecision({
            decisionId: "tesla-decision-f-high",
            action: "charge_ev",
            targetDeviceId: teslaVehicleId,
            reason: "cycle F higher-value option: charge EV at off-peak rate",
            effectiveStoredEnergyValuePencePerKwh: 11.3,
            executionWindowOverride: { startAt: "2026-03-16T11:00:00.000Z", endAt: "2026-03-16T12:00:00.000Z" },
          }),
        ],
        commands: [
          {
            commandId: "tesla-cmd-f-low",
            deviceId: teslaVehicleId,
            issuedAt: cycleTimes[5],
            type: "set_mode",
            mode: "hold",
            effectiveWindow: { startAt: "2026-03-16T10:55:00.000Z", endAt: "2026-03-16T11:55:00.000Z" },
          },
          {
            commandId: "tesla-cmd-f-high",
            deviceId: teslaVehicleId,
            issuedAt: cycleTimes[5],
            type: "start_charging",
            effectiveWindow: { startAt: "2026-03-16T11:00:00.000Z", endAt: "2026-03-16T12:00:00.000Z" },
          },
        ],
      }),
      buildPlan({
        planId: "tesla-plan-G",
        generatedAt: cycleTimes[6],
        decisions: [
          buildDecision({
            decisionId: "tesla-decision-g-battery",
            action: "export_to_grid",
            targetDeviceId: "home-battery-1",
            reason: "cycle G lower-value option: export stored energy instead of charging the EV",
            effectiveStoredEnergyValuePencePerKwh: 7.4,
            executionWindowOverride: { startAt: "2026-03-16T11:10:00.000Z", endAt: "2026-03-16T12:10:00.000Z" },
          }),
          buildDecision({
            decisionId: "tesla-decision-g-ev",
            action: "charge_ev",
            targetDeviceId: teslaVehicleId,
            reason: "cycle G higher-value option: charge EV during the best available charging window",
            effectiveStoredEnergyValuePencePerKwh: 12.9,
            executionWindowOverride: { startAt: "2026-03-16T11:10:00.000Z", endAt: "2026-03-16T12:10:00.000Z" },
          }),
        ],
        commands: [
          {
            commandId: "tesla-cmd-g-battery",
            deviceId: "home-battery-1",
            issuedAt: cycleTimes[6],
            type: "set_mode",
            mode: "export",
            effectiveWindow: { startAt: "2026-03-16T11:10:00.000Z", endAt: "2026-03-16T12:10:00.000Z" },
          },
          {
            commandId: "tesla-cmd-g-ev",
            deviceId: teslaVehicleId,
            issuedAt: cycleTimes[6],
            type: "start_charging",
            effectiveWindow: { startAt: "2026-03-16T11:10:00.000Z", endAt: "2026-03-16T12:10:00.000Z" },
          },
        ],
      }),
    ];

    let optimizeCallCount = 0;
    let telemetryReadCount = 0;
    const telemetryTimestamps = [
      "2026-03-16T10:10:00.000Z",
      "2026-03-16T09:00:00.000Z",
      "2026-03-16T10:30:00.000Z",
      "2026-03-16T10:40:00.000Z",
      "2026-03-16T10:50:00.000Z",
      "2026-03-16T11:00:00.000Z",
      "2026-03-16T11:10:00.000Z",
    ];

    const scenario: IntegrationConformanceScenario<AveumContinuousRuntimeSource, unknown> = {
      suiteName: "tesla-runtime-integration",
      source: {
        GRIDLY_SITE_ID: "site-tesla-conformance",
        GRIDLY_CONTINUOUS_FRESHNESS_THRESHOLD_SECONDS: "1",
        TESLA_ACCESS_TOKEN: "test-token",
        TESLA_VEHICLE_ID: teslaVehicleId,
      },
      integration: createTeslaRuntimeIntegration(),
      integrationDependencies: {
        bootstrapFromSource: () => {
          const teslaAdapter = new TeslaChargingRealAdapter({
            supportedVehicleIds: [teslaVehicleId],
            client: {
              startCharging: async () => ({ result: true, reason: "ok" }),
              stopCharging: async () => ({ result: true, reason: "ok" }),
              readChargingTelemetry: async () => {
                const telemetryTimestamp = telemetryTimestamps[Math.min(telemetryReadCount, telemetryTimestamps.length - 1)];
                telemetryReadCount += 1;
                return {
                  vehicleId: teslaVehicleId,
                  timestamp: telemetryTimestamp,
                  chargingState: "Charging",
                  chargePortLatch: "Engaged",
                  chargerPowerKw: 7,
                  batteryLevel: 70,
                };
              },
            },
          });

          const storageAdapter = new SimulatedDeviceAdapter({
            supportedDeviceIds: ["home-battery-1"],
            supportedCommandKinds: ["set_mode", "refresh_state"],
          });
          const registry = new DeviceAdapterRegistry([teslaAdapter, storageAdapter]);
          const executor = new LiveAdapterDeviceCommandExecutor(registry);
          const observedStateStore = new InMemoryObservedDeviceStateStore();

          return {
            config: {
              accessToken: "test-token",
              vehicleId: teslaVehicleId,
              timeoutMs: 10_000,
            },
            teslaAdapter,
            observedStateStore,
            executor,
            async runCycle(runtimeInput: Parameters<typeof runSingleTeslaCycle>[0]) {
              observedStateStore.setDeviceState("home-battery-1", {
                deviceId: "home-battery-1",
                lastTelemetryAt: runtimeInput.now,
                batterySocPercent: 52,
                batteryPowerW: 0,
                chargingState: "idle",
                stateSource: "telemetry_projection",
                schemaVersion: "observed-device-state.v1",
              });

              return runSingleTeslaCycle({
                ...runtimeInput,
                teslaVehicleId: teslaVehicleId,
                teslaAdapter,
                observedStateStore,
                executor,
              });
            },
          };
        },
        getSnapshot: () => ({
          systemState: {
            siteId: "site-tesla-conformance",
            capturedAt: cycleTimes[Math.min(optimizeCallCount, cycleTimes.length - 1)],
            timezone: "Europe/London",
            devices: [
              {
                deviceId: "home-battery-1",
                kind: "battery",
                brand: "Home",
                name: "Home Battery",
                connectionStatus: "online",
                lastUpdatedAt: cycleTimes[0],
                capabilities: ["read_soc", "read_power", "set_mode"],
              },
            ],
            homeLoadW: 2100,
            solarGenerationW: 300,
            batteryPowerW: 0,
            evChargingPowerW: 0,
            gridPowerW: 1800,
            batterySocPercent: 52,
            batteryCapacityKwh: 13.5,
            evConnected: true,
          },
          forecasts: {
            generatedAt: cycleTimes[0],
            horizonStartAt: cycleTimes[0],
            horizonEndAt: "2026-03-17T10:00:00.000Z",
            slotDurationMinutes: 30,
            householdLoadKwh: [],
            solarGenerationKwh: [],
            carbonIntensity: [],
          },
          tariffSchedule: {
            tariffId: "tariff-conformance",
            provider: "Aveum",
            name: "Conformance Tariff",
            currency: "GBP",
            updatedAt: cycleTimes[0],
            importRates: [],
            exportRates: [],
          },
        }),
        optimizeInput: () => {
          const selected = plans[Math.min(optimizeCallCount, plans.length - 1)];
          optimizeCallCount += 1;
          return selected;
        },
        resolveTariffSchedule: async ({ fallbackTariffSchedule }: { fallbackTariffSchedule: unknown }) => ({
          tariffSchedule: fallbackTariffSchedule,
          source: "simulated",
          caveats: ["conformance harness"],
        }),
      },
      cycleTimesIso: cycleTimes,
      expectedMappedDeviceIds: [teslaVehicleId, "home-battery-1"],
      staleObservedStateCycleIndex: 1,
      economicUncertaintyCycleIndex: 1,
      conflictingCommandCycleIndex: 4,
      protectiveCycleIndex: 1,
      recoveryCycleIndex: 2,
      capabilityFailureCycleIndex: 3,
      expectedCapabilityFailureReasonCode: "COMMAND_KIND_NOT_SUPPORTED",
      economicPreferenceCycleIndex: 5,
      crossAssetEconomicCycleIndex: 6,
    };

    const report = await runIntegrationConformanceScenario(scenario);
    assertIntegrationConformance(scenario, report);

    expect(report.journalEntries.some((entry) => entry.targetDeviceId === teslaVehicleId)).toBe(true);
    expect(report.journalEntries.some((entry) => entry.targetDeviceId === "ev-generic-1")).toBe(false);
  });

  it("validates canonical runtime invariants for storage-style stub integration", async () => {
    const cycleTimes = [
      "2026-03-16T11:05:00.000Z",
      "2026-03-16T11:15:00.000Z",
      "2026-03-16T11:25:00.000Z",
      "2026-03-16T11:35:00.000Z",
      "2026-03-16T11:45:00.000Z",
      "2026-03-16T11:55:00.000Z",
      "2026-03-16T12:05:00.000Z",
    ];
    const storageDeviceId = "stub-battery-1";
    const storageEvDeviceId = "stub-ev-1";

    const cycleScenarios: StorageStubCycleScenario[] = cycleTimes.map((cycleTime, index) => {
      const systemState = buildStorageSystemState(cycleTime, storageDeviceId);
      const freshness = buildFreshnessSummary(
        cycleTime,
        systemState.devices,
        index === 1 ? { [storageDeviceId]: "missing" } : { [storageDeviceId]: "fresh" },
      );

      return {
        cycleLabel: (["A", "B", "C", "D", "E", "F", "G"] as const)[index],
        systemState,
        observedFreshness: freshness,
      };
    });

    const storageCrossAssetDevices: DeviceState[] = [
      ...buildStorageSystemState(cycleTimes[6], storageDeviceId).devices,
      {
        deviceId: storageEvDeviceId,
        kind: "ev_charger",
        brand: "Stub",
        name: "Storage Stub EV",
        connectionStatus: "online",
        lastUpdatedAt: cycleTimes[6],
        capabilities: ["schedule_window", "refresh_state", "read_soc"],
        connected: true,
      },
    ];

    cycleScenarios[6] = {
      cycleLabel: "G",
      systemState: {
        ...buildStorageSystemState(cycleTimes[6], storageDeviceId),
        devices: storageCrossAssetDevices,
        solarGenerationW: 4100,
        homeLoadW: 1200,
        gridPowerW: -1300,
        evConnected: true,
      },
      observedFreshness: buildFreshnessSummary(
        cycleTimes[6],
        storageCrossAssetDevices,
        {
          [storageDeviceId]: "fresh",
          [storageEvDeviceId]: "fresh",
        },
      ),
    };

    const plans: OptimizerOutput[] = [
      buildPlan({
        planId: "storage-plan-A",
        generatedAt: cycleTimes[0],
        decision: buildDecision({
          decisionId: "storage-decision-a",
          action: "charge_battery",
          targetDeviceId: storageDeviceId,
          reason: "cycle A issue",
        }),
        command: {
          commandId: "storage-cmd-a",
          deviceId: storageDeviceId,
          issuedAt: cycleTimes[0],
          type: "set_mode",
          mode: "charge",
          effectiveWindow: { startAt: "2026-03-16T11:00:00.000Z", endAt: "2026-03-16T12:00:00.000Z" },
        },
      }),
      buildPlan({
        planId: "storage-plan-B",
        generatedAt: cycleTimes[1],
        decisions: [
          buildDecision({
            decisionId: "storage-decision-b-hold",
            action: "hold",
            targetDeviceId: storageDeviceId,
            reason: "cycle B missing telemetry blocks hold-like command",
          }),
          buildDecision({
            decisionId: "storage-decision-b-econ",
            action: "charge_battery",
            targetDeviceId: storageDeviceId,
            reason: "cycle B economic uncertainty blocks aggressive command",
          }),
        ],
        commands: [
          {
            commandId: "storage-cmd-b-hold",
            deviceId: storageDeviceId,
            issuedAt: cycleTimes[1],
            type: "set_mode",
            mode: "hold",
            effectiveWindow: { startAt: "2026-03-16T11:00:00.000Z", endAt: "2026-03-16T12:00:00.000Z" },
          },
          {
            commandId: "storage-cmd-b-econ",
            deviceId: storageDeviceId,
            issuedAt: cycleTimes[1],
            type: "set_mode",
            mode: "charge",
            effectiveWindow: { startAt: "2026-03-16T11:00:00.000Z", endAt: "2026-03-16T12:00:00.000Z" },
          },
        ],
        planningInputCoverage: buildUncertainEconomicCoverage(),
        planningConfidenceLevel: "low",
        conservativeAdjustmentApplied: true,
        conservativeAdjustmentReason: "Tariff data missing.",
        warnings: ["Economic uncertainty active."],
      }),
      buildPlan({
        planId: "storage-plan-C",
        generatedAt: cycleTimes[2],
        decision: buildDecision({
          decisionId: "storage-decision-c",
          action: "charge_battery",
          targetDeviceId: storageDeviceId,
          reason: "cycle C recovery",
        }),
        command: {
          commandId: "storage-cmd-c",
          deviceId: storageDeviceId,
          issuedAt: cycleTimes[2],
          type: "set_mode",
          mode: "charge",
          effectiveWindow: { startAt: "2026-03-16T11:00:00.000Z", endAt: "2026-03-16T12:00:00.000Z" },
        },
      }),
      buildPlan({
        planId: "storage-plan-D",
        generatedAt: cycleTimes[3],
        decision: buildDecision({
          decisionId: "storage-decision-d",
          action: "hold",
          targetDeviceId: storageDeviceId,
          reason: "cycle D invalid command preflight",
        }),
        command: {
          commandId: "storage-cmd-d",
          deviceId: storageDeviceId,
          issuedAt: cycleTimes[3],
          type: "set_power_limit",
          powerW: 2800,
          effectiveWindow: { startAt: "2026-03-16T11:00:00.000Z", endAt: "2026-03-16T12:00:00.000Z" },
        },
      }),
      buildPlan({
        planId: "storage-plan-E",
        generatedAt: cycleTimes[4],
        decisions: [
          buildDecision({
            decisionId: "storage-decision-e-1",
            action: "hold",
            targetDeviceId: storageDeviceId,
            reason: "cycle E first refresh command",
          }),
          buildDecision({
            decisionId: "storage-decision-e-2",
            action: "hold",
            targetDeviceId: storageDeviceId,
            reason: "cycle E second refresh command should conflict",
          }),
        ],
        commands: [
          {
            commandId: "storage-cmd-e-1",
            deviceId: storageDeviceId,
            issuedAt: cycleTimes[4],
            type: "refresh_state",
            effectiveWindow: { startAt: "2026-03-16T11:00:00.000Z", endAt: "2026-03-16T12:00:00.000Z" },
          },
          {
            commandId: "storage-cmd-e-2",
            deviceId: storageDeviceId,
            issuedAt: cycleTimes[4],
            type: "refresh_state",
            effectiveWindow: { startAt: "2026-03-16T11:00:00.000Z", endAt: "2026-03-16T12:00:00.000Z" },
          },
        ],
      }),
      // Cycle F: two competing commands for the storage device with different economic values.
      // The runtime must select discharge_battery (higher export value) over charge_battery.
      buildPlan({
        planId: "storage-plan-F",
        generatedAt: cycleTimes[5],
        decisions: [
          buildDecision({
            decisionId: "storage-decision-f-low",
            action: "charge_battery",
            targetDeviceId: storageDeviceId,
            reason: "cycle F lower-value option: charge at current rate",
            effectiveStoredEnergyValuePencePerKwh: 3.9,
            executionWindowOverride: { startAt: "2026-03-16T11:50:00.000Z", endAt: "2026-03-16T12:50:00.000Z" },
          }),
          buildDecision({
            decisionId: "storage-decision-f-high",
            action: "discharge_battery",
            targetDeviceId: storageDeviceId,
            reason: "cycle F higher-value option: export at peak export rate",
            effectiveStoredEnergyValuePencePerKwh: 18.2,
            executionWindowOverride: { startAt: "2026-03-16T11:55:00.000Z", endAt: "2026-03-16T12:55:00.000Z" },
          }),
        ],
        commands: [
          {
            commandId: "storage-cmd-f-low",
            deviceId: storageDeviceId,
            issuedAt: cycleTimes[5],
            type: "set_mode",
            mode: "charge",
            effectiveWindow: { startAt: "2026-03-16T11:50:00.000Z", endAt: "2026-03-16T12:50:00.000Z" },
          },
          {
            commandId: "storage-cmd-f-high",
            deviceId: storageDeviceId,
            issuedAt: cycleTimes[5],
            type: "set_mode",
            mode: "discharge",
            effectiveWindow: { startAt: "2026-03-16T11:55:00.000Z", endAt: "2026-03-16T12:55:00.000Z" },
          },
        ],
      }),
      buildPlan({
        planId: "storage-plan-G",
        generatedAt: cycleTimes[6],
        decisions: [
          buildDecision({
            decisionId: "storage-decision-g-battery",
            action: "export_to_grid",
            targetDeviceId: storageDeviceId,
            reason: "cycle G higher-value option: export battery energy during strong export window",
            effectiveStoredEnergyValuePencePerKwh: 18.6,
            executionWindowOverride: { startAt: "2026-03-16T12:05:00.000Z", endAt: "2026-03-16T13:05:00.000Z" },
          }),
          buildDecision({
            decisionId: "storage-decision-g-ev",
            action: "charge_ev",
            targetDeviceId: storageEvDeviceId,
            reason: "cycle G lower-value option: charge EV instead of exporting",
            effectiveStoredEnergyValuePencePerKwh: 6.4,
            executionWindowOverride: { startAt: "2026-03-16T12:05:00.000Z", endAt: "2026-03-16T13:05:00.000Z" },
          }),
        ],
        commands: [
          {
            commandId: "storage-cmd-g-battery",
            deviceId: storageDeviceId,
            issuedAt: cycleTimes[6],
            type: "set_mode",
            mode: "export",
            effectiveWindow: { startAt: "2026-03-16T12:05:00.000Z", endAt: "2026-03-16T13:05:00.000Z" },
          },
          {
            commandId: "storage-cmd-g-ev",
            deviceId: storageEvDeviceId,
            issuedAt: cycleTimes[6],
            type: "schedule_window",
            window: { startAt: "2026-03-16T12:05:00.000Z", endAt: "2026-03-16T13:05:00.000Z" },
            targetMode: "charge",
            effectiveWindow: { startAt: "2026-03-16T12:05:00.000Z", endAt: "2026-03-16T13:05:00.000Z" },
          },
        ],
      }),
    ];

    const scenario: IntegrationConformanceScenario<AveumContinuousRuntimeSource, unknown> = {
      suiteName: "storage-stub-integration",
      source: {
        GRIDLY_SITE_ID: "site-storage-stub",
        GRIDLY_CONTINUOUS_FRESHNESS_THRESHOLD_SECONDS: "1",
      },
      integration: createStorageStubIntegration(),
      integrationDependencies: (journalStore) => ({
        cycleScenarios,
        plansByBuildOrder: plans,
        journalStore,
      }),
      cycleTimesIso: cycleTimes,
      expectedMappedDeviceIds: [storageDeviceId, storageEvDeviceId],
      staleObservedStateCycleIndex: 1,
      economicUncertaintyCycleIndex: 1,
      conflictingCommandCycleIndex: 4,
      protectiveCycleIndex: 1,
      recoveryCycleIndex: 2,
      capabilityFailureCycleIndex: 3,
      expectedCapabilityFailureReasonCode: "COMMAND_KIND_NOT_SUPPORTED",
      economicPreferenceCycleIndex: 5,
      crossAssetEconomicCycleIndex: 6,
    };

    const report = await runIntegrationConformanceScenario(scenario);
    assertIntegrationConformance(scenario, report);
  });
});