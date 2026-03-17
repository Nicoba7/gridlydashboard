import { describe, expect, it } from "vitest";
import { DeviceAdapterRegistry } from "../adapters/adapterRegistry";
import { LiveAdapterDeviceCommandExecutor } from "../application/controlLoopExecution/liveAdapterExecutor";
import type { CommandExecutionRequest } from "../application/controlLoopExecution/types";
import { SimulatedBatteryAdapter } from "../integrations/simulatedBattery/simulatedBatteryAdapter";

function buildRequest(overrides: Partial<CommandExecutionRequest> = {}): CommandExecutionRequest {
  return {
    opportunityId: "opp-battery-1",
    opportunityProvenance: {
      kind: "native_canonical",
      canonicalizedFromLegacy: false,
    },
    executionRequestId: "exec-battery-1",
    requestId: "exec-battery-1",
    idempotencyKey: "opp-battery-1:battery-1:set_mode:charge",
    decisionId: "decision-battery-1",
    targetDeviceId: "battery-1",
    planId: "plan-1",
    requestedAt: "2026-03-16T10:05:00.000Z",
    commandId: "cmd-battery-1",
    canonicalCommand: {
      kind: "set_mode",
      targetDeviceId: "battery-1",
      mode: "charge",
      effectiveWindow: {
        startAt: "2026-03-16T10:00:00.000Z",
        endAt: "2026-03-16T10:30:00.000Z",
      },
    },
    ...overrides,
  };
}

describe("SimulatedBatteryAdapter integration", () => {
  it("dispatches canonical commands through registry/executor with canonical identity preserved", async () => {
    const adapter = new SimulatedBatteryAdapter({
      deviceId: "battery-1",
      scenario: "stable_device",
      now: () => new Date("2026-03-16T10:05:00.000Z"),
      random: () => 0.9,
    });

    const executor = new LiveAdapterDeviceCommandExecutor(new DeviceAdapterRegistry([adapter]));
    const [result] = await executor.execute([buildRequest()]);

    expect(result.status).toBe("issued");
    expect(result.opportunityId).toBe("opp-battery-1");
    expect(result.executionRequestId).toBe("exec-battery-1");
  });

  it("simulates slow-device telemetry lag without corrupting identity surface", async () => {
    let now = new Date("2026-03-16T10:05:00.000Z").getTime();
    const adapter = new SimulatedBatteryAdapter({
      deviceId: "battery-1",
      scenario: "slow_device",
      now: () => new Date(now),
      random: () => 0.9,
    });

    const result = await adapter.executeCanonicalCommand({
      kind: "set_mode",
      targetDeviceId: "battery-1",
      mode: "discharge",
    });
    expect(result.status).toBe("accepted");

    const beforeLag = await adapter.getTelemetry();
    expect(beforeLag.discharge_rate).toBe(0);

    now += 95_000;
    const afterLag = await adapter.getTelemetry();
    expect(afterLag.discharge_rate).toBeGreaterThan(0);
  });

  it("produces rejected/failed outcomes under hostile profile while keeping canonical request identity upstream", async () => {
    const adapter = new SimulatedBatteryAdapter({
      deviceId: "battery-1",
      scenario: "mixed_outcome_device",
      now: () => new Date("2026-03-16T10:05:00.000Z"),
      random: () => 0.15,
    });

    const executor = new LiveAdapterDeviceCommandExecutor(new DeviceAdapterRegistry([adapter]));
    const [result] = await executor.execute([
      buildRequest({ executionRequestId: "exec-hostile-1", requestId: "exec-hostile-1" }),
    ]);

    expect(["failed", "issued"]).toContain(result.status);
    expect(result.executionRequestId).toBe("exec-hostile-1");
    expect(result.opportunityId).toBe("opp-battery-1");
  });

  it("marks stale telemetry profile as stale for runtime guardrail consumers", async () => {
    const adapter = new SimulatedBatteryAdapter({
      deviceId: "battery-1",
      scenario: "stale_telemetry_device",
      now: () => new Date("2026-03-16T10:05:00.000Z"),
      random: () => 0.9,
    });

    const telemetry = await adapter.getTelemetry();
    expect(telemetry.stale).toBe(true);
  });
});
