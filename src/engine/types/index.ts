/**
 * Shared type contract for the Aveum intelligence engine.
 *
 * This file defines stable input/output shapes so UI features can call
 * engine logic safely without depending on implementation details.
 */

/**
 * Input payload passed from UI state into engine functions.
 */
export type AveumInput = {
  /** Current battery state-of-charge in percent (0-100). */
  batterySocPercent: number;
  /** Forecasted site load by time slot (kWh). */
  forecastLoadKwh: number[];
  /** Forecasted solar generation by time slot (kWh). */
  forecastSolarKwh: number[];
  /** Utility import tariff by time slot (currency per kWh). */
  importPrice: number[];
  /** Optional utility export tariff by time slot (currency per kWh). */
  exportPrice?: number[];
};

/**
 * High-level action the optimizer can recommend for a time slot.
 */
export type EngineAction = "charge" | "discharge" | "hold" | "import" | "export";

/**
 * Single recommendation item emitted by the optimizer.
 */
export type Recommendation = {
  /** Slot index this action applies to. */
  slot: number;
  /** Suggested control action for the slot. */
  action: EngineAction;
  /** Optional energy target for the action (kWh). */
  targetKwh?: number;
  /** Optional value score used to rank recommendations (higher is better). */
  value?: number;
  /** Optional per-recommendation confidence score (0-1). */
  confidence?: number;
  /** Human-readable summary for tooltips/cards. */
  reason: string;
};

/**
 * Headline counterfactual used to compare outcomes with and without Aveum.
 */
export type CounterfactualSummary = {
  /** Expected cost/impact when Aveum actions are applied. */
  withAveum: number;
  /** Baseline cost/impact without Aveum optimization. */
  withoutAveum: number;
  /** Difference between baseline and optimized outcome. */
  savings: number;
};

/**
 * Timeline action for building a step-by-step action plan in the UI.
 */
export type TimelineAction = {
  /** Slot index this action applies to. */
  slot: number;
  /** Suggested control action for the slot. */
  action: EngineAction;
  /** Human-readable explanation for why the action is suggested. */
  reason: string;
};

/**
 * Diagnostic metadata to explain trade-offs and confidence.
 */
export type Diagnostic = {
  /** Machine-readable diagnostic key for logging/analytics. */
  code: string;
  /** Human-readable diagnostic message. */
  message: string;
  /** Optional severity for surfacing in the UI. */
  severity?: "info" | "warning" | "critical";
};

/**
 * Standard output returned by engine functions.
 */
export type AveumOutput = {
  /** Optional hero headline shown at the top of plan and home experiences. */
  headline?: string;
  /** Optional supporting message shown under the headline. */
  subheadline?: string;
  /** Planned control recommendations per time slot. */
  recommendations: Recommendation[];
  /** Optional action timeline for chronological plan visualization. */
  timeline?: TimelineAction[];
  /** Optional counterfactual summary used for savings storytelling. */
  counterfactual?: CounterfactualSummary;
  /** Optional diagnostics for explainability and debugging. */
  diagnostics: Diagnostic[];
  /** Coarse score (0-1) representing confidence in the result. */
  confidence?: number;
};
