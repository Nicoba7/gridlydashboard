import type { ForecastPoint } from "../../domain/forecasts";
import { fetchSolcastForecast } from "../../integrations/solcast/solcastAdapter";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type RuntimeSolarForecastSource = "simulated" | "solcast_live";

export interface RuntimeSolarForecastSourceEnv {
  SOLCAST_API_KEY?: string;
  SOLCAST_RESOURCE_ID?: string;
}

export interface ResolveRuntimeSolarForecastInput {
  fallbackSolarForecast: ForecastPoint[];
  sourceEnv: RuntimeSolarForecastSourceEnv;
  fetchFn?: FetchLike;
}

export interface RuntimeSolarForecastResolution {
  solarGenerationKwh: ForecastPoint[];
  source: RuntimeSolarForecastSource;
  caveats: string[];
}

/**
 * Resolve the solar generation forecast for the canonical optimizer input.
 *
 * Uses Solcast live data when SOLCAST_API_KEY and SOLCAST_RESOURCE_ID are both
 * present in the environment. Falls back to the simulator's synthetic profile
 * with a console warning if either variable is absent or the API call fails.
 */
export async function resolveRuntimeSolarForecast(
  input: ResolveRuntimeSolarForecastInput,
): Promise<RuntimeSolarForecastResolution> {
  const apiKey = input.sourceEnv.SOLCAST_API_KEY?.trim();
  const resourceId = input.sourceEnv.SOLCAST_RESOURCE_ID?.trim();

  if (!apiKey || !resourceId) {
    return {
      solarGenerationKwh: input.fallbackSolarForecast,
      source: "simulated",
      caveats: [
        "Using simulated solar forecast — set SOLCAST_API_KEY and SOLCAST_RESOURCE_ID to enable live data.",
      ],
    };
  }

  try {
    const points = await fetchSolcastForecast({
      resourceId,
      apiKey,
      fetchFn: input.fetchFn,
    });

    if (points.length === 0) {
      console.warn("[Solcast] Forecast returned zero points; falling back to simulated solar.");
      return {
        solarGenerationKwh: input.fallbackSolarForecast,
        source: "simulated",
        caveats: ["Solcast forecast returned no data points; fell back to simulated solar."],
      };
    }

    return {
      solarGenerationKwh: points,
      source: "solcast_live",
      caveats: [`Using live Solcast solar forecast (${points.length} slots, resource ${resourceId}).`],
    };
  } catch (error) {
    console.warn(
      `[Solcast] Forecast fetch failed; falling back to simulated solar. Error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );

    return {
      solarGenerationKwh: input.fallbackSolarForecast,
      source: "simulated",
      caveats: [
        "Solcast forecast fetch failed; fell back to simulated solar.",
        error instanceof Error ? error.message : "Unknown Solcast error.",
      ],
    };
  }
}
