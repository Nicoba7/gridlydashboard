import { describe, expect, it } from "vitest";
import { DeviceAdapterRegistry } from "../adapters/adapterRegistry";
import { LiveAdapterDeviceCommandExecutor } from "../application/controlLoopExecution/liveAdapterExecutor";
import type { CommandExecutionRequest } from "../application/controlLoopExecution/types";
import type { CanonicalDeviceCommand } from "../application/controlLoopExecution/canonicalCommand";
import { FakeDeviceAdapter } from "./fakes/FakeDeviceAdapter";

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

describe("LiveAdapterDeviceCommandExecutor", () => {
  it("returns issued result with preserved correlation fields for matching adapter", async () => {
    const adapter = new FakeDeviceAdapter({ supportedDeviceIds: ["battery"] });
    const registry = new DeviceAdapterRegistry([adapter]);
    const executor = new LiveAdapterDeviceCommandExecutor(registry);
    const request = buildRequest();

    const [result] = await executor.execute([request]);

    expect(result.status).toBe("issued");
    expect(result.executionRequestId).toBe(request.executionRequestId);
    expect(result.idempotencyKey).toBe(request.idempotencyKey);
    expect(result.decisionId).toBe(request.decisionId);
    expect(result.targetDeviceId).toBe(request.targetDeviceId);
    expect(result.deviceId).toBe("battery");
  });

  it("maps no-adapter resolution to failed execution result", async () => {
    const registry = new DeviceAdapterRegistry([
      new FakeDeviceAdapter({ supportedDeviceIds: ["ev"] }),
    ]);
    const executor = new LiveAdapterDeviceCommandExecutor(registry);
    const request = buildRequest();

    const [result] = await executor.execute([request]);

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("NO_ADAPTER_FOUND");
    expect(result.executionRequestId).toBe(request.executionRequestId);
  });

  it("maps multiple-adapter resolution to failed execution result", async () => {
    const first = new FakeDeviceAdapter({ supportedDeviceIds: ["battery"] });
    const second = new FakeDeviceAdapter({ supportedDeviceIds: ["battery"] });
    const registry = new DeviceAdapterRegistry([first, second]);
    const executor = new LiveAdapterDeviceCommandExecutor(registry);
    const request = buildRequest();

    const [result] = await executor.execute([request]);

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("MULTIPLE_ADAPTERS_FOUND");
    expect(result.executionRequestId).toBe(request.executionRequestId);
  });

  it("returns correlated result for each request in a batch", async () => {
    const batteryAdapter = new FakeDeviceAdapter({ supportedDeviceIds: ["battery"] });
    const evAdapter = new FakeDeviceAdapter({ supportedDeviceIds: ["ev"] });
    const registry = new DeviceAdapterRegistry([batteryAdapter, evAdapter]);
    const executor = new LiveAdapterDeviceCommandExecutor(registry);

    const firstRequest = buildRequest({
      executionRequestId: "exec-battery",
      requestId: "exec-battery",
      commandId: "cmd-battery",
      canonicalCommand: buildCanonicalCommand({ targetDeviceId: "battery" }),
      targetDeviceId: "battery",
    });
    const secondRequest = buildRequest({
      executionRequestId: "exec-ev",
      requestId: "exec-ev",
      commandId: "cmd-ev",
      canonicalCommand: buildCanonicalCommand({ targetDeviceId: "ev" }),
      targetDeviceId: "ev",
      idempotencyKey: "decision-1:ev:set_mode:charge:2026-03-16T10:00:00.000Z:2026-03-16T10:30:00.000Z",
    });

    const results = await executor.execute([firstRequest, secondRequest]);

    expect(results).toHaveLength(2);
    expect(results[0].executionRequestId).toBe("exec-battery");
    expect(results[1].executionRequestId).toBe("exec-ev");
    expect(results[0].status).toBe("issued");
    expect(results[1].status).toBe("issued");
  });

  it("dispatches canonical command payload unchanged", async () => {
    const adapter = new FakeDeviceAdapter({ supportedDeviceIds: ["battery"] });
    const registry = new DeviceAdapterRegistry([adapter]);
    const executor = new LiveAdapterDeviceCommandExecutor(registry);
    const canonicalCommand = buildCanonicalCommand({ mode: "discharge" });
    const request = buildRequest({ canonicalCommand, targetDeviceId: "battery" });

    await executor.execute([request]);

    expect(adapter.received).toHaveLength(1);
    expect(adapter.received[0].command).toBe(canonicalCommand);
  });
});
