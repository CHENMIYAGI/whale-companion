// 「她眼中的我」：桌宠只读 DSH 那边写的 owner-view.md；放在人设、「我的成长」后面；右键菜单能打开
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createPluginHost } from '../src/main/core/plugin-host.js'
import { pathsFor } from '../src/main/core/paths.js'
import persona from '../src/main/plugins/persona/index.js'
import selfPlugin from '../src/main/plugins/self/index.js'
import ownerView from '../src/main/plugins/owner-view/index.js'
import { writeOwnerView } from '../../dsh-bili-whale/tools/lib/owner-view.mjs'

const now = new Date(2026, 9, 27, 21, 0)
async function setup(t, plugins = [ownerView]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-view-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const paths = pathsFor(root)
  const opened = []
  const host = createPluginHost({ bus: new EventEmitter(), log: () => {}, getConfig: () => ({ plugins: {} }), updateConfig: () => {},
    services: { paths, openPath: (f) => opened.push(f), whaleConfig: () => ({ persona: { name: '小鲸' } }) } })
  for (const p of plugins) await host.load(p)
  const write = (text) => writeOwnerView(text, { file: paths.ownerView, archiveDir: path.join(root, '.bili-ai', 'owner-view-archive') })
  return { host, paths, opened, write }
}
const view = '他说话不多，但很在意别人有没有被好好对待。累的时候回消息会变短，这时候少说两句、陪着就好。' + '他'.repeat(80)

test('还没写：上下文里没有，菜单灰着并说原因；桌宠这边没有写它的工具', async (t) => {
  const { host } = await setup(t)
  assert.equal(await host.buildSystemPrompt({ now, userText: '' }), '')
  const m = host.menuItems().find((x) => x.id === 'owner-view/view')
  assert.deepEqual([m.label, m.icon, m.enabled, m.hint], ['她眼中的我', '👀', false, '她还没写'])
  assert.deepEqual(host.toolSpecs(), [])
})

test('DSH 那边写了：上下文里有，写明只校准语气、不念出来；菜单打开这份文件', async (t) => {
  const { host, paths, opened, write } = await setup(t)
  assert.equal(write(view).ok, true)
  const prompt = await host.buildSystemPrompt({ now, userText: '' })
  assert.match(prompt, /［你眼中的主人］[\s\S]*校准语气和态度[\s\S]*不要念出来[\s\S]*在我看来你是[\s\S]*累的时候回消息会变短/)
  const m = host.menuItems().find((x) => x.id === 'owner-view/view')
  assert.equal(m.enabled, true)
  await host.clickMenu('owner-view/view')
  assert.deepEqual(opened, [paths.ownerView])
})

test('顺序：人设 → 我的成长 → 她眼中的主人 → 聊天规矩', async (t) => {
  const { host, write } = await setup(t, [persona, selfPlugin, ownerView])
  await host.getTool('grow').run({ text: '我发现我刷到猫会停下来', source: 'self' }, {})
  write(view)
  const p = await host.buildSystemPrompt({ now, userText: '' })
  const at = (s) => p.indexOf(s)
  assert.ok(at('［身份］') >= 0 && at('［身份］') < at('［你自己的发现］'), p)
  assert.ok(at('［你自己的发现］') < at('［你眼中的主人］'))
  assert.ok(at('［你眼中的主人］') < at('［在桌宠里聊天］'))
})

test('文件被改得很长也只带前 600 字', async (t) => {
  const { host, paths } = await setup(t)
  fs.mkdirSync(path.dirname(paths.ownerView), { recursive: true })
  fs.writeFileSync(paths.ownerView, '长'.repeat(2000))
  const p = await host.buildSystemPrompt({ now, userText: '' })
  assert.equal([...p.split('\n').at(-1)].length, 600)
})
