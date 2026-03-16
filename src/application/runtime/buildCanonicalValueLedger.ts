import type { Forecasts, OptimizationMode, TariffSchedule } from "../../domain";
import type { OptimizerOutput } from "../../domain/optimizer";
import type { CanonicalValueLedger } from "../../domain/valueLedger";

export interface BuildCanonicalValueLedgerInput {
  optimizationMode: OptimizationMode;
  optimizerOutput: OptimizerOutput;
  forecasts: Forecasts;
  tariffSchedule: TariffSchedule;
}

function computeHoldCurrentStateBaseline(
  forecasts: Forecasts,
  tariffSchedule: TariffSchedule,
): {
  importCostPence: number;
  exportRevenuePence: number;
  batteryDegradationCostPence: number;
  netCostPence: number;
  caveats: string[];
} {
  const caveats: string[] = [];
  const slotCount = Math.min(
    tariffSchedule.importRates.length,
    forecasts.householdLoadKwh.length,
    forecasts.solarGenerationKwh.length,
  );

  if (slotCount === 0) {
    caveats.push("Baseline could not be computed from zero overlapping forecast/tariff slots.");
    return {
      importCostPence: 0,
      exportRevenuePence: 0,
      batteryDegradationCostPence: 0,
      netCostPence: 0,
      caveats,
    };
  }

  if (
    tariffSchedule.importRates.length !== forecasts.householdLoadKwh.length ||
    forecasts.householdLoadKwh.length !== forecasts.solarGenerationKwh.length
  ) {
    caveats.push("Baseline used overlapping slots only due to tariff/forecast horizon mismatch.");
  }

  let importCostPence = 0;
  let exportRevenuePence = 0;

  for (let index = 0; index < slotCount; index += 1) {
    const loadKwh = forecasts.householdLoadKwh[index]?.value ?? 0;
    const solarKwh = forecasts.solarGenerationKwh[index]?.value ?? 0;
    const importRate = tariffSchedule.importRates[index]?.unitRatePencePerKwh ?? 0;
    const exportRate = tariffSchedule.exportRates?.[index]?.unitRatePencePerKwh ?? 0;

    const importKwh = Math.max(0, loadKwh - solarKwh);
    const exportKwh = Math.max(0, solarKwh - loadKwh);

    importCostPence += importKwh * importRate;
    exportRevenuePence += exportKwh * exportRate;
  }

  if (!tariffSchedule.exportRates?.length) {
    caveats.push("Baseline export revenue assumes zero value when export tariff slots are unavailable.");
  }

  const roundedImportCostPence = Math.round(importCostPence);
  const roundedExportRevenuePence = Math.round(exportRevenuePence);

  return {
    importCostPence: roundedImportCostPence,
    exportRevenuePence: roundedExportRevenuePence,
    batteryDegradationCostPence: 0,
    netCostPence: roundedImportCostPence - roundedExportRevenuePence,
    caveats,
  };
}

export function buildCanonicalValueLedger(
  input: BuildCanonicalValueLedgerInput,
): CanonicalValueLedger {
  const estimatedImportCostPence = input.optimizerOutput.summary.expectedImportCostPence;
  const estimatedExportRevenuePence = input.optimizerOutput.summary.expectedExportRevenuePence;
  const estimatedBatteryDegradationCostPence = input.optimizerOutput.summary.expectedBatteryDegradationCostPence ?? 0;
  const estimatedNetCostPence = estimatedImportCostPence - estimatedExportRevenuePence + estimatedBatteryDegradationCostPence;

  const baseline = computeHoldCurrentStateBaseline(input.forecasts, input.tariffSchedule);

  const assumptions = [
    "Estimated optimized value uses canonical optimizer summary for this planning run.",
    "Baseline uses hold_current_state: forecast load/solar is settled directly against tariff slots with no optimization actions.",
  ];

  if (estimatedBatteryDegradationCostPence > 0) {
    assumptions.push("Estimated optimized value includes battery degradation cost for planned discharge throughput.");
  }

  if (!input.tariffSchedule.exportRates?.length) {
    assumptions.push("No export tariff schedule was available; baseline export value is conservatively treated as zero.");
  }

  return {
    optimizationMode: input.optimizationMode,
    estimatedImportCostPence,
    estimatedExportRevenuePence,
    estimatedBatteryDegradationCostPence,
    estimatedNetCostPence,
    baselineType: "hold_current_state",
    baselineNetCostPence: baseline.netCostPence,
    baselineImportCostPence: baseline.importCostPence,
    baselineExportRevenuePence: baseline.exportRevenuePence,
    baselineBatteryDegradationCostPence: baseline.batteryDegradationCostPence,
    estimatedSavingsVsBaselinePence: baseline.netCostPence - estimatedNetCostPence,
    assumptions,
    caveats: baseline.caveats,
    confidence: input.optimizerOutput.confidence,
  };
}
