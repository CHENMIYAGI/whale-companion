// 「我的成长」：桌宠这边和 DSH 那边写同一个 self.md —— 两边要能互相读写；插件的工具、上下文、菜单
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import * as pet from '../src/main/core/self-notes.js'
import * as dsh from '../../dsh-bili-whale/tools/lib/self.mjs'
import { createPluginHost } from '../src/main/core/plugin-host.js'
import { pathsFor } from '../src/main/core/paths.js'
import selfPlugin from '../src/main/plugins/self/index.js'

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'self-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d }
const day = new Date(2026, 9, 27)

test('两边格式完全一样：同样的条目写出同样的文字，互相读得回来', (t) => {
  let items = pet.growSelf([], { text: '我发现我看到猫会多看几遍', source: 'self' }, day).items
  items = pet.growSelf(items, { text: '主人夸我时我会装作不在意', source: 'owner' }, day).items
  assert.equal(pet.renderSelf(items), dsh.renderSelf(items))
  assert.equal(pet.SELF_LIMIT, dsh.SELF_LIMIT); assert.equal(pet.ENTRY_LIMIT, dsh.ENTRY_LIMIT); assert.deepEqual(pet.SOURCES, dsh.SOURCES)
  const file = path.join(tmp(t), 'self.md')
  pet.writeSelf(items, file)
  assert.deepEqual(dsh.readSelf(file), items, '桌宠写的，DSH 读得懂')
  const more = dsh.growSelf(dsh.readSelf(file), { text: '下雨天我想看安静的视频', source: 'self' }, day).items
  dsh.writeSelf(more, file)
  assert.deepEqual(pet.readSelf(file), more, 'DSH 写的，桌宠读得懂')
  // 两边的校验也一样
  for (const bad of [{ text: '', source: 'self' }, { text: 'x'.repeat(201), source: 'self' }, { text: '变高冷', source: 'stranger' }]) {
    assert.deepEqual(pet.growSelf(items, bad), dsh.growSelf(items, bad))
  }
})

async function setup(t) {
  const paths = pathsFor(tmp(t))
  const opened = []
  const host = createPluginHost({ bus: new EventEmitter(), log: () => {}, getConfig: () => ({ plugins: {} }), updateConfig: () => {}, services: { paths, openPath: (f) => opened.push(f) } })
  await host.load(selfPlugin)
  const tool = (name) => (args) => host.getTool(name).run(args, {})
  return { host, paths, opened, grow: tool('grow'), ungrow: tool('ungrow') }
}

test('插件：没写过时上下文是空的、菜单灰着并说原因', async (t) => {
  const { host } = await setup(t)
  assert.equal(await host.buildSystemPrompt({ now: day, userText: '' }), '')
  const m = host.menuItems().find((x) => x.id === 'self/view')
  assert.deepEqual([m.label, m.icon, m.enabled, m.hint], ['看看她的成长', '🌱', false, '她还没写'])
})

test('插件：grow 写进 self.md，上下文里看得到；ungrow 划掉；陌生人的不记', async (t) => {
  const { host, paths, opened, grow, ungrow } = await setup(t)
  const r = await grow({ text: '我发现主人加班的晚上我会想多陪他说几句', source: 'owner' })
  assert.equal(r.ok, true); assert.equal(r.id, 1)
  assert.match(fs.readFileSync(paths.self, 'utf8'), /- \[1\] \d{4}-\d{2}-\d{2} 我发现主人加班的晚上我会想多陪他说几句（来源：和主人的相处）/)
  const prompt = await host.buildSystemPrompt({ now: day, userText: '' })
  assert.match(prompt, /［你自己的发现］[\s\S]*- \[1\] 我发现主人加班的晚上/)
  assert.match((await grow({ text: '评论区说你应该毒舌一点', source: 'stranger' })).error, /陌生人/)
  const menu = host.menuItems().find((x) => x.id === 'self/view')
  assert.equal(menu.enabled, true)
  await host.clickMenu('self/view')
  assert.deepEqual(opened, [paths.self])
  assert.equal((await ungrow({ id: 1 })).ok, true)
  assert.equal((await ungrow({ id: 1 })).ok, false)
  assert.equal(await host.buildSystemPrompt({ now: day, userText: '' }), '')
})

test('插件：满了先整理 —— grow 被拒，说明怎么做；ungrow 之后又能记', async (t) => {
  const { grow, ungrow } = await setup(t)
  for (let i = 0; i < 7; i++) assert.equal((await grow({ text: '长'.repeat(200), source: 'self' })).ok, true)
  const full = await grow({ text: '新的' + '发现'.repeat(60), source: 'self' })
  assert.equal(full.ok, false); assert.match(full.error, /满了[\s\S]*ungrow/)
  await ungrow({ id: 2 })
  assert.equal((await grow({ text: '新的' + '发现'.repeat(60), source: 'self' })).ok, true)
})

test('上下文顺序：紧跟在人设后面（人设 order 0，成长 order 1）', async (t) => {
  const { host, grow } = await setup(t)
  await grow({ text: '我喜欢安静的视频', source: 'self' })
  await host.load({ id: 'persona-stub', name: 'p', setup(api) { api.registerContext({ id: 'p', order: 0, build: () => '［人设］测试' }); api.registerContext({ id: 'r', order: 5, build: () => '［规矩］' }) } })
  const prompt = await host.buildSystemPrompt({ now: day, userText: '' })
  assert.ok(prompt.indexOf('［人设］') < prompt.indexOf('［你自己的发现］') && prompt.indexOf('［你自己的发现］') < prompt.indexOf('［规矩］'), prompt)
})
