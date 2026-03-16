import { describe, expect, it } from "vitest";
import { DeviceAdapterRegistry } from "../adapters/adapterRegistry";
import type { CanonicalDeviceCommand } from "../application/controlLoopExecution/canonicalCommand";
import { FakeDeviceAdapter } from "./fakes/FakeDeviceAdapter";

function buildCanonicalCommand(overrides?: Partial<CanonicalDeviceCommand>): CanonicalDeviceCommand {
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

describe("DeviceAdapterRegistry", () => {
  it("dispatches to a single matching adapter", async () => {
    const batteryAdapter = new FakeDeviceAdapter({ supportedDeviceIds: ["battery"] });
    const evAdapter = new FakeDeviceAdapter({ supportedDeviceIds: ["ev"] });
    const registry = new DeviceAdapterRegistry([batteryAdapter, evAdapter]);
    const command = buildCanonicalCommand();

    const result = await registry.dispatchCanonicalCommand(command, {
      executionRequestId: "req-1",
      idempotencyKey: "key-1",
    });

    expect(result.status).toBe("accepted");
    expect(result.canonicalCommand).toBe(command);
    expect(batteryAdapter.received).toHaveLength(1);
    expect(evAdapter.received).toHaveLength(0);
  });

  it("returns canonical rejected result when no adapter matches", async () => {
    const registry = new DeviceAdapterRegistry([
      new FakeDeviceAdapter({ supportedDeviceIds: ["ev"] }),
    ]);
    const command = buildCanonicalCommand({ targetDeviceId: "battery" });

    const result = await registry.dispatchCanonicalCommand(command);

    expect(result.status).toBe("rejected");
    expect(result.failureReasonCode).toBe("NO_ADAPTER_FOUND");
    expect(result.canonicalCommand).toBe(command);
  });

  it("returns canonical failure result when multiple adapters match", async () => {
    const first = new FakeDeviceAdapter({ supportedDeviceIds: ["battery"] });
    const second = new FakeDeviceAdapter({ supportedDeviceIds: ["battery"] });
    const registry = new DeviceAdapterRegistry([first, second]);
    const command = buildCanonicalCommand();

    const result = await registry.dispatchCanonicalCommand(command);

    expect(result.status).toBe("failed");
    expect(result.failureReasonCode).toBe("MULTIPLE_ADAPTERS_FOUND");
    expect(first.received).toHaveLength(0);
    expect(second.received).toHaveLength(0);
  });

  it("passes canonical command through unchanged", async () => {
    const batteryAdapter = new FakeDeviceAdapter({ supportedDeviceIds: ["battery"] });
    const registry = new DeviceAdapterRegistry([batteryAdapter]);
    const command = buildCanonicalCommand({ mode: "discharge" });

    await registry.dispatchCanonicalCommand(command);

    expect(batteryAdapter.received).toHaveLength(1);
    expect(batteryAdapter.received[0].command).toBe(command);
  });
});
