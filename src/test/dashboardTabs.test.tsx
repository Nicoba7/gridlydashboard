import { render, screen, fireEvent, act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SimplifiedDashboard from "../pages/SimplifiedDashboard";
import { setLatestCycleHeartbeat, pushRecentExecutionOutcomes } from "../journal/latestCycleHeartbeatSource";

afterEach(() => {
  act(() => {
    setLatestCycleHeartbeat(undefined);
  });
});

describe("SimplifiedDashboard tabs", () => {
  it("renders Home, Plan, and History without crashing", () => {
    render(<SimplifiedDashboard />);

    expect(screen.getByText("QUIETLY IN CONTROL")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Plan" }).at(-1)!);
    expect(screen.getByText("TOMORROW")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "History" }).at(-1)!);
    expect(screen.getByText("PROVEN THIS WEEK")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Home" }).at(-1)!);
    expect(screen.getByText("QUIETLY IN CONTROL")).toBeInTheDocument();
  });

  it("passes shared latest cycle heartbeat into Home caution display when present", () => {
    act(() => {
      setLatestCycleHeartbeat({
        entryKind: "cycle_heartbeat",
        recordedAt: "2026-03-16T10:15:00.000Z",
        executionPosture: "normal",
        commandsIssued: 0,
        commandsSkipped: 0,
        commandsFailed: 0,
        commandsSuppressed: 0,
        failClosedTriggered: false,
        nextCycleExecutionCaution: "caution",
        schemaVersion: "cycle-heartbeat.v1",
      });
    });

    render(<SimplifiedDashboard />);

    expect(screen.getByText("Caution: caution")).toBeInTheDocument();
  });

  it("passes shared latest cycle heartbeat into History latest-cycle view when present", () => {
    act(() => {
      setLatestCycleHeartbeat({
        entryKind: "cycle_heartbeat",
        recordedAt: "2026-03-16T10:15:00.000Z",
        executionPosture: "normal",
        commandsIssued: 0,
        commandsSkipped: 0,
        commandsFailed: 0,
        commandsSuppressed: 0,
        failClosedTriggered: false,
        nextCycleExecutionCaution: "caution",
        householdObjectiveConfidence: "mixed",
        schemaVersion: "cycle-heartbeat.v1",
      });
    });

    render(<SimplifiedDashboard />);
    fireEvent.click(screen.getAllByRole("button", { name: "History" }).at(-1)!);

    expect(screen.getByText("LAST RUN")).toBeInTheDocument();
    expect(screen.getAllByText("Caution: caution").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Confidence: mixed").length).toBeGreaterThan(0);
  });

  it("shows multiple recent canonical cycle entries in History when available", () => {
    act(() => {
      setLatestCycleHeartbeat({
        entryKind: "cycle_heartbeat",
        cycleId: "cycle-1",
        recordedAt: "2026-03-16T10:00:00.000Z",
        executionPosture: "normal",
        commandsIssued: 0,
        commandsSkipped: 0,
        commandsFailed: 0,
        commandsSuppressed: 0,
        failClosedTriggered: false,
        nextCycleExecutionCaution: "normal",
        householdObjectiveConfidence: "clear",
        schemaVersion: "cycle-heartbeat.v1",
      });

      setLatestCycleHeartbeat({
        entryKind: "cycle_heartbeat",
        cycleId: "cycle-2",
        recordedAt: "2026-03-16T10:30:00.000Z",
        executionPosture: "normal",
        commandsIssued: 0,
        commandsSkipped: 0,
        commandsFailed: 0,
        commandsSuppressed: 0,
        failClosedTriggered: false,
        nextCycleExecutionCaution: "caution",
        householdObjectiveConfidence: "mixed",
        schemaVersion: "cycle-heartbeat.v1",
      });
    });

    render(<SimplifiedDashboard />);
    fireEvent.click(screen.getAllByRole("button", { name: "History" }).at(-1)!);

    expect(screen.getByText("RECENT RUNS")).toBeInTheDocument();
    expect(screen.getByText("Confidence: clear")).toBeInTheDocument();
    expect(screen.getAllByText("Confidence: mixed").length).toBeGreaterThan(0);
  });

  it("shows recent canonical execution outcomes in History when available", () => {
    act(() => {
      pushRecentExecutionOutcomes([
        {
          entryId: "entry-1",
          cycleId: "cycle-1",
          recordedAt: "2026-03-16T10:00:00.000Z",
          executionRequestId: "request-1",
          idempotencyKey: "key-1",
          targetDeviceId: "battery",
          canonicalCommand: {
            commandId: "cmd-1",
            targetDeviceId: "battery",
            kind: "set_mode",
            mode: "charge",
            effectiveWindow: {
              startAt: "2026-03-16T10:00:00.000Z",
              endAt: "2026-03-16T10:30:00.000Z",
            },
          },
          status: "issued",
          executionConfidence: "confirmed",
          telemetryCoherence: "coherent",
          stage: "dispatch",
          schemaVersion: "execution-journal.v1",
        },
      ]);
    });

    render(<SimplifiedDashboard />);
    fireEvent.click(screen.getAllByRole("button", { name: "History" }).at(-1)!);

    expect(screen.getByText("RECENT ACTIONS")).toBeInTheDocument();
    expect(screen.getAllByText("Result: Sent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Confidence: Verified").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Evidence: Device confirmed").length).toBeGreaterThan(0);
  });

  it("shows canonical recent outcome counters in History", () => {
    act(() => {
      pushRecentExecutionOutcomes([
        {
          entryId: "entry-counters-1",
          cycleId: "cycle-counters-1",
          recordedAt: "2026-03-16T11:00:00.000Z",
          executionRequestId: "request-counters-1",
          idempotencyKey: "key-counters-1",
          targetDeviceId: "battery",
          canonicalCommand: {
            commandId: "cmd-counters-1",
            targetDeviceId: "battery",
            kind: "set_mode",
            mode: "charge",
            effectiveWindow: {
              startAt: "2026-03-16T11:00:00.000Z",
              endAt: "2026-03-16T11:30:00.000Z",
            },
          },
          status: "issued",
          executionConfidence: "confirmed",
          stage: "dispatch",
          schemaVersion: "execution-journal.v1",
        },
        {
          entryId: "entry-counters-2",
          cycleId: "cycle-counters-2",
          recordedAt: "2026-03-16T11:10:00.000Z",
          executionRequestId: "request-counters-2",
          idempotencyKey: "key-counters-2",
          targetDeviceId: "ev",
          canonicalCommand: {
            commandId: "cmd-counters-2",
            targetDeviceId: "ev",
            kind: "set_mode",
            mode: "charge",
            effectiveWindow: {
              startAt: "2026-03-16T11:10:00.000Z",
              endAt: "2026-03-16T11:40:00.000Z",
            },
          },
          status: "skipped",
          executionConfidence: "uncertain",
          stage: "reconciliation",
          schemaVersion: "execution-journal.v1",
        },
        {
          entryId: "entry-counters-3",
          cycleId: "cycle-counters-3",
          recordedAt: "2026-03-16T11:20:00.000Z",
          executionRequestId: "request-counters-3",
          idempotencyKey: "key-counters-3",
          targetDeviceId: "battery",
          canonicalCommand: {
            commandId: "cmd-counters-3",
            targetDeviceId: "battery",
            kind: "set_mode",
            mode: "discharge",
            effectiveWindow: {
              startAt: "2026-03-16T11:20:00.000Z",
              endAt: "2026-03-16T11:50:00.000Z",
            },
          },
          status: "failed",
          stage: "dispatch",
          schemaVersion: "execution-journal.v1",
        },
      ]);
    });

    render(<SimplifiedDashboard />);
    fireEvent.click(screen.getAllByRole("button", { name: "History" }).at(-1)!);

    expect(screen.getByText("RECENT ACTIONS")).toBeInTheDocument();
    expect(screen.getByText("Issued: 1")).toBeInTheDocument();
    expect(screen.getByText("Skipped: 1")).toBeInTheDocument();
    expect(screen.getByText("Failed: 1")).toBeInTheDocument();
    expect(screen.getByText("Confirmed: 1")).toBeInTheDocument();
    expect(screen.getByText("Uncertain: 1")).toBeInTheDocument();
  });

  it("shows latest canonical execution outcome detail in History", () => {
    act(() => {
      pushRecentExecutionOutcomes([
        {
          entryId: "entry-latest-old",
          cycleId: "cycle-latest-old",
          recordedAt: "2026-03-16T11:00:00.000Z",
          executionRequestId: "request-latest-old",
          idempotencyKey: "key-latest-old",
          targetDeviceId: "battery",
          canonicalCommand: {
            commandId: "cmd-latest-old",
            targetDeviceId: "battery",
            kind: "set_mode",
            mode: "charge",
            effectiveWindow: {
              startAt: "2026-03-16T11:00:00.000Z",
              endAt: "2026-03-16T11:30:00.000Z",
            },
          },
          status: "issued",
          executionConfidence: "confirmed",
          telemetryCoherence: "coherent",
          stage: "dispatch",
          schemaVersion: "execution-journal.v1",
        },
        {
          entryId: "entry-latest-new",
          cycleId: "cycle-latest-new",
          recordedAt: "2026-03-16T11:20:00.000Z",
          executionRequestId: "request-latest-new",
          idempotencyKey: "key-latest-new",
          targetDeviceId: "ev",
          canonicalCommand: {
            commandId: "cmd-latest-new",
            targetDeviceId: "ev",
            kind: "set_mode",
            mode: "charge",
            effectiveWindow: {
              startAt: "2026-03-16T11:20:00.000Z",
              endAt: "2026-03-16T11:50:00.000Z",
            },
          },
          status: "failed",
          executionConfidence: "uncertain",
          telemetryCoherence: "stale",
          stage: "dispatch",
          schemaVersion: "execution-journal.v1",
        },
      ]);
    });

    render(<SimplifiedDashboard />);
    fireEvent.click(screen.getAllByRole("button", { name: "History" }).at(-1)!);

    expect(screen.getByText("LAST ACTION · 11:20 · ev")).toBeInTheDocument();
    expect(screen.getAllByText("Action: Start charging").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Result: Failed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Confidence: Needs review").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Evidence: Out of date").length).toBeGreaterThan(0);
  });

  it("shows latest expected-vs-actual outcome slice from canonical outcomes", () => {
    act(() => {
      pushRecentExecutionOutcomes([
        {
          entryId: "entry-expected-actual-old",
          cycleId: "cycle-expected-actual-old",
          recordedAt: "2026-03-16T12:00:00.000Z",
          executionRequestId: "request-expected-actual-old",
          idempotencyKey: "key-expected-actual-old",
          targetDeviceId: "battery",
          canonicalCommand: {
            commandId: "cmd-expected-actual-old",
            targetDeviceId: "battery",
            kind: "set_mode",
            mode: "charge",
            effectiveWindow: {
              startAt: "2026-03-16T12:00:00.000Z",
              endAt: "2026-03-16T12:30:00.000Z",
            },
          },
          status: "issued",
          executionConfidence: "confirmed",
          telemetryCoherence: "coherent",
          stage: "dispatch",
          schemaVersion: "execution-journal.v1",
        },
        {
          entryId: "entry-expected-actual-new",
          cycleId: "cycle-expected-actual-new",
          recordedAt: "2026-03-16T12:20:00.000Z",
          executionRequestId: "request-expected-actual-new",
          idempotencyKey: "key-expected-actual-new",
          targetDeviceId: "ev",
          canonicalCommand: {
            commandId: "cmd-expected-actual-new",
            targetDeviceId: "ev",
            kind: "set_mode",
            mode: "charge",
            effectiveWindow: {
              startAt: "2026-03-16T12:20:00.000Z",
              endAt: "2026-03-16T12:50:00.000Z",
            },
          },
          status: "failed",
          executionConfidence: "uncertain",
          telemetryCoherence: "stale",
          stage: "dispatch",
          schemaVersion: "execution-journal.v1",
        },
      ]);
    });

    render(<SimplifiedDashboard />);
    fireEvent.click(screen.getAllByRole("button", { name: "History" }).at(-1)!);

    expect(screen.getByText("PLANNED vs DELIVERED · 12:20")).toBeInTheDocument();
    expect(screen.getByText("Planned: Start charging on ev")).toBeInTheDocument();
    expect(screen.getByText("Delivered: Failed")).toBeInTheDocument();
    expect(screen.getAllByText("Confidence: Needs review").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Evidence: Out of date").length).toBeGreaterThan(0);
  });
});
