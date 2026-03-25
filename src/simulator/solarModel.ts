/**
 * Deterministic solar production model for the Aveum virtual home.
 *
 * The shape is intentionally simple: daylight hours create a smooth bell-like
 * curve with seasonal amplitude and a fixed weather factor.
 */

export interface SolarModelConfig {
  peakPowerW: number;
  sunriseHour: number;
  sunsetHour: number;
  seasonalAmplitude: number;
  weatherFactor: number;
  shapeExponent: number;
}

export const DEFAULT_SOLAR_MODEL_CONFIG: SolarModelConfig = {
  peakPowerW: 5200,
  sunriseHour: 6,
  sunsetHour: 19.5,
  seasonalAmplitude: 0.22,
  weatherFactor: 0.9,
  shapeExponent: 1.35,
};

function getDayOfYear(timestamp: Date): number {
  const start = new Date(timestamp.getFullYear(), 0, 0);
  const diff = timestamp.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

function getHourOfDay(timestamp: Date): number {
  return timestamp.getHours() + timestamp.getMinutes() / 60;
}

export function getSeasonalSolarFactor(
  timestamp: Date,
  config: SolarModelConfig = DEFAULT_SOLAR_MODEL_CONFIG,
): number {
  const dayOfYear = getDayOfYear(timestamp);
  const seasonalWave = Math.sin(((dayOfYear - 80) / 365) * Math.PI * 2);
  return 1 + seasonalWave * config.seasonalAmplitude;
}

export function getSolarShapeFactor(
  timestamp: Date,
  config: SolarModelConfig = DEFAULT_SOLAR_MODEL_CONFIG,
): number {
  const hour = getHourOfDay(timestamp);
  if (hour <= config.sunriseHour || hour >= config.sunsetHour) {
    return 0;
  }

  const daylightProgress = (hour - config.sunriseHour) / (config.sunsetHour - config.sunriseHour);
  const bell = Math.sin(Math.PI * daylightProgress);
  return Math.pow(Math.max(0, bell), config.shapeExponent);
}

export function simulateSolarPowerW(
  timestamp: Date,
  config: SolarModelConfig = DEFAULT_SOLAR_MODEL_CONFIG,
): number {
  const seasonal = getSeasonalSolarFactor(timestamp, config);
  const shape = getSolarShapeFactor(timestamp, config);
  return Math.round(config.peakPowerW * seasonal * config.weatherFactor * shape);
}

export function simulateSolarEnergyKwh(
  timestamp: Date,
  slotDurationMinutes = 30,
  config: SolarModelConfig = DEFAULT_SOLAR_MODEL_CONFIG,
): number {
  const powerW = simulateSolarPowerW(timestamp, config);
  return Number(((powerW / 1000) * (slotDurationMinutes / 60)).toFixed(3));
}