// 桌宠的小状态（读到 outbox 第几条、上次记反馈的时间……），按插件分区存在 state.json
import { readJson, writeJsonAtomic } from './files.js'

export function createKv(file) {
  let data = readJson(file, {}) ?? {}
  let timer = null
  const flush = () => { timer = null; try { writeJsonAtomic(file, data) } catch {} }
  return {
    scope(ns) {
      return {
        get: (key, fallback = undefined) => (data[ns]?.[key] ?? fallback),
        set: (key, value) => {
          data[ns] = { ...(data[ns] ?? {}), [key]: value }
          if (!timer) timer = setTimeout(flush, 200)   // 合并连续写
        },
      }
    },
    flush() { if (timer) { clearTimeout(timer); flush() } },
  }
}
