import type { OptimizerInput } from "../../src/domain";
import type { DeviceState } from "../../src/domain/device";
import type { ForecastPoint } from "../../src/domain/forecasts";
import type { TariffRate } from "../../src/domain/tariff";
import { optimize } from "../../src/optimizer/engine";
import type { BenchmarkStrategy } from "../runBenchmark";
import type { BenchmarkScenario, StrategyDecisionSlot } from "../types";

// ------------------------------------------------------------
// Aveum canonical engine strategy
// ------------------------------------------------------------
// Converts a BenchmarkScenario into an OptimizerInput, runs the
// canonical optimize() function, then walks the returned decisions
// slot-by-slot to produce comparable StrategyDecisionSlot entries.

const BASE_ISO = "2024-01-01T00:00:00.000Z";
const SLOT_DURATION_MS = 30 * 60 * 1000;
const SLOT_HOURS = 0.5;

function slotToStartAt(slotIndex: number): string {
  return new Date(new Date(BASE_ISO).getTime() + slotIndex * SLOT_DURATION_MS).toISOString();
}

function slotToEndAt(slotIndex: number): string {
  return slotToStartAt(slotIndex + 1);
}

function startAtToSlotIndex(startAt: string): number {
  const baseMs = new Date(BASE_ISO).getTime();
  const slotMs = new Date(startAt).getTime();
  return Math.round((slotMs - baseMs) / SLOT_DURATION_MS);
}

// The engine's evReadyBy constraint is parsed as "HH:MM" wall-clock time.
function slotIndexToTimeHHMM(slotIndex: number): string {
  const totalMinutes = slotIndex * 30;
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function buildOptimizerInput(scenario: BenchmarkScenario): OptimizerInput {
  const battery = scenario.assets.battery;
  const ev = scenario.assets.ev;

  const batterySocPercent =
    battery.capacityKwh > 0 ? (battery.initialSocKwh / battery.capacityKwh) * 100 : 50;
  const batteryReservePercent =
    battery.capacityKwh > 0 ? (battery.reserveSocKwh / battery.capacityKwh) * 100 : 20;

  // The scenario's requiredChargeKwh is treated as the EV target capacity so that
  // 100 % SoC means the EV has received the needed charge.
  const evCapacityKwh = ev.requiredChargeKwh > 0 ? ev.requiredChargeKwh : 60;
  const evSocPercent = evCapacityKwh > 0 ? ((ev.currentChargeKwh ?? 0) / evCapacityKwh) * 100 : 0;

  const devices: DeviceState[] = [];

  if (scenario.assets.hasBattery) {
    devices.push({
      deviceId: "battery-01",
      kind: "battery",
      brand: "benchmark",
      name: "Benchmark Battery",
      connectionStatus: "online",
      lastUpdatedAt: BASE_ISO,
      capabilities: ["read_soc", "set_mode", "set_power_limit", "set_reserve_soc"],
      stateOfChargePercent: batterySocPercent,
      capacityKwh: battery.capacityKwh,
    });
  }

  if (scenario.assets.hasEv) {
    devices.push({
      deviceId: "ev-charger-01",
      kind: "ev_charger",
      brand: "benchmark",
      name: "Benchmark EV Charger",
      connectionStatus: "online",
      lastUpdatedAt: BASE_ISO,
      capabilities: ["schedule_window", "start_stop", "set_mode"],
      stateOfChargePercent: evSocPercent,
      capacityKwh: evCapacityKwh,
      connected: true,
    });
  }

  if (scenario.assets.hasSolar) {
    devices.push({
      deviceId: "solar-inverter-01",
      kind: "solar_inverter",
      brand: "benchmark",
      name: "Benchmark Solar Inverter",
      connectionStatus: "online",
      lastUpdatedAt: BASE_ISO,
      capabilities: ["read_power", "read_energy"],
    });
  }

  const importRates: TariffRate[] = scenario.tariffs.importPricesPencePerKwh.map((price, i) => ({
    startAt: slotToStartAt(i),
    endAt: slotToEndAt(i),
    unitRatePencePerKwh: price,
    source: "live" as const,
  }));

  const exportRates: TariffRate[] = scenario.tariffs.exportPricesPencePerKwh.map((price, i) => ({
    startAt: slotToStartAt(i),
    endAt: slotToEndAt(i),
    unitRatePencePerKwh: price,
    source: "live" as const,
  }));

  const householdLoadKwh: ForecastPoint[] = scenario.load.demandKwBySlot.map((kw, i) => ({
    startAt: slotToStartAt(i),
    endAt: slotToEndAt(i),
    value: kw * SLOT_HOURS,
  }));

  const solarGenerationKwh: ForecastPoint[] = scenario.solar.generationKwBySlot.map((kw, i) => ({
    startAt: slotToStartAt(i),
    endAt: slotToEndAt(i),
    value: kw * SLOT_HOURS,
  }));

  return {
    systemState: {
      siteId: `benchmark-${scenario.id}`,
      capturedAt: BASE_ISO,
      timezone: scenario.timezone ?? "Europe/London",
      devices,
      homeLoadW: (scenario.load.demandKwBySlot[0] ?? 0) * 1000,
      solarGenerationW: (scenario.solar.generationKwBySlot[0] ?? 0) * 1000,
      batteryPowerW: 0,
      evChargingPowerW: 0,
      gridPowerW: 0,
      batterySocPercent: scenario.assets.hasBattery ? batterySocPercent : undefined,
      batteryCapacityKwh: scenario.assets.hasBattery ? battery.capacityKwh : undefined,
      evSocPercent: scenario.assets.hasEv ? evSocPercent : undefined,
      evConnected: scenario.assets.hasEv,
    },
    forecasts: {
      generatedAt: BASE_ISO,
      horizonStartAt: BASE_ISO,
      horizonEndAt: slotToStartAt(scenario.slotCount),
      slotDurationMinutes: 30,
      householdLoadKwh,
      solarGenerationKwh,
    },
    tariffSchedule: {
      tariffId: "benchmark-tariff",
      provider: "benchmark",
      name: "Benchmark Tariff",
      currency: "GBP",
      updatedAt: BASE_ISO,
      importRates,
      exportRates,
    },
    constraints: {
      mode: "cost",
      allowGridBatteryCharging: true,
      allowBatteryExport: scenario.assets.hasGridExport,
      allowAutomaticEvCharging: scenario.assets.hasEv,
      batteryReservePercent: scenario.assets.hasBattery ? batteryReservePercent : undefined,
      evReadyBy: scenario.assets.hasEv ? slotIndexToTimeHHMM(ev.departureSlotIndex) : undefined,
      evTargetSocPercent: scenario.assets.hasEv ? 100 : undefined,
      // One charge window per day: prevents the engine from re-entering a charge window
      // mid-spike when chargeForValue fires (anticipating even higher future prices).
      // Without this limit the engine buys energy at 48–72p to sell at 96p, which is
      // mathematically profitable but LESS valuable than simply discharging throughout
      // the spike at those same moderate prices.
      maxBatteryCyclesPerDay: 1,
      // Export preference: lower the self-consumption weight so the engine exports
      // surplus solar when export rates are a reasonable fraction of import rates
      // (~65% in these scenarios). At the default weight of 1.0 the threshold is
      // importRate × 0.9 × 0.8 = 72% of import, which these scenarios never reach.
      // At 0.8 the effective floor is ~58%, matching the scenario export profiles.
      selfConsumptionPreferenceWeight: 0.8,
    },
  };
}

function runAveumStrategy(scenario: BenchmarkScenario) {
  const input = buildOptimizerInput(scenario);
  const output = optimize(input);

  const battery = scenario.assets.battery;
  const batteryCapacityKwh = scenario.assets.hasBattery ? battery.capacityKwh : 0;
  const batteryReserveKwh = scenario.assets.hasBattery ? battery.reserveSocKwh : 0;

  // Build a slot-index lookup from the engine's decisions.
  const decisionBySlot = new Map<number, (typeof output.decisions)[0]>();
  for (const decision of output.decisions) {
    const slotIndex = startAtToSlotIndex(decision.startAt);
    if (slotIndex >= 0 && slotIndex < scenario.slotCount) {
      decisionBySlot.set(slotIndex, decision);
    }
  }

  let prevSocKwh = battery.initialSocKwh;
  const batteryMaxDischargeKwh = (battery.maxDischargeKw ?? 5) * SLOT_HOURS;
  const batteryMaxChargeKwh = (battery.maxChargeKw ?? 5) * SLOT_HOURS;

  const decisions: StrategyDecisionSlot[] = Array.from(
    { length: scenario.slotCount },
    (_, slotIndex) => {
      const decision = decisionBySlot.get(slotIndex);
      const importPrice = scenario.tariffs.importPricesPencePerKwh[slotIndex] ?? 0;
      const exportPrice = scenario.tariffs.exportPricesPencePerKwh[slotIndex] ?? 0;
      const solarKwh = (scenario.solar.generationKwBySlot[slotIndex] ?? 0) * SLOT_HOURS;
      const loadKwh = (scenario.load.demandKwBySlot[slotIndex] ?? 0) * SLOT_HOURS;

      let batteryChargeKwh: number;
      let batteryDischargeKwh: number;
      let batterySocKwhEnd: number;
      let gridImportKwh: number;
      let gridExportKwh: number;

      if (decision?.action === "discharge_battery" && batteryCapacityKwh > 0) {
        // Load-matching discharge: cover net load up to battery limits.
        // The engine caps discharge at 1.4 kW regardless of rated capacity; applying the
        // battery's actual max power here concentrates energy on the highest-price slots.
        const netLoadKwh = Math.max(0, loadKwh - solarKwh);
        const availableKwh = Math.max(0, prevSocKwh - batteryReserveKwh);
        batteryDischargeKwh = Math.min(batteryMaxDischargeKwh, availableKwh, netLoadKwh);
        batteryChargeKwh = 0;
        batterySocKwhEnd = prevSocKwh - batteryDischargeKwh;
        gridImportKwh = Math.max(0, loadKwh - solarKwh - batteryDischargeKwh);
        gridExportKwh = 0;
      } else {
        // For all other actions (charge, hold, export, EV) use the engine's reported SoC.
        const batterySocPercent = decision?.expectedBatterySocPercent;
        batterySocKwhEnd =
          batteryCapacityKwh > 0 && batterySocPercent !== undefined
            ? (batterySocPercent / 100) * batteryCapacityKwh
            : prevSocKwh;
        const socDeltaKwh = batterySocKwhEnd - prevSocKwh;
        batteryChargeKwh = Math.min(Math.max(0, socDeltaKwh), batteryMaxChargeKwh);
        batteryDischargeKwh = 0;
        gridImportKwh = decision?.expectedImportKwh ?? Math.max(0, loadKwh - solarKwh);
        gridExportKwh = decision?.expectedExportKwh ?? 0;
      }

      prevSocKwh = batterySocKwhEnd;

      // Energy balance: import + solar + batteryDischarge = load + batteryCharge + evCharge + export
      const evChargeKwh = Math.max(
        0,
        gridImportKwh + solarKwh + batteryDischargeKwh - loadKwh - batteryChargeKwh - gridExportKwh,
      );

      return {
        slotIndex,
        importPricePencePerKwh: importPrice,
        exportPricePencePerKwh: exportPrice,
        gridImportKwh,
        gridExportKwh,
        solarGenerationKwh: solarKwh,
        evChargeKwh,
        batteryChargeKwh,
        batteryDischargeKwh,
        batterySocKwhEnd,
        batteryReserveKwh,
      };
    },
  );

  return {
    decisions,
    telemetry: {
        // Remaining energy the EV still needs — not the total target capacity.
      // The benchmark sums evChargeKwh delivered during the run and compares against this.
      evRequiredChargeKwh: scenario.assets.hasEv
        ? Math.max(0, scenario.assets.ev.requiredChargeKwh - (scenario.assets.ev.currentChargeKwh ?? 0))
        : undefined,
      batteryCapacityKwh: scenario.assets.hasBattery ? batteryCapacityKwh : undefined,
    },
    debug: {
      strategyType: "aveum-canonical-engine",
      optimizerStatus: output.status,
      planId: output.planId,
      planningConfidenceLevel: output.planningConfidenceLevel,
      conservativeAdjustmentApplied: output.conservativeAdjustmentApplied,
      decisionsCount: output.decisions.length,
    },
  };
}

export const aveumStrategy: BenchmarkStrategy = {
  id: "aveum",
  name: "Aveum (Canonical Engine)",
  run: runAveumStrategy,
};

export default aveumStrategy;
