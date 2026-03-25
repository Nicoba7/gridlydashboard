import { describe, expect, it } from "vitest";
import type { DeviceState, OptimizerInput, OptimizationMode } from "../domain";
import { optimize } from "../optimizer/engine";

function buildDevices(): DeviceState[] {
  return [
    {
      deviceId: "battery-1",
      kind: "battery",
      brand: "GivEnergy",
      name: "Battery",
      connectionStatus: "online",
      lastUpdatedAt: "2026-03-16T10:00:00.000Z",
      capabilities: ["set_mode", "read_power", "read_soc"],
      capacityKwh: 10,
    },
    {
      deviceId: "solar-1",
      kind: "solar_inverter",
      brand: "SolarEdge",
      name: "Solar",
      connectionStatus: "online",
      lastUpdatedAt: "2026-03-16T10:00:00.000Z",
      capabilities: ["read_power", "read_energy"],
    },
    {
      deviceId: "grid-1",
      kind: "smart_meter",
      brand: "Octopus",
      name: "Grid",
      connectionStatus: "online",
      lastUpdatedAt: "2026-03-16T10:00:00.000Z",
      capabilities: ["read_tariff", "read_power"],
    },
  ];
}

function buildInput(params: {
  mode: OptimizationMode;
  importRates: number[];
  exportRates: number[];
  loadKwh: number;
  solarKwh: number;
  batteryDegradationCostPencePerKwh?: number;
  capturedAt?: string;
  loadSlotsCount?: number;
  solarSlotsCount?: number;
  devices?: DeviceState[];
  evConnected?: boolean;
}): OptimizerInput {
  const start = new Date("2026-03-16T10:00:00.000Z").getTime();
  const capturedAt = params.capturedAt ?? "2026-03-16T10:00:00.000Z";
  const loadSlotsCount = params.loadSlotsCount ?? params.importRates.length;
  const solarSlotsCount = params.solarSlotsCount ?? params.importRates.length;

  return {
    systemState: {
      siteId: "site-1",
      capturedAt,
      timezone: "Europe/London",
      devices: params.devices ?? buildDevices(),
      homeLoadW: Math.round(params.loadKwh * 2000),
      solarGenerationW: Math.round(params.solarKwh * 2000),
      batteryPowerW: 0,
      evChargingPowerW: 0,
      gridPowerW: 0,
      batterySocPercent: 60,
      batteryCapacityKwh: 10,
      evConnected: params.evConnected ?? false,
    },
    forecasts: {
      generatedAt: "2026-03-16T10:00:00.000Z",
      horizonStartAt: "2026-03-16T10:00:00.000Z",
      horizonEndAt: new Date(start + params.importRates.length * 30 * 60 * 1000).toISOString(),
      slotDurationMinutes: 30,
      householdLoadKwh: params.importRates.slice(0, loadSlotsCount).map((_, index) => ({
        startAt: new Date(start + index * 30 * 60 * 1000).toISOString(),
        endAt: new Date(start + (index + 1) * 30 * 60 * 1000).toISOString(),
        value: params.loadKwh,
        confidence: 0.9,
      })),
      solarGenerationKwh: params.importRates.slice(0, solarSlotsCount).map((_, index) => ({
        startAt: new Date(start + index * 30 * 60 * 1000).toISOString(),
        endAt: new Date(start + (index + 1) * 30 * 60 * 1000).toISOString(),
        value: params.solarKwh,
        confidence: 0.9,
      })),
      carbonIntensity: params.importRates.map((_, index) => ({
        startAt: new Date(start + index * 30 * 60 * 1000).toISOString(),
        endAt: new Date(start + (index + 1) * 30 * 60 * 1000).toISOString(),
        value: 200,
        confidence: 0.9,
      })),
    },
    tariffSchedule: {
      tariffId: "tariff-1",
      provider: "Aveum",
      name: "Synthetic",
      currency: "GBP",
      updatedAt: "2026-03-16T10:00:00.000Z",
      importRates: params.importRates.map((rate, index) => ({
        startAt: new Date(start + index * 30 * 60 * 1000).toISOString(),
        endAt: new Date(start + (index + 1) * 30 * 60 * 1000).toISOString(),
        unitRatePencePerKwh: rate,
        source: "live",
      })),
      exportRates: params.exportRates.map((rate, index) => ({
        startAt: new Date(start + index * 30 * 60 * 1000).toISOString(),
        endAt: new Date(start + (index + 1) * 30 * 60 * 1000).toISOString(),
        unitRatePencePerKwh: rate,
        source: "live",
      })),
    },
    constraints: {
      mode: params.mode,
      batteryReservePercent: 30,
      maxBatteryCyclesPerDay: 2,
      batteryDegradationCostPencePerKwh: params.batteryDegradationCostPencePerKwh,
      allowGridBatteryCharging: true,
      allowBatteryExport: true,
      allowAutomaticEvCharging: false,
      evTargetSocPercent: 85,
      evReadyBy: "07:00",
    },
  };
}

describe("optimize mode-aware objective behavior", () => {
  it("prefers export in cost mode but keeps solar for self consumption mode", () => {
    const costResult = optimize(
      buildInput({
        mode: "cost",
        importRates: [20],
        exportRates: [18],
        loadKwh: 1,
        solarKwh: 3,
      }),
    );

    const selfResult = optimize(
      buildInput({
        mode: "self_consumption",
        importRates: [20],
        exportRates: [18],
        loadKwh: 1,
        solarKwh: 3,
      }),
    );

    expect(costResult.decisions[0]?.action).toBe("export_to_grid");
    expect(selfResult.decisions[0]?.action).toBe("consume_solar");
  });

  it("allows battery charging in cost mode at moderate import prices", () => {
    const costResult = optimize(
      buildInput({
        mode: "cost",
        importRates: [9, 10],
        exportRates: [6, 6],
        loadKwh: 1,
        solarKwh: 0,
      }),
    );

    const balancedResult = optimize(
      buildInput({
        mode: "balanced",
        importRates: [9, 10],
        exportRates: [6, 6],
        loadKwh: 1,
        solarKwh: 0,
      }),
    );

    expect(costResult.decisions[0]?.action).toBe("charge_battery");
    expect(balancedResult.decisions[0]?.action).toBe("hold");
  });

  it("charges battery when forward stored-energy value is strong", () => {
    const result = optimize(
      buildInput({
        mode: "cost",
        importRates: [15, 15],
        exportRates: [5, 40],
        loadKwh: 1,
        solarKwh: 0,
      }),
    );

    expect(result.decisions[0]?.action).toBe("charge_battery");
    expect(result.decisions[0]?.reason).toContain("forward net stored-energy value");
    expect(result.decisions[0]?.netStoredEnergyValuePencePerKwh).toBeDefined();
    expect(result.decisions[0]?.effectiveStoredEnergyValuePencePerKwh).toBeDefined();
  });

  it("discharges when current net stored-energy value is still materially stronger", () => {
    const result = optimize(
      buildInput({
        mode: "cost",
        importRates: [30, 10],
        exportRates: [5, 5],
        loadKwh: 1,
        solarKwh: 0,
      }),
    );

    expect(result.decisions[0]?.action).toBe("discharge_battery");
    expect(result.decisions[0]?.reason).toContain("immediate net discharge value");
    expect((result.decisions[0]?.netStoredEnergyValuePencePerKwh ?? 0)).toBeGreaterThan(
      result.decisions[1]?.netStoredEnergyValuePencePerKwh ?? 0,
    );
  });

  it("can flip from discharge to hold as degradation cost increases", () => {
    const lowWear = optimize(
      buildInput({
        mode: "balanced",
        importRates: [23, 22],
        exportRates: [0, 0],
        loadKwh: 1,
        solarKwh: 0,
        batteryDegradationCostPencePerKwh: 0,
      }),
    );

    const highWear = optimize(
      buildInput({
        mode: "balanced",
        importRates: [23, 22],
        exportRates: [0, 0],
        loadKwh: 1,
        solarKwh: 0,
        batteryDegradationCostPencePerKwh: 1,
      }),
    );

    expect(lowWear.decisions[0]?.action).toBe("discharge_battery");
    expect(highWear.decisions[0]?.action).toBe("hold");
  });

  it("rejects charge arbitrage when degradation cost erodes forward spread", () => {
    const noWearCost = optimize(
      buildInput({
        mode: "balanced",
        importRates: [12, 15.5],
        exportRates: [0, 0],
        loadKwh: 1,
        solarKwh: 0,
        batteryDegradationCostPencePerKwh: 0,
      }),
    );

    const withWearCost = optimize(
      buildInput({
        mode: "balanced",
        importRates: [12, 15.5],
        exportRates: [0, 0],
        loadKwh: 1,
        solarKwh: 0,
        batteryDegradationCostPencePerKwh: 2,
      }),
    );

    expect(noWearCost.decisions[0]?.action).toBe("charge_battery");
    expect(withWearCost.decisions[0]?.action).toBe("hold");
  });

  it("includes battery degradation cost in expected net plan value", () => {
    const withoutWear = optimize(
      buildInput({
        mode: "cost",
        importRates: [30, 10],
        exportRates: [5, 5],
        loadKwh: 1,
        solarKwh: 0,
        batteryDegradationCostPencePerKwh: 0,
      }),
    );

    const withWear = optimize(
      buildInput({
        mode: "cost",
        importRates: [30, 10],
        exportRates: [5, 5],
        loadKwh: 1,
        solarKwh: 0,
        batteryDegradationCostPencePerKwh: 2,
      }),
    );

    expect(withWear.summary.expectedBatteryDegradationCostPence).toBeGreaterThan(0);
    expect(withWear.summary.planningNetRevenueSurplusPence).toBeLessThan(withoutWear.summary.planningNetRevenueSurplusPence);
  });

  it("emits executable concrete device ids in decisions and commands", () => {
    const result = optimize(
      buildInput({
        mode: "cost",
        importRates: [9, 10],
        exportRates: [6, 6],
        loadKwh: 1,
        solarKwh: 0,
      }),
    );

    expect(result.decisions[0]?.targetDeviceIds).toEqual(["battery-1"]);
    expect(result.recommendedCommands[0]?.deviceId).toBe("battery-1");
  });

  it("emits one command per dispatchable battery in multi-device charge decisions", () => {
    const result = optimize(
      buildInput({
        mode: "cost",
        importRates: [9, 10],
        exportRates: [6, 6],
        loadKwh: 1,
        solarKwh: 0,
        devices: [
          {
            deviceId: "battery-1",
            kind: "battery",
            brand: "GivEnergy",
            name: "Battery One",
            connectionStatus: "online",
            lastUpdatedAt: "2026-03-16T10:00:00.000Z",
            capabilities: ["set_mode", "read_soc"],
          },
          {
            deviceId: "battery-2",
            kind: "battery",
            brand: "GivEnergy",
            name: "Battery Two",
            connectionStatus: "online",
            lastUpdatedAt: "2026-03-16T10:00:00.000Z",
            capabilities: ["set_mode", "read_soc"],
          },
        ],
      }),
    );

    expect(result.decisions[0]?.action).toBe("charge_battery");
    expect(result.decisions[0]?.targetDeviceIds).toEqual(["battery-1", "battery-2"]);

    const firstDecisionCommands = result.recommendedCommands.filter((command) =>
      command.commandId.includes("-battery-0-"),
    );
    expect(firstDecisionCommands.map((command) => command.deviceId)).toEqual(["battery-1", "battery-2"]);
  });

  it("keeps heterogeneous action targets while only dispatching controllable devices", () => {
    const result = optimize(
      buildInput({
        mode: "cost",
        importRates: [20],
        exportRates: [18],
        loadKwh: 1,
        solarKwh: 3,
        devices: [
          {
            deviceId: "battery-1",
            kind: "battery",
            brand: "GivEnergy",
            name: "Battery",
            connectionStatus: "online",
            lastUpdatedAt: "2026-03-16T10:00:00.000Z",
            capabilities: ["set_mode", "read_soc"],
          },
          {
            deviceId: "solar-1",
            kind: "solar_inverter",
            brand: "SolarEdge",
            name: "Solar",
            connectionStatus: "online",
            lastUpdatedAt: "2026-03-16T10:00:00.000Z",
            capabilities: ["set_mode", "read_power"],
          },
          {
            deviceId: "grid-1",
            kind: "smart_meter",
            brand: "Octopus",
            name: "Grid",
            connectionStatus: "online",
            lastUpdatedAt: "2026-03-16T10:00:00.000Z",
            capabilities: ["read_tariff", "read_power"],
          },
        ],
      }),
    );

    expect(result.decisions[0]?.action).toBe("export_to_grid");
    expect(result.decisions[0]?.targetDeviceIds).toEqual(["battery-1", "solar-1", "grid-1"]);
    expect(result.recommendedCommands.map((command) => command.deviceId)).toEqual(["battery-1", "solar-1"]);
  });

  it("rejects low-margin heuristic cycling when planning confidence is reduced", () => {
    const completeCoverage = optimize(
      buildInput({
        mode: "cost",
        importRates: [9, 10],
        exportRates: [6, 6],
        loadKwh: 1,
        solarKwh: 0,
      }),
    );

    const weakCoverage = optimize(
      buildInput({
        mode: "cost",
        importRates: [9, 10],
        exportRates: [6, 6],
        loadKwh: 1,
        solarKwh: 0,
        loadSlotsCount: 1,
      }),
    );

    expect(completeCoverage.decisions[0]?.action).toBe("charge_battery");
    expect(weakCoverage.decisions[0]?.action).toBe("hold");
    expect(weakCoverage.planningConfidenceLevel).toBe("low");
    expect(weakCoverage.conservativeAdjustmentApplied).toBe(true);
  });

  it("softens export-driven action under partial export tariff coverage", () => {
    const fullCoverage = optimize(
      buildInput({
        mode: "cost",
        importRates: [20, 20],
        exportRates: [18, 18],
        loadKwh: 1,
        solarKwh: 3,
      }),
    );

    const partialCoverage = optimize(
      buildInput({
        mode: "cost",
        importRates: [20, 20],
        exportRates: [18],
        loadKwh: 1,
        solarKwh: 3,
      }),
    );

    expect(fullCoverage.decisions[0]?.action).toBe("export_to_grid");
    expect(partialCoverage.decisions[0]?.action).toBe("consume_solar");
    expect(partialCoverage.decisions[0]?.reason).toContain("Conservative adjustment active");
  });

  it("does not apply conservatism penalty with complete coverage", () => {
    const result = optimize(
      buildInput({
        mode: "balanced",
        importRates: [15, 15],
        exportRates: [5, 40],
        loadKwh: 1,
        solarKwh: 0,
      }),
    );

    expect(result.planningConfidenceLevel).toBe("high");
    expect(result.conservativeAdjustmentApplied).toBe(false);
  });

  it("produces identical optimizer output for same logical input and planning timestamp", () => {
    const input = buildInput({
      mode: "cost",
      importRates: [9, 10],
      exportRates: [6, 6],
      loadKwh: 1,
      solarKwh: 0,
      capturedAt: "2026-03-16T10:05:00.000Z",
    });

    const first = optimize(input);
    const second = optimize(input);

    expect(first).toEqual(second);
  });

  it("changes generated metadata when injected planning timestamp changes", () => {
    const baseParams = {
      mode: "cost" as const,
      importRates: [9, 10],
      exportRates: [6, 6],
      loadKwh: 1,
      solarKwh: 0,
    };

    const first = optimize(
      buildInput({
        ...baseParams,
        capturedAt: "2026-03-16T10:05:00.000Z",
      }),
    );
    const second = optimize(
      buildInput({
        ...baseParams,
        capturedAt: "2026-03-16T10:35:00.000Z",
      }),
    );

    expect(first.generatedAt).toBe("2026-03-16T10:05:00.000Z");
    expect(second.generatedAt).toBe("2026-03-16T10:35:00.000Z");
    expect(first.planId).not.toBe(second.planId);
  });
});
