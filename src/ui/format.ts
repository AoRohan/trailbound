export const int = (n: number): string => Math.round(n).toLocaleString()

/** Paces read as distance; ~0.75 m a pace is a reasonable walking stride. */
export function distance(paces: number): string {
  const metres = paces * 0.75
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`
}

export function percent(value: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, (value / total) * 100))
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}

/** "1.15×" for a multiplier, or null when it does nothing. */
export function multiplier(value: number): string | null {
  if (Math.abs(value - 1) < 0.005) return null
  return `${value.toFixed(2).replace(/0$/, '')}×`
}
