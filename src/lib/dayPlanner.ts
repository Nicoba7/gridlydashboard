export type DayPlanSlot = {
  index: number;
  pricePence: number;
  action: "CHARGE" | "DISCHARGE" | "EXPORT" | "HOLD";
  socStartKwh: number;
  socEndKwh: number;
  importKwh: number;
  exportKwh: number;
  slotCostPounds: number;
};

export type DayPlanInput = {
  pricesPence: number[];
  loadKwh: number[];
  solarKwh: number[];
  currentSlot: number;
  batteryCapacityKwh: number;
  socStartKwh: number;
  minReserveKwh: number;
  maxChargePerSlotKwh: number;
  maxDischargePerSlotKwh: number;
  chargeEfficiency: number;
  dischargeEfficiency: number;
  exportEnabled: boolean;
};

export type DayPlanResult = {
  slots: DayPlanSlot[];
  baselineCostPounds: number;
  optimisedCostPounds: number;
  projectedSavingsPounds: number;
  nextAction: DayPlanSlot;
};

export function buildDayPlan(input: DayPlanInput): DayPlanResult {
  const {
    pricesPence,
    loadKwh,
    solarKwh,
    currentSlot,
    batteryCapacityKwh,
    socStartKwh,
    minReserveKwh,
    maxChargePerSlotKwh,
    maxDischargePerSlotKwh,
    chargeEfficiency,
    dischargeEfficiency,
    exportEnabled,
  } = input;

  const prices = pricesPence.map((p) => p / 100);
  const baselineCostPounds = prices.reduce((sum, price, i) => {
    const netLoad = Math.max(0, loadKwh[i] - solarKwh[i]);
    const excessSolar = Math.max(0, solarKwh[i] - loadKwh[i]);
    return sum + netLoad * price - (exportEnabled ? excessSolar * price : 0);
  }, 0);

  const sorted = [...pricesPence].sort((a, b) => a - b);
  const cheapThreshold = sorted[Math.floor(sorted.length * 0.25)] ?? 8;
  const expensiveThreshold = sorted[Math.floor(sorted.length * 0.8)] ?? 30;

  let soc = Math.max(minReserveKwh, Math.min(socStartKwh, batteryCapacityKwh));
  const slots: DayPlanSlot[] = [];

  for (let i = 0; i < prices.length; i++) {
    const price = prices[i];
    const pence = pricesPence[i];
    const socStart = soc;

    const netLoad = Math.max(0, loadKwh[i] - solarKwh[i]);
    const excessSolar = Math.max(0, solarKwh[i] - loadKwh[i]);

    let importKwh = 0;
    let exportKwh = 0;
    let action: DayPlanSlot["action"] = "HOLD";

    // Use excess solar to charge battery first.
    if (excessSolar > 0 && soc < batteryCapacityKwh) {
      const chargeIn = Math.min(excessSolar, maxChargePerSlotKwh, (batteryCapacityKwh - soc) / chargeEfficiency);
      soc += chargeIn * chargeEfficiency;
      const remainingExcess = excessSolar - chargeIn;
      if (remainingExcess > 0 && exportEnabled) {
        exportKwh += remainingExcess;
        action = "EXPORT";
      } else if (chargeIn > 0) {
        action = "CHARGE";
      }
    } else if (excessSolar > 0 && exportEnabled) {
      exportKwh += excessSolar;
      action = "EXPORT";
    }

    // Cover demand via battery during expensive windows.
    if (netLoad > 0 && pence >= expensiveThreshold && soc > minReserveKwh) {
      const dischargeOut = Math.min(netLoad, maxDischargePerSlotKwh, (soc - minReserveKwh) * dischargeEfficiency);
      soc -= dischargeOut / dischargeEfficiency;
      const residual = netLoad - dischargeOut;
      if (residual > 0) importKwh += residual;
      if (dischargeOut > 0 && action === "HOLD") action = "DISCHARGE";
    } else {
      importKwh += netLoad;
    }

    // Cheap window: top up from grid when room remains.
    if (i >= currentSlot && pence <= cheapThreshold && soc < batteryCapacityKwh) {
      const gridChargeIn = Math.min(maxChargePerSlotKwh, (batteryCapacityKwh - soc) / chargeEfficiency);
      if (gridChargeIn > 0) {
        soc += gridChargeIn * chargeEfficiency;
        importKwh += gridChargeIn;
        action = "CHARGE";
      }
    }

    // Export from battery in peak windows when above reserve.
    if (i >= currentSlot && exportEnabled && pence >= expensiveThreshold + 2 && soc > minReserveKwh + 0.5) {
      const dischargeToGrid = Math.min(maxDischargePerSlotKwh, (soc - minReserveKwh) * dischargeEfficiency);
      if (dischargeToGrid > 0) {
        soc -= dischargeToGrid / dischargeEfficiency;
        exportKwh += dischargeToGrid;
        action = "EXPORT";
      }
    }

    const slotCostPounds = importKwh * price - exportKwh * price;

    slots.push({
      index: i,
      pricePence: pence,
      action,
      socStartKwh: socStart,
      socEndKwh: soc,
      importKwh,
      exportKwh,
      slotCostPounds,
    });
  }

  const optimisedCostPounds = slots.reduce((sum, slot) => sum + slot.slotCostPounds, 0);
  const projectedSavingsPounds = baselineCostPounds - optimisedCostPounds;
  const nextAction =
    slots.slice(currentSlot).find((slot) => slot.action !== "HOLD") ??
    slots[currentSlot] ??
    slots[0];

  return {
    slots,
    baselineCostPounds,
    optimisedCostPounds,
    projectedSavingsPounds,
    nextAction,
  };
}
