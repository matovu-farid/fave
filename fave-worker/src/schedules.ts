export function isHourlyMaintenanceTick(scheduledTime: number): boolean {
  return new Date(scheduledTime).getUTCMinutes() === 0
}
