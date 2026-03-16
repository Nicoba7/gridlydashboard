import type { GridlyPlanSession } from "../types/planCompat";

type DecisionForecast = {
  solarForecastKwh?: number;
  evReadyBy?: string;
};

type DecisionTariff = {
  cheapestPrice?: number;
  peakPrice?: number;
  cheapestWindow?: string;
  peakWindow?: string;
  gridCondition?: string;
};

function formatPence(value?: number) {
  if (typeof value !== "number") return undefined;
  return `${value.toFixed(1)}p`;
}

function windowRange(start?: string, end?: string) {
  if (!start && !end) return undefined;
  if (start && end) return `${start}–${end}`;
  return start ?? end;
}

function compact(items: Array<string | undefined>) {
  return items.filter((item): item is string => Boolean(item)).slice(0, 4);
}

export function buildDecisionExplanation(
  session: GridlyPlanSession,
  forecast: DecisionForecast,
  tariff: DecisionTariff
) {
  const cheapest = formatPence(tariff.cheapestPrice ?? session.priceMin);
  const peak = formatPence(tariff.peakPrice ?? session.priceMax);
  const sessionWindow = windowRange(session.start, session.end);
  const solarStrong = (forecast.solarForecastKwh ?? 0) >= 10;
  const solarWindow = solarStrong ? "around midday" : undefined;
  const gridCondition = tariff.gridCondition ?? "Grid conditions remain stable overnight";

  if (session.type === "ev_charge") {
    return compact([
      cheapest ? `Overnight tariff is lowest at about ${cheapest}.` : "Overnight tariff is in a lower-cost window.",
      peak ? `Charging now avoids the evening peak near ${peak}.` : "Charging now avoids higher evening prices.",
      forecast.evReadyBy ? `Your EV is paced to be ready by ${forecast.evReadyBy}.` : "Your EV is paced to be ready before morning.",
      solarWindow ? `Battery is preserved for solar support ${solarWindow}.` : gridCondition,
    ]);
  }

  if (session.type === "battery_charge") {
    return compact([
      cheapest ? `Gridly charges storage when prices are near ${cheapest}.` : "Gridly charges storage in the cheapest overnight periods.",
      peak ? `Stored energy is kept for later windows near ${peak}.` : "Stored energy is held for higher-value windows later.",
      solarStrong ? `Solar forecast is strong, so charging stays measured.` : "Battery strategy keeps evening reserve protected.",
      gridCondition,
    ]);
  }

  if (session.type === "export") {
    return compact([
      tariff.peakWindow
        ? `Export prices are strongest around ${tariff.peakWindow}.`
        : peak
        ? `Export prices are peaking near ${peak}.`
        : "Export value is currently stronger than import value.",
      "Gridly stored energy earlier to use this export window.",
      solarStrong ? "Solar generation helps maintain home demand while exporting." : "Home reserve remains protected while exporting.",
      gridCondition,
    ]);
  }

  if (session.type === "solar_use") {
    return compact([
      solarStrong ? `Solar generation is expected ${solarWindow}.` : "Daylight generation is expected to cover home demand.",
      "Home demand is routed to solar first before importing from grid.",
      peak ? `Battery is preserved for the higher-value window near ${peak}.` : "Battery is preserved for evening support.",
      gridCondition,
    ]);
  }

  return compact([
    sessionWindow ? `No urgent action is required in ${sessionWindow}.` : "No urgent action is required in this window.",
    cheapest ? `Gridly waits for stronger value than ${cheapest} before moving energy.` : "Gridly waits for a stronger tariff signal before moving energy.",
    "Battery strategy remains available for later EV and evening needs.",
    gridCondition,
  ]);
}
