/**
 * Deterministic household demand model with morning and evening peaks.
 */

export interface LoadModelConfig {
  baseLoadW: number;
  overnightReductionW: number;
  daytimeBumpW: number;
  morningPeakW: number;
  eveningPeakW: number;
  morningPeakHour: number;
  eveningPeakHour: number;
  peakWidthHours: number;
  weekendDaytimeBoostW: number;
}

export const DEFAULT_LOAD_MODEL_CONFIG: LoadModelConfig = {
  baseLoadW: 420,
  overnightReductionW: 120,
  daytimeBumpW: 140,
  morningPeakW: 900,
  eveningPeakW: 1700,
  morningPeakHour: 7.5,
  eveningPeakHour: 18.5,
  peakWidthHours: 1.75,
  weekendDaytimeBoostW: 180,
};

function getHourOfDay(timestamp: Date): number {
  return timestamp.getHours() + timestamp.getMinutes() / 60;
}

function gaussian(x: number, mean: number, width: number): number {
  const distance = (x - mean) / width;
  return Math.exp(-0.5 * distance * distance);
}

export function simulateHouseholdLoadW(
  timestamp: Date,
  config: LoadModelConfig = DEFAULT_LOAD_MODEL_CONFIG,
): number {
  const hour = getHourOfDay(timestamp);
  const isWeekend = timestamp.getDay() === 0 || timestamp.getDay() === 6;

  const overnight = hour < 5 ? -config.overnightReductionW : 0;
  const daytime = hour >= 10 && hour < 16 ? config.daytimeBumpW : 0;
  const weekend = isWeekend && hour >= 9 && hour < 17 ? config.weekendDaytimeBoostW : 0;
  const morningPeak = config.morningPeakW * gaussian(hour, config.morningPeakHour, config.peakWidthHours);
  const eveningPeak = config.eveningPeakW * gaussian(hour, config.eveningPeakHour, config.peakWidthHours);

  return Math.round(
    config.baseLoadW + Math.max(0, overnight) + daytime + weekend + morningPeak + eveningPeak,
  );
}

export function simulateHouseholdLoadKwh(
  timestamp: Date,
  slotDurationMinutes = 30,
  config: LoadModelConfig = DEFAULT_LOAD_MODEL_CONFIG,
): number {
  const powerW = simulateHouseholdLoadW(timestamp, config);
  return Number(((powerW / 1000) * (slotDurationMinutes / 60)).toFixed(3));
}