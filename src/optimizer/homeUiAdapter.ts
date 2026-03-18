import type {
  CanonicalValueLedger,
  OptimizerAction,
  OptimizerDecision,
  OptimizerDiagnostic,
  OptimizerOutput,
} from "../domain";
import { mapValueLedgerToCustomerValueSummary } from "../domain";

export type HomeLegacyAction = "charge" | "discharge" | "hold" | "import" | "export";

export interface HomeTimelineRow {
  slot: number;
  action: HomeLegacyAction;
  reason: string;
}

export interface HomeValueSummary {
  /** Projected savings vs baseline, in GBP. Accounting authority: CanonicalValueLedger. */
  savingsToday: number;
  /** Projected export earnings, in GBP. Accounting authority: CanonicalValueLedger. */
  earningsToday: number;
}

export interface HomeTrustSummary {
  confidenceScore: number;
  confidenceLabel: "Low" | "Moderate" | "High";
  statusLabel: string;
  explanation: string;
}

export interface HomeHealthSummary {
  systemStatus: "ok" | "degraded" | "blocked";
  diagnosticLabel: string;
}

export interface HomeUiViewModel {
  currentAction: HomeLegacyAction;
  currentReason: string;
  currentModeLabel: string;
  nextStepLabel: string;
  timeline: HomeTimelineRow[];
  value: HomeValueSummary;
  trust: HomeTrustSummary;
  health: HomeHealthSummary;
}

function toSlotOfDay(timestamp: string): number {
  const date = new Date(timestamp);
  return Math.max(0, Math.min(47, date.getHours() * 2 + Math.floor(date.getMinutes() / 30)));
}

function toLegacyAction(action: OptimizerAction): HomeLegacyAction {
  if (action === "charge_battery" || action === "charge_ev") return "charge";
  if (action === "export_to_grid") return "export";
  if (action === "discharge_battery" || action === "consume_solar") return "discharge";
  return "hold";
}

function confidenceLabel(score: number): "Low" | "Moderate" | "High" {
  if (score < 0.4) return "Low";
  if (score < 0.75) return "Moderate";
  return "High";
}

function selectCurrentDecision(decisions: OptimizerDecision[]): OptimizerDecision | undefined {
  return decisions[0];
}

function selectNextDecision(decisions: OptimizerDecision[]): OptimizerDecision | undefined {
  return decisions.slice(1).find((decision) => decision.action !== "hold");
}

function buildTimeline(decisions: OptimizerDecision[]): HomeTimelineRow[] {
  const rows: HomeTimelineRow[] = [];

  for (const decision of decisions) {
    const row: HomeTimelineRow = {
      slot: toSlotOfDay(decision.startAt),
      action: toLegacyAction(decision.action),
      reason: decision.reason,
    };

    const last = rows[rows.length - 1];
    if (last && last.slot === row.slot && last.action === row.action && last.reason === row.reason) {
      continue;
    }

    rows.push(row);
  }

  return rows;
}

function firstDiagnosticMessage(diagnostics: OptimizerDiagnostic[]): string | undefined {
  return diagnostics[0]?.message;
}

function buildStatusLabel(output: OptimizerOutput): string {
  if (output.status === "blocked") return "Blocked";
  if (output.status === "degraded") return "Reduced";
  return "Healthy";
}

function buildDiagnosticLabel(diagnostics: OptimizerDiagnostic[]): string {
  const critical = diagnostics.filter((diagnostic) => diagnostic.severity === "critical").length;
  const warning = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;

  if (critical > 0) return `${critical} critical issue${critical > 1 ? "s" : ""}`;
  if (warning > 0) return `${warning} warning${warning > 1 ? "s" : ""}`;
  return "No active issues";
}

function modeLabelFromAction(action: HomeLegacyAction): string {
  if (action === "charge") return "Charging now";
  if (action === "export") return "Exporting now";
  if (action === "discharge") return "Discharging now";
  if (action === "import") return "Importing now";
  return "Holding steady";
}

/**
 * Bridge canonical optimizer output into Home screen's existing data shape.
 */
export function buildHomeUiViewModel(
  output: OptimizerOutput,
  valueLedger: CanonicalValueLedger,
): HomeUiViewModel {
  const current = selectCurrentDecision(output.decisions);
  const next = selectNextDecision(output.decisions);
  const currentAction = current ? toLegacyAction(current.action) : "hold";
  const score = output.confidence;
  const trustLabel = confidenceLabel(score);
  // Accounting authority is the canonical runtime value ledger.
  // Optimizer summary remains planning telemetry and should not be used as
  // direct customer-facing accounting truth in UI adapters.
  const customerValue = mapValueLedgerToCustomerValueSummary(valueLedger);

  return {
    currentAction,
    currentReason: current?.reason ?? output.headline,
    currentModeLabel: modeLabelFromAction(currentAction),
    nextStepLabel: next
      ? `${modeLabelFromAction(toLegacyAction(next.action))} · ${next.reason}`
      : "Holding steady while waiting for the next stronger opportunity.",
    timeline: buildTimeline(output.decisions),
    value: {
      savingsToday: customerValue.projectedSavingsGbp,
      earningsToday: customerValue.projectedEarningsGbp,
    },
    trust: {
      confidenceScore: score,
      confidenceLabel: trustLabel,
      statusLabel: buildStatusLabel(output),
      explanation: firstDiagnosticMessage(output.diagnostics) ?? output.headline,
    },
    health: {
      systemStatus: output.status,
      diagnosticLabel: buildDiagnosticLabel(output.diagnostics),
    },
  };
}