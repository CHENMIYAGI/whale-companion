// 小工具：原子写 JSON、读 JSON、读文件末尾
import fs from 'node:fs'
import path from 'node:path'

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

export function writeJsonAtomic(file, value, { mode } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', mode ? { mode } : undefined)
    fs.renameSync(tmp, file)
    if (mode) { try { fs.chmodSync(file, mode) } catch {} }
  } finally { try { fs.rmSync(tmp, { force: true }) } catch {} }
}

/** 读文件最后 maxBytes 字节（日志、日记都可能很长，只要末尾） */
export function readTail(file, maxBytes) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const { size } = fs.fstatSync(fd)
    const start = Math.max(0, size - maxBytes)
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    let text = buf.toString('utf8')
    // 从中间截断时，丢掉第一行（可能是半行 / 半个汉字）
    if (start > 0) text = text.slice(text.indexOf('\n') + 1)
    return { text, truncated: start > 0, size }
  } catch { return { text: '', truncated: false, size: 0 } }
  finally { if (fd !== undefined) try { fs.closeSync(fd) } catch {} }
}
