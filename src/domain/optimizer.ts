import type { DeviceCapability, DeviceCommand, DeviceKind, TimeWindow } from "./device";
import type { Forecasts } from "./forecasts";
import type { SystemState } from "./system";
import type { TariffSchedule } from "./tariff";

export type OptimizationMode = "cost" | "balanced" | "carbon" | "self_consumption";

export type OptimizerAction =
  | "charge_battery"
  | "discharge_battery"
  | "charge_ev"
  | "export_to_grid"
  | "consume_solar"
  | "hold";

export type OptimizerStatus = "ok" | "degraded" | "blocked";

export type OptimizerDiagnosticSeverity = "info" | "warning" | "critical";

/**
 * Customer preferences and hard operational guardrails.
 */
export interface Constraints {
  /** Optimization mode selected by the customer or product policy. */
  mode: OptimizationMode;
  /** Minimum battery reserve Gridly should preserve. */
  batteryReservePercent?: number;
  /** Upper limit on full battery cycles planned within a day. */
  maxBatteryCyclesPerDay?: number;
  /** Whether grid charging for batteries is permitted. */
  allowGridBatteryCharging: boolean;
  /** Whether battery export to the grid is permitted. */
  allowBatteryExport: boolean;
  /** Whether Gridly may schedule EV charging automatically. */
  allowAutomaticEvCharging: boolean;
  /** Latest acceptable EV ready time for deadline-aware charging. */
  evReadyBy?: string;
  /** EV charge target to achieve before the ready-by time. */
  evTargetSocPercent?: number;
  /** Site-level import limit, when enforced by supply constraints. */
  maxImportPowerW?: number;
  /** Site-level export limit, when enforced by the DNO or inverter. */
  maxExportPowerW?: number;
  /** Minimum lead time before a scheduled command may execute. */
  minCommandLeadMinutes?: number;
}

/**
 * Canonical input for the single Gridly optimizer engine.
 */
export interface OptimizerInput {
  /** Current site snapshot assembled from adapters. */
  systemState: SystemState;
  /** Forward-looking demand, solar, and carbon signals. */
  forecasts: Forecasts;
  /** Import and export price schedule for the horizon. */
  tariffSchedule: TariffSchedule;
  /** Product and customer guardrails used during optimization. */
  constraints: Constraints;
}

/**
 * Decision for a single optimization slot.
 */
export interface OptimizerDecision {
  /** Stable decision ID for control-loop reconciliation and audit logs. */
  decisionId: string;
  /** Inclusive start of the decision slot. */
  startAt: string;
  /** Exclusive end of the decision slot. */
  endAt: string;
  /** Explicit execution window for schedulers and adapter dispatchers. */
  executionWindow: TimeWindow;
  /** High-level action Gridly wants the site to take. */
  action: OptimizerAction;
  /** Devices expected to execute or participate in the action. */
  targetDeviceIds: string[];
  /** Optional target metadata for capability-aware dispatch. */
  targetDevices?: OptimizerDecisionTarget[];
  /** Expected import energy for the slot, in kWh. */
  expectedImportKwh?: number;
  /** Expected export energy for the slot, in kWh. */
  expectedExportKwh?: number;
  /** Expected battery state of charge after the slot. */
  expectedBatterySocPercent?: number;
  /** Expected EV state of charge after the slot. */
  expectedEvSocPercent?: number;
  /** Machine- and user-readable explanation for the action. */
  reason: string;
  /** Confidence score from 0 to 1 for the decision. */
  confidence: number;
}

/**
 * Aggregate economic and operational outcomes for a plan.
 */
export interface OptimizerSummary {
  expectedImportCostPence: number;
  expectedExportRevenuePence: number;
  expectedNetValuePence: number;
  expectedSolarSelfConsumptionKwh?: number;
  expectedBatteryCycles?: number;
  expectedCarbonAvoidedGrams?: number;
}

/**
 * Diagnostic emitted by the optimizer for explainability and monitoring.
 */
export interface OptimizerDiagnostic {
  code: string;
  message: string;
  severity: OptimizerDiagnosticSeverity;
}

/**
 * Execution-oriented metadata for each targeted device.
 */
export interface OptimizerDecisionTarget {
  deviceId: string;
  kind?: DeviceKind;
  requiredCapabilities?: DeviceCapability[];
}

/**
 * Feasibility status for execution and downstream control loops.
 */
export interface OptimizerFeasibility {
  executable: boolean;
  reasonCodes: string[];
  blockingCodes?: string[];
}

/**
 * Canonical output from the single Gridly optimizer engine.
 */
export interface OptimizerOutput {
  /** Contract schema version for persisted-plan compatibility checks. */
  schemaVersion?: string;
  /** Planner implementation version that generated this output. */
  plannerVersion?: string;
  /** Stable plan ID for analytics, history, and control-loop tracing. */
  planId: string;
  /** Timestamp when the plan was generated. */
  generatedAt: string;
  /** Canonical planning horizon represented by this plan. */
  planningWindow?: TimeWindow;
  /** Overall optimizer status for the produced plan. */
  status: OptimizerStatus;
  /** Human-readable headline summarising the plan. */
  headline: string;
  /** Ordered slot-by-slot plan for the control loop and UI. */
  decisions: OptimizerDecision[];
  /** Commands that should be dispatched now or scheduled for later. */
  recommendedCommands: DeviceCommand[];
  /** Aggregated expected outcomes for the plan. */
  summary: OptimizerSummary;
  /** Explainability and quality diagnostics. */
  diagnostics: OptimizerDiagnostic[];
  /** Explicit feasibility outcome for execution-layer readiness checks. */
  feasibility?: OptimizerFeasibility;
  /** Assumptions made while generating this plan. */
  assumptions?: string[];
  /** Non-blocking warnings that execution systems should surface. */
  warnings?: string[];
  /** Coarse plan confidence from 0 to 1. */
  confidence: number;
}