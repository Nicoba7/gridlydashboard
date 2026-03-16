/**
 * First working optimizer entry point for Gridly.
 *
 * This is intentionally simple and deterministic so we can safely wire UX
 * while keeping behavior easy for founders and reviewers to reason about.
 */

import type {
  Diagnostic,
  EngineAction,
  GridlyInput,
  GridlyOutput,
  Recommendation,
} from "../types";

const LOW_IMPORT_THRESHOLD = 0.15;
const HIGH_EXPORT_THRESHOLD = 0.25;
const LOW_BATTERY_RESERVE = 20;
const STRONG_SOLAR_AVG_THRESHOLD = 1.2;
const STRONG_SOLAR_PEAK_THRESHOLD = 2.5;
const SOLAR_LOOKAHEAD_SLOTS = 2;

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pickAction(
  importPrice: number,
  exportPrice: number | undefined,
  batterySocPercent: number,
): { action: EngineAction; reason: string; value: number; confidence: number } {
  const lowBattery = batterySocPercent <= LOW_BATTERY_RESERVE;

  // Protect reserve first: if battery is low, avoid actions that consume reserve.
  if (lowBattery && exportPrice !== undefined && exportPrice >= HIGH_EXPORT_THRESHOLD) {
    return {
      action: "hold",
      reason: "Export price is attractive, but Gridly is protecting battery reserve.",
      value: 0.55,
      confidence: 0.8,
    };
  }

  // Charge when import is cheap; this stores energy for later expensive periods.
  if (importPrice <= LOW_IMPORT_THRESHOLD) {
    return {
      action: "charge",
      reason: "Import price is in a cheap window, so Gridly charges for later use.",
      value: 0.85,
      confidence: 0.9,
    };
  }

  // Export when export value is strong and reserve is healthy enough.
  if (!lowBattery && exportPrice !== undefined && exportPrice >= HIGH_EXPORT_THRESHOLD) {
    return {
      action: "export",
      reason: "Export price is high, so Gridly can sell surplus value back to the grid.",
      value: 0.8,
      confidence: 0.86,
    };
  }

  // Default safe behavior when there is no clear market opportunity.
  return {
    action: "hold",
    reason: "Prices are neutral right now, so Gridly holds energy for later.",
    value: 0.5,
    confidence: 0.75,
  };
}

/** @deprecated use optimize(input) from src/optimizer/engine */
export function optimizePlan(input: GridlyInput): GridlyOutput {
  const diagnostics: Diagnostic[] = [];
  const avgImportPrice = average(input.importPrice);
  const avgSolarForecast = average(input.forecastSolarKwh);
  const peakSolarForecast = input.forecastSolarKwh.reduce((peak, value) => Math.max(peak, value), 0);

  const cheapWindowDetected = input.importPrice.some((price) => price <= LOW_IMPORT_THRESHOLD);
  const exportOpportunityDetected = (input.exportPrice ?? []).some(
    (price) => price >= HIGH_EXPORT_THRESHOLD,
  );
  const lowBatteryReserve = input.batterySocPercent <= LOW_BATTERY_RESERVE;
  const strongSolarForecast =
    avgSolarForecast >= STRONG_SOLAR_AVG_THRESHOLD || peakSolarForecast >= STRONG_SOLAR_PEAK_THRESHOLD;

  if (lowBatteryReserve) {
    diagnostics.push({
      code: "LOW_BATTERY_RESERVE",
      message: "Battery reserve is low, so Gridly is prioritizing energy protection.",
      severity: "warning",
    });
  }

  if (cheapWindowDetected) {
    diagnostics.push({
      code: "CHEAP_CHARGING_WINDOW",
      message: "A low import-price window was detected and can be used for charging.",
      severity: "info",
    });
  }

  if (exportOpportunityDetected) {
    diagnostics.push({
      code: "EXPORT_OPPORTUNITY",
      message: "A strong export-price window was detected for potential sell-back.",
      severity: "info",
    });
  }

  if (strongSolarForecast) {
    diagnostics.push({
      code: "STRONG_SOLAR_FORECAST",
      message: "Strong solar generation is expected, so Gridly is avoiding unnecessary charging.",
      severity: "info",
    });
  }

  const recommendations: Recommendation[] = input.importPrice.map((price, slot) => {
    const exportPrice = input.exportPrice?.[slot];
    const decision = pickAction(price, exportPrice, input.batterySocPercent);

    // If strong solar is coming soon, soften near-term charging decisions.
    const hasSolarSoon = input.forecastSolarKwh
      .slice(slot + 1, slot + 1 + SOLAR_LOOKAHEAD_SLOTS)
      .some((solarKwh) => solarKwh >= STRONG_SOLAR_PEAK_THRESHOLD);

    const shouldSoftenCharge = strongSolarForecast && hasSolarSoon && decision.action === "charge";

    return shouldSoftenCharge
      ? {
          slot,
          action: "hold",
          reason: "Strong solar is expected soon, so Gridly avoids unnecessary pre-charging.",
          value: 0.68,
          confidence: 0.84,
        }
      : {
          slot,
          action: decision.action,
          reason: decision.reason,
          value: decision.value,
          confidence: decision.confidence,
        };
  });

  const timeline = recommendations.map((item) => ({
    slot: item.slot,
    action: item.action,
    reason: item.reason,
  }));

  const actionCounts = recommendations.reduce<Record<EngineAction, number>>(
    (counts, item) => {
      counts[item.action] += 1;
      return counts;
    },
    { charge: 0, discharge: 0, hold: 0, import: 0, export: 0 },
  );

  // Simple deterministic counterfactual math (believable but intentionally lightweight):
  // - baseline assumes all load is imported at average import price
  // - Gridly reduces cost in cheap charge slots and improves value in export slots
  const totalForecastLoad = input.forecastLoadKwh.reduce((sum, value) => sum + value, 0);
  const baselineWithoutGridly = totalForecastLoad * avgImportPrice;
  const chargeBenefit = actionCounts.charge * 0.12;
  const exportBenefit = actionCounts.export * 0.18;
  const reservePenalty = lowBatteryReserve ? 0.08 : 0;
  const improvementFactor = Math.max(
    0.02,
    Math.min(0.22, chargeBenefit + exportBenefit - reservePenalty),
  );
  const withGridly = Number((baselineWithoutGridly * (1 - improvementFactor)).toFixed(2));
  const withoutGridly = Number(baselineWithoutGridly.toFixed(2));
  const savings = Number((withoutGridly - withGridly).toFixed(2));

  const headline =
    actionCounts.export > 0
      ? "Gridly sees a strong export opportunity"
      : actionCounts.charge > 0
        ? "Gridly is charging while prices are low"
        : "Gridly is holding energy for later";

  const subheadline =
    actionCounts.export > 0
      ? "Higher export prices make selected sell-back slots worthwhile."
      : actionCounts.charge > 0
        ? "Import prices are low enough in key slots to store cheaper energy."
        : "Import prices are not yet low enough to justify charging.";

  const overallConfidence = Number(
    average(recommendations.map((item) => item.confidence ?? 0.75)).toFixed(2),
  );

  return {
    headline,
    subheadline,
    recommendations,
    timeline,
    counterfactual: {
      withGridly,
      withoutGridly,
      savings,
    },
    diagnostics,
    confidence: overallConfidence,
  };
}
