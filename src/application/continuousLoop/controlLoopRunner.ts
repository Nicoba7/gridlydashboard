import type {
  CycleContext,
  CycleSummary,
  CycleExecutor,
  ContinuousLoopConfig,
  ContinuousLoopState,
  LoopTickInput,
  LoopTickResult,
  ReplanTrigger,
} from "./controlLoopRunnerTypes";
import { RealIntervalScheduler, type IntervalScheduler } from "./intervalScheduler";
import type { OptimizerOutput } from "../../domain/optimizer";
import { evaluatePlanFreshness } from "./planFreshnessEvaluator";
import { evaluatePlanStateDrift } from "./planStateDriftDetector";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1_000;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 5;
const DEFAULT_FRESHNESS_THRESHOLD_SECONDS = 1800;
const DEFAULT_STALE_PLAN_MAX_CYCLES = 3;
const DEFAULT_SOC_DRIFT_THRESHOLD_PERCENT = 15;

/**
 * Derives a stable, URL-safe cycle identifier from the site ID and the
 * cycle's wall-clock timestamp. The same inputs always produce the same ID.
 *
 * Example: "cycle-site-1-20260316T100500Z"
 */
function toCycleId(siteId: string, nowIso: string): string {
  const compacted = nowIso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `cycle-${siteId}-${compacted}`;
}

function normalizeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "UnknownError", message: String(error) };
}

const TRIGGER_PRIORITY: ReplanTrigger[] = [
  "no_plan",
  "expired_plan",
  "command_outcome_failure",
  "soc_drift",
  "charging_state_mismatch",
  "stale_plan",
  "executor_requested",
];

function selectPrimaryTrigger(triggers: ReplanTrigger[]): ReplanTrigger | undefined {
  for (const t of TRIGGER_PRIORITY) {
    if (triggers.includes(t)) return t;
  }
  return undefined;
}

/**
 * Executes a single tick of the continuous control loop.
 *
 * This is the testable, pure core of the loop. It can be called directly in
 * tests without any timer infrastructure or class lifecycle, making the
 * scheduling concerns and the cycle logic independently verifiable.
 *
 * Responsibilities:
 * 1. Evaluates plan freshness and state drift from the previous cycle.
 * 2. If any replan triggers fire, calls executor.buildPlan(); falls back to the
 *    existing plan if buildPlan throws.
 * 3. Builds a deterministic CycleContext with all freshness/drift metadata.
 * 4. Calls executor.execute(), wrapping any thrown exception defensively.
 * 5. Returns updated state (including stalePlanCycleCount, planGeneratedAt, etc.)
 *    and the stop signal.
 */
export async function runContinuousLoopTick(
  input: LoopTickInput,
  executor: CycleExecutor,
): Promise<LoopTickResult> {
  const { currentState, siteId, nowIso, maxConsecutiveFailures } = input;

  const freshnessThreshold =
    input.planFreshnessThresholdSeconds ?? DEFAULT_FRESHNESS_THRESHOLD_SECONDS;
  const stalePlanMaxCycles = input.stalePlanMaxCycles ?? DEFAULT_STALE_PLAN_MAX_CYCLES;
  const socDriftThreshold =
    input.socDriftThresholdPercent ?? DEFAULT_SOC_DRIFT_THRESHOLD_PERCENT;
  const currentStaleCycleCount = currentState.stalePlanCycleCount ?? 0;

  // ── 1. Evaluate plan freshness ─────────────────────────────────────────────
  const freshnessEval = evaluatePlanFreshness(
    currentState.planGeneratedAt,
    nowIso,
    freshnessThreshold,
  );

  // ── 2. Evaluate state drift from the previous cycle ──────────────────────
  const lastSummary = currentState.lastCycleSummary;
  const driftEval = evaluatePlanStateDrift({
    nowIso,
    plan: input.currentPlan,
    observedBatterySocPercent: lastSummary?.observedBatterySocPercent,
    observedChargingState: lastSummary?.observedChargingState,
    lastCommandFailed: (lastSummary?.failedCommandCount ?? 0) > 0,
    socDriftThresholdPercent: socDriftThreshold,
  });

  // ── 3. Collect all replan triggers ────────────────────────────────────────
  const executorRequested = lastSummary?.replanRequired === true;
  const allTriggers: ReplanTrigger[] = [];
  if (freshnessEval.replanTrigger) allTriggers.push(freshnessEval.replanTrigger);
  allTriggers.push(...driftEval.driftTriggers);
  if (executorRequested) allTriggers.push("executor_requested");

  const shouldReplan = allTriggers.length > 0;
  const primaryTrigger = selectPrimaryTrigger(allTriggers);

  const allReasons: string[] = [];
  if (freshnessEval.replanReason) allReasons.push(freshnessEval.replanReason);
  if (driftEval.replanReason) allReasons.push(driftEval.replanReason);
  const combinedReason = allReasons.length > 0 ? allReasons.join(" ") : undefined;

  // ── 4. Attempt replan if any triggers fired ────────────────────────────────
  let planForCycle: OptimizerOutput = input.currentPlan;
  let replanSucceeded = false;

  if (shouldReplan) {
    try {
      planForCycle = await executor.buildPlan(nowIso);
      replanSucceeded = true;
    } catch (_error) {
      // Keep the existing plan — one failed reoptimise must not abort the cycle
    }
  }

  // ── 5. Compute updated stale-cycle count ──────────────────────────────────
  // Increments only when a replan was NEEDED but FAILED; resets to 0 on success.
  const stalePlanCycleCount = replanSucceeded
    ? 0
    : currentStaleCycleCount + (shouldReplan ? 1 : 0);

  // ── 6. Re-evaluate freshness for the active (possibly new) plan ───────────
  // When replan succeeded use the new plan's generatedAt; otherwise the state
  // holds the authoritative timestamp of the last successfully-built plan.
  const activePlanGeneratedAt = replanSucceeded
    ? planForCycle.generatedAt
    : currentState.planGeneratedAt;
  const activeFreshness = evaluatePlanFreshness(
    activePlanGeneratedAt,
    nowIso,
    freshnessThreshold,
  );

  // ── 7. Compute safe-hold mode ─────────────────────────────────────────────
  const safeHoldMode = stalePlanCycleCount >= stalePlanMaxCycles;
  const stalePlanWarning = safeHoldMode
    ? `Safe-hold mode active: plan has been reused without successful refresh for ${stalePlanCycleCount} consecutive cycles. Execution conservatism enforced.`
    : undefined;

  // ── 8. Build CycleContext ─────────────────────────────────────────────────
  const cycleId = toCycleId(siteId, nowIso);
  const ctx: CycleContext = {
    cycleId,
    nowIso,
    currentPlan: planForCycle,
    isReplan: replanSucceeded,
    planAgeSeconds: activeFreshness.planAgeSeconds,
    planFreshnessStatus: activeFreshness.status,
    replanTriggered: replanSucceeded,
    replanTrigger: shouldReplan ? primaryTrigger : undefined,
    replanReason: shouldReplan ? combinedReason : undefined,
    stalePlanReuseCount: stalePlanCycleCount,
    safeHoldMode,
    stalePlanWarning,
  };

  // ── 9. Execute the cycle ──────────────────────────────────────────────────
  let summary: CycleSummary;
  try {
    summary = await executor.execute(ctx);
  } catch (error) {
    // Defensive guard: executor.execute() should never throw by contract
    summary = {
      cycleId,
      nowIso,
      status: "error",
      replanRequired: false,
      issuedCommandCount: 0,
      skippedCommandCount: 0,
      failedCommandCount: 0,
      journalEntriesWritten: 0,
      error: normalizeError(error),
    };
  }

  // ── 10. Build next loop state ─────────────────────────────────────────────
  const consecutiveFailures =
    summary.status === "error" ? currentState.consecutiveFailures + 1 : 0;
  const shouldStop = consecutiveFailures >= maxConsecutiveFailures;
  const stoppedReason = shouldStop
    ? `Loop stopped after ${consecutiveFailures} consecutive cycle failures.`
    : undefined;

  const planGeneratedAt = replanSucceeded
    ? planForCycle.generatedAt
    : currentState.planGeneratedAt;
  const lastSuccessfulPlanAt = replanSucceeded
    ? nowIso
    : currentState.lastSuccessfulPlanAt;

  const nextState: ContinuousLoopState = {
    status: shouldStop ? "stopped" : "running",
    cycleCount: currentState.cycleCount + 1,
    consecutiveFailures,
    lastCycleAt: nowIso,
    lastCycleSummary: summary,
    stoppedReason,
    planGeneratedAt,
    lastSuccessfulPlanAt,
    stalePlanCycleCount,
    planFreshnessStatus: activeFreshness.status,
  };

  return { nextState, nextPlan: planForCycle, summary, shouldStop, stoppedReason };
}

/**
 * Continuous control loop runner.
 *
 * Repeatedly fires the observe → optimise → dispatch cycle at a configurable
 * interval. Hardware-agnostic: all hardware interaction is delegated to the
 * injected CycleExecutor.
 *
 * Lifecycle:
 *   1. start()  — builds initial plan, runs first cycle immediately, then
 *                 schedules repeating cycles at intervalMs.
 *   2. stop()   — cancels the timer; any in-progress cycle completes normally.
 *
 * Failure handling:
 *   - A single failed cycle increments consecutiveFailures but does not stop
 *     the loop. The loop continues — one bad cycle never kills continuous ops.
 *   - If consecutiveFailures reaches maxConsecutiveFailures the loop self-stops
 *     and records a stoppedReason in state.
 *
 * Re-planning:
 *   - Evaluates freshness and state drift on every cycle. If either signals a
 *     stale/drifted plan, calls executor.buildPlan() before executing. If
 *     buildPlan throws, the stale plan is retained and the cycle still executes.
 *   - After stalePlanMaxCycles consecutive failed replan attempts, safeHoldMode
 *     is set on the CycleContext so executors can apply conservative behaviour.
 *
 * Testability:
 *   - Inject ManualIntervalScheduler to trigger cycles synchronously in tests.
 *   - Inject nowFn to control the perceived wall-clock time per cycle.
 *   - Call runContinuousLoopTick() directly to test cycle logic in isolation.
 */
export class ContinuousControlLoopRunner {
  private readonly config: Required<ContinuousLoopConfig>;
  private readonly executor: CycleExecutor;
  private readonly scheduler: IntervalScheduler;
  private readonly nowFn: () => Date;

  private state: ContinuousLoopState = {
    status: "idle",
    cycleCount: 0,
    consecutiveFailures: 0,
  };

  private currentPlan: OptimizerOutput | null = null;

  constructor(
    config: ContinuousLoopConfig,
    executor: CycleExecutor,
    options?: {
      scheduler?: IntervalScheduler;
      nowFn?: () => Date;
    },
  ) {
    this.config = {
      siteId: config.siteId,
      intervalMs: config.intervalMs ?? DEFAULT_INTERVAL_MS,
      maxConsecutiveFailures:
        config.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES,
      planFreshnessThresholdSeconds:
        config.planFreshnessThresholdSeconds ?? DEFAULT_FRESHNESS_THRESHOLD_SECONDS,
      stalePlanMaxCycles: config.stalePlanMaxCycles ?? DEFAULT_STALE_PLAN_MAX_CYCLES,
      socDriftThresholdPercent:
        config.socDriftThresholdPercent ?? DEFAULT_SOC_DRIFT_THRESHOLD_PERCENT,
    };
    this.executor = executor;
    this.scheduler = options?.scheduler ?? new RealIntervalScheduler();
    this.nowFn = options?.nowFn ?? (() => new Date());
  }

  /** Returns a shallow copy of the current loop state. */
  getState(): Readonly<ContinuousLoopState> {
    return { ...this.state };
  }

  /**
   * Start the continuous loop.
   *
   * Builds the initial plan, fires the first cycle immediately (so there is
   * no dead interval on startup), then schedules repeating cycles.
   *
   * No-ops if the loop is already running.
   */
  async start(): Promise<void> {
    if (this.state.status === "running") {
      return;
    }

    this.state = { ...this.state, status: "running" };

    const nowIso = this.nowFn().toISOString();
    this.currentPlan = await this.executor.buildPlan(nowIso);

    // Record freshness metadata for the initial plan before the first cycle
    this.state = {
      ...this.state,
      planGeneratedAt: this.currentPlan.generatedAt,
      lastSuccessfulPlanAt: nowIso,
      stalePlanCycleCount: 0,
    };

    // First cycle fires immediately — no waiting for the first interval
    await this.fireCycle();

    if (this.state.status === "running") {
      this.scheduler.schedule(this.config.intervalMs, () => this.fireCycle());
    }
  }

  /** Stop the loop. Any in-progress cycle is allowed to complete. */
  stop(): void {
    this.scheduler.cancel();
    this.state = { ...this.state, status: "stopped" };
  }

  private async fireCycle(): Promise<void> {
    if (this.state.status !== "running") {
      return;
    }

    const nowIso = this.nowFn().toISOString();

    const result = await runContinuousLoopTick(
      {
        currentState: this.state,
        currentPlan: this.currentPlan!,
        siteId: this.config.siteId,
        nowIso,
        maxConsecutiveFailures: this.config.maxConsecutiveFailures,
        planFreshnessThresholdSeconds: this.config.planFreshnessThresholdSeconds,
        stalePlanMaxCycles: this.config.stalePlanMaxCycles,
        socDriftThresholdPercent: this.config.socDriftThresholdPercent,
      },
      this.executor,
    );

    this.state = result.nextState;
    this.currentPlan = result.nextPlan;

    if (result.shouldStop) {
      this.scheduler.cancel();
    }
  }
}
