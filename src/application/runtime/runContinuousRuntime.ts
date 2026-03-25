import type { CycleExecutor, ContinuousLoopConfig, ContinuousLoopState } from "../continuousLoop/controlLoopRunnerTypes";
import { ContinuousControlLoopRunner } from "../continuousLoop/controlLoopRunner";
import type { IntervalScheduler } from "../continuousLoop/intervalScheduler";
import { FileExecutionJournalStore } from "../../journal/fileExecutionJournalStore";
import type { ExecutionJournalStore } from "../../journal/executionJournalStore";
import type { RuntimeExecutionMode } from "../controlLoopExecution/executionPolicyTypes";
import { resolveJournalDirectoryPath } from "../../journal/journalDirectory";

export interface AveumContinuousRuntimeSource {
  GRIDLY_SITE_ID?: string;
  GRIDLY_CONTINUOUS_INTERVAL_MS?: string;
  GRIDLY_CONTINUOUS_MAX_CONSECUTIVE_FAILURES?: string;
  GRIDLY_CONTINUOUS_FRESHNESS_THRESHOLD_SECONDS?: string;
  GRIDLY_CONTINUOUS_STALE_PLAN_MAX_CYCLES?: string;
  GRIDLY_CONTINUOUS_SOC_DRIFT_THRESHOLD_PERCENT?: string;
  GRIDLY_CONTINUOUS_MAX_CYCLES?: string;
  GRIDLY_JOURNAL_DIR?: string;
}

export interface PreparedContinuousRuntimeIntegration {
  cycleExecutor: CycleExecutor;
  loopConfig?: Partial<ContinuousLoopConfig>;
}

export interface ContinuousRuntimeIntegration<TSource extends AveumContinuousRuntimeSource, TDependencies = unknown> {
  prepare(input: {
    source: TSource;
    journalStore: ExecutionJournalStore;
    runtimeExecutionMode: RuntimeExecutionMode;
    dependencies?: TDependencies;
  }): Promise<PreparedContinuousRuntimeIntegration>;
}

export interface ContinuousRuntimeLauncherDependencies {
  journalStore?: ExecutionJournalStore;
  scheduler?: IntervalScheduler;
  nowFn?: () => Date;
}

export interface RunContinuousRuntimeParams<
  TSource extends AveumContinuousRuntimeSource,
  TIntegrationDependencies = unknown,
> {
  source: TSource;
  integration: ContinuousRuntimeIntegration<TSource, TIntegrationDependencies>;
  integrationDependencies?: TIntegrationDependencies;
  launcherDependencies?: ContinuousRuntimeLauncherDependencies;
}

export interface ContinuousRuntimeHandle {
  start(): Promise<void>;
  stop(): void;
  getState(): Readonly<ContinuousLoopState>;
  journalStore: ExecutionJournalStore;
}

function parsePositiveInteger(raw: string | undefined): number | undefined {
  if (!raw || raw.trim() === "") {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

function resolveLoopConfig(source: AveumContinuousRuntimeSource): ContinuousLoopConfig {
  return {
    siteId: source.GRIDLY_SITE_ID?.trim() || "site-1",
    intervalMs: parsePositiveInteger(source.GRIDLY_CONTINUOUS_INTERVAL_MS),
    maxConsecutiveFailures: parsePositiveInteger(source.GRIDLY_CONTINUOUS_MAX_CONSECUTIVE_FAILURES),
    planFreshnessThresholdSeconds: parsePositiveInteger(source.GRIDLY_CONTINUOUS_FRESHNESS_THRESHOLD_SECONDS),
    stalePlanMaxCycles: parsePositiveInteger(source.GRIDLY_CONTINUOUS_STALE_PLAN_MAX_CYCLES),
    socDriftThresholdPercent: parsePositiveInteger(source.GRIDLY_CONTINUOUS_SOC_DRIFT_THRESHOLD_PERCENT),
  };
}

export function resolveContinuousRuntimeJournalDirectory(
  source: AveumContinuousRuntimeSource = process.env,
  options?: { cwd?: string },
): string {
  return resolveJournalDirectoryPath(source, options);
}

function buildDefaultJournalStore(source: AveumContinuousRuntimeSource): ExecutionJournalStore {
  const directoryPath = resolveContinuousRuntimeJournalDirectory(source);
  return new FileExecutionJournalStore({ directoryPath });
}

export async function runContinuousRuntime<
  TSource extends AveumContinuousRuntimeSource,
  TIntegrationDependencies = unknown,
>(
  params: RunContinuousRuntimeParams<TSource, TIntegrationDependencies>,
): Promise<ContinuousRuntimeHandle> {
  const { source, integration, integrationDependencies, launcherDependencies } = params;
  const runtimeExecutionMode: RuntimeExecutionMode = "continuous_live_strict";
  const journalStore = launcherDependencies?.journalStore ?? buildDefaultJournalStore(source);

  const preparedIntegration = await integration.prepare({
    source,
    journalStore,
    runtimeExecutionMode,
    dependencies: integrationDependencies,
  });

  const loopConfig = {
    ...resolveLoopConfig(source),
    ...(preparedIntegration.loopConfig ?? {}),
  };

  const runner = new ContinuousControlLoopRunner(
    loopConfig,
    preparedIntegration.cycleExecutor,
    {
      scheduler: launcherDependencies?.scheduler,
      nowFn: launcherDependencies?.nowFn,
    },
  );

  const maxCycles = parsePositiveInteger(source.GRIDLY_CONTINUOUS_MAX_CYCLES);

  return {
    journalStore,
    async start(): Promise<void> {
      await runner.start();

      if (!maxCycles) {
        return;
      }

      while (runner.getState().status === "running" && runner.getState().cycleCount < maxCycles) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      if (runner.getState().status === "running" && runner.getState().cycleCount >= maxCycles) {
        runner.stop();
      }
    },
    stop(): void {
      runner.stop();
    },
    getState(): Readonly<ContinuousLoopState> {
      return runner.getState();
    },
  };
}