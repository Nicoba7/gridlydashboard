import { afterEach, describe, expect, it, vi } from "vitest";
import type { SystemState } from "../domain";
import type { OptimizerDecision, OptimizerOpportunity, OptimizerOutput } from "../domain/optimizer";
import { runControlLoopExecutionService } from "../application/controlLoopExecution/service";
import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  DeviceCommandExecutor,
} from "../application/controlLoopExecution/types";
import { InMemoryDeviceCapabilitiesProvider } from "../capabilities/deviceCapabilitiesProvider";
import { InMemoryDeviceShadowStore } from "../shadow/deviceShadowStore";
import { InMemoryExecutionJournalStore } from "../journal/executionJournalStore";
import {
  getLatestCycleHeartbeat,
  getRecentExecutionOutcomes,
  setLatestCycleHeartbeat,
} from "../journal/latestCycleHeartbeatSource";

afterEach(() => {
  setLatestCycleHeartbeat(undefined);
});

function buildSystemState(): SystemState {
  return {
    siteId: "site-1",
    capturedAt: "2026-03-16T10:00:00.000Z",
    timezone: "Europe/London",
    devices: [],
    homeLoadW: 1200,
    solarGenerationW: 800,
    batteryPowerW: 0,
    evChargingPowerW: 0,
    gridPowerW: 400,
  };
}

function buildDecision(id: string, deviceId: string): OptimizerDecision {
  return {
    decisionId: id,
    startAt: "2026-03-16T10:00:00.000Z",
    endAt: "2026-03-16T10:30:00.000Z",
    executionWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    action: "charge_battery",
    targetDeviceIds: [deviceId],
    targetDevices: [{ deviceId }],
    reason: "Test",
    marginalImportAvoidancePencePerKwh: 12.4,
    marginalExportValuePencePerKwh: 9.3,
    grossStoredEnergyValuePencePerKwh: 12.4,
    netStoredEnergyValuePencePerKwh: 10.4,
    batteryDegradationCostPencePerKwh: 2,
    effectiveStoredEnergyValuePencePerKwh: 12.4,
    planningConfidenceLevel: "medium",
    conservativeAdjustmentApplied: true,
    conservativeAdjustmentReason: "Export tariff coverage is partial. Fallback/default forecast or tariff values were used.",
    confidence: 0.8,
  };
}

function buildOutput(
  commands: OptimizerOutput["recommendedCommands"],
  decisions?: OptimizerDecision[],
  opportunities?: OptimizerOpportunity[],
): OptimizerOutput {
  const normalizedDecisions = decisions ?? [buildDecision("decision-1", "battery")];
  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: "plan-1",
    generatedAt: "2026-03-16T10:00:00.000Z",
    planningWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    status: "ok",
    headline: "Test",
    decisions: normalizedDecisions,
    opportunities,
    recommendedCommands: commands,
    summary: {
      expectedImportCostPence: 100,
      expectedExportRevenuePence: 10,
      planningNetRevenueSurplusPence: -90,
    },
    diagnostics: [],
    feasibility: { executable: true, reasonCodes: ["PLAN_COMPUTED"] },
    assumptions: [],
    warnings: [],
    confidence: 0.8,
  };
}

function buildCapabilitiesProvider() {
  return new InMemoryDeviceCapabilitiesProvider([
    {
      deviceId: "battery",
      supportedCommandKinds: ["set_mode", "set_power_limit"],
      supportedModes: ["charge", "discharge"],
      powerRangeW: { min: 500, max: 7000 },
      minimumCommandWindowMinutes: 15,
      supportsOverlappingWindows: true,
      supportsImmediateExecution: true,
      schemaVersion: "capabilities.v1",
    },
    {
      deviceId: "ev",
      supportedCommandKinds: ["set_mode"],
      supportedModes: ["charge"],
      minimumCommandWindowMinutes: 15,
      supportsOverlappingWindows: true,
      supportsImmediateExecution: true,
      schemaVersion: "capabilities.v1",
    },
  ]);
}

describe("runControlLoopExecutionService journal", () => {
  it("publishes finalized cycle heartbeat to the shared latest-cycle source", async () => {
    const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
      requests.map((request): CommandExecutionResult => ({
        executionRequestId: request.executionRequestId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        decisionId: request.decisionId,
        targetDeviceId: request.targetDeviceId,
        commandId: request.commandId,
        deviceId: request.targetDeviceId,
        status: "issued",
      })),
    );
    const executor: DeviceCommandExecutor = { execute };

    await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput([
          {
            commandId: "cmd-1",
            deviceId: "battery",
            issuedAt: "2026-03-16T10:00:00.000Z",
            type: "set_mode",
            mode: "charge",
            effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
          },
        ]),
      },
      executor,
      buildCapabilitiesProvider(),
    );

    const latestHeartbeat = getLatestCycleHeartbeat();
    expect(latestHeartbeat).toBeDefined();
    expect(latestHeartbeat?.entryKind).toBe("cycle_heartbeat");
    expect(latestHeartbeat?.recordedAt).toBe("2026-03-16T10:05:00.000Z");
    expect(latestHeartbeat?.nextCycleExecutionCaution).toBe("normal");

    const recentExecutionOutcomes = getRecentExecutionOutcomes();
    expect(recentExecutionOutcomes.length).toBeGreaterThan(0);
    expect(recentExecutionOutcomes[0].recordedAt).toBe("2026-03-16T10:05:00.000Z");
  });

  it("adapts command-only dispatch to canonical opportunity identity without partial authority mode", async () => {
    const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
      requests.map((request): CommandExecutionResult => ({
        executionRequestId: request.executionRequestId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        decisionId: request.decisionId,
        targetDeviceId: request.targetDeviceId,
        commandId: request.commandId,
        deviceId: request.targetDeviceId,
        status: "issued",
      })),
    );
    const executor: DeviceCommandExecutor = { execute };
    const journal = new InMemoryExecutionJournalStore();

    await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput([
          {
            commandId: "cmd-1",
            deviceId: "battery",
            issuedAt: "2026-03-16T10:00:00.000Z",
            type: "set_mode",
            mode: "charge",
            effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
          },
        ]),
      },
      executor,
      buildCapabilitiesProvider(),
      undefined,
      journal,
    );

    const entries = journal.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("issued");
    expect(entries[0].opportunityId).toContain("plan-1:decision:decision-1:command:cmd-1");
    expect(entries[0].reasonCodes ?? []).not.toContain("EXECUTION_AUTHORITY_PARTIAL_IDENTITY_MODE");
    expect(entries[0].opportunityProvenance).toEqual({
      kind: "compatibility_canonicalized",
      canonicalizedFromLegacy: true,
      legacySourceType: "command_execution_request",
      adaptationReason: "missing_opportunity_id",
      sourceCommandLineage: {
        planId: "plan-1",
        decisionId: "decision-1",
        commandId: "cmd-1",
        targetDeviceId: "battery",
        sourceOpportunityId: undefined,
      },
      canonicalizationVersion: "legacy-opportunity-canonicalization.v1",
    });
  });

  it("preserves compatibility decision-missing flow without authority denial", async () => {
    const execute = vi.fn(async (_requests: CommandExecutionRequest[]) => [] as CommandExecutionResult[]);
    const executor: DeviceCommandExecutor = { execute };
    const journal = new InMemoryExecutionJournalStore();

    await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: {
          ...buildOutput([
            {
              commandId: "cmd-1",
              deviceId: "battery",
              issuedAt: "2026-03-16T10:00:00.000Z",
              type: "set_mode",
              mode: "charge",
              effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
            },
          ], []),
          decisions: [],
        },
      },
      executor,
      buildCapabilitiesProvider(),
      undefined,
      journal,
    );

    expect(execute).not.toHaveBeenCalled();
    const entries = journal.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("skipped");
    expect(entries[0].stage).toBe("dispatch");
    expect(entries[0].opportunityProvenance?.kind).toBe("compatibility_canonicalized");
    expect(entries[0].reasonCodes ?? []).not.toContain("EXECUTION_AUTHORITY_IDENTITY_INSUFFICIENT");
  });

  it("records journal entry for preflight-invalid command", async () => {
    const execute = vi.fn(async (_requests: CommandExecutionRequest[]) => [] as CommandExecutionResult[]);
    const executor: DeviceCommandExecutor = { execute };
    const journal = new InMemoryExecutionJournalStore();
    const provider = new InMemoryDeviceCapabilitiesProvider([]);

    await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput([
          {
            commandId: "cmd-1",
            deviceId: "battery",
            issuedAt: "2026-03-16T10:00:00.000Z",
            type: "set_mode",
            mode: "charge",
            effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
          },
        ]),
      },
      executor,
      provider,
      undefined,
      journal,
    );

    expect(execute).not.toHaveBeenCalled();
    const entries = journal.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].stage).toBe("preflight_validation");
    expect(entries[0].reasonCodes).toContain("CAPABILITIES_NOT_FOUND");
  });

  it("records journal entry for reconciliation skip", async () => {
    const execute = vi.fn(async (_requests: CommandExecutionRequest[]) => [] as CommandExecutionResult[]);
    const executor: DeviceCommandExecutor = { execute };
    const journal = new InMemoryExecutionJournalStore();
    const shadowStore = new InMemoryDeviceShadowStore();
    shadowStore.setDeviceState("battery", {
      deviceId: "battery",
      lastKnownMode: "charge",
      lastKnownWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
      lastUpdatedAt: "2026-03-16T10:04:00.000Z",
      stateSource: "execution_result",
      schemaVersion: "device-shadow.v1",
    });

    await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput([
          {
            commandId: "cmd-1",
            deviceId: "battery",
            issuedAt: "2026-03-16T10:00:00.000Z",
            type: "set_mode",
            mode: "charge",
            effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
          },
        ]),
      },
      executor,
      buildCapabilitiesProvider(),
      shadowStore,
      journal,
    );

    expect(execute).not.toHaveBeenCalled();
    const entries = journal.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].stage).toBe("reconciliation");
    expect(entries[0].status).toBe("skipped");
    expect(entries[0].acknowledgementStatus).toBe("pending");
  });

  it("records journal entry for successful dispatch", async () => {
    const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
      requests.map((request): CommandExecutionResult => ({
        executionRequestId: request.executionRequestId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        decisionId: request.decisionId,
        targetDeviceId: request.targetDeviceId,
        commandId: request.commandId,
        deviceId: request.targetDeviceId,
        status: "issued",
      })),
    );
    const executor: DeviceCommandExecutor = { execute };
    const journal = new InMemoryExecutionJournalStore();

    await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput(
          [
            {
              commandId: "cmd-1",
              deviceId: "battery",
              issuedAt: "2026-03-16T10:00:00.000Z",
              type: "set_mode",
              mode: "charge",
              effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
            },
          ],
          undefined,
          [
            {
              opportunityId: "opp-1",
              decisionId: "decision-1",
              action: "charge_battery",
              targetDeviceId: "battery",
              targetKind: "battery",
              requiredCapabilities: ["set_mode"],
              command: {
                commandId: "cmd-1",
                deviceId: "battery",
                issuedAt: "2026-03-16T10:00:00.000Z",
                type: "set_mode",
                mode: "charge",
                effectiveWindow: {
                  startAt: "2026-03-16T10:00:00.000Z",
                  endAt: "2026-03-16T10:30:00.000Z",
                },
              },
              economicSignals: {
                effectiveStoredEnergyValuePencePerKwh: 12.4,
              },
              planningConfidenceLevel: "medium",
              decisionReason: "Test",
            },
          ],
        ),
      },
      executor,
      buildCapabilitiesProvider(),
      undefined,
      journal,
    );

    const entries = journal.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].stage).toBe("dispatch");
    expect(entries[0].status).toBe("issued");
    expect(entries[0].opportunityId).toBe("opp-1");
    expect(entries[0].opportunityProvenance).toEqual({
      kind: "native_canonical",
      canonicalizedFromLegacy: false,
    });
    expect(entries[0].decisionId).toBe("decision-1");
    expect(entries[0].acknowledgementStatus).toBe("acknowledged");
  });

  it("records cycle financial context including value ledger", async () => {
    const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
      requests.map((request): CommandExecutionResult => ({
        executionRequestId: request.executionRequestId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        decisionId: request.decisionId,
        targetDeviceId: request.targetDeviceId,
        commandId: request.commandId,
        deviceId: request.targetDeviceId,
        status: "issued",
      })),
    );
    const executor: DeviceCommandExecutor = { execute };
    const journal = new InMemoryExecutionJournalStore();

    await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput([
          {
            commandId: "cmd-1",
            deviceId: "battery",
            issuedAt: "2026-03-16T10:00:00.000Z",
            type: "set_mode",
            mode: "charge",
            effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
          },
        ]),
      },
      executor,
      buildCapabilitiesProvider(),
      undefined,
      journal,
      {
        optimizationMode: "cost",
        valueLedger: {
          optimizationMode: "cost",
          estimatedImportCostPence: 120,
          estimatedExportRevenuePence: 40,
          estimatedBatteryDegradationCostPence: 2,
          estimatedNetCostPence: 80,
          baselineType: "hold_current_state",
          baselineNetCostPence: 100,
          baselineImportCostPence: 110,
          baselineExportRevenuePence: 10,
          baselineBatteryDegradationCostPence: 0,
          estimatedSavingsVsBaselinePence: 20,
          assumptions: ["test assumption"],
          caveats: [],
          confidence: 0.8,
        },
        planningInputCoverage: {
          plannedSlotCount: 4,
          tariffImport: { availableSlots: 4, totalPlannedSlots: 4, coveragePercent: 100 },
          tariffExport: { availableSlots: 2, totalPlannedSlots: 4, coveragePercent: 50 },
          forecastLoad: { availableSlots: 3, totalPlannedSlots: 4, coveragePercent: 75 },
          forecastSolar: { availableSlots: 4, totalPlannedSlots: 4, coveragePercent: 100 },
          fallbackSlotCount: 1,
          fallbackByType: {
            exportRateSlots: 2,
            loadForecastSlots: 1,
            solarForecastSlots: 0,
          },
          caveats: ["Fallback/default slot values were used for at least one planned slot."],
        },
        planningConfidenceLevel: "medium",
        conservativeAdjustmentApplied: true,
        conservativeAdjustmentReason: "Export tariff coverage is partial. Fallback/default forecast or tariff values were used.",
        planningAssumptions: ["test assumption"],
        planningWarnings: ["PARTIAL_EXPORT_RATE_COVERAGE", "FALLBACK_SLOT_DEFAULTS_APPLIED"],
      },
    );

    const entries = journal.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].cycleFinancialContext?.optimizationMode).toBe("cost");
    expect(entries[0].cycleFinancialContext?.valueLedger.estimatedSavingsVsBaselinePence).toBe(20);
    expect(entries[0].cycleFinancialContext?.decisionsTaken).toHaveLength(1);
    expect(entries[0].cycleFinancialContext?.decisionsTaken[0]?.decisionId).toBe("decision-1");
    expect(entries[0].cycleFinancialContext?.decisionsTaken[0]?.marginalImportAvoidance).toBe(12.4);
    expect(entries[0].cycleFinancialContext?.decisionsTaken[0]?.marginalExportValue).toBe(9.3);
    expect(entries[0].cycleFinancialContext?.decisionsTaken[0]?.grossStoredEnergyValue).toBe(12.4);
    expect(entries[0].cycleFinancialContext?.decisionsTaken[0]?.netStoredEnergyValue).toBe(10.4);
    expect(entries[0].cycleFinancialContext?.decisionsTaken[0]?.batteryDegradationCost).toBe(2);
    expect(entries[0].cycleFinancialContext?.decisionsTaken[0]?.effectiveStoredEnergyValue).toBe(12.4);
    expect(entries[0].cycleFinancialContext?.decisionsTaken[0]?.planningConfidenceLevel).toBe("medium");
    expect(entries[0].cycleFinancialContext?.decisionsTaken[0]?.conservativeAdjustmentApplied).toBe(true);
    expect(entries[0].cycleFinancialContext?.decisionsTaken[0]?.conservativeAdjustmentReason).toContain("Export tariff coverage is partial");
    expect(entries[0].cycleFinancialContext?.decisionsTaken[0]?.decisionReason).toBe("Test");
    expect(entries[0].cycleFinancialContext?.planningInputCoverage?.tariffExport.coveragePercent).toBe(50);
    expect(entries[0].cycleFinancialContext?.planningInputCoverage?.forecastLoad.coveragePercent).toBe(75);
    expect(entries[0].cycleFinancialContext?.planningConfidenceLevel).toBe("medium");
    expect(entries[0].cycleFinancialContext?.conservativeAdjustmentApplied).toBe(true);
    expect(entries[0].cycleFinancialContext?.planningWarnings).toContain("PARTIAL_EXPORT_RATE_COVERAGE");
    expect(entries[0].cycleFinancialContext?.runtimeExecutionPosture).toBe("normal");
    expect(entries[0].cycleFinancialContext?.runtimeExecutionReasonCodes).toEqual([]);
  });

  it("records journal entry for failed dispatch", async () => {
    const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
      requests.map((request): CommandExecutionResult => ({
        executionRequestId: request.executionRequestId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        decisionId: request.decisionId,
        targetDeviceId: request.targetDeviceId,
        commandId: request.commandId,
        deviceId: request.targetDeviceId,
        status: "failed",
        reasonCodes: ["COMMAND_FAILED"],
        errorCode: "COMMAND_FAILED",
      })),
    );
    const executor: DeviceCommandExecutor = { execute };
    const journal = new InMemoryExecutionJournalStore();

    await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput([
          {
            commandId: "cmd-1",
            deviceId: "battery",
            issuedAt: "2026-03-16T10:00:00.000Z",
            type: "set_mode",
            mode: "charge",
            effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
          },
        ]),
      },
      executor,
      buildCapabilitiesProvider(),
      undefined,
      journal,
    );

    const entries = journal.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].stage).toBe("dispatch");
    expect(entries[0].status).toBe("failed");
    expect(entries[0].acknowledgementStatus).toBe("not_acknowledged");
    expect(entries[0].reasonCodes).toContain("COMMAND_FAILED");
  });

  it("appends independent entries for multiple commands", async () => {
    const execute = vi.fn(async (requests: CommandExecutionRequest[]) =>
      requests.map((request): CommandExecutionResult => ({
        executionRequestId: request.executionRequestId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        decisionId: request.decisionId,
        targetDeviceId: request.targetDeviceId,
        commandId: request.commandId,
        deviceId: request.targetDeviceId,
        status: "issued",
      })),
    );
    const executor: DeviceCommandExecutor = { execute };
    const journal = new InMemoryExecutionJournalStore();
    const shadowStore = new InMemoryDeviceShadowStore();
    shadowStore.setDeviceState("battery", {
      deviceId: "battery",
      lastKnownMode: "charge",
      lastKnownWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
      lastUpdatedAt: "2026-03-16T10:04:00.000Z",
      stateSource: "execution_result",
      schemaVersion: "device-shadow.v1",
    });

    const output = buildOutput(
      [
        {
          commandId: "cmd-battery",
          deviceId: "battery",
          issuedAt: "2026-03-16T10:00:00.000Z",
          type: "set_mode",
          mode: "charge",
          effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
        },
        {
          commandId: "cmd-ev",
          deviceId: "ev",
          issuedAt: "2026-03-16T10:00:00.000Z",
          type: "set_mode",
          mode: "charge",
          effectiveWindow: { startAt: "2026-03-16T10:00:00.000Z", endAt: "2026-03-16T10:30:00.000Z" },
        },
      ],
      [buildDecision("decision-battery", "battery"), buildDecision("decision-ev", "ev")],
    );

    await runControlLoopExecutionService(
      { now: "2026-03-16T10:05:00.000Z", systemState: buildSystemState(), optimizerOutput: output },
      executor,
      buildCapabilitiesProvider(),
      shadowStore,
      journal,
    );

    const entries = journal.getAll();
    expect(entries).toHaveLength(2);
    expect(entries.some((entry) => entry.status === "skipped")).toBe(true);
    expect(entries.some((entry) => entry.status === "issued")).toBe(true);
    entries.forEach((entry) => {
      expect(entry.executionRequestId).toBeTruthy();
      expect(entry.idempotencyKey).toBeTruthy();
      expect(entry.targetDeviceId).toBeTruthy();
    });
  });
});
