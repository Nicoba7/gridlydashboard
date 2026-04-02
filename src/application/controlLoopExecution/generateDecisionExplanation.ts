import type { PlanningConfidenceLevel } from "../../domain";
import type { DecisionExplanation } from "../../journal/executionJournal";
import type { RuntimeExecutionPosture } from "./executionPolicyTypes";

export interface DecisionExplanationInput {
  opportunityId: string;
  decisionType: string;
  targetDeviceId?: string;
  decisionReason?: string;
  reasonCodes?: string[];
  planningConfidenceLevel?: PlanningConfidenceLevel;
  conservativeAdjustmentApplied?: boolean;
  conservativeAdjustmentReason?: string;
  economicSignals?: {
    effectiveStoredEnergyValuePencePerKwh?: number;
    netStoredEnergyValuePencePerKwh?: number;
    marginalImportAvoidancePencePerKwh?: number;
    exportValuePencePerKwh?: number;
  };
}

export interface DecisionExplanationContext {
  executionPosture: RuntimeExecutionPosture;
}

function formatPence(value: number): string {
  return `${value.toFixed(2)} p/kWh`;
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function humanizeIdentifier(value: string): string {
  return value.replace(/_/g, " ").toLowerCase();
}

function buildActionSummary(decisionType: string, decisionReason?: string): string {
  const normalizedDecisionType = decisionType.trim().toLowerCase();

  switch (normalizedDecisionType) {
    case "charge_battery":
      return "Charging battery";
    case "discharge_battery":
      return "Powering home from battery";
    case "discharge_ev_to_home":
      return "EV powering your home";
    case "charge_ev":
    case "start_charging":
      return "Charging EV";
    case "divert_solar_to_ev":
      return "Diverting solar to EV";
    case "divert_solar_to_battery":
      return "Diverting solar to battery";
    case "stop_charging":
      return "Stopping EV charging";
    case "export_to_grid":
      return "Exporting to grid";
    case "consume_solar":
      return "Running home on solar";
    case "hold":
      return "System is idle";
    case "selected_opportunity":
      return "Acting now";
    default:
      if (normalizedDecisionType.startsWith("rejected_")) {
        return "Not acting right now";
      }

      if (decisionReason) {
        return ensureSentence(decisionReason).replace(/[.]$/, "");
      }

      return ensureSentence(humanizeIdentifier(normalizedDecisionType)).replace(/[.]$/, "");
  }
}

function pushIfAbsent(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

function mapConfidenceFromPlanningLevel(
  planningConfidenceLevel?: PlanningConfidenceLevel,
): DecisionExplanation["confidence"] {
  if (planningConfidenceLevel === "high") return "high";
  if (planningConfidenceLevel === "low") return "low";
  return "medium";
}

/**
 * Pure deterministic explanation generator for canonical opportunity decisions.
 *
 * Derives plain-language causal output from already-available runtime decision
 * inputs/outputs only. No external calls, persistence, or side effects.
 */
export function generateDecisionExplanation(
  decision: DecisionExplanationInput,
  context: DecisionExplanationContext,
): DecisionExplanation {
  const drivers: string[] = [];

  if (decision.decisionReason) {
    pushIfAbsent(drivers, ensureSentence(decision.decisionReason));
  }

  if (decision.planningConfidenceLevel) {
    pushIfAbsent(drivers, `Current planning confidence is ${decision.planningConfidenceLevel}.`);
  }

  if (decision.economicSignals?.effectiveStoredEnergyValuePencePerKwh !== undefined) {
    pushIfAbsent(
      drivers,
      `Stored energy is worth ${formatPence(decision.economicSignals.effectiveStoredEnergyValuePencePerKwh)} right now.`,
    );
  } else if (decision.economicSignals?.netStoredEnergyValuePencePerKwh !== undefined) {
    pushIfAbsent(
      drivers,
      `Stored energy value after battery wear is ${formatPence(decision.economicSignals.netStoredEnergyValuePencePerKwh)}.`,
    );
  }

  if (decision.economicSignals?.marginalImportAvoidancePencePerKwh !== undefined) {
    pushIfAbsent(
      drivers,
      `Avoiding grid imports is worth ${formatPence(decision.economicSignals.marginalImportAvoidancePencePerKwh)} right now.`,
    );
  }

  if (decision.economicSignals?.exportValuePencePerKwh !== undefined) {
    pushIfAbsent(
      drivers,
      `Exporting now is worth ${formatPence(decision.economicSignals.exportValuePencePerKwh)}.`,
    );
  }

  if (decision.conservativeAdjustmentApplied && decision.conservativeAdjustmentReason) {
    pushIfAbsent(drivers, `Runtime is staying conservative: ${ensureSentence(decision.conservativeAdjustmentReason)}`);
  }

  if ((decision.reasonCodes?.length ?? 0) > 0) {
    pushIfAbsent(
      drivers,
      `Current constraints still apply: ${(decision.reasonCodes ?? [])
        .slice(0, 2)
        .map((code) => humanizeIdentifier(code))
        .join(", ")}.`,
    );
  }

  if (context.executionPosture !== "normal") {
    pushIfAbsent(drivers, `Runtime posture is ${humanizeIdentifier(context.executionPosture)}.`);
  }

  if (drivers.length < 2) {
    pushIfAbsent(drivers, `This applies to the current ${humanizeIdentifier(decision.decisionType)} decision.`);
  }

  const boundedDrivers = drivers.slice(0, 5);
  const confidence = mapConfidenceFromPlanningLevel(decision.planningConfidenceLevel);

  const summary = buildActionSummary(decision.decisionType, decision.decisionReason);

  const caution =
    decision.conservativeAdjustmentReason
    ?? decision.reasonCodes?.[0]
    ?? (context.executionPosture !== "normal"
      ? `Runtime posture is ${humanizeIdentifier(context.executionPosture)}.`
      : null);

  const confidenceReason = decision.planningConfidenceLevel
    ? `Current planning confidence is ${decision.planningConfidenceLevel}.`
    : "Planning confidence is not available.";

  return {
    summary,
    drivers: boundedDrivers,
    confidence,
    confidence_reason: confidenceReason,
    caution,
  };
}