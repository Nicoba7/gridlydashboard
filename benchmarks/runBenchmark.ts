import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertScenarioShape,
  buildMetricsFromPartial,
  buildStrategyComparison,
  chooseWinnerStrategyId,
  calculateMetricsFromStrategyResult,
} from "./metrics";
import sampleDayScenario from "./scenarios/sampleDay";
import { aveumStrategy } from "./strategies/aveumStrategy";
import { predbatLikeStrategy } from "./strategies/predbatLikeStrategy";
import { setAndForgetStrategy } from "./strategies/setAndForgetStrategy";
import type {
  BenchmarkMetrics,
  BenchmarkResult,
  BenchmarkScenario,
  StrategyComparisonTable,
  StrategyDecisionSlot,
  StrategyResult,
  StrategyTelemetry,
} from "./types";

// Strategy contract used by the harness.
// Canonical engine and baseline strategies should all implement this shape.
export interface BenchmarkStrategy {
  id: string;
  name: string;
  run: (scenario: BenchmarkScenario) => {
    metrics?: Partial<BenchmarkMetrics>;
    decisions?: StrategyDecisionSlot[];
    telemetry?: StrategyTelemetry;
    debug?: Record<string, unknown>;
  };
}

// Runs all strategies against one scenario and returns a comparable report.
// This is intentionally straightforward so the execution path is easy to audit.
export function runBenchmark(
  scenario: BenchmarkScenario,
  strategies: BenchmarkStrategy[],
  generatedAtIso = new Date().toISOString()
): BenchmarkResult {
  assertScenarioShape(scenario);

  const strategyResults: StrategyResult[] = strategies.map((strategy) => {
    const output = strategy.run(scenario);

    return {
      strategyId: strategy.id,
      strategyName: strategy.name,
      scenarioId: scenario.id,
      metrics: buildMetricsFromPartial(output.metrics),
      decisions: output.decisions,
      telemetry: output.telemetry,
      debug: output.debug,
    };
  });

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    generatedAtIso,
    strategyResults,
    winnerStrategyId: chooseWinnerStrategyId(strategyResults),
  };
}

function formatCurrency(value: number): string {
  return `£${value.toFixed(2)}`;
}

function formatNumber(value: number, decimals = 2): string {
  return value.toFixed(decimals);
}

function pad(text: string, width: number): string {
  return text.padEnd(width, " ");
}

function printComparisonSummary(comparison: StrategyComparisonTable): void {
  const headers = [
    "Strategy",
    "Net cost",
    "Import",
    "Export",
    "EV target",
    "Batt cycles",
    "Neg. price cap",
  ];

  const widths = [28, 12, 12, 12, 11, 12, 15];
  const separator = widths.map((w) => "-".repeat(w)).join("  ");

  console.log("\nBenchmark comparison (founder view)");
  console.log(separator);
  console.log(headers.map((h, i) => pad(h, widths[i])).join("  "));
  console.log(separator);

  for (const row of comparison.rows) {
    const cells = [
      row.strategyName,
      formatCurrency(row.netEnergyCost),
      formatCurrency(row.totalImportCost),
      formatCurrency(row.totalExportRevenue),
      row.evTargetAchieved ? "Yes" : "No",
      row.estimatedBatteryCycles != null ? formatNumber(row.estimatedBatteryCycles, 3) : "n/a",
      `${formatNumber(row.negativePriceCaptureKwh, 2)} kWh`,
    ];

    console.log(cells.map((cell, i) => pad(cell, widths[i])).join("  "));
  }

  console.log(separator);
}

function buildReportFileName(generatedAtIso: string, scenarioId: string): string {
  const safeTimestamp = generatedAtIso.replace(/[:.]/g, "-");
  return `${safeTimestamp}-${scenarioId}.json`;
}

async function saveBenchmarkReport(params: {
  benchmarkResult: BenchmarkResult;
  comparison: StrategyComparisonTable;
}): Promise<string> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const reportsDir = path.resolve(__dirname, "reports");

  await mkdir(reportsDir, { recursive: true });

  const reportPayload = {
    scenarioName: params.benchmarkResult.scenarioName,
    timestamp: params.benchmarkResult.generatedAtIso,
    comparison: params.comparison,
    strategyMetrics: params.benchmarkResult.strategyResults.map((result) => {
      const metrics = calculateMetricsFromStrategyResult(result);
      return {
        strategyId: result.strategyId,
        strategyName: result.strategyName,
        metrics,
        actions: result.decisions ?? [],
        evTargetMissPenalty: metrics.evTargetMissPenalty,
        adjustedNetEnergyCost: metrics.adjustedNetEnergyCost,
      };
    }),
  };

  const fileName = buildReportFileName(
    params.benchmarkResult.generatedAtIso,
    params.benchmarkResult.scenarioId
  );
  const filePath = path.join(reportsDir, fileName);

  await writeFile(filePath, JSON.stringify(reportPayload, null, 2), "utf8");
  return filePath;
}

async function runBenchmarkCli(): Promise<void> {
  // Batch runner for all scenarios
  const { allScenarios } = await import("./scenarios/index");
  const strategies: BenchmarkStrategy[] = [setAndForgetStrategy, predbatLikeStrategy, aveumStrategy];
  const scenarioResults: { scenarioName: string; benchmarkResult: BenchmarkResult; comparison: StrategyComparisonTable }[] = [];
  const overallStats: Record<string, { net: number[]; import: number[]; export: number[]; wins: number }> = {};
  for (const strategy of strategies) {
    overallStats[strategy.id] = { net: [], import: [], export: [], wins: 0 };
  }

  for (const scenario of allScenarios) {
    console.log("\n------------------------------");
    console.log(`Scenario: ${scenario.name}`);
    const benchmarkResult = runBenchmark(scenario, strategies);
    const comparison = buildStrategyComparison(benchmarkResult.strategyResults);
    scenarioResults.push({ scenarioName: scenario.name, benchmarkResult, comparison });
    printSimpleScenarioSummary(scenario.name, comparison);
    const winnerId = comparison.bestNetEnergyCostStrategyId;
    if (winnerId && overallStats[winnerId]) {
      overallStats[winnerId].wins++;
    }
    for (const row of comparison.rows) {
      overallStats[row.strategyId].net.push(row.adjustedNetEnergyCost);
      overallStats[row.strategyId].import.push(row.totalImportCost);
      overallStats[row.strategyId].export.push(row.totalExportRevenue);
    }
    const reportPath = await saveBenchmarkReport({ benchmarkResult, comparison });
    console.log(`Report saved: ${reportPath}`);
  }

  // Print overall summary
  console.log("\n==============================");
  console.log("Overall Summary (Averages)");
  for (const strategy of strategies) {
    const stats = overallStats[strategy.id];
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    console.log(
      `${strategy.name}: avg adjusted net cost ${formatCurrency(avg(stats.net))}, avg import ${formatCurrency(avg(stats.import))}, avg export ${formatCurrency(avg(stats.export))}, scenarios won ${stats.wins}`
    );
  }

  // Save combined summary report
  await saveCombinedSummaryReport(scenarioResults, strategies, overallStats);
  console.log("Combined summary report saved in /benchmarks/reports/");
}

function printSimpleScenarioSummary(scenarioName: string, comparison: StrategyComparisonTable) {
  for (const row of comparison.rows) {
    console.log(
      `  ${row.strategyName}: net ${formatCurrency(row.netEnergyCost)}, EV target ${row.evTargetAchieved ? "Yes" : "No"}, penalty ${formatCurrency(row.evTargetMissPenalty)}, adjusted ${formatCurrency(row.adjustedNetEnergyCost)}, import ${formatCurrency(row.totalImportCost)}, export ${formatCurrency(row.totalExportRevenue)}, battery cycles ${row.estimatedBatteryCycles != null ? formatNumber(row.estimatedBatteryCycles, 3) : "n/a"}, neg price cap ${formatNumber(row.negativePriceCaptureKwh, 2)} kWh`
    );
  }
  const winner = comparison.rows.find((row) => row.strategyId === comparison.bestNetEnergyCostStrategyId);
  if (winner) {
    console.log(`  Winner: ${winner.strategyName} (adjusted net cost)`);
  }
}

async function saveCombinedSummaryReport(
  scenarioResults: { scenarioName: string; benchmarkResult: BenchmarkResult; comparison: StrategyComparisonTable }[],
  strategies: BenchmarkStrategy[],
  overallStats: Record<string, { net: number[]; import: number[]; export: number[]; wins: number }>
) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const reportsDir = path.resolve(__dirname, "reports");
  await mkdir(reportsDir, { recursive: true });
  const summary = {
    scenarios: scenarioResults.map((r) => ({
      scenarioName: r.scenarioName,
      comparison: r.comparison,
      winnerStrategyId: r.comparison.bestNetEnergyCostStrategyId,
    })),
    overall: Object.fromEntries(
      strategies.map((s) => [
        s.id,
        {
          avgNetEnergyCost: average(overallStats[s.id].net),
          avgImportCost: average(overallStats[s.id].import),
          avgExportRevenue: average(overallStats[s.id].export),
          scenariosWon: overallStats[s.id].wins,
        },
      ])
    ),
  };
  const filePath = path.join(reportsDir, "combined-summary.json");
  await writeFile(filePath, JSON.stringify(summary, null, 2), "utf8");
}

function average(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

runBenchmarkCli().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Benchmark run failed.");
  console.error(message);
  process.exitCode = 1;
});
