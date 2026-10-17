export const OPERATIONS_PAGE_SIZE = 25
export type OperationsCursor = { id: string; at: number; status: string }
export function readOperationsCursor(raw: string | undefined, status: string): OperationsCursor | null | false {
  if (!raw) return null
  if (raw.length > 600) return false
  try {
    const value = JSON.parse(atob(raw))
    return typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 160 &&
      Number.isSafeInteger(value.at) && value.at >= 0 && value.status === status ? value : false
  } catch { return false }
}
export const operationsCursor = (id: string, at: number, status: string) => btoa(JSON.stringify({ id, at, status }))
export function bounded<T>(rows: T[]) { return { items: rows.slice(0, OPERATIONS_PAGE_SIZE), hasMore: rows.length > OPERATIONS_PAGE_SIZE } }
