import type {
  DeviceState,
  ForecastPoint,
  Forecasts,
  SystemState,
  TariffSchedule,
} from "../domain";
import {
  DEFAULT_BATTERY_MODEL_CONFIG,
  type BatteryModelConfig,
  simulateBatteryStep,
} from "./batteryModel";
import {
  DEFAULT_EV_MODEL_CONFIG,
  type EvModelConfig,
  getEvDrivingDemandKwh,
  getEvMaxChargeKwhPerSlot,
  isEvConnectedAt,
  shouldChargeEv,
} from "./evModel";
import {
  DEFAULT_LOAD_MODEL_CONFIG,
  type LoadModelConfig,
  simulateHouseholdLoadKwh,
  simulateHouseholdLoadW,
} from "./loadModel";
import {
  DEFAULT_SOLAR_MODEL_CONFIG,
  type SolarModelConfig,
  simulateSolarEnergyKwh,
  simulateSolarPowerW,
} from "./solarModel";
import {
  DEFAULT_TARIFF_MODEL_CONFIG,
  buildTariffSchedule,
  type TariffModelConfig,
  simulateExportRatePence,
  simulateImportRatePence,
} from "./tariffModel";

export interface VirtualHomeConfig {
  siteId: string;
  timezone: string;
  slotDurationMinutes: number;
  solar: SolarModelConfig;
  load: LoadModelConfig;
  battery: BatteryModelConfig;
  ev: EvModelConfig;
  tariff: TariffModelConfig;
}

export interface LegacySandboxTariffOption {
  id: string;
  name: string;
  annualSaving: number;
  current: boolean;
  badge: string | null;
}

export interface LegacyHistoryDay {
  day: string;
  solar: number;
  battery: number;
  ev: number;
  grid: number;
}

export interface LegacyChargeSession {
  date: string;
  startTime: string;
  endTime: string;
  kwh: number;
  cost: number;
  avgPence: number;
  carbonG: number;
}

export interface LegacySandboxData {
  savedToday: number;
  earnedToday: number;
  allTime: number;
  allTimeSince: string;
  solar: {
    w: number;
    batteryPct: number;
    gridW: number;
    homeW: number;
  };
  solarForecast: {
    kwh: number;
    confidence: number;
    condition: string;
    icon: string;
    deltaKwh: number;
  };
  batteryHealth: {
    cyclesUsed: number;
    cyclesTotal: number;
    capacityPct: number;
    projectedLifeYears: number;
    weeklyChargeCycles: number;
  };
  tariffs: LegacySandboxTariffOption[];
  history: LegacyHistoryDay[];
  carbonIntensity: number[];
  chargeSessions: LegacyChargeSession[];
  deviceHealth: Record<string, { lastSeen: number; ok: boolean }>;
  nightlyReport: string;
}

interface SlotSimulation {
  startAt: Date;
  endAt: Date;
  homeLoadKwh: number;
  solarGenerationKwh: number;
  importRatePencePerKwh: number;
  exportRatePencePerKwh: number;
  carbonIntensity: number;
  evConnected: boolean;
  evSocPercent: number;
  evChargeKwh: number;
  batterySocPercent: number;
  batteryChargeKwh: number;
  batteryDischargeKwh: number;
  batteryPowerW: number;
  gridImportKwh: number;
  gridExportKwh: number;
}

const SLOT_COUNT_PER_DAY = 48;

export const DEFAULT_VIRTUAL_HOME_CONFIG: VirtualHomeConfig = {
  siteId: "gridly-demo-home",
  timezone: "Europe/London",
  slotDurationMinutes: 30,
  solar: DEFAULT_SOLAR_MODEL_CONFIG,
  load: DEFAULT_LOAD_MODEL_CONFIG,
  battery: DEFAULT_BATTERY_MODEL_CONFIG,
  ev: DEFAULT_EV_MODEL_CONFIG,
  tariff: DEFAULT_TARIFF_MODEL_CONFIG,
};

function startOfDay(timestamp: Date): Date {
  return new Date(timestamp.getFullYear(), timestamp.getMonth(), timestamp.getDate(), 0, 0, 0, 0);
}

function alignToSlot(timestamp: Date, slotDurationMinutes: number): Date {
  const aligned = new Date(timestamp);
  const minutes = aligned.getMinutes();
  const alignedMinutes = Math.floor(minutes / slotDurationMinutes) * slotDurationMinutes;
  aligned.setMinutes(alignedMinutes, 0, 0);
  return aligned;
}

function addMinutes(timestamp: Date, minutes: number): Date {
  return new Date(timestamp.getTime() + minutes * 60000);
}

function formatHHMM(timestamp: Date): string {
  return timestamp.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatDayLabel(timestamp: Date, now: Date): string {
  const dayDiff = Math.round((startOfDay(now).getTime() - startOfDay(timestamp).getTime()) / 86400000);
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  return timestamp.toLocaleDateString("en-GB", { weekday: "short" });
}

function simulateCarbonIntensity(timestamp: Date): number {
  const hour = timestamp.getHours() + timestamp.getMinutes() / 60;
  const middayDip = 38 * Math.exp(-0.5 * Math.pow((hour - 13) / 2.4, 2));
  const eveningPeak = 28 * Math.exp(-0.5 * Math.pow((hour - 18.5) / 2, 2));
  const overnightDip = hour < 6 ? 18 : 0;
  const raw = 188 - middayDip + eveningPeak - overnightDip;
  return Math.round(raw);
}

function buildForecastPoint(startAt: Date, endAt: Date, value: number, confidence?: number): ForecastPoint {
  return {
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    value: Number(value.toFixed(3)),
    confidence,
  };
}

function runTimeline(dayStart: Date, slots: number, config: VirtualHomeConfig): SlotSimulation[] {
  const results: SlotSimulation[] = [];
  let batterySocPercent = config.battery.initialSocPercent;
  let evSocPercent = config.ev.initialSocPercent;

  for (let index = 0; index < slots; index += 1) {
    const startAt = addMinutes(dayStart, index * config.slotDurationMinutes);
    const endAt = addMinutes(startAt, config.slotDurationMinutes);
    const solarGenerationKwh = simulateSolarEnergyKwh(startAt, config.slotDurationMinutes, config.solar);
    const homeLoadKwh = simulateHouseholdLoadKwh(startAt, config.slotDurationMinutes, config.load);
    const importRatePencePerKwh = simulateImportRatePence(startAt, config.tariff);
    const exportRatePencePerKwh = simulateExportRatePence(startAt, config.tariff);
    const carbonIntensity = simulateCarbonIntensity(startAt);
    const evConnected = isEvConnectedAt(startAt, config.ev);

    const evDriveDemandKwh = getEvDrivingDemandKwh(startAt, config.slotDurationMinutes, config.ev);
    if (evDriveDemandKwh > 0) {
      const evCapacity = config.ev.batteryCapacityKwh;
      const driveDropPercent = (evDriveDemandKwh / evCapacity) * 100;
      evSocPercent = Math.max(config.ev.minSocPercent, Number((evSocPercent - driveDropPercent).toFixed(1)));
    }

    const availableSolarKwh = Math.max(0, solarGenerationKwh - homeLoadKwh);
    const evNeedsCharge = shouldChargeEv({
      timestamp: startAt,
      stateOfChargePercent: evSocPercent,
      importRatePencePerKwh,
      availableSolarKwh,
      config: config.ev,
    });

    let evChargeKwh = 0;
    if (evNeedsCharge) {
      const targetKwh = (config.ev.targetSocPercent / 100) * config.ev.batteryCapacityKwh;
      const currentKwh = (evSocPercent / 100) * config.ev.batteryCapacityKwh;
      const neededKwh = Math.max(0, targetKwh - currentKwh);
      evChargeKwh = Math.min(neededKwh, getEvMaxChargeKwhPerSlot(config.slotDurationMinutes, config.ev));
    }

    const batteryStep = simulateBatteryStep(
      {
        batterySocPercent,
        homeLoadKwh,
        solarGenerationKwh,
        evChargeRequestKwh: evChargeKwh,
        importRatePencePerKwh,
        exportRatePencePerKwh,
        slotDurationMinutes: config.slotDurationMinutes,
      },
      config.battery,
    );

    batterySocPercent = batteryStep.batterySocPercent;
    if (evChargeKwh > 0) {
      const evChargePercent = (evChargeKwh / config.ev.batteryCapacityKwh) * 100;
      evSocPercent = Math.min(config.ev.targetSocPercent, Number((evSocPercent + evChargePercent).toFixed(1)));
    }

    results.push({
      startAt,
      endAt,
      homeLoadKwh,
      solarGenerationKwh,
      importRatePencePerKwh,
      exportRatePencePerKwh,
      carbonIntensity,
      evConnected,
      evSocPercent,
      evChargeKwh: Number(evChargeKwh.toFixed(3)),
      batterySocPercent,
      batteryChargeKwh: batteryStep.batteryChargeKwh,
      batteryDischargeKwh: batteryStep.batteryDischargeKwh,
      batteryPowerW: batteryStep.batteryPowerW,
      gridImportKwh: batteryStep.gridImportKwh,
      gridExportKwh: batteryStep.gridExportKwh,
    });
  }

  return results;
}

function sumBy<T>(values: T[], picker: (value: T) => number): number {
  return values.reduce((total, value) => total + picker(value), 0);
}

function buildDevices(currentSlot: SlotSimulation, timestamp: Date, config: VirtualHomeConfig, timeline: SlotSimulation[]): DeviceState[] {
  const solarTodayKwh = sumBy(timeline, (slot) => slot.solarGenerationKwh);
  const importTodayKwh = sumBy(timeline, (slot) => slot.gridImportKwh);
  const exportTodayKwh = sumBy(timeline, (slot) => slot.gridExportKwh);
  const homeTodayKwh = sumBy(timeline, (slot) => slot.homeLoadKwh);

  return [
    {
      deviceId: "solar",
      kind: "solar_inverter",
      brand: "Virtual",
      name: "Virtual Solar Inverter",
      connectionStatus: "online",
      lastUpdatedAt: timestamp.toISOString(),
      capabilities: ["read_power", "read_energy"],
      powerW: simulateSolarPowerW(timestamp, config.solar),
      energyTodayKwh: Number(solarTodayKwh.toFixed(2)),
    },
    {
      deviceId: "battery",
      kind: "battery",
      brand: "Virtual",
      name: "Virtual Home Battery",
      connectionStatus: "online",
      lastUpdatedAt: timestamp.toISOString(),
      capabilities: ["read_power", "read_energy", "read_soc", "set_mode", "set_reserve_soc"],
      powerW: currentSlot.batteryPowerW,
      energyTodayKwh: Number(sumBy(timeline, (slot) => slot.batteryDischargeKwh).toFixed(2)),
      stateOfChargePercent: currentSlot.batterySocPercent,
      capacityKwh: config.battery.capacityKwh,
      mode: currentSlot.batteryPowerW > 0 ? "discharge" : currentSlot.batteryPowerW < 0 ? "charge" : "hold",
    },
    {
      deviceId: "ev",
      kind: "ev_charger",
      brand: "Virtual",
      name: "Virtual EV Charger",
      connectionStatus: "online",
      lastUpdatedAt: timestamp.toISOString(),
      capabilities: ["read_power", "read_energy", "read_soc", "start_stop", "set_target_soc", "schedule_window"],
      powerW: currentSlot.evChargeKwh > 0 ? Math.round((currentSlot.evChargeKwh / (config.slotDurationMinutes / 60)) * 1000) : 0,
      energyTodayKwh: Number(sumBy(timeline, (slot) => slot.evChargeKwh).toFixed(2)),
      stateOfChargePercent: currentSlot.evSocPercent,
      capacityKwh: config.ev.batteryCapacityKwh,
      mode: currentSlot.evChargeKwh > 0 ? "charge" : "hold",
      connected: currentSlot.evConnected,
    },
    {
      deviceId: "grid",
      kind: "smart_meter",
      brand: "Virtual",
      name: "Virtual Smart Meter",
      connectionStatus: "online",
      lastUpdatedAt: timestamp.toISOString(),
      capabilities: ["read_power", "read_energy", "read_tariff"],
      powerW: Math.round(((currentSlot.gridImportKwh - currentSlot.gridExportKwh) / (config.slotDurationMinutes / 60)) * 1000),
      energyTodayKwh: Number((importTodayKwh + exportTodayKwh).toFixed(2)),
      gridPowerW: Math.round(((currentSlot.gridImportKwh - currentSlot.gridExportKwh) / (config.slotDurationMinutes / 60)) * 1000),
      homeLoadW: simulateHouseholdLoadW(timestamp, config.load),
    },
    {
      deviceId: "home",
      kind: "gateway",
      brand: "Virtual",
      name: "Virtual Home Gateway",
      connectionStatus: "online",
      lastUpdatedAt: timestamp.toISOString(),
      capabilities: ["read_power", "read_energy"],
      powerW: simulateHouseholdLoadW(timestamp, config.load),
      energyTodayKwh: Number(homeTodayKwh.toFixed(2)),
      homeLoadW: simulateHouseholdLoadW(timestamp, config.load),
    },
  ];
}

function buildDailyMetrics(dayStart: Date, config: VirtualHomeConfig) {
  const timeline = runTimeline(dayStart, SLOT_COUNT_PER_DAY, config);
  const importCost = sumBy(timeline, (slot) => slot.gridImportKwh * slot.importRatePencePerKwh / 100);
  const exportRevenue = sumBy(timeline, (slot) => slot.gridExportKwh * slot.exportRatePencePerKwh / 100);
  const baselineImportCost = sumBy(timeline, (slot) => {
    const directNetLoad = Math.max(0, slot.homeLoadKwh + slot.evChargeKwh - slot.solarGenerationKwh);
    return directNetLoad * slot.importRatePencePerKwh / 100;
  });
  const solarKwh = sumBy(timeline, (slot) => slot.solarGenerationKwh);
  const batteryDischargeKwh = sumBy(timeline, (slot) => slot.batteryDischargeKwh);
  const evChargeKwh = sumBy(timeline, (slot) => slot.evChargeKwh);
  const gridExportKwh = sumBy(timeline, (slot) => slot.gridExportKwh);

  return {
    timeline,
    importCost: Number(importCost.toFixed(2)),
    exportRevenue: Number(exportRevenue.toFixed(2)),
    savedToday: Number(Math.max(0, baselineImportCost - importCost).toFixed(2)),
    solarKwh: Number(solarKwh.toFixed(2)),
    batteryDischargeKwh: Number(batteryDischargeKwh.toFixed(2)),
    evChargeKwh: Number(evChargeKwh.toFixed(2)),
    gridExportKwh: Number(gridExportKwh.toFixed(2)),
  };
}

function buildHistory(now: Date, config: VirtualHomeConfig): LegacyHistoryDay[] {
  const history: LegacyHistoryDay[] = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const day = addMinutes(startOfDay(now), -offset * 1440);
    const metrics = buildDailyMetrics(day, config);
    history.push({
      day: day.toLocaleDateString("en-GB", { weekday: "short" }),
      solar: Number((metrics.solarKwh * 0.12).toFixed(2)),
      battery: Number((metrics.batteryDischargeKwh * 0.1).toFixed(2)),
      ev: Number((metrics.evChargeKwh * 0.07).toFixed(2)),
      grid: Number((metrics.gridExportKwh * 0.14).toFixed(2)),
    });
  }
  return history;
}

function buildChargeSessions(now: Date, config: VirtualHomeConfig): LegacyChargeSession[] {
  const sessions: LegacyChargeSession[] = [];
  for (let offset = 0; offset < 10; offset += 1) {
    const day = addMinutes(startOfDay(now), -offset * 1440);
    const metrics = buildDailyMetrics(day, config);
    const chargingSlots = metrics.timeline.filter((slot) => slot.evChargeKwh > 0.05);
    if (!chargingSlots.length) {
      continue;
    }

    const first = chargingSlots[0];
    const last = chargingSlots[chargingSlots.length - 1];
    const totalKwh = sumBy(chargingSlots, (slot) => slot.evChargeKwh);
    const totalCost = sumBy(chargingSlots, (slot) => slot.evChargeKwh * slot.importRatePencePerKwh / 100);
    const avgPence = sumBy(chargingSlots, (slot) => slot.importRatePencePerKwh) / chargingSlots.length;
    const carbonG = sumBy(chargingSlots, (slot) => slot.evChargeKwh * slot.carbonIntensity);

    sessions.push({
      date: formatDayLabel(day, now),
      startTime: formatHHMM(first.startAt),
      endTime: formatHHMM(last.endAt),
      kwh: Number(totalKwh.toFixed(1)),
      cost: Number(totalCost.toFixed(2)),
      avgPence: Number(avgPence.toFixed(1)),
      carbonG: Math.round(carbonG),
    });
  }

  return sessions;
}

function buildNightlyReport(now: Date, config: VirtualHomeConfig): string {
  const dayMetrics = buildDailyMetrics(startOfDay(now), config);
  const cheapestSlot = [...dayMetrics.timeline].sort((a, b) => a.importRatePencePerKwh - b.importRatePencePerKwh)[0];
  const bestExportSlot = [...dayMetrics.timeline].sort((a, b) => b.exportRatePencePerKwh - a.exportRatePencePerKwh)[0];
  const solarForecastKwh = sumBy(dayMetrics.timeline, (slot) => slot.solarGenerationKwh);

  return `Gridly is charging into ${cheapestSlot.importRatePencePerKwh.toFixed(1)}p low-price windows, protecting battery reserve, and targeting export near ${bestExportSlot.exportRatePencePerKwh.toFixed(1)}p. Solar forecast is ${solarForecastKwh.toFixed(1)}kWh today.`;
}

export function simulateTariffSchedule(
  startTime: Date,
  slots = SLOT_COUNT_PER_DAY,
  config: VirtualHomeConfig = DEFAULT_VIRTUAL_HOME_CONFIG,
): TariffSchedule {
  return buildTariffSchedule(alignToSlot(startTime, config.slotDurationMinutes), slots, config.slotDurationMinutes, config.tariff);
}

export function simulateForecasts(
  startTime: Date,
  slots = SLOT_COUNT_PER_DAY,
  config: VirtualHomeConfig = DEFAULT_VIRTUAL_HOME_CONFIG,
): Forecasts {
  const alignedStart = alignToSlot(startTime, config.slotDurationMinutes);
  const householdLoadKwh: ForecastPoint[] = [];
  const solarGenerationKwh: ForecastPoint[] = [];
  const carbonIntensity: ForecastPoint[] = [];

  for (let index = 0; index < slots; index += 1) {
    const slotStart = addMinutes(alignedStart, index * config.slotDurationMinutes);
    const slotEnd = addMinutes(slotStart, config.slotDurationMinutes);
    householdLoadKwh.push(
      buildForecastPoint(
        slotStart,
        slotEnd,
        simulateHouseholdLoadKwh(slotStart, config.slotDurationMinutes, config.load),
        0.82,
      ),
    );
    solarGenerationKwh.push(
      buildForecastPoint(
        slotStart,
        slotEnd,
        simulateSolarEnergyKwh(slotStart, config.slotDurationMinutes, config.solar),
        0.79,
      ),
    );
    carbonIntensity.push(buildForecastPoint(slotStart, slotEnd, simulateCarbonIntensity(slotStart), 0.76));
  }

  return {
    generatedAt: new Date().toISOString(),
    horizonStartAt: alignedStart.toISOString(),
    horizonEndAt: addMinutes(alignedStart, slots * config.slotDurationMinutes).toISOString(),
    slotDurationMinutes: config.slotDurationMinutes,
    householdLoadKwh,
    solarGenerationKwh,
    carbonIntensity,
  };
}

export function simulateSystemState(
  timestamp: Date,
  config: VirtualHomeConfig = DEFAULT_VIRTUAL_HOME_CONFIG,
): SystemState {
  const currentSlotStart = alignToSlot(timestamp, config.slotDurationMinutes);
  const dayStart = startOfDay(timestamp);
  const slotsSinceMidnight = Math.floor((currentSlotStart.getTime() - dayStart.getTime()) / (config.slotDurationMinutes * 60000)) + 1;
  const timeline = runTimeline(dayStart, slotsSinceMidnight, config);
  const currentSlot = timeline[timeline.length - 1];
  const devices = buildDevices(currentSlot, timestamp, config, timeline);

  return {
    siteId: config.siteId,
    capturedAt: timestamp.toISOString(),
    timezone: config.timezone,
    devices,
    homeLoadW: simulateHouseholdLoadW(timestamp, config.load),
    solarGenerationW: simulateSolarPowerW(timestamp, config.solar),
    batteryPowerW: currentSlot.batteryPowerW,
    evChargingPowerW: currentSlot.evChargeKwh > 0
      ? Math.round((currentSlot.evChargeKwh / (config.slotDurationMinutes / 60)) * 1000)
      : 0,
    gridPowerW: Math.round(((currentSlot.gridImportKwh - currentSlot.gridExportKwh) / (config.slotDurationMinutes / 60)) * 1000),
    batterySocPercent: currentSlot.batterySocPercent,
    batteryCapacityKwh: config.battery.capacityKwh,
    evSocPercent: currentSlot.evSocPercent,
    evConnected: currentSlot.evConnected,
    currentImportRatePencePerKwh: currentSlot.importRatePencePerKwh,
    currentExportRatePencePerKwh: currentSlot.exportRatePencePerKwh,
  };
}

/**
 * Compatibility wrapper for legacy UI code that still expects the historical
 * SANDBOX object shape.
 */
export function createLegacySandboxSnapshot(
  now: Date = new Date(),
  config: VirtualHomeConfig = DEFAULT_VIRTUAL_HOME_CONFIG,
): LegacySandboxData {
  const systemState = simulateSystemState(now, config);
  const forecasts = simulateForecasts(now, SLOT_COUNT_PER_DAY, config);
  const tariffSchedule = simulateTariffSchedule(now, SLOT_COUNT_PER_DAY, config);
  const todayMetrics = buildDailyMetrics(startOfDay(now), config);
  const averageSolar = forecasts.solarGenerationKwh.reduce((sum, point) => sum + point.value, 0) / forecasts.solarGenerationKwh.length;
  const totalForecastSolar = forecasts.solarGenerationKwh.reduce((sum, point) => sum + point.value, 0);
  const currentCarbonIntensity = forecasts.carbonIntensity?.map((point) => Math.round(point.value)) ?? [];

  return {
    savedToday: todayMetrics.savedToday,
    earnedToday: todayMetrics.exportRevenue,
    allTime: Number((560 + now.getFullYear() - 2024 * 1 + now.getDate() * 4.3).toFixed(2)),
    allTimeSince: "March 2024",
    solar: {
      w: systemState.solarGenerationW,
      batteryPct: systemState.batterySocPercent ?? config.battery.initialSocPercent,
      gridW: systemState.gridPowerW,
      homeW: systemState.homeLoadW,
    },
    solarForecast: {
      kwh: Number(totalForecastSolar.toFixed(1)),
      confidence: 81,
      condition: averageSolar > 0.22 ? "Mostly sunny" : "Mixed cloud",
      icon: averageSolar > 0.22 ? "sunny" : "partly-cloudy",
      deltaKwh: Number((totalForecastSolar * 0.11).toFixed(1)),
    },
    batteryHealth: {
      cyclesUsed: 312,
      cyclesTotal: 6000,
      capacityPct: 97,
      projectedLifeYears: 14.2,
      weeklyChargeCycles: 4.2,
    },
    tariffs: [
      { id: "agile", name: "Octopus Agile", annualSaving: 713, current: true, badge: "You're on this" },
      { id: "go", name: "Intelligent Octopus Go", annualSaving: 1041, current: false, badge: "Best for EV" },
      { id: "flux", name: "Octopus Flux", annualSaving: 892, current: false, badge: "Best for battery" },
      { id: "cosy", name: "Cosy Octopus", annualSaving: 634, current: false, badge: null },
    ],
    history: buildHistory(now, config),
    carbonIntensity: currentCarbonIntensity,
    chargeSessions: buildChargeSessions(now, config),
    deviceHealth: {
      solar: { lastSeen: 1, ok: true },
      battery: { lastSeen: 1, ok: true },
      ev: { lastSeen: systemState.evConnected ? 1 : 8, ok: true },
      grid: { lastSeen: 1, ok: true },
    },
    nightlyReport: buildNightlyReport(now, config),
  };
}

/**
 * Convenience helper for future canonical consumers.
 */
export function getCanonicalSimulationSnapshot(now: Date = new Date(), config: VirtualHomeConfig = DEFAULT_VIRTUAL_HOME_CONFIG) {
  return {
    systemState: simulateSystemState(now, config),
    forecasts: simulateForecasts(now, SLOT_COUNT_PER_DAY, config),
    tariffSchedule: simulateTariffSchedule(now, SLOT_COUNT_PER_DAY, config),
  };
}

export function toLegacyAgileRates(schedule: TariffSchedule): Array<{ time: string; pence: number }> {
  return schedule.importRates.map((rate) => ({
    time: formatHHMM(new Date(rate.startAt)),
    pence: Number(rate.unitRatePencePerKwh.toFixed(1)),
  }));
}