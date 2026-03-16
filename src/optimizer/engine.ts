import type { OptimizerInput, OptimizerOutput } from "../domain";
import { buildOptimizerExplanation } from "./explain";
import { buildCanonicalRuntimeResult } from "./runtimeCoreMapper";

function buildBlockedOutput(input: OptimizerInput): OptimizerOutput {
  const generatedAt = new Date().toISOString();
  const diagnostics = [
    {
      code: "MISSING_TARIFF_DATA",
      message: "No import tariff slots were supplied to the canonical optimizer.",
      severity: "critical" as const,
    },
  ];

  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: `${input.systemState.siteId}-${generatedAt.replace(/[-:.TZ]/g, "")}`,
    generatedAt,
    planningWindow: undefined,
    status: "blocked",
    headline: "Gridly needs tariff data before it can build a plan.",
    decisions: [],
    recommendedCommands: [],
    summary: {
      expectedImportCostPence: 0,
      expectedExportRevenuePence: 0,
      expectedNetValuePence: 0,
    },
    diagnostics,
    feasibility: {
      executable: false,
      reasonCodes: ["MISSING_TARIFF_DATA"],
      blockingCodes: ["MISSING_TARIFF_DATA"],
    },
    assumptions: [],
    warnings: [],
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

  const result = buildCanonicalRuntimeResult(input);
  const explanation = buildOptimizerExplanation(input, result);
  const warningCodes = explanation.diagnostics
    .filter((diagnostic) => diagnostic.severity === "warning")
    .map((diagnostic) => diagnostic.code);
  const hasWarnings = explanation.diagnostics.some((diagnostic) => diagnostic.severity === "warning");
  const hasCritical = explanation.diagnostics.some((diagnostic) => diagnostic.severity === "critical");
  const status = hasCritical ? "blocked" : hasWarnings ? "degraded" : "ok";
  const mergedWarnings = [...new Set([...result.warnings, ...warningCodes])];

  return {
    schemaVersion: result.schemaVersion,
    plannerVersion: result.plannerVersion,
    planId: result.planId,
    generatedAt: result.generatedAt,
    planningWindow: result.planningWindow,
    status,
    headline: explanation.headline,
    decisions: result.decisions,
    recommendedCommands: result.recommendedCommands,
    summary: result.summary,
    diagnostics: explanation.diagnostics,
    feasibility: {
      executable: result.feasibility.executable && !hasCritical,
      reasonCodes: result.feasibility.reasonCodes,
      blockingCodes: hasCritical
        ? explanation.diagnostics
          .filter((diagnostic) => diagnostic.severity === "critical")
          .map((diagnostic) => diagnostic.code)
        : result.feasibility.blockingCodes,
    },
    assumptions: result.assumptions,
    warnings: mergedWarnings,
    confidence: explanation.confidence,
  };
}