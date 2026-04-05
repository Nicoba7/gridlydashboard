import type { HeatPumpPreHeatEvent, OptimizerInput, OptimizerOutput } from "../domain";
import type { ScheduleWindowCommand } from "../domain/device";
import { buildOptimizerExplanation } from "./explain";
import { buildCanonicalRuntimeResult } from "./runtimeCoreMapper";

// ── Heat pump scheduling ───────────────────────────────────────────────────────

function formatCompactHour(isoString: string): string {
  const d = new Date(isoString);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const period = h >= 12 ? "pm" : "am";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${twelve}${period}` : `${twelve}:${String(m).padStart(2, "0")}${period}`;
}

interface HeatPumpScheduleResult {
  commands: ScheduleWindowCommand[];
  event: HeatPumpPreHeatEvent;
}

function buildHeatPumpPreHeatSchedule(
  input: OptimizerInput,
  planId: string,
  generatedAt: string,
): HeatPumpScheduleResult | null {
  // Find heat pump devices that support schedule_window and are reachable.
  const heatPumpDevices = input.systemState.devices.filter(
    (d) =>
      d.kind === "heat_pump" &&
      (d.connectionStatus === "online" || d.connectionStatus === "degraded") &&
      d.capabilities.includes("schedule_window"),
  );

  if (!heatPumpDevices.length) return null;

  const cop = input.heatPumpCop ?? 3.5;
  const thermalCoastHours = input.thermalCoastHours ?? 3;
  const hotWaterBudgetKwh = input.hotWaterPreHeatBudgetKwh ?? 2.0;

  // If the house is already warm (thermal SoC > 80%), skip pre-heat — it would coast anyway.
  const maxThermalSoc = Math.max(...heatPumpDevices.map((d) => d.stateOfChargePercent ?? 0));
  if (maxThermalSoc > 80) return null;

  const importRates = input.tariffSchedule.importRates;
  if (!importRates.length) return null;

  const avgRate =
    importRates.reduce((sum, r) => sum + r.unitRatePencePerKwh, 0) / importRates.length;
  const avgEffectiveHeatCost = avgRate / cop;

  // Collect slots where effective heat cost is below the daily average, sorted cheapest first.
  const cheapSlots = importRates
    .map((rate, i) => ({
      index: i,
      effectiveCost: rate.unitRatePencePerKwh / cop,
      startAt: rate.startAt,
      endAt: rate.endAt,
    }))
    .filter((s) => s.effectiveCost < avgEffectiveHeatCost)
    .sort((a, b) => a.effectiveCost - b.effectiveCost);

  if (!cheapSlots.length) return null;

  // Take the best slots up to thermalCoastHours window length (half-hourly slots).
  const maxWindowSlots = thermalCoastHours * 2;
  const windowSlots = cheapSlots
    .slice(0, maxWindowSlots)
    .sort((a, b) => a.index - b.index); // restore chronological order

  const firstSlot = windowSlots[0];
  const lastSlot = windowSlots[windowSlots.length - 1];
  const avgWindowCost = windowSlots.reduce((s, sl) => s + sl.effectiveCost, 0) / windowSlots.length;

  // Estimate savings: effective cost difference × typical heating demand for the window.
  const windowHours = windowSlots.length * 0.5;
  const heatPumpKw = 5.0; // nominal 5 kW input power
  const windowKwh = heatPumpKw * windowHours;
  const savedPence = Math.max(0, (avgEffectiveHeatCost - avgWindowCost) * windowKwh);

  const hotWaterSavingsPounds =
    hotWaterBudgetKwh > 0 && avgEffectiveHeatCost > avgWindowCost
      ? Number(((hotWaterBudgetKwh * (avgEffectiveHeatCost - avgWindowCost)) / 100).toFixed(2))
      : undefined;

  const timeRangeLabel = `${formatCompactHour(firstSlot.startAt)}–${formatCompactHour(lastSlot.endAt)}`;
  const reason =
    `Pre-heat during cheapest window — effective heat cost ${avgWindowCost.toFixed(1)}p/kWh ` +
    `(electricity ÷ COP ${cop}) vs ${avgEffectiveHeatCost.toFixed(1)}p/kWh average.`;

  const commands: ScheduleWindowCommand[] = heatPumpDevices.map((device, i) => ({
    commandId: `${planId}-hp-preheat-${i}`,
    deviceId: device.deviceId,
    issuedAt: generatedAt,
    type: "schedule_window",
    window: { startAt: firstSlot.startAt, endAt: lastSlot.endAt },
    targetMode: "boost",
    effectiveWindow: { startAt: firstSlot.startAt, endAt: lastSlot.endAt },
    reason,
  }));

  return {
    commands,
    event: {
      timeRangeLabel,
      effectiveHeatCostPencePerKwh: Number(avgWindowCost.toFixed(1)),
      savedPence: Math.round(savedPence),
      hotWaterSavingsPounds,
    },
  };
}

function isFiniteTimestamp(timestamp: string | undefined): boolean {  if (!timestamp) {
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
  const heatPumpSchedule = buildHeatPumpPreHeatSchedule(
    resolvedInput,
    result.planId,
    result.generatedAt,
  );
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
    recommendedCommands: heatPumpSchedule
      ? [...result.recommendedCommands, ...heatPumpSchedule.commands]
      : result.recommendedCommands,
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
    heatPumpPreHeatEvent: heatPumpSchedule?.event ?? null,
  };
}