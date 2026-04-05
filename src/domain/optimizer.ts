import type { DeviceCapability, DeviceCommand, DeviceKind, TimeWindow } from "./device";
import type { Forecasts } from "./forecasts";
import type { PlanningStyle } from "./planningStyle";
import type { SystemState } from "./system";
import type { TariffSchedule } from "./tariff";

export type OptimizationMode = "cost" | "balanced" | "carbon" | "self_consumption";
export type PlanningConfidenceLevel = "high" | "medium" | "low";

export type OptimizerAction =
  | "charge_battery"
  | "discharge_battery"
  | "discharge_ev_to_home"
  | "divert_solar_to_ev"
  | "divert_solar_to_battery"
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
  /** Canonical planning style selected for this runtime cycle. */
  planningStyle?: PlanningStyle;
  /** Minimum battery reserve Aveum should preserve. */
  batteryReservePercent?: number;
  /** Upper limit on full battery cycles planned within a day. */
  maxBatteryCyclesPerDay?: number;
  /** Whether grid charging for batteries is permitted. */
  allowGridBatteryCharging: boolean;
  /** Whether battery export to the grid is permitted. */
  allowBatteryExport: boolean;
  /** Whether Aveum may schedule EV charging automatically. */
  allowAutomaticEvCharging: boolean;
  /** Whether Aveum may divert surplus solar into flexible loads instead of exporting. */
  solarDivertEnabled?: boolean;
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
  /** Canonical battery wear cost assumption in pence per kWh discharged. */
  batteryDegradationCostPencePerKwh?: number;
  /** Weight applied to import-avoidance value when valuing stored energy. */
  importAvoidanceWeight?: number;
  /** Weight applied to export value when valuing stored energy and export actions. */
  exportPreferenceWeight?: number;
  /** Weight applied to keeping locally-generated energy on site. */
  selfConsumptionPreferenceWeight?: number;
  /** Weight applied to EV charging urgency thresholds. */
  evChargeUrgencyWeight?: number;
  /** Deadline window in hours where EV urgency ramps faster. */
  evDeadlineUrgencyHours?: number;
}

/**
 * Canonical input for the single Aveum optimizer engine.
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
  /**
   * Optional 48-element array of typical half-hourly household load in kWh,
   * indexed by slot from midnight (slot 0 = 00:00–00:30, slot 47 = 23:30–00:00).
   * When provided, this overrides the simulated household load in forecasts.
   */
  typicalLoadKwhPerSlot?: number[];
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
  /** High-level action Aveum wants the site to take. */
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
  /** Expected EV state of charge before the slot executes. */
  startingEvSocPercent?: number;
  /** Estimated energy moved by this decision in kWh. */
  expectedEnergyTransferredKwh?: number;
  /** Estimated gross household value for this decision in pence. */
  expectedValuePence?: number;
  /** Machine- and user-readable explanation for the action. */
  reason: string;
  /** Marginal import-avoidance value for one additional stored kWh at this slot. */
  marginalImportAvoidancePencePerKwh?: number;
  /** Marginal export-opportunity value for one additional stored kWh at this slot. */
  marginalExportValuePencePerKwh?: number;
  /** Effective value used for storage decisioning at this slot. */
  effectiveStoredEnergyValuePencePerKwh?: number;
  /** Gross stored-energy value before degradation cost is applied. */
  grossStoredEnergyValuePencePerKwh?: number;
  /** Net stored-energy value after degradation cost is applied. */
  netStoredEnergyValuePencePerKwh?: number;
  /** Applied battery degradation cost for this decision slot. */
  batteryDegradationCostPencePerKwh?: number;
  /** Planning confidence level used when evaluating this decision slot. */
  planningConfidenceLevel?: PlanningConfidenceLevel;
  /** Whether conservative gating adjusted this slot's decision thresholds. */
  conservativeAdjustmentApplied?: boolean;
  /** Explicit rationale for conservative gating when applied. */
  conservativeAdjustmentReason?: string;
  /** Confidence score from 0 to 1 for the decision. */
  confidence: number;
}

export interface InputCoverageMetric {
  availableSlots: number;
  totalPlannedSlots: number;
  coveragePercent: number;
}

export interface PlanningInputCoverage {
  plannedSlotCount: number;
  tariffImport: InputCoverageMetric;
  tariffExport: InputCoverageMetric;
  forecastLoad: InputCoverageMetric;
  forecastSolar: InputCoverageMetric;
  fallbackSlotCount: number;
  fallbackByType: {
    exportRateSlots: number;
    loadForecastSlots: number;
    solarForecastSlots: number;
  };
  caveats: string[];
}

/**
 * Planning telemetry emitted by the optimizer for a single run.
 *
 * These fields reflect the optimizer's *forward-looking plan estimate*, not
 * post-run accounting truth. Do not use them as customer-facing accounting
 * values in UI or compatibility adapters — derive those from CanonicalValueLedger.
 *
 * Sign convention note:
 *   planningNetRevenueSurplusPence = exportRevenue - importCost - batteryDegradation
 *   (positive = planned net revenue surplus from optimization actions)
 *
 * This is the OPPOSITE sign of CanonicalValueLedger.estimatedNetCostPence:
 *   estimatedNetCostPence = importCost - exportRevenue + batteryDegradation
 *   (positive = net monetary cost to the household)
 *
 * Do not invert or alias these fields across the planning/accounting boundary.
 * CanonicalValueLedger independently derives its cost fields from the same
 * optimizer summary inputs, with an explicit cost-positive sign convention.
 */
export interface OptimizerSummary {
  expectedImportCostPence: number;
  expectedExportRevenuePence: number;
  /**
   * Planning telemetry: net revenue surplus for the planned horizon.
   * Sign: positive = net revenue surplus (exportRevenue - importCost - batteryDegradation).
   * Opposite sign from CanonicalValueLedger.estimatedNetCostPence (cost-positive).
   * Use CanonicalValueLedger for all accounting and customer-facing values.
   */
  planningNetRevenueSurplusPence: number;
  expectedBatteryDegradationCostPence?: number;
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

export interface OptimizerOpportunityEconomicSignals {
  effectiveStoredEnergyValuePencePerKwh?: number;
  netStoredEnergyValuePencePerKwh?: number;
  marginalImportAvoidancePencePerKwh?: number;
  exportValuePencePerKwh?: number;
}

export interface OptimizerOpportunity {
  opportunityId: string;
  decisionId?: string;
  action?: OptimizerAction;
  targetDeviceId: string;
  targetKind?: DeviceKind;
  requiredCapabilities?: DeviceCapability[];
  command: DeviceCommand;
  economicSignals: OptimizerOpportunityEconomicSignals;
  planningConfidenceLevel?: PlanningConfidenceLevel;
  conservativeAdjustmentApplied?: boolean;
  conservativeAdjustmentReason?: string;
  decisionReason?: string;
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
 * Canonical output from the single Aveum optimizer engine.
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
  /** Canonical execution opportunities emitted by the optimizer. */
  opportunities?: OptimizerOpportunity[];
  /** Aggregated expected outcomes for the plan. */
  summary: OptimizerSummary;
  /** Explainability and quality diagnostics. */
  diagnostics: OptimizerDiagnostic[];
  /** Canonical coverage and fallback usage for planning inputs. */
  planningInputCoverage?: PlanningInputCoverage;
  /** Aggregate planning confidence level for this runtime optimization pass. */
  planningConfidenceLevel?: PlanningConfidenceLevel;
  /** Whether conservative gating was applied due to imperfect planning inputs. */
  conservativeAdjustmentApplied?: boolean;
  /** Explicit reason for conservative planning adjustment. */
  conservativeAdjustmentReason?: string;
  /** Explicit feasibility outcome for execution-layer readiness checks. */
  feasibility?: OptimizerFeasibility;
  /** Assumptions made while generating this plan. */
  assumptions?: string[];
  /** Non-blocking warnings that execution systems should surface. */
  warnings?: string[];
  /** Coarse plan confidence from 0 to 1. */
  confidence: number;
}