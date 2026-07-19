import { describe, expect, it } from 'vitest'
import {
  cpuPercentFromDelta,
  getMonitorScript,
  parseCpuStatLine,
  parseLoadavg,
  parseMeminfo,
  parseMonitorOutput,
  parseNetDev,
  parseProcessList
} from '../src/main/monitor-parse'

describe('monitor-parse', () => {
  it('wraps remote script via base64 so $vars and newlines survive SSH shell -c', () => {
    const cmd = getMonitorScript()
    expect(cmd).toMatch(/^echo [A-Za-z0-9+/=]+ \| base64 -d \| \/bin\/sh$/)
    expect(cmd).not.toContain('/bin/sh -c "')
    const b64 = cmd.slice('echo '.length, cmd.indexOf(' | base64'))
    const script = Buffer.from(b64, 'base64').toString('utf8')
    expect(script).toContain('$psbin')
    expect(script).toContain('$out')
    expect(script).toContain('\nif [ -z "$out" ]')
  })

  it('returns a cached monitor script string', () => {
    expect(getMonitorScript()).toBe(getMonitorScript())
  })

  it('parses cpu line and percent delta', () => {
    const a = parseCpuStatLine('cpu  100 0 50 850 0 0 0 0')
    const b = parseCpuStatLine('cpu  150 0 70 880 0 0 0 0')
    expect(a.total).toBe(1000)
    expect(a.idle).toBe(850)
    expect(cpuPercentFromDelta(a, b)).toBeCloseTo(70, 5)
  })

  it('parses meminfo with MemAvailable', () => {
    const info = parseMeminfo(`MemTotal:       2048000 kB
MemFree:          100000 kB
MemAvailable:    1024000 kB
Buffers:           10000 kB
Cached:            20000 kB
SwapTotal:        512000 kB
SwapFree:         256000 kB
`)
    expect(info.memTotalKb).toBe(2048000)
    expect(info.memAvailableKb).toBe(1024000)
    expect(info.swapTotalKb).toBe(512000)
    expect(info.swapFreeKb).toBe(256000)
  })

  it('parses loadavg and net/dev excluding lo', () => {
    expect(parseLoadavg('0.15 0.20 0.25 1/100 1')).toEqual({
      load1: 0.15,
      load5: 0.2,
      load15: 0.25
    })
    const net = parseNetDev(`Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1000 0 0 0 0 0 0 0 2000 0 0 0 0 0 0 0
  eth0: 5000 0 0 0 0 0 0 0 8000 0 0 0 0 0 0 0
`)
    expect(net).toEqual({ rx: 5000, tx: 8000 })
  })

  it('parses full monitor script output with processes', () => {
    const raw = parseMonitorOutput(`---STAT---
cpu  10 0 5 85 0 0 0 0
---MEM---
MemTotal:        1000000 kB
MemAvailable:     400000 kB
SwapTotal:             0 kB
SwapFree:              0 kB
---LOAD---
1.00 2.00 3.00 1/1 1
---NET---
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
  eth0: 100 0 0 0 0 0 0 0 200 0 0 0 0 0 0 0
---PS---
91234  1.7 YDService
    0  0.7 ksoftirqd/0
 7200  0.3 sshd
`)
    expect(raw.cpu.total).toBe(100)
    expect(raw.processes[0]).toEqual({
      memBytes: 91234 * 1024,
      cpuPercent: 1.7,
      command: 'YDService'
    })
  })

  it('parses ps aux style lines', () => {
    const list = parseProcessList(`USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root         1  0.0  0.1 123456  4500 ?        Ss   Jan01   0:01 /sbin/init
root      1234  2.5  1.2 999999 89000 ?        S    10:00   0:10 /usr/sbin/sshd -D
`)
    expect(list.some((p) => p.command.includes('sshd'))).toBe(true)
    expect(list.find((p) => p.command.includes('sshd'))?.cpuPercent).toBe(2.5)
  })
})
