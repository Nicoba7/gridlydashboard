# Aveum Engineering Constitution

This document defines non-negotiable architecture rules for Aveum system work.

## Design Principles

- Canonical domain first: core models and control semantics remain vendor-neutral.
- Pure decision making: planning and control logic stays deterministic and side-effect free.
- Explicit execution boundaries: dispatch and side effects happen only behind execution ports.
- Idempotent execution identity: execution identity must include decision, target, canonical semantics, and idempotency key.
- Explicit state: lifecycle transitions must be represented in types and models.
- Small safe increments: prefer minimal changes that preserve behavior and invariants.

## Execution Invariant Checklist

Use this checklist for architecture reviews and PR approvals:

- `controlLoop.ts` remains pure and deterministic.
- Capability validation runs before reconciliation.
- Reconciliation suppresses only high-confidence no-op commands.
- Execution policy gates dispatch.
- Shadow updates require acknowledgement-sufficient outcomes.
- Every execution outcome writes exactly one journal entry.
- Shadow state and journal history remain separate concerns.

## PR Gate Questions

- Does this change keep vendor-specific logic out of canonical core modules?
- Are new domain and execution states explicit in types (no hidden state)?
- Are pure functions separated from side-effecting orchestration code?
- Are schema/version/idempotency contracts preserved or intentionally versioned?
- Does the diff reduce ambiguity and keep module surface area minimal?
