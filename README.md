# Aveum

**The autonomous financial engine for home energy**

Aveum connects your EV, battery, solar, and tariff into a single decision engine that automatically minimises cost and maximises value.

No schedules. No rules. No manual optimisation.

## Local dev run-once

Runs one stubbed-input Aveum observe -> decide -> act cycle locally and persists the output to the same durable journal used by `/api/runtime-truth`.

### What it does

1. Uses stubbed Tesla runtime inputs so no Tesla credentials are required.
2. Uses the real optimizer, real control-loop execution service, and real explanation generator.
3. Searches a deterministic set of simulated timestamps until it finds a scenario that produces decision explanations.
4. Persists execution outcomes, heartbeats, and decision explanations to `.gridly/journal` (or `GRIDLY_JOURNAL_DIR` if set).
5. Lets the existing dev server and UI read that data through the normal `/api/runtime-truth` bridge.

### Command

```sh
npm run dev:single-run
```

### Optional environment variables

| Variable | Default | Description |
|---|---|---|
| `GRIDLY_NOW_ISO` | auto-selected scenario | Force a specific ISO timestamp instead of the built-in scenario search |
| `GRIDLY_SITE_ID` | simulator default | Site identifier written into runtime outputs |
| `GRIDLY_TIMEZONE` | simulator default | IANA timezone for the simulated cycle |
| `GRIDLY_OPTIMIZATION_MODE` | `balanced` | Optimisation objective: `cost`, `balanced`, `self_consumption`, or `carbon` |
| `GRIDLY_PLANNING_STYLE` | `balanced` | Canonical planning style: `cheapest`, `balanced`, or `greenest` |
| `GRIDLY_DEV_SCENARIO` | auto-search | Optional deterministic dev scenario; set `planning-style-contrast` to force visible style-dependent outcomes |
| `GRIDLY_JOURNAL_DIR` | `.gridly/journal` | Durable journal directory consumed by `/api/runtime-truth` |
| `GRIDLY_DEV_VEHICLE_ID` | `gridly-dev-vehicle-1` | Stable stub vehicle ID used in the simulated runtime path |

### Expected result

On success, the command writes fresh durable files including:

```sh
.gridly/journal/execution-journal.ndjson
.gridly/journal/cycle-heartbeat.ndjson
.gridly/journal/decision-explained.ndjson
```

The resulting explanation entries are then available through `/api/runtime-truth` and can be rendered by Home without any UI-only fallback data.

### Deterministic Planning Style contrast run

Use this when you want a guaranteed, user-visible style difference with the same runtime inputs except planning style:

```sh
GRIDLY_DEV_SCENARIO=planning-style-contrast GRIDLY_PLANNING_STYLE=cheapest npm run dev:single-run
GRIDLY_DEV_SCENARIO=planning-style-contrast GRIDLY_PLANNING_STYLE=balanced npm run dev:single-run
GRIDLY_DEV_SCENARIO=planning-style-contrast GRIDLY_PLANNING_STYLE=greenest npm run dev:single-run
```

This scenario is tuned so the first visible decision diverges in a stable way across styles.

---

## ⚡ What it does

Aveum:

* observes energy prices, solar generation, and device state
* decides when to charge, discharge, or wait
* coordinates across EVs, batteries, and solar
* executes decisions automatically
* records outcomes as financial truth

---

## 🧠 How it’s different

Most tools:

* optimise one device
* require manual setup
* rely on fixed schedules

Aveum:

* uses a **single canonical decision engine**
* is **hardware-agnostic**
* optimises across the whole system
* makes decisions automatically

> **Others control devices. Aveum optimises outcomes.**

---

## 🧱 Architecture (high level)

* **Runtime** — decision engine
* **Adapters** — connect devices
* **Journal** — records outcomes
* **Simulator** — testing + benchmarking

---

## ⚙️ Getting started

```sh
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>
npm install
npm run dev
```

---

## 🧪 Benchmarking (coming next)

Aveum is designed to be evaluated against:

* set-and-forget schedules
* device-native automation
* advanced systems like PredBat

Measured by:

* total energy cost
* export revenue
* net savings

---

## 🔮 Vision

Aveum turns homes into **financially optimised energy systems**.

Over time:

> individual homes → coordinated network → energy economy

---

## 🧠 One line

**Aveum turns connected energy assets into one coordinated financial system.**
