/**
 * 桌宠本机接口（companion bridge）
 *
 * 为什么不用 DSH 自带的 webServer：那条路过 DSH 的信任栅栏，外部程序（桌宠）进不去 ✗
 * 所以这里自己开一个极小的 HTTP 服务，只做五件事：状态 / 排任务 / 查任务 / 记反馈 / 出门开关。
 *
 * 安全（这扇门能让她去刷视频，必须关严）：
 *   · 只绑 127.0.0.1，端口随机；端口和令牌写进 $DSH_HOME/whale-bridge.json（仅当前用户可读）
 *   · 每个请求都要 Authorization: Bearer <令牌>（定长比较）
 *   · 带 Origin / Sec-Fetch-Site 的请求一律拒 —— 那是浏览器里的网页，不是桌宠
 *   · Host 必须是回环（防 DNS rebinding）
 *   · 只收 JSON，正文 ≤ 8KB
 *   · 接口本身不能发评论、不能私信：任务只是「叫她去做」，对外发言仍走原来的闸门
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const BRIDGE_FILE = 'whale-bridge.json'
const MAX_BODY = 8 * 1024

const isLoopbackAddr = (a) => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
const isLoopbackHost = (h) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(String(h ?? ''))

function sameToken(given, token) {
  const a = Buffer.from(String(given ?? ''))
  const b = Buffer.from(String(token))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function send(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] ?? '')
    if (!type.startsWith('application/json')) return reject(Object.assign(new Error('只收 JSON'), { status: 415 }))
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        // 不 destroy：那样对方收到的是连接重置而不是 413。丢掉剩下的正文，照常回话。
        req.removeAllListeners('data'); req.resume()
        reject(Object.assign(new Error('正文太大'), { status: 413 }))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) }
      catch { reject(Object.assign(new Error('JSON 解析失败'), { status: 400 })) }
    })
    req.on('error', reject)
  })
}

/**
 * @param {object} o
 * @param {string} o.dshHome
 * @param {object} o.sched   startScheduler 的返回值（需要 companionStatus / companionEnqueue / companionJob / companionFeedback / companionPause）
 * @param {number} [o.port]  0 = 随机
 */
export function startCompanionBridge({ dshHome, sched, port = 0, log = () => {}, token = crypto.randomBytes(24).toString('hex') }) {
  const file = path.join(dshHome, BRIDGE_FILE)
  let lastFeedbackAt = 0

  const server = http.createServer(async (req, res) => {
    try {
      if (!isLoopbackAddr(req.socket.remoteAddress)) return send(res, 403, { ok: false, error: '只接受本机' })
      if (!isLoopbackHost(req.headers.host)) return send(res, 403, { ok: false, error: 'Host 不是回环' })
      if (req.headers.origin || req.headers['sec-fetch-site']) return send(res, 403, { ok: false, error: '不接受浏览器网页的请求' })
      const auth = String(req.headers.authorization ?? '')
      if (!auth.startsWith('Bearer ') || !sameToken(auth.slice(7), token)) return send(res, 401, { ok: false, error: '令牌不对' })

      const url = new URL(req.url, 'http://127.0.0.1')
      const p = url.pathname

      if (req.method === 'GET' && p === '/v1/status') return send(res, 200, { ok: true, ...sched.companionStatus() })

      if (req.method === 'POST' && p === '/v1/jobs') {
        const body = await readJson(req)
        const r = sched.companionEnqueue(body)
        if (r.error) return send(res, 400, { ok: false, error: r.error })
        log(`[bili-whale] 桌宠任务入队：${r.job.kind}${r.job.bv ? ' ' + r.job.bv : ''}${r.duplicate ? '（已在排队）' : ''}`)
        return send(res, 202, { ok: true, job: r.job, duplicate: !!r.duplicate })
      }

      const m = /^\/v1\/jobs\/([0-9a-f-]{36})$/.exec(p)
      if (req.method === 'GET' && m) {
        const job = sched.companionJob(m[1])
        return job ? send(res, 200, { ok: true, job }) : send(res, 404, { ok: false, error: '没有这个任务（DSH 重启过就会清空）' })
      }

      // 出门开关：{ paused: true } = 休息，不出门（生物钟不叫醒、任务不投递）；false = 恢复
      if (req.method === 'POST' && p === '/v1/pause') {
        const body = await readJson(req)
        if (typeof body.paused !== 'boolean') return send(res, 400, { ok: false, error: 'paused 要是 true 或 false' })
        const r = sched.companionPause(body.paused)
        return send(res, 200, { ok: true, ...r })
      }

      if (req.method === 'POST' && p === '/v1/feedback') {
        const body = await readJson(req)
        const note = String(body.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
        if (!note) return send(res, 400, { ok: false, error: '缺少 note' })
        // 兜底节流：桌宠那边已经节流过，这里再挡一下，防止 feedback.json 被刷爆
        if (Date.now() - lastFeedbackAt < 60_000) return send(res, 429, { ok: false, error: '刚记过，稍后再记' })
        lastFeedbackAt = Date.now()
        const r = await sched.companionFeedback(note)
        return send(res, r.ok ? 200 : 500, { ok: r.ok, error: r.ok ? undefined : String(r.err || r.out).slice(0, 200) })
      }

      return send(res, 404, { ok: false, error: '没有这个接口' })
    } catch (e) {
      try { send(res, e.status ?? 500, { ok: false, error: String(e.message ?? e).slice(0, 200) }) } catch {}
    }
  })

  // 这个服务不该单独把进程吊着：DSH 自己常驻，它退出时接口跟着走
  server.unref()
  const ready = new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port
      const info = { version: 1, port: actual, token, pid: process.pid, startedAt: new Date().toISOString() }
      try {
        fs.mkdirSync(dshHome, { recursive: true })
        const tmp = file + '.' + process.pid + '.tmp'
        fs.writeFileSync(tmp, JSON.stringify(info, null, 2), { mode: 0o600 })
        fs.renameSync(tmp, file)
        try { fs.chmodSync(file, 0o600) } catch {}
      } catch (e) { log('[bili-whale] 写桌宠接口信息失败：' + e.message) }
      log(`[bili-whale] 桌宠接口已开：127.0.0.1:${actual}`)
      resolve(actual)
    })
  })
  ready.catch((e) => log('[bili-whale] 桌宠接口启动失败：' + e.message))

  return {
    ready,
    token,
    stop() {
      try { server.close(); server.closeAllConnections?.() } catch {}   // keep-alive 连接不关，插件重载时端口会一直占着
      // 只删自己写的那份（另一个 DSH 进程可能已经覆盖了它）
      try { const cur = JSON.parse(fs.readFileSync(file, 'utf8')); if (cur.pid === process.pid && cur.token === token) fs.rmSync(file, { force: true }) } catch {}
    },
  }
}
