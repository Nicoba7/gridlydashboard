/**
 * Deterministic home battery dispatch model.
 *
 * Rules are intentionally simple:
 * - absorb excess solar first
 * - discharge during expensive import windows while protecting reserve
 * - top up from the grid during cheap windows
 * - optionally export during strong export windows
 */

export interface BatteryModelConfig {
  capacityKwh: number;
  initialSocPercent: number;
  reservePercent: number;
  targetGridChargePercent: number;
  maxChargePowerW: number;
  maxDischargePowerW: number;
  chargeEfficiency: number;
  dischargeEfficiency: number;
  cheapChargeThresholdPence: number;
  dischargeThresholdPence: number;
  exportThresholdPence: number;
}

export interface BatteryStepInput {
  batterySocPercent: number;
  homeLoadKwh: number;
  solarGenerationKwh: number;
  evChargeRequestKwh: number;
  importRatePencePerKwh: number;
  exportRatePencePerKwh: number;
  slotDurationMinutes: number;
}

export interface BatteryStepResult {
  batterySocPercent: number;
  batteryChargeKwh: number;
  batteryDischargeKwh: number;
  gridImportKwh: number;
  gridExportKwh: number;
  solarToHomeKwh: number;
  solarToBatteryKwh: number;
  solarToGridKwh: number;
  batteryToHomeKwh: number;
  batteryToGridKwh: number;
  batteryPowerW: number;
}

export const DEFAULT_BATTERY_MODEL_CONFIG: BatteryModelConfig = {
  capacityKwh: 10.5,
  initialSocPercent: 62,
  reservePercent: 20,
  targetGridChargePercent: 82,
  maxChargePowerW: 5000,
  maxDischargePowerW: 5000,
  chargeEfficiency: 0.94,
  dischargeEfficiency: 0.94,
  cheapChargeThresholdPence: 8,
  dischargeThresholdPence: 22,
  exportThresholdPence: 20,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getBatteryChargeLimitKwh(
  slotDurationMinutes: number,
  config: BatteryModelConfig = DEFAULT_BATTERY_MODEL_CONFIG,
): number {
  return Number(((config.maxChargePowerW / 1000) * (slotDurationMinutes / 60)).toFixed(3));
}

export function getBatteryDischargeLimitKwh(
  slotDurationMinutes: number,
  config: BatteryModelConfig = DEFAULT_BATTERY_MODEL_CONFIG,
): number {
  return Number(((config.maxDischargePowerW / 1000) * (slotDurationMinutes / 60)).toFixed(3));
}

export function simulateBatteryStep(
  input: BatteryStepInput,
  config: BatteryModelConfig = DEFAULT_BATTERY_MODEL_CONFIG,
): BatteryStepResult {
  const chargeLimitKwh = getBatteryChargeLimitKwh(input.slotDurationMinutes, config);
  const dischargeLimitKwh = getBatteryDischargeLimitKwh(input.slotDurationMinutes, config);
  const reserveKwh = config.capacityKwh * (config.reservePercent / 100);
  const targetGridChargeKwh = config.capacityKwh * (config.targetGridChargePercent / 100);

  let storedKwh = config.capacityKwh * clamp(input.batterySocPercent, 0, 100) / 100;
  const totalDemandKwh = input.homeLoadKwh + input.evChargeRequestKwh;

  const solarToHomeKwh = Math.min(input.solarGenerationKwh, totalDemandKwh);
  let remainingDemandKwh = Number((totalDemandKwh - solarToHomeKwh).toFixed(3));
  let remainingSolarKwh = Number((input.solarGenerationKwh - solarToHomeKwh).toFixed(3));

  let batteryToHomeKwh = 0;
  if (remainingDemandKwh > 0 && input.importRatePencePerKwh >= config.dischargeThresholdPence) {
    const availableDischargeKwh = Math.max(0, (storedKwh - reserveKwh) * config.dischargeEfficiency);
    batteryToHomeKwh = Math.min(remainingDemandKwh, dischargeLimitKwh, availableDischargeKwh);
    storedKwh -= batteryToHomeKwh / config.dischargeEfficiency;
    remainingDemandKwh = Number((remainingDemandKwh - batteryToHomeKwh).toFixed(3));
  }

  let solarToBatteryKwh = 0;
  if (remainingSolarKwh > 0 && storedKwh < config.capacityKwh) {
    const chargeRoomInputKwh = (config.capacityKwh - storedKwh) / config.chargeEfficiency;
    solarToBatteryKwh = Math.min(remainingSolarKwh, chargeLimitKwh, chargeRoomInputKwh);
    storedKwh += solarToBatteryKwh * config.chargeEfficiency;
    remainingSolarKwh = Number((remainingSolarKwh - solarToBatteryKwh).toFixed(3));
  }

  let gridImportKwh = Math.max(0, remainingDemandKwh);
  let gridChargeKwh = 0;
  if (input.importRatePencePerKwh <= config.cheapChargeThresholdPence && storedKwh < targetGridChargeKwh) {
    const chargeRoomInputKwh = (targetGridChargeKwh - storedKwh) / config.chargeEfficiency;
    const remainingChargeCapacityKwh = Math.max(0, chargeLimitKwh - solarToBatteryKwh);
    gridChargeKwh = Math.min(chargeRoomInputKwh, remainingChargeCapacityKwh);
    storedKwh += gridChargeKwh * config.chargeEfficiency;
    gridImportKwh += gridChargeKwh;
  }

  let solarToGridKwh = Math.max(0, remainingSolarKwh);
  let batteryToGridKwh = 0;
  if (
    input.exportRatePencePerKwh >= config.exportThresholdPence &&
    input.importRatePencePerKwh >= config.dischargeThresholdPence &&
    storedKwh > reserveKwh + 0.5
  ) {
    const availableDischargeKwh = Math.max(0, (storedKwh - reserveKwh) * config.dischargeEfficiency);
    batteryToGridKwh = Math.min(dischargeLimitKwh, availableDischargeKwh);
    storedKwh -= batteryToGridKwh / config.dischargeEfficiency;
  }

  const batteryChargeKwh = Number((solarToBatteryKwh + gridChargeKwh).toFixed(3));
  const batteryDischargeKwh = Number((batteryToHomeKwh + batteryToGridKwh).toFixed(3));
  const gridExportKwh = Number((solarToGridKwh + batteryToGridKwh).toFixed(3));
  const batterySocPercent = Number(((storedKwh / config.capacityKwh) * 100).toFixed(1));
  const netBatteryKwh = batteryDischargeKwh - batteryChargeKwh;
  const batteryPowerW = Math.round((netBatteryKwh / (input.slotDurationMinutes / 60)) * 1000);

  return {
    batterySocPercent,
    batteryChargeKwh,
    batteryDischargeKwh,
    gridImportKwh: Number(gridImportKwh.toFixed(3)),
    gridExportKwh,
    solarToHomeKwh: Number(solarToHomeKwh.toFixed(3)),
    solarToBatteryKwh: Number(solarToBatteryKwh.toFixed(3)),
    solarToGridKwh: Number(solarToGridKwh.toFixed(3)),
    batteryToHomeKwh: Number(batteryToHomeKwh.toFixed(3)),
    batteryToGridKwh: Number(batteryToGridKwh.toFixed(3)),
    batteryPowerW,
  };
}