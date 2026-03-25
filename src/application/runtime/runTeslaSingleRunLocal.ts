import type { DeviceState, OptimizationMode, OptimizerInput, PlanningStyle, SystemState } from "../../domain";
import type { CanonicalValueLedger } from "../../domain/valueLedger";
import type { OptimizerOutput } from "../../domain/optimizer";
import { optimize } from "../../optimizer/engine";
import { getCanonicalSimulationSnapshot } from "../../simulator";
import { InMemoryExecutionJournalStore } from "../../journal/executionJournalStore";
import { FileExecutionJournalStore } from "../../journal/fileExecutionJournalStore";
import type { ExecutionJournalEntry } from "../../journal/executionJournal";
import { resolveJournalDirectoryPath } from "../../journal/journalDirectory";
import { buildCanonicalValueLedger } from "./buildCanonicalValueLedger";
import {
  resolveRuntimeTariffSchedule,
  type RuntimeTariffResolution,
} from "./resolveRuntimeTariffSchedule";
import {
  resolveRuntimeSolarForecast,
  type RuntimeSolarForecastResolution,
} from "./resolveRuntimeSolarForecast";
import {
  TeslaSingleRunBootstrapError,
  type TeslaSingleRunRuntime,
  type TeslaSingleRunRuntimeConfigSource,
  bootstrapTeslaSingleRunRuntimeFromSource,
} from "./teslaSingleRunBootstrap";
import {
  buildConstraintsForPlanningStyle,
  resolvePlanningStyle,
  type PlanningStyleSourceEnvironment,
  type ResolvedPlanningStyle,
} from "./planningStyleStore";
import {
  buildDailySavingsReport,
  type DailySavingsReport,
} from "../../features/report/dailySavingsReport";

export interface TeslaLocalSingleRunSource extends TeslaSingleRunRuntimeConfigSource {
  GRIDLY_NOW_ISO?: string;
  GRIDLY_SITE_ID?: string;
  GRIDLY_TIMEZONE?: string;
  GRIDLY_PLANNING_STYLE?: string;
  GRIDLY_OPTIMIZATION_MODE?: string;
  GRIDLY_CONFIG_DIR?: string;
  GRIDLY_JOURNAL_DIR?: string;
  GRIDLY_TARIFF_SOURCE?: string;
  GRIDLY_OCTOPUS_REGION?: string;
  GRIDLY_OCTOPUS_PRODUCT?: string;
  GRIDLY_OCTOPUS_EXPORT_PRODUCT?: string;
  GRIDLY_OCTOPUS_EXPORT_TARIFF_CODE?: string;
  SOLCAST_API_KEY?: string;
  SOLCAST_RESOURCE_ID?: string;
  /** Set-and-forget baseline net cost in pence for savings comparison. Defaults to 0 when absent. */
  GRIDLY_BASELINE_NET_COST_PENCE?: string;
}

export interface TeslaLocalPlanningStyleSummary {
  requestedStyle?: string;
  activeStyle: PlanningStyle;
  source: ResolvedPlanningStyle["source"];
  defaulted: boolean;
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
  planningStyle: TeslaLocalPlanningStyleSummary;
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
  solarForecastSummary: {
    source: RuntimeSolarForecastResolution["source"];
    slotCount: number;
    caveats: string[];
  };
  dailySavingsReport: DailySavingsReport;
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
    suppressed?: number;
    executionPosture?: "normal" | "conservative" | "hold_only";
  };
  executionJournalEntries: ExecutionJournalEntry[];
}

export interface TeslaLocalSingleRunErrorSummary {
  status: "error";
  now: string;
  planningStyle?: TeslaLocalPlanningStyleSummary;
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
  journalStoreFactory?: (source: TeslaLocalSingleRunSource) => {
    getAll(): ExecutionJournalEntry[];
  } & Pick<InMemoryExecutionJournalStore, "append" | "appendDecisionExplanation" | "appendHeartbeat" | "getDecisionExplanations" | "getCycleHeartbeats" | "getByDecisionId" | "getByDeviceId">;
  resolveTariffSchedule?: (params: {
    now: Date;
    fallbackTariffSchedule: ReturnType<typeof getCanonicalSimulationSnapshot>["tariffSchedule"];
    sourceEnv: TeslaLocalSingleRunSource;
  }) => Promise<RuntimeTariffResolution>;
  resolveSolarForecast?: (params: {
    fallbackSolarForecast: ReturnType<typeof getCanonicalSimulationSnapshot>["forecasts"]["solarGenerationKwh"];
    sourceEnv: TeslaLocalSingleRunSource;
  }) => Promise<RuntimeSolarForecastResolution>;
}

function buildTeslaLocalJournalStore(
  source: TeslaLocalSingleRunSource,
  dependencies?: TeslaLocalSingleRunDependencies,
) {
  if (dependencies?.journalStoreFactory) {
    return dependencies.journalStoreFactory(source);
  }

  if (!dependencies) {
    return new FileExecutionJournalStore({
      directoryPath: resolveJournalDirectoryPath(source),
    });
  }

  return new InMemoryExecutionJournalStore();
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

function buildOptimizationModeSummary(
  resolvedPlanningStyle: ResolvedPlanningStyle,
  source: TeslaLocalSingleRunSource,
): TeslaLocalOptimizationModeSummary {
  return {
    requestedMode: source.GRIDLY_OPTIMIZATION_MODE?.trim() || undefined,
    activeMode: resolvedPlanningStyle.profile.optimizationMode,
    defaulted:
      Boolean(source.GRIDLY_OPTIMIZATION_MODE?.trim()) && resolvedPlanningStyle.source !== "legacy_mode"
        ? true
        : resolvedPlanningStyle.source === "default",
  };
}

function buildPlanningStyleSummary(resolvedPlanningStyle: ResolvedPlanningStyle): TeslaLocalPlanningStyleSummary {
  return {
    requestedStyle: resolvedPlanningStyle.requestedValue,
    activeStyle: resolvedPlanningStyle.activeStyle,
    source: resolvedPlanningStyle.source,
    defaulted: resolvedPlanningStyle.defaulted,
  };
}

function ensureTeslaDeviceIdentity(systemState: SystemState, vehicleId: string, nowIso: string): SystemState {
  let hasMappedTeslaDevice = false;
  const teslaCapabilities: DeviceState["capabilities"] = ["start_stop", "read_soc", "read_power"];

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
      capabilities: Array.from(new Set<DeviceState["capabilities"][number]>([
        ...(device.capabilities ?? []),
        ...teslaCapabilities,
      ])),
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
        connectionStatus: "online" as const,
        lastUpdatedAt: nowIso,
        capabilities: teslaCapabilities,
        connected: true,
      },
    ],
  };
}

function summarizeControlLoopResult(
  result: Awaited<ReturnType<TeslaSingleRunRuntime["runCycle"]>>,
): TeslaLocalSingleRunControlLoopSummary {
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
  const resolveSolarForecast = dependencies?.resolveSolarForecast ??
    (async (params: { fallbackSolarForecast: Parameters<typeof resolveRuntimeSolarForecast>[0]["fallbackSolarForecast"]; sourceEnv: TeslaLocalSingleRunSource }) =>
      resolveRuntimeSolarForecast({ fallbackSolarForecast: params.fallbackSolarForecast, sourceEnv: params.sourceEnv }));
  const resolvedPlanningStyle = resolvePlanningStyle(source as PlanningStyleSourceEnvironment);
  const planningStyle = buildPlanningStyleSummary(resolvedPlanningStyle);
  const optimizationMode = buildOptimizationModeSummary(resolvedPlanningStyle, source);

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
    const [tariffResolution, solarResolution] = await Promise.all([
      resolveTariffSchedule({
        now,
        fallbackTariffSchedule: snapshot.tariffSchedule,
        sourceEnv: source,
      }),
      resolveSolarForecast({
        fallbackSolarForecast: snapshot.forecasts.solarGenerationKwh,
        sourceEnv: source,
      }),
    ]);
    const baseSystemState = {
      ...snapshot.systemState,
      capturedAt: nowIso,
      siteId: source.GRIDLY_SITE_ID?.trim() || snapshot.systemState.siteId,
      timezone: source.GRIDLY_TIMEZONE?.trim() || snapshot.systemState.timezone,
    };

    const systemState = ensureTeslaDeviceIdentity(baseSystemState, runtime.config.vehicleId, nowIso);
    const constraints = buildConstraintsForPlanningStyle(systemState.devices, resolvedPlanningStyle);
    const resolvedForecasts = {
      ...snapshot.forecasts,
      solarGenerationKwh: solarResolution.solarGenerationKwh,
    };
    const optimizerOutput = optimizeInput({
      systemState,
      forecasts: resolvedForecasts,
      tariffSchedule: tariffResolution.tariffSchedule,
      constraints,
    });

    const valueLedger = buildCanonicalValueLedger({
      optimizationMode: optimizationMode.activeMode,
      optimizerOutput,
      forecasts: resolvedForecasts,
      tariffSchedule: tariffResolution.tariffSchedule,
    });

    const setAndForgetNetCostPence = parseFloat(source.GRIDLY_BASELINE_NET_COST_PENCE ?? "0") || 0;
    const dailySavingsReport = buildDailySavingsReport({
      optimizerOutput,
      tariffSchedule: tariffResolution.tariffSchedule,
      setAndForgetNetCostPence,
    });

    const journalStore = buildTeslaLocalJournalStore(source, dependencies);

    const result = await runtime.runCycle({
      now: nowIso,
      siteId: systemState.siteId,
      timezone: systemState.timezone,
      devices: systemState.devices,
      optimizerOutput,
      journalStore,
      cycleFinancialContext: {
        planningStyle: planningStyle.activeStyle,
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
      planningStyle,
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
      solarForecastSummary: {
        source: solarResolution.source,
        slotCount: solarResolution.solarGenerationKwh.length,
        caveats: solarResolution.caveats,
      },
      dailySavingsReport,
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
      planningStyle,
      optimizationMode,
      error: normalizeError(error),
    };
  }
}

export async function runTeslaSingleRunLocalCli(
  source: TeslaLocalSingleRunSource = process.env as TeslaLocalSingleRunSource,
): Promise<number> {
  const summary = await runTeslaSingleRunLocal(source);

  if (summary.status === "ok") {
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }

  console.error(JSON.stringify(summary, null, 2));
  return 1;
}
