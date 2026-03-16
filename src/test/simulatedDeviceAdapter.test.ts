import { describe, expect, it } from "vitest";
import { DeviceAdapterRegistry } from "../adapters/adapterRegistry";
import { SimulatedDeviceAdapter } from "../adapters/simulated/SimulatedDeviceAdapter";
import type { CanonicalDeviceCommand } from "../application/controlLoopExecution/canonicalCommand";
import { LiveAdapterDeviceCommandExecutor } from "../application/controlLoopExecution/liveAdapterExecutor";
import type { CommandExecutionRequest } from "../application/controlLoopExecution/types";

function buildCanonicalCommand(
  overrides?: Partial<CanonicalDeviceCommand>,
): CanonicalDeviceCommand {
  return {
    kind: "set_mode",
    targetDeviceId: "battery",
    effectiveWindow: {
      startAt: "2026-03-16T10:00:00.000Z",
      endAt: "2026-03-16T10:30:00.000Z",
    },
    mode: "charge",
    ...overrides,
  } as CanonicalDeviceCommand;
}

function buildRequest(overrides?: Partial<CommandExecutionRequest>): CommandExecutionRequest {
  const canonicalCommand = overrides?.canonicalCommand ?? buildCanonicalCommand();

  return {
    executionRequestId: "exec-1",
    requestId: "exec-1",
    idempotencyKey: "decision-1:battery:set_mode:charge:2026-03-16T10:00:00.000Z:2026-03-16T10:30:00.000Z",
    decisionId: "decision-1",
    targetDeviceId: canonicalCommand.targetDeviceId,
    planId: "plan-1",
    requestedAt: "2026-03-16T10:00:00.000Z",
    commandId: "cmd-1",
    canonicalCommand,
    ...overrides,
  };
}

describe("SimulatedDeviceAdapter", () => {
  it("receives routed commands through registry", async () => {
    const adapter = new SimulatedDeviceAdapter({ supportedDeviceIds: ["battery"] });
    const registry = new DeviceAdapterRegistry([adapter]);
    const command = buildCanonicalCommand();

    const result = await registry.dispatchCanonicalCommand(command, {
      executionRequestId: "exec-1",
      idempotencyKey: "idem-1",
    });

    expect(result.status).toBe("accepted");
    const state = adapter.getDeviceState("battery");
    expect(state?.lastCommandKind).toBe("set_mode");
    expect(state?.lastMode).toBe("charge");
  });

  it("updates simulated state from canonical command execution", async () => {
    const adapter = new SimulatedDeviceAdapter({ supportedDeviceIds: ["battery"] });
    const registry = new DeviceAdapterRegistry([adapter]);
    const executor = new LiveAdapterDeviceCommandExecutor(registry);

    const request = buildRequest({
      canonicalCommand: buildCanonicalCommand({ kind: "set_power_limit", powerW: 3200 }),
      idempotencyKey: "idem-power-1",
      commandId: "cmd-power-1",
      targetDeviceId: "battery",
    });

    const [result] = await executor.execute([request]);

    expect(result.status).toBe("issued");
    const state = adapter.getDeviceState("battery");
    expect(state?.lastCommandKind).toBe("set_power_limit");
    expect(state?.lastPowerW).toBe(3200);
    expect(state?.commandCount).toBe(1);
  });

  it("returns canonical rejected result for unsupported command kinds", async () => {
    const adapter = new SimulatedDeviceAdapter({
      supportedDeviceIds: ["battery"],
      supportedCommandKinds: ["set_mode"],
    });
    const registry = new DeviceAdapterRegistry([adapter]);

    const result = await registry.dispatchCanonicalCommand(
      buildCanonicalCommand({ kind: "set_power_limit", powerW: 2500 }),
    );

    expect(result.status).toBe("rejected");
    expect(result.failureReasonCode).toBe("INVALID_COMMAND");
    expect(adapter.getDeviceState("battery")).toBeUndefined();
  });

  it("respects idempotency for repeated commands", async () => {
    const adapter = new SimulatedDeviceAdapter({ supportedDeviceIds: ["battery"] });
    const registry = new DeviceAdapterRegistry([adapter]);
    const executor = new LiveAdapterDeviceCommandExecutor(registry);

    const firstRequest = buildRequest({
      executionRequestId: "exec-a",
      requestId: "exec-a",
      commandId: "cmd-a",
      idempotencyKey: "idem-repeat-1",
    });

    const secondRequest = buildRequest({
      executionRequestId: "exec-b",
      requestId: "exec-b",
      commandId: "cmd-b",
      idempotencyKey: "idem-repeat-1",
    });

    const results = await executor.execute([firstRequest, secondRequest]);

    expect(results[0].status).toBe("issued");
    expect(results[1].status).toBe("issued");
    const state = adapter.getDeviceState("battery");
    expect(state?.commandCount).toBe(1);
    expect(state?.lastIdempotencyKey).toBe("idem-repeat-1");
  });
});
