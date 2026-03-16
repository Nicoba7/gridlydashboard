import { describe, expect, it } from "vitest";
import type { TariffRate } from "../domain";
import { buildMarginalStoredEnergyValueProfile } from "../optimizer/marginalStoredEnergyValue";

function rate(value: number): TariffRate {
  return {
    startAt: "2026-03-16T10:00:00.000Z",
    endAt: "2026-03-16T10:30:00.000Z",
    unitRatePencePerKwh: value,
    source: "live",
  };
}

describe("buildMarginalStoredEnergyValueProfile", () => {
  it("handles import-only case", () => {
    const result = buildMarginalStoredEnergyValueProfile({
      mode: "cost",
      importRates: [rate(20)],
      exportRates: [],
      roundTripEfficiency: 0.9,
    });

    expect(result.points[0]?.importAvoidancePencePerKwh).toBe(18);
    expect(result.points[0]?.exportOpportunityPencePerKwh).toBe(0);
    expect(result.points[0]?.effectiveStoredEnergyValuePencePerKwh).toBe(16);
  });

  it("uses export-aware value in cost mode", () => {
    const result = buildMarginalStoredEnergyValueProfile({
      mode: "cost",
      importRates: [rate(10)],
      exportRates: [rate(24)],
      roundTripEfficiency: 0.9,
    });

    expect(result.points[0]?.importAvoidancePencePerKwh).toBe(9);
    expect(result.points[0]?.exportOpportunityPencePerKwh).toBe(21.6);
    expect(result.points[0]?.grossStoredEnergyValuePencePerKwh).toBe(21.6);
    expect(result.points[0]?.netStoredEnergyValuePencePerKwh).toBe(19.6);
    expect(result.points[0]?.batteryDegradationCostPencePerKwh).toBe(2);
    expect(result.points[0]?.effectiveStoredEnergyValuePencePerKwh).toBe(19.6);
  });

  it("handles negative import and strong future export by clamping import floor to zero", () => {
    const result = buildMarginalStoredEnergyValueProfile({
      mode: "cost",
      importRates: [rate(-5), rate(12)],
      exportRates: [rate(30), rate(8)],
      roundTripEfficiency: 0.9,
    });

    expect(result.points[0]?.importAvoidancePencePerKwh).toBe(0);
    expect(result.points[0]?.exportOpportunityPencePerKwh).toBe(27);
    expect(result.points[0]?.effectiveStoredEnergyValuePencePerKwh).toBe(25);
  });

  it("flags fallback assumption when export rates are missing", () => {
    const result = buildMarginalStoredEnergyValueProfile({
      mode: "balanced",
      importRates: [rate(15)],
      roundTripEfficiency: 0.9,
    });

    expect(result.assumptions.exportMissingFallbackApplied).toBe(true);
    expect(result.assumptions.degradationCostFallbackApplied).toBe(true);
    expect(result.assumptions.batteryDegradationCostPencePerKwh).toBe(2);
    expect(result.points[0]?.exportOpportunityPencePerKwh).toBe(0);
  });

  it("falls back to gross value when degradation cost is disabled", () => {
    const result = buildMarginalStoredEnergyValueProfile({
      mode: "cost",
      importRates: [rate(10)],
      exportRates: [rate(24)],
      roundTripEfficiency: 0.9,
      batteryDegradationCostPencePerKwh: 0,
    });

    expect(result.assumptions.degradationCostFallbackApplied).toBe(false);
    expect(result.points[0]?.grossStoredEnergyValuePencePerKwh).toBe(21.6);
    expect(result.points[0]?.netStoredEnergyValuePencePerKwh).toBe(21.6);
    expect(result.points[0]?.effectiveStoredEnergyValuePencePerKwh).toBe(21.6);
  });

  it("rejects export-led stored value when wear cost outweighs gain", () => {
    const result = buildMarginalStoredEnergyValueProfile({
      mode: "cost",
      importRates: [rate(4)],
      exportRates: [rate(5)],
      roundTripEfficiency: 0.9,
      batteryDegradationCostPencePerKwh: 5,
    });

    expect(result.points[0]?.exportOpportunityPencePerKwh).toBe(4.5);
    expect(result.points[0]?.grossStoredEnergyValuePencePerKwh).toBe(4.5);
    expect(result.points[0]?.netStoredEnergyValuePencePerKwh).toBe(0);
  });
});
