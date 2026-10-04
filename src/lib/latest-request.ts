export function createLatestRequestGuard() {
  let revision = 0

  return {
    begin() {
      revision += 1
      return revision
    },
    isCurrent(requestRevision: number) {
      return requestRevision === revision
    },
    invalidate() {
      revision += 1
    },
  }
}
