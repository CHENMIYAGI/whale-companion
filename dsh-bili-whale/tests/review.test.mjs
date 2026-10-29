process.env.BILI_TRAFFIC_TEST = '1'
import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-review-'))
process.env.USERPROFILE = process.env.HOME = home
delete process.env.BILI_NO_CACHE
const dataDir = path.join(home, '.bili-ai')
fs.mkdirSync(dataDir)
after(() => fs.rmSync(home, { recursive: true, force: true }))
beforeEach(() => { for (const file of fs.readdirSync(dataDir)) fs.unlinkSync(path.join(dataDir, file)) })
const { apiGet } = await import('../tools/lib/bili-api.mjs')
const view = 'https://api.bilibili.com/x/web-interface/wbi/view?bvid=BV1234567890'
const response = data => new Response(JSON.stringify({ code: 0, data }))

test('cache is separated by account without persisting raw cookies', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => response({ mid: ++calls }))
  const url = 'https://api.bilibili.com/x/web-interface/nav'
  assert.equal((await apiGet(url, { cookie: 'SESSDATA=account-a' })).data.mid, 1)
  assert.equal((await apiGet(url, { cookie: 'SESSDATA=account-b' })).data.mid, 2)
  assert.equal((await apiGet(url, { cookie: 'SESSDATA=account-a' })).data.mid, 1)
  assert.doesNotMatch(fs.readFileSync(path.join(dataDir, 'api-cache.json'), 'utf8'), /account-a|account-b/)
})

test('expiring media URLs and follow relations are never cached', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => response({ sequence: ++calls }))
  for (const endpoint of ['/x/player/wbi/v2', '/x/player/wbi/playurl', '/x/relation']) {
    const a = await apiGet('https://api.bilibili.com'+endpoint)
    const b = await apiGet('https://api.bilibili.com'+endpoint)
    assert.notEqual(a.data.sequence, b.data.sequence, endpoint)
  }
})

test('noCache cannot fall back to stale data during a circuit break', async t => {
  t.mock.method(globalThis, 'fetch', async () => response({ title: 'cached' }))
  await apiGet(view)
  fs.writeFileSync(path.join(dataDir, 'api-ban.json'), JSON.stringify({ until: Date.now()+60000 }))
  const result = await apiGet(view, {}, { noCache: true })
  assert.notEqual(result.code, 0)
  assert.equal(result._cached, undefined)
})

test('cache keys distinguish escaped delimiters from separate parameters', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => response({ sequence: ++calls }))
  const a = await apiGet(view+'&foo=a%26z%3Db')
  const b = await apiGet(view+'&foo=a&z=b')
  assert.notEqual(a.data.sequence, b.data.sequence)
})

test('parallel API requests retain minimum request spacing', async t => {
  const starts = []
  t.mock.method(globalThis, 'fetch', async () => { starts.push(Date.now()); return response({}) })
  await Promise.all([1,2,3].map(i => apiGet('https://api.bilibili.com/x/v2/reply?oid='+i)))
  for (let i=1;i<starts.length;i++) assert.ok(starts[i]-starts[i-1]>=280, JSON.stringify(starts))
})

test('successful nav does not reset another endpoint risk backoff', async t => {
  fs.writeFileSync(path.join(dataDir, 'api-ban.json'), JSON.stringify({ until: 0, streak: 2, endpoint: '/x/web-interface/wbi/view' }))
  t.mock.method(globalThis, 'fetch', async () => response({}))
  await apiGet('https://api.bilibili.com/x/web-interface/nav')
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'api-ban.json'))).streak, 2)
})

test('third repeated HTTP risk response backs off for twenty minutes', async t => {
  fs.writeFileSync(path.join(dataDir,'api-ban.json'), JSON.stringify({until:0,streak:2,endpoint:'/x/v2/reply'}))
  t.mock.method(globalThis,'fetch',async()=>new Response('',{status:412}))
  const now=Date.now()
  await apiGet('https://api.bilibili.com/x/v2/reply')
  const ban=JSON.parse(fs.readFileSync(path.join(dataDir,'api-ban.json')))
  assert.equal(ban.streak,3);assert.ok(ban.until-now>=20*60000 && ban.until-now<20*60000+2000)
})
