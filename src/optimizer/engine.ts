import type { OptimizerInput, OptimizerOutput } from "../domain";
import { buildOptimizerExplanation } from "./explain";
import { buildCanonicalRuntimeResult } from "./runtimeCoreMapper";

function isFiniteTimestamp(timestamp: string | undefined): boolean {
  if (!timestamp) {
    return false;
  }

  return Number.isFinite(new Date(timestamp).getTime());
}

function resolvePlanningTimestamp(input: OptimizerInput): string {
  if (isFiniteTimestamp(input.systemState.capturedAt)) {
    return input.systemState.capturedAt;
  }

  if (isFiniteTimestamp(input.forecasts.horizonStartAt)) {
    return input.forecasts.horizonStartAt;
  }

  return "1970-01-01T00:00:00.000Z";
}

function toPlanToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32) || "na";
}

function toDeterministicBlockedPlanId(input: OptimizerInput, generatedAt: string): string {
  const horizonStartAt = input.forecasts.horizonStartAt ?? generatedAt;
  const horizonEndAt = input.forecasts.horizonEndAt ?? generatedAt;

  return [
    input.systemState.siteId,
    input.constraints.mode,
    generatedAt,
    horizonStartAt,
    horizonEndAt,
    "blocked",
  ]
    .map((value) => toPlanToken(value))
    .join("-");
}

function buildBlockedOutput(input: OptimizerInput): OptimizerOutput {
  const generatedAt = resolvePlanningTimestamp(input);
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
    planId: toDeterministicBlockedPlanId(input, generatedAt),
    generatedAt,
    planningWindow: undefined,
    status: "blocked",
    headline: "Aveum needs tariff data before it can build a plan.",
    decisions: [],
    recommendedCommands: [],
    opportunities: [],
    summary: {
      expectedImportCostPence: 0,
      expectedExportRevenuePence: 0,
      planningNetRevenueSurplusPence: 0,
    },
    diagnostics,
    planningInputCoverage: {
      plannedSlotCount: 0,
      tariffImport: { availableSlots: 0, totalPlannedSlots: 0, coveragePercent: 0 },
      tariffExport: { availableSlots: 0, totalPlannedSlots: 0, coveragePercent: 0 },
      forecastLoad: { availableSlots: 0, totalPlannedSlots: 0, coveragePercent: 0 },
      forecastSolar: { availableSlots: 0, totalPlannedSlots: 0, coveragePercent: 0 },
      fallbackSlotCount: 0,
      fallbackByType: {
        exportRateSlots: 0,
        loadForecastSlots: 0,
        solarForecastSlots: 0,
      },
      caveats: ["Planning did not run because no import tariff slots were available."],
    },
    planningConfidenceLevel: "low",
    conservativeAdjustmentApplied: true,
    conservativeAdjustmentReason: "Planning blocked due to missing import tariff data.",
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

  // If the caller supplied a real-world consumption profile, overlay those
  // values onto the simulated householdLoadKwh forecast so every downstream
  // planner automatically benefits from the real data.
  const resolvedInput: OptimizerInput =
    input.typicalLoadKwhPerSlot && input.typicalLoadKwhPerSlot.length === 48
      ? {
          ...input,
          forecasts: {
            ...input.forecasts,
            householdLoadKwh: input.forecasts.householdLoadKwh.map((point, index) => {
              const slotIndex =
                new Date(point.startAt).getUTCHours() * 2 +
                Math.floor(new Date(point.startAt).getUTCMinutes() / 30);
              const profileValue = input.typicalLoadKwhPerSlot![slotIndex];
              return profileValue != null && Number.isFinite(profileValue)
                ? { ...point, value: profileValue, confidence: 0.85 }
                : point;
            }),
          },
        }
      : input;

  const result = buildCanonicalRuntimeResult(resolvedInput);
  const explanation = buildOptimizerExplanation(resolvedInput, result);
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
    opportunities: result.opportunities,
    summary: result.summary,
    diagnostics: explanation.diagnostics,
    planningInputCoverage: result.planningInputCoverage,
    planningConfidenceLevel: result.planningConfidenceLevel,
    conservativeAdjustmentApplied: result.conservativeAdjustmentApplied,
    conservativeAdjustmentReason: result.conservativeAdjustmentReason,
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