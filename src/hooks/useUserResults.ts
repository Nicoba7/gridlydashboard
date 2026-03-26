// useUserResults.ts — fetches persisted daily results for the signed-in user

import { useState, useEffect } from "react";
import type { DailyResult } from "../../api/results";

export type { DailyResult };

export interface UseUserResultsReturn {
  results: DailyResult[];
  loading: boolean;
  hasResults: boolean;
}

export function useUserResults(): UseUserResultsReturn {
  const [results, setResults] = useState<DailyResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const userId =
      typeof window !== "undefined" ? localStorage.getItem("aveum_user_id") : null;
    if (!userId) return;

    setLoading(true);
    fetch(`/api/results?userId=${encodeURIComponent(userId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.results)) setResults(data.results);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { results, loading, hasResults: results.length > 0 };
}
