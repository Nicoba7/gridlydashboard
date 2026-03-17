# Runtime Decision Pipeline

## Overview

Gridly's runtime is a staged financial decision pipeline for home energy execution.
The canonical unit of decision is an opportunity, not an adapter request and not a raw command reconstruction.

The runtime takes optimizer output, evaluates which opportunities are safe and valid to act on, resolves economic contention, builds an execution plan, executes that plan through adapters, and projects the result into the current journal schema.

The staged design exists to keep economic reasoning, adapter dispatch, and persistence concerns separated.

## Runtime Pipeline

```text
Opportunities
  -> Eligibility
  -> Device Arbitration
  -> Household Decision
  -> Execution Planning
  -> Execution
  -> Journal Projection
```

## Stage Responsibilities

### Eligibility

`evaluateOpportunityEligibility`

Owns:
- runtime guardrail checks
- capability validation
- shadow reconciliation
- execution-policy gating

Does not own:
- device or household economic arbitration
- adapter dispatch
- journal persistence

Outputs canonical eligible/rejected opportunities plus transitional compatibility outcomes for current edge consumers.

### Device Arbitration

`arbitrateDeviceOpportunities`

Owns:
- economic comparison among opportunities targeting the same device
- device-level prerejection traces

Does not own:
- household-level selection
- eligibility revalidation
- adapter execution

### Household Decision

`selectHouseholdDecision`

Owns:
- cross-device economic comparison after device arbitration
- selection of the single household-level economic winner
- household-level prerejection traces

Does not own:
- new opportunity creation
- adapter execution
- persistence

### Execution Planning

`buildExecutionPlan`

Owns:
- conversion of the selected opportunity set into the canonical execution plan boundary
- reserved-device conflict handling
- non-executable plan shaping

Does not own:
- new economic reasoning
- adapter invocation

### Execution

`executePlan`

Owns:
- adapter invocation
- collection of adapter outcomes
- shaping canonical execution results

Does not own:
- opportunity selection
- economic arbitration
- journal persistence

Adapters execute commands only. They must never perform economic reasoning.

### Journal Projection

`projectJournal`

Owns:
- decision narrative projection
- projection of current journal entries
- cycle heartbeat payload shaping

Does not own:
- store persistence
- adapter execution
- decision selection

## Runtime Invariants

- Opportunities are the canonical decision unit throughout the runtime pipeline.
- Canonical stages require full execution authority (`opportunityId + decisionId + planId`) and fail closed when identity is insufficient.
- Economic reasoning must be complete before adapter execution begins.
- `selected_opportunity` is the only household decision shape that may lead to an executable plan.
- Executable plans represent dispatchable work; non-executable plans do not.
- `executed` and `partially_executed` results reference executable plans.
- `non_executed` results reference non-executable plans.
- Canonical rejection records are stage-owned and carry stage identity explicitly.

## Controller Role

`service.ts` is a thin pipeline controller.

It is responsible for:
- invoking stages in order
- preserving rejection accumulation order
- passing accumulated outputs across stage boundaries
- persisting already-projected journal payloads
- applying shadow updates after execution

It should not contain:
- economic decision logic
- stage-local rejection shaping
- adapter-specific business reasoning

The intended rejection accumulation order is:
1. eligibility
2. device arbitration
3. household decision
4. execution planning

## Compatibility Boundaries

Legacy command-only requests are canonicalized at a single explicit boundary:

- `legacyExecutionCompatibilityAdapter.ts`

Canonicalization rules:
- if `opportunityId` is present, identity is treated as native canonical
- if `opportunityId` is missing but `decisionId` exists, synthesize canonical opportunity identity as
  `planId:decision:decisionId:command:commandId`
- if both `opportunityId` and `decisionId` are missing, authority is insufficient and execution is denied

Determinism rules:
- canonicalized legacy identity is pure from stable input fields (`planId`, `decisionId`, `commandId`)
- execution identity is deterministic from canonical opportunity identity + target + command intent + effective window
- retries/replays of the same legacy input must produce the same canonicalized opportunity identity

Provenance rules:
- compatibility-canonicalized opportunities must carry explicit provenance metadata
  (`kind`, `canonicalizedFromLegacy`, `legacySourceType`, `adaptationReason`, `sourceCommandLineage`, `canonicalizationVersion`)
- native canonical opportunities must be explicitly marked as native
- provenance must survive adapter execution normalization and journal projection

These compatibility payloads are transitional edge artifacts.
They are not canonical runtime objects and should stay isolated at stage edges.

This means:
- canonical pipeline types should remain opportunity/plan/result oriented
- compatibility outcome shaping should stay inside stage modules or narrow edge helpers
- adapters should consume execution requests, not re-interpret economic intent

## Journal Accountability Semantics

Execution journal entries must preserve canonical opportunity identity and provenance without promoting execution artifacts to authority.

Required properties:
- `executionRequestId` and `idempotencyKey` are correlation fields only
- `opportunityId` remains the canonical decision identity used for accountability
- `opportunityProvenance` explicitly distinguishes `native_canonical` vs `compatibility_canonicalized`
- journal projection may fill missing provenance from canonical execution context, but must not infer canonical identity from execution IDs

## Audit Checklist

Use this checklist for fast compatibility-canonicalization audits:

- Authority strictness
  - canonical stages reject requests missing full authority (`opportunityId + decisionId + planId`)
  - no stage relies on `executionRequestId` or `idempotencyKey` for canonical identity
- Compatibility boundary isolation
  - legacy identity upgrades happen only in `legacyExecutionCompatibilityAdapter.ts`
  - no other stage synthesizes canonical opportunity IDs from raw command-only payloads
- Determinism
  - identical legacy inputs produce identical canonicalized `opportunityId`
  - identical legacy inputs produce stable `executionRequestId`/`idempotencyKey`
  - retries/replays do not create misleading new canonical identities
- Provenance completeness
  - compatibility-canonicalized entries include source type, adaptation reason, lineage, and canonicalization version
  - native canonical entries are explicitly marked as native
  - provenance survives request -> context -> result -> journal flow
- Journal safety
  - journal entries preserve canonical `opportunityId` as accountability key
  - `opportunityProvenance` is present and consistent with source path
  - execution IDs remain correlation-only fields

## Future Cleanup Phase

Not for this phase:
- redesigning journal/store contracts
- removing request-centric compatibility outcomes entirely
- reworking adapter contracts
- changing product behavior or execution policy semantics

The next cleanup phase should focus on shrinking transitional compatibility surfaces once journal and adapter boundaries can consume more canonical runtime outputs directly.
