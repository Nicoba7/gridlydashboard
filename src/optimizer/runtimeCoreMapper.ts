import type {
  DeviceCapability,
  DeviceCommand,
  PlanningConfidenceLevel,
  PlanningStyle,
  PlanningInputCoverage,
  OptimizerDecision,
  OptimizerDecisionTarget,
  OptimizerDiagnostic,
  OptimizerInput,
  OptimizerOpportunity,
  OptimizationMode,
  OptimizerSummary,
  TimeWindow,
} from "../domain";
import { formatPlanningStyleLabel, getPlanningStylePolicyProfile } from "../domain";
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
  opportunities: OptimizerOpportunity[];
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

function resolvePlanningStyle(mode: OptimizationMode, planningStyle: PlanningStyle | undefined): PlanningStyle {
  if (planningStyle) {
    return planningStyle;
  }

  if (mode === "cost") {
    return "cheapest";
  }

  if (mode === "carbon" || mode === "self_consumption") {
    return "greenest";
  }

  return "balanced";
}

function clampWeight(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return clamp(value, 0.25, 2);
}

function hoursUntilNextReadyBy(startAt: string, readyBy: string | undefined): number | undefined {
  if (!readyBy) {
    return undefined;
  }

  const [hours, minutes] = readyBy.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return undefined;
  }

  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) {
    return undefined;
  }

  const ready = new Date(start);
  ready.setUTCHours(hours, minutes, 0, 0);
  if (ready.getTime() <= start.getTime()) {
    ready.setUTCDate(ready.getUTCDate() + 1);
  }

  return (ready.getTime() - start.getTime()) / (60 * 60 * 1000);
}

function buildEvUrgencyFactor(params: {
  startAt: string;
  evReadyBy?: string;
  evChargeUrgencyWeight?: number;
  evDeadlineUrgencyHours?: number;
}): number {
  const baseWeight = clampWeight(params.evChargeUrgencyWeight, 1);
  const urgencyWindowHours = Math.max(1, params.evDeadlineUrgencyHours ?? 3);
  const hoursUntilReadyBy = hoursUntilNextReadyBy(params.startAt, params.evReadyBy);

  if (hoursUntilReadyBy === undefined || hoursUntilReadyBy > urgencyWindowHours) {
    return Number(baseWeight.toFixed(3));
  }

  const pressure = (urgencyWindowHours - hoursUntilReadyBy) / urgencyWindowHours;
  return Number((baseWeight * (1 + pressure * 0.35)).toFixed(3));
}

function requiredCapabilitiesForTarget(
  action: OptimizerDecision["action"],
  kind: OptimizerDecisionTarget["kind"],
): DeviceCapability[] {
  if (action === "charge_ev") {
    return kind === "ev_charger" ? ["schedule_window"] : [];
  }

  if (action === "charge_battery" || action === "discharge_battery") {
    return kind === "battery" ? ["set_mode"] : [];
  }

  if (action === "export_to_grid") {
    return kind === "battery" || kind === "solar_inverter" ? ["set_mode"] : [];
  }

  return [];
}

function mapDecisionTargets(
  targetDeviceIds: string[],
  action: OptimizerDecision["action"],
  input: OptimizerInput,
): OptimizerDecisionTarget[] {
  return targetDeviceIds.map((deviceId) => {
    const matchedDevice = input.systemState.devices.find(
      (device) => device.deviceId === deviceId,
    );

    const requiredCapabilities = requiredCapabilitiesForTarget(action, matchedDevice?.kind);

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
    return "Aveum is holding steady while it waits for a stronger opportunity.";
  }

  if (firstAction.action === "charge_ev") {
    return "Aveum is charging your EV in a lower-cost window.";
  }

  if (firstAction.action === "charge_battery") {
    return "Aveum is charging your battery while rates are favorable.";
  }

  if (firstAction.action === "export_to_grid") {
    return "Aveum is exporting energy while export value is strong.";
  }

  if (firstAction.action === "discharge_battery") {
    return "Aveum is using battery energy to reduce high-cost import.";
  }

  return "Aveum is matching live demand with available solar generation.";
}

function resolveDispatchTargetDeviceIds(
  decision: OptimizerDecision,
  input: OptimizerInput,
): string[] {
  const deviceById = new Map(input.systemState.devices.map((device) => [device.deviceId, device]));

  return Array.from(new Set(decision.targetDeviceIds)).filter((deviceId) => {
    const device = deviceById.get(deviceId);
    const kind = device?.kind;

    if (decision.action === "charge_battery" || decision.action === "discharge_battery") {
      return kind === "battery" && Boolean(device?.capabilities.includes("set_mode"));
    }

    if (decision.action === "charge_ev") {
      return kind === "ev_charger" && Boolean(device?.capabilities.includes("schedule_window"));
    }

    if (decision.action === "export_to_grid") {
      return (kind === "battery" || kind === "solar_inverter") && Boolean(device?.capabilities.includes("set_mode"));
    }

    return false;
  });
}

function buildCommands(
  decisions: OptimizerDecision[],
  generatedAt: string,
  planId: string,
  input: OptimizerInput,
): { commands: DeviceCommand[]; opportunities: OptimizerOpportunity[] } {
  const commands: DeviceCommand[] = [];
  const opportunities: OptimizerOpportunity[] = [];

  function pushOpportunity(
    decision: OptimizerDecision,
    targetDeviceId: string,
    command: DeviceCommand,
    targetIndex: number,
  ): void {
    const matchedTarget = decision.targetDevices?.find((target) => target.deviceId === targetDeviceId);

    opportunities.push({
      opportunityId: `${decision.decisionId}:${targetDeviceId}:${command.type}:${targetIndex}`,
      decisionId: decision.decisionId,
      action: decision.action,
      targetDeviceId,
      targetKind: matchedTarget?.kind,
      requiredCapabilities: matchedTarget?.requiredCapabilities,
      command,
      economicSignals: {
        effectiveStoredEnergyValuePencePerKwh: decision.effectiveStoredEnergyValuePencePerKwh,
        netStoredEnergyValuePencePerKwh: decision.netStoredEnergyValuePencePerKwh,
        marginalImportAvoidancePencePerKwh: decision.marginalImportAvoidancePencePerKwh,
        exportValuePencePerKwh: decision.marginalExportValuePencePerKwh,
      },
      planningConfidenceLevel: decision.planningConfidenceLevel,
      conservativeAdjustmentApplied: decision.conservativeAdjustmentApplied,
      conservativeAdjustmentReason: decision.conservativeAdjustmentReason,
      decisionReason: decision.reason,
    });
  }

  decisions.forEach((decision, index) => {
    const dispatchTargets = resolveDispatchTargetDeviceIds(decision, input);
    if (!dispatchTargets.length) {
      return;
    }

    dispatchTargets.forEach((targetDeviceId, targetIndex) => {
      if (decision.action === "charge_battery") {
        const command: DeviceCommand = {
          commandId: `${planId}-battery-${index}-${targetIndex}`,
          deviceId: targetDeviceId,
          issuedAt: generatedAt,
          type: "set_mode",
          mode: "charge",
          effectiveWindow: { startAt: decision.startAt, endAt: decision.endAt },
          reason: decision.reason,
        };
        commands.push(command);
        pushOpportunity(decision, targetDeviceId, command, targetIndex);
      } else if (decision.action === "discharge_battery") {
        const command: DeviceCommand = {
          commandId: `${planId}-discharge-${index}-${targetIndex}`,
          deviceId: targetDeviceId,
          issuedAt: generatedAt,
          type: "set_mode",
          mode: "discharge",
          effectiveWindow: { startAt: decision.startAt, endAt: decision.endAt },
          reason: decision.reason,
        };
        commands.push(command);
        pushOpportunity(decision, targetDeviceId, command, targetIndex);
      } else if (decision.action === "export_to_grid") {
        const command: DeviceCommand = {
          commandId: `${planId}-export-${index}-${targetIndex}`,
          deviceId: targetDeviceId,
          issuedAt: generatedAt,
          type: "set_mode",
          mode: "export",
          effectiveWindow: { startAt: decision.startAt, endAt: decision.endAt },
          reason: decision.reason,
        };
        commands.push(command);
        pushOpportunity(decision, targetDeviceId, command, targetIndex);
      } else if (decision.action === "charge_ev") {
        const command: DeviceCommand = {
          commandId: `${planId}-ev-${index}-${targetIndex}`,
          deviceId: targetDeviceId,
          issuedAt: generatedAt,
          type: "schedule_window",
          window: { startAt: decision.startAt, endAt: decision.endAt },
          targetMode: "charge",
          effectiveWindow: { startAt: decision.startAt, endAt: decision.endAt },
          reason: decision.reason,
        };
        commands.push(command);
        pushOpportunity(decision, targetDeviceId, command, targetIndex);
      }
    });
  });

  return { commands, opportunities };
}

function findDeviceIdsByKind(
  input: OptimizerInput,
  kind: "battery" | "ev_charger" | "solar_inverter" | "smart_meter",
): string[] {
  return input.systemState.devices
    .filter(
      (device) =>
        device.kind === kind &&
        (device.connectionStatus === "online" || device.connectionStatus === "degraded"),
    )
    .map((device) => device.deviceId);
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
  const activePlanningStyle = resolvePlanningStyle(input.constraints.mode, input.constraints.planningStyle);
  const activePlanningStyleLabel = formatPlanningStyleLabel(activePlanningStyle);
  const balancedPlanningStyleProfile = getPlanningStylePolicyProfile("balanced");
  const batteryDeviceIds = findDeviceIdsByKind(input, "battery");
  const evChargerDeviceIds = findDeviceIdsByKind(input, "ev_charger");
  const solarDeviceIds = findDeviceIdsByKind(input, "solar_inverter");
  const gridDeviceIds = findDeviceIdsByKind(input, "smart_meter");

  const hasBattery = batteryDeviceIds.length > 0;
  const hasEv =
    input.constraints.allowAutomaticEvCharging &&
    Boolean(input.systemState.evConnected) &&
    evChargerDeviceIds.length > 0;

  const importRates = input.tariffSchedule.importRates;
  const exportRates = input.tariffSchedule.exportRates ?? [];
  const marginalStoredValue = buildMarginalStoredEnergyValueProfile({
    importRates,
    exportRates: input.tariffSchedule.exportRates,
    mode: input.constraints.mode,
    roundTripEfficiency: 0.9,
    batteryDegradationCostPencePerKwh: input.constraints.batteryDegradationCostPencePerKwh,
    importAvoidanceWeight: input.constraints.importAvoidanceWeight,
    exportPreferenceWeight: input.constraints.exportPreferenceWeight,
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
  let batteryChargeWindowsPlanned = 0;
  let chargingBatteryInPreviousSlot = false;

  const decisions: OptimizerDecision[] = [];

  // ── Pass 1: Pre-allocate battery charge/discharge slots by global price ranking ─────────────
  //
  // Ranks all import slots by price across the full planning horizon and greedily allocates:
  //   - cheapest slots → charge_battery (until battery is full or cycle limit reached)
  //   - most expensive slots → discharge_battery (until energy budget exhausted)
  //   - negative-price slots → always charge battery + EV at full rated power
  //
  // Pass 2 (the main loop below) executes the pre-allocated plan chronologically, tracking SoC.
  const negativePriceSlots = new Set<number>();
  const preallocChargeSlots = new Set<number>();
  const preallocDischargeSlots = new Set<number>();

  {
    const batteryRatedChargeKwhPerSlot = 5 * slotHours;
    const batteryRatedDischargeKwhPerSlot = 5 * slotHours;
    const batteryInitialKwh = (batterySoc / 100) * batteryCapacityKwh;
    const batteryMaxKwh = 0.96 * batteryCapacityKwh;
    const batteryMinKwh = (batteryReserve / 100) * batteryCapacityKwh;

    for (let i = 0; i < slotCount; i++) {
      if ((importRates[i]?.unitRatePencePerKwh ?? avgImportRate) < 0) {
        negativePriceSlots.add(i);
      }
    }

    if (hasBattery) {
      const nonNegativeSlots = importRates
        .map((rate, i) => ({ index: i, rate: rate?.unitRatePencePerKwh ?? avgImportRate }))
        .filter((s) => !negativePriceSlots.has(s.index));

      // Allocate charging to cheapest slots, respecting cycle limit
      if (input.constraints.allowGridBatteryCharging) {
        const maxCycles = input.constraints.maxBatteryCyclesPerDay ?? 999;
        const chargeCandidates = [...nonNegativeSlots].sort((a, b) => a.rate - b.rate);
        let chargeRemainingKwh = Math.max(0, batteryMaxKwh - batteryInitialKwh);

        for (const s of chargeCandidates) {
          if (chargeRemainingKwh <= 0.01) break;
          preallocChargeSlots.add(s.index);
          chargeRemainingKwh -= Math.min(batteryRatedChargeKwhPerSlot, chargeRemainingKwh);
        }

        // Trim to maxCycles contiguous windows (iterate chronologically)
        const chronoCharge = [...preallocChargeSlots].sort((a, b) => a - b);
        const trimmed = new Set<number>();
        let windows = 0;
        let prev = -2;
        for (const idx of chronoCharge) {
          if (idx !== prev + 1) windows++;
          if (windows > maxCycles) break;
          trimmed.add(idx);
          prev = idx;
        }
        preallocChargeSlots.clear();
        for (const idx of trimmed) preallocChargeSlots.add(idx);
      }

      // Allocate discharging to most expensive slots
      // Budget = initial energy + planned charges - reserve floor
      const plannedChargeKwh = preallocChargeSlots.size * batteryRatedChargeKwhPerSlot;
      const dischargeAvailableKwh = Math.max(
        0,
        Math.min(batteryInitialKwh + plannedChargeKwh - batteryMinKwh, batteryMaxKwh - batteryMinKwh),
      );

      if (dischargeAvailableKwh > 0.01) {
        // Only discharge when rate exceeds the effective cost of stored energy
        const cheapestChargeRate = preallocChargeSlots.size > 0
          ? Math.min(...[...preallocChargeSlots].map((i) => importRates[i]?.unitRatePencePerKwh ?? avgImportRate))
          : avgImportRate;
        const minProfitableDischargeRate = cheapestChargeRate / 0.9;

        const dischargeCandidates = [...nonNegativeSlots]
          .filter((s) => !preallocChargeSlots.has(s.index))
          .sort((a, b) => b.rate - a.rate);

        let dischargeRemainingKwh = dischargeAvailableKwh;
        for (const s of dischargeCandidates) {
          if (dischargeRemainingKwh <= 0.01) break;
          if (s.rate < minProfitableDischargeRate) break;
          preallocDischargeSlots.add(s.index);
          dischargeRemainingKwh -= Math.min(batteryRatedDischargeKwhPerSlot, dischargeRemainingKwh);
        }
      }
    }
  }

  // ── Pass 2: Build decision timeline chronologically using pre-allocated plan ──────────────
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

    const isNegativePrice = negativePriceSlots.has(index);
    const isPreallocCharge = preallocChargeSlots.has(index) && !conservatismPolicy.conservativeAdjustmentApplied;
    const isPreallocDischarge = preallocDischargeSlots.has(index) && !conservatismPolicy.conservativeAdjustmentApplied;

    const canChargeBattery =
      hasBattery &&
      input.constraints.allowGridBatteryCharging &&
      batterySoc < 96 &&
      (isPreallocCharge || (conservatismPolicy.allowHeuristicCycling && importRate <= lowImportThreshold));

    const canDischargeBattery =
      hasBattery &&
      batterySoc > batteryReserve + 4 &&
      (isPreallocDischarge || (conservatismPolicy.allowHeuristicCycling && importRate >= highImportThreshold));

    const evUrgencyFactor = buildEvUrgencyFactor({
      startAt,
      evReadyBy: input.constraints.evReadyBy,
      evChargeUrgencyWeight: input.constraints.evChargeUrgencyWeight,
      evDeadlineUrgencyHours: input.constraints.evDeadlineUrgencyHours,
    });
    const balancedModePolicy = buildModePolicy(balancedPlanningStyleProfile.optimizationMode);
    const balancedEvUrgencyFactor = buildEvUrgencyFactor({
      startAt,
      evReadyBy: input.constraints.evReadyBy,
      evChargeUrgencyWeight: balancedPlanningStyleProfile.runtimeInputs.evChargeUrgencyWeight,
      evDeadlineUrgencyHours: balancedPlanningStyleProfile.runtimeInputs.evDeadlineUrgencyHours,
    });
    const currentEvThreshold = avgImportRate * modePolicy.evChargeThresholdFactor * evUrgencyFactor;
    const balancedEvThreshold = avgImportRate * balancedModePolicy.evChargeThresholdFactor * balancedEvUrgencyFactor;

    const shouldChargeEv =
      hasEv &&
      evSoc !== undefined &&
      evSoc < (input.constraints.evTargetSocPercent ?? 85) &&
      importRate <= currentEvThreshold;

    const exportAttractivenessRatio = modePolicy.exportAttractivenessRatio + conservatismPolicy.exportAttractivenessPremiumRatio;
    const valuePoint = marginalStoredValue.points[index];
    const selfConsumptionPreferenceWeight = clampWeight(input.constraints.selfConsumptionPreferenceWeight, 1);
    const exportPreferenceWeight = clampWeight(input.constraints.exportPreferenceWeight, 1);
    const weightedExportValue = exportRate * exportPreferenceWeight;
    const weightedSelfConsumptionValue = (valuePoint?.importAvoidancePencePerKwh ?? importRate) * selfConsumptionPreferenceWeight;
    const exportAttractiveEnough = weightedExportValue >= weightedSelfConsumptionValue * exportAttractivenessRatio;
    const balancedExportAttractivenessRatio = balancedModePolicy.exportAttractivenessRatio + conservatismPolicy.exportAttractivenessPremiumRatio;
    const balancedExportAttractiveEnough =
      exportRate * balancedPlanningStyleProfile.runtimeInputs.exportPreferenceWeight >=
      (valuePoint?.importAvoidancePencePerKwh ?? importRate)
        * balancedPlanningStyleProfile.runtimeInputs.selfConsumptionPreferenceWeight
        * balancedExportAttractivenessRatio;
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

    const chargeForValue = isPreallocCharge || chargeValueSpread >= conservatismPolicy.minValueSpreadPencePerKwh;
    const dischargeForValue = isPreallocDischarge || dischargeValueSpread >= conservatismPolicy.minValueSpreadPencePerKwh;
    const styleSuppressesExport =
      activePlanningStyle !== "balanced" &&
      solarSurplusKwh > 0.05 &&
      balancedExportAttractiveEnough &&
      !exportAttractiveEnough;
    const stylePullsForwardEvCharge =
      activePlanningStyle !== "balanced" &&
      importRate <= currentEvThreshold &&
      importRate > balancedEvThreshold;
    // Pre-alloc slots already respect maxBatteryCyclesPerDay via trimming in Pass 1
    const canStartBatteryChargeWindow =
      isPreallocCharge ||
      chargingBatteryInPreviousSlot ||
      batteryChargeWindowsPlanned < (input.constraints.maxBatteryCyclesPerDay ?? Number.MAX_SAFE_INTEGER);
    const styleCycleLimitBlocksCharging =
      activePlanningStyle !== "balanced" &&
      !chargingBatteryInPreviousSlot &&
      batteryChargeWindowsPlanned >= (input.constraints.maxBatteryCyclesPerDay ?? Number.MAX_SAFE_INTEGER) &&
      batteryChargeWindowsPlanned < balancedPlanningStyleProfile.runtimeInputs.maxBatteryCyclesPerDay;

    // Negative-price slot: charge battery and EV simultaneously at full rated power
    if (isNegativePrice && hasBattery && batterySoc < 96) {
      const batteryChargeKwh = Math.min(5 * slotHours, ((96 - batterySoc) / 100) * batteryCapacityKwh);
      if (!chargingBatteryInPreviousSlot) batteryChargeWindowsPlanned += 1;
      batterySoc = clamp(batterySoc + (batteryChargeKwh / batteryCapacityKwh) * 100, 0, 100);
      batteryThroughputKwh += batteryChargeKwh;
      action = "charge_battery";
      reason = `Negative import rate (${importRate.toFixed(2)}p/kWh) — charging battery and EV at full rated power.`;
      expectedImportKwh = Math.max(0, loadKwh - solarKwh) + batteryChargeKwh;
      targetDeviceIds = [...batteryDeviceIds];
      if (hasEv && evSoc !== undefined && evSoc < (input.constraints.evTargetSocPercent ?? 85)) {
        const evChargeKwh = Math.min(2.0 * slotHours, Math.max(0, ((input.constraints.evTargetSocPercent ?? 85) - evSoc) / 100 * evCapacityKwh));
        if (evChargeKwh > 0) {
          expectedImportKwh += evChargeKwh;
          targetDeviceIds = [...batteryDeviceIds, ...evChargerDeviceIds];
          evSoc = clamp(evSoc + (evChargeKwh / evCapacityKwh) * 100, 0, 100);
        }
      }
    } else if (hasBattery && solarSurplusKwh > 0.05 && input.constraints.allowBatteryExport && exportAttractiveEnough) {
      action = "export_to_grid";
      reason = "Solar surplus and favorable export pricing support grid export.";
      expectedImportKwh = 0;
      expectedExportKwh = solarSurplusKwh;
      targetDeviceIds = [...batteryDeviceIds, ...solarDeviceIds, ...gridDeviceIds];
    } else if (solarKwh >= loadKwh * 0.9) {
      action = "consume_solar";
      reason = styleSuppressesExport
        ? `${activePlanningStyleLabel} keeps solar on site because self-consumption is currently preferred to export.`
        : "Solar generation can cover most current demand.";
      expectedImportKwh = Math.max(0, loadKwh - solarKwh);
      targetDeviceIds = [...solarDeviceIds];
    } else if (shouldChargeEv) {
      action = "charge_ev";
      reason = stylePullsForwardEvCharge
        ? `${activePlanningStyleLabel} brings EV charging forward because the ready-by deadline is close.`
        : "Charging EV during a lower-cost import window.";
      const evChargeKwh = Math.min(2.0 * slotHours, Math.max(0, ((input.constraints.evTargetSocPercent ?? 85) - (evSoc ?? 0)) / 100 * evCapacityKwh));
      expectedImportKwh = Math.max(0, loadKwh - solarKwh) + evChargeKwh;
      targetDeviceIds = [...evChargerDeviceIds];
      if (evSoc !== undefined && evChargeKwh > 0) {
        evSoc = clamp(evSoc + (evChargeKwh / evCapacityKwh) * 100, 0, 100);
      }
    } else if (
      hasBattery &&
      input.constraints.allowGridBatteryCharging &&
      batterySoc < 96 &&
      canStartBatteryChargeWindow &&
      (chargeForValue || (conservatismPolicy.allowHeuristicCycling && canChargeBattery))
    ) {
      action = "charge_battery";
      reason = isPreallocCharge
        ? `Pre-allocated charge slot — one of the cheapest import windows today (${importRate.toFixed(2)}p/kWh).`
        : chargeForValue
          ? `Charging battery because forward net stored-energy value (${futureRetentionValue.toFixed(2)}p/kWh) exceeds current storage cost (${currentImportCostToStore.toFixed(2)}p/kWh).`
          : "Charging battery while import rates are below the daily average.";
      if (conservatismPolicy.conservativeAdjustmentApplied && !isPreallocCharge && !chargeForValue) {
        action = "hold";
        reason = `Holding because planning confidence is ${conservatismPolicy.planningConfidenceLevel} and value spread is not strong enough under conservative thresholds.`;
      }
      const batteryChargeKwh = Math.min(5 * slotHours, ((100 - batterySoc) / 100) * batteryCapacityKwh);
      if (action === "charge_battery") {
        if (!chargingBatteryInPreviousSlot) batteryChargeWindowsPlanned += 1;
        expectedImportKwh = Math.max(0, loadKwh - solarKwh) + batteryChargeKwh;
        targetDeviceIds = [...batteryDeviceIds];
        batterySoc = clamp(batterySoc + (batteryChargeKwh / batteryCapacityKwh) * 100, 0, 100);
        batteryThroughputKwh += batteryChargeKwh;
      }
    } else if (
      hasBattery &&
      batterySoc > batteryReserve + 4 &&
      (dischargeForValue || (conservatismPolicy.allowHeuristicCycling && canDischargeBattery))
    ) {
      action = "discharge_battery";
      reason = isPreallocDischarge
        ? `Pre-allocated discharge slot — one of the most expensive import windows today (${importRate.toFixed(2)}p/kWh).`
        : dischargeForValue
          ? `Discharging battery because immediate net discharge value (${immediateDischargeRealizedValue.toFixed(2)}p/kWh) exceeds retained future gross value (${futureRetentionGrossValue.toFixed(2)}p/kWh) after wear cost (${batteryDegradationCostPencePerKwh.toFixed(2)}p/kWh).`
          : "Using battery energy to reduce higher-cost import.";
      if (conservatismPolicy.conservativeAdjustmentApplied && !isPreallocDischarge && !dischargeForValue) {
        action = "hold";
        reason = `Holding because planning confidence is ${conservatismPolicy.planningConfidenceLevel} and discharge value spread is not strong enough under conservative thresholds.`;
      }
      // Use load-matching for SoC tracking so the engine's simulated depletion matches
      // what the adapter will actually discharge (load-matched, not rated-power maximum).
      const netLoadForDischarge = Math.max(0, loadKwh - solarKwh);
      const dischargeKwh = Math.min(5 * slotHours, netLoadForDischarge, ((batterySoc - batteryReserve) / 100) * batteryCapacityKwh);
      if (action === "discharge_battery") {
        expectedImportKwh = Math.max(0, loadKwh - solarKwh - dischargeKwh);
        targetDeviceIds = [...batteryDeviceIds];
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
      targetDeviceIds = [...solarDeviceIds];
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

    const balancedReserve = balancedPlanningStyleProfile.runtimeInputs.batteryReservePercent;
    const styleReserveBlocksDischarge =
      activePlanningStyle !== "balanced" &&
      hasBattery &&
      batterySoc > balancedReserve + 4 &&
      batterySoc <= batteryReserve + 4 &&
      importRate >= highImportThreshold;

    if (action === "hold" && styleCycleLimitBlocksCharging) {
      reason = `${activePlanningStyleLabel} limits battery charging to ${input.constraints.maxBatteryCyclesPerDay} window${input.constraints.maxBatteryCyclesPerDay === 1 ? "" : "s"} per day.`;
    } else if (action === "hold" && styleReserveBlocksDischarge) {
      reason = `${activePlanningStyleLabel} keeps a higher battery reserve floor at ${batteryReserve}% before discharging.`;
    }

    expectedImportCostPence += expectedImportKwh * importRate;
    expectedExportRevenuePence += expectedExportKwh * exportRate;
    expectedSolarSelfConsumptionKwh += Math.min(loadKwh, solarKwh);
    chargingBatteryInPreviousSlot = action === "charge_battery";

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
      expectedBatterySocPercent: hasBattery ? Number(batterySoc.toFixed(1)) : undefined,
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
    "Planning style adjusts reserve floor, cycling limit, value weighting, and EV urgency thresholds.",
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

  const executionArtifacts = buildCommands(decisions, generatedAt, planId, input);

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
    recommendedCommands: executionArtifacts.commands,
    opportunities: executionArtifacts.opportunities,
    summary: {
      expectedImportCostPence: Math.round(expectedImportCostPence),
      expectedExportRevenuePence: Math.round(expectedExportRevenuePence),
      expectedBatteryDegradationCostPence: Math.round(expectedBatteryDegradationCostPence),
      // Planning telemetry: revenue-positive surplus (export - import - degradation).
      // Opposite sign from CanonicalValueLedger.estimatedNetCostPence (cost-positive).
      // Do not use as accounting truth — use CanonicalValueLedger for customer-facing values.
      planningNetRevenueSurplusPence: Math.round(
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
