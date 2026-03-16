import type { OptimizationMode, TariffRate } from "../domain";

export interface MarginalStoredEnergyValuePoint {
  slotIndex: number;
  importAvoidancePencePerKwh: number;
  exportOpportunityPencePerKwh: number;
  grossStoredEnergyValuePencePerKwh: number;
  netStoredEnergyValuePencePerKwh: number;
  batteryDegradationCostPencePerKwh: number;
  effectiveStoredEnergyValuePencePerKwh: number;
}

export interface MarginalStoredEnergyValueAssumptions {
  roundTripEfficiency: number;
  exportMissingFallbackApplied: boolean;
  batteryDegradationCostPencePerKwh: number;
  degradationCostFallbackApplied: boolean;
}

export interface MarginalStoredEnergyValueResult {
  points: MarginalStoredEnergyValuePoint[];
  assumptions: MarginalStoredEnergyValueAssumptions;
}

export interface BuildMarginalStoredEnergyValueInput {
  importRates: TariffRate[];
  exportRates?: TariffRate[];
  mode: OptimizationMode;
  roundTripEfficiency?: number;
  batteryDegradationCostPencePerKwh?: number;
}

function clampEfficiency(input: number | undefined): number {
  if (input === undefined || !Number.isFinite(input)) {
    return 0.9;
  }

  return Math.min(1, Math.max(0.5, input));
}

function exportModeWeight(mode: OptimizationMode): number {
  if (mode === "cost") return 1;
  if (mode === "balanced") return 0.9;
  if (mode === "carbon") return 0.75;
  return 0.5;
}

function clampDegradationCost(input: number | undefined): number {
  if (input === undefined || !Number.isFinite(input)) {
    return 2;
  }

  return Math.max(0, input);
}

/**
 * Forward-looking value of one additional kWh stored in the battery.
 *
 * All values are in pence per kWh of stored energy, adjusted by round-trip efficiency.
 */
export function buildMarginalStoredEnergyValueProfile(
  input: BuildMarginalStoredEnergyValueInput,
): MarginalStoredEnergyValueResult {
  const roundTripEfficiency = clampEfficiency(input.roundTripEfficiency);
  const batteryDegradationCostPencePerKwh = clampDegradationCost(input.batteryDegradationCostPencePerKwh);
  const exportWeight = exportModeWeight(input.mode);
  const points: MarginalStoredEnergyValuePoint[] = input.importRates.map((importRate, slotIndex) => {
    const importPencePerKwh = Math.max(0, importRate.unitRatePencePerKwh);
    const exportPencePerKwh = Math.max(0, input.exportRates?.[slotIndex]?.unitRatePencePerKwh ?? 0);

    const importAvoidancePencePerKwh = Number((importPencePerKwh * roundTripEfficiency).toFixed(3));
    const exportOpportunityPencePerKwh = Number((exportPencePerKwh * roundTripEfficiency).toFixed(3));
    const grossStoredEnergyValuePencePerKwh = Number(
      Math.max(importAvoidancePencePerKwh, exportOpportunityPencePerKwh * exportWeight).toFixed(3),
    );
    const netStoredEnergyValuePencePerKwh = Number(
      Math.max(0, grossStoredEnergyValuePencePerKwh - batteryDegradationCostPencePerKwh).toFixed(3),
    );
    const effectiveStoredEnergyValuePencePerKwh = netStoredEnergyValuePencePerKwh;

    return {
      slotIndex,
      importAvoidancePencePerKwh,
      exportOpportunityPencePerKwh,
      grossStoredEnergyValuePencePerKwh,
      netStoredEnergyValuePencePerKwh,
      batteryDegradationCostPencePerKwh,
      effectiveStoredEnergyValuePencePerKwh,
    };
  });

  return {
    points,
    assumptions: {
      roundTripEfficiency,
      exportMissingFallbackApplied: !input.exportRates?.length,
      batteryDegradationCostPencePerKwh,
      degradationCostFallbackApplied: input.batteryDegradationCostPencePerKwh === undefined,
    },
  };
}
