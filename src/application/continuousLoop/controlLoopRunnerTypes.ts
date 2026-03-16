import type { OptimizerOutput } from "../../domain/optimizer";
export type PlanFreshnessStatus = "fresh" | "stale" | "expired" | "absent";

/**
 * Canonical reason code explaining why a replan was triggered.
 * Multiple triggers may apply in the same cycle; the most critical is
 * recorded as the primary trigger, all are surfaced in the replan reason string.
 */
export type ReplanTrigger =
  | "no_plan"
  | "stale_plan"
  | "expired_plan"
  | "soc_drift"
  | "charging_state_mismatch"
  | "command_outcome_failure"
  | "executor_requested";


/**
 * Context injected into each individual cycle execution.
 * All fields are derived from injected runtime state, never from wall-clock
 * calls inside the cycle — preserving deterministic replay semantics.
 */
export interface CycleContext {
  /** Stable identifier for this cycle, derived from siteId + nowIso. */
  cycleId: string;
  /** ISO-8601 timestamp captured at the start of this cycle. */
  nowIso: string;
  /** The active optimizer plan this cycle should execute against. */
  currentPlan: OptimizerOutput;
  /** True when this cycle is executing a freshly-built (re-)plan. */
  isReplan: boolean;
  /** How old the current plan is in seconds at cycle start. */
  planAgeSeconds: number;
  /** A derived freshness bucket for the current plan. */
  planFreshnessStatus: PlanFreshnessStatus;
  /** Whether a replan was attempted (and succeeded) at the start of this cycle. */
  replanTriggered: boolean;
  /** Primary trigger that caused the replan (undefined when not replanned). */
  replanTrigger?: ReplanTrigger;
  /** Human-readable explanation for the replan (journalled by the executor). */
  replanReason?: string;
  /** How many consecutive cycles have reused a stale/expired plan. */
  stalePlanReuseCount: number;
  /**
   * True when stalePlanReuseCount ≥ stalePlanMaxCycles.
   * Executors SHOULD treat this as a signal to apply conservative / no-op
   * behavior and persist the accompanying warning in the execution journal.
   */
  safeHoldMode: boolean;
  /** Human-readable warning when safeHoldMode is active. */
  stalePlanWarning?: string;
}

/** Summary of one completed cycle, returned by the executor. */
export interface CycleSummary {
  cycleId: string;
  nowIso: string;
  status: "ok" | "error";
  /** Whether the executor signals that the plan must be rebuilt next cycle. */
  replanRequired: boolean;
  issuedCommandCount: number;
  skippedCommandCount: number;
  failedCommandCount: number;
  /** Number of journal entries written during this cycle. */
  journalEntriesWritten: number;
  error?: { name: string; message: string };
  /** Age of the plan that was in effect when this cycle executed, in seconds. */
  planAgeSeconds?: number;
  /** Freshness status of the plan at cycle start. */
  planFreshnessStatus?: PlanFreshnessStatus;
  /** Whether a replan fired at the start of this cycle. */
  replanTriggered?: boolean;
  /** Primary trigger reason for the replan, if one occurred. */
  replanTrigger?: ReplanTrigger;
  /** Human-readable replan reason (for journal persistence). */
  replanReason?: string;
  /** How many consecutive cycles reused a stale plan (including this one if no replan). */
  stalePlanReuseCount?: number;
  /** Observed battery SoC reported by the executor during this cycle. */
  observedBatterySocPercent?: number;
  /** Observed charging state reported by the executor during this cycle. */
  observedChargingState?: "charging" | "discharging" | "idle" | "unknown";
  /** Whether state-drift was detected that triggered or would have triggered a replan. */
  driftDetected?: boolean;
  /** Which drift signals were active. */
  driftTriggers?: ReplanTrigger[];
}

/**
 * Hardware-agnostic seam between the continuous runner and the concrete
 * observe → plan → dispatch pipeline.
 *
 * Implement this interface to plug in any hardware backend (Tesla, GivEnergy,
 * simulated, etc.) without modifying the loop runner.
 */
export interface CycleExecutor {
  /**
   * Execute one observe → dispatch cycle with the supplied context.
   *
   * MUST NOT throw — return { status: "error" } for all failures so that
   * the runner can track consecutive failures without crashing.
   */
  execute(ctx: CycleContext): Promise<CycleSummary>;

  /**
   * Build (or re-build) an optimizer plan for the given wall-clock time.
   *
   * Called once on loop start and whenever a cycle signals replanRequired.
   * May throw; the runner will catch and fall back to the previous plan.
   */
  buildPlan(nowIso: string): Promise<OptimizerOutput>;
}

/** Configuration for a ContinuousControlLoopRunner instance. */
export interface ContinuousLoopConfig {
  siteId: string;
  /** Milliseconds between cycles. Defaults to 300_000 (5 minutes). */
  intervalMs?: number;
  /** Maximum consecutive failed cycles before the loop self-stops. Defaults to 5. */
  maxConsecutiveFailures?: number;
  /**
   * Seconds after which the current plan is considered stale and a replan is
   * attempted. Defaults to 1_800 (30 minutes).
   */
  planFreshnessThresholdSeconds?: number;
  /**
   * Number of consecutive cycles that may reuse a stale/expired plan before
   * safeHoldMode is enabled. Defaults to 3.
   */
  stalePlanMaxCycles?: number;
  /**
   * Battery SoC deviation (percentage points) that constitutes material drift
   * from the plan's expected SoC. Defaults to 15.
   */
  socDriftThresholdPercent?: number;
}

/** Observable state of a running (or stopped) loop. */
export interface ContinuousLoopState {
  status: "idle" | "running" | "stopped";
  cycleCount: number;
  consecutiveFailures: number;
  lastCycleAt?: string;
  lastCycleSummary?: CycleSummary;
  /** Set when the loop auto-stopped due to too many consecutive failures. */
  stoppedReason?: string;
  /** Timestamp from the generatedAt field of the currently-active plan. */
  planGeneratedAt?: string;
  /** Wall-clock time of the last successful plan build. */
  lastSuccessfulPlanAt?: string;
  /** Number of consecutive cycles that have reused an expired or stale plan. */
  stalePlanCycleCount?: number;
  /** Freshness status of the plan at the most recently completed cycle. */
  planFreshnessStatus?: PlanFreshnessStatus;
}

// ── Internal tick contract (used by runContinuousLoopTick) ──

/** Input to the pure single-tick function. */
export interface LoopTickInput {
  currentState: ContinuousLoopState;
  currentPlan: OptimizerOutput;
  siteId: string;
  nowIso: string;
  maxConsecutiveFailures: number;
  /** Seconds after which the plan is considered stale. Defaults to 1_800. */
  planFreshnessThresholdSeconds?: number;
  /** Consecutive stale-reuse cycles before safeHoldMode is engaged. Defaults to 3. */
  stalePlanMaxCycles?: number;
  /** SoC deviation threshold for drift detection. Defaults to 15. */
  socDriftThresholdPercent?: number;
}

/** Output of the pure single-tick function. */
export interface LoopTickResult {
  nextState: ContinuousLoopState;
  /** The plan used by this tick (may be a freshly-built plan if replan fired). */
  nextPlan: OptimizerOutput;
  summary: CycleSummary;
  /** True when the runner should cancel the timer and stop accepting new cycles. */
  shouldStop: boolean;
  stoppedReason?: string;
}
