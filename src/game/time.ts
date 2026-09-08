/**
 * Local-calendar helpers.
 *
 * Everything the player sees is in *their* local timezone — a walk at 23:30
 * belongs to that day, not to whatever UTC thinks. All day keys are
 * `YYYY-MM-DD` strings built from local getters, never from `toISOString()`,
 * which would silently shift the day for anyone east or west of UTC.
 */

const pad = (n: number) => String(n).padStart(2, '0')

export const DAY_MS = 86_400_000

/** Local calendar day key for a timestamp. */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local midnight at the start of a day key. */
export function startOfDay(key: string): number {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}

/** Local hour (0–23) of a timestamp. */
export function localHour(ts: number): number {
  return new Date(ts).getHours()
}

/** Day key `n` days before `key` (negative `n` moves forward). */
export function shiftDayKey(key: string, n: number): string {
  // Going through a local Date rather than arithmetic on the epoch keeps this
  // correct across daylight-saving transitions, where a day is not 24 hours.
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return dayKey(new Date(y, m - 1, d + n, 12, 0, 0, 0).getTime())
}

/** Whole days from `from` to `to`. Positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  const a = new Date(startOfDay(from))
  const b = new Date(startOfDay(to))
  // Compare at midday to stay clear of DST edges.
  a.setHours(12)
  b.setHours(12)
  return Math.round((b.getTime() - a.getTime()) / DAY_MS)
}

/** `true` when `key` is today in local time. */
export function isToday(key: string, now: number = Date.now()): boolean {
  return key === dayKey(now)
}

/** Short label for the report, e.g. "Today", "Yesterday", "Mon 8 Sep". */
export function dayLabel(key: string, now: number = Date.now()): string {
  const today = dayKey(now)
  if (key === today) return 'Today'
  if (key === shiftDayKey(today, -1)) return 'Yesterday'
  const d = new Date(startOfDay(key))
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}
