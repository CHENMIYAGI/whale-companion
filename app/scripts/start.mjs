// npm start —— 启动桌宠。只比 `electron .` 多做一件事：Windows 上先把终端换成 UTF-8（代码页 65001），退出时换回来。
//
// 为什么：日文 Windows 的终端默认是代码页 932（Shift-JIS）。通过 npm 启动时 Electron 往终端写的是 UTF-8，
// 终端按 932 去读，中文日志就成了乱码（"测试中文" → "豬玖ｯ穂ｸｭ譁…"）。换成 65001 就正常了（2026-10-27 实测）。
// 注意：换代码页时终端会重画，退出后屏幕上的日志可能被清掉 —— 日志文件里都有：~/.whale-companion/companion.log
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ELECTRON = createRequire(import.meta.url)('electron')   // electron.exe 的绝对路径
const CHCP = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'chcp.com')

// 现在的代码页（chcp 输出最后的数字，日文系统是「現在のコード ページ: 932」）
function codePage() {
  try { return execFileSync(CHCP, { encoding: 'latin1' }).match(/(\d+)\s*$/)?.[1] ?? null } catch { return null }
}
function setCodePage(cp) {
  try { execFileSync(CHCP, [cp], { stdio: 'ignore' }) } catch {}
}

const before = process.platform === 'win32' ? codePage() : null
if (before && before !== '65001') setCodePage('65001')

const child = spawn(ELECTRON, [APP_DIR, ...process.argv.slice(2)], { stdio: 'inherit' })
child.on('exit', (code, signal) => {
  if (before && before !== '65001') setCodePage(before)
  process.exit(code ?? (signal ? 1 : 0))
})
// Ctrl+C：终端会同时发给 Electron，等它自己退出再走上面的 exit
process.on('SIGINT', () => {})
