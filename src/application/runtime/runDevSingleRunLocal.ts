import { DeviceAdapterRegistry } from "../../adapters/adapterRegistry";
import { SimulatedDeviceAdapter } from "../../adapters/simulated/SimulatedDeviceAdapter";
import { TeslaChargingRealAdapter } from "../../adapters/tesla/TeslaChargingRealAdapter";
import type { ForecastPoint, OptimizerInput, SystemState, TariffRate, TariffSchedule } from "../../domain";
import { FileExecutionJournalStore } from "../../journal/fileExecutionJournalStore";
import { InMemoryExecutionJournalStore } from "../../journal/executionJournalStore";
import { resolveJournalDirectoryPath } from "../../journal/journalDirectory";
import { InMemoryObservedDeviceStateStore } from "../../observed/observedDeviceStateStore";
import { LiveAdapterDeviceCommandExecutor } from "../controlLoopExecution/liveAdapterExecutor";
import { runSingleTeslaCycle } from "./runSingleTeslaCycle";
import {
  runTeslaSingleRunLocal,
  type TeslaLocalSingleRunDependencies,
  type TeslaLocalSingleRunSource,
  type TeslaLocalSingleRunSummary,
} from "./runTeslaSingleRunLocal";

export interface DevLocalSingleRunSource {
  GRIDLY_NOW_ISO?: string;
  GRIDLY_SITE_ID?: string;
  GRIDLY_TIMEZONE?: string;
  GRIDLY_PLANNING_STYLE?: string;
  GRIDLY_OPTIMIZATION_MODE?: string;
  GRIDLY_DEV_SCENARIO?: string;
  GRIDLY_CONFIG_DIR?: string;
  GRIDLY_JOURNAL_DIR?: string;
  GRIDLY_DEV_VEHICLE_ID?: string;
}

const DEFAULT_DEV_ACCESS_TOKEN = "gridly-dev-token";
const DEFAULT_DEV_VEHICLE_ID = "gridly-dev-vehicle-1";
const DEFAULT_SCENARIO_DAY = "2026-03-16";
const STYLE_CONTRAST_SCENARIO_ID = "planning-style-contrast";
const STYLE_CONTRAST_NOW_ISO = `${DEFAULT_SCENARIO_DAY}T05:30:00.000Z`;
const STYLE_CONTRAST_BATTERY_DEVICE_ID = "gridly-dev-battery-1";

function buildCandidateNowIsos(): string[] {
  const candidates: string[] = [];

  for (let slot = 0; slot < 48; slot += 1) {
    const hour = Math.floor(slot / 2).toString().padStart(2, "0");
    const minute = slot % 2 === 0 ? "00" : "30";
    candidates.push(`${DEFAULT_SCENARIO_DAY}T${hour}:${minute}:00.000Z`);
  }

  return candidates;
}

function toTeslaLocalSource(
  source: DevLocalSingleRunSource,
  nowIso: string,
  vehicleId: string,
): TeslaLocalSingleRunSource {
  return {
    GRIDLY_NOW_ISO: nowIso,
    GRIDLY_SITE_ID: source.GRIDLY_SITE_ID,
    GRIDLY_TIMEZONE: source.GRIDLY_TIMEZONE,
    GRIDLY_PLANNING_STYLE: source.GRIDLY_PLANNING_STYLE,
    GRIDLY_OPTIMIZATION_MODE: source.GRIDLY_OPTIMIZATION_MODE,
    GRIDLY_CONFIG_DIR: source.GRIDLY_CONFIG_DIR,
    GRIDLY_JOURNAL_DIR: source.GRIDLY_JOURNAL_DIR,
    TESLA_ACCESS_TOKEN: DEFAULT_DEV_ACCESS_TOKEN,
    TESLA_VEHICLE_ID: vehicleId,
  };
}

function addMinutes(startAtIso: string, minutes: number): string {
  return new Date(new Date(startAtIso).getTime() + minutes * 60_000).toISOString();
}

function buildRate(startAt: string, minutes: number, unitRatePencePerKwh: number): TariffRate {
  return {
    startAt,
    endAt: addMinutes(startAt, minutes),
    unitRatePencePerKwh,
    source: "live",
  };
}

function buildForecastPoint(startAt: string, minutes: number, value: number): ForecastPoint {
  return {
    startAt,
    endAt: addMinutes(startAt, minutes),
    value,
    confidence: 0.92,
  };
}

function buildPlanningStyleContrastSnapshot(now: Date, vehicleId: string): {
  systemState: SystemState;
  forecasts: OptimizerInput["forecasts"];
  tariffSchedule: TariffSchedule;
} {
  const slotDurationMinutes = 30;
  const startAt = now.toISOString();
  const slot1Start = addMinutes(startAt, slotDurationMinutes);
  const slot2Start = addMinutes(slot1Start, slotDurationMinutes);
  const horizonEndAt = addMinutes(slot2Start, slotDurationMinutes);

  const importRates = [
    buildRate(startAt, slotDurationMinutes, 19.5),
    buildRate(slot1Start, slotDurationMinutes, 14),
    buildRate(slot2Start, slotDurationMinutes, 14),
  ];
  const exportRates = [
    buildRate(startAt, slotDurationMinutes, 0),
    buildRate(slot1Start, slotDurationMinutes, 0),
    buildRate(slot2Start, slotDurationMinutes, 0),
  ];

  const forecasts: OptimizerInput["forecasts"] = {
    generatedAt: startAt,
    horizonStartAt: startAt,
    horizonEndAt,
    slotDurationMinutes,
    householdLoadKwh: [
      buildForecastPoint(startAt, slotDurationMinutes, 0.6),
      buildForecastPoint(slot1Start, slotDurationMinutes, 0.6),
      buildForecastPoint(slot2Start, slotDurationMinutes, 0.6),
    ],
    solarGenerationKwh: [
      buildForecastPoint(startAt, slotDurationMinutes, 0),
      buildForecastPoint(slot1Start, slotDurationMinutes, 0),
      buildForecastPoint(slot2Start, slotDurationMinutes, 0),
    ],
    carbonIntensity: [
      buildForecastPoint(startAt, slotDurationMinutes, 220),
      buildForecastPoint(slot1Start, slotDurationMinutes, 210),
      buildForecastPoint(slot2Start, slotDurationMinutes, 205),
    ],
  };

  return {
    systemState: {
      siteId: "gridly-style-contrast-home",
      capturedAt: startAt,
      timezone: "Europe/London",
      devices: [
        {
          deviceId: "gridly-dev-battery-1",
          kind: "battery",
          brand: "Aveum",
          name: "Home Battery",
          connectionStatus: "online",
          lastUpdatedAt: startAt,
          capabilities: ["set_mode", "read_power", "read_soc"],
          capacityKwh: 10,
        },
        {
          deviceId: vehicleId,
          kind: "ev_charger",
          brand: "Tesla",
          name: "Tesla Vehicle Charger",
          connectionStatus: "online",
          lastUpdatedAt: startAt,
          capabilities: ["schedule_window", "read_power", "read_soc", "start_stop"],
          capacityKwh: 60,
        },
        {
          deviceId: "gridly-dev-grid-1",
          kind: "smart_meter",
          brand: "Octopus",
          name: "Smart Meter",
          connectionStatus: "online",
          lastUpdatedAt: startAt,
          capabilities: ["read_tariff", "read_power"],
        },
      ],
      homeLoadW: 1200,
      solarGenerationW: 0,
      batteryPowerW: 0,
      evChargingPowerW: 0,
      gridPowerW: 1200,
      batterySocPercent: 40,
      batteryCapacityKwh: 10,
      evSocPercent: 40,
      evConnected: true,
      currentImportRatePencePerKwh: importRates[0].unitRatePencePerKwh,
      currentExportRatePencePerKwh: exportRates[0].unitRatePencePerKwh,
    },
    forecasts,
    tariffSchedule: {
      tariffId: "gridly-style-contrast",
      provider: "Aveum",
      name: "Deterministic planning-style contrast",
      currency: "GBP",
      updatedAt: startAt,
      importRates,
      exportRates,
    },
  };
}

function isStyleContrastScenario(source: DevLocalSingleRunSource): boolean {
  return source.GRIDLY_DEV_SCENARIO?.trim().toLowerCase() === STYLE_CONTRAST_SCENARIO_ID;
}

function buildDevRuntimeDependencies(): TeslaLocalSingleRunDependencies {
  return {
    bootstrapFromSource: (source) => {
      const vehicleId = source.TESLA_VEHICLE_ID?.trim() || DEFAULT_DEV_VEHICLE_ID;
      const teslaAdapter = new TeslaChargingRealAdapter({
        supportedVehicleIds: [vehicleId],
        client: {
          startCharging: async () => ({ result: true, reason: "ok" }),
          stopCharging: async () => ({ result: true, reason: "ok" }),
          readChargingTelemetry: async () => ({
            vehicleId,
            timestamp: new Date().toISOString(),
            chargingState: "Stopped",
            chargePortLatch: "Engaged",
            chargerPowerKw: 0,
            batteryLevel: 38,
          }),
        },
      });
      const simulatedBatteryAdapter = new SimulatedDeviceAdapter({
        supportedDeviceIds: [STYLE_CONTRAST_BATTERY_DEVICE_ID],
        supportedCommandKinds: ["set_mode"],
      });
      const registry = new DeviceAdapterRegistry([teslaAdapter, simulatedBatteryAdapter]);
      const executor = new LiveAdapterDeviceCommandExecutor(registry);
      const observedStateStore = new InMemoryObservedDeviceStateStore();

      return {
        config: {
          accessToken: DEFAULT_DEV_ACCESS_TOKEN,
          vehicleId,
          timeoutMs: 1_000,
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
    },
    resolveTariffSchedule: async ({ fallbackTariffSchedule }) => ({
      tariffSchedule: fallbackTariffSchedule,
      source: "simulated",
      caveats: ["Using stubbed local runtime inputs for product iteration."],
    }),
  };
}

async function resolveScenarioNowIso(
  source: DevLocalSingleRunSource,
  vehicleId: string,
  dependencies: TeslaLocalSingleRunDependencies,
): Promise<string> {
  if (source.GRIDLY_NOW_ISO?.trim()) {
    return source.GRIDLY_NOW_ISO.trim();
  }

  for (const nowIso of buildCandidateNowIsos()) {
    const journalStore = new InMemoryExecutionJournalStore();
    const summary = await runTeslaSingleRunLocal(
      toTeslaLocalSource(source, nowIso, vehicleId),
      {
        ...dependencies,
        journalStoreFactory: () => journalStore,
      },
    );

    if (summary.status === "ok" && journalStore.getDecisionExplanations().length > 0) {
      return nowIso;
    }
  }

  throw new Error("Unable to find a stubbed runtime scenario that produces decision explanations.");
}

export async function runDevSingleRunLocal(
  source: DevLocalSingleRunSource = process.env,
): Promise<TeslaLocalSingleRunSummary> {
  const vehicleId = source.GRIDLY_DEV_VEHICLE_ID?.trim() || DEFAULT_DEV_VEHICLE_ID;
  const dependencies = buildDevRuntimeDependencies();

  if (isStyleContrastScenario(source)) {
    const nowIso = source.GRIDLY_NOW_ISO?.trim() || STYLE_CONTRAST_NOW_ISO;

    return runTeslaSingleRunLocal(
      toTeslaLocalSource(source, nowIso, vehicleId),
      {
        ...dependencies,
        getSnapshot: (now) => buildPlanningStyleContrastSnapshot(now, vehicleId),
        journalStoreFactory: (resolvedSource) => new FileExecutionJournalStore({
          directoryPath: resolveJournalDirectoryPath(resolvedSource),
        }),
      },
    );
  }

  const nowIso = await resolveScenarioNowIso(source, vehicleId, dependencies);

  return runTeslaSingleRunLocal(
    toTeslaLocalSource(source, nowIso, vehicleId),
    {
      ...dependencies,
      journalStoreFactory: (resolvedSource) => new FileExecutionJournalStore({
        directoryPath: resolveJournalDirectoryPath(resolvedSource),
      }),
    },
  );
}

export async function runDevSingleRunLocalCli(
  source: DevLocalSingleRunSource = process.env,
): Promise<number> {
  const summary = await runDevSingleRunLocal(source);

  if (summary.status === "ok") {
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }

  console.error(JSON.stringify(summary, null, 2));
  return 1;
}