export interface CpuCounters {
  idle: number
  total: number
}

export interface NetCounters {
  rx: number
  tx: number
}

export interface MonitorProcess {
  memBytes: number
  cpuPercent: number
  command: string
}

export interface ProcSnapshotRaw {
  cpu: CpuCounters
  memTotalKb: number
  memAvailableKb: number
  swapTotalKb: number
  swapFreeKb: number
  load1: number
  load5: number
  load15: number
  net: NetCounters
  processes: MonitorProcess[]
}

/**
 * Single remote script. Process list must NOT use `ps|head || fallback` —
 * when ps fails, head still exits 0 and the fallback never runs.
 */
const MONITOR_SCRIPT = [
  'echo ---STAT---',
  'head -n 1 /proc/stat',
  'echo ---MEM---',
  'cat /proc/meminfo',
  'echo ---LOAD---',
  'cat /proc/loadavg',
  'echo ---NET---',
  'cat /proc/net/dev',
  'echo ---PS---',
  // Capture ps output into a variable so empty/failure can fall back.
  // Do NOT use `ps | head || fallback` — head exits 0 even when ps fails.
  'psbin=$(command -v ps 2>/dev/null || true)',
  '[ -n "$psbin" ] || { [ -x /usr/bin/ps ] && psbin=/usr/bin/ps; }',
  '[ -n "$psbin" ] || { [ -x /bin/ps ] && psbin=/bin/ps; }',
  'out=',
  'if [ -n "$psbin" ]; then out=$($psbin -eo rss=,pcpu=,comm= --sort=-pcpu 2>/dev/null || true); fi',
  'if [ -z "$out" ] && [ -n "$psbin" ]; then out=$($psbin -eo rss=,pcpu=,comm= 2>/dev/null || true); fi',
  'if [ -z "$out" ] && [ -n "$psbin" ]; then out=$($psbin axo rss=,pcpu=,comm= 2>/dev/null || true); fi',
  'if [ -z "$out" ] && [ -n "$psbin" ]; then out=$($psbin aux 2>/dev/null || true); fi',
  'printf "%s\\n" "$out" | awk "NF>0 {print; if (++n >= 8) exit}"'
].join('\n')

/**
 * SSH exec is typically run as `user-shell -c <command>`.
 * JSON.stringify wraps in double quotes, so:
 * - `$psbin` / `$out` get expanded by the outer shell (become empty)
 * - real newlines become literal `\n`, so `if`/`then` break
 * Base64 avoids all quoting/expansion hazards.
 */
function shellWrap(script: string): string {
  const b64 = Buffer.from(script, 'utf8').toString('base64')
  return `echo ${b64} | base64 -d | /bin/sh`
}

export function getMonitorScript(): string {
  return shellWrap(MONITOR_SCRIPT)
}

export function parseCpuStatLine(line: string): CpuCounters {
  const parts = line.trim().split(/\s+/)
  if (parts[0] !== 'cpu' || parts.length < 5) {
    throw new Error('Invalid /proc/stat cpu line')
  }
  const nums = parts.slice(1).map((n) => Number(n))
  if (nums.some((n) => !Number.isFinite(n))) {
    throw new Error('Invalid /proc/stat numbers')
  }
  const idle = (nums[3] ?? 0) + (nums[4] ?? 0) // idle + iowait
  const total = nums.reduce((a, b) => a + b, 0)
  return { idle, total }
}

export function cpuPercentFromDelta(prev: CpuCounters, next: CpuCounters): number {
  const idleDelta = next.idle - prev.idle
  const totalDelta = next.total - prev.total
  if (totalDelta <= 0) return 0
  const used = 1 - idleDelta / totalDelta
  return Math.min(100, Math.max(0, used * 100))
}

export function parseMeminfo(text: string): {
  memTotalKb: number
  memAvailableKb: number
  swapTotalKb: number
  swapFreeKb: number
} {
  const map = new Map<string, number>()
  for (const line of text.split('\n')) {
    const m = /^(\w+):\s+(\d+)/.exec(line)
    if (m) map.set(m[1]!, Number(m[2]))
  }
  const memTotalKb = map.get('MemTotal') ?? 0
  let memAvailableKb = map.get('MemAvailable')
  if (memAvailableKb === undefined) {
    memAvailableKb =
      (map.get('MemFree') ?? 0) + (map.get('Buffers') ?? 0) + (map.get('Cached') ?? 0)
  }
  return {
    memTotalKb,
    memAvailableKb,
    swapTotalKb: map.get('SwapTotal') ?? 0,
    swapFreeKb: map.get('SwapFree') ?? 0
  }
}

export function parseLoadavg(line: string): { load1: number; load5: number; load15: number } {
  const parts = line.trim().split(/\s+/)
  const load1 = Number(parts[0])
  const load5 = Number(parts[1])
  const load15 = Number(parts[2])
  if (![load1, load5, load15].every(Number.isFinite)) {
    throw new Error('Invalid /proc/loadavg')
  }
  return { load1, load5, load15 }
}

export function parseNetDev(text: string): NetCounters {
  let rx = 0
  let tx = 0
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.includes(':')) continue
    const [ifacePart, rest] = trimmed.split(':')
    if (!ifacePart || rest === undefined) continue
    const iface = ifacePart.trim()
    if (iface === 'lo') continue
    const nums = rest.trim().split(/\s+/).map(Number)
    if (nums.length < 9 || nums.some((n) => !Number.isFinite(n))) continue
    rx += nums[0]!
    tx += nums[8]!
  }
  return { rx, tx }
}

export function parseProcessList(text: string): MonitorProcess[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const out: MonitorProcess[] = []

  for (const line of lines) {
    if (/^(RSS|%CPU|PID|COMMAND|USER|%MEM)\b/i.test(line)) continue

    // rss= pcpu= comm=   →  "12345  1.7 sshd"
    let m = /^(\d+)\s+([\d.]+)\s+(.+)$/.exec(line)
    if (m) {
      const rssKb = Number(m[1])
      const cpu = Number(m[2])
      const command = m[3]!.trim()
      if (Number.isFinite(rssKb) && Number.isFinite(cpu) && command) {
        if (!/^(ps|head|awk|sh|dash|bash)$/.test(command)) {
          out.push({ memBytes: rssKb * 1024, cpuPercent: cpu, command })
        }
        continue
      }
    }

    // ps aux → USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
    const aux = line.split(/\s+/)
    if (aux.length >= 11 && /^\d+$/.test(aux[1]!) && /^[\d.]+$/.test(aux[2]!)) {
      const cpu = Number(aux[2])
      const rssKb = Number(aux[5])
      const command = aux.slice(10).join(' ')
      if (Number.isFinite(cpu) && Number.isFinite(rssKb) && command) {
        out.push({ memBytes: rssKb * 1024, cpuPercent: cpu, command })
      }
    }
  }

  out.sort((a, b) => b.cpuPercent - a.cpuPercent || b.memBytes - a.memBytes)
  return out.slice(0, 5)
}

export function parseMonitorOutput(output: string): ProcSnapshotRaw {
  const sections = splitSections(output)
  const stat = sections.get('STAT')
  const mem = sections.get('MEM')
  const load = sections.get('LOAD')
  const net = sections.get('NET')
  if (!stat || !mem || !load || !net) {
    throw new Error('Incomplete monitor output')
  }
  const cpuLine = stat.split('\n').map((l) => l.trim()).find((l) => l.startsWith('cpu '))
  if (!cpuLine) throw new Error('Missing cpu line')
  const meminfo = parseMeminfo(mem)
  const loadavg = parseLoadavg(load.trim().split('\n')[0] ?? '')
  return {
    cpu: parseCpuStatLine(cpuLine),
    ...meminfo,
    ...loadavg,
    net: parseNetDev(net),
    processes: parseProcessList(sections.get('PS') ?? '')
  }
}

function splitSections(output: string): Map<string, string> {
  const map = new Map<string, string>()
  const re = /---(STAT|MEM|LOAD|NET|PS)---\n?/g
  const matches = [...output.matchAll(re)]
  for (let i = 0; i < matches.length; i++) {
    const key = matches[i]![1]!
    const start = matches[i]!.index! + matches[i]![0]!.length
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : output.length
    map.set(key, output.slice(start, end))
  }
  return map
}

export function kbToBytes(kb: number): number {
  return kb * 1024
}
