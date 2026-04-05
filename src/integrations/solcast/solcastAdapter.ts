import type { ForecastPoint } from "../../domain/forecasts";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** One entry from the Solcast forecasts array. */
interface SolcastForecastPeriod {
  period_end?: string;
  period?: string;
  pv_estimate?: number;
}

interface SolcastForecastsResponse {
  forecasts?: SolcastForecastPeriod[];
}

export interface SolcastAdapterConfig {
  /**
   * Solcast rooftop site resource ID.
   * Found in the Solcast Toolkit under your site's settings.
   */
  resourceId: string;
  /**
   * Solcast API key.
   * Available at https://toolkit.solcast.com.au/account under "API Key".
   */
  apiKey: string;
  /** Injectable fetch implementation — defaults to global fetch. */
  fetchFn?: FetchLike;
  /** Number of retry attempts on transient failures. Defaults to 3. */
  retryAttempts?: number;
  /** Base delay in ms between retries (linear backoff). Defaults to 200. */
  retryBaseDelayMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry<T>(
  url: string,
  init: RequestInit,
  fetchFn: FetchLike,
  attempts: number,
  baseDelayMs: number,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchFn(url, init);

      if (response.status === 429) {
        // Solcast enforces daily API call limits; treat as a terminal error.
        throw new Error(`Solcast API rate limit exceeded (HTTP 429).`);
      }

      if (!response.ok) {
        throw new Error(`Solcast request failed (HTTP ${response.status}).`);
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      // Do not retry on rate-limit responses.
      if (error instanceof Error && error.message.includes("429")) {
        throw error;
      }
      if (attempt < attempts - 1) {
        await delay(baseDelayMs * (attempt + 1));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Solcast request failed.");
}

/**
 * Converts a Solcast `period` string such as "PT30M" to minutes.
 * Returns 30 if the value is absent or unparseable (Solcast's standard resolution).
 */
function parsePeriodMinutes(period: string | undefined): number {
  if (!period) return 30;
  const match = /PT(\d+)M/.exec(period);
  return match ? parseInt(match[1], 10) : 30;
}

/**
 * Maps a raw Solcast forecasts response to an array of ForecastPoint values
 * suitable for use as `solarGenerationKwh` in the Aveum optimizer.
 *
 * Solcast uses `period_end` as the slot boundary and `pv_estimate` in kW (average
 * power over the period). This function converts to kWh by multiplying by the
 * slot duration in hours, then derives `startAt` by subtracting the period length.
 *
 * Points are returned sorted chronologically (earliest first).
 */
export function mapSolcastForecastToForecastPoints(
  response: SolcastForecastsResponse,
): ForecastPoint[] {
  return (response.forecasts ?? [])
    .filter(
      (p) =>
        typeof p.period_end === "string" &&
        p.period_end.length > 0 &&
        Number.isFinite(p.pv_estimate) &&
        (p.pv_estimate ?? 0) >= 0,
    )
    .map((p) => {
      const periodMinutes = parsePeriodMinutes(p.period);
      const slotHours = periodMinutes / 60;
      const endAt = p.period_end as string;
      const endMs = new Date(endAt).getTime();
      const startAt = new Date(endMs - periodMinutes * 60 * 1000).toISOString();
      // pv_estimate is average kW over the period; convert to kWh.
      const value = Number(((p.pv_estimate ?? 0) * slotHours).toFixed(4));

      return { startAt, endAt, value };
    })
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
}

/**
 * Converts an array of ForecastPoint values into a 48-element slot array
 * indexed by half-hourly slot from midnight (slot 0 = 00:00–00:30, slot 47 = 23:30–00:00).
 *
 * Points whose startAt falls outside the 48-slot grid are silently ignored.
 * Slots with no matching point retain their initialValue (default 0).
 */
export function forecastPointsToSlotArray(
  points: ForecastPoint[],
  initialValue = 0,
): number[] {
  const slots = Array.from<number>({ length: 48 }).fill(initialValue);
  for (const point of points) {
    const d = new Date(point.startAt);
    const slotIndex = d.getUTCHours() * 2 + Math.floor(d.getUTCMinutes() / 30);
    if (slotIndex >= 0 && slotIndex < 48 && Number.isFinite(point.value)) {
      slots[slotIndex] = point.value;
    }
  }
  return slots;
}

/**
 * Fetches a solar generation forecast from the Solcast Rooftop Sites API and
 * returns it as an array of ForecastPoint values ready for the Aveum optimizer.
 *
 * @example
 * ```ts
 * const points = await fetchSolcastForecast({
 *   resourceId: process.env.SOLCAST_RESOURCE_ID!,
 *   apiKey: process.env.SOLCAST_API_KEY!,
 * });
 * ```
 */
export async function fetchSolcastForecast(config: SolcastAdapterConfig): Promise<ForecastPoint[]> {
  const { resourceId, apiKey } = config;
  const fetchFn = config.fetchFn ?? fetch;
  const attempts = Math.max(1, config.retryAttempts ?? 3);
  const baseDelayMs = Math.max(1, config.retryBaseDelayMs ?? 200);

  const url = `https://api.solcast.com.au/rooftop_sites/${encodeURIComponent(resourceId)}/forecasts?format=json`;

  const payload = await fetchWithRetry<SolcastForecastsResponse>(
    url,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    },
    fetchFn,
    attempts,
    baseDelayMs,
  );

  return mapSolcastForecastToForecastPoints(payload);
}
