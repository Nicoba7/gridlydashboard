import type { TariffRate, TariffSchedule } from "../domain";

/**
 * Deterministic dynamic tariff model with cheap overnight charging windows,
 * a modest midday dip, and strong evening peaks.
 */

export interface TariffModelConfig {
  provider: string;
  name: string;
  regionCode: string;
  overnightFloorPence: number;
  daytimeBasePence: number;
  eveningPeakPence: number;
  middayDipPence: number;
  exportRatio: number;
  standingChargePencePerDay: number;
}

export const DEFAULT_TARIFF_MODEL_CONFIG: TariffModelConfig = {
  provider: "Octopus",
  name: "Virtual Agile",
  regionCode: "C",
  overnightFloorPence: 5.2,
  daytimeBasePence: 14,
  eveningPeakPence: 34,
  middayDipPence: 9.2,
  exportRatio: 0.72,
  standingChargePencePerDay: 52,
};

function getHourOfDay(timestamp: Date): number {
  return timestamp.getHours() + timestamp.getMinutes() / 60;
}

function gaussian(x: number, mean: number, width: number): number {
  const distance = (x - mean) / width;
  return Math.exp(-0.5 * distance * distance);
}

export function simulateImportRatePence(
  timestamp: Date,
  config: TariffModelConfig = DEFAULT_TARIFF_MODEL_CONFIG,
): number {
  const hour = getHourOfDay(timestamp);
  const isWeekend = timestamp.getDay() === 0 || timestamp.getDay() === 6;

  const overnightDiscount = hour < 5.5 ? config.daytimeBasePence - config.overnightFloorPence : 0;
  const middayDip = config.middayDipPence * gaussian(hour, 13, 2.2);
  const morningBump = 8 * gaussian(hour, 7.5, 1.6);
  const eveningPeak = config.eveningPeakPence * gaussian(hour, 17.75, 1.8);
  const weekendSoftener = isWeekend ? -1.2 : 0;

  const raw = config.daytimeBasePence - overnightDiscount - middayDip + morningBump + eveningPeak + weekendSoftener;
  return Number(Math.max(1.2, raw).toFixed(1));
}

export function simulateExportRatePence(
  timestamp: Date,
  config: TariffModelConfig = DEFAULT_TARIFF_MODEL_CONFIG,
): number {
  const importRate = simulateImportRatePence(timestamp, config);
  return Number(Math.max(2.5, importRate * config.exportRatio).toFixed(1));
}

export function buildTariffRate(
  startAt: Date,
  endAt: Date,
  unitRatePencePerKwh: number,
): TariffRate {
  return {
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    unitRatePencePerKwh,
    source: "estimated",
  };
}

export function buildTariffSchedule(
  startTime: Date,
  slots = 48,
  slotDurationMinutes = 30,
  config: TariffModelConfig = DEFAULT_TARIFF_MODEL_CONFIG,
): TariffSchedule {
  const importRates: TariffRate[] = [];
  const exportRates: TariffRate[] = [];

  for (let index = 0; index < slots; index += 1) {
    const startAt = new Date(startTime.getTime() + index * slotDurationMinutes * 60000);
    const endAt = new Date(startAt.getTime() + slotDurationMinutes * 60000);
    importRates.push(buildTariffRate(startAt, endAt, simulateImportRatePence(startAt, config)));
    exportRates.push(buildTariffRate(startAt, endAt, simulateExportRatePence(startAt, config)));
  }

  return {
    tariffId: "virtual-agile",
    provider: config.provider,
    name: config.name,
    regionCode: config.regionCode,
    currency: "GBP",
    updatedAt: new Date().toISOString(),
    importRates,
    exportRates,
    standingChargePencePerDay: config.standingChargePencePerDay,
  };
}