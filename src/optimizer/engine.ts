import type { OptimizerInput, OptimizerOutput } from "../domain";
import { buildOptimizerExplanation } from "./explain";
import { buildCanonicalPlan } from "./planBuilder";

function buildBlockedOutput(input: OptimizerInput): OptimizerOutput {
  const generatedAt = new Date().toISOString();

  return {
    planId: `${input.systemState.siteId}-${generatedAt.replace(/[-:.TZ]/g, "")}`,
    generatedAt,
    status: "blocked",
    headline: "Gridly needs tariff data before it can build a plan.",
    decisions: [],
    recommendedCommands: [],
    summary: {
      expectedImportCostPence: 0,
      expectedExportRevenuePence: 0,
      expectedNetValuePence: 0,
    },
    diagnostics: [
      {
        code: "MISSING_TARIFF_DATA",
        message: "No import tariff slots were supplied to the canonical optimizer.",
        severity: "critical",
      },
    ],
    confidence: 0.2,
  };
}

/**
 * Canonical public optimizer entry point.
 *
 * This currently routes the new domain models through the existing plan engine,
 * then maps the result back into canonical optimizer contracts.
 */
export function optimize(input: OptimizerInput): OptimizerOutput {
  if (!input.tariffSchedule.importRates.length) {
    return buildBlockedOutput(input);
  }

  const result = buildCanonicalPlan(input);
  const explanation = buildOptimizerExplanation(input, result);
  const hasWarnings = explanation.diagnostics.some((diagnostic) => diagnostic.severity === "warning");

  return {
    planId: result.planId,
    generatedAt: result.generatedAt,
    status: hasWarnings ? "degraded" : "ok",
    headline: explanation.headline,
    decisions: result.decisions,
    recommendedCommands: result.recommendedCommands,
    summary: result.summary,
    diagnostics: explanation.diagnostics,
    confidence: explanation.confidence,
  };
}