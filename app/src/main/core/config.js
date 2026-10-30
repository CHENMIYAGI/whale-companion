// 桌宠配置：~/.whale-companion/config.json
// API key 不明文落盘：有 secretBox（Electron safeStorage）就加密存，没有就只给当前用户可读（0600）。
import { readJson, writeJsonAtomic } from './files.js'

export const DEFAULT_CONFIG = {
  llm: {
    baseUrl: 'https://api.deepseek.com',
    model: '',            // 空 = 第一次打开时从 /models 里选
    maxTokens: 800,
    // DeepSeek 思考模式。开着时带工具的多轮对话要回传 reasoning_content，我们没做，所以默认关。
    // true = 打开（目前和工具一起用会 400）；null = 请求里不带这个字段（接别家兼容接口时用）
    thinking: false,
    // 看主人发来的图用的模型（每张图只看一次，按 hash 缓存）；不可用时退回用文件名
    visionModel: 'deepseek-v4-flash-vision-exp',
  },
  chat: {
    historyMessages: 40,  // 每次带上最近多少条聊天
    maxToolRounds: 4,     // 一句话里最多连着调用几轮工具
    // 主人没回的时候她接着说：她说完等 minMinutes～maxMinutes 分钟（随机），主人没回最多连着补 maxRounds 轮
    followUp: { enabled: true, maxRounds: 2, minMinutes: 2, maxMinutes: 5 },
  },
  pet: { x: null, y: null, alwaysOnTop: true, idleExtraMin: 3, idleExtraMax: 8,   // 待机小动作每隔几分钟一次（随机落在这个范围里）
    entrance: true, exit: true },   // 启动时淡入 + 挥手打招呼；退出时挥手 + 淡出（设置里能关）
  // 忙碌感知的开关（2026-10-28）：manual = 右键 / 托盘里的「我在忙」；fullscreen = 前台全屏算在忙。离开电脑 10 分钟一直算「不在」
  busy: { manual: true, fullscreen: true },
  busyManual: null,   // 手动「我在忙」到什么时候：{ until: 毫秒 } / { until: null }（直到我说）/ null
  // 主动开口（core/proactive.js）：至少隔 minGapMinutes 分钟、每天最多 dailyMax 次、quietStart 点到 quietEnd 点不开口
  proactive: { enabled: true, minGapMinutes: 60, dailyMax: 4, quietStart: 23, quietEnd: 8 },
  // 一起看（2026-10-30）：invite = 主动开口时可以邀请一起看；overFullscreen = 一起看时全屏不算忙、桌宠浮在全屏窗口上面
  watch: { invite: true, overFullscreen: true },
  plugins: { disabled: [], settings: {} },
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
function merge(base, over) {
  const out = { ...base }
  for (const [k, v] of Object.entries(over ?? {})) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v
  return out
}

export function createConfig({ file, secretBox = null }) {
  let cache = null
  const load = () => {
    const raw = readJson(file, {}) ?? {}
    cache = merge(DEFAULT_CONFIG, raw)
    return cache
  }
  const save = (next) => {
    writeJsonAtomic(file, next, { mode: 0o600 })
    cache = merge(DEFAULT_CONFIG, next)
  }
  return {
    get() { return structuredClone(cache ?? load()) },
    /** 浅层按段合并：update({ llm: { model } }) */
    update(patch) {
      const raw = readJson(file, {}) ?? {}
      const next = merge(raw, patch)
      save(next)
      return this.get()
    },
    getApiKey() {
      const raw = readJson(file, {}) ?? {}
      const s = raw.secrets?.llmApiKey
      if (!s) return ''
      if (s.enc === 'safeStorage') {
        if (!secretBox) return ''
        try { return secretBox.decrypt(s.value) } catch { return '' }
      }
      return String(s.value ?? '')
    },
    setApiKey(key) {
      const raw = readJson(file, {}) ?? {}
      const value = String(key ?? '').trim()
      const secrets = { ...(raw.secrets ?? {}) }
      if (!value) delete secrets.llmApiKey
      else if (secretBox) secrets.llmApiKey = { enc: 'safeStorage', value: secretBox.encrypt(value) }
      else secrets.llmApiKey = { enc: 'none', value }
      save({ ...raw, secrets })
    },
    hasApiKey() { return !!this.getApiKey() },
    reload: load,
  }
}
