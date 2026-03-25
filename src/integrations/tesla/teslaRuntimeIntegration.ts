import { getCanonicalSimulationSnapshot } from "../../simulator";
import { optimize } from "../../optimizer/engine";
import type { DeviceState, OptimizationMode, OptimizerInput, SystemState } from "../../domain";
import type { OptimizerOutput } from "../../domain/optimizer";
import { buildCanonicalValueLedger } from "../../application/runtime/buildCanonicalValueLedger";
import {
  resolveRuntimeTariffSchedule,
  type RuntimeTariffResolution,
} from "../../application/runtime/resolveRuntimeTariffSchedule";
import {
  TeslaSingleRunBootstrapError,
  parseTeslaSingleRunRuntimeConfig,
  type TeslaSingleRunRuntime,
  type TeslaSingleRunRuntimeConfigSource,
} from "../../application/runtime/teslaSingleRunBootstrap";
import { DeviceAdapterRegistry } from "../../adapters/adapterRegistry";
import { TeslaHttpApiClient } from "../../adapters/tesla/TeslaApiClient";
import { TeslaChargingRealAdapter } from "../../adapters/tesla/TeslaChargingRealAdapter";
import { LiveAdapterDeviceCommandExecutor } from "../../application/controlLoopExecution/liveAdapterExecutor";
import { InMemoryDeviceCapabilitiesProvider } from "../../capabilities/deviceCapabilitiesProvider";
import { InMemoryObservedDeviceStateStore } from "../../observed/observedDeviceStateStore";
import { runSingleTeslaCycle } from "../../application/runtime/runSingleTeslaCycle";
import {
  buildConstraintsForPlanningStyle,
  resolvePlanningStyle,
  type PlanningStyleSourceEnvironment,
} from "../../application/runtime/planningStyleStore";
import {
  TeslaContinuousCycleExecutor,
  type ContinuousLiveExecutionEnvironment,
} from "../../application/runtime/teslaContinuousCycleExecutor";
import type {
  ContinuousRuntimeIntegration,
  AveumContinuousRuntimeSource,
  PreparedContinuousRuntimeIntegration,
} from "../../application/runtime/runContinuousRuntime";

export interface TeslaRuntimeIntegrationSource
  extends AveumContinuousRuntimeSource,
    TeslaSingleRunRuntimeConfigSource {
  GRIDLY_TIMEZONE?: string;
  GRIDLY_PLANNING_STYLE?: string;
  GRIDLY_OPTIMIZATION_MODE?: string;
  GRIDLY_CONFIG_DIR?: string;
  GRIDLY_TARIFF_SOURCE?: string;
  GRIDLY_OCTOPUS_REGION?: string;
  GRIDLY_OCTOPUS_PRODUCT?: string;
  GRIDLY_OCTOPUS_EXPORT_PRODUCT?: string;
  GRIDLY_OCTOPUS_EXPORT_TARIFF_CODE?: string;
}

export interface TeslaRuntimeIntegrationDependencies {
  bootstrapFromSource?: (source: TeslaSingleRunRuntimeConfigSource) => TeslaSingleRunRuntime;
  getSnapshot?: (now: Date) => ReturnType<typeof getCanonicalSimulationSnapshot>;
  optimizeInput?: (input: OptimizerInput) => OptimizerOutput;
  resolveTariffSchedule?: (params: {
    now: Date;
    fallbackTariffSchedule: ReturnType<typeof getCanonicalSimulationSnapshot>["tariffSchedule"];
    sourceEnv: TeslaRuntimeIntegrationSource;
  }) => Promise<RuntimeTariffResolution>;
}

function ensureTeslaDeviceIdentity(systemState: SystemState, vehicleId: string, nowIso: string): SystemState {
  let hasMappedTeslaDevice = false;

  const devices = systemState.devices.map((device) => {
    if (device.kind !== "ev_charger" || hasMappedTeslaDevice) {
      return device;
    }

    hasMappedTeslaDevice = true;
    return {
      ...device,
      deviceId: vehicleId,
      brand: "Tesla",
      name: "Tesla Vehicle Charger",
      connectionStatus: "online" as const,
      lastUpdatedAt: nowIso,
      capabilities: Array.from(new Set([...(device.capabilities ?? []), "start_stop", "read_soc", "read_power"])),
    };
  });

  if (hasMappedTeslaDevice) {
    return {
      ...systemState,
      devices,
    };
  }

  return {
    ...systemState,
    devices: [
      ...devices,
      {
        deviceId: vehicleId,
        kind: "ev_charger",
        brand: "Tesla",
        name: "Tesla Vehicle Charger",
        connectionStatus: "online",
        lastUpdatedAt: nowIso,
        capabilities: ["start_stop", "read_soc", "read_power"],
        connected: true,
      },
    ],
  };
}

function buildTeslaCapabilitiesProvider(devices: DeviceState[]): InMemoryDeviceCapabilitiesProvider {
  return new InMemoryDeviceCapabilitiesProvider(
    devices.map((device) => {
      if (device.kind === "ev_charger") {
        return {
          deviceId: device.deviceId,
          supportedCommandKinds: ["start_charging", "stop_charging", "set_mode", "refresh_state"],
          supportedModes: ["charge", "hold"],
          supportsImmediateExecution: true,
          schemaVersion: "capabilities.v1",
        };
      }

      if (device.capabilities.includes("set_mode")) {
        return {
          deviceId: device.deviceId,
          supportedCommandKinds: ["set_mode", "refresh_state"],
          supportedModes: ["charge", "discharge", "export", "hold"],
          supportsImmediateExecution: true,
          schemaVersion: "capabilities.v1",
        };
      }

      if (device.capabilities.includes("schedule_window")) {
        return {
          deviceId: device.deviceId,
          supportedCommandKinds: ["schedule_window", "refresh_state"],
          supportedModes: ["charge"],
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

export function createTeslaRuntimeIntegration(): ContinuousRuntimeIntegration<
  TeslaRuntimeIntegrationSource,
  TeslaRuntimeIntegrationDependencies
> {
  return {
    async prepare(input): Promise<PreparedContinuousRuntimeIntegration> {
      const source = input.source;
      const dependencies = input.dependencies;

      const getSnapshot = dependencies?.getSnapshot ?? getCanonicalSimulationSnapshot;
      const optimizeInput = dependencies?.optimizeInput ?? optimize;
      const resolveTariffSchedule = dependencies?.resolveTariffSchedule ?? resolveRuntimeTariffSchedule;
      const resolvedPlanningStyle = resolvePlanningStyle(source as PlanningStyleSourceEnvironment);
      const optimizationMode = resolvedPlanningStyle.profile.optimizationMode;
      const runtime = dependencies?.bootstrapFromSource
        ? dependencies.bootstrapFromSource({
            TESLA_ACCESS_TOKEN: source.TESLA_ACCESS_TOKEN,
            TESLA_VEHICLE_ID: source.TESLA_VEHICLE_ID,
            TESLA_BASE_URL: source.TESLA_BASE_URL,
            TESLA_TIMEOUT_MS: source.TESLA_TIMEOUT_MS,
          })
        : (() => {
            const config = parseTeslaSingleRunRuntimeConfig({
              TESLA_ACCESS_TOKEN: source.TESLA_ACCESS_TOKEN,
              TESLA_VEHICLE_ID: source.TESLA_VEHICLE_ID,
              TESLA_BASE_URL: source.TESLA_BASE_URL,
              TESLA_TIMEOUT_MS: source.TESLA_TIMEOUT_MS,
            });

            const teslaClient = new TeslaHttpApiClient({
              accessToken: config.accessToken,
              baseUrl: config.baseUrl,
              timeoutMs: config.timeoutMs,
            });
            const teslaAdapter = new TeslaChargingRealAdapter({
              supportedVehicleIds: [config.vehicleId],
              client: teslaClient,
            });
            const adapterRegistry = new DeviceAdapterRegistry([teslaAdapter]);
            const executor = new LiveAdapterDeviceCommandExecutor(adapterRegistry);
            const observedStateStore = new InMemoryObservedDeviceStateStore();

            const integrationRuntime: TeslaSingleRunRuntime = {
              config,
              teslaAdapter,
              observedStateStore,
              executor,
              async runCycle(runtimeInput) {
                return runSingleTeslaCycle({
                  ...runtimeInput,
                  teslaVehicleId: config.vehicleId,
                  teslaAdapter,
                  observedStateStore,
                  executor,
                });
              },
            };

            return integrationRuntime;
          })();

      const resolveEnvironment = async (
        nowIso: string,
        currentPlan: OptimizerOutput,
      ): Promise<ContinuousLiveExecutionEnvironment> => {
        const now = new Date(nowIso);
        const snapshot = getSnapshot(now);
        const tariffResolution = await resolveTariffSchedule({
          now,
          fallbackTariffSchedule: snapshot.tariffSchedule,
          sourceEnv: source,
        });

        const baseSystemState = {
          ...snapshot.systemState,
          capturedAt: nowIso,
          siteId: source.GRIDLY_SITE_ID?.trim() || snapshot.systemState.siteId,
          timezone: source.GRIDLY_TIMEZONE?.trim() || snapshot.systemState.timezone,
        };

        const systemState = ensureTeslaDeviceIdentity(baseSystemState, runtime.config.vehicleId, nowIso);
        const valueLedger = buildCanonicalValueLedger({
          optimizationMode,
          optimizerOutput: currentPlan,
          forecasts: snapshot.forecasts,
          tariffSchedule: tariffResolution.tariffSchedule,
        });

        return {
          siteId: systemState.siteId,
          timezone: systemState.timezone,
          devices: systemState.devices,
          capabilitiesProvider: buildTeslaCapabilitiesProvider(systemState.devices),
          journalStore: input.journalStore,
          cycleFinancialContext: {
            planningStyle: resolvedPlanningStyle.activeStyle,
            optimizationMode,
            valueLedger,
            planningInputCoverage: currentPlan.planningInputCoverage,
            planningConfidenceLevel: currentPlan.planningConfidenceLevel,
            conservativeAdjustmentApplied: currentPlan.conservativeAdjustmentApplied,
            conservativeAdjustmentReason: currentPlan.conservativeAdjustmentReason,
            planningAssumptions: currentPlan.assumptions,
            planningWarnings: currentPlan.warnings,
          },
        };
      };

      return {
        cycleExecutor: new TeslaContinuousCycleExecutor({
          runtime,
          buildPlan: async (nowIso: string) => {
            const now = new Date(nowIso);
            const snapshot = getSnapshot(now);
            const tariffResolution = await resolveTariffSchedule({
              now,
              fallbackTariffSchedule: snapshot.tariffSchedule,
              sourceEnv: source,
            });

            const baseSystemState = {
              ...snapshot.systemState,
              capturedAt: nowIso,
              siteId: source.GRIDLY_SITE_ID?.trim() || snapshot.systemState.siteId,
              timezone: source.GRIDLY_TIMEZONE?.trim() || snapshot.systemState.timezone,
            };

            const systemState = ensureTeslaDeviceIdentity(baseSystemState, runtime.config.vehicleId, nowIso);

            return optimizeInput({
              systemState,
              forecasts: snapshot.forecasts,
              tariffSchedule: tariffResolution.tariffSchedule,
              constraints: buildConstraintsForPlanningStyle(systemState.devices, resolvedPlanningStyle),
            });
          },
          resolveExecutionEnvironment: ({ nowIso, currentPlan }) =>
            resolveEnvironment(nowIso, currentPlan),
        }),
      };
    },
  };
}

export function normalizeTeslaRuntimeError(error: unknown): { name: string; message: string; code?: string } {
  if (error instanceof TeslaSingleRunBootstrapError) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    name: "UnknownError",
    message: "Unknown runtime error",
  };
}