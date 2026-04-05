import type { HeatPumpPreHeatEvent, NegativePriceSlot, OptimizerInput, OptimizerOutput } from "../domain";
import type { ScheduleWindowCommand, SetModeCommand, V2gDischargeCommand } from "../domain/device";
import { buildOptimizerExplanation } from "./explain";
import { buildCanonicalRuntimeResult } from "./runtimeCoreMapper";
import { adjustCopForTemperature } from "../integrations/weather/weatherService";

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
  // When outdoor temperature data is available, apply a per-slot COP adjustment.
  const cheapSlots = importRates
    .map((rate, i) => {
      const slotIndex =
        new Date(rate.startAt).getUTCHours() * 2 +
        Math.floor(new Date(rate.startAt).getUTCMinutes() / 30);
      const slotCop =
        input.outdoorTemperatureForecastC &&
        input.outdoorTemperatureForecastC.length === 48 &&
        Number.isFinite(input.outdoorTemperatureForecastC[slotIndex])
          ? adjustCopForTemperature(cop, input.outdoorTemperatureForecastC[slotIndex])
          : cop;
      return {
        index: i,
        effectiveCost: rate.unitRatePencePerKwh / slotCop,
        startAt: rate.startAt,
        endAt: rate.endAt,
      };
    })
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

// ── V2G / V2H discharge scheduling ────────────────────────────────────────────

type EVDischargeResult =
  | {
      mode: "v2h";
      command: SetModeCommand;
      v2hDischargeSavingsPounds: number;
      v2hDischargeKwh: number;
      peakImportRatePencePerKwh: number;
    }
  | {
      mode: "v2g";
      command: V2gDischargeCommand;
      v2gDischargeProfitPounds: number;
      v2gDischargeKwh: number;
      peakExportRatePencePerKwh: number;
    };

function scheduleV2GDischarge(
  input: OptimizerInput,
  planId: string,
  generatedAt: string,
): EVDischargeResult | null {
  // Prefer V2H (vehicle-to-home) — no export licence required.
  const v2hCharger = input.systemState.devices.find(
    (d) =>
      d.kind === "ev_charger" &&
      (d.connectionStatus === "online" || d.connectionStatus === "degraded") &&
      (d.capabilities as string[]).includes("v2h_discharge"),
  );

  if (v2hCharger) {
    const evSoc = v2hCharger.stateOfChargePercent ?? 0;
    const v2hMinSoc =
      ((v2hCharger.metadata as Record<string, unknown>)?.v2hMinSocPercent as number | undefined) ?? 30;

    if (evSoc > v2hMinSoc + 10) {
      const importRates = input.tariffSchedule.importRates;
      if (importRates.length > 0) {
        const peakImportRate = Math.max(...importRates.map((r) => r.unitRatePencePerKwh));
        const capacityKwh = v2hCharger.capacityKwh ?? 40;
        const dischargeKwh = Math.min(
          capacityKwh * 0.5,
          ((evSoc - v2hMinSoc) / 100) * capacityKwh,
        );
        const efficiency = 0.9;
        const savingsPence = peakImportRate * dischargeKwh * efficiency;

        if (savingsPence / 100 >= 0.5) {
          return {
            mode: "v2h",
            command: {
              commandId: `${planId}-v2h-discharge`,
              deviceId: v2hCharger.deviceId,
              issuedAt: generatedAt,
              type: "set_mode",
              mode: "vehicle_to_home",
              reason: `V2H: EV powers home at peak ${peakImportRate.toFixed(1)}p/kWh — est. saving £${(savingsPence / 100).toFixed(2)}.`,
            },
            v2hDischargeSavingsPounds: Number((savingsPence / 100).toFixed(2)),
            v2hDischargeKwh: Number(dischargeKwh.toFixed(2)),
            peakImportRatePencePerKwh: peakImportRate,
          };
        }
      }
    }
  }

  // Fall back to V2G (vehicle-to-grid) — requires export licence but earns revenue.
  const v2gCharger = input.systemState.devices.find(
    (d) =>
      d.kind === "ev_charger" &&
      (d.connectionStatus === "online" || d.connectionStatus === "degraded") &&
      (d.capabilities as string[]).includes("v2g_discharge"),
  );
  if (!v2gCharger) return null;

  const evSoc = v2gCharger.stateOfChargePercent ?? 0;
  const v2gMinSoc =
    ((v2gCharger.metadata as Record<string, unknown>)?.v2hMinSocPercent as number | undefined) ?? 30;

  if (evSoc <= v2gMinSoc + 10) return null;

  const exportRates = input.tariffSchedule.exportRates ?? input.tariffSchedule.importRates;
  if (!exportRates.length) return null;

  const peakExportRate = Math.max(...exportRates.map((r) => r.unitRatePencePerKwh));
  const avgImportRate =
    input.tariffSchedule.importRates.reduce((s, r) => s + r.unitRatePencePerKwh, 0) /
    Math.max(1, input.tariffSchedule.importRates.length);

  const capacityKwh = v2gCharger.capacityKwh ?? 40;
  const dischargeKwh = Math.min(
    capacityKwh * 0.5,
    ((evSoc - v2gMinSoc) / 100) * capacityKwh,
  );

  const efficiency = 0.9;
  const degradationCost = input.constraints.batteryDegradationCostPencePerKwh ?? 1.5;
  const profitPence =
    (peakExportRate - avgImportRate - degradationCost) * dischargeKwh * efficiency;

  if (profitPence / 100 < 0.5) return null;

  return {
    mode: "v2g",
    command: {
      commandId: `${planId}-v2g-discharge`,
      deviceId: v2gCharger.deviceId,
      issuedAt: generatedAt,
      type: "v2g_discharge",
      enabled: true,
      reason: `V2G export: peak export ${peakExportRate.toFixed(1)}p/kWh — est. profit £${(profitPence / 100).toFixed(2)}.`,
    },
    v2gDischargeProfitPounds: Number((profitPence / 100).toFixed(2)),
    v2gDischargeKwh: Number(dischargeKwh.toFixed(2)),
    peakExportRatePencePerKwh: peakExportRate,
  };
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

  // ── Learned EV departure override ─────────────────────────────────────────
  // When departure learning data is present, compute mean − stdDev as a robust
  // ready-by deadline and inject it into constraints (unless the caller already
  // set a tighter evReadyBy).
  let resolvedInput: OptimizerInput = input;
  if (
    input.learnedDepartureMinutesMean != null &&
    input.learnedDepartureMinutesStdDev != null &&
    !input.constraints.evReadyBy
  ) {
    const safeMinutes = Math.max(
      0,
      input.learnedDepartureMinutesMean - input.learnedDepartureMinutesStdDev,
    );
    const referenceDate = input.systemState.capturedAt
      ? new Date(input.systemState.capturedAt)
      : new Date();
    const midnight = new Date(referenceDate);
    midnight.setUTCHours(0, 0, 0, 0);
    const evReadyBy = new Date(midnight.getTime() + safeMinutes * 60_000).toISOString();
    resolvedInput = {
      ...input,
      constraints: { ...input.constraints, evReadyBy },
    };
  }

  // ── Dynamic battery degradation cost ─────────────────────────────────────
  // When a battery device reports health/cycle telemetry via systemState, derive
  // an elevated degradation cost and inject it into constraints so the planner
  // avoids arbitrage that doesn't justify the wear cost.
  let derivedDegradationCost: number | undefined;
  {
    const batteryDevices = resolvedInput.systemState.devices.filter(
      (d) => d.kind === "battery",
    );
    if (batteryDevices.length > 0) {
      // Extract the worst health and highest cycle count reported across all battery devices.
      const minHealth = Math.min(
        ...batteryDevices.map((d) => (d.metadata as Record<string, unknown>)?.batteryHealthPercent as number ?? 100),
      );
      const maxCycles = Math.max(
        ...batteryDevices.map((d) => (d.metadata as Record<string, unknown>)?.batteryCycleCount as number ?? 0),
      );
      // Base cost 1.5p/kWh; increases by 0.02p per 100 cycles above 500;
      // adds 0.5p penalty when health drops below 80%.
      const cyclePenalty = maxCycles > 500 ? ((maxCycles - 500) / 100) * 0.02 : 0;
      const healthPenalty = minHealth < 80 ? 0.5 : 0;
      const dynamicCost = Math.max(1.5, 1.5 + cyclePenalty + healthPenalty);
      derivedDegradationCost = Number(dynamicCost.toFixed(3));
      resolvedInput = {
        ...resolvedInput,
        constraints: {
          ...resolvedInput.constraints,
          batteryDegradationCostPencePerKwh:
            resolvedInput.constraints.batteryDegradationCostPencePerKwh ?? derivedDegradationCost,
        },
      };
    }
  }

  // ── Real solar forecast overlay ─────────────────────────────────────────
  // If the caller supplied a real-world solar forecast, overlay those values
  // onto the simulated solarGenerationKwh forecast per slot.
  if (resolvedInput.solarForecastKwhPerSlot && resolvedInput.solarForecastKwhPerSlot.length === 48) {
    resolvedInput = {
      ...resolvedInput,
      forecasts: {
        ...resolvedInput.forecasts,
        solarGenerationKwh: resolvedInput.forecasts.solarGenerationKwh.map((point) => {
          const slotIndex =
            new Date(point.startAt).getUTCHours() * 2 +
            Math.floor(new Date(point.startAt).getUTCMinutes() / 30);
          const forecastValue = resolvedInput.solarForecastKwhPerSlot![slotIndex];
          return forecastValue != null && Number.isFinite(forecastValue)
            ? { ...point, value: forecastValue, confidence: 0.9 }
            : point;
        }),
      },
    };
  }

  // If the caller supplied a real-world consumption profile, overlay those
  // values onto the simulated householdLoadKwh forecast so every downstream
  // planner automatically benefits from the real data.
  if (resolvedInput.typicalLoadKwhPerSlot && resolvedInput.typicalLoadKwhPerSlot.length === 48) {
    resolvedInput = {
      ...resolvedInput,
      forecasts: {
        ...resolvedInput.forecasts,
        householdLoadKwh: resolvedInput.forecasts.householdLoadKwh.map((point) => {
          const slotIndex =
            new Date(point.startAt).getUTCHours() * 2 +
            Math.floor(new Date(point.startAt).getUTCMinutes() / 30);
          const profileValue = resolvedInput.typicalLoadKwhPerSlot![slotIndex];
          return profileValue != null && Number.isFinite(profileValue)
            ? { ...point, value: profileValue, confidence: 0.85 }
            : point;
        }),
      },
    };
  }

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

  // ── Negative-price slot detection ────────────────────────────────────────
  // Identify import slots where the tariff rate is negative. In these slots
  // Aveum maximises consumption (battery charging, EV charging, heat pump boost)
  // to earn by drawing from the grid.
  const avgImportRate =
    resolvedInput.tariffSchedule.importRates.reduce(
      (s, r) => s + r.unitRatePencePerKwh,
      0,
    ) / Math.max(1, resolvedInput.tariffSchedule.importRates.length);

  const negativePriceOpportunitySlots: NegativePriceSlot[] = resolvedInput.tariffSchedule.importRates
    .filter((r) => r.unitRatePencePerKwh < 0)
    .map((r) => ({
      startAt: r.startAt,
      endAt: r.endAt,
      ratePencePerKwh: r.unitRatePencePerKwh,
      savingPencePerKwh: Number((Math.abs(r.unitRatePencePerKwh) + Math.max(0, avgImportRate)).toFixed(3)),
    }));

  // ── Flux three-window arbitrage estimate ─────────────────────────────────
  // When the site is on Octopus Flux, compute the estimated profit from the
  // fixed three-window structure: off-peak 02:00–05:00 (charge), standard all
  // day, peak 16:00–19:00 (discharge).
  let fluxArbitrageProfitPounds: number | undefined;
  if (resolvedInput.tariffType === "flux") {
    const offPeakRates = resolvedInput.tariffSchedule.importRates.filter((r) => {
      const h = new Date(r.startAt).getUTCHours();
      return h >= 2 && h < 5;
    });
    const peakExportRates = (resolvedInput.tariffSchedule.exportRates ?? resolvedInput.tariffSchedule.importRates).filter(
      (r) => {
        const h = new Date(r.startAt).getUTCHours();
        return h >= 16 && h < 19;
      },
    );
    if (offPeakRates.length > 0 && peakExportRates.length > 0) {
      const avgOffPeak =
        offPeakRates.reduce((s, r) => s + r.unitRatePencePerKwh, 0) / offPeakRates.length;
      const avgPeakExport =
        peakExportRates.reduce((s, r) => s + r.unitRatePencePerKwh, 0) / peakExportRates.length;
      // Assume a typical 5 kWh cycle (3-hour off-peak window at 2 kW average charge).
      const cycleKwh = 5;
      const profitPence = (avgPeakExport - avgOffPeak) * cycleKwh;
      if (profitPence > 0) {
        fluxArbitrageProfitPounds = Number((profitPence / 100).toFixed(2));
      }
    }
  }

  // ── Partial export kWh ───────────────────────────────────────────────────────
  // When export decisions are present, estimate how much kWh can safely be
  // exported — capping at the surplus above the evening load reserve.
  let partialExportKwh: number | undefined;
  const hasExportDecision = result.decisions.some((d) => d.action === "export_to_grid");
  if (hasExportDecision) {
    const batteryDevice = resolvedInput.systemState.devices.find((d) => d.kind === "battery");
    if (batteryDevice) {
      const capacityKwh = batteryDevice.capacityKwh ?? 10;
      const currentSocKwh = ((batteryDevice.stateOfChargePercent ?? 50) / 100) * capacityKwh;
      const capturedAt = resolvedInput.systemState.capturedAt
        ? new Date(resolvedInput.systemState.capturedAt)
        : new Date();
      const currentSlotIndex =
        capturedAt.getUTCHours() * 2 + Math.floor(capturedAt.getUTCMinutes() / 30);
      const remainingLoadKwh = resolvedInput.typicalLoadKwhPerSlot
        ? resolvedInput.typicalLoadKwhPerSlot.slice(currentSlotIndex, 48).reduce((s, v) => s + v, 0)
        : 3.0;
      const exportable = Number(Math.max(0, currentSocKwh - remainingLoadKwh).toFixed(2));
      if (exportable > 0) partialExportKwh = exportable;
    }
  }

  // ── V2G / V2H discharge scheduling ──────────────────────────────────────────
  const evResult = scheduleV2GDischarge(resolvedInput, result.planId, result.generatedAt);

  // ── Export price gating ───────────────────────────────────────────────────────
  // When the export P70 benchmark is provided, skip export if today's peak rate
  // is below the historical 70th percentile.
  let exportSkippedReason: string | undefined;
  let exportPriceP70PencePerKwh: number | undefined;
  if (resolvedInput.exportPriceP70PencePerKwh != null) {
    const exportRates =
      resolvedInput.tariffSchedule.exportRates ?? resolvedInput.tariffSchedule.importRates;
    if (exportRates.length > 0) {
      const peakExportRate = Math.max(...exportRates.map((r) => r.unitRatePencePerKwh));
      exportPriceP70PencePerKwh = resolvedInput.exportPriceP70PencePerKwh;
      if (peakExportRate < resolvedInput.exportPriceP70PencePerKwh) {
        exportSkippedReason =
          `Today's peak export rate (${peakExportRate.toFixed(1)}p) is below the 70th-percentile benchmark ` +
          `(${resolvedInput.exportPriceP70PencePerKwh.toFixed(1)}p) — kept battery for self-consumption.`;
      }
    }
  }

  return {
    schemaVersion: result.schemaVersion,
    plannerVersion: result.plannerVersion,
    planId: result.planId,
    generatedAt: result.generatedAt,
    planningWindow: result.planningWindow,
    status,
    headline: explanation.headline,
    decisions: result.decisions,
    recommendedCommands: [
      ...(heatPumpSchedule ? [...result.recommendedCommands, ...heatPumpSchedule.commands] : result.recommendedCommands),
      ...(evResult ? [evResult.command] : []),
    ],
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
    negativePriceOpportunitySlots: negativePriceOpportunitySlots.length > 0 ? negativePriceOpportunitySlots : undefined,
    degradationCostPencePerKwh: derivedDegradationCost,
    fluxArbitrageProfitPounds,
    partialExportKwh,
    exportSkippedReason,
    v2gDischargeProfitPounds: evResult?.mode === "v2g" ? evResult.v2gDischargeProfitPounds : undefined,
    v2gDischargeKwh: evResult?.mode === "v2g" ? evResult.v2gDischargeKwh : undefined,
    v2hDischargeSavingsPounds: evResult?.mode === "v2h" ? evResult.v2hDischargeSavingsPounds : undefined,
    exportPriceP70PencePerKwh,
  };
}