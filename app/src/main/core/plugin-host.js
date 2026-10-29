/**
 * 插件宿主 —— 桌宠的所有功能都是插件（连「人设」「日记」都是）。
 *
 * 一个插件长这样（详见 docs/PLUGINS.md）：
 *
 *   export default {
 *     id: 'my-plugin',              // 唯一，小写字母/数字/横杠
 *     name: '我的插件',
 *     setup(api) {                  // 可以是 async；返回的函数会在卸载时调用
 *       api.registerContext({ id, order, build })   // 往聊天的系统提示里加一段
 *       api.registerTool({ name, description, parameters, confirm, run })  // 给聊天模型一个能力
 *       api.registerMenu({ id, label, order, enabled, onClick })           // 右键菜单
 *         可选：icon（一个 emoji）、hint（灰掉时写原因，比如 'DSH 没开'）、toggle（true/false：显示成开关）；
 *         label/enabled/icon/hint/toggle 都可以是函数
 *       api.on('chat:user', fn)     // 订阅事件
 *       api.say('一句话')            // 桌宠冒气泡
 *     },
 *   }
 *
 * 一个插件出错不会拖垮别的：setup 抛错 → 记日志、标记失败、跳过；上下文/工具/菜单里抛错同理。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/
const TOOL_RE = /^[a-zA-Z0-9_-]{1,64}$/

export function createPluginHost({ bus, log = console.log, getConfig, updateConfig, services = {}, kv = null }) {
  const plugins = new Map()        // id → { meta, state: 'ok'|'failed'|'disabled', error, disposers: [] }
  const contexts = []              // { pluginId, id, order, build }
  const tools = new Map()          // name → { pluginId, name, description, parameters, confirm, run }
  const menus = []                 // { pluginId, id, label, order, enabled, icon, hint, toggle, onClick }

  function makeApi(id) {
    const rec = plugins.get(id)
    const own = (fn) => rec.disposers.push(fn)
    const api = {
      id,
      log: (...a) => log(`[${id}]`, ...a),
      services,
      /** 本插件的小状态（存在 state.json 里，重启还在）：store.get(key, 默认值) / store.set(key, 值) */
      store: kv ? kv.scope(id) : (() => { const m = new Map(); return { get: (k, d) => (m.has(k) ? m.get(k) : d), set: (k, v) => m.set(k, v) } })(),
      /** 本插件自己的设置（存在 config.json 的 plugins.settings[id] 里） */
      settings: {
        get: () => structuredClone(getConfig().plugins?.settings?.[id] ?? {}),
        set: (patch) => updateConfig({ plugins: { settings: { [id]: { ...(getConfig().plugins?.settings?.[id] ?? {}), ...patch } } } }),
      },
      registerContext({ id: cid, order = 50, build }) {
        if (typeof build !== 'function') throw new Error('registerContext 需要 build 函数')
        const c = { pluginId: id, id: `${id}/${cid ?? contexts.length}`, order, build }
        contexts.push(c)
        own(() => { const i = contexts.indexOf(c); if (i >= 0) contexts.splice(i, 1) })
      },
      registerTool(t) {
        if (!TOOL_RE.test(t?.name ?? '')) throw new Error('工具名只能用字母数字下划线横杠：' + t?.name)
        if (tools.has(t.name)) throw new Error(`工具名重复：${t.name}（已被 ${tools.get(t.name).pluginId} 占用）`)
        if (typeof t.run !== 'function') throw new Error('registerTool 需要 run 函数')
        tools.set(t.name, { pluginId: id, parameters: { type: 'object', properties: {} }, ...t })
        own(() => { if (tools.get(t.name)?.pluginId === id) tools.delete(t.name) })
      },
      // icon / hint / toggle 是后加的可选项：旧写法（只有 label / enabled）照样能用
      registerMenu({ id: mid, label, order = 50, enabled, icon, hint, toggle, onClick }) {
        const m = { pluginId: id, id: `${id}/${mid}`, label, order, enabled, icon, hint, toggle, onClick }
        menus.push(m)
        own(() => { const i = menus.indexOf(m); if (i >= 0) menus.splice(i, 1) })
      },
      on(event, fn) {
        const safe = async (...a) => { try { await fn(...a) } catch (e) { log(`[${id}] 处理事件 ${event} 出错：`, e?.message ?? e) } }
        bus.on(event, safe)
        own(() => bus.off(event, safe))
      },
      emit: (event, payload) => bus.emit(event, payload),
      /** 桌宠冒气泡；opts: { kind, openChat: 点气泡时打开聊天（默认 true） } */
      say: (text, opts = {}) => bus.emit('pet:say', { text: String(text), from: id, ...opts }),
      /** 定时器（卸载时自动清掉） */
      every(ms, fn) {
        const t = setInterval(() => { Promise.resolve().then(fn).catch((e) => log(`[${id}] 定时任务出错：`, e?.message ?? e)) }, ms)
        own(() => clearInterval(t))
        return t
      },
      onDispose: own,
    }
    return api
  }

  async function load(mod, { source = 'builtin' } = {}) {
    const p = mod?.default ?? mod
    const id = p?.id
    if (!ID_RE.test(id ?? '')) { log(`[插件] 跳过：id 不合法（${id}）`); return null }
    if (plugins.has(id)) { log(`[插件] 跳过：id 重复（${id}）`); return null }
    const rec = { meta: { id, name: p.name ?? id, version: p.version ?? '', description: p.description ?? '', source }, state: 'ok', error: null, disposers: [] }
    plugins.set(id, rec)
    if ((getConfig().plugins?.disabled ?? []).includes(id)) { rec.state = 'disabled'; return rec }
    try {
      const ret = await p.setup?.(makeApi(id))
      if (typeof ret === 'function') rec.disposers.push(ret)
      log(`[插件] 已加载 ${id}（${source}）`)
    } catch (e) {
      rec.state = 'failed'; rec.error = String(e?.message ?? e)
      log(`[插件] ${id} 加载失败：${rec.error}`)
      dispose(id)
    }
    return rec
  }

  function dispose(id) {
    const rec = plugins.get(id)
    if (!rec) return
    for (const fn of rec.disposers.splice(0).reverse()) { try { fn() } catch {} }
  }

  /** 读 ~/.whale-companion/plugins/<名字>/index.mjs（或 index.js） */
  async function loadUserPlugins(dir) {
    let names = []
    try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() } catch { return }
    for (const name of names) {
      const entry = ['index.mjs', 'index.js'].map((f) => path.join(dir, name, f)).find((f) => fs.existsSync(f))
      if (!entry) { log(`[插件] ${name}：没有 index.mjs，跳过`); continue }
      try { await load(await import(pathToFileURL(entry).href), { source: 'user' }) }
      catch (e) { log(`[插件] ${name} 导入失败：${e?.message ?? e}`) }
    }
  }

  return {
    load,
    loadUserPlugins,
    disposeAll() { for (const id of [...plugins.keys()].reverse()) dispose(id) },
    list: () => [...plugins.values()].map((r) => ({ ...r.meta, state: r.state, error: r.error })),

    /** 组装系统提示：按 order 从小到大。固定不变的内容放小 order（命中上下文缓存更省钱） */
    async buildSystemPrompt(ctx) {
      const parts = []
      for (const c of [...contexts].sort((a, b) => a.order - b.order)) {
        try {
          const s = await c.build(ctx)
          if (s && String(s).trim()) parts.push(String(s).trim())
        } catch (e) { log(`[${c.pluginId}] 上下文 ${c.id} 出错：`, e?.message ?? e) }
      }
      return parts.join('\n\n')
    },

    /** OpenAI 格式的工具清单 */
    toolSpecs() {
      return [...tools.values()].map((t) => ({ type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.parameters } }))
    },
    getTool: (name) => tools.get(name) ?? null,

    menuItems() {
      // 每个字段都可能是插件写的函数：哪个抛错只影响这一项（label 出错显示插件 id、灰掉），不拖垮整个菜单
      const text = (v, fallback = '') => {
        try { const s = typeof v === 'function' ? v() : v; return s == null ? fallback : String(s).slice(0, 40) } catch { return null }
      }
      return [...menus].sort((a, b) => a.order - b.order).map((m) => {
        let enabled = true
        try { enabled = typeof m.enabled === 'function' ? !!m.enabled() : m.enabled !== false } catch { enabled = false }
        const label = text(m.label, m.id)
        if (label === null) log(`[${m.pluginId}] 菜单 ${m.id} 的 label 出错`)
        // toggle 没写 = 普通菜单项（undefined）；写了就只认 true/false，函数出错当成关
        let toggle
        if (m.toggle !== undefined) { try { toggle = !!(typeof m.toggle === 'function' ? m.toggle() : m.toggle) } catch { toggle = false } }
        return { id: m.id, label: label ?? m.id, enabled: enabled && label !== null, icon: text(m.icon) ?? '', hint: text(m.hint) ?? '', toggle }
      })
    },
    async clickMenu(id) {
      const m = menus.find((x) => x.id === id)
      if (!m) return
      try { await m.onClick?.() } catch (e) { log(`[${m.pluginId}] 菜单 ${id} 出错：`, e?.message ?? e) }
    },
  }
}
