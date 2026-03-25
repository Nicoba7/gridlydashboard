# Execution Architecture

This document locks the Aveum execution architecture before live device adapter work begins.

Related: [Aveum Engineering Constitution](./engineering-constitution.md)

## Current Flow

```text
Optimizer
  -> OptimizerOutput
  -> Control Loop
  -> commandsToIssue
  -> Execution Service
  -> CanonicalDeviceCommand
  -> DeviceCommandExecutor
  -> DeviceAdapters (future)
```

## Execution Decision Pipeline

Aveum executes canonical commands through an ordered set of separate architectural layers. Each stage has a single responsibility and produces a normalized outcome for the next stage.

```text
Canonical command request
  -> [1] Capability validation
  -> [2] Reconciliation
  -> [3] Execution policy
  -> [4] Dispatch
  -> [5] Acknowledgement projection
  -> [6] Shadow update
  -> [7] Execution journal
```

- Capability validation: confirms the command is valid for the target device capability contract.
- Reconciliation: compares desired command intent with current Aveum shadow belief and can skip already-satisfied work.
- Execution policy: applies platform-level allow/deny rules (timing, feasibility, conflict, staleness) before dispatch.
- Dispatch: sends only allowed canonical commands through the executor/adapter boundary.
- Acknowledgement projection: interprets raw execution outcomes into canonical acknowledgement semantics.
- Shadow update: updates device shadow only when acknowledgement projection marks the outcome as acknowledgement-sufficient.
- Execution journal: records canonical execution history and reason codes across stages for traceability.

## Execution Invariants

The execution pipeline must preserve these architectural invariants:

- `controlLoop.ts` remains pure and deterministic.
- Capability validation always precedes reconciliation.
- Reconciliation suppresses only high-confidence no-op commands; uncertain or mismatched cases continue to execution paths.
- Execution policy is the final gate before dispatch and must be satisfied for dispatch to occur.
- Shadow updates require acknowledgement-sufficient outcomes from acknowledgement projection.
- Every execution outcome produces exactly one execution journal entry.
- Shadow state (current system belief) and journal history (historical outcomes) remain separate concerns.

## Layer Responsibilities

### Optimizer

Produces `OptimizerOutput` as the canonical planning contract. It decides what Aveum wants the site to do and exposes execution-ready decisions, windows, feasibility, warnings, and recommended commands.

### Control Loop (pure)

Consumes `OptimizerOutput` at a time tick and determines what is currently actionable. It selects active decisions and commands to issue, marks skipped decisions, and determines whether replanning is required. This layer must remain pure and deterministic.

### Execution Service

Wraps the pure control loop in a thin application-layer orchestration seam. It converts control-loop output into execution requests, attaches execution identity and idempotency data, normalizes commands into canonical commands, and invokes the execution port.

### Canonical Device Command

`CanonicalDeviceCommand` is the stable Aveum-native command language. It is intentionally small, vendor-neutral, and only expresses command semantics Aveum already understands: target device, command intent, effective window, and any minimal numeric or mode values required for safe translation.

### Execution Identity / Idempotency

Execution requests carry stable identity derived from canonical command semantics. This prepares the system for future deduplication, logging, and live adapter safety without introducing persistence or retries yet.

### DeviceCommandExecutor

This is the application-layer execution port. Today it is backed by a noop implementation. In future it will hand canonical commands to live adapter-facing orchestration.

### Future Device Adapters

Adapters are not part of the planner or control-loop boundary. Their responsibility will be to translate canonical commands into vendor APIs and return normalized execution outcomes.

## Architectural Guardrails

- `src/controlLoop/controlLoop.ts` must remain pure and deterministic.
- `src/application/controlLoopExecution/canonicalCommand.ts` must remain vendor-neutral and define the stable Aveum command language.
- `src/application/controlLoopExecution/identity.ts` must derive idempotency from canonical command semantics, not incidental source shape.
- `src/application/controlLoopExecution/service.ts` is the only orchestration layer between control decisions and command execution.
- Future adapters must translate from `CanonicalDeviceCommand` only.
- Do not add persistence, queues, retries, schedulers, or adapter registries at this boundary before adapter interfaces are introduced deliberately.

## Why This Boundary Exists

This split keeps planning logic, control-loop selection, execution orchestration, and adapter translation separate. That lets Aveum preserve deterministic planning behavior while preparing for safe live execution against real devices.