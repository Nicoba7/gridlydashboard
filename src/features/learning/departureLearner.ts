/**
 * EV departure time learner.
 *
 * Records observed EV departure times (minutes from midnight) to Redis and
 * computes a running mean and standard deviation from the last 30 observations.
 * This allows the optimizer to derive a robust EV ready-by deadline that accounts
 * for day-to-day variability in the driver's routine.
 */

interface RedisLike {
  lpush(key: string, ...values: string[]): Promise<unknown>;
  ltrim(key: string, start: number, end: number): Promise<unknown>;
  lrange<T = string>(key: string, start: number, end: number): Promise<T[]>;
}

const MAX_OBSERVATIONS = 30;

function redisKey(userId: string): string {
  return `aveum:learning:${userId}:departures`;
}

/**
 * Records a departure observation.
 *
 * @param userId  Aveum user ID.
 * @param departureMinutes  Minutes from midnight when the EV disconnected.
 * @param redis  Redis client.
 */
export async function recordDeparture(
  userId: string,
  departureMinutes: number,
  redis: RedisLike,
): Promise<void> {
  const key = redisKey(userId);
  await redis.lpush(key, String(Math.round(departureMinutes)));
  await redis.ltrim(key, 0, MAX_OBSERVATIONS - 1);
}

/**
 * Returns the learned departure distribution from stored observations.
 *
 * Returns null when fewer than 3 observations are available (not enough data
 * to form a reliable distribution).
 */
export async function getLearnedDepartureDistribution(
  userId: string,
  redis: RedisLike,
): Promise<{ mean: number; stdDev: number } | null> {
  const raw = await redis.lrange<string>(redisKey(userId), 0, MAX_OBSERVATIONS - 1);
  const observations = raw
    .map((v) => parseFloat(v))
    .filter((v) => Number.isFinite(v) && v >= 0 && v < 1440);

  if (observations.length < 3) return null;

  const mean = observations.reduce((s, v) => s + v, 0) / observations.length;
  const variance =
    observations.reduce((s, v) => s + (v - mean) ** 2, 0) / observations.length;
  const stdDev = Math.sqrt(variance);

  return { mean: Math.round(mean), stdDev: Math.round(stdDev) };
}

/**
 * Converts a minutes-from-midnight value to an ISO-8601 time string on today's
 * UTC date, suitable for use as `constraints.evReadyBy`.
 *
 * @param minutesFromMidnight  Minutes from midnight (0–1439).
 * @param referenceDate  The date to anchor the time to (UTC midnight used).
 */
export function minutesToIsoTime(minutesFromMidnight: number, referenceDate: Date): string {
  const midnight = new Date(referenceDate);
  midnight.setUTCHours(0, 0, 0, 0);
  return new Date(midnight.getTime() + minutesFromMidnight * 60_000).toISOString();
}
