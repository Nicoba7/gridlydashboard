import type { CanonicalDeviceCommand } from "../application/controlLoopExecution/canonicalCommand";
import type { CommandAcknowledgementStatus } from "../application/controlLoopExecution/projectExecutionOutcome";
import type {
  CommandExecutionStatus,
  ExecutionOpportunityProvenance,
  ExecutionEconomicArbitrationTrace,
  TelemetryCoherenceStatus,
} from "../application/controlLoopExecution/types";
import type { RuntimeExecutionPosture } from "../application/controlLoopExecution/executionPolicyTypes";
import type { PlanFreshnessStatus, ReplanTrigger } from "../application/continuousLoop/controlLoopRunnerTypes";
import type { OptimizationMode, PlanningConfidenceLevel } from "../domain";
import type { PlanningInputCoverage } from "../domain/optimizer";
import type { CanonicalValueLedger } from "../domain/valueLedger";

export interface ExecutionCycleDecisionSummary {
  decisionId: string;
  action: string;
  targetDeviceIds: string[];
  marginalImportAvoidance?: number;
  marginalExportValue?: number;
  grossStoredEnergyValue?: number;
  netStoredEnergyValue?: number;
  batteryDegradationCost?: number;
  effectiveStoredEnergyValue?: number;
  planningConfidenceLevel?: PlanningConfidenceLevel;
  conservativeAdjustmentApplied?: boolean;
  conservativeAdjustmentReason?: string;
  decisionReason?: string;
}

export interface ExecutionCycleFinancialContext {
  optimizationMode: OptimizationMode;
  decisionsTaken: ExecutionCycleDecisionSummary[];
  valueLedger: CanonicalValueLedger;
  planningInputCoverage?: PlanningInputCoverage;
  planningConfidenceLevel?: PlanningConfidenceLevel;
  conservativeAdjustmentApplied?: boolean;
  conservativeAdjustmentReason?: string;
  planningAssumptions?: string[];
  planningWarnings?: string[];
  runtimeExecutionPosture?: RuntimeExecutionPosture;
  runtimeExecutionReasonCodes?: string[];
  runtimeExecutionWarning?: string;
}

/**
 * Canonical cycle-level heartbeat record written once per continuous runtime cycle.
 *
 * Written regardless of whether any commands were issued, skipped, or suppressed.
 * Provides a complete execution audit trail for every cycle of autonomous operation.
 */
export interface CycleHeartbeatEntry {
/**
 * Hardware-agnostic economic execution snapshot for a single continuous cycle.
 *
 * Captures only already-canonical, low-risk fields that are deterministically
 * available in the execution path. No speculative estimates beyond what the
 * optimizer has already committed to.
 */
export interface CycleEconomicSnapshot {
  /** Active optimization objective for this cycle (cost / balanced / carbon / self_consumption). */
  optimizationMode?: OptimizationMode;
  /** Optimizer's confidence in the plan backing this cycle. */
  planningConfidenceLevel?: PlanningConfidenceLevel;
  /** Whether the optimizer applied conservative adjustments to its decisions this cycle. */
  conservativeAdjustmentApplied?: boolean;
  /**
   * True when the active plan contains at least one value-seeking decision
   * (charge_battery / discharge_battery / charge_ev / export_to_grid).
   * False when the plan is purely protective (hold only) or empty.
   */
  hasValueSeekingDecisions: boolean;
  /**
   * True when execution posture was non-normal AND at least one command was
   * suppressed by the runtime guardrail, indicating value-seeking dispatch was
   * intentionally deferred by Gridly's conservatism logic.
   */
  valueSeekingExecutionDeferred: boolean;
  /**
   * Estimated net savings vs hold-current-state baseline for this plan run, in pence.
   * Derived from the canonical value ledger; negative means the plan is expected to
   * cost more than doing nothing (e.g., degradation-heavy discharge scenario).
   */
  estimatedSavingsVsBaselinePence?: number;
  /** Data coverage classification from the optimizer (full / partial / minimal / none). */
  planningInputCoverage?: PlanningInputCoverage;
}

/**
 * Canonical cycle-level heartbeat record written once per continuous runtime cycle.
 *
 * Written regardless of whether any commands were issued, skipped, or suppressed.
 * Provides a complete execution audit trail for every cycle of autonomous operation.
 */
export interface CycleHeartbeatEntry {
  entryKind: "cycle_heartbeat";
  /** Stable identifier for this cycle (from CycleContext.cycleId, if available). */
  cycleId?: string;
  /** ISO-8601 timestamp at which this cycle executed. */
  recordedAt: string;
  /** Canonical posture derived from runtime context for this cycle. */
  executionPosture: RuntimeExecutionPosture;
  /** Freshness bucket of the plan in effect at cycle start. */
  planFreshnessStatus?: PlanFreshnessStatus;
  /** Primary trigger that caused a replan this cycle, if any. */
  replanTrigger?: ReplanTrigger;
  /** Human-readable replan reason, if a replan occurred. */
  replanReason?: string;
  /** Number of consecutive cycles that have reused a stale/expired plan. */
  stalePlanReuseCount?: number;
  /** True when safe-hold mode was active for this cycle. */
  safeHoldMode?: boolean;
  /** Human-readable warning when safe-hold mode is active. */
  stalePlanWarning?: string;
  /** Count of commands that were successfully dispatched (status: issued). */
  commandsIssued: number;
  /** Count of commands that were skipped (reconciliation or policy). */
  commandsSkipped: number;
  /** Count of commands that failed (preflight or executor error). */
  commandsFailed: number;
  /** Count of commands suppressed by runtime guardrail (RUNTIME_ reason codes). */
  commandsSuppressed: number;
  /** True when fail-closed strict mode fired due to missing runtime context. */
  failClosedTriggered: boolean;
  /** Economic execution snapshot for this cycle. Present when cycleFinancialContext was available. */
  economicSnapshot?: CycleEconomicSnapshot;
  schemaVersion: string;
}

/**
 * Canonical historical record of per-request execution outcomes.
 *
 * This is a system-level journal entry, not a vendor transport log.
 */
export interface ExecutionJournalEntry {
  entryId: string;
  cycleId?: string;
  recordedAt: string;
  opportunityId?: string;
  opportunityProvenance?: ExecutionOpportunityProvenance;
  decisionId?: string;
  executionRequestId: string;
  idempotencyKey: string;
  targetDeviceId: string;
  canonicalCommand: CanonicalDeviceCommand;
  status: CommandExecutionStatus;
  executionError?: string;
  acknowledgementStatus?: CommandAcknowledgementStatus;
  reasonCodes?: string[];
  stage?: "preflight_validation" | "reconciliation" | "dispatch";
  /**
   * Quality of device telemetry evidence at or after command dispatch.
   * Informational only — never drives canonical identity or economic reasoning.
   * Allows the audit trail to distinguish "command dispatched" from "device state converged".
   */
  telemetryCoherence?: TelemetryCoherenceStatus;
  cycleFinancialContext?: ExecutionCycleFinancialContext;
  economicArbitration?: ExecutionEconomicArbitrationTrace;
  schemaVersion: string;
}
