import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const sourcePath = fileURLToPath(new URL('../fave-worker/src/schedules.ts', import.meta.url))

function loadScheduleHelpers() {
  const exports = {}
  const source = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  vm.runInNewContext(source, { exports, Date })
  return exports
}

test('hourly maintenance stays on the top of each UTC hour under one every-minute trigger', () => {
  const { isHourlyMaintenanceTick } = loadScheduleHelpers()
  assert.equal(isHourlyMaintenanceTick(Date.parse('2026-10-14T08:00:00.000Z')), true)
  assert.equal(isHourlyMaintenanceTick(Date.parse('2026-10-14T08:01:00.000Z')), false)
  assert.equal(isHourlyMaintenanceTick(Date.parse('2026-10-14T08:59:00.000Z')), false)
})
