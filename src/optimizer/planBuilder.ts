import type {
  DeviceCommand,
  ForecastPoint,
  OptimizerDecision,
  OptimizerDiagnostic,
  OptimizerInput,
  OptimizerSummary,
  TariffRate,
} from "../domain";
import { optimizePlan as runLegacyHeuristic } from "../engine/core/optimizePlan";
import type { GridlyOutput as LegacyHeuristicOutput } from "../engine/types";
import {
  buildGridlyPlan,
  type ConnectedDeviceId,
  type GridlyPlanSummary,
  type GridlyPlanSession,
  type OptimisationMode,
  type PlanSlot,
  type PlanSummary,
  type PlanWithSessions,
} from "../lib/gridlyPlan";

export interface CanonicalPlanBuildResult {
  planId: string;
  generatedAt: string;
  headline: string;
  decisions: OptimizerDecision[];
  recommendedCommands: DeviceCommand[];
  summary: OptimizerSummary;
  diagnostics: OptimizerDiagnostic[];
  confidence: number;
  legacyPlan: PlanWithSessions;
  legacySummary: PlanSummary;
  legacyGridlySummary: GridlyPlanSummary;
  legacyHeuristic?: LegacyHeuristicOutput;
}

interface PlannerBridgeContext {
  mode: OptimisationMode;
  planId: string;
  generatedAt: string;
  connectedDeviceIds: ConnectedDeviceId[];
  importRatesByTime: Map<string, TariffRate>;
  exportRatesByTime: Map<string, TariffRate>;
  unmetConstraints: string[];
  assumptions: string[];
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

function toPlanId(siteId: string, generatedAt: string): string {
  const compact = generatedAt.replace(/[-:.TZ]/g, "");
  return `${siteId}-${compact}`;
}

function toLegacyMode(mode: OptimizerInput["constraints"]["mode"]): OptimisationMode {
  if (mode === "cost") return "CHEAPEST";
  if (mode === "carbon" || mode === "self_consumption") return "GREENEST";
  return "BALANCED";
}

function toHHMM(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildRateLookup(rates: TariffRate[]): Map<string, TariffRate> {
  const lookup = new Map<string, TariffRate>();
  for (const rate of rates) {
    lookup.set(toHHMM(rate.startAt), rate);
  }
  return lookup;
}

function sumForecastValues(points: ForecastPoint[]): number {
  return points.reduce((sum, point) => sum + point.value, 0);
}

function extractConnectedDeviceIds(input: OptimizerInput): {
  connectedDeviceIds: ConnectedDeviceId[];
  unmetConstraints: string[];
} {
  const unmetConstraints: string[] = [];
  const deviceIds = new Set<ConnectedDeviceId>();

  for (const device of input.systemState.devices) {
    if (device.connectionStatus !== "online" && device.connectionStatus !== "degraded") {
      continue;
    }

    if (device.kind === "solar_inverter") deviceIds.add("solar");
    if (device.kind === "battery") deviceIds.add("battery");
    if (device.kind === "smart_meter") deviceIds.add("grid");
  }

  const hasEvDevice = input.systemState.devices.some((device) => device.kind === "ev_charger");
  const canPlanEv =
    hasEvDevice &&
    input.constraints.allowAutomaticEvCharging &&
    Boolean(input.systemState.evConnected);

  if (canPlanEv) {
    deviceIds.add("ev");
  } else if (hasEvDevice && input.constraints.allowAutomaticEvCharging && !input.systemState.evConnected) {
    unmetConstraints.push("EV charging requested, but no vehicle is connected right now.");
  } else if (hasEvDevice && !input.constraints.allowAutomaticEvCharging) {
    unmetConstraints.push("Automatic EV charging is disabled, so Gridly will not schedule EV charging.");
  }

  if (input.constraints.batteryReservePercent !== undefined && !deviceIds.has("battery")) {
    unmetConstraints.push("Battery reserve was requested, but no battery is connected.");
  }

  if (input.constraints.allowBatteryExport && !deviceIds.has("grid")) {
    unmetConstraints.push("Battery export is allowed in settings, but no grid-connected meter is available.");
  }

  return {
    connectedDeviceIds: [...deviceIds],
    unmetConstraints,
  };
}

function buildLegacyPlannerContext(input: OptimizerInput): PlannerBridgeContext {
  const generatedAt = new Date().toISOString();
  const mode = toLegacyMode(input.constraints.mode);
  const { connectedDeviceIds, unmetConstraints } = extractConnectedDeviceIds(input);
  const assumptions: string[] = [];

  if (!input.tariffSchedule.exportRates?.length) {
    assumptions.push("No export tariff was supplied, so export value is inferred from import pricing.");
  }

  if (!input.forecasts.carbonIntensity?.length) {
    assumptions.push("No carbon forecast was supplied, so the legacy planner will fall back to its internal curve.");
  }

  if (!input.forecasts.solarGenerationKwh.length) {
    assumptions.push("No solar forecast was supplied, so the plan assumes limited solar opportunity.");
  }

  return {
    mode,
    planId: toPlanId(input.systemState.siteId, generatedAt),
    generatedAt,
    connectedDeviceIds,
    importRatesByTime: buildRateLookup(input.tariffSchedule.importRates),
    exportRatesByTime: buildRateLookup(input.tariffSchedule.exportRates ?? []),
    unmetConstraints,
    assumptions,
  };
}

function buildLegacyAgileRates(input: OptimizerInput): Array<{ time: string; pence: number }> {
  return input.tariffSchedule.importRates.map((rate) => ({
    time: toHHMM(rate.startAt),
    pence: Number(rate.unitRatePencePerKwh.toFixed(1)),
  }));
}

function computeEvTargetKwh(input: OptimizerInput): number | undefined {
  const targetSoc = input.constraints.evTargetSocPercent;
  const currentSoc = input.systemState.evSocPercent;
  const evDevice = input.systemState.devices.find((device) => device.kind === "ev_charger");
  const capacityKwh = evDevice?.capacityKwh;

  if (
    targetSoc === undefined ||
    currentSoc === undefined ||
    capacityKwh === undefined ||
    !input.systemState.evConnected ||
    !input.constraints.allowAutomaticEvCharging
  ) {
    return undefined;
  }

  const deltaPercent = Math.max(0, targetSoc - currentSoc);
  const requiredKwh = (deltaPercent / 100) * capacityKwh;
  return requiredKwh > 0 ? Number(requiredKwh.toFixed(2)) : undefined;
}

function buildLegacyPlannerOutput(input: OptimizerInput, context: PlannerBridgeContext) {
  const rates = buildLegacyAgileRates(input);
  const solarForecastKwh = sumForecastValues(input.forecasts.solarGenerationKwh);
  const carbonIntensity = input.forecasts.carbonIntensity?.map((point) => Math.round(point.value));
  const legacyPlanResult = buildGridlyPlan(
    rates,
    context.connectedDeviceIds,
    solarForecastKwh,
    context.mode,
    {
      batteryCapacityKwh: input.systemState.batteryCapacityKwh,
      batteryStartPct: input.systemState.batterySocPercent,
      batteryReservePct: input.constraints.batteryReservePercent,
      maxBatteryCyclesPerDay: input.constraints.maxBatteryCyclesPerDay,
      evTargetKwh: computeEvTargetKwh(input),
      evReadyBy: input.constraints.evReadyBy,
      nowSlotIndex: Math.max(0, Math.min(47, Math.floor(new Date(input.systemState.capturedAt).getHours() * 2 + new Date(input.systemState.capturedAt).getMinutes() / 30))),
      carbonIntensity,
      exportPriceRatio: input.tariffSchedule.exportRates?.length
        ? clamp(
            average(
              input.tariffSchedule.exportRates.map((rate, index) => {
                const importRate = input.tariffSchedule.importRates[index]?.unitRatePencePerKwh ?? rate.unitRatePencePerKwh;
                return importRate > 0 ? rate.unitRatePencePerKwh / importRate : 0.72;
              }),
            ),
            0.4,
            1,
          )
        : 0.72,
    },
  );

  return legacyPlanResult;
}

function buildLegacyHeuristicOutput(input: OptimizerInput): LegacyHeuristicOutput | undefined {
  if (!input.tariffSchedule.importRates.length) {
    return undefined;
  }

  return runLegacyHeuristic({
    batterySocPercent: input.systemState.batterySocPercent ?? 0,
    forecastLoadKwh: input.forecasts.householdLoadKwh.map((point) => point.value),
    forecastSolarKwh: input.forecasts.solarGenerationKwh.map((point) => point.value),
    importPrice: input.tariffSchedule.importRates.map((rate) => rate.unitRatePencePerKwh / 100),
    exportPrice: input.tariffSchedule.exportRates?.map((rate) => rate.unitRatePencePerKwh / 100),
  });
}

function parseSlotWindow(
  slot: PlanSlot,
  importRatesByTime: Map<string, TariffRate>,
  exportRatesByTime: Map<string, TariffRate>,
  slotDurationMinutes: number,
): { startAt: string; endAt: string; importRate?: TariffRate; exportRate?: TariffRate } {
  const importRate = importRatesByTime.get(slot.time);
  const exportRate = exportRatesByTime.get(slot.time);
  const start = importRate?.startAt ?? exportRate?.startAt ?? new Date(`1970-01-01T${slot.time}:00Z`).toISOString();
  const end = importRate?.endAt ?? exportRate?.endAt ?? new Date(new Date(start).getTime() + slotDurationMinutes * 60000).toISOString();
  return {
    startAt: start,
    endAt: end,
    importRate,
    exportRate,
  };
}

function mapAction(slot: PlanSlot, allowBatteryExport: boolean): OptimizerDecision["action"] {
  if (slot.decisionType === "battery_charge") return "charge_battery";
  if (slot.decisionType === "ev_charge") return "charge_ev";
  if (slot.decisionType === "export") return allowBatteryExport ? "export_to_grid" : "hold";
  if (slot.decisionType === "solar") return "consume_solar";
  return "hold";
}

function mapTargetDeviceIds(slot: PlanSlot): string[] {
  if (slot.decisionType === "battery_charge") return ["battery"];
  if (slot.decisionType === "ev_charge") return ["ev"];
  if (slot.decisionType === "export") return ["battery", "grid"];
  if (slot.decisionType === "solar") return ["solar"];
  return [];
}

function mapConfidence(slot: PlanSlot): number {
  const normalized = slot.score ?? 0.55;
  return Number(clamp(0.52 + normalized * 0.4, 0.45, 0.96).toFixed(2));
}

function buildDecisionReason(slot: PlanSlot, allowBatteryExport: boolean): string {
  if (slot.decisionType === "export" && !allowBatteryExport) {
    return `${slot.reason} Export was suppressed because battery export is currently disabled.`;
  }

  return slot.reason;
}

function mapPlanSlotsToCanonicalDecisions(
  plan: PlanWithSessions,
  input: OptimizerInput,
  context: PlannerBridgeContext,
): OptimizerDecision[] {
  return plan.map((slot) => {
    const window = parseSlotWindow(
      slot,
      context.importRatesByTime,
      context.exportRatesByTime,
      input.forecasts.slotDurationMinutes,
    );
    const action = mapAction(slot, input.constraints.allowBatteryExport);

    return {
      startAt: window.startAt,
      endAt: window.endAt,
      action,
      targetDeviceIds: action === "hold" ? [] : mapTargetDeviceIds(slot),
      expectedImportKwh: slot.action === "CHARGE" ? Number((input.forecasts.slotDurationMinutes / 60).toFixed(2)) : undefined,
      expectedExportKwh: action === "export_to_grid" ? Number((input.forecasts.slotDurationMinutes / 60).toFixed(2)) : undefined,
      expectedBatterySocPercent:
        slot.decisionType === "battery_charge"
          ? Math.min(100, Number(((input.systemState.batterySocPercent ?? 0) + 12).toFixed(1)))
          : slot.decisionType === "export"
            ? Math.max(input.constraints.batteryReservePercent ?? 0, Number(((input.systemState.batterySocPercent ?? 0) - 10).toFixed(1)))
            : input.systemState.batterySocPercent,
      expectedEvSocPercent:
        slot.decisionType === "ev_charge" && input.systemState.evSocPercent !== undefined
          ? Math.min(input.constraints.evTargetSocPercent ?? 80, Number((input.systemState.evSocPercent + 8).toFixed(1)))
          : input.systemState.evSocPercent,
      reason: buildDecisionReason(slot, input.constraints.allowBatteryExport),
      confidence: mapConfidence(slot),
    };
  });
}

function buildCommands(
  decisions: OptimizerDecision[],
  generatedAt: string,
  planId: string,
): DeviceCommand[] {
  const commands: DeviceCommand[] = [];

  decisions.forEach((decision, index) => {
    if (decision.action === "charge_battery") {
      commands.push({
        commandId: `${planId}-battery-${index}`,
        deviceId: "battery",
        issuedAt: generatedAt,
        type: "set_mode",
        mode: "charge",
        effectiveWindow: { startAt: decision.startAt, endAt: decision.endAt },
        reason: decision.reason,
      });
    } else if (decision.action === "export_to_grid") {
      commands.push({
        commandId: `${planId}-export-${index}`,
        deviceId: "battery",
        issuedAt: generatedAt,
        type: "set_mode",
        mode: "export",
        effectiveWindow: { startAt: decision.startAt, endAt: decision.endAt },
        reason: decision.reason,
      });
    } else if (decision.action === "charge_ev") {
      commands.push({
        commandId: `${planId}-ev-${index}`,
        deviceId: "ev",
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

function buildSummary(
  summary: PlanSummary,
  forecasts: OptimizerInput["forecasts"],
): OptimizerSummary {
  const carbonAvoidedGrams = forecasts.carbonIntensity?.length
    ? Number(
        (
          forecasts.carbonIntensity.reduce((sum, point) => sum + point.value, 0) *
          Math.max(0, sumForecastValues(forecasts.solarGenerationKwh) * 0.35)
        ).toFixed(0),
      )
    : undefined;

  return {
    expectedImportCostPence: Math.round(summary.estimatedImportSpend * 100),
    expectedExportRevenuePence: Math.round(summary.estimatedExportRevenue * 100),
    expectedNetValuePence: Math.round((summary.projectedSavings + summary.projectedEarnings) * 100),
    expectedSolarSelfConsumptionKwh: Number((sumForecastValues(forecasts.solarGenerationKwh) * 0.62).toFixed(2)),
    expectedBatteryCycles: summary.batteryCyclesPlanned,
    expectedCarbonAvoidedGrams: carbonAvoidedGrams,
  };
}

function buildBaseDiagnostics(
  input: OptimizerInput,
  context: PlannerBridgeContext,
  legacySummary: PlanSummary,
  legacyGridlySummary: GridlyPlanSummary,
  heuristic?: LegacyHeuristicOutput,
): OptimizerDiagnostic[] {
  const diagnostics: OptimizerDiagnostic[] = [
    {
      code: "TOP_STRATEGY",
      message: legacyGridlySummary.customerReason,
      severity: "info",
    },
    {
      code: "PRICE_SUMMARY",
      message: `Cheapest slot is ${legacySummary.cheapestSlot} at ${legacySummary.cheapestPrice.toFixed(1)}p. Peak slot is ${legacySummary.peakSlot} at ${legacySummary.peakPrice.toFixed(1)}p.`,
      severity: "info",
    },
    {
      code: "SOLAR_SUMMARY",
      message: `Solar forecast across the planning horizon is ${sumForecastValues(input.forecasts.solarGenerationKwh).toFixed(1)}kWh.`,
      severity: "info",
    },
  ];

  context.unmetConstraints.forEach((message, index) => {
    diagnostics.push({
      code: `UNMET_CONSTRAINT_${index + 1}`,
      message,
      severity: "warning",
    });
  });

  context.assumptions.forEach((message, index) => {
    diagnostics.push({
      code: `ASSUMPTION_${index + 1}`,
      message,
      severity: "info",
    });
  });

  heuristic?.diagnostics.forEach((diagnostic) => {
    diagnostics.push({
      code: `HEURISTIC_${diagnostic.code}`,
      message: diagnostic.message,
      severity: diagnostic.severity ?? "info",
    });
  });

  if (input.constraints.evReadyBy && legacySummary.evSlotsPlanned === 0 && input.constraints.allowAutomaticEvCharging) {
    diagnostics.push({
      code: "EV_TARGET_UNPLANNED",
      message: `No EV charging slots were planned before ${input.constraints.evReadyBy}.`,
      severity: "warning",
    });
  }

  return diagnostics;
}

export function buildCanonicalPlan(input: OptimizerInput): CanonicalPlanBuildResult {
  const context = buildLegacyPlannerContext(input);
  const { plan, summary, gridlySummary } = buildLegacyPlannerOutput(input, context);
  const heuristic = buildLegacyHeuristicOutput(input);
  const decisions = mapPlanSlotsToCanonicalDecisions(plan, input, context);
  const recommendedCommands = buildCommands(decisions, context.generatedAt, context.planId);
  const diagnostics = buildBaseDiagnostics(input, context, summary, gridlySummary, heuristic);
  const confidenceValues = [
    ...decisions.map((decision) => decision.confidence),
    heuristic?.confidence ?? 0.72,
    average(input.forecasts.householdLoadKwh.map((point) => point.confidence ?? 0.72)),
    average(input.forecasts.solarGenerationKwh.map((point) => point.confidence ?? 0.72)),
  ].filter((value) => Number.isFinite(value));

  return {
    planId: context.planId,
    generatedAt: context.generatedAt,
    headline: gridlySummary.planHeadline,
    decisions,
    recommendedCommands,
    summary: buildSummary(summary, input.forecasts),
    diagnostics,
    confidence: Number(clamp(average(confidenceValues), 0.45, 0.96).toFixed(2)),
    legacyPlan: plan,
    legacySummary: summary,
    legacyGridlySummary: gridlySummary,
    legacyHeuristic: heuristic,
  };
}

export type { GridlyPlanSession, PlanSlot, PlanSummary, PlanWithSessions };