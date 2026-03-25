import { describe, expect, it, vi } from "vitest";
import {
  fetchSolcastForecast,
  mapSolcastForecastToForecastPoints,
} from "../integrations/solcast/solcastAdapter";

function response(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

const RESOURCE_ID = "test-resource-abc123";
const API_KEY = "test-api-key";

describe("mapSolcastForecastToForecastPoints", () => {
  it("maps period_end and pv_estimate to ForecastPoint with correct startAt and kWh value", () => {
    const points = mapSolcastForecastToForecastPoints({
      forecasts: [
        { period_end: "2026-03-25T10:30:00.0000000Z", period: "PT30M", pv_estimate: 2.4 },
        { period_end: "2026-03-25T11:00:00.0000000Z", period: "PT30M", pv_estimate: 3.0 },
      ],
    });

    expect(points).toHaveLength(2);

    // First slot: 2.4 kW × 0.5 h = 1.2 kWh, startAt = period_end minus 30 min
    expect(points[0].endAt).toBe("2026-03-25T10:30:00.0000000Z");
    expect(points[0].startAt).toBe("2026-03-25T10:00:00.000Z");
    expect(points[0].value).toBe(1.2);

    // Second slot: 3.0 kW × 0.5 h = 1.5 kWh
    expect(points[1].endAt).toBe("2026-03-25T11:00:00.0000000Z");
    expect(points[1].startAt).toBe("2026-03-25T10:30:00.000Z");
    expect(points[1].value).toBe(1.5);
  });

  it("returns points sorted chronologically even if API response is unordered", () => {
    const points = mapSolcastForecastToForecastPoints({
      forecasts: [
        { period_end: "2026-03-25T12:00:00.0000000Z", period: "PT30M", pv_estimate: 1.0 },
        { period_end: "2026-03-25T11:00:00.0000000Z", period: "PT30M", pv_estimate: 2.0 },
        { period_end: "2026-03-25T11:30:00.0000000Z", period: "PT30M", pv_estimate: 1.5 },
      ],
    });

    expect(points[0].endAt).toBe("2026-03-25T11:00:00.0000000Z");
    expect(points[1].endAt).toBe("2026-03-25T11:30:00.0000000Z");
    expect(points[2].endAt).toBe("2026-03-25T12:00:00.0000000Z");
  });

  it("filters out entries with missing period_end", () => {
    const points = mapSolcastForecastToForecastPoints({
      forecasts: [
        { period_end: "2026-03-25T10:30:00.0000000Z", period: "PT30M", pv_estimate: 1.2 },
        { period: "PT30M", pv_estimate: 0.8 }, // no period_end
      ],
    });

    expect(points).toHaveLength(1);
    expect(points[0].value).toBe(0.6);
  });

  it("filters out entries with non-finite pv_estimate", () => {
    const points = mapSolcastForecastToForecastPoints({
      forecasts: [
        { period_end: "2026-03-25T10:30:00.0000000Z", period: "PT30M", pv_estimate: 1.0 },
        { period_end: "2026-03-25T11:00:00.0000000Z", period: "PT30M", pv_estimate: undefined },
        { period_end: "2026-03-25T11:30:00.0000000Z", period: "PT30M", pv_estimate: NaN },
      ],
    });

    expect(points).toHaveLength(1);
  });

  it("defaults period to 30 minutes when period field is absent", () => {
    const points = mapSolcastForecastToForecastPoints({
      forecasts: [
        { period_end: "2026-03-25T10:30:00.0000000Z", pv_estimate: 4.0 },
      ],
    });

    expect(points).toHaveLength(1);
    // 4.0 kW × 0.5 h = 2.0 kWh
    expect(points[0].value).toBe(2.0);
    expect(points[0].startAt).toBe("2026-03-25T10:00:00.000Z");
  });

  it("returns empty array for an empty forecasts list", () => {
    expect(mapSolcastForecastToForecastPoints({ forecasts: [] })).toEqual([]);
    expect(mapSolcastForecastToForecastPoints({})).toEqual([]);
  });
});

describe("fetchSolcastForecast", () => {
  it("calls the correct Solcast API URL with Bearer auth and maps the response", async () => {
    const fetchFn = vi.fn(async () =>
      response({
        forecasts: [
          { period_end: "2026-03-25T09:00:00.0000000Z", period: "PT30M", pv_estimate: 1.8 },
          { period_end: "2026-03-25T09:30:00.0000000Z", period: "PT30M", pv_estimate: 2.6 },
        ],
      }),
    );

    const points = await fetchSolcastForecast({
      resourceId: RESOURCE_ID,
      apiKey: API_KEY,
      fetchFn,
    });

    const [calledUrl, calledInit] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      `https://api.solcast.com.au/rooftop_sites/${RESOURCE_ID}/forecasts?format=json`,
    );
    expect((calledInit.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${API_KEY}`,
    );

    expect(points).toHaveLength(2);
    // 1.8 kW × 0.5 h = 0.9 kWh
    expect(points[0].value).toBe(0.9);
    // 2.6 kW × 0.5 h = 1.3 kWh
    expect(points[1].value).toBe(1.3);
  });

  it("retries on transient errors and succeeds on the second attempt", async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      if (calls < 2) {
        return response({}, 503);
      }
      return response({
        forecasts: [
          { period_end: "2026-03-25T10:00:00.0000000Z", period: "PT30M", pv_estimate: 1.0 },
        ],
      });
    });

    const points = await fetchSolcastForecast({
      resourceId: RESOURCE_ID,
      apiKey: API_KEY,
      fetchFn,
      retryAttempts: 3,
      retryBaseDelayMs: 1,
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(points).toHaveLength(1);
    expect(points[0].value).toBe(0.5);
  });

  it("throws immediately on HTTP 429 without retrying", async () => {
    const fetchFn = vi.fn(async () => response({}, 429));

    await expect(
      fetchSolcastForecast({
        resourceId: RESOURCE_ID,
        apiKey: API_KEY,
        fetchFn,
        retryAttempts: 3,
        retryBaseDelayMs: 1,
      }),
    ).rejects.toThrow("429");

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting all retry attempts", async () => {
    const fetchFn = vi.fn(async () => response({}, 500));

    await expect(
      fetchSolcastForecast({
        resourceId: RESOURCE_ID,
        apiKey: API_KEY,
        fetchFn,
        retryAttempts: 3,
        retryBaseDelayMs: 1,
      }),
    ).rejects.toThrow("500");

    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("URL-encodes the resource ID to handle special characters safely", async () => {
    const fetchFn = vi.fn(async () => response({ forecasts: [] }));

    await fetchSolcastForecast({
      resourceId: "site/with spaces&chars",
      apiKey: API_KEY,
      fetchFn,
    });

    const [calledUrl] = fetchFn.mock.calls[0] as [string];
    expect(calledUrl).toContain("site%2Fwith%20spaces%26chars");
  });
});
