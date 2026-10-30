// 做梦：哪一晚、文件格式、记忆碎片、整理长度、第二天只带一次、梦话、右键「她的梦」
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { nightOf, readDreams, appendDream, memoryFragments, dreamPrompt, tidyDream, dreamContext, sleepTalk, DREAM_MAX } from '../src/main/core/dreams.js'
import { createPluginHost } from '../src/main/core/plugin-host.js'
import { pathsFor } from '../src/main/core/paths.js'
import dreamsPlugin from '../src/main/plugins/dreams/index.js'

const at = (d, h, m = 0) => new Date(2026, 9, d, h, m)

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dreams-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return pathsFor(root)
}

test('哪一晚：晚上 11 点和第二天凌晨 3 点是同一晚；中午以后算新的一晚', () => {
  assert.equal(nightOf(at(28, 23).getTime()), nightOf(at(29, 3).getTime()))
  assert.notEqual(nightOf(at(29, 3).getTime()), nightOf(at(29, 13).getTime()))
})

test('存梦：有标题和「梦不是真的」说明；读回来按时间；和日记是两个文件', (t) => {
  const p = tmp(t)
  appendDream(p.dreams, { at: at(29, 3, 12), text: '我梦见自己变成了一碗白米饭。' })
  appendDream(p.dreams, { at: at(30, 2, 5), text: '第二个梦。' })
  const s = fs.readFileSync(p.dreams, 'utf8')
  assert.match(s, /^# 她的梦/)
  assert.match(s, /梦不是真的发生过/)
  assert.match(s, /## 2026-10-29 03:12\n我梦见自己变成了一碗白米饭。/)
  assert.deepEqual(readDreams(p.dreams).map((d) => d.at), ['2026-10-29 03:12', '2026-10-30 02:05'])
  assert.notEqual(p.dreams, p.diary)
  assert.ok(p.dreams.endsWith(path.join('.dsh', 'whale-dreams.md')))
})

test('记忆碎片：日记和聊天里的短句，打乱，表情包不要；提示里要求 100～300 字、有点荒诞', () => {
  const f = memoryFragments({
    diary: '# 10-28\n今天刷到一只会弹琴的猫。主人说他不吃香菜！',
    chat: [{ role: 'user', text: '我明天要考试' }, { role: 'assistant', kind: 'sticker', text: '[表情：白米饭]' }, { role: 'event', text: '工具：remember' }],
    random: () => 0.3,
  })
  assert.deepEqual(new Set(f), new Set(['今天刷到一只会弹琴的猫', '主人说他不吃香菜', '我明天要考试']))
  const prompt = dreamPrompt(f)
  assert.match(prompt, /有点荒诞/)
  assert.match(prompt, /100 到 300 字/)
})

test('整理：去标题引号；太长在句号处截；太短（没写好）不要', () => {
  assert.equal(tidyDream('# 梦\n「我在云上吃饭。' + '饭'.repeat(100) + '」'), '我在云上吃饭。' + '饭'.repeat(100))
  const long = tidyDream(('我飞起来了。').repeat(80))
  assert.ok([...long].length <= DREAM_MAX + 20 && long.endsWith('。'))
  assert.equal(tidyDream('太短'), null)
})

test('第二天第一次聊天带上梦（写明不是真的、别记进小本本等），只带一次；20 小时后不带；右键「她的梦」', async (t) => {
  const p = tmp(t)
  const opened = []
  const host = createPluginHost({ bus: new EventEmitter(), log: () => {}, getConfig: () => ({ plugins: {} }), updateConfig: () => {}, services: { paths: p, openPath: (f) => opened.push(f) } })
  await host.load(dreamsPlugin)
  assert.deepEqual(host.menuItems().map((m) => [m.label, m.enabled, m.hint]), [['看看她的梦', false, '她还没做过梦']])

  appendDream(p.dreams, { at: at(29, 3), text: '我梦见主人变成了一只猫，在键盘上睡觉。' })
  const first = await host.buildSystemPrompt({ now: at(29, 10) })
  assert.match(first, /［昨晚的梦（这是梦，不是真的发生过）］/)
  assert.match(first, /主人变成了一只猫/)
  assert.match(first, /想跟主人提就提，不想提就不提/)
  assert.match(first, /不要记进小本本、我的成长、她眼中的主人/)
  assert.doesNotMatch(await host.buildSystemPrompt({ now: at(29, 10, 5) }), /昨晚的梦/, '只带一次')

  appendDream(p.dreams, { at: at(30, 2), text: '又一个梦。' + '梦'.repeat(80) })
  assert.doesNotMatch(await host.buildSystemPrompt({ now: at(31, 0) }), /昨晚的梦/, '过了 20 小时就不算昨晚的了')

  assert.equal(host.menuItems()[0].enabled, true)
  await host.clickMenu(host.menuItems()[0].id)
  assert.deepEqual(opened, [p.dreams])
})

test('梦话：做过梦就从梦里抠几个字；没做就随便嘟囔一句', () => {
  assert.equal(sleepTalk({ text: '我在云上，吃了一大碗白米饭。' }, () => 0), '唔……我在云上……')
  assert.match(sleepTalk(null, () => 0), /……/)
  assert.match(dreamContext({ text: 'x' }), /梦和现实要分开/)
})
