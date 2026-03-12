import { useState, useEffect } from "react";
import { AgileRate, AGILE_RATES } from "../pages/SimplifiedDashboard";
 
// Octopus Agile public API — no auth required
// DNO region codes: A=Eastern, B=East Midlands, C=London, D=North Wales,
// E=West Midlands, F=North East, G=North West, H=Southern, J=South East,
// K=South Wales, L=South West, M=Yorkshire, N=South Scotland, P=North Scotland
const REGION = import.meta.env.VITE_OCTOPUS_REGION ?? "C"; // default London
const PRODUCT = "AGILE-FLEX-22-11-25";
 
function toHHMM(dateStr: string): string {
  const d = new Date(dateStr);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
 
export function useAgileRates(): { rates: AgileRate[]; loading: boolean; error: string | null } {
  const [rates, setRates] = useState<AgileRate[]>(AGILE_RATES); // start with sandbox fallback
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
 
  useEffect(() => {
    const controller = new AbortController();
 
    async function fetchRates() {
      try {
        const today = new Date();
        const from = new Date(today);
        from.setHours(0, 0, 0, 0);
        const to = new Date(today);
        to.setHours(23, 30, 0, 0);
 
        const url = `https://api.octopus.energy/v1/products/${PRODUCT}/electricity-tariffs/E-1R-${PRODUCT}-${REGION}/standard-unit-rates/?period_from=${from.toISOString()}&period_to=${to.toISOString()}&page_size=48`;
 
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`Octopus API error (${res.status})`);
 
        const data = await res.json();
        const results = data?.results ?? [];
 
        if (!results.length) throw new Error("No rates returned");
 
        // Octopus returns newest first — reverse and map to AgileRate
        const parsed: AgileRate[] = [...results]
          .reverse()
          .map((r: { valid_from: string; value_inc_vat: number }) => ({
            time: toHHMM(r.valid_from),
            pence: Math.round(r.value_inc_vat * 10) / 10,
          }));
 
        setRates(parsed);
        setError(null);
      } catch (err: any) {
        if (err.name === "AbortError") return;
        // Silently fall back to sandbox data — user never sees a broken app
        setError("Using estimated prices — live prices unavailable right now");
      } finally {
        setLoading(false);
      }
    }
 
    fetchRates();
    // Refresh every 30 minutes to catch new half-hour slots
    const interval = setInterval(fetchRates, 30 * 60 * 1000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, []);
 
  return { rates, loading, error };
}
