import { describe, expect, it } from "vitest";
import type { SystemState } from "../domain";
import type { OptimizerDecision, OptimizerOutput } from "../domain/optimizer";
import { runControlLoopExecutionService } from "../application/controlLoopExecution/service";
import { InMemoryDeviceCapabilitiesProvider } from "../capabilities/deviceCapabilitiesProvider";
import { InMemoryExecutionJournalStore } from "../journal/executionJournalStore";
import { OctopusAdapter } from "../integrations/octopus/octopusAdapter";
import { SimulatedBatteryAdapter } from "../integrations/simulatedBattery/simulatedBatteryAdapter";
import { createRuntimeValidationAdapterWiring } from "../integrations/runtimeValidation/runtimeValidationAdapterRegistry";

function buildSystemState(): SystemState {
  return {
    siteId: "site-validation",
    capturedAt: "2026-03-16T10:00:00.000Z",
    timezone: "Europe/London",
    devices: [],
    homeLoadW: 1000,
    solarGenerationW: 250,
    batteryPowerW: 0,
    evChargingPowerW: 0,
    gridPowerW: 750,
  };
}

function buildDecision(deviceId: string): OptimizerDecision {
  return {
    decisionId: "decision-battery-1",
    startAt: "2026-03-16T10:00:00.000Z",
    endAt: "2026-03-16T10:30:00.000Z",
    executionWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    action: "charge_battery",
    targetDeviceIds: [deviceId],
    targetDevices: [{ deviceId }],
    reason: "Validation dispatch",
    confidence: 0.8,
  };
}

function buildOutput(deviceId: string): OptimizerOutput {
  return {
    schemaVersion: "optimizer-output.v1.1",
    plannerVersion: "canonical-runtime.v1",
    planId: "plan-validation-1",
    generatedAt: "2026-03-16T10:00:00.000Z",
    planningWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    status: "ok",
    headline: "Validation",
    decisions: [buildDecision(deviceId)],
    opportunities: undefined,
    recommendedCommands: [
      {
        commandId: "cmd-battery-1",
        deviceId,
        issuedAt: "2026-03-16T10:00:00.000Z",
        type: "set_mode",
        mode: "charge",
        effectiveWindow: {
          startAt: "2026-03-16T10:00:00.000Z",
          endAt: "2026-03-16T10:30:00.000Z",
        },
      },
    ],
    summary: {
      expectedImportCostPence: 101,
      expectedExportRevenuePence: 11,
      planningNetRevenueSurplusPence: -90,
    },
    diagnostics: [],
    feasibility: {
      executable: true,
      reasonCodes: ["PLAN_COMPUTED"],
    },
    assumptions: [],
    warnings: [],
    confidence: 0.82,
  };
}

describe("runtime validation adapter wiring integration", () => {
  it("keeps canonical identity/provenance authoritative under hostile command outcomes", async () => {
    const octopus = new OctopusAdapter({
      importRatesUrl: "https://octopus.local/import-rates",
      fetchFn: async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              {
                valid_from: "2026-03-16T10:00:00.000Z",
                valid_to: "2026-03-16T10:30:00.000Z",
                value_inc_vat: 21.4,
              },
            ],
          }),
        } as Response),
    });

    const battery = new SimulatedBatteryAdapter({
      deviceId: "battery-1",
      scenario: "command_rejection_device",
      now: () => new Date("2026-03-16T10:05:00.000Z"),
      random: () => 0.9,
    });

    const { executor, registry } = createRuntimeValidationAdapterWiring([octopus, battery]);
    expect(registry.resolveForTargetDeviceId("battery-1").code).toBe("RESOLVED");

    const journal = new InMemoryExecutionJournalStore();
    const result = await runControlLoopExecutionService(
      {
        now: "2026-03-16T10:05:00.000Z",
        systemState: buildSystemState(),
        optimizerOutput: buildOutput("battery-1"),
      },
      executor,
      new InMemoryDeviceCapabilitiesProvider([
        {
          deviceId: "battery-1",
          supportedCommandKinds: ["set_mode"],
          supportedModes: ["charge", "discharge", "hold"],
          supportsImmediateExecution: true,
          schemaVersion: "capabilities.v1",
        },
      ]),
      undefined,
      journal,
    );

    expect(result.executionResults).toHaveLength(1);
    expect(result.executionResults[0].opportunityId).toContain("plan-validation-1:decision:decision-battery-1:command:cmd-battery-1");
    expect(result.executionResults[0].executionRequestId).not.toBe(result.executionResults[0].opportunityId);
    expect(result.executionResults[0].opportunityProvenance?.kind).toBe("compatibility_canonicalized");

    const entries = journal.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].opportunityId).toBe(result.executionResults[0].opportunityId);
    expect(entries[0].opportunityProvenance?.kind).toBe("compatibility_canonicalized");
    expect(entries[0].status).toBe("failed");
  });
});
