export type TariffRecord = {
  id: string;
  name: string;
  annualSaving: number;
  current?: boolean;
  badge?: string | null;
};

type TariffApiResponse = {
  tariffs?: TariffRecord[];
};

const DEFAULT_API_URL = import.meta.env.VITE_TARIFF_API_URL as string | undefined;

export async function importTariffsFromApi(signal?: AbortSignal): Promise<TariffRecord[]> {
  if (!DEFAULT_API_URL) {
    throw new Error("Set VITE_TARIFF_API_URL to enable live tariff import");
  }

  const response = await fetch(DEFAULT_API_URL, { signal });
  if (!response.ok) {
    throw new Error(`Tariff API request failed (${response.status})`);
  }

  const payload = (await response.json()) as TariffApiResponse | TariffRecord[];
  const tariffs = Array.isArray(payload) ? payload : payload.tariffs ?? [];

  if (!tariffs.length) {
    throw new Error("Tariff API returned no tariffs");
  }

  return tariffs
    .filter(t => t && t.id && t.name && Number.isFinite(t.annualSaving))
    .map(t => ({ ...t, badge: t.badge ?? null }));
}
