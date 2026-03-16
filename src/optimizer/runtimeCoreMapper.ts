import type {
  DeviceCapability,
  DeviceCommand,
  OptimizerDecision,
  OptimizerDecisionTarget,
  OptimizerDiagnostic,
  OptimizerInput,
  OptimizerSummary,
  TimeWindow,
} from "../domain";

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

function toPlanId(siteId: string, generatedAt: string): string {
  return `${siteId}-${generatedAt.replace(/[-:.TZ]/g, "")}`;
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
    const normalizedId = deviceId === "ev" ? "ev_charger" : deviceId;
    const matchedDevice = input.systemState.devices.find(
      (device) => device.deviceId === deviceId || device.kind === normalizedId,
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
    } else if (decision.action === "discharge_battery") {
      commands.push({
        commandId: `${planId}-discharge-${index}`,
        deviceId: "battery",
        issuedAt: generatedAt,
        type: "set_mode",
        mode: "discharge",
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

function buildDiagnostics(input: OptimizerInput, decisions: OptimizerDecision[]): OptimizerDiagnostic[] {
  const diagnostics: OptimizerDiagnostic[] = [
    {
      code: "MODE_SELECTION",
      message: `Planner mode is '${input.constraints.mode}'.`,
      severity: "info",
    },
    {
      code: "HORIZON_SLOTS",
      message: `Computed ${decisions.length} canonical decision slots for this planning horizon.`,
      severity: "info",
    },
  ];

  if (!input.tariffSchedule.exportRates?.length) {
    diagnostics.push({
      code: "MISSING_EXPORT_RATES",
      message: "No export rates were supplied; export value uses conservative assumptions.",
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
  const generatedAt = new Date().toISOString();
  const planId = toPlanId(input.systemState.siteId, generatedAt);
  const slotCount = input.tariffSchedule.importRates.length;
  const slotHours = input.forecasts.slotDurationMinutes / 60;

  const hasBattery = input.systemState.devices.some(
    (device) =>
      device.kind === "battery" &&
      (device.connectionStatus === "online" || device.connectionStatus === "degraded"),
  );
  const hasEv =
    input.constraints.allowAutomaticEvCharging &&
    Boolean(input.systemState.evConnected) &&
    input.systemState.devices.some(
      (device) =>
        device.kind === "ev_charger" &&
        (device.connectionStatus === "online" || device.connectionStatus === "degraded"),
    );

  const importRates = input.tariffSchedule.importRates;
  const exportRates = input.tariffSchedule.exportRates ?? [];
  const avgImportRate = average(importRates.map((rate) => rate.unitRatePencePerKwh));
  const lowImportThreshold = avgImportRate * 0.85;
  const highImportThreshold = avgImportRate * 1.15;

  let batterySoc = input.systemState.batterySocPercent ?? 50;
  const batteryCapacityKwh = input.systemState.batteryCapacityKwh ?? 10;
  const batteryReserve = input.constraints.batteryReservePercent ?? 20;
  const evCapacityKwh =
    input.systemState.devices.find((device) => device.kind === "ev_charger")?.capacityKwh ?? 60;
  let evSoc = input.systemState.evSocPercent;

  let expectedImportCostPence = 0;
  let expectedExportRevenuePence = 0;
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
      importRate <= avgImportRate;

    if (solarSurplusKwh > 0.05 && input.constraints.allowBatteryExport && exportRate >= importRate * 0.9) {
      action = "export_to_grid";
      reason = "Solar surplus and favorable export pricing support grid export.";
      expectedImportKwh = 0;
      expectedExportKwh = solarSurplusKwh;
      targetDeviceIds = ["battery", "grid"];
    } else if (solarKwh >= loadKwh * 0.9) {
      action = "consume_solar";
      reason = "Solar generation can cover most current demand.";
      expectedImportKwh = Math.max(0, loadKwh - solarKwh);
      targetDeviceIds = ["solar"];
    } else if (shouldChargeEv) {
      action = "charge_ev";
      reason = "Charging EV during a lower-cost import window.";
      const evChargeKwh = Math.min(2.0 * slotHours, Math.max(0, ((input.constraints.evTargetSocPercent ?? 85) - (evSoc ?? 0)) / 100 * evCapacityKwh));
      expectedImportKwh = Math.max(0, loadKwh - solarKwh) + evChargeKwh;
      targetDeviceIds = ["ev"];
      if (evSoc !== undefined && evChargeKwh > 0) {
        evSoc = clamp(evSoc + (evChargeKwh / evCapacityKwh) * 100, 0, 100);
      }
    } else if (canChargeBattery) {
      action = "charge_battery";
      reason = "Charging battery while import rates are below the daily average.";
      const batteryChargeKwh = Math.min(1.6 * slotHours, ((100 - batterySoc) / 100) * batteryCapacityKwh);
      expectedImportKwh = Math.max(0, loadKwh - solarKwh) + batteryChargeKwh;
      targetDeviceIds = ["battery"];
      batterySoc = clamp(batterySoc + (batteryChargeKwh / batteryCapacityKwh) * 100, 0, 100);
      batteryThroughputKwh += batteryChargeKwh;
    } else if (canDischargeBattery) {
      action = "discharge_battery";
      reason = "Using battery energy to reduce higher-cost import.";
      const dischargeKwh = Math.min(1.4 * slotHours, ((batterySoc - batteryReserve) / 100) * batteryCapacityKwh);
      expectedImportKwh = Math.max(0, loadKwh - solarKwh - dischargeKwh);
      targetDeviceIds = ["battery"];
      batterySoc = clamp(batterySoc - (dischargeKwh / batteryCapacityKwh) * 100, batteryReserve, 100);
      batteryThroughputKwh += dischargeKwh;
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
      confidence,
    });
  }

  const diagnostics = buildDiagnostics(input, decisions);
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
  ];

  if (!input.tariffSchedule.exportRates?.length) {
    assumptions.push("Export pricing uses a conservative fallback ratio when export slots are unavailable.");
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
      expectedNetValuePence: Math.round(expectedExportRevenuePence - expectedImportCostPence),
      expectedSolarSelfConsumptionKwh: Number(expectedSolarSelfConsumptionKwh.toFixed(2)),
      expectedBatteryCycles: batteryCapacityKwh > 0
        ? Number((batteryThroughputKwh / (2 * batteryCapacityKwh)).toFixed(2))
        : undefined,
    },
    diagnostics,
    confidence,
  };
}
