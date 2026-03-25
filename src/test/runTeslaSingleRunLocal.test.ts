import { describe, expect, it } from "vitest";
import type { DeviceState, OptimizerOutput, SystemState } from "../domain";
import { TeslaSingleRunBootstrapError } from "../application/runtime/teslaSingleRunBootstrap";
import { runTeslaSingleRunLocal } from "../application/runtime/runTeslaSingleRunLocal";

function buildSystemState(): SystemState {
  const devices: DeviceState[] = [
    {
      deviceId: "battery-1",
      kind: "battery",
      brand: "GivEnergy",
      name: "Home Battery",
      connectionStatus: "online",
      lastUpdatedAt: "2026-03-16T10:00:00.000Z",
      capabilities: ["read_soc", "read_power"],
    },
  ];

  return {
    siteId: "site-1",
    capturedAt: "2026-03-16T10:00:00.000Z",
    timezone: "Europe/London",
    devices,
    homeLoadW: 2200,
    solarGenerationW: 1200,
    batteryPowerW: -500,
    evChargingPowerW: 0,
    gridPowerW: 1500,
    batterySocPercent: 62,
    batteryCapacityKwh: 13.5,
    evConnected: false,
  };
}

function buildOptimizerOutput(): OptimizerOutput {
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
    headline: "Test plan",
    decisions: [],
    recommendedCommands: [],
    summary: {
      expectedImportCostPence: 100,
      expectedExportRevenuePence: 0,
      planningNetRevenueSurplusPence: -100,
    },
    diagnostics: [],
    feasibility: {
      executable: true,
      reasonCodes: ["PLAN_COMPUTED"],
    },
    assumptions: [],
    warnings: [],
    confidence: 0.8,
  };
}

describe("runTeslaSingleRunLocal", () => {
  it("returns structured success summary, binds tesla vehicle id, and threads optimization mode", async () => {
    let capturedDevices: DeviceState[] = [];
    let capturedMode: string | undefined;

    const summary = await runTeslaSingleRunLocal(
      {
        TESLA_ACCESS_TOKEN: "token-123",
        TESLA_VEHICLE_ID: "tesla-vehicle-1",
        GRIDLY_NOW_ISO: "2026-03-16T10:05:00.000Z",
        GRIDLY_PLANNING_STYLE: "cheapest",
      },
      {
        bootstrapFromSource: () => ({
          config: {
            accessToken: "token-123",
            vehicleId: "tesla-vehicle-1",
            timeoutMs: 10_000,
          },
          teslaAdapter: {} as never,
          observedStateStore: {} as never,
          executor: {} as never,
          runCycle: async (input) => {
            capturedDevices = input.devices;
            return {
              telemetryIngestionResult: {
                ingestedCount: 1,
                updatedStates: [],
                outcomes: [],
                acceptedCount: 1,
                ignoredStaleCount: 0,
                ignoredDuplicateCount: 0,
                rejectedInvalidCount: 0,
              },
              controlLoopResult: {
                activeDecisions: [],
                activeOpportunities: [],
                commandsToIssue: [],
                skippedDecisions: [],
                replanRequired: true,
                reasons: ["NO_ACTIVE_DECISIONS"],
              },
              executionResults: [],
              executionSummary: {
                total: 0,
                issued: 0,
                skipped: 0,
                failed: 0,
              },
            };
          },
        }),
        getSnapshot: () => ({
          systemState: buildSystemState(),
          forecasts: {
            generatedAt: "2026-03-16T10:00:00.000Z",
            horizonStartAt: "2026-03-16T10:00:00.000Z",
            horizonEndAt: "2026-03-17T10:00:00.000Z",
            slotDurationMinutes: 30,
            householdLoadKwh: [],
            solarGenerationKwh: [],
            carbonIntensity: [],
          },
          tariffSchedule: {
            tariffId: "tariff-1",
            provider: "Aveum",
            name: "Synthetic",
            currency: "GBP",
            updatedAt: "2026-03-16T10:00:00.000Z",
            importRates: [],
            exportRates: [],
          },
        }),
        resolveTariffSchedule: async ({ fallbackTariffSchedule }) => ({
          tariffSchedule: fallbackTariffSchedule,
          source: "simulated",
          caveats: ["test simulated tariff"],
        }),
        optimizeInput: (input) => {
          capturedMode = input.constraints.mode;
          return buildOptimizerOutput();
        },
      },
    );

    expect(summary.status).toBe("ok");
    if (summary.status !== "ok") {
      throw new Error("expected success summary");
    }

    expect(summary.telemetryIngestionResult.acceptedCount).toBe(1);
    expect(summary.controlLoopResultSummary.reasons).toEqual(["NO_ACTIVE_DECISIONS"]);
    expect(summary.executionSummary.total).toBe(0);
    expect(capturedDevices.some((device) => device.deviceId === "tesla-vehicle-1")).toBe(true);
    expect(summary.planningStyle.activeStyle).toBe("cheapest");
    expect(summary.planningStyle.source).toBe("env");
    expect(summary.optimizationMode.activeMode).toBe("cost");
    expect(summary.optimizationMode.defaulted).toBe(false);
    expect(capturedMode).toBe("cost");
    expect(summary.valueLedger.optimizationMode).toBe("cost");
    expect(summary.valueLedger.baselineType).toBe("hold_current_state");
    expect(summary.tariffForecastSummary.source).toBe("simulated");
    expect(Array.isArray(summary.executionJournalEntries)).toBe(true);
    expect(summary.executionJournalEntries).toHaveLength(0);
  });

  it("defaults invalid GRIDLY_OPTIMIZATION_MODE to balanced", async () => {
    let capturedMode: string | undefined;

    const summary = await runTeslaSingleRunLocal(
      {
        TESLA_ACCESS_TOKEN: "token-123",
        TESLA_VEHICLE_ID: "tesla-vehicle-1",
        GRIDLY_OPTIMIZATION_MODE: "fastest-money",
      },
      {
        bootstrapFromSource: () => ({
          config: {
            accessToken: "token-123",
            vehicleId: "tesla-vehicle-1",
            timeoutMs: 10_000,
          },
          teslaAdapter: {} as never,
          observedStateStore: {} as never,
          executor: {} as never,
          runCycle: async () => ({
            telemetryIngestionResult: {
              ingestedCount: 1,
              updatedStates: [],
              outcomes: [],
              acceptedCount: 1,
              ignoredStaleCount: 0,
              ignoredDuplicateCount: 0,
              rejectedInvalidCount: 0,
            },
            controlLoopResult: {
              activeDecisions: [],
              activeOpportunities: [],
              commandsToIssue: [],
              skippedDecisions: [],
              replanRequired: true,
              reasons: ["NO_ACTIVE_DECISIONS"],
            },
            executionResults: [],
            executionSummary: {
              total: 0,
              issued: 0,
              skipped: 0,
              failed: 0,
            },
          }),
        }),
        getSnapshot: () => ({
          systemState: buildSystemState(),
          forecasts: {
            generatedAt: "2026-03-16T10:00:00.000Z",
            horizonStartAt: "2026-03-16T10:00:00.000Z",
            horizonEndAt: "2026-03-17T10:00:00.000Z",
            slotDurationMinutes: 30,
            householdLoadKwh: [],
            solarGenerationKwh: [],
            carbonIntensity: [],
          },
          tariffSchedule: {
            tariffId: "tariff-1",
            provider: "Aveum",
            name: "Synthetic",
            currency: "GBP",
            updatedAt: "2026-03-16T10:00:00.000Z",
            importRates: [],
            exportRates: [],
          },
        }),
        resolveTariffSchedule: async ({ fallbackTariffSchedule }) => ({
          tariffSchedule: fallbackTariffSchedule,
          source: "simulated",
          caveats: ["test simulated tariff"],
        }),
        optimizeInput: (input) => {
          capturedMode = input.constraints.mode;
          return buildOptimizerOutput();
        },
      },
    );

    expect(summary.status).toBe("ok");
    if (summary.status !== "ok") {
      throw new Error("expected success summary");
    }

    expect(summary.optimizationMode.activeMode).toBe("balanced");
    expect(summary.optimizationMode.defaulted).toBe(true);
    expect(summary.optimizationMode.requestedMode).toBe("fastest-money");
    expect(summary.planningStyle?.activeStyle).toBe("balanced");
    expect(capturedMode).toBe("balanced");
  });

  it("reports import and export tariff counts in runtime output summary", async () => {
    const summary = await runTeslaSingleRunLocal(
      {
        TESLA_ACCESS_TOKEN: "token-123",
        TESLA_VEHICLE_ID: "tesla-vehicle-1",
      },
      {
        bootstrapFromSource: () => ({
          config: {
            accessToken: "token-123",
            vehicleId: "tesla-vehicle-1",
            timeoutMs: 10_000,
          },
          teslaAdapter: {} as never,
          observedStateStore: {} as never,
          executor: {} as never,
          runCycle: async () => ({
            telemetryIngestionResult: {
              ingestedCount: 1,
              updatedStates: [],
              outcomes: [],
              acceptedCount: 1,
              ignoredStaleCount: 0,
              ignoredDuplicateCount: 0,
              rejectedInvalidCount: 0,
            },
            controlLoopResult: {
              activeDecisions: [],
              activeOpportunities: [],
              commandsToIssue: [],
              skippedDecisions: [],
              replanRequired: true,
              reasons: ["NO_ACTIVE_DECISIONS"],
            },
            executionResults: [],
            executionSummary: {
              total: 0,
              issued: 0,
              skipped: 0,
              failed: 0,
            },
          }),
        }),
        getSnapshot: () => ({
          systemState: buildSystemState(),
          forecasts: {
            generatedAt: "2026-03-16T10:00:00.000Z",
            horizonStartAt: "2026-03-16T10:00:00.000Z",
            horizonEndAt: "2026-03-17T10:00:00.000Z",
            slotDurationMinutes: 30,
            householdLoadKwh: [],
            solarGenerationKwh: [],
            carbonIntensity: [],
          },
          tariffSchedule: {
            tariffId: "tariff-1",
            provider: "Aveum",
            name: "Synthetic",
            currency: "GBP",
            updatedAt: "2026-03-16T10:00:00.000Z",
            importRates: [],
            exportRates: [],
          },
        }),
        resolveTariffSchedule: async () => ({
          source: "octopus_live",
          caveats: ["using live tariffs"],
          tariffSchedule: {
            tariffId: "octopus-agile-c",
            provider: "Octopus",
            name: "Agile",
            currency: "GBP",
            updatedAt: "2026-03-16T10:00:00.000Z",
            importRates: [
              {
                startAt: "2026-03-16T10:00:00.000Z",
                endAt: "2026-03-16T10:30:00.000Z",
                unitRatePencePerKwh: 18.2,
                source: "live",
              },
            ],
            exportRates: [
              {
                startAt: "2026-03-16T10:00:00.000Z",
                endAt: "2026-03-16T10:30:00.000Z",
                unitRatePencePerKwh: 11.4,
                source: "live",
              },
            ],
          },
        }),
        optimizeInput: () => buildOptimizerOutput(),
      },
    );

    expect(summary.status).toBe("ok");
    if (summary.status !== "ok") {
      throw new Error("expected success summary");
    }

    expect(summary.tariffForecastSummary.source).toBe("octopus_live");
    expect(summary.tariffForecastSummary.importRateCount).toBe(1);
    expect(summary.tariffForecastSummary.exportRateCount).toBe(1);
  });

  it("emits concrete Tesla vehicle IDs in optimizer commands for runtime execution", async () => {
    let capturedOptimizerOutput: OptimizerOutput | undefined;

    const summary = await runTeslaSingleRunLocal(
      {
        TESLA_ACCESS_TOKEN: "token-123",
        TESLA_VEHICLE_ID: "tesla-vehicle-1",
        GRIDLY_NOW_ISO: "2026-03-16T10:05:00.000Z",
      },
      {
        bootstrapFromSource: () => ({
          config: {
            accessToken: "token-123",
            vehicleId: "tesla-vehicle-1",
            timeoutMs: 10_000,
          },
          teslaAdapter: {} as never,
          observedStateStore: {} as never,
          executor: {} as never,
          runCycle: async (input) => {
            capturedOptimizerOutput = input.optimizerOutput;
            return {
              telemetryIngestionResult: {
                ingestedCount: 1,
                updatedStates: [],
                outcomes: [],
                acceptedCount: 1,
                ignoredStaleCount: 0,
                ignoredDuplicateCount: 0,
                rejectedInvalidCount: 0,
              },
              controlLoopResult: {
                activeDecisions: [],
                activeOpportunities: [],
                commandsToIssue: [],
                skippedDecisions: [],
                replanRequired: true,
                reasons: ["NO_ACTIVE_DECISIONS"],
              },
              executionResults: [],
              executionSummary: {
                total: 0,
                issued: 0,
                skipped: 0,
                failed: 0,
              },
            };
          },
        }),
        getSnapshot: () => ({
          systemState: {
            siteId: "site-1",
            capturedAt: "2026-03-16T10:00:00.000Z",
            timezone: "Europe/London",
            devices: [
              {
                deviceId: "ev-generic-1",
                kind: "ev_charger",
                brand: "Generic",
                name: "EV Charger",
                connectionStatus: "online",
                lastUpdatedAt: "2026-03-16T10:00:00.000Z",
                capabilities: ["schedule_window", "start_stop"],
                capacityKwh: 60,
              },
              {
                deviceId: "grid-1",
                kind: "smart_meter",
                brand: "Octopus",
                name: "Grid",
                connectionStatus: "online",
                lastUpdatedAt: "2026-03-16T10:00:00.000Z",
                capabilities: ["read_tariff", "read_power"],
              },
            ],
            homeLoadW: 1000,
            solarGenerationW: 0,
            batteryPowerW: 0,
            evChargingPowerW: 0,
            gridPowerW: 1000,
            evConnected: true,
            evSocPercent: 20,
          },
          forecasts: {
            generatedAt: "2026-03-16T10:00:00.000Z",
            horizonStartAt: "2026-03-16T10:00:00.000Z",
            horizonEndAt: "2026-03-16T10:30:00.000Z",
            slotDurationMinutes: 30,
            householdLoadKwh: [
              {
                startAt: "2026-03-16T10:00:00.000Z",
                endAt: "2026-03-16T10:30:00.000Z",
                value: 1,
                confidence: 0.9,
              },
            ],
            solarGenerationKwh: [
              {
                startAt: "2026-03-16T10:00:00.000Z",
                endAt: "2026-03-16T10:30:00.000Z",
                value: 0,
                confidence: 0.9,
              },
            ],
            carbonIntensity: [
              {
                startAt: "2026-03-16T10:00:00.000Z",
                endAt: "2026-03-16T10:30:00.000Z",
                value: 200,
                confidence: 0.9,
              },
            ],
          },
          tariffSchedule: {
            tariffId: "tariff-1",
            provider: "Aveum",
            name: "Synthetic",
            currency: "GBP",
            updatedAt: "2026-03-16T10:00:00.000Z",
            importRates: [
              {
                startAt: "2026-03-16T10:00:00.000Z",
                endAt: "2026-03-16T10:30:00.000Z",
                unitRatePencePerKwh: 10,
                source: "live",
              },
            ],
            exportRates: [
              {
                startAt: "2026-03-16T10:00:00.000Z",
                endAt: "2026-03-16T10:30:00.000Z",
                unitRatePencePerKwh: 5,
                source: "live",
              },
            ],
          },
        }),
        resolveTariffSchedule: async ({ fallbackTariffSchedule }) => ({
          tariffSchedule: fallbackTariffSchedule,
          source: "simulated",
          caveats: ["test simulated tariff"],
        }),
      },
    );

    expect(summary.status).toBe("ok");
    if (summary.status !== "ok") {
      throw new Error("expected success summary");
    }

    const evDecision = capturedOptimizerOutput?.decisions.find((decision) => decision.action === "charge_ev");
    expect(evDecision).toBeDefined();
    expect(evDecision?.targetDeviceIds).toEqual(["tesla-vehicle-1"]);
    expect(capturedOptimizerOutput?.recommendedCommands[0]?.deviceId).toBe("tesla-vehicle-1");
  });

  it("returns bootstrap error summary with explicit code", async () => {
    const summary = await runTeslaSingleRunLocal(
      {
        TESLA_VEHICLE_ID: "tesla-vehicle-1",
      },
      {
        bootstrapFromSource: () => {
          throw new TeslaSingleRunBootstrapError("MISSING_ACCESS_TOKEN", "TESLA_ACCESS_TOKEN is required.");
        },
      },
    );

    expect(summary.status).toBe("error");
    if (summary.status !== "error") {
      throw new Error("expected error summary");
    }

    expect(summary.error.stage).toBe("bootstrap");
    expect(summary.error.code).toBe("MISSING_ACCESS_TOKEN");
  });

  it("returns runtime error summary when cycle invocation fails", async () => {
    const summary = await runTeslaSingleRunLocal(
      {
        TESLA_ACCESS_TOKEN: "token-123",
        TESLA_VEHICLE_ID: "tesla-vehicle-1",
      },
      {
        bootstrapFromSource: () => ({
          config: {
            accessToken: "token-123",
            vehicleId: "tesla-vehicle-1",
            timeoutMs: 10_000,
          },
          teslaAdapter: {} as never,
          observedStateStore: {} as never,
          executor: {} as never,
          runCycle: async () => {
            throw new Error("telemetry unavailable");
          },
        }),
        getSnapshot: () => ({
          systemState: buildSystemState(),
          forecasts: {
            generatedAt: "2026-03-16T10:00:00.000Z",
            horizonStartAt: "2026-03-16T10:00:00.000Z",
            horizonEndAt: "2026-03-17T10:00:00.000Z",
            slotDurationMinutes: 30,
            householdLoadKwh: [],
            solarGenerationKwh: [],
            carbonIntensity: [],
          },
          tariffSchedule: {
            tariffId: "tariff-1",
            provider: "Aveum",
            name: "Synthetic",
            currency: "GBP",
            updatedAt: "2026-03-16T10:00:00.000Z",
            importRates: [],
            exportRates: [],
          },
        }),
        resolveTariffSchedule: async ({ fallbackTariffSchedule }) => ({
          tariffSchedule: fallbackTariffSchedule,
          source: "simulated",
          caveats: ["test simulated tariff"],
        }),
        optimizeInput: () => buildOptimizerOutput(),
      },
    );

    expect(summary.status).toBe("error");
    if (summary.status !== "error") {
      throw new Error("expected error summary");
    }

    expect(summary.error.stage).toBe("runtime");
    expect(summary.error.message).toBe("telemetry unavailable");
  });

  it("returns runtime error summary for invalid GRIDLY_NOW_ISO", async () => {
    const summary = await runTeslaSingleRunLocal({
      TESLA_ACCESS_TOKEN: "token-123",
      TESLA_VEHICLE_ID: "tesla-vehicle-1",
      GRIDLY_NOW_ISO: "not-an-iso-date",
    });

    expect(summary.status).toBe("error");
    if (summary.status !== "error") {
      throw new Error("expected error summary");
    }

    expect(summary.error.stage).toBe("runtime");
    expect(summary.error.message).toBe("GRIDLY_NOW_ISO must be a valid ISO-8601 timestamp.");
  });
});
