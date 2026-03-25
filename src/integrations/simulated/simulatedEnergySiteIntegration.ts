import type { DeviceState, SystemState } from "../../domain";
import type { OptimizerOutput } from "../../domain/optimizer";
import type { ObservedStateFreshnessSummary } from "../../domain/observedStateFreshness";
import { DeviceAdapterRegistry } from "../../adapters/adapterRegistry";
import { LiveAdapterDeviceCommandExecutor } from "../../application/controlLoopExecution/liveAdapterExecutor";
import { runControlLoopExecutionService } from "../../application/controlLoopExecution/service";
import type {
  ContinuousRuntimeIntegration,
  AveumContinuousRuntimeSource,
  PreparedContinuousRuntimeIntegration,
} from "../../application/runtime/runContinuousRuntime";
import type {
  CycleContext,
  CycleSummary,
} from "../../application/continuousLoop/controlLoopRunnerTypes";
import { InMemoryDeviceCapabilitiesProvider } from "../../capabilities/deviceCapabilitiesProvider";
import type { ExecutionJournalStore } from "../../journal/executionJournalStore";
import {
  SimulatedEnergyAdapter,
  type SimulatedEnergyAdapterScenario,
} from "./simulatedEnergyAdapter";

export interface SimulatedEnergyRuntimeSource extends AveumContinuousRuntimeSource {}

export interface SimulatedCycleScenario {
  cycleLabel: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  systemState: SystemState;
  observedFreshness?: ObservedStateFreshnessSummary;
  telemetryStale?: boolean;
  observedBatterySocPercent?: number;
  observedChargingState?: "charging" | "discharging" | "idle" | "unknown";
}

export interface SimulatedEnergySiteTrace {
  executedCycleLabels: string[];
  cycleContexts: CycleContext[];
  cycleSummaries: CycleSummary[];
  buildPlanCount: number;
}

export interface SimulatedEnergyIntegrationDependencies {
  cycleScenarios: SimulatedCycleScenario[];
  plansByBuildOrder: OptimizerOutput[];
  journalStore: ExecutionJournalStore;
  trace?: SimulatedEnergySiteTrace;
}

function buildCapabilitiesProvider(devices: DeviceState[]): InMemoryDeviceCapabilitiesProvider {
  return new InMemoryDeviceCapabilitiesProvider(
    devices.map((device) => {
      if (device.deviceId === "battery_1" || device.deviceId === "battery_2") {
        return {
          deviceId: device.deviceId,
          supportedCommandKinds: ["set_mode", "refresh_state"],
          supportedModes: ["charge", "discharge", "hold", "export"],
          minimumCommandWindowMinutes: 15,
          supportsOverlappingWindows: true,
          supportsImmediateExecution: true,
          schemaVersion: "capabilities.v1",
        };
      }

      if (device.deviceId === "grid_export_control") {
        return {
          deviceId: device.deviceId,
          supportedCommandKinds: ["set_mode", "refresh_state"],
          supportedModes: ["export", "hold"],
          minimumCommandWindowMinutes: 15,
          supportsOverlappingWindows: true,
          supportsImmediateExecution: true,
          schemaVersion: "capabilities.v1",
        };
      }

      if (device.deviceId === "ev_charger") {
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

function buildCycleFinancialContext(plan: OptimizerOutput) {
  return {
    optimizationMode: "balanced" as const,
    valueLedger: {
      optimizationMode: "balanced" as const,
      estimatedImportCostPence: plan.summary.expectedImportCostPence,
      estimatedExportRevenuePence: plan.summary.expectedExportRevenuePence,
      estimatedBatteryDegradationCostPence: 2,
      estimatedNetCostPence:
        plan.summary.expectedImportCostPence - plan.summary.expectedExportRevenuePence + 2,
      baselineType: "hold_current_state" as const,
      baselineNetCostPence: plan.summary.expectedImportCostPence + 8,
      baselineImportCostPence: plan.summary.expectedImportCostPence + 8,
      baselineExportRevenuePence: plan.summary.expectedExportRevenuePence,
      baselineBatteryDegradationCostPence: 0,
      estimatedSavingsVsBaselinePence: 8,
      assumptions: [],
      caveats: [],
      confidence: 0.8,
    },
    planningInputCoverage: plan.planningInputCoverage,
    planningConfidenceLevel: plan.planningConfidenceLevel,
    conservativeAdjustmentApplied: plan.conservativeAdjustmentApplied,
    conservativeAdjustmentReason: plan.conservativeAdjustmentReason,
    planningAssumptions: plan.assumptions,
    planningWarnings: plan.warnings,
  };
}

export function createSimulatedEnergySiteIntegration(
  adapterScenarios: SimulatedEnergyAdapterScenario[],
): ContinuousRuntimeIntegration<
  SimulatedEnergyRuntimeSource,
  SimulatedEnergyIntegrationDependencies
> {
  return {
    async prepare(input): Promise<PreparedContinuousRuntimeIntegration> {
      if (!input.dependencies) {
        throw new Error("Simulated energy site integration requires explicit dependencies.");
      }

      const dependencies = input.dependencies;
      const trace = dependencies.trace;

      const handledDeviceIds = new Set(
        dependencies.cycleScenarios.flatMap((scenario) =>
          scenario.systemState.devices.map((device) => device.deviceId),
        ),
      );

      const adapter = new SimulatedEnergyAdapter(
        handledDeviceIds,
        new Map(adapterScenarios.map((scenario) => [scenario.cycleLabel, scenario])),
      );
      const registry = new DeviceAdapterRegistry([adapter]);
      const executor = new LiveAdapterDeviceCommandExecutor(registry);

      let cycleIndex = 0;
      let buildPlanCount = 0;

      return {
        cycleExecutor: {
          async buildPlan(): Promise<OptimizerOutput> {
            const fallbackIndex = dependencies.plansByBuildOrder.length - 1;
            const plan = dependencies.plansByBuildOrder[Math.min(buildPlanCount, fallbackIndex)];
            buildPlanCount += 1;

            if (trace) {
              trace.buildPlanCount = buildPlanCount;
            }

            return plan;
          },

          async execute(ctx: CycleContext): Promise<CycleSummary> {
            const scenario = dependencies.cycleScenarios[Math.min(cycleIndex, dependencies.cycleScenarios.length - 1)];
            cycleIndex += 1;
            adapter.setActiveCycle(scenario.cycleLabel);

            const capabilitiesProvider = buildCapabilitiesProvider(scenario.systemState.devices);
            const runtimeContext = scenario.telemetryStale
              ? undefined
              : {
                  safeHoldMode: ctx.safeHoldMode,
                  planFreshnessStatus: ctx.planFreshnessStatus,
                  replanTrigger: ctx.replanTrigger,
                  stalePlanReuseCount: ctx.stalePlanReuseCount,
                  stalePlanWarning: ctx.stalePlanWarning,
                };

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
              buildCycleFinancialContext(ctx.currentPlan),
              runtimeContext,
              input.runtimeExecutionMode,
              {
                cycleId: ctx.cycleId,
                replanReason: ctx.replanReason,
              },
            );

            const summary: CycleSummary = {
              cycleId: ctx.cycleId,
              nowIso: ctx.nowIso,
              status: "ok",
              replanRequired: false,
              issuedCommandCount: execution.executionResults.filter((result) => result.status === "issued").length,
              skippedCommandCount: execution.executionResults.filter((result) => result.status === "skipped").length,
              failedCommandCount: execution.executionResults.filter((result) => result.status === "failed").length,
              journalEntriesWritten: execution.executionResults.length,
              planAgeSeconds: ctx.planAgeSeconds,
              planFreshnessStatus: ctx.planFreshnessStatus,
              replanTriggered: ctx.replanTriggered,
              replanTrigger: ctx.replanTrigger,
              replanReason: ctx.replanReason,
              stalePlanReuseCount: ctx.stalePlanReuseCount,
              observedBatterySocPercent: scenario.observedBatterySocPercent,
              observedChargingState: scenario.observedChargingState,
            };

            if (trace) {
              trace.executedCycleLabels.push(scenario.cycleLabel);
              trace.cycleContexts.push(ctx);
              trace.cycleSummaries.push(summary);
            }

            return summary;
          },
        },
        loopConfig: {
          siteId: input.source.GRIDLY_SITE_ID?.trim() || "site-sim",
        },
      };
    },
  };
}
