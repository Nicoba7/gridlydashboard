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

The runtime still produces request-centric compatibility outcomes for current adapter, journal, and store flows.
These compatibility payloads are transitional edge artifacts.
They are not canonical runtime objects and should stay isolated at stage edges.

This means:
- canonical pipeline types should remain opportunity/plan/result oriented
- compatibility outcome shaping should stay inside stage modules or narrow edge helpers
- adapters should consume execution requests, not re-interpret economic intent

## Future Cleanup Phase

Not for this phase:
- redesigning journal/store contracts
- removing request-centric compatibility outcomes entirely
- reworking adapter contracts
- changing product behavior or execution policy semantics

The next cleanup phase should focus on shrinking transitional compatibility surfaces once journal and adapter boundaries can consume more canonical runtime outputs directly.
