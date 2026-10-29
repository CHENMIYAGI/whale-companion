// npm run shortcut —— 在桌面上建一个快捷方式，名字是她的名字（DSH 设置里人设的「名字」，没填就叫「桌宠」；只支持 Windows）
//
// 快捷方式直接启动 electron.exe（它是窗口程序，不会弹黑色终端窗口），参数是 app 目录。
// 已经开着时再双击：main.js 的单实例锁会让第二个立刻退出，并让第一个打开对话框（second-instance）。
//
// 桌面在哪：用系统 API [Environment]::GetFolderPath('Desktop') 取，桌面被 OneDrive 接管时也是对的。
// 快捷方式用 PowerShell + WScript.Shell 建；命令用 -EncodedCommand 传（UTF-16），中文名和路径不会被日文系统的编码弄乱。
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { paths } from '../src/main/core/paths.js'
import { readJson } from '../src/main/core/files.js'

// 名字里不能有的字符去掉（快捷方式就是个文件）
const NAME = String(readJson(paths.whaleConfig, {})?.persona?.name || '桌宠').replace(/[\\/:*?"<>|]/g, '').slice(0, 20) || '桌宠'
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ICON = path.join(APP_DIR, 'build', 'icon.ico')

if (process.platform !== 'win32') {
  console.error('桌面快捷方式只做了 Windows 的。')
  process.exit(1)
}

// electron 这个 npm 包导出的就是 electron.exe 的绝对路径
const ELECTRON = createRequire(import.meta.url)('electron')
for (const [what, file] of [['electron.exe', ELECTRON], ['图标', ICON]]) {
  if (!fs.existsSync(file)) {
    console.error(`找不到${what}：${file}` + (what === '图标' ? '（先跑 bash scripts/make-icon.sh）' : '（先在 app/ 里 npm install）'))
    process.exit(1)
  }
}

// PowerShell 单引号字符串里，单引号写两遍就是它本身
const ps = (s) => `'${String(s).replaceAll("'", "''")}'`
const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$desktop = [Environment]::GetFolderPath('Desktop')
$file = Join-Path $desktop (${ps(NAME)} + '.lnk')
# WScript.Shell 存文件时会把路径转成系统编码：日文系统里「桌面」的「桌」变成 ?，存不上 ✗
# → 先存到一个纯英文的临时路径，再用 PowerShell 挪过去（它认 Unicode）
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('whale-shortcut-' + [guid]::NewGuid().ToString('N') + '.lnk')
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($tmp)
$s.TargetPath = ${ps(ELECTRON)}
$s.Arguments = ${ps(`"${APP_DIR}"`)}
$s.WorkingDirectory = ${ps(APP_DIR)}
$s.IconLocation = ${ps(ICON + ',0')}
$s.Description = 'whale-companion'   # 说明文字也会被转成系统编码，中文会变成 ?，所以用英文
$s.Save()
Move-Item -LiteralPath $tmp -Destination $file -Force
Write-Output $file
`
const encoded = Buffer.from(script, 'utf16le').toString('base64')
// 用系统目录里的完整路径：有的终端 PATH 里没有 PowerShell 的目录
const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
try {
  const out = execFileSync(fs.existsSync(POWERSHELL) ? POWERSHELL : 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { encoding: 'utf8' })
  console.log(`✓ 建好了：${out.trim()}`)
  console.log('  双击就能启动；已经开着时双击会打开对话框。')
} catch (e) {
  console.error('建快捷方式失败：' + String(e.stderr || e.message).trim())
  process.exit(1)
}
