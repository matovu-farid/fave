export function daysBetween(startDate: string, endDate: string): number {
  return (Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / 86_400_000
}

export function kampalaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function parseTripDateRange(
  startDate: unknown,
  endDate: unknown,
  now: Date = new Date(),
): { startDate: string; endDate: string } | null {
  if (
    !isCalendarDate(startDate) || !isCalendarDate(endDate) ||
    startDate < kampalaToday(now) || startDate >= endDate || daysBetween(startDate, endDate) > 7
  ) {
    return null
  }

  return { startDate, endDate }
}
