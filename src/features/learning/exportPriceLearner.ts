/**
 * Agile export price learner.
 *
 * Records the peak daily export rate (pence/kWh) to Redis and computes a
 * configurable percentile from the last 30 days of observations. The optimizer
 * uses the 70th-percentile value to gate export decisions — skipping export on
 * days where the peak rate is below the historical benchmark.
 */

interface RedisLike {
  lpush(key: string, ...values: string[]): Promise<unknown>;
  ltrim(key: string, start: number, end: number): Promise<unknown>;
  lrange<T = string>(key: string, start: number, end: number): Promise<T[]>;
}

const MAX_OBSERVATIONS = 30;

function redisKey(userId: string): string {
  return `aveum:learning:${userId}:exportPrices`;
}

/**
 * Records today's peak export rate observation.
 *
 * @param userId        Aveum user ID.
 * @param pencePerKwh   Peak export rate in pence/kWh for today.
 * @param redis         Redis client.
 */
export async function recordExportPrice(
  userId: string,
  pencePerKwh: number,
  redis: RedisLike,
): Promise<void> {
  const key = redisKey(userId);
  await redis.lpush(key, String(pencePerKwh));
  await redis.ltrim(key, 0, MAX_OBSERVATIONS - 1);
}

/**
 * Returns the export price at the requested percentile from stored observations.
 *
 * Returns null when fewer than 3 observations are available (not enough data
 * to form a reliable distribution).
 *
 * @param userId      Aveum user ID.
 * @param percentile  Percentile to retrieve (0–100). Typical usage: 70.
 * @param redis       Redis client.
 */
export async function getExportPricePercentile(
  userId: string,
  percentile: number,
  redis: RedisLike,
): Promise<number | null> {
  const raw = await redis.lrange<string>(redisKey(userId), 0, MAX_OBSERVATIONS - 1);
  const prices = raw
    .map((v) => parseFloat(v))
    .filter((v) => Number.isFinite(v) && v >= 0);

  if (prices.length < 3) return null;

  const sorted = [...prices].sort((a, b) => a - b);
  const index = Math.floor((sorted.length * percentile) / 100);
  return sorted[Math.min(index, sorted.length - 1)];
}
