// 思考模式开关：确认发给 DeepSeek 的请求体里带了 thinking。不联网，用假 fetch 记下每次请求。
// 运行：cd app && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { streamChat } from '../src/main/core/llm.js'
import { createChat } from '../src/main/core/chat.js'
import { DEFAULT_CONFIG } from '../src/main/core/config.js'

// 把一串 SSE 数据包装成 fetch 的返回值
function sse(...chunks) {
  const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
const say = (text) => sse({ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] })

// 假 fetch：记下请求体，按顺序交出准备好的回答
function fakeFetch(...replies) {
  const bodies = []
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body))
    return replies.shift() ?? say('（没准备回答）')
  }
  return { fetchImpl, bodies }
}

async function drain(gen) {
  const out = []
  for await (const ev of gen) out.push(ev)
  return out
}

const base = { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test', model: 'deepseek-flash', messages: [{ role: 'user', content: '在吗' }] }

test('默认关掉思考模式：thinking.type = disabled', async () => {
  const { fetchImpl, bodies } = fakeFetch(say('在的'))
  const events = await drain(streamChat({ ...base, fetchImpl }))
  assert.deepEqual(bodies[0].thinking, { type: 'disabled' })
  assert.equal(events.find((e) => e.type === 'text')?.delta, '在的')
})

test('thinking: true → enabled；null → 请求里不带这个字段', async () => {
  const on = fakeFetch(say('嗯'))
  await drain(streamChat({ ...base, thinking: true, fetchImpl: on.fetchImpl }))
  assert.deepEqual(on.bodies[0].thinking, { type: 'enabled' })

  const omit = fakeFetch(say('嗯'))
  await drain(streamChat({ ...base, thinking: null, fetchImpl: omit.fetchImpl }))
  assert.equal('thinking' in omit.bodies[0], false)
})

test('聊天引擎按配置 llm.thinking 发请求，带工具的多轮里每次都是 disabled', async () => {
  assert.equal(DEFAULT_CONFIG.llm.thinking, false)

  // 第 1 次：模型要调用 remember 工具；第 2 次：说话
  const { fetchImpl, bodies } = fakeFetch(
    sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'remember', arguments: '{"text":"不吃香菜"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
    say('记下了！'),
  )
  const rows = []
  const chatLog = { recent: () => [], append: (r) => { const rec = { id: String(rows.length), at: '', ...r }; rows.push(rec); return rec } }
  const tool = { name: 'remember', label: '记在小本本上', run: async () => ({ ok: true }) }
  const host = {
    buildSystemPrompt: async () => '你是她',
    toolSpecs: () => [{ type: 'function', function: { name: 'remember', description: '记一件事', parameters: { type: 'object', properties: {} } } }],
    getTool: (name) => (name === 'remember' ? tool : null),
  }
  const ui = { start() {}, delta() {}, end() {}, error() {}, tool() {}, confirm: async () => true }
  const chat = createChat({
    host, chatLog, bus: new EventEmitter(), ui, log: () => {},
    getConfig: () => structuredClone({ ...DEFAULT_CONFIG, llm: { ...DEFAULT_CONFIG.llm, model: 'deepseek-flash' } }),
    getApiKey: () => 'sk-test',
    llm: { streamChat: (args) => streamChat({ ...args, fetchImpl }) },
  })

  const res = await chat.send('帮我记一下：我不吃香菜')
  assert.equal(res.ok, true)
  assert.equal(bodies.length, 2)
  assert.ok(bodies[0].tools?.length, '第 1 次请求带了 tools')
  for (const b of bodies) assert.deepEqual(b.thinking, { type: 'disabled' })
  assert.equal(rows.at(-1).text, '记下了！')
})
