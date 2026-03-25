import type {
  Constraints,
  DeviceState,
  ForecastPoint,
  Forecasts,
  OptimizerInput,
  OptimizationMode,
  TariffRate,
  TariffSchedule,
} from "../domain";
import {
  simulateForecasts,
  simulateSystemState,
  simulateTariffSchedule,
} from "../simulator";

export type HomeConnectedDeviceId = "solar" | "battery" | "ev" | "grid";

export interface HomeRate {
  time: string;
  pence: number;
}

export interface HomeOptimizerContextInput {
  now: Date;
  connectedDeviceIds: HomeConnectedDeviceId[];
  rates?: HomeRate[];
  planningMode?: OptimizationMode;
  batteryStartPct?: number;
  batteryCapacityKwh?: number;
  batteryReservePct?: number;
  maxBatteryCyclesPerDay?: number;
  evReadyBy?: string;
  evTargetSocPercent?: number;
  solarForecastKwh?: number;
  carbonIntensity?: number[];
  exportPriceRatio?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseHHMM(value: string): { hours: number; minutes: number } {
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number(hoursRaw ?? 0);
  const minutes = Number(minutesRaw ?? 0);

  return {
    hours: Number.isFinite(hours) ? clamp(Math.floor(hours), 0, 23) : 0,
    minutes: Number.isFinite(minutes) ? clamp(Math.floor(minutes), 0, 59) : 0,
  };
}

function addMinutes(timestamp: string, minutes: number): string {
  return new Date(new Date(timestamp).getTime() + minutes * 60000).toISOString();
}

function toIsoAtLocalTime(baseDate: Date, time: string): string {
  const { hours, minutes } = parseHHMM(time);
  const value = new Date(baseDate);
  value.setHours(hours, minutes, 0, 0);
  return value.toISOString();
}

function patchDevices(
  systemState: ReturnType<typeof simulateSystemState>,
  connectedDeviceIds: HomeConnectedDeviceId[],
  batteryStartPct?: number,
  batteryCapacityKwh?: number,
): ReturnType<typeof simulateSystemState> {
  const connected = new Set<HomeConnectedDeviceId>(connectedDeviceIds);
  const allowedDeviceIds = new Set<string>(["home", ...connectedDeviceIds]);

  const devices = systemState.devices
    .filter((device) => allowedDeviceIds.has(device.deviceId))
    .map((device): DeviceState => {
      if (device.deviceId === "battery") {
        return {
          ...device,
          stateOfChargePercent: batteryStartPct ?? device.stateOfChargePercent,
          capacityKwh: batteryCapacityKwh ?? device.capacityKwh,
          connectionStatus: connected.has("battery") ? "online" : "offline",
        };
      }

      if (device.deviceId === "ev") {
        return {
          ...device,
          connected: connected.has("ev") ? device.connected : false,
          connectionStatus: connected.has("ev") ? "online" : "offline",
        };
      }

      if (device.deviceId === "solar") {
        return {
          ...device,
          connectionStatus: connected.has("solar") ? "online" : "offline",
        };
      }

      if (device.deviceId === "grid") {
        return {
          ...device,
          connectionStatus: connected.has("grid") ? "online" : "offline",
        };
      }

      return device;
    });

  return {
    ...systemState,
    devices,
    batterySocPercent: connected.has("battery")
      ? (batteryStartPct ?? systemState.batterySocPercent)
      : undefined,
    batteryCapacityKwh: connected.has("battery")
      ? (batteryCapacityKwh ?? systemState.batteryCapacityKwh)
      : undefined,
    evConnected: connected.has("ev") ? systemState.evConnected : false,
  };
}

function scaleSolarForecast(forecasts: Forecasts, targetTotalKwh?: number): Forecasts {
  if (targetTotalKwh === undefined || targetTotalKwh <= 0) {
    return forecasts;
  }

  const currentTotal = forecasts.solarGenerationKwh.reduce((sum, point) => sum + point.value, 0);
  if (currentTotal <= 0) {
    return forecasts;
  }

  const multiplier = targetTotalKwh / currentTotal;
  const solarGenerationKwh = forecasts.solarGenerationKwh.map((point): ForecastPoint => ({
    ...point,
    value: Number((point.value * multiplier).toFixed(3)),
  }));

  return {
    ...forecasts,
    solarGenerationKwh,
  };
}

function applyCarbonOverride(forecasts: Forecasts, carbonIntensity?: number[]): Forecasts {
  if (!carbonIntensity?.length) {
    return forecasts;
  }

  const patched = forecasts.householdLoadKwh.map((loadPoint, index): ForecastPoint => ({
    startAt: loadPoint.startAt,
    endAt: loadPoint.endAt,
    value: carbonIntensity[index] ?? forecasts.carbonIntensity?.[index]?.value ?? 185,
    confidence: forecasts.carbonIntensity?.[index]?.confidence ?? 0.76,
  }));

  return {
    ...forecasts,
    carbonIntensity: patched,
  };
}

function mapRatesToTariff(
  now: Date,
  rates: HomeRate[],
  exportPriceRatio = 0.72,
): TariffSchedule {
  const baseDate = new Date(now);
  baseDate.setHours(0, 0, 0, 0);
  const slotDurationMinutes = 30;
  const ratio = clamp(exportPriceRatio, 0.4, 1);

  const importRates: TariffRate[] = [];
  const exportRates: TariffRate[] = [];

  for (const rate of rates) {
    const startAt = toIsoAtLocalTime(baseDate, rate.time);
    const endAt = addMinutes(startAt, slotDurationMinutes);

    importRates.push({
      startAt,
      endAt,
      unitRatePencePerKwh: Number(rate.pence.toFixed(1)),
      source: "live",
    });

    exportRates.push({
      startAt,
      endAt,
      unitRatePencePerKwh: Number((rate.pence * ratio).toFixed(1)),
      source: "estimated",
    });
  }

  return {
    tariffId: "home-rates-bridge",
    provider: "Aveum",
    name: "Home Rates Bridge",
    currency: "GBP",
    updatedAt: now.toISOString(),
    importRates,
    exportRates,
  };
}

function buildConstraints(input: HomeOptimizerContextInput): Constraints {
  const connected = new Set<HomeConnectedDeviceId>(input.connectedDeviceIds);

  return {
    mode: input.planningMode ?? "balanced",
    batteryReservePercent: input.batteryReservePct,
    maxBatteryCyclesPerDay: input.maxBatteryCyclesPerDay,
    allowGridBatteryCharging: connected.has("battery") && connected.has("grid"),
    allowBatteryExport: connected.has("battery") && connected.has("grid"),
    allowAutomaticEvCharging: connected.has("ev"),
    evReadyBy: input.evReadyBy,
    evTargetSocPercent: input.evTargetSocPercent,
  };
}

/**
 * Build canonical OptimizerInput for Home screen compatibility.
 *
 * This adapter keeps Home UI rendering stable while moving its data path to
 * the canonical domain and optimizer contracts.
 */
export function buildHomeOptimizerInput(input: HomeOptimizerContextInput): OptimizerInput {
  const slots = input.rates?.length || 48;

  const baseSystemState = simulateSystemState(input.now);
  const systemState = patchDevices(
    baseSystemState,
    input.connectedDeviceIds,
    input.batteryStartPct,
    input.batteryCapacityKwh,
  );

  const baseForecasts = simulateForecasts(input.now, slots);
  const withSolar = scaleSolarForecast(baseForecasts, input.solarForecastKwh);
  const forecasts = applyCarbonOverride(withSolar, input.carbonIntensity);

  const tariffSchedule = input.rates?.length
    ? mapRatesToTariff(input.now, input.rates, input.exportPriceRatio)
    : simulateTariffSchedule(input.now, slots);

  return {
    systemState,
    forecasts,
    tariffSchedule,
    constraints: buildConstraints(input),
  };
}