import type { BenchmarkStrategy } from "../runBenchmark";
import type { BenchmarkScenario } from "../types";

// ------------------------------------------------------------
// PredBat-like baseline (approximation)
// ------------------------------------------------------------
// Important:
// - This is NOT a reproduction of any competitor's exact internals.
// - It is a credible look-ahead baseline using simple greedy heuristics.
// - It deliberately stays solver-free and easy to inspect.
//
// High-level behavior:
// 1) EV: pick cheapest valid import slots before departure deadline;
//    force-charge in any slot where deadline pressure requires it.
// 2) Battery charge: pick cheap import slots, but skip any slot where
//    solar surplus covers the load (solar-aware charging).
// 3) Battery discharge: pick expensive import slots, but only when
//    the net value exceeds the battery degradation wear cost.
// 4) Apply decisions in time order while enforcing physical constraints.

const SLOT_HOURS = 0.5;

// Tunable knobs for this baseline strategy.
// Kept intentionally small/simple so founders can read and adjust.
const BATTERY_CHARGE_SLOT_LIMIT = 10;
const BATTERY_DISCHARGE_SLOT_LIMIT = 8;

// Battery wear cost subtracted from the value of every discharge kWh.
// Represents cell degradation cost per cycle amortised over capacity.
const BATTERY_DEGRADATION_COST_PENCE_PER_KWH = 1.5;

type SlotDecision = {
  slotIndex: number;
  evChargeKw: number;
  evChargeKwh: number;
  batteryChargeKw: number;
  batteryChargeKwh: number;
  batteryDischargeKw: number;
  batteryDischargeKwh: number;
  gridImportKwh: number;
  gridExportKwh: number;
  importPricePencePerKwh: number;
  exportPricePencePerKwh: number;
  solarGenerationKwh: number;
  batterySocKwhEnd: number;
  batteryReserveKwh: number;
};

function clamp(min: number, value: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toKwh(powerKw: number): number {
  return powerKw * SLOT_HOURS;
}

function toCost(pricePencePerKwh: number, energyKwh: number): number {
  return (pricePencePerKwh * energyKwh) / 100;
}

function isEvAvailableAtSlot(
  slotIndex: number,
  arrivalSlotIndex: number,
  departureSlotIndex: number
): boolean {
  // Supports cross-midnight connection windows.
  if (arrivalSlotIndex < departureSlotIndex) {
    return slotIndex >= arrivalSlotIndex && slotIndex < departureSlotIndex;
  }

  return slotIndex >= arrivalSlotIndex || slotIndex < departureSlotIndex;
}

function sortCheapestSlots(importPrices: number[], slotIndexes: number[]): number[] {
  // Tie-break on later slot to avoid "obviously too early" charging when prices are equal.
  return slotIndexes.slice().sort((a, b) => {
    const priceDiff = importPrices[a] - importPrices[b];
    if (priceDiff !== 0) {
      return priceDiff;
    }

    return b - a;
  });
}

function sortMostExpensiveSlots(importPrices: number[], slotIndexes: number[]): number[] {
  // Tie-break on earlier slot for expensive periods so evening peaks are used promptly.
  return slotIndexes.slice().sort((a, b) => {
    const priceDiff = importPrices[b] - importPrices[a];
    if (priceDiff !== 0) {
      return priceDiff;
    }

    return a - b;
  });
}

function buildEvPlanKwhBySlot(scenario: BenchmarkScenario): Map<number, number> {
  const evPlan = new Map<number, number>();

  if (!scenario.assets.hasEv) {
    return evPlan;
  }

  const ev = scenario.assets.ev;
  const importPrices = scenario.tariffs.importPricesPencePerKwh;
  const slotIndexes = Array.from({ length: scenario.slotCount }, (_, i) => i);

  const validEvSlots = slotIndexes.filter((slotIndex) =>
    isEvAvailableAtSlot(slotIndex, ev.arrivalSlotIndex, ev.departureSlotIndex)
  );

  const sortedSlots = sortCheapestSlots(importPrices, validEvSlots);

  let remainingNeedKwh = Math.max(0, ev.requiredChargeKwh - (ev.currentChargeKwh ?? 0));
  const maxEvKwhPerSlot = toKwh(ev.maxChargeKw ?? 7);

  for (const slotIndex of sortedSlots) {
    if (remainingNeedKwh <= 0) {
      break;
    }

    const plannedKwh = Math.min(maxEvKwhPerSlot, remainingNeedKwh);
    evPlan.set(slotIndex, plannedKwh);
    remainingNeedKwh -= plannedKwh;
  }

  return evPlan;
}

function buildBatterySlotSets(scenario: BenchmarkScenario): {
  chargeSlots: Set<number>;
  dischargeSlots: Set<number>;
} {
  const empty = { chargeSlots: new Set<number>(), dischargeSlots: new Set<number>() };

  if (!scenario.assets.hasBattery) {
    return empty;
  }

  const importPrices = scenario.tariffs.importPricesPencePerKwh;
  const slotIndexes = Array.from({ length: scenario.slotCount }, (_, i) => i);

  // Solar-awareness: skip grid-charge slots where solar covers the load.
  // In those slots the battery will be filled by solar anyway — no need
  // to also pull from the grid.
  const nonSolarSurplusSlots = slotIndexes.filter((i) => {
    const solarKwh = toKwh(scenario.solar.generationKwBySlot[i] ?? 0);
    const loadKwh = toKwh(scenario.load.demandKwBySlot[i] ?? 0);
    return solarKwh <= loadKwh; // solar surplus → skip grid charge for this slot
  });

  // Choose cheapest non-surplus slots for grid charge.
  const cheapest = sortCheapestSlots(importPrices, nonSolarSurplusSlots).slice(0, BATTERY_CHARGE_SLOT_LIMIT);

  // Discharge: most expensive slots, excluding those already chosen for charging.
  // Only slots where the import price exceeds the degradation cost are worth discharging.
  const cheapestSet = new Set<number>(cheapest);
  const expensive = sortMostExpensiveSlots(importPrices, slotIndexes)
    .filter((slot) => !cheapestSet.has(slot) && importPrices[slot] > BATTERY_DEGRADATION_COST_PENCE_PER_KWH)
    .slice(0, BATTERY_DISCHARGE_SLOT_LIMIT);

  return {
    chargeSlots: cheapestSet,
    dischargeSlots: new Set<number>(expensive),
  };
}

function runPredbatLikeScenario(scenario: BenchmarkScenario) {
  const hasBattery = scenario.assets.hasBattery;
  const hasEv = scenario.assets.hasEv;
  const hasGridExport = scenario.assets.hasGridExport;

  const battery = scenario.assets.battery;
  const ev = scenario.assets.ev;

  const slotIndexes = Array.from({ length: scenario.slotCount }, (_, i) => i);
  const maxEvKwhPerSlot = toKwh(ev.maxChargeKw ?? 7);

  // Build the price-optimal EV charge plan (cheapest valid slots first).
  const evPlanKwhBySlot = buildEvPlanKwhBySlot(scenario);

  // Pre-compute the set of EV-available slots for deadline pressure checks.
  const validEvSlots = slotIndexes.filter((i) =>
    isEvAvailableAtSlot(i, ev.arrivalSlotIndex, ev.departureSlotIndex)
  );

  const { chargeSlots, dischargeSlots } = buildBatterySlotSets(scenario);

  let batterySocKwh = clamp(0, battery.initialSocKwh, battery.capacityKwh);
  let evChargeKwh = clamp(0, ev.currentChargeKwh ?? 0, ev.requiredChargeKwh);

  let totalImportKwh = 0;
  let totalExportKwh = 0;
  let totalImportCost = 0;
  let totalExportRevenue = 0;
  let totalSolarKwh = 0;
  let totalBatteryChargeKwh = 0;
  let totalBatteryDischargeKwh = 0;

  const decisions: SlotDecision[] = [];

  for (let slotIndex = 0; slotIndex < scenario.slotCount; slotIndex += 1) {
    const loadKwh = toKwh(scenario.load.demandKwBySlot[slotIndex] ?? 0);
    const solarKwh = toKwh(scenario.solar.generationKwBySlot[slotIndex] ?? 0);

    totalSolarKwh += solarKwh;

    // Positive means import need, negative means surplus.
    let netDemandKwh = loadKwh - solarKwh;

    // EV charging: use price-optimal plan, but also force-charge when
    // deadline pressure means the target won't be met otherwise.
    let evChargeKw = 0;
    let evChargeKwhThisSlot = 0;
    if (hasEv && isEvAvailableAtSlot(slotIndex, ev.arrivalSlotIndex, ev.departureSlotIndex)) {
      const evRemainingNeed = Math.max(0, ev.requiredChargeKwh - evChargeKwh);

      // Count slots remaining (including this one) before departure.
      const slotsRemaining = validEvSlots.filter((i) => i >= slotIndex).length;
      const maxDeliverableKwh = slotsRemaining * maxEvKwhPerSlot;
      const mustChargeNow = evRemainingNeed > 0 && evRemainingNeed >= maxDeliverableKwh;

      const plannedEvKwh = evPlanKwhBySlot.get(slotIndex) ?? 0;
      const targetKwh = mustChargeNow
        ? Math.min(maxEvKwhPerSlot, evRemainingNeed)
        : Math.min(plannedEvKwh, evRemainingNeed);

      if (targetKwh > 0) {
        evChargeKwhThisSlot = targetKwh;
        evChargeKw = evChargeKwhThisSlot / SLOT_HOURS;
        evChargeKwh += evChargeKwhThisSlot;
        netDemandKwh += evChargeKwhThisSlot;
      }
    }

    // Battery discharge on expensive slots (respect reserve, power, demand, and
    // degradation cost — only discharge when import price net of wear is positive).
    let batteryDischargeKw = 0;
    let batteryDischargeKwhThisSlot = 0;
    const importPrice = scenario.tariffs.importPricesPencePerKwh[slotIndex] ?? 0;
    const exportPrice = scenario.tariffs.exportPricesPencePerKwh[slotIndex] ?? 0;
    const netDischargeValuePencePerKwh = importPrice - BATTERY_DEGRADATION_COST_PENCE_PER_KWH;
    if (hasBattery && dischargeSlots.has(slotIndex) && netDischargeValuePencePerKwh > 0) {
      const maxDischargeKwhThisSlot = toKwh(Math.max(0, battery.maxDischargeKw));
      const availableAboveReserveKwh = Math.max(0, batterySocKwh - battery.reserveSocKwh);

      batteryDischargeKwhThisSlot = Math.min(
        Math.max(0, netDemandKwh),
        maxDischargeKwhThisSlot,
        availableAboveReserveKwh
      );

      if (batteryDischargeKwhThisSlot > 0) {
        batteryDischargeKw = batteryDischargeKwhThisSlot / SLOT_HOURS;
        batterySocKwh -= batteryDischargeKwhThisSlot;
        totalBatteryDischargeKwh += batteryDischargeKwhThisSlot;
        netDemandKwh -= batteryDischargeKwhThisSlot;
      }
    }

    // Battery charge on cheap slots (respect capacity and power)
    let batteryChargeKw = 0;
    let batteryChargeKwhThisSlot = 0;
    if (hasBattery && chargeSlots.has(slotIndex)) {
      const maxChargeKwhThisSlot = toKwh(Math.max(0, battery.maxChargeKw));
      const availableHeadroomKwh = Math.max(0, battery.capacityKwh - batterySocKwh);

      batteryChargeKwhThisSlot = Math.min(maxChargeKwhThisSlot, availableHeadroomKwh);

      if (batteryChargeKwhThisSlot > 0) {
        batteryChargeKw = batteryChargeKwhThisSlot / SLOT_HOURS;
        batterySocKwh += batteryChargeKwhThisSlot;
        totalBatteryChargeKwh += batteryChargeKwhThisSlot;
        netDemandKwh += batteryChargeKwhThisSlot;
      }
    }

    const gridImportKwh = Math.max(0, netDemandKwh);
    const gridExportKwh = hasGridExport ? Math.max(0, -netDemandKwh) : 0;

    totalImportKwh += gridImportKwh;
    totalExportKwh += gridExportKwh;

    totalImportCost += toCost(importPrice, gridImportKwh);
    totalExportRevenue += toCost(exportPrice, gridExportKwh);

    decisions.push({
      slotIndex,
      evChargeKw,
      evChargeKwh: evChargeKwhThisSlot,
      batteryChargeKw,
      batteryChargeKwh: batteryChargeKwhThisSlot,
      batteryDischargeKw,
      batteryDischargeKwh: batteryDischargeKwhThisSlot,
      gridImportKwh,
      gridExportKwh,
      importPricePencePerKwh: importPrice,
      exportPricePencePerKwh: exportPrice,
      solarGenerationKwh: solarKwh,
      batterySocKwhEnd: batterySocKwh,
      batteryReserveKwh: battery.reserveSocKwh,
    });
  }

  const totalNetCost = totalImportCost - totalExportRevenue;
  const evTargetMet = evChargeKwh >= ev.requiredChargeKwh;
  const batteryCycles =
    battery.capacityKwh > 0
      ? (totalBatteryChargeKwh + totalBatteryDischargeKwh) / (2 * battery.capacityKwh)
      : 0;

  const selfConsumptionRatio =
    totalSolarKwh > 0
      ? clamp(0, (totalSolarKwh - totalExportKwh) / totalSolarKwh, 1)
      : undefined;

  return {
    metrics: {
      totalImportCost,
      totalExportRevenue,
      totalNetCost,
      selfConsumptionRatio,
      batteryCycles,
      evTargetMet,
    },
    decisions,
    telemetry: {
      evRequiredChargeKwh: ev.requiredChargeKwh,
      batteryCapacityKwh: battery.capacityKwh,
    },
    debug: {
      strategyType: "predbat-like-greedy-baseline",
      approximationNote:
        "This is a simple greedy approximation for benchmarking, not an exact competitor replica.",
      enhancements: ["solar-aware-charging", "ev-deadline-pressure", "battery-degradation-cost"],
      batteryDegradationCostPencePerKwh: BATTERY_DEGRADATION_COST_PENCE_PER_KWH,
      plannedSlotCounts: {
        evChargeSlots: evPlanKwhBySlot.size,
        batteryChargeSlots: chargeSlots.size,
        batteryDischargeSlots: dischargeSlots.size,
      },
      totals: {
        totalImportKwh,
        totalExportKwh,
        totalSolarKwh,
        finalBatterySocKwh: batterySocKwh,
        finalEvChargeKwh: evChargeKwh,
      },
    },
  };
}

export const predbatLikeStrategy: BenchmarkStrategy = {
  id: "predbat-like",
  name: "PredBat-like (Greedy)",
  run: runPredbatLikeScenario,
};

export default predbatLikeStrategy;
