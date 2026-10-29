// DeepSeek（OpenAI 兼容格式）的流式调用。换成别家兼容接口只改 baseUrl / model。
//
// streamChat() 产出事件：
//   { type: 'text', delta }                       一段回复文字
//   { type: 'tool_calls', calls: [{id,name,arguments}] }  模型要调用工具（arguments 是 JSON 字符串）
//   { type: 'done', finishReason, usage }
// 推理模型的 reasoning_content（思考过程）不往外吐 —— 桌宠里只显示她说的话。

export class LlmError extends Error {
  constructor(message, { status = 0, code = '' } = {}) { super(message); this.status = status; this.code = code }
}

/** 把接口错误翻译成人话（聊天窗口直接显示这句） */
export function explainError(e) {
  const s = e?.status
  if (e?.name === 'AbortError') return '已停止'
  if (s === 401) return 'API key 不对（或已失效），去设置里重新填一下'
  if (s === 402) return 'DeepSeek 账户余额不足'
  if (s === 429) return '请求太频繁了，等一会儿再说'
  if (s === 400) return '请求被拒绝：' + (e.message || '参数不对（模型名对吗？）')
  if (s >= 500) return 'DeepSeek 那边出错了，稍后再试'
  if (e?.code === 'ENOTFOUND' || e?.code === 'ECONNREFUSED' || /fetch failed/i.test(e?.message ?? '')) return '连不上 DeepSeek（网络或地址有问题）'
  return '出错了：' + String(e?.message ?? e).slice(0, 160)
}

const trimSlash = (u) => String(u ?? '').replace(/\/+$/, '')

async function failFrom(res) {
  let msg = `HTTP ${res.status}`
  try { const j = await res.json(); msg = j?.error?.message || j?.message || msg } catch {}
  throw new LlmError(msg, { status: res.status })
}

export async function listModels({ baseUrl, apiKey, fetchImpl = fetch, signal }) {
  const res = await fetchImpl(trimSlash(baseUrl) + '/models', { headers: { authorization: `Bearer ${apiKey}` }, signal })
  if (!res.ok) await failFrom(res)
  const j = await res.json()
  return (j?.data ?? []).map((m) => m.id).filter(Boolean).sort()
}

/** 逐行解析 SSE（data: {...}） */
async function* sseLines(body) {
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '')
      buf = buf.slice(i + 1)
      if (line.startsWith('data:')) yield line.slice(5).trim()
    }
  }
  buf += decoder.decode()
  for (const line of buf.split(/\r?\n/)) if (line.startsWith('data:')) yield line.slice(5).trim()
}

/**
 * thinking：DeepSeek 的思考模式开关。DeepSeek 默认是开的，而开着时只要某次请求带了 tools，
 * 之后每次请求都得把历史里的 reasoning_content 原样回传，否则 400（见 api-docs.deepseek.com/zh-cn/guides/thinking_mode/）。
 * 我们不保存 reasoning_content，所以默认传 false = 明确关掉。null = 不带这个字段（给不认识它的别家接口用）。
 */
export async function* streamChat({ baseUrl, apiKey, model, messages, tools, maxTokens = 800, thinking = false, signal, fetchImpl = fetch }) {
  if (!apiKey) throw new LlmError('还没填 API key', { status: 401 })
  if (!model) throw new LlmError('还没选模型', { status: 400 })
  const body = { model, messages, stream: true, max_tokens: maxTokens }
  if (thinking !== null) body.thinking = { type: thinking ? 'enabled' : 'disabled' }
  if (tools?.length) { body.tools = tools; body.tool_choice = 'auto' }
  const res = await fetchImpl(trimSlash(baseUrl) + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) await failFrom(res)

  const calls = new Map()   // index → {id,name,arguments}
  let finishReason = null
  let usage = null
  for await (const data of sseLines(res.body)) {
    if (!data || data === '[DONE]') continue
    let j
    try { j = JSON.parse(data) } catch { continue }
    if (j.error) throw new LlmError(j.error.message ?? '流中出错', { status: 500 })
    if (j.usage) usage = j.usage
    const choice = j.choices?.[0]
    if (!choice) continue
    const d = choice.delta ?? {}
    if (typeof d.content === 'string' && d.content) yield { type: 'text', delta: d.content }
    for (const tc of d.tool_calls ?? []) {
      const idx = tc.index ?? 0
      const cur = calls.get(idx) ?? { id: '', name: '', arguments: '' }
      if (tc.id) cur.id = tc.id
      if (tc.function?.name) cur.name += tc.function.name
      if (tc.function?.arguments) cur.arguments += tc.function.arguments
      calls.set(idx, cur)
    }
    if (choice.finish_reason) finishReason = choice.finish_reason
  }
  if (calls.size) yield { type: 'tool_calls', calls: [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([i, c]) => ({ ...c, id: c.id || `call_${i}` })) }
  yield { type: 'done', finishReason, usage }
}
