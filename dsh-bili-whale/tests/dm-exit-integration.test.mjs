import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
test('real dm-await subprocess exit contract drives scheduler polling and acknowledgement',()=>{
  const r=spawnSync(process.execPath,[fileURLToPath(new URL('./helpers/dm-exit-integration.mjs',import.meta.url))],{encoding:'utf8',timeout:30000})
  assert.equal(r.status,0,r.stdout+r.stderr)
  assert.match(r.stdout,/PASS real CLI/)
})
