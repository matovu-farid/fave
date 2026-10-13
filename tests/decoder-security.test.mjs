import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

test('query-string decodes a long malformed UTF-8 query without unbounded recursion', () => {
  const malformed = '%F0%80%80%80'.repeat(100)
  const script = "process.stdout.write(JSON.stringify(require('query-string').parse('value=' + process.argv[1] + '&normal=Zo%C3%AB+Khan')))"
  const result = spawnSync(process.execPath, ['-e', script, malformed], {
    encoding: 'utf8',
    timeout: 1_500,
  })

  assert.equal(result.error, undefined, 'query parsing should finish before the timeout')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    value: malformed,
    normal: 'Zoë Khan',
  })
})
