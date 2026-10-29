// 连 DSH 里那条鱼的本机接口（dsh-bili-whale 打过补丁后会开）
// 端口和令牌每次 DSH 启动都会变，所以每次请求前都重读 whale-bridge.json（文件很小）。
import { readJson } from './files.js'

export function createBridgeClient({ file, fetchImpl = (...a) => fetch(...a), timeoutMs = 5000 }) {
  async function request(method, path, body) {
    const info = readJson(file)
    if (!info?.port || !info?.token) return { ok: false, offline: true, error: 'DSH 没在运行（或插件没打补丁）' }
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetchImpl(`http://127.0.0.1:${info.port}${path}`, {
        method,
        headers: { authorization: `Bearer ${info.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      })
      let data = null
      try { data = await res.json() } catch {}
      if (!res.ok) return { ok: false, status: res.status, error: data?.error ?? `HTTP ${res.status}`, data }
      return { ok: true, status: res.status, data }
    } catch (e) {
      // 连不上 = DSH 关了但文件还在（比如崩溃退出）
      return { ok: false, offline: true, error: 'DSH 没在运行' }
    } finally { clearTimeout(t) }
  }
  return {
    status: () => request('GET', '/v1/status'),
    enqueue: (job) => request('POST', '/v1/jobs', job),
    job: (id) => request('GET', `/v1/jobs/${encodeURIComponent(id)}`),
    feedback: (note) => request('POST', '/v1/feedback', { note }),
    /** 出门开关：true = 休息，不出门 */
    pause: (paused) => request('POST', '/v1/pause', { paused: paused === true }),
  }
}
