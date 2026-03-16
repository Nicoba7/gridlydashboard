import type {
  Constraints,
  DeviceState,
  ForecastPoint,
  Forecasts,
  OptimizerInput,
  TariffRate,
  TariffSchedule,
} from "../domain";
import {
  simulateForecasts,
  simulateSystemState,
  simulateTariffSchedule,
} from "../simulator";

export type IndexConnectedDeviceId = "solar" | "battery" | "ev" | "grid";

export interface IndexRate {
  from: Date;
  to: Date;
  pence: number;
}

export interface IndexOptimizerContextInput {
  now: Date;
  rates: IndexRate[];
  connectedDeviceIds: IndexConnectedDeviceId[];
  batteryStartPct?: number;
  batteryCapacityKwh?: number;
  householdPowerW?: number;
  solarForecastKwh?: number;
}

function patchDevices(
  systemState: ReturnType<typeof simulateSystemState>,
  connectedDeviceIds: IndexConnectedDeviceId[],
  batteryStartPct?: number,
  batteryCapacityKwh?: number,
): ReturnType<typeof simulateSystemState> {
  const connected = new Set<IndexConnectedDeviceId>(connectedDeviceIds);
  const allowedIds = new Set<string>(["home", ...connectedDeviceIds]);

  const devices = systemState.devices
    .filter((device) => allowedIds.has(device.deviceId))
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

function applyHouseholdLoadOverride(
  forecasts: Forecasts,
  householdPowerW?: number,
): Forecasts {
  if (householdPowerW === undefined || householdPowerW <= 0) {
    return forecasts;
  }

  const perSlotKwh = householdPowerW / 1000 / 2;
  const householdLoadKwh = forecasts.householdLoadKwh.map((point): ForecastPoint => ({
    ...point,
    value: Number(Math.max(perSlotKwh, 0.2).toFixed(3)),
  }));

  return {
    ...forecasts,
    householdLoadKwh,
  };
}

function scaleSolarForecast(
  forecasts: Forecasts,
  targetTotalSolarKwh?: number,
): Forecasts {
  if (targetTotalSolarKwh === undefined || targetTotalSolarKwh <= 0) {
    return forecasts;
  }

  const currentTotal = forecasts.solarGenerationKwh.reduce((sum, point) => sum + point.value, 0);
  if (currentTotal <= 0) {
    return forecasts;
  }

  const multiplier = targetTotalSolarKwh / currentTotal;
  const solarGenerationKwh = forecasts.solarGenerationKwh.map((point): ForecastPoint => ({
    ...point,
    value: Number((point.value * multiplier).toFixed(3)),
  }));

  return {
    ...forecasts,
    solarGenerationKwh,
  };
}

function mapRatesToTariff(now: Date, rates: IndexRate[]): TariffSchedule {
  const importRates: TariffRate[] = rates.map((rate) => ({
    startAt: rate.from.toISOString(),
    endAt: rate.to.toISOString(),
    unitRatePencePerKwh: Number(rate.pence.toFixed(1)),
    source: "live",
  }));

  const exportRates: TariffRate[] = rates.map((rate) => ({
    startAt: rate.from.toISOString(),
    endAt: rate.to.toISOString(),
    unitRatePencePerKwh: Number(Math.max(0.1, (rate.pence * 0.72)).toFixed(1)),
    source: "estimated",
  }));

  return {
    tariffId: "index-rates-bridge",
    provider: "Gridly",
    name: "Index Rates Bridge",
    currency: "GBP",
    updatedAt: now.toISOString(),
    importRates,
    exportRates,
  };
}

function buildConstraints(connectedDeviceIds: IndexConnectedDeviceId[]): Constraints {
  const connected = new Set<IndexConnectedDeviceId>(connectedDeviceIds);
  const hasBattery = connected.has("battery");
  const hasGrid = connected.has("grid");

  return {
    mode: "balanced",
    batteryReservePercent: 30,
    maxBatteryCyclesPerDay: 2,
    allowGridBatteryCharging: hasBattery && hasGrid,
    allowBatteryExport: hasBattery && hasGrid,
    allowAutomaticEvCharging: connected.has("ev"),
    evReadyBy: "07:00",
    evTargetSocPercent: 85,
  };
}

/**
 * Build canonical OptimizerInput for the Index page.
 */
export function buildIndexOptimizerInput(input: IndexOptimizerContextInput): OptimizerInput {
  const slots = input.rates.length || 48;
  const baseSystemState = simulateSystemState(input.now);
  const systemState = patchDevices(
    baseSystemState,
    input.connectedDeviceIds,
    input.batteryStartPct,
    input.batteryCapacityKwh,
  );

  const baseForecasts = simulateForecasts(input.now, slots);
  const withLoad = applyHouseholdLoadOverride(baseForecasts, input.householdPowerW);
  const forecasts = scaleSolarForecast(withLoad, input.solarForecastKwh);

  const tariffSchedule = input.rates.length
    ? mapRatesToTariff(input.now, input.rates)
    : simulateTariffSchedule(input.now, slots);

  return {
    systemState,
    forecasts,
    tariffSchedule,
    constraints: buildConstraints(input.connectedDeviceIds),
  };
}