// 不开桌宠、不花钱，试跑一个插件：用真实的插件系统 + 聊天引擎，模型是假的（按你给的参数调用工具）
//
// 用法（在 app/ 目录下）：
//   node test/try-plugin.mjs <插件文件> [工具名 '参数JSON'] [工具名 '参数JSON'] ...
// 例：
//   node test/try-plugin.mjs ../examples/plugins/memory/index.mjs remember '{"source":"owner","text":"不吃香菜"}' forget '{"id":1}'
//
// 会打印：每次工具调用返回给模型的结果、最后插件往说明书里加的内容、右键菜单项。
// 插件的 store 存在一个临时目录里，跑完就删，不会碰你真正的桌宠数据。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { pathToFileURL } from 'node:url'
import { createPluginHost } from '../src/main/core/plugin-host.js'
import { createChat } from '../src/main/core/chat.js'
import { createChatLog } from '../src/main/core/chat-log.js'
import { createKv } from '../src/main/core/kv.js'

const [file, ...rest] = process.argv.slice(2)
if (!file) { console.error('用法: node test/try-plugin.mjs <插件文件> [工具名 \'参数JSON\'] ...'); process.exit(2) }
const calls = []
for (let i = 0; i < rest.length; i += 2) {
  try { calls.push([rest[i], JSON.parse(rest[i + 1] ?? '{}')]) } catch { console.error(`参数不是合法 JSON：${rest[i + 1]}`); process.exit(2) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'try-plugin-'))
fs.mkdirSync(path.join(dir, 'app'))
const bus = new EventEmitter()
bus.on('pet:say', ({ text }) => console.log(`  （桌宠冒气泡：「${text}」）`))
const services = {
  paths: { app: path.join(dir, 'app') },
  openPath: (f) => console.log(`  （打开文件 ${path.basename(f)}）\n` + fs.readFileSync(f, 'utf8').split('\n').map((l) => '    │ ' + l).join('\n')),
  openExternal: (u) => console.log(`  （打开网页 ${u}）`),
}
const kv = createKv(path.join(dir, 'state.json'))
const host = createPluginHost({ bus, log: (...a) => console.log('  [日志]', ...a), getConfig: () => ({}), updateConfig: () => {}, services, kv })
const rec = await host.load(await import(pathToFileURL(path.resolve(file)).href))
if (!rec || rec.state !== 'ok') { console.log('插件没有加载成功：' + (rec?.error ?? '看上面的日志')); process.exit(1) }
console.log(`工具：${host.toolSpecs().map((t) => t.function.name).join('、') || '（没有）'}`)

for (const [name, args] of calls) {
  let round = 0, result = null
  const llm = { async *streamChat({ messages }) {
    if (++round === 1) yield { type: 'tool_calls', calls: [{ id: 'c1', name, arguments: JSON.stringify(args) }] }
    else { result = messages.at(-1).content; yield { type: 'text', delta: 'ok' } }
    yield { type: 'done' }
  } }
  const ui = { start() {}, delta() {}, end() {}, error() {}, tool() {}, confirm: async () => true }
  await createChat({ host, chatLog: createChatLog({ file: path.join(dir, 'chat.jsonl') }), bus, ui, llm,
    getConfig: () => ({ llm: {}, chat: {} }), getApiKey: () => 'x', log: () => {} }).send('（测试）')
  console.log(`\n${name}(${JSON.stringify(args)})\n  → ${result}`)
}

const prompt = await host.buildSystemPrompt({ now: new Date() })
console.log('\n说明书里这个插件加的内容：\n' + (prompt ? prompt.split('\n').map((l) => '  ' + l).join('\n') : '  （空）'))
const menus = host.menuItems()
if (menus.length) {
  console.log('\n右键菜单：')
  for (const m of menus) {
    console.log(`  ${m.enabled ? '·' : '×'} ${m.label}${m.enabled ? '' : '（灰色）'}`)
    if (m.enabled) await host.clickMenu(m.id)
  }
}
kv.flush()
fs.rmSync(dir, { recursive: true, force: true })
