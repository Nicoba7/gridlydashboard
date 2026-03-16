import type {
  DeviceCapability,
  DeviceCommand,
  PlanningConfidenceLevel,
  PlanningInputCoverage,
  OptimizerDecision,
  OptimizerDecisionTarget,
  OptimizerDiagnostic,
  OptimizerInput,
  OptimizationMode,
  OptimizerSummary,
  TimeWindow,
} from "../domain";
import { buildMarginalStoredEnergyValueProfile } from "./marginalStoredEnergyValue";

export interface CanonicalRuntimeResult {
  schemaVersion: string;
  plannerVersion: string;
  planId: string;
  generatedAt: string;
  planningWindow?: TimeWindow;
  assumptions: string[];
  warnings: string[];
  feasibility: {
    executable: boolean;
    reasonCodes: string[];
    blockingCodes?: string[];
  };
  headline: string;
  decisions: OptimizerDecision[];
  recommendedCommands: DeviceCommand[];
  summary: OptimizerSummary;
  diagnostics: OptimizerDiagnostic[];
  planningInputCoverage: PlanningInputCoverage;
  planningConfidenceLevel?: PlanningConfidenceLevel;
  conservativeAdjustmentApplied?: boolean;
  conservativeAdjustmentReason?: string;
  confidence: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toCoverageMetric(availableSlots: number, totalPlannedSlots: number): PlanningInputCoverage["tariffImport"] {
  if (totalPlannedSlots <= 0) {
    return {
      availableSlots,
      totalPlannedSlots,
      coveragePercent: 0,
    };
  }

  return {
    availableSlots,
    totalPlannedSlots,
    coveragePercent: Number(((availableSlots / totalPlannedSlots) * 100).toFixed(1)),
  };
}

interface PlanningCoverageCounts {
  importCoverageCount: number;
  exportCoverageCount: number;
  loadCoverageCount: number;
  solarCoverageCount: number;
  fallbackSlotCount: number;
  fallbackExportRateSlots: number;
  fallbackLoadForecastSlots: number;
  fallbackSolarForecastSlots: number;
}

interface ConservatismPolicy {
  planningConfidenceLevel: PlanningConfidenceLevel;
  conservativeAdjustmentApplied: boolean;
  conservativeAdjustmentReason?: string;
  minValueSpreadPencePerKwh: number;
  exportAttractivenessPremiumRatio: number;
  allowHeuristicCycling: boolean;
}

function computePlanningCoverageCounts(input: OptimizerInput, slotCount: number): PlanningCoverageCounts {
  const importCoverageCount = input.tariffSchedule.importRates.slice(0, slotCount).filter((rate) => rate !== undefined).length;
  const exportCoverageCount = (input.tariffSchedule.exportRates ?? []).slice(0, slotCount).filter((rate) => rate !== undefined).length;
  const loadCoverageCount = input.forecasts.householdLoadKwh.slice(0, slotCount).filter((slot) => slot !== undefined).length;
  const solarCoverageCount = input.forecasts.solarGenerationKwh.slice(0, slotCount).filter((slot) => slot !== undefined).length;

  let fallbackSlotCount = 0;
  let fallbackExportRateSlots = 0;
  let fallbackLoadForecastSlots = 0;
  let fallbackSolarForecastSlots = 0;

  for (let index = 0; index < slotCount; index += 1) {
    const missingExport = !input.tariffSchedule.exportRates?.[index];
    const missingLoad = !input.forecasts.householdLoadKwh[index];
    const missingSolar = !input.forecasts.solarGenerationKwh[index];

    if (missingExport) fallbackExportRateSlots += 1;
    if (missingLoad) fallbackLoadForecastSlots += 1;
    if (missingSolar) fallbackSolarForecastSlots += 1;
    if (missingExport || missingLoad || missingSolar) fallbackSlotCount += 1;
  }

  return {
    importCoverageCount,
    exportCoverageCount,
    loadCoverageCount,
    solarCoverageCount,
    fallbackSlotCount,
    fallbackExportRateSlots,
    fallbackLoadForecastSlots,
    fallbackSolarForecastSlots,
  };
}

function buildPlanningInputCoverage(slotCount: number, counts: PlanningCoverageCounts): PlanningInputCoverage {
  const coverage: PlanningInputCoverage = {
    plannedSlotCount: slotCount,
    tariffImport: toCoverageMetric(counts.importCoverageCount, slotCount),
    tariffExport: toCoverageMetric(counts.exportCoverageCount, slotCount),
    forecastLoad: toCoverageMetric(counts.loadCoverageCount, slotCount),
    forecastSolar: toCoverageMetric(counts.solarCoverageCount, slotCount),
    fallbackSlotCount: counts.fallbackSlotCount,
    fallbackByType: {
      exportRateSlots: counts.fallbackExportRateSlots,
      loadForecastSlots: counts.fallbackLoadForecastSlots,
      solarForecastSlots: counts.fallbackSolarForecastSlots,
    },
    caveats: [],
  };

  if (coverage.tariffExport.availableSlots > 0 && coverage.tariffExport.availableSlots < slotCount) {
    coverage.caveats.push("Export tariff coverage is partial; missing export slots used fallback assumptions.");
  }

  if (coverage.fallbackSlotCount > 0) {
    coverage.caveats.push("Fallback/default slot values were used for at least one planned slot.");
  }

  return coverage;
}

function buildConservatismPolicy(coverage: PlanningInputCoverage): ConservatismPolicy {
  const reasons: string[] = [];
  let planningConfidenceLevel: PlanningConfidenceLevel = "high";

  if (coverage.tariffExport.availableSlots === 0) {
    planningConfidenceLevel = "low";
    reasons.push("No export tariff rates available across planned horizon.");
  } else if (coverage.tariffExport.availableSlots < coverage.plannedSlotCount) {
    planningConfidenceLevel = "medium";
    reasons.push("Export tariff coverage is partial.");
  }

  if (coverage.fallbackSlotCount > 0) {
    planningConfidenceLevel = planningConfidenceLevel === "low" ? "low" : "medium";
    reasons.push("Fallback/default forecast or tariff values were used.");
  }

  if (coverage.fallbackSlotCount >= Math.ceil(coverage.plannedSlotCount * 0.5)) {
    planningConfidenceLevel = "low";
    reasons.push("Fallback/default slots represent a large share of the planning horizon.");
  }

  if (planningConfidenceLevel === "low") {
    return {
      planningConfidenceLevel,
      conservativeAdjustmentApplied: true,
      conservativeAdjustmentReason: reasons.join(" "),
      minValueSpreadPencePerKwh: 2,
      exportAttractivenessPremiumRatio: 0.25,
      allowHeuristicCycling: false,
    };
  }

  if (planningConfidenceLevel === "medium") {
    return {
      planningConfidenceLevel,
      conservativeAdjustmentApplied: true,
      conservativeAdjustmentReason: reasons.join(" "),
      minValueSpreadPencePerKwh: 1.25,
      exportAttractivenessPremiumRatio: 0.12,
      allowHeuristicCycling: false,
    };
  }

  return {
    planningConfidenceLevel,
    conservativeAdjustmentApplied: false,
    conservativeAdjustmentReason: undefined,
    minValueSpreadPencePerKwh: 0.5,
    exportAttractivenessPremiumRatio: 0,
    allowHeuristicCycling: true,
  };
}

function isFiniteTimestamp(timestamp: string | undefined): boolean {
  if (!timestamp) {
    return false;
  }

  return Number.isFinite(new Date(timestamp).getTime());
}

function resolvePlanningTimestamp(input: OptimizerInput): string {
  if (isFiniteTimestamp(input.systemState.capturedAt)) {
    return input.systemState.capturedAt;
  }

  const firstImportStart = input.tariffSchedule.importRates[0]?.startAt;
  if (isFiniteTimestamp(firstImportStart)) {
    return firstImportStart as string;
  }

  if (isFiniteTimestamp(input.forecasts.horizonStartAt)) {
    return input.forecasts.horizonStartAt;
  }

  return "1970-01-01T00:00:00.000Z";
}

function toPlanToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32) || "na";
}

function toPlanId(siteId: string, generatedAt: string, mode: OptimizationMode, horizonStartAt: string, horizonEndAt: string): string {
  return [siteId, mode, generatedAt, horizonStartAt, horizonEndAt]
    .map((value) => toPlanToken(value))
    .join("-");
}

interface ModePolicy {
  lowImportThresholdFactor: number;
  highImportThresholdFactor: number;
  evChargeThresholdFactor: number;
  exportAttractivenessRatio: number;
}

/**
 * Mode policy tunes the same planner mechanics toward each product objective
 * without introducing a separate optimizer implementation per mode.
 */
function buildModePolicy(mode: OptimizationMode): ModePolicy {
  if (mode === "cost") {
    return {
      lowImportThresholdFactor: 0.95,
      highImportThresholdFactor: 1.05,
      evChargeThresholdFactor: 1,
      exportAttractivenessRatio: 0.8,
    };
  }

  if (mode === "carbon") {
    return {
      lowImportThresholdFactor: 0.9,
      highImportThresholdFactor: 1.1,
      evChargeThresholdFactor: 1.1,
      exportAttractivenessRatio: 1,
    };
  }

  if (mode === "self_consumption") {
    return {
      lowImportThresholdFactor: 0.88,
      highImportThresholdFactor: 1.12,
      evChargeThresholdFactor: 0.95,
      exportAttractivenessRatio: 1.2,
    };
  }

  return {
    lowImportThresholdFactor: 0.85,
    highImportThresholdFactor: 1.15,
    evChargeThresholdFactor: 1,
    exportAttractivenessRatio: 0.9,
  };
}

function requiredCapabilitiesForAction(action: OptimizerDecision["action"]): DeviceCapability[] {
  if (action === "charge_ev") return ["schedule_window"];
  if (action === "charge_battery" || action === "discharge_battery" || action === "export_to_grid") {
    return ["set_mode"];
  }

  return [];
}

function mapDecisionTargets(
  targetDeviceIds: string[],
  action: OptimizerDecision["action"],
  input: OptimizerInput,
): OptimizerDecisionTarget[] {
  const requiredCapabilities = requiredCapabilitiesForAction(action);

  return targetDeviceIds.map((deviceId) => {
    const matchedDevice = input.systemState.devices.find(
      (device) => device.deviceId === deviceId,
    );

    return {
      deviceId,
      kind: matchedDevice?.kind,
      requiredCapabilities: requiredCapabilities.length ? requiredCapabilities : undefined,
    };
  });
}

function buildHeadline(decisions: OptimizerDecision[]): string {
  const firstAction = decisions.find((decision) => decision.action !== "hold");

  if (!firstAction) {
    return "Gridly is holding steady while it waits for a stronger opportunity.";
  }

  if (firstAction.action === "charge_ev") {
    return "Gridly is charging your EV in a lower-cost window.";
  }

  if (firstAction.action === "charge_battery") {
    return "Gridly is charging your battery while rates are favorable.";
  }

  if (firstAction.action === "export_to_grid") {
    return "Gridly is exporting energy while export value is strong.";
  }

  if (firstAction.action === "discharge_battery") {
    return "Gridly is using battery energy to reduce high-cost import.";
  }

  return "Gridly is matching live demand with available solar generation.";
}

function buildCommands(decisions: OptimizerDecision[], generatedAt: string, planId: string): DeviceCommand[] {
  const commands: DeviceCommand[] = [];

  decisions.forEach((decision, index) => {
    const primaryTargetDeviceId = decision.targetDeviceIds[0];
    if (!primaryTargetDeviceId) {
      return;
    }

    if (decision.action === "charge_battery") {
      commands.push({
        commandId: `${planId}-battery-${index}`,
        deviceId: primaryTargetDeviceId,
        issuedAt: generatedAt,
        type: "set_mode",
        mode: "charge",
        effectiveWindow: { startAt: decision.startAt, endAt: decision.endAt },
        reason: decision.reason,
      });
    } else if (decision.action === "discharge_battery") {
      commands.push({
        commandId: `${planId}-discharge-${index}`,
        deviceId: primaryTargetDeviceId,
        issuedAt: generatedAt,
        type: "set_mode",
        mode: "discharge",
        effectiveWindow: { startAt: decision.startAt, endAt: decision.endAt },
        reason: decision.reason,
      });
    } else if (decision.action === "export_to_grid") {
      commands.push({
        commandId: `${planId}-export-${index}`,
        deviceId: primaryTargetDeviceId,
        issuedAt: generatedAt,
        type: "set_mode",
        mode: "export",
        effectiveWindow: { startAt: decision.startAt, endAt: decision.endAt },
        reason: decision.reason,
      });
    } else if (decision.action === "charge_ev") {
      commands.push({
        commandId: `${planId}-ev-${index}`,
        deviceId: primaryTargetDeviceId,
        issuedAt: generatedAt,
        type: "schedule_window",
        window: { startAt: decision.startAt, endAt: decision.endAt },
        targetMode: "charge",
        effectiveWindow: { startAt: decision.startAt, endAt: decision.endAt },
        reason: decision.reason,
      });
    }
  });

  return commands;
}

function findPrimaryDeviceId(input: OptimizerInput, kind: "battery" | "ev_charger" | "solar_inverter" | "smart_meter"): string | undefined {
  return input.systemState.devices.find(
    (device) =>
      device.kind === kind &&
      (device.connectionStatus === "online" || device.connectionStatus === "degraded"),
  )?.deviceId;
}

function buildDiagnostics(
  input: OptimizerInput,
  decisions: OptimizerDecision[],
  planningInputCoverage: PlanningInputCoverage,
): OptimizerDiagnostic[] {
  const diagnostics: OptimizerDiagnostic[] = [
    {
      code: "MODE_SELECTION",
      message: `Planner mode is '${input.constraints.mode}'.`,
      severity: "info",
    },
    {
      code: "MODE_OBJECTIVE_ACTIVE",
      message: `Planner objective '${input.constraints.mode}' is actively shaping action thresholds.`,
      severity: "info",
    },
    {
      code: "HORIZON_SLOTS",
      message: `Computed ${decisions.length} canonical decision slots for this planning horizon.`,
      severity: "info",
    },
    {
      code: "TARIFF_IMPORT_COVERAGE",
      message: `Import tariff coverage: ${planningInputCoverage.tariffImport.availableSlots}/${planningInputCoverage.tariffImport.totalPlannedSlots} slots (${planningInputCoverage.tariffImport.coveragePercent.toFixed(1)}%).`,
      severity: "info",
    },
    {
      code: "TARIFF_EXPORT_COVERAGE",
      message: `Export tariff coverage: ${planningInputCoverage.tariffExport.availableSlots}/${planningInputCoverage.tariffExport.totalPlannedSlots} slots (${planningInputCoverage.tariffExport.coveragePercent.toFixed(1)}%).`,
      severity: "info",
    },
    {
      code: "FORECAST_LOAD_COVERAGE",
      message: `Load forecast coverage: ${planningInputCoverage.forecastLoad.availableSlots}/${planningInputCoverage.forecastLoad.totalPlannedSlots} slots (${planningInputCoverage.forecastLoad.coveragePercent.toFixed(1)}%).`,
      severity: "info",
    },
    {
      code: "FORECAST_SOLAR_COVERAGE",
      message: `Solar forecast coverage: ${planningInputCoverage.forecastSolar.availableSlots}/${planningInputCoverage.forecastSolar.totalPlannedSlots} slots (${planningInputCoverage.forecastSolar.coveragePercent.toFixed(1)}%).`,
      severity: "info",
    },
  ];

  if (planningInputCoverage.tariffExport.availableSlots === 0) {
    diagnostics.push({
      code: "MISSING_EXPORT_RATES",
      message: "No export rates were supplied; export value uses conservative assumptions.",
      severity: "warning",
    });
  } else if (planningInputCoverage.tariffExport.availableSlots < planningInputCoverage.plannedSlotCount) {
    diagnostics.push({
      code: "PARTIAL_EXPORT_RATE_COVERAGE",
      message: "Export tariff coverage is partial for this planning horizon; missing slots use fallback export assumptions.",
      severity: "warning",
    });
  }

  if (planningInputCoverage.fallbackSlotCount > 0) {
    diagnostics.push({
      code: "FALLBACK_SLOT_DEFAULTS_APPLIED",
      message: `Fallback/default values were used for ${planningInputCoverage.fallbackSlotCount} slots across forecast/tariff inputs.`,
      severity: "warning",
    });
  }

  if (
    input.constraints.allowAutomaticEvCharging &&
    input.systemState.evConnected &&
    decisions.every((decision) => decision.action !== "charge_ev")
  ) {
    diagnostics.push({
      code: "EV_NO_CHARGE_WINDOW",
      message: "No EV charging window was selected from current tariffs and demand forecasts.",
      severity: "warning",
    });
  }

  return diagnostics;
}

/**
 * Canonical runtime planner mapper.
 *
 * Produces canonical runtime planning artifacts without using legacy bridge code.
 */
export function buildCanonicalRuntimeResult(input: OptimizerInput): CanonicalRuntimeResult {
  const generatedAt = resolvePlanningTimestamp(input);
  const slotCount = input.tariffSchedule.importRates.length;
  const planningCoverageCounts = computePlanningCoverageCounts(input, slotCount);
  const planningInputCoverage = buildPlanningInputCoverage(slotCount, planningCoverageCounts);
  const conservatismPolicy = buildConservatismPolicy(planningInputCoverage);
  const horizonStartAt =
    input.tariffSchedule.importRates[0]?.startAt ??
    input.forecasts.horizonStartAt ??
    generatedAt;
  const horizonEndAt =
    input.tariffSchedule.importRates[slotCount - 1]?.endAt ??
    input.forecasts.horizonEndAt ??
    generatedAt;
  const planId = toPlanId(input.systemState.siteId, generatedAt, input.constraints.mode, horizonStartAt, horizonEndAt);
  const slotHours = input.forecasts.slotDurationMinutes / 60;
  const modePolicy = buildModePolicy(input.constraints.mode);
  const batteryDeviceId = findPrimaryDeviceId(input, "battery");
  const evChargerDeviceId = findPrimaryDeviceId(input, "ev_charger");
  const solarDeviceId = findPrimaryDeviceId(input, "solar_inverter");
  const gridDeviceId = findPrimaryDeviceId(input, "smart_meter");

  const hasBattery = Boolean(batteryDeviceId);
  const hasEv =
    input.constraints.allowAutomaticEvCharging &&
    Boolean(input.systemState.evConnected) &&
    Boolean(evChargerDeviceId);

  const importRates = input.tariffSchedule.importRates;
  const exportRates = input.tariffSchedule.exportRates ?? [];
  const marginalStoredValue = buildMarginalStoredEnergyValueProfile({
    importRates,
    exportRates: input.tariffSchedule.exportRates,
    mode: input.constraints.mode,
    roundTripEfficiency: 0.9,
    batteryDegradationCostPencePerKwh: input.constraints.batteryDegradationCostPencePerKwh,
  });
  const forwardEffectiveValue = marginalStoredValue.points.map((_, index) =>
    Math.max(...marginalStoredValue.points.slice(index).map((point) => point.effectiveStoredEnergyValuePencePerKwh), 0),
  );

  const avgImportRate = average(importRates.map((rate) => rate.unitRatePencePerKwh));
  const lowImportThreshold = avgImportRate * modePolicy.lowImportThresholdFactor;
  const highImportThreshold = avgImportRate * modePolicy.highImportThresholdFactor;

  let batterySoc = input.systemState.batterySocPercent ?? 50;
  const batteryCapacityKwh = input.systemState.batteryCapacityKwh ?? 10;
  const batteryReserve = input.constraints.batteryReservePercent ?? 20;
  const evCapacityKwh =
    input.systemState.devices.find((device) => device.kind === "ev_charger")?.capacityKwh ?? 60;
  let evSoc = input.systemState.evSocPercent;

  let expectedImportCostPence = 0;
  let expectedExportRevenuePence = 0;
  let expectedBatteryDegradationCostPence = 0;
  let expectedSolarSelfConsumptionKwh = 0;
  let batteryThroughputKwh = 0;

  const decisions: OptimizerDecision[] = [];

  for (let index = 0; index < slotCount; index += 1) {
    const importRate = importRates[index]?.unitRatePencePerKwh ?? avgImportRate;
    const exportRate = exportRates[index]?.unitRatePencePerKwh ?? importRate * 0.65;
    const loadKwh = input.forecasts.householdLoadKwh[index]?.value ?? 0.5;
    const solarKwh = input.forecasts.solarGenerationKwh[index]?.value ?? 0;
    const carbonConfidence = input.forecasts.carbonIntensity?.[index]?.confidence;
    const startAt = importRates[index]?.startAt ?? input.forecasts.householdLoadKwh[index]?.startAt ?? generatedAt;
    const endAt = importRates[index]?.endAt ?? input.forecasts.householdLoadKwh[index]?.endAt ?? generatedAt;
    const solarSurplusKwh = Math.max(0, solarKwh - loadKwh);

    let action: OptimizerDecision["action"] = "hold";
    let reason = "Holding while monitoring near-term tariffs and demand.";
    let expectedImportKwh = Math.max(0, loadKwh - solarKwh);
    let expectedExportKwh = 0;
    let targetDeviceIds: string[] = [];

    const canChargeBattery =
      hasBattery &&
      input.constraints.allowGridBatteryCharging &&
      batterySoc < 96 &&
      importRate <= lowImportThreshold;

    const canDischargeBattery =
      hasBattery &&
      batterySoc > batteryReserve + 4 &&
      importRate >= highImportThreshold;

    const shouldChargeEv =
      hasEv &&
      evSoc !== undefined &&
      evSoc < (input.constraints.evTargetSocPercent ?? 85) &&
      importRate <= avgImportRate * modePolicy.evChargeThresholdFactor;

    const exportAttractivenessRatio = modePolicy.exportAttractivenessRatio + conservatismPolicy.exportAttractivenessPremiumRatio;
    const exportAttractiveEnough = exportRate >= importRate * exportAttractivenessRatio;
    const valuePoint = marginalStoredValue.points[index];
    const futureRetentionValue = forwardEffectiveValue[index + 1] ?? 0;
    const futureRetentionGrossValue = Math.max(
      ...marginalStoredValue.points.slice(index + 1).map((point) => point.grossStoredEnergyValuePencePerKwh),
      0,
    );
    const batteryDegradationCostPencePerKwh = valuePoint?.batteryDegradationCostPencePerKwh ?? 0;
    const immediateDischargeRealizedValue = Math.max(
      0,
      (valuePoint?.grossStoredEnergyValuePencePerKwh ?? 0) - batteryDegradationCostPencePerKwh,
    );
    const currentImportCostToStore = importRate / marginalStoredValue.assumptions.roundTripEfficiency;

    const chargeValueSpread = futureRetentionValue - currentImportCostToStore;
    const dischargeValueSpread = immediateDischargeRealizedValue - futureRetentionGrossValue;

    const chargeForValue = chargeValueSpread >= conservatismPolicy.minValueSpreadPencePerKwh;
    const dischargeForValue = dischargeValueSpread >= conservatismPolicy.minValueSpreadPencePerKwh;

    if (hasBattery && solarSurplusKwh > 0.05 && input.constraints.allowBatteryExport && exportAttractiveEnough) {
      action = "export_to_grid";
      reason = "Solar surplus and favorable export pricing support grid export.";
      expectedImportKwh = 0;
      expectedExportKwh = solarSurplusKwh;
      targetDeviceIds = [batteryDeviceId, gridDeviceId].filter((deviceId): deviceId is string => Boolean(deviceId));
    } else if (solarKwh >= loadKwh * 0.9) {
      action = "consume_solar";
      reason = "Solar generation can cover most current demand.";
      expectedImportKwh = Math.max(0, loadKwh - solarKwh);
      targetDeviceIds = solarDeviceId ? [solarDeviceId] : [];
    } else if (shouldChargeEv) {
      action = "charge_ev";
      reason = "Charging EV during a lower-cost import window.";
      const evChargeKwh = Math.min(2.0 * slotHours, Math.max(0, ((input.constraints.evTargetSocPercent ?? 85) - (evSoc ?? 0)) / 100 * evCapacityKwh));
      expectedImportKwh = Math.max(0, loadKwh - solarKwh) + evChargeKwh;
      targetDeviceIds = evChargerDeviceId ? [evChargerDeviceId] : [];
      if (evSoc !== undefined && evChargeKwh > 0) {
        evSoc = clamp(evSoc + (evChargeKwh / evCapacityKwh) * 100, 0, 100);
      }
    } else if (
      hasBattery &&
      input.constraints.allowGridBatteryCharging &&
      batterySoc < 96 &&
      (
        chargeForValue ||
        (conservatismPolicy.allowHeuristicCycling && canChargeBattery)
      )
    ) {
      action = "charge_battery";
      reason = chargeForValue
        ? `Charging battery because forward net stored-energy value (${futureRetentionValue.toFixed(2)}p/kWh) exceeds current storage cost (${currentImportCostToStore.toFixed(2)}p/kWh).`
        : "Charging battery while import rates are below the daily average.";
      if (conservatismPolicy.conservativeAdjustmentApplied && !chargeForValue) {
        action = "hold";
        reason = `Holding because planning confidence is ${conservatismPolicy.planningConfidenceLevel} and value spread is not strong enough under conservative thresholds.`;
      }
      const batteryChargeKwh = Math.min(1.6 * slotHours, ((100 - batterySoc) / 100) * batteryCapacityKwh);
      if (action === "charge_battery") {
        expectedImportKwh = Math.max(0, loadKwh - solarKwh) + batteryChargeKwh;
        targetDeviceIds = batteryDeviceId ? [batteryDeviceId] : [];
        batterySoc = clamp(batterySoc + (batteryChargeKwh / batteryCapacityKwh) * 100, 0, 100);
        batteryThroughputKwh += batteryChargeKwh;
      }
    } else if (
      hasBattery &&
      batterySoc > batteryReserve + 4 &&
      (
        dischargeForValue ||
        (conservatismPolicy.allowHeuristicCycling && canDischargeBattery)
      )
    ) {
      action = "discharge_battery";
      reason = dischargeForValue
        ? `Discharging battery because immediate net discharge value (${immediateDischargeRealizedValue.toFixed(2)}p/kWh) exceeds retained future gross value (${futureRetentionGrossValue.toFixed(2)}p/kWh) after wear cost (${batteryDegradationCostPencePerKwh.toFixed(2)}p/kWh).`
        : "Using battery energy to reduce higher-cost import.";
      if (conservatismPolicy.conservativeAdjustmentApplied && !dischargeForValue) {
        action = "hold";
        reason = `Holding because planning confidence is ${conservatismPolicy.planningConfidenceLevel} and discharge value spread is not strong enough under conservative thresholds.`;
      }
      const dischargeKwh = Math.min(1.4 * slotHours, ((batterySoc - batteryReserve) / 100) * batteryCapacityKwh);
      if (action === "discharge_battery") {
        expectedImportKwh = Math.max(0, loadKwh - solarKwh - dischargeKwh);
        targetDeviceIds = batteryDeviceId ? [batteryDeviceId] : [];
        batterySoc = clamp(batterySoc - (dischargeKwh / batteryCapacityKwh) * 100, batteryReserve, 100);
        batteryThroughputKwh += dischargeKwh;
        expectedBatteryDegradationCostPence += dischargeKwh * batteryDegradationCostPencePerKwh;
      }
    }

    if (
      action === "export_to_grid" &&
      conservatismPolicy.conservativeAdjustmentApplied &&
      planningInputCoverage.tariffExport.availableSlots < slotCount
    ) {
      action = "consume_solar";
      reason = `Holding export aggressiveness because planning confidence is ${conservatismPolicy.planningConfidenceLevel} with partial export tariff coverage.`;
      expectedExportKwh = 0;
      targetDeviceIds = solarDeviceId ? [solarDeviceId] : [];
      expectedImportKwh = Math.max(0, loadKwh - solarKwh);
    }

    if (
      conservatismPolicy.conservativeAdjustmentApplied &&
      (action === "hold" || action === "consume_solar") &&
      conservatismPolicy.conservativeAdjustmentReason &&
      !reason.includes("Conservative adjustment active")
    ) {
      reason = `${reason} Conservative adjustment active: ${conservatismPolicy.conservativeAdjustmentReason}`;
    }

    expectedImportCostPence += expectedImportKwh * importRate;
    expectedExportRevenuePence += expectedExportKwh * exportRate;
    expectedSolarSelfConsumptionKwh += Math.min(loadKwh, solarKwh);

    const confidence = Number(
      clamp(
        average([
          input.forecasts.householdLoadKwh[index]?.confidence ?? 0.74,
          input.forecasts.solarGenerationKwh[index]?.confidence ?? 0.72,
          carbonConfidence ?? 0.7,
        ]),
        0.5,
        0.95,
      ).toFixed(2),
    );

    decisions.push({
      decisionId: `${planId}-slot-${index}`,
      startAt,
      endAt,
      executionWindow: { startAt, endAt },
      action,
      targetDeviceIds,
      targetDevices: mapDecisionTargets(targetDeviceIds, action, input),
      expectedImportKwh: Number(expectedImportKwh.toFixed(3)),
      expectedExportKwh: expectedExportKwh > 0 ? Number(expectedExportKwh.toFixed(3)) : undefined,
      // TODO: replace heuristic SOC projection with explicit canonical battery state model.
      expectedBatterySocPercent: hasBattery ? Number(batterySoc.toFixed(1)) : undefined,
      // TODO: replace heuristic EV projection with deadline-aware canonical EV model.
      expectedEvSocPercent: evSoc !== undefined ? Number(evSoc.toFixed(1)) : undefined,
      reason,
      marginalImportAvoidancePencePerKwh: valuePoint?.importAvoidancePencePerKwh,
      marginalExportValuePencePerKwh: valuePoint?.exportOpportunityPencePerKwh,
      grossStoredEnergyValuePencePerKwh: valuePoint?.grossStoredEnergyValuePencePerKwh,
      netStoredEnergyValuePencePerKwh: valuePoint?.netStoredEnergyValuePencePerKwh,
      batteryDegradationCostPencePerKwh: valuePoint?.batteryDegradationCostPencePerKwh,
      effectiveStoredEnergyValuePencePerKwh: valuePoint?.effectiveStoredEnergyValuePencePerKwh,
      planningConfidenceLevel: conservatismPolicy.planningConfidenceLevel,
      conservativeAdjustmentApplied: conservatismPolicy.conservativeAdjustmentApplied,
      conservativeAdjustmentReason: conservatismPolicy.conservativeAdjustmentReason,
      confidence,
    });
  }

  const diagnostics = buildDiagnostics(input, decisions, planningInputCoverage);
  const warningCodes = diagnostics
    .filter((diagnostic) => diagnostic.severity === "warning")
    .map((diagnostic) => diagnostic.code);
  const headline = buildHeadline(decisions);
  const confidence = Number(
    clamp(
      average(decisions.map((decision) => decision.confidence)),
      0.5,
      0.95,
    ).toFixed(2),
  );

  const planningWindow = decisions.length
    ? {
      startAt: decisions[0].startAt,
      endAt: decisions[decisions.length - 1].endAt,
    }
    : undefined;

  const assumptions: string[] = [
    "Tariff rates are treated as fixed for the planned horizon.",
    "Forecast confidence is aggregated into heuristic per-slot confidence scores.",
    "Optimization mode adjusts economic action thresholds in the canonical runtime planner.",
    "Stored-energy marginal value uses a canonical round-trip efficiency assumption of 90%.",
  ];

  if (!input.tariffSchedule.exportRates?.length) {
    assumptions.push("Export pricing uses a conservative fallback ratio when export slots are unavailable.");
  }

  if (planningInputCoverage.tariffExport.availableSlots > 0 && planningInputCoverage.tariffExport.availableSlots < slotCount) {
    assumptions.push("Export pricing is partially fallback-derived where export tariff slots are missing.");
  }

  if (planningInputCoverage.fallbackSlotCount > 0) {
    assumptions.push("One or more planned slots used canonical default/fallback load, solar, or export-rate inputs.");
  }

  if (conservatismPolicy.conservativeAdjustmentApplied && conservatismPolicy.conservativeAdjustmentReason) {
    assumptions.push(`Conservative planning adjustment applied: ${conservatismPolicy.conservativeAdjustmentReason}`);
  }

  if (marginalStoredValue.assumptions.degradationCostFallbackApplied) {
    assumptions.push("Battery degradation cost uses a canonical fallback of 2.0p/kWh when not configured.");
  }

  const feasibility = {
    executable: decisions.length > 0,
    reasonCodes: decisions.length > 0 ? ["PLAN_COMPUTED"] : ["NO_DECISIONS"],
    blockingCodes: decisions.length > 0 ? undefined : ["NO_DECISION_SLOTS"],
  };

  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId,
    generatedAt,
    planningWindow,
    assumptions,
    warnings: warningCodes,
    feasibility,
    headline,
    decisions,
    recommendedCommands: buildCommands(decisions, generatedAt, planId),
    summary: {
      expectedImportCostPence: Math.round(expectedImportCostPence),
      expectedExportRevenuePence: Math.round(expectedExportRevenuePence),
      expectedBatteryDegradationCostPence: Math.round(expectedBatteryDegradationCostPence),
      expectedNetValuePence: Math.round(
        expectedExportRevenuePence - expectedImportCostPence - expectedBatteryDegradationCostPence,
      ),
      expectedSolarSelfConsumptionKwh: Number(expectedSolarSelfConsumptionKwh.toFixed(2)),
      expectedBatteryCycles: batteryCapacityKwh > 0
        ? Number((batteryThroughputKwh / (2 * batteryCapacityKwh)).toFixed(2))
        : undefined,
    },
    diagnostics,
    planningInputCoverage,
    planningConfidenceLevel: conservatismPolicy.planningConfidenceLevel,
    conservativeAdjustmentApplied: conservatismPolicy.conservativeAdjustmentApplied,
    conservativeAdjustmentReason: conservatismPolicy.conservativeAdjustmentReason,
    confidence,
  };
}
