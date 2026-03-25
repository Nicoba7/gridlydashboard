import { describe, expect, it } from "vitest";
import type { DeviceState, OptimizerInput, SystemState } from "../domain";
import { optimize } from "../optimizer/engine";
import { buildConstraintsForPlanningStyle, resolvePlanningStyle } from "../application/runtime/planningStyleStore";

type PlanningStyleFixture = "cheapest" | "balanced" | "greenest";

function buildDevices(params?: { includeBattery?: boolean; includeSolar?: boolean; includeEv?: boolean }): DeviceState[] {
  const includeBattery = params?.includeBattery ?? true;
  const includeSolar = params?.includeSolar ?? true;
  const includeEv = params?.includeEv ?? false;

  return [
    includeBattery
      ? {
          deviceId: "battery-1",
          kind: "battery",
          brand: "GivEnergy",
          name: "Battery",
          connectionStatus: "online",
          lastUpdatedAt: "2026-03-16T10:00:00.000Z",
          capabilities: ["set_mode", "read_power", "read_soc"],
          capacityKwh: 10,
        }
      : undefined,
    includeSolar
      ? {
          deviceId: "solar-1",
          kind: "solar_inverter",
          brand: "SolarEdge",
          name: "Solar",
          connectionStatus: "online",
          lastUpdatedAt: "2026-03-16T10:00:00.000Z",
          capabilities: ["set_mode", "read_power", "read_energy"],
        }
      : undefined,
    {
      deviceId: "grid-1",
      kind: "smart_meter",
      brand: "Octopus",
      name: "Grid",
      connectionStatus: "online",
      lastUpdatedAt: "2026-03-16T10:00:00.000Z",
      capabilities: ["read_tariff", "read_power"],
    },
    includeEv
      ? {
          deviceId: "ev-1",
          kind: "ev_charger",
          brand: "Tesla",
          name: "EV Charger",
          connectionStatus: "online",
          lastUpdatedAt: "2026-03-16T10:00:00.000Z",
          capabilities: ["schedule_window", "read_power", "read_soc"],
          capacityKwh: 60,
        }
      : undefined,
  ].filter((device): device is DeviceState => Boolean(device));
}

function buildInput(params: {
  planningStyle: PlanningStyleFixture;
  importRates: number[];
  exportRates: number[];
  loadKwh: number;
  solarKwh: number;
  startAt?: string;
  batterySocPercent?: number;
  evSocPercent?: number;
  includeBattery?: boolean;
  includeSolar?: boolean;
  includeEv?: boolean;
}): OptimizerInput {
  const startAt = params.startAt ?? "2026-03-16T10:00:00.000Z";
  const startMs = new Date(startAt).getTime();
  const devices = buildDevices({
    includeBattery: params.includeBattery,
    includeSolar: params.includeSolar,
    includeEv: params.includeEv,
  });
  const systemState: SystemState = {
    siteId: "site-1",
    capturedAt: startAt,
    timezone: "Europe/London",
    devices,
    homeLoadW: Math.round(params.loadKwh * 2000),
    solarGenerationW: Math.round(params.solarKwh * 2000),
    batteryPowerW: 0,
    evChargingPowerW: 0,
    gridPowerW: 0,
    batterySocPercent: params.batterySocPercent,
    batteryCapacityKwh: params.includeBattery === false ? undefined : 10,
    evSocPercent: params.evSocPercent,
    evConnected: params.includeEv ?? false,
  };

  const resolvedPlanningStyle = resolvePlanningStyle({ GRIDLY_PLANNING_STYLE: params.planningStyle });
  const constraints = buildConstraintsForPlanningStyle(devices, resolvedPlanningStyle);

  return {
    systemState,
    forecasts: {
      generatedAt: startAt,
      horizonStartAt: startAt,
      horizonEndAt: new Date(startMs + params.importRates.length * 30 * 60 * 1000).toISOString(),
      slotDurationMinutes: 30,
      householdLoadKwh: params.importRates.map((_, index) => ({
        startAt: new Date(startMs + index * 30 * 60 * 1000).toISOString(),
        endAt: new Date(startMs + (index + 1) * 30 * 60 * 1000).toISOString(),
        value: params.loadKwh,
        confidence: 0.92,
      })),
      solarGenerationKwh: params.importRates.map((_, index) => ({
        startAt: new Date(startMs + index * 30 * 60 * 1000).toISOString(),
        endAt: new Date(startMs + (index + 1) * 30 * 60 * 1000).toISOString(),
        value: params.solarKwh,
        confidence: 0.92,
      })),
      carbonIntensity: params.importRates.map((_, index) => ({
        startAt: new Date(startMs + index * 30 * 60 * 1000).toISOString(),
        endAt: new Date(startMs + (index + 1) * 30 * 60 * 1000).toISOString(),
        value: 180,
        confidence: 0.9,
      })),
    },
    tariffSchedule: {
      tariffId: "tariff-1",
      provider: "Aveum",
      name: "Synthetic",
      currency: "GBP",
      updatedAt: startAt,
      importRates: params.importRates.map((rate, index) => ({
        startAt: new Date(startMs + index * 30 * 60 * 1000).toISOString(),
        endAt: new Date(startMs + (index + 1) * 30 * 60 * 1000).toISOString(),
        unitRatePencePerKwh: rate,
        source: "live",
      })),
      exportRates: params.exportRates.map((rate, index) => ({
        startAt: new Date(startMs + index * 30 * 60 * 1000).toISOString(),
        endAt: new Date(startMs + (index + 1) * 30 * 60 * 1000).toISOString(),
        unitRatePencePerKwh: rate,
        source: "live",
      })),
    },
    constraints,
  };
}

describe("canonical planning style profiles", () => {
  it("changes solar surplus handling between export-oriented and self-consumption-oriented styles", () => {
    const cheapest = optimize(buildInput({
      planningStyle: "cheapest",
      importRates: [20],
      exportRates: [19],
      loadKwh: 1,
      solarKwh: 3,
    }));
    const balanced = optimize(buildInput({
      planningStyle: "balanced",
      importRates: [20],
      exportRates: [19],
      loadKwh: 1,
      solarKwh: 3,
    }));
    const greenest = optimize(buildInput({
      planningStyle: "greenest",
      importRates: [20],
      exportRates: [19],
      loadKwh: 1,
      solarKwh: 3,
    }));

    expect(cheapest.decisions[0]?.action).toBe("export_to_grid");
    expect(balanced.decisions[0]?.action).toBe("export_to_grid");
    expect(greenest.decisions[0]?.action).toBe("consume_solar");
    expect(greenest.decisions[0]?.reason).toContain("Greenest");
  });

  it("changes battery discharge behavior through the reserve floor under identical tariffs", () => {
    const cheapest = optimize(buildInput({
      planningStyle: "cheapest",
      importRates: [26, 14],
      exportRates: [0, 0],
      loadKwh: 1,
      solarKwh: 0,
      batterySocPercent: 36,
    }));
    const balanced = optimize(buildInput({
      planningStyle: "balanced",
      importRates: [26, 14],
      exportRates: [0, 0],
      loadKwh: 1,
      solarKwh: 0,
      batterySocPercent: 36,
    }));
    const greenest = optimize(buildInput({
      planningStyle: "greenest",
      importRates: [26, 14],
      exportRates: [0, 0],
      loadKwh: 1,
      solarKwh: 0,
      batterySocPercent: 36,
    }));

    expect(cheapest.decisions[0]?.action).toBe("discharge_battery");
    expect(balanced.decisions[0]?.action).toBe("discharge_battery");
    expect(greenest.decisions[0]?.action).toBe("hold");
    expect(greenest.decisions[0]?.reason).toContain("Greenest");
  });

  it("changes EV charging urgency under the same near-deadline scenario", () => {
    const cheapest = optimize(buildInput({
      planningStyle: "cheapest",
      importRates: [13, 7, 7],
      exportRates: [0, 0, 0],
      loadKwh: 0.5,
      solarKwh: 0,
      startAt: "2026-03-16T05:30:00.000Z",
      includeBattery: false,
      includeSolar: false,
      includeEv: true,
      evSocPercent: 40,
    }));
    const balanced = optimize(buildInput({
      planningStyle: "balanced",
      importRates: [13, 7, 7],
      exportRates: [0, 0, 0],
      loadKwh: 0.5,
      solarKwh: 0,
      startAt: "2026-03-16T05:30:00.000Z",
      includeBattery: false,
      includeSolar: false,
      includeEv: true,
      evSocPercent: 40,
    }));
    const greenest = optimize(buildInput({
      planningStyle: "greenest",
      importRates: [13, 7, 7],
      exportRates: [0, 0, 0],
      loadKwh: 0.5,
      solarKwh: 0,
      startAt: "2026-03-16T05:30:00.000Z",
      includeBattery: false,
      includeSolar: false,
      includeEv: true,
      evSocPercent: 40,
    }));

    expect(cheapest.decisions[0]?.action).toBe("charge_ev");
    expect(cheapest.decisions[0]?.reason).toContain("Cheapest");
    expect(balanced.decisions[0]?.action).toBe("hold");
    expect(greenest.decisions[0]?.action).toBe("hold");
  });
});