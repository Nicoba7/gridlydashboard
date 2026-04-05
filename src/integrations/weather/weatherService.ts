/**
 * Weather integration using the Open-Meteo free API (no key required).
 *
 * Fetches a 48-slot outdoor temperature forecast for the site location and
 * provides a COP adjustment function for heat pump pre-heat scheduling.
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface OpenMeteoHourlyResponse {
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
  };
}

/**
 * Fetches outdoor temperature for the next 48 half-hourly slots (24 hours)
 * using the Open-Meteo free forecast API.
 *
 * The hourly API is sampled at each hour; this function duplicates each hourly
 * value to produce a 48-element half-hourly array aligned with the optimizer's
 * 30-minute slot grid (slot 0 = 00:00–00:30, slot 47 = 23:30–00:00).
 *
 * Returns null on any network error so callers can continue without weather data.
 */
export async function getOutdoorTemperatureForecast(
  lat: number,
  lon: number,
  fetchFn: FetchLike = fetch,
): Promise<number[] | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&hourly=temperature_2m&forecast_days=2&timezone=UTC`;

    const res = await fetchFn(url);
    if (!res.ok) return null;

    const data = (await res.json()) as OpenMeteoHourlyResponse;
    const temps = data.hourly?.temperature_2m;
    if (!Array.isArray(temps) || temps.length < 24) return null;

    // Duplicate each hourly value to produce 48 half-hourly slots.
    const slots: number[] = [];
    for (let h = 0; h < 24; h++) {
      const temp = temps[h];
      const value = typeof temp === "number" && Number.isFinite(temp) ? temp : 10;
      slots.push(value, value); // two 30-minute slots per hour
    }
    return slots;
  } catch {
    return null;
  }
}

/**
 * Adjusts a base COP value for outdoor temperature.
 *
 * Heat pumps perform better in milder weather. This model applies ±0.1 COP
 * per degree of deviation from the reference outdoor temperature of 7°C
 * (a standard test point for air-source heat pumps), clamped to [1.5, 5.0].
 *
 * @param baseCop  Nominal COP at the reference temperature of 7°C.
 * @param outdoorTempC  Actual outdoor temperature in °C.
 */
export function adjustCopForTemperature(baseCop: number, outdoorTempC: number): number {
  const REFERENCE_TEMP_C = 7;
  const COP_CHANGE_PER_DEGREE = 0.1;
  const raw = baseCop + (outdoorTempC - REFERENCE_TEMP_C) * COP_CHANGE_PER_DEGREE;
  return Math.max(1.5, Math.min(5.0, raw));
}
