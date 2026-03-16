import type {
  Constraints,
  DeviceState,
  ForecastPoint,
  Forecasts,
  OptimizerInput,
  OptimizationMode,
  SystemState,
  TariffRate,
  TariffSchedule,
} from "../domain";
import {
  simulateForecasts,
  simulateSystemState,
  simulateTariffSchedule,
} from "../simulator";

export type LegacyPlanningStyle = "CHEAPEST" | "BALANCED" | "GREENEST";
export type LegacyConnectedDeviceId = "solar" | "battery" | "ev" | "grid";

export type LegacyRate = {
  time: string;
  pence: number;
};

export interface LegacyPlanContextInput {
  now: Date;
  rates: LegacyRate[];
  connectedDeviceIds: LegacyConnectedDeviceId[];
  planningStyle: LegacyPlanningStyle;
  solarForecastKwh: number;
  batteryStartPct: number;
  batteryCapacityKwh?: number;
  batteryReservePct?: number;
  maxBatteryCyclesPerDay?: number;
  evTargetKwh?: number;
  evReadyBy?: string;
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

function toIsoAtLocalTime(baseDate: Date, time: string): string {
  const { hours, minutes } = parseHHMM(time);
  const value = new Date(baseDate);
  value.setHours(hours, minutes, 0, 0);
  return value.toISOString();
}

function addMinutes(timestamp: string, minutes: number): string {
  return new Date(new Date(timestamp).getTime() + minutes * 60000).toISOString();
}

function toOptimizationMode(mode: LegacyPlanningStyle): OptimizationMode {
  if (mode === "CHEAPEST") return "cost";
  if (mode === "GREENEST") return "carbon";
  return "balanced";
}

function patchSystemStateDevices(
  systemState: SystemState,
  connectedDeviceIds: LegacyConnectedDeviceId[],
  batteryStartPct: number,
  batteryCapacityKwh?: number,
): SystemState {
  const connectedSet = new Set(connectedDeviceIds);
  const shouldKeep = new Set<string>(["home"]);
  connectedSet.forEach((id) => shouldKeep.add(id));

  const patchedDevices = systemState.devices
    .filter((device) => shouldKeep.has(device.deviceId))
    .map((device): DeviceState => {
      if (device.deviceId === "battery") {
        return {
          ...device,
          stateOfChargePercent: batteryStartPct,
          capacityKwh: batteryCapacityKwh ?? device.capacityKwh,
          connectionStatus: connectedSet.has("battery") ? "online" : "offline",
        };
      }

      if (device.deviceId === "ev") {
        return {
          ...device,
          connected: connectedSet.has("ev") ? device.connected : false,
          connectionStatus: connectedSet.has("ev") ? "online" : "offline",
        };
      }

      const deviceId = device.deviceId as LegacyConnectedDeviceId;
      return {
        ...device,
        connectionStatus: connectedSet.has(deviceId) ? "online" : "offline",
      };
    });

  return {
    ...systemState,
    devices: patchedDevices,
    batterySocPercent: connectedSet.has("battery") ? batteryStartPct : undefined,
    batteryCapacityKwh: connectedSet.has("battery")
      ? (batteryCapacityKwh ?? systemState.batteryCapacityKwh)
      : undefined,
    evConnected: connectedSet.has("ev") ? systemState.evConnected : false,
  };
}

function scaleSolarForecast(forecasts: Forecasts, targetTotalKwh: number): Forecasts {
  const currentTotal = forecasts.solarGenerationKwh.reduce((sum, point) => sum + point.value, 0);
  if (currentTotal <= 0 || targetTotalKwh <= 0) {
    return forecasts;
  }

  const multiplier = targetTotalKwh / currentTotal;
  const scaledSolar = forecasts.solarGenerationKwh.map((point): ForecastPoint => ({
    ...point,
    value: Number((point.value * multiplier).toFixed(3)),
  }));

  return {
    ...forecasts,
    solarGenerationKwh: scaledSolar,
  };
}

function applyCarbonOverride(forecasts: Forecasts, carbonIntensity?: number[]): Forecasts {
  if (!carbonIntensity?.length) {
    return forecasts;
  }

  const patched = forecasts.householdLoadKwh.map((loadPoint, index): ForecastPoint => {
    const fallback = forecasts.carbonIntensity?.[index]?.value ?? 185;
    return {
      startAt: loadPoint.startAt,
      endAt: loadPoint.endAt,
      value: carbonIntensity[index] ?? fallback,
      confidence: forecasts.carbonIntensity?.[index]?.confidence ?? 0.78,
    };
  });

  return {
    ...forecasts,
    carbonIntensity: patched,
  };
}

function buildTariffScheduleFromRates(
  now: Date,
  rates: LegacyRate[],
  exportPriceRatio = 0.72,
): TariffSchedule {
  const baseDate = new Date(now);
  baseDate.setHours(0, 0, 0, 0);
  const safeExportRatio = clamp(exportPriceRatio, 0.4, 1);
  const slotDurationMinutes = 30;

  const importRates: TariffRate[] = [];
  const exportRates: TariffRate[] = [];

  for (let index = 0; index < rates.length; index += 1) {
    const rate = rates[index];
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
      unitRatePencePerKwh: Number((rate.pence * safeExportRatio).toFixed(1)),
      source: "estimated",
    });
  }

  return {
    tariffId: "legacy-rates-bridge",
    provider: "Gridly",
    name: "Legacy Rates Bridge",
    currency: "GBP",
    updatedAt: now.toISOString(),
    importRates,
    exportRates,
  };
}

function computeEvTargetSocPercent(input: LegacyPlanContextInput, systemState: SystemState): number | undefined {
  if (input.evTargetKwh === undefined || !input.connectedDeviceIds.includes("ev")) {
    return undefined;
  }

  const evDevice = systemState.devices.find((device) => device.deviceId === "ev");
  const capacityKwh = evDevice?.capacityKwh;
  const evSoc = systemState.evSocPercent;
  if (capacityKwh === undefined || evSoc === undefined) {
    return undefined;
  }

  const additionalPercent = (input.evTargetKwh / capacityKwh) * 100;
  return Math.round(clamp(evSoc + additionalPercent, evSoc, 100));
}

function buildConstraints(input: LegacyPlanContextInput, systemState: SystemState): Constraints {
  const hasBattery = input.connectedDeviceIds.includes("battery");
  const hasGrid = input.connectedDeviceIds.includes("grid");
  const hasEv = input.connectedDeviceIds.includes("ev");

  return {
    mode: toOptimizationMode(input.planningStyle),
    batteryReservePercent: input.batteryReservePct,
    maxBatteryCyclesPerDay: input.maxBatteryCyclesPerDay,
    allowGridBatteryCharging: hasBattery && hasGrid,
    allowBatteryExport: hasBattery && hasGrid,
    allowAutomaticEvCharging: hasEv,
    evReadyBy: input.evReadyBy,
    evTargetSocPercent: computeEvTargetSocPercent(input, systemState),
  };
}

/**
 * Build canonical OptimizerInput from legacy Plan UI context.
 *
 * This is the migration seam that lets existing Plan screens keep their shape
 * while routing data through the canonical domain and optimizer contracts.
 */
export function buildOptimizerInputFromLegacyPlanContext(
  input: LegacyPlanContextInput,
): OptimizerInput {
  const slots = input.rates.length > 0 ? input.rates.length : 48;
  const baseSystemState = simulateSystemState(input.now);
  const systemState = patchSystemStateDevices(
    baseSystemState,
    input.connectedDeviceIds,
    input.batteryStartPct,
    input.batteryCapacityKwh,
  );

  const baseForecasts = simulateForecasts(input.now, slots);
  const scaledForecasts = scaleSolarForecast(baseForecasts, input.solarForecastKwh);
  const forecasts = applyCarbonOverride(scaledForecasts, input.carbonIntensity);

  const tariffSchedule = input.rates.length
    ? buildTariffScheduleFromRates(input.now, input.rates, input.exportPriceRatio)
    : simulateTariffSchedule(input.now, slots);

  return {
    systemState,
    forecasts,
    tariffSchedule,
    constraints: buildConstraints(input, systemState),
  };
}