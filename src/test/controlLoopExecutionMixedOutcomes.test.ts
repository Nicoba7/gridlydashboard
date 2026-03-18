import { describe, expect, it, vi } from "vitest";
import type { SystemState } from "../domain";
import type { OptimizerDecision, OptimizerOpportunity, OptimizerOutput } from "../domain/optimizer";
import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  DeviceCommandExecutor,
} from "../application/controlLoopExecution/types";
import { runControlLoopExecutionService } from "../application/controlLoopExecution/service";
import { InMemoryDeviceCapabilitiesProvider } from "../capabilities/deviceCapabilitiesProvider";
import { InMemoryExecutionJournalStore } from "../journal/executionJournalStore";
import type { RuntimeExecutionGuardrailContext } from "../application/controlLoopExecution/executionPolicyTypes";

const NOW = "2026-03-16T10:05:00.000Z";

function buildSystemState(): SystemState {
  return {
    siteId: "site-1",
    capturedAt: "2026-03-16T10:00:00.000Z",
    timezone: "Europe/London",
    devices: [],
    homeLoadW: 1200,
    solarGenerationW: 300,
    batteryPowerW: 0,
    evChargingPowerW: 0,
    gridPowerW: 900,
  };
}

function buildDecision(params: {
  id: string;
  action: OptimizerDecision["action"];
  targetDeviceId: string;
  reason: string;
}): OptimizerDecision {
  return {
    decisionId: params.id,
    startAt: "2026-03-16T10:00:00.000Z",
    endAt: "2026-03-16T10:30:00.000Z",
    executionWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    action: params.action,
    targetDeviceIds: [params.targetDeviceId],
    targetDevices: [{ deviceId: params.targetDeviceId }],
    reason: params.reason,
    confidence: 0.85,
  };
}

function buildOutput(
  decisions: OptimizerDecision[],
  commands: OptimizerOutput["recommendedCommands"],
  opportunities?: OptimizerOpportunity[],
): OptimizerOutput {
  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: "plan-mixed-cycle-1",
    generatedAt: "2026-03-16T10:00:00.000Z",
    planningWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    status: "ok",
    headline: "Mixed heterogeneous cycle",
    decisions,
    opportunities,
    recommendedCommands: commands,
    summary: {
      expectedImportCostPence: 110,
      expectedExportRevenuePence: 15,
      planningNetRevenueSurplusPence: -95,
    },
    diagnostics: [],
    feasibility: { executable: true, reasonCodes: ["PLAN_COMPUTED"] },
    assumptions: [],
    warnings: [],
    confidence: 0.86,
  };
}

function buildCapabilitiesProvider() {
  return new InMemoryDeviceCapabilitiesProvider([
    {
      deviceId: "battery-1",
      supportedCommandKinds: ["set_mode"],
      supportedModes: ["charge", "discharge", "hold"],
      minimumCommandWindowMinutes: 15,
      supportsOverlappingWindows: true,
      supportsImmediateExecution: true,
      schemaVersion: "capabilities.v1",
    },
    {
      deviceId: "ev-1",
      supportedCommandKinds: ["refresh_state"],
      supportsImmediateExecution: true,
      schemaVersion: "capabilities.v1",
    },
    {
      deviceId: "solar-1",
      supportedCommandKinds: ["refresh_state"],
      supportsImmediateExecution: true,
      schemaVersion: "capabilities.v1",
    },
  ]);
}

describe("runControlLoopExecutionService mixed heterogeneous outcomes", () => {
  it("records issued + skipped + failed outcomes in one cycle with causally consistent heartbeat/journal/economic snapshot", async () => {
    const journal = new InMemoryExecutionJournalStore();
    const executor: DeviceCommandExecutor = {
      execute: vi.fn(async (requests: CommandExecutionRequest[]) =>
        requests.map((request): CommandExecutionResult => {
          if (request.targetDeviceId === "ev-1") {
            return {
              opportunityId: request.executionRequestId,
              executionRequestId: request.executionRequestId,
              requestId: request.requestId,
              idempotencyKey: request.idempotencyKey,
              decisionId: request.decisionId,
              targetDeviceId: request.targetDeviceId,
              commandId: request.commandId,
              deviceId: request.targetDeviceId,
              status: "failed",
              errorCode: "EXECUTOR_ERROR",
              reasonCodes: ["EXECUTOR_ERROR"],
            };
          }

          return {
            opportunityId: request.executionRequestId,
            executionRequestId: request.executionRequestId,
            requestId: request.requestId,
            idempotencyKey: request.idempotencyKey,
            decisionId: request.decisionId,
            targetDeviceId: request.targetDeviceId,
            commandId: request.commandId,
            deviceId: request.targetDeviceId,
            status: "issued",
          };
        }),
      ),
    };

    const decisions: OptimizerDecision[] = [
      buildDecision({
        id: "decision-battery",
        action: "charge_battery",
        targetDeviceId: "battery-1",
        reason: "Charge battery in value window",
      }),
      buildDecision({
        id: "decision-ev-refresh",
        action: "hold",
        targetDeviceId: "ev-1",
        reason: "Refresh EV telemetry",
      }),
      buildDecision({
        id: "decision-solar-refresh",
        action: "hold",
        targetDeviceId: "solar-1",
        reason: "Refresh solar telemetry",
      }),
    ];

    const output = buildOutput(
      decisions,
      [
        {
          commandId: "cmd-battery-1",
          deviceId: "battery-1",
          issuedAt: NOW,
          type: "set_mode",
          mode: "charge",
          effectiveWindow: {
            startAt: "2026-03-16T10:00:00.000Z",
            endAt: "2026-03-16T10:30:00.000Z",
          },
        },
        {
          commandId: "cmd-ev-refresh",
          deviceId: "ev-1",
          issuedAt: NOW,
          type: "refresh_state",
          effectiveWindow: {
            startAt: "2026-03-16T10:00:00.000Z",
            endAt: "2026-03-16T10:30:00.000Z",
          },
        },
        {
          commandId: "cmd-solar-refresh",
          deviceId: "solar-1",
          issuedAt: NOW,
          type: "refresh_state",
          effectiveWindow: {
            startAt: "2026-03-16T10:00:00.000Z",
            endAt: "2026-03-16T10:30:00.000Z",
          },
        },
      ],
      [
        {
          opportunityId: "opp-battery-1",
          decisionId: "decision-battery",
          action: "charge_battery",
          targetDeviceId: "battery-1",
          targetKind: "battery",
          requiredCapabilities: ["set_mode"],
          command: {
            commandId: "cmd-battery-1",
            deviceId: "battery-1",
            issuedAt: NOW,
            type: "set_mode",
            mode: "charge",
            effectiveWindow: {
              startAt: "2026-03-16T10:00:00.000Z",
              endAt: "2026-03-16T10:30:00.000Z",
            },
          },
          economicSignals: { effectiveStoredEnergyValuePencePerKwh: 11 },
          planningConfidenceLevel: "high",
          decisionReason: "Charge battery in value window",
        },
        {
          opportunityId: "opp-ev-1",
          decisionId: "decision-ev-refresh",
          action: "hold",
          targetDeviceId: "ev-1",
          targetKind: "ev",
          requiredCapabilities: ["refresh_state"],
          command: {
            commandId: "cmd-ev-refresh",
            deviceId: "ev-1",
            issuedAt: NOW,
            type: "refresh_state",
            effectiveWindow: {
              startAt: "2026-03-16T10:00:00.000Z",
              endAt: "2026-03-16T10:30:00.000Z",
            },
          },
          economicSignals: {},
          planningConfidenceLevel: "high",
          decisionReason: "Refresh EV telemetry",
        },
        {
          opportunityId: "opp-solar-1",
          decisionId: "decision-solar-refresh",
          action: "hold",
          targetDeviceId: "solar-1",
          targetKind: "solar",
          requiredCapabilities: ["refresh_state"],
          command: {
            commandId: "cmd-solar-refresh",
            deviceId: "solar-1",
            issuedAt: NOW,
            type: "refresh_state",
            effectiveWindow: {
              startAt: "2026-03-16T10:00:00.000Z",
              endAt: "2026-03-16T10:30:00.000Z",
            },
          },
          economicSignals: {},
          planningConfidenceLevel: "high",
          decisionReason: "Refresh solar telemetry",
        },
      ],
    );

    const runtimeGuardrailContext: RuntimeExecutionGuardrailContext = {
      safeHoldMode: false,
      planFreshnessStatus: "expired",
      replanTrigger: "expired_plan",
      stalePlanReuseCount: 1,
      stalePlanWarning: "Conservative runtime guardrail active",
    };

    const result = await runControlLoopExecutionService(
      {
        now: NOW,
        systemState: buildSystemState(),
        optimizerOutput: output,
      },
      executor,
      buildCapabilitiesProvider(),
      undefined,
      journal,
      {
        optimizationMode: "balanced",
        valueLedger: {
          optimizationMode: "balanced",
          estimatedImportCostPence: 110,
          estimatedExportRevenuePence: 15,
          estimatedBatteryDegradationCostPence: 2,
          estimatedNetCostPence: 97,
          baselineType: "hold_current_state",
          baselineNetCostPence: 105,
          baselineImportCostPence: 120,
          baselineExportRevenuePence: 15,
          baselineBatteryDegradationCostPence: 0,
          estimatedSavingsVsBaselinePence: 8,
          assumptions: [],
          caveats: [],
          confidence: 0.8,
        },
      },
      runtimeGuardrailContext,
      "continuous_live_strict",
      { cycleId: "cycle-mixed-heterogeneous-1", replanReason: "Plan expired" },
    );

    expect(result.executionPosture).toBe("conservative");
    expect(result.executionResults).toHaveLength(3);
    expect(result.executionResults.filter((x) => x.status === "issued")).toHaveLength(1);
    expect(result.executionResults.filter((x) => x.status === "skipped")).toHaveLength(1);
    expect(result.executionResults.filter((x) => x.status === "failed")).toHaveLength(1);

    const skipped = result.executionResults.find((x) => x.status === "skipped");
    expect(skipped?.reasonCodes).toContain("RUNTIME_CONSERVATIVE_MODE_ACTIVE");
    expect(skipped?.targetDeviceId).toBe("battery-1");
    expect(new Set(result.executionResults.map((entry) => entry.opportunityId))).toEqual(
      new Set(["opp-battery-1", "opp-ev-1", "opp-solar-1"]),
    );
    expect(result.executionResults.some((entry) => entry.opportunityId === entry.executionRequestId)).toBe(false);

    const entries = journal.getAll();
    expect(entries).toHaveLength(3);
    expect(entries.filter((x) => x.status === "issued")).toHaveLength(1);
    expect(entries.filter((x) => x.status === "skipped")).toHaveLength(1);
    expect(entries.filter((x) => x.status === "failed")).toHaveLength(1);
    expect(new Set(entries.map((entry) => entry.opportunityId))).toEqual(
      new Set(["opp-battery-1", "opp-ev-1", "opp-solar-1"]),
    );
    expect(entries.some((entry) => entry.opportunityId === entry.executionRequestId)).toBe(false);

    const heartbeat = journal.getCycleHeartbeats();
    expect(heartbeat).toHaveLength(1);
    expect(heartbeat[0].cycleId).toBe("cycle-mixed-heterogeneous-1");
    expect(heartbeat[0].executionPosture).toBe("conservative");
    expect(heartbeat[0].commandsIssued).toBe(1);
    expect(heartbeat[0].commandsSkipped).toBe(1);
    expect(heartbeat[0].commandsFailed).toBe(1);
    expect(heartbeat[0].commandsSuppressed).toBe(1);
    expect(heartbeat[0].failClosedTriggered).toBe(false);
    expect(heartbeat[0].economicSnapshot?.optimizationMode).toBe("balanced");
    expect(heartbeat[0].economicSnapshot?.hasValueSeekingDecisions).toBe(true);
    expect(heartbeat[0].economicSnapshot?.valueSeekingExecutionDeferred).toBe(true);
    expect(heartbeat[0].economicSnapshot?.estimatedSavingsVsBaselinePence).toBe(8);
  });

  it("keeps single-command execution as a degenerate edge case of the same canonical model", async () => {
    const journal = new InMemoryExecutionJournalStore();
    const executor: DeviceCommandExecutor = {
      execute: vi.fn(async (requests: CommandExecutionRequest[]) =>
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
      ),
    };

    const output = buildOutput(
      [
        buildDecision({
          id: "decision-tesla-edge",
          action: "charge_ev",
          targetDeviceId: "tesla-vehicle-1",
          reason: "Single EV action",
        }),
      ],
      [
        {
          commandId: "cmd-tesla-edge",
          deviceId: "tesla-vehicle-1",
          issuedAt: NOW,
          type: "schedule_window",
          window: {
            startAt: "2026-03-16T10:00:00.000Z",
            endAt: "2026-03-16T10:30:00.000Z",
          },
          targetMode: "charge",
          effectiveWindow: {
            startAt: "2026-03-16T10:00:00.000Z",
            endAt: "2026-03-16T10:30:00.000Z",
          },
        },
      ],
    );

    const provider = new InMemoryDeviceCapabilitiesProvider([
      {
        deviceId: "tesla-vehicle-1",
        supportedCommandKinds: ["schedule_window"],
        supportedModes: ["charge"],
        minimumCommandWindowMinutes: 15,
        supportsOverlappingWindows: true,
        supportsImmediateExecution: true,
        schemaVersion: "capabilities.v1",
      },
    ]);

    const result = await runControlLoopExecutionService(
      {
        now: NOW,
        systemState: buildSystemState(),
        optimizerOutput: output,
      },
      executor,
      provider,
      undefined,
      journal,
      undefined,
      {
        safeHoldMode: false,
        planFreshnessStatus: "fresh",
        stalePlanReuseCount: 0,
      },
      "continuous_live_strict",
      { cycleId: "cycle-single-edge-1" },
    );

    expect(result.executionResults).toHaveLength(1);
    expect(result.executionResults[0].status).toBe("issued");
    expect(journal.getAll()).toHaveLength(1);
    expect(journal.getCycleHeartbeats()).toHaveLength(1);
    expect(journal.getCycleHeartbeats()[0].commandsIssued).toBe(1);
  });
});