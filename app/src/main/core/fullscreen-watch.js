// 前台程序是不是全屏（只做了 Windows）
//
// 用的是 Windows 自己判断"要不要弹通知"的那个接口 SHQueryUserNotificationState：
//   2 = 有程序全屏（看视频、F11 浏览器）   3 = 全屏游戏（D3D）   4 = 演示模式   → 都算全屏
//   5 = 正常   1 = 锁屏 / 屏保   6 = 安静时段   7 = 某个程序在"沉浸模式"
// Electron 拿不到别的程序的窗口，所以起一个常驻的 PowerShell 小助手，每 5 秒报一次状态（每次都新起一个太重：启动 + 编译要一秒多）。
// 它挂了就隔一会儿重起（越挂越隔得久）；拿不到状态时一律当"不全屏"。
import { spawn } from 'node:child_process'
import path from 'node:path'

export const FULLSCREEN_STATES = new Set([2, 3, 4])
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class WhaleQuns { [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int s); }
"@
while ($true) {
  # 桌宠没了（崩了、被强制结束）就自己退出 —— 不留一个孤零零的 PowerShell 一直跑
  if (-not (Get-Process -Id __PARENT__ -ErrorAction SilentlyContinue)) { exit 0 }
  $s = 0
  try { [void][WhaleQuns]::SHQueryUserNotificationState([ref]$s) } catch { $s = -1 }
  [Console]::Out.WriteLine("STATE $s")
  [Console]::Out.Flush()
  Start-Sleep -Seconds 5
}
`

/** 从助手的输出里取最后一个状态（拿不到返回 null） */
export function parseStates(chunk) {
  const all = [...String(chunk).matchAll(/STATE (-?\d+)/g)]
  return all.length ? Number(all.at(-1)[1]) : null
}

/** 起助手的命令行（parentPid：它盯着的进程，没了就自己退）—— 单独拿出来，测试也用 */
export function helperCommand(parentPid = process.pid) {
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const encoded = Buffer.from(SCRIPT.replace('__PARENT__', String(Number(parentPid))), 'utf16le').toString('base64')
  return [ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]]
}

export function startFullscreenWatch({ log = () => {}, platform = process.platform, spawnImpl = spawn, onChange = () => {} } = {}) {
  let state = null, child = null, stopped = false, retry = 0, timer = null
  if (platform !== 'win32') return { isFullscreen: () => false, state: () => null, stop() {} }
  function start() {
    if (stopped) return
    const [exe, args] = helperCommand()
    child = spawnImpl(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    child.stdout.on('data', (buf) => {
      const s = parseStates(buf)
      if (s === null) return
      retry = 0
      const was = FULLSCREEN_STATES.has(state)
      state = s
      if (FULLSCREEN_STATES.has(s) !== was) onChange(FULLSCREEN_STATES.has(s))
    })
    child.on('exit', (code) => {
      child = null
      state = null
      if (stopped) return
      retry += 1
      const wait = Math.min(5 * 60_000, 5000 * 2 ** Math.min(retry, 6))
      log(`[忙碌] 全屏检测助手退出了（${code}），${Math.round(wait / 1000)} 秒后重起`)
      timer = setTimeout(start, wait)
    })
    child.on('error', (e) => log('[忙碌] 全屏检测助手起不来：', String(e?.message ?? e)))
  }
  start()
  // app.exit() 之类不走正常退出流程的路子也要把助手带走
  const onExit = () => { try { child?.kill() } catch {} }
  process.once('exit', onExit)
  return {
    isFullscreen: () => FULLSCREEN_STATES.has(state),
    state: () => state,
    stop() { stopped = true; clearTimeout(timer); process.removeListener('exit', onExit); try { child?.kill() } catch {} },
  }
}
