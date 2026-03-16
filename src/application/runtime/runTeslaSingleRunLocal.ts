import type { DeviceState, OptimizationMode, OptimizerInput, SystemState } from "../../domain";
import type { CanonicalValueLedger } from "../../domain/valueLedger";
import type { OptimizerOutput } from "../../domain/optimizer";
import { optimize } from "../../optimizer/engine";
import { getCanonicalSimulationSnapshot } from "../../simulator";
import { InMemoryExecutionJournalStore } from "../../journal/executionJournalStore";
import type { ExecutionJournalEntry } from "../../journal/executionJournal";
import { buildCanonicalValueLedger } from "./buildCanonicalValueLedger";
import {
  resolveRuntimeTariffSchedule,
  type RuntimeTariffResolution,
} from "./resolveRuntimeTariffSchedule";
import {
  TeslaSingleRunBootstrapError,
  type TeslaSingleRunRuntime,
  type TeslaSingleRunRuntimeConfigSource,
  bootstrapTeslaSingleRunRuntimeFromSource,
} from "./teslaSingleRunBootstrap";

export interface TeslaLocalSingleRunSource extends TeslaSingleRunRuntimeConfigSource {
  GRIDLY_NOW_ISO?: string;
  GRIDLY_SITE_ID?: string;
  GRIDLY_TIMEZONE?: string;
  GRIDLY_OPTIMIZATION_MODE?: string;
  GRIDLY_TARIFF_SOURCE?: string;
  GRIDLY_OCTOPUS_REGION?: string;
  GRIDLY_OCTOPUS_PRODUCT?: string;
  GRIDLY_OCTOPUS_EXPORT_PRODUCT?: string;
  GRIDLY_OCTOPUS_EXPORT_TARIFF_CODE?: string;
}

export interface TeslaLocalOptimizationModeSummary {
  requestedMode?: string;
  activeMode: OptimizationMode;
  defaulted: boolean;
}

export interface TeslaLocalSingleRunControlLoopSummary {
  activeDecisionCount: number;
  commandCount: number;
  skippedDecisionCount: number;
  replanRequired: boolean;
  reasons: string[];
}

export interface TeslaLocalSingleRunSuccessSummary {
  status: "ok";
  now: string;
  optimizationMode: TeslaLocalOptimizationModeSummary;
  config: {
    vehicleId: string;
    baseUrl?: string;
    timeoutMs: number;
  };
  optimizerResultSummary: {
    status: OptimizerOutput["status"];
    headline: string;
    diagnostics: Array<{
      code: string;
      severity: string;
    }>;
  };
  tariffForecastSummary: {
    source: RuntimeTariffResolution["source"];
    importRateCount: number;
    exportRateCount: number;
    caveats: string[];
  };
  valueLedger: CanonicalValueLedger;
  telemetryIngestionResult: {
    ingestedCount: number;
    acceptedCount: number;
    ignoredStaleCount: number;
    ignoredDuplicateCount: number;
    rejectedInvalidCount: number;
  };
  controlLoopResultSummary: TeslaLocalSingleRunControlLoopSummary;
  executionSummary: {
    total: number;
    issued: number;
    skipped: number;
    failed: number;
  };
  executionJournalEntries: ExecutionJournalEntry[];
}

export interface TeslaLocalSingleRunErrorSummary {
  status: "error";
  now: string;
  optimizationMode?: TeslaLocalOptimizationModeSummary;
  error: {
    stage: "bootstrap" | "runtime";
    name: string;
    message: string;
    code?: string;
  };
}

export type TeslaLocalSingleRunSummary = TeslaLocalSingleRunSuccessSummary | TeslaLocalSingleRunErrorSummary;

export interface TeslaLocalSingleRunDependencies {
  bootstrapFromSource?: (source: TeslaSingleRunRuntimeConfigSource) => TeslaSingleRunRuntime;
  getSnapshot?: (now: Date) => ReturnType<typeof getCanonicalSimulationSnapshot>;
  optimizeInput?: (input: OptimizerInput) => OptimizerOutput;
  resolveTariffSchedule?: (params: {
    now: Date;
    fallbackTariffSchedule: ReturnType<typeof getCanonicalSimulationSnapshot>["tariffSchedule"];
    sourceEnv: TeslaLocalSingleRunSource;
  }) => Promise<RuntimeTariffResolution>;
}

function parseNow(nowIso: string | undefined): Date {
  if (!nowIso || nowIso.trim() === "") {
    return new Date();
  }

  const parsed = new Date(nowIso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("GRIDLY_NOW_ISO must be a valid ISO-8601 timestamp.");
  }

  return parsed;
}

function resolveOptimizationMode(modeRaw: string | undefined): TeslaLocalOptimizationModeSummary {
  if (!modeRaw || modeRaw.trim() === "") {
    return {
      activeMode: "balanced",
      defaulted: false,
    };
  }

  const requestedMode = modeRaw.trim();
  const normalizedMode = requestedMode.toLowerCase();

  if (
    normalizedMode === "cost" ||
    normalizedMode === "balanced" ||
    normalizedMode === "self_consumption" ||
    normalizedMode === "carbon"
  ) {
    return {
      requestedMode,
      activeMode: normalizedMode,
      defaulted: false,
    };
  }

  return {
    requestedMode,
    activeMode: "balanced",
    defaulted: true,
  };
}

function buildConstraints(devices: DeviceState[], mode: OptimizationMode): OptimizerInput["constraints"] {
  const hasBattery = devices.some((device) => device.kind === "battery");
  const hasGrid = devices.some((device) => device.kind === "smart_meter");
  const hasEv = devices.some((device) => device.kind === "ev_charger");

  return {
    mode,
    batteryReservePercent: 30,
    maxBatteryCyclesPerDay: 2,
    allowGridBatteryCharging: hasBattery && hasGrid,
    allowBatteryExport: hasBattery && hasGrid,
    allowAutomaticEvCharging: hasEv,
    evReadyBy: "07:00",
    evTargetSocPercent: 85,
  };
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
      connectionStatus: "online",
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

function summarizeControlLoopResult(result: Awaited<ReturnType<TeslaSingleRunRuntime["runCycle"]>>): TeslaLocalSingleRunControlLoopSummary {
  return {
    activeDecisionCount: result.controlLoopResult.activeDecisions.length,
    commandCount: result.controlLoopResult.commandsToIssue.length,
    skippedDecisionCount: result.controlLoopResult.skippedDecisions.length,
    replanRequired: result.controlLoopResult.replanRequired,
    reasons: result.controlLoopResult.reasons,
  };
}

function normalizeError(error: unknown): TeslaLocalSingleRunErrorSummary["error"] {
  if (error instanceof TeslaSingleRunBootstrapError) {
    return {
      stage: "bootstrap",
      name: error.name,
      message: error.message,
      code: error.code,
    };
  }

  if (error instanceof Error) {
    return {
      stage: "runtime",
      name: error.name,
      message: error.message,
    };
  }

  return {
    stage: "runtime",
    name: "UnknownError",
    message: "Unknown runtime error",
  };
}

export async function runTeslaSingleRunLocal(
  source: TeslaLocalSingleRunSource,
  dependencies?: TeslaLocalSingleRunDependencies,
): Promise<TeslaLocalSingleRunSummary> {
  const bootstrapFromSource = dependencies?.bootstrapFromSource ?? bootstrapTeslaSingleRunRuntimeFromSource;
  const getSnapshot = dependencies?.getSnapshot ?? getCanonicalSimulationSnapshot;
  const optimizeInput = dependencies?.optimizeInput ?? optimize;
  const resolveTariffSchedule = dependencies?.resolveTariffSchedule ?? resolveRuntimeTariffSchedule;
  const optimizationMode = resolveOptimizationMode(source.GRIDLY_OPTIMIZATION_MODE);

  try {
    const now = parseNow(source.GRIDLY_NOW_ISO);
    const runtime = bootstrapFromSource({
      TESLA_ACCESS_TOKEN: source.TESLA_ACCESS_TOKEN,
      TESLA_VEHICLE_ID: source.TESLA_VEHICLE_ID,
      TESLA_BASE_URL: source.TESLA_BASE_URL,
      TESLA_TIMEOUT_MS: source.TESLA_TIMEOUT_MS,
    });

    const nowIso = now.toISOString();
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
    const optimizerOutput = optimizeInput({
      systemState,
      forecasts: snapshot.forecasts,
      tariffSchedule: tariffResolution.tariffSchedule,
      constraints: buildConstraints(systemState.devices, optimizationMode.activeMode),
    });

    const valueLedger = buildCanonicalValueLedger({
      optimizationMode: optimizationMode.activeMode,
      optimizerOutput,
      forecasts: snapshot.forecasts,
      tariffSchedule: tariffResolution.tariffSchedule,
    });

    const journalStore = new InMemoryExecutionJournalStore();

    const result = await runtime.runCycle({
      now: nowIso,
      siteId: systemState.siteId,
      timezone: systemState.timezone,
      devices: systemState.devices,
      optimizerOutput,
      journalStore,
      cycleFinancialContext: {
        optimizationMode: optimizationMode.activeMode,
        valueLedger,
        planningInputCoverage: optimizerOutput.planningInputCoverage,
        planningConfidenceLevel: optimizerOutput.planningConfidenceLevel,
        conservativeAdjustmentApplied: optimizerOutput.conservativeAdjustmentApplied,
        conservativeAdjustmentReason: optimizerOutput.conservativeAdjustmentReason,
        planningAssumptions: optimizerOutput.assumptions,
        planningWarnings: optimizerOutput.warnings,
      },
    });

    return {
      status: "ok",
      now: nowIso,
      optimizationMode,
      config: {
        vehicleId: runtime.config.vehicleId,
        baseUrl: runtime.config.baseUrl,
        timeoutMs: runtime.config.timeoutMs,
      },
      optimizerResultSummary: {
        status: optimizerOutput.status,
        headline: optimizerOutput.headline,
        diagnostics: optimizerOutput.diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          severity: diagnostic.severity,
        })),
      },
      tariffForecastSummary: {
        source: tariffResolution.source,
        importRateCount: tariffResolution.tariffSchedule.importRates.length,
        exportRateCount: tariffResolution.tariffSchedule.exportRates?.length ?? 0,
        caveats: tariffResolution.caveats,
      },
      valueLedger,
      telemetryIngestionResult: {
        ingestedCount: result.telemetryIngestionResult.ingestedCount,
        acceptedCount: result.telemetryIngestionResult.acceptedCount,
        ignoredStaleCount: result.telemetryIngestionResult.ignoredStaleCount,
        ignoredDuplicateCount: result.telemetryIngestionResult.ignoredDuplicateCount,
        rejectedInvalidCount: result.telemetryIngestionResult.rejectedInvalidCount,
      },
      controlLoopResultSummary: summarizeControlLoopResult(result),
      executionSummary: result.executionSummary,
      executionJournalEntries: journalStore.getAll(),
    };
  } catch (error) {
    return {
      status: "error",
      now: new Date().toISOString(),
      optimizationMode,
      error: normalizeError(error),
    };
  }
}

export async function runTeslaSingleRunLocalCli(source: TeslaLocalSingleRunSource = process.env): Promise<number> {
  const summary = await runTeslaSingleRunLocal(source);

  if (summary.status === "ok") {
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }

  console.error(JSON.stringify(summary, null, 2));
  return 1;
}
