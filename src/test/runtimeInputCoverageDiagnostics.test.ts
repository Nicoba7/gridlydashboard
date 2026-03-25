import { describe, expect, it } from "vitest";
import type { DeviceState, OptimizerInput } from "../domain";
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

function buildInput(params?: {
  exportRatesCount?: number;
  loadSlotsCount?: number;
  solarSlotsCount?: number;
}): OptimizerInput {
  const start = new Date("2026-03-16T10:00:00.000Z").getTime();
  const totalSlots = 4;
  const exportRatesCount = params?.exportRatesCount ?? totalSlots;
  const loadSlotsCount = params?.loadSlotsCount ?? totalSlots;
  const solarSlotsCount = params?.solarSlotsCount ?? totalSlots;

  return {
    systemState: {
      siteId: "site-1",
      capturedAt: "2026-03-16T10:00:00.000Z",
      timezone: "Europe/London",
      devices: buildDevices(),
      homeLoadW: 2000,
      solarGenerationW: 500,
      batteryPowerW: 0,
      evChargingPowerW: 0,
      gridPowerW: 1500,
      batterySocPercent: 60,
      batteryCapacityKwh: 10,
      evConnected: false,
    },
    forecasts: {
      generatedAt: "2026-03-16T10:00:00.000Z",
      horizonStartAt: "2026-03-16T10:00:00.000Z",
      horizonEndAt: new Date(start + totalSlots * 30 * 60 * 1000).toISOString(),
      slotDurationMinutes: 30,
      householdLoadKwh: Array.from({ length: loadSlotsCount }).map((_, index) => ({
        startAt: new Date(start + index * 30 * 60 * 1000).toISOString(),
        endAt: new Date(start + (index + 1) * 30 * 60 * 1000).toISOString(),
        value: 1,
        confidence: 0.9,
      })),
      solarGenerationKwh: Array.from({ length: solarSlotsCount }).map((_, index) => ({
        startAt: new Date(start + index * 30 * 60 * 1000).toISOString(),
        endAt: new Date(start + (index + 1) * 30 * 60 * 1000).toISOString(),
        value: 0.2,
        confidence: 0.9,
      })),
      carbonIntensity: Array.from({ length: totalSlots }).map((_, index) => ({
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
      importRates: Array.from({ length: totalSlots }).map((_, index) => ({
        startAt: new Date(start + index * 30 * 60 * 1000).toISOString(),
        endAt: new Date(start + (index + 1) * 30 * 60 * 1000).toISOString(),
        unitRatePencePerKwh: 15,
        source: "live" as const,
      })),
      exportRates: Array.from({ length: exportRatesCount }).map((_, index) => ({
        startAt: new Date(start + index * 30 * 60 * 1000).toISOString(),
        endAt: new Date(start + (index + 1) * 30 * 60 * 1000).toISOString(),
        unitRatePencePerKwh: 8,
        source: "live" as const,
      })),
    },
    constraints: {
      mode: "balanced",
      batteryReservePercent: 30,
      maxBatteryCyclesPerDay: 2,
      allowGridBatteryCharging: true,
      allowBatteryExport: true,
      allowAutomaticEvCharging: false,
      evTargetSocPercent: 85,
      evReadyBy: "07:00",
    },
  };
}

describe("canonical runtime input coverage diagnostics", () => {
  it("flags partial export tariff coverage", () => {
    const result = optimize(
      buildInput({
        exportRatesCount: 2,
      }),
    );

    expect(result.warnings).toContain("PARTIAL_EXPORT_RATE_COVERAGE");
    expect(result.planningInputCoverage?.tariffExport.availableSlots).toBe(2);
    expect(result.planningInputCoverage?.tariffExport.totalPlannedSlots).toBe(4);
    expect(result.planningInputCoverage?.tariffExport.coveragePercent).toBe(50);
  });

  it("flags fallback/default forecast slot usage", () => {
    const result = optimize(
      buildInput({
        loadSlotsCount: 2,
      }),
    );

    expect(result.warnings).toContain("FALLBACK_SLOT_DEFAULTS_APPLIED");
    expect(result.planningInputCoverage?.fallbackByType.loadForecastSlots).toBe(2);
    expect((result.planningInputCoverage?.fallbackSlotCount ?? 0)).toBeGreaterThan(0);
  });

  it("has no partial-coverage warnings when all inputs are complete", () => {
    const result = optimize(buildInput());

    expect(result.warnings).not.toContain("PARTIAL_EXPORT_RATE_COVERAGE");
    expect(result.warnings).not.toContain("FALLBACK_SLOT_DEFAULTS_APPLIED");
    expect(result.planningInputCoverage?.fallbackSlotCount).toBe(0);
    expect(result.planningInputCoverage?.tariffExport.coveragePercent).toBe(100);
    expect(result.planningInputCoverage?.forecastLoad.coveragePercent).toBe(100);
    expect(result.planningInputCoverage?.forecastSolar.coveragePercent).toBe(100);
  });
});
