import type { ReplanTrigger } from "./controlLoopRunnerTypes";
import type { OptimizerAction, OptimizerOutput } from "../../domain/optimizer";

export interface StateDriftInput {
  /** ISO-8601 timestamp for the current cycle — used to find the active decision. */
  nowIso: string;
  /** The currently active optimizer plan. */
  plan: OptimizerOutput;
  /** Observed battery SoC at cycle start, from telemetry (previous cycle). */
  observedBatterySocPercent?: number;
  /**
   * Observed charging state from the previous cycle.
   * Supplied by the executor via CycleSummary.observedChargingState.
   */
  observedChargingState?: "charging" | "discharging" | "idle" | "unknown";
  /** True when the previous cycle had at least one failed dispatched command. */
  lastCommandFailed: boolean;
  /** SoC deviation threshold above which drift is declared. */
  socDriftThresholdPercent: number;
}

export interface StateDriftEvaluation {
  driftDetected: boolean;
  driftTriggers: ReplanTrigger[];
  /** Human-readable summary of all drift signals (for journal persistence). */
  replanReason?: string;
  /** Plan's expected SoC for the active slot, when available. */
  expectedSocPercent?: number;
  /** Observed SoC supplied to the evaluation. */
  observedSocPercent?: number;
  /** Absolute SoC deviation when both values were present. */
  socDeviationPercent?: number;
}

/**
 * Maps a canonical optimizer action to the charging state it implies.
 * Returns undefined for actions that don't have a clear charging-state mapping.
 */
function actionToExpectedChargingState(
  action: OptimizerAction,
): "charging" | "discharging" | "idle" | undefined {
  if (action === "charge_battery" || action === "charge_ev") return "charging";
  if (action === "discharge_battery" || action === "export_to_grid") return "discharging";
  if (action === "hold" || action === "consume_solar") return "idle";
  return undefined;
}

/**
 * Find the optimizer decision whose execution window contains nowIso.
 * Uses startAt (inclusive) and endAt (exclusive) per the domain contract.
 */
function findActiveDecision(plan: OptimizerOutput, nowIso: string) {
  return plan.decisions.find((d) => nowIso >= d.startAt && nowIso < d.endAt);
}

/**
 * Pure state-drift evaluator.
 *
 * Examines three classes of drift signal:
 *
 * 1. Command outcome failure — the previous cycle dispatched at least one
 *    command that the executor reports as failed. The plan assumptions may
 *    no longer be valid.
 *
 * 2. SoC drift — the observed battery SoC deviates from the expected SoC
 *    encoded in the active plan decision by more than socDriftThresholdPercent.
 *    This catches cases where the grid/battery behaved unexpectedly (manual
 *    override, hardware fault, DNO curtailment, etc.).
 *
 * 3. Charging-state mismatch — the observed charging state (from the previous
 *    cycle's telemetry) contradicts the expected state implied by the plan's
 *    active action. For example, the plan says "charge_battery" but the device
 *    is observed as "discharging".
 *
 * All three signals are independent — multiple triggers may fire simultaneously.
 * The evaluation is pure and deterministic: the same inputs always produce the
 * same result.
 */
export function evaluatePlanStateDrift(input: StateDriftInput): StateDriftEvaluation {
  const triggers: ReplanTrigger[] = [];
  const reasons: string[] = [];

  // ── 1. Command outcome failure ─────────────────────────────────────────────
  if (input.lastCommandFailed) {
    triggers.push("command_outcome_failure");
    reasons.push(
      "Prior command execution failed; plan assumptions may not have been applied.",
    );
  }

  const activeDecision = findActiveDecision(input.plan, input.nowIso);

  // ── 2. SoC drift ──────────────────────────────────────────────────────────
  const expectedSocPercent = activeDecision?.expectedBatterySocPercent;
  const observedSocPercent = input.observedBatterySocPercent;

  let socDeviationPercent: number | undefined;

  if (expectedSocPercent !== undefined && observedSocPercent !== undefined) {
    socDeviationPercent = Math.abs(observedSocPercent - expectedSocPercent);
    if (socDeviationPercent > input.socDriftThresholdPercent) {
      triggers.push("soc_drift");
      reasons.push(
        `Observed SoC ${observedSocPercent.toFixed(1)}% deviates ${socDeviationPercent.toFixed(1)}pp from` +
          ` plan-expected ${expectedSocPercent.toFixed(1)}% (threshold ${input.socDriftThresholdPercent}pp).`,
      );
    }
  }

  // ── 3. Charging-state mismatch ────────────────────────────────────────────
  if (
    activeDecision &&
    input.observedChargingState &&
    input.observedChargingState !== "unknown"
  ) {
    const expectedChargingState = actionToExpectedChargingState(activeDecision.action);
    if (
      expectedChargingState !== undefined &&
      input.observedChargingState !== expectedChargingState
    ) {
      triggers.push("charging_state_mismatch");
      reasons.push(
        `Observed charging state "${input.observedChargingState}" does not match` +
          ` expected "${expectedChargingState}" for plan action "${activeDecision.action}".`,
      );
    }
  }

  return {
    driftDetected: triggers.length > 0,
    driftTriggers: triggers,
    replanReason: reasons.length > 0 ? reasons.join(" ") : undefined,
    expectedSocPercent,
    observedSocPercent,
    socDeviationPercent,
  };
}
