import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  ContinuousRuntimeIntegration,
  AveumContinuousRuntimeSource,
} from "../application/runtime/runContinuousRuntime";
import { runContinuousRuntime } from "../application/runtime/runContinuousRuntime";
import { runControlLoopExecutionService } from "../application/controlLoopExecution/service";
import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  DeviceCommandExecutor,
} from "../application/controlLoopExecution/types";
import type { OptimizerOutput } from "../domain/optimizer";
import { FileExecutionJournalStore } from "../journal/fileExecutionJournalStore";

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function buildPlan(commandDeviceId: string): OptimizerOutput {
  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: "plan-generic-runtime",
    generatedAt: "2026-03-16T10:00:00.000Z",
    planningWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    status: "ok",
    headline: "Generic runtime plan",
    decisions: [
      {
        decisionId: "decision-1",
        startAt: "2026-03-16T10:00:00.000Z",
        endAt: "2026-03-16T10:30:00.000Z",
        executionWindow: {
          startAt: "2026-03-16T10:00:00.000Z",
          endAt: "2026-03-16T10:30:00.000Z",
        },
        action: "charge_battery",
        targetDeviceIds: [commandDeviceId],
        targetDevices: [{ deviceId: commandDeviceId, kind: "battery", requiredCapabilities: ["set_mode"] }],
        reason: "Charge battery in cheap interval",
        confidence: 0.83,
      },
    ],
    recommendedCommands: [
      {
        commandId: "cmd-1",
        deviceId: commandDeviceId,
        issuedAt: "2026-03-16T10:05:00.000Z",
        type: "set_mode",
        mode: "charge",
        effectiveWindow: {
          startAt: "2026-03-16T10:00:00.000Z",
          endAt: "2026-03-16T10:30:00.000Z",
        },
      },
    ],
    summary: {
      expectedImportCostPence: 80,
      expectedExportRevenuePence: 0,
      planningNetRevenueSurplusPence: -80,
    },
    diagnostics: [],
    feasibility: { executable: true, reasonCodes: ["PLAN_COMPUTED"] },
    assumptions: [],
    warnings: [],
    confidence: 0.83,
  };
}

function buildGenericIntegration(options: {
  journalStore: FileExecutionJournalStore;
  executor: DeviceCommandExecutor;
  omitRuntimeContext?: boolean;
}): ContinuousRuntimeIntegration<AveumContinuousRuntimeSource> {
  const plan = buildPlan("battery-1");

  return {
    async prepare({ runtimeExecutionMode }) {
      return {
        cycleExecutor: {
          buildPlan: async () => plan,
          execute: async (ctx) => {
            const execution = await runControlLoopExecutionService(
              {
                now: ctx.nowIso,
                systemState: {
                  siteId: "site-1",
                  capturedAt: ctx.nowIso,
                  timezone: "Europe/London",
                  devices: [
                    {
                      deviceId: "battery-1",
                      kind: "battery",
                      brand: "Generic",
                      name: "Generic Battery",
                      connectionStatus: "online",
                      lastUpdatedAt: ctx.nowIso,
                      capabilities: ["set_mode"],
                    },
                  ],
                  homeLoadW: 1200,
                  solarGenerationW: 0,
                  batteryPowerW: 0,
                  evChargingPowerW: 0,
                  gridPowerW: 1200,
                },
                optimizerOutput: plan,
              },
              options.executor,
              undefined,
              undefined,
              options.journalStore,
              {
                optimizationMode: "balanced",
                valueLedger: {
                  optimizationMode: "balanced",
                  estimatedImportCostPence: 80,
                  estimatedExportRevenuePence: 0,
                  estimatedBatteryDegradationCostPence: 1,
                  estimatedNetCostPence: 81,
                  baselineType: "hold_current_state",
                  baselineNetCostPence: 92,
                  baselineImportCostPence: 92,
                  baselineExportRevenuePence: 0,
                  baselineBatteryDegradationCostPence: 0,
                  estimatedSavingsVsBaselinePence: 11,
                  assumptions: [],
                  caveats: [],
                  confidence: 0.8,
                },
              },
              options.omitRuntimeContext
                ? undefined
                : {
                    safeHoldMode: ctx.safeHoldMode,
                    planFreshnessStatus: ctx.planFreshnessStatus,
                    replanTrigger: ctx.replanTrigger,
                    stalePlanReuseCount: ctx.stalePlanReuseCount,
                    stalePlanWarning: ctx.stalePlanWarning,
                  },
              runtimeExecutionMode,
              { cycleId: ctx.cycleId, replanReason: ctx.replanReason },
            );

            return {
              cycleId: ctx.cycleId,
              nowIso: ctx.nowIso,
              status: "ok" as const,
              replanRequired: execution.controlLoopResult.replanRequired,
              issuedCommandCount: execution.executionResults.filter((x) => x.status === "issued").length,
              skippedCommandCount: execution.executionResults.filter((x) => x.status === "skipped").length,
              failedCommandCount: execution.executionResults.filter((x) => x.status === "failed").length,
              journalEntriesWritten: execution.executionResults.length,
              planAgeSeconds: ctx.planAgeSeconds,
              planFreshnessStatus: ctx.planFreshnessStatus,
              replanTriggered: ctx.replanTriggered,
              replanTrigger: ctx.replanTrigger,
              replanReason: ctx.replanReason,
              stalePlanReuseCount: ctx.stalePlanReuseCount,
            };
          },
        },
      };
    },
  };
}

describe("runContinuousRuntime", () => {
  it("runs a continuous cycle and persists durable journal + heartbeat + economic snapshot", async () => {
    const dir = createTempDir("gridly-generic-runtime-");

    try {
      const journalStore = new FileExecutionJournalStore({ directoryPath: dir });
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

      const runtime = await runContinuousRuntime({
        source: {
          GRIDLY_SITE_ID: "site-1",
          GRIDLY_CONTINUOUS_MAX_CYCLES: "1",
        },
        integration: buildGenericIntegration({ journalStore, executor }),
        launcherDependencies: {
          journalStore,
          nowFn: () => new Date("2026-03-16T10:05:00.000Z"),
        },
      });

      await runtime.start();

      const entries = journalStore.getAll();
      const heartbeats = journalStore.getCycleHeartbeats();
      expect(entries).toHaveLength(1);
      expect(heartbeats).toHaveLength(1);
      expect(heartbeats[0].economicSnapshot?.estimatedSavingsVsBaselinePence).toBe(11);

      const reloaded = new FileExecutionJournalStore({ directoryPath: dir });
      expect(reloaded.getAll()).toHaveLength(1);
      expect(reloaded.getCycleHeartbeats()).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps strict fail-closed suppression and still records heartbeat in generic runtime", async () => {
    const dir = createTempDir("gridly-generic-fail-closed-");

    try {
      const journalStore = new FileExecutionJournalStore({ directoryPath: dir });
      const executor: DeviceCommandExecutor = {
        execute: vi.fn(async () => []),
      };

      const runtime = await runContinuousRuntime({
        source: {
          GRIDLY_SITE_ID: "site-1",
          GRIDLY_CONTINUOUS_MAX_CYCLES: "1",
        },
        integration: buildGenericIntegration({ journalStore, executor, omitRuntimeContext: true }),
        launcherDependencies: {
          journalStore,
          nowFn: () => new Date("2026-03-16T10:05:00.000Z"),
        },
      });

      await runtime.start();

      const entries = journalStore.getAll();
      const heartbeats = journalStore.getCycleHeartbeats();

      expect(entries).toHaveLength(1);
      expect(entries[0].reasonCodes).toContain("RUNTIME_CONTEXT_MISSING");
      expect(heartbeats).toHaveLength(1);
      expect(heartbeats[0].failClosedTriggered).toBe(true);
      expect(heartbeats[0].commandsSuppressed).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps canonical launcher Tesla-free", () => {
    const source = readFileSync("src/application/runtime/runContinuousRuntime.ts", "utf8");
    expect(source.toLowerCase()).not.toContain("tesla");
  });
});