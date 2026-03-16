/**
 * Deterministic EV availability and charging demand model.
 */

export interface EvModelConfig {
  batteryCapacityKwh: number;
  initialSocPercent: number;
  minSocPercent: number;
  targetSocPercent: number;
  arrivalHour: number;
  departureHour: number;
  chargePowerW: number;
  preferredMaxImportRatePence: number;
  urgentReadyWindowHours: number;
  weekdayDrivingKwh: number;
  weekendDrivingKwh: number;
}

export const DEFAULT_EV_MODEL_CONFIG: EvModelConfig = {
  batteryCapacityKwh: 60,
  initialSocPercent: 44,
  minSocPercent: 18,
  targetSocPercent: 80,
  arrivalHour: 18,
  departureHour: 7.5,
  chargePowerW: 7400,
  preferredMaxImportRatePence: 10,
  urgentReadyWindowHours: 2,
  weekdayDrivingKwh: 11.5,
  weekendDrivingKwh: 6.5,
};

function getHourOfDay(timestamp: Date): number {
  return timestamp.getHours() + timestamp.getMinutes() / 60;
}

export function isEvConnectedAt(
  timestamp: Date,
  config: EvModelConfig = DEFAULT_EV_MODEL_CONFIG,
): boolean {
  const hour = getHourOfDay(timestamp);
  return hour >= config.arrivalHour || hour < config.departureHour;
}

export function getEvDrivingDemandKwh(
  timestamp: Date,
  slotDurationMinutes = 30,
  config: EvModelConfig = DEFAULT_EV_MODEL_CONFIG,
): number {
  if (isEvConnectedAt(timestamp, config)) {
    return 0;
  }

  const hour = getHourOfDay(timestamp);
  const driveStart = config.departureHour;
  const driveEnd = Math.max(config.departureHour + 1, config.arrivalHour);
  if (hour < driveStart || hour >= driveEnd) {
    return 0;
  }

  const isWeekend = timestamp.getDay() === 0 || timestamp.getDay() === 6;
  const dailyDrivingKwh = isWeekend ? config.weekendDrivingKwh : config.weekdayDrivingKwh;
  const driveHours = driveEnd - driveStart;
  const slotHours = slotDurationMinutes / 60;
  return Number(((dailyDrivingKwh / driveHours) * slotHours).toFixed(3));
}

export function getEvMaxChargeKwhPerSlot(
  slotDurationMinutes = 30,
  config: EvModelConfig = DEFAULT_EV_MODEL_CONFIG,
): number {
  return Number(((config.chargePowerW / 1000) * (slotDurationMinutes / 60)).toFixed(3));
}

export function getHoursUntilDeparture(
  timestamp: Date,
  config: EvModelConfig = DEFAULT_EV_MODEL_CONFIG,
): number {
  const hour = getHourOfDay(timestamp);
  if (hour < config.departureHour) {
    return config.departureHour - hour;
  }

  return 24 - hour + config.departureHour;
}

export function shouldChargeEv(params: {
  timestamp: Date;
  stateOfChargePercent: number;
  importRatePencePerKwh: number;
  availableSolarKwh: number;
  config?: EvModelConfig;
}): boolean {
  const config = params.config ?? DEFAULT_EV_MODEL_CONFIG;
  if (!isEvConnectedAt(params.timestamp, config)) {
    return false;
  }

  if (params.stateOfChargePercent >= config.targetSocPercent) {
    return false;
  }

  const urgent = getHoursUntilDeparture(params.timestamp, config) <= config.urgentReadyWindowHours;
  const cheap = params.importRatePencePerKwh <= config.preferredMaxImportRatePence;
  const solarRich = params.availableSolarKwh >= 0.5;
  return urgent || cheap || solarRich;
}