import type { BrowserWindow } from 'electron'
import { IPC, type MonitorSnapshot, type MonitorUpdateEvent } from '../shared/types'
import {
  cpuPercentFromDelta,
  getMonitorScript,
  kbToBytes,
  parseMonitorOutput,
  type CpuCounters,
  type NetCounters
} from './monitor-parse'
import type { SshClient } from './ssh-client'

const POLL_MS = 2000

interface SampleState {
  cpu: CpuCounters
  net: NetCounters
  at: number
}

export class MonitorService {
  private activeSessionId: string | null = null
  private title = ''
  private timer: ReturnType<typeof setInterval> | null = null
  private polling = false
  private prev: SampleState | null = null

  constructor(
    private readonly getSshClient: (sessionId: string) => SshClient,
    private readonly getWindow: () => BrowserWindow | null
  ) {}

  setActive(sessionId: string | null, title = ''): void {
    this.stopTimer()
    this.activeSessionId = sessionId
    this.title = title
    this.prev = null

    if (!sessionId) {
      this.push({ sessionId: null, snapshot: null })
      return
    }

    this.push({ sessionId, snapshot: null })
    void this.tick()
    this.timer = setInterval(() => {
      void this.tick()
    }, POLL_MS)
  }

  disposeSession(sessionId: string): void {
    if (this.activeSessionId === sessionId) {
      this.setActive(null)
    }
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async tick(): Promise<void> {
    const sessionId = this.activeSessionId
    if (!sessionId || this.polling) return
    this.polling = true
    try {
      const client = this.getSshClient(sessionId)
      const output = await client.exec(getMonitorScript(), 12000)
      const raw = parseMonitorOutput(output)
      const now = Date.now()

      let cpuPercent: number | null = null
      let netRxBps: number | null = null
      let netTxBps: number | null = null

      if (this.prev) {
        cpuPercent = cpuPercentFromDelta(this.prev.cpu, raw.cpu)
        const dt = (now - this.prev.at) / 1000
        if (dt > 0) {
          netRxBps = Math.max(0, (raw.net.rx - this.prev.net.rx) / dt)
          netTxBps = Math.max(0, (raw.net.tx - this.prev.net.tx) / dt)
        }
      }

      this.prev = { cpu: raw.cpu, net: raw.net, at: now }

      const snapshot: MonitorSnapshot = {
        title: this.title,
        cpuPercent,
        memUsedBytes: kbToBytes(Math.max(0, raw.memTotalKb - raw.memAvailableKb)),
        memTotalBytes: kbToBytes(raw.memTotalKb),
        swapUsedBytes: kbToBytes(Math.max(0, raw.swapTotalKb - raw.swapFreeKb)),
        swapTotalBytes: kbToBytes(raw.swapTotalKb),
        load1: raw.load1,
        load5: raw.load5,
        load15: raw.load15,
        netRxBps,
        netTxBps,
        processes: raw.processes ?? [],
        updatedAt: now
      }

      if (this.activeSessionId === sessionId) {
        this.push({ sessionId, snapshot })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : (e as { message?: string })?.message
      if (this.activeSessionId === sessionId) {
        this.push({
          sessionId,
          snapshot: null,
          error: message || 'Monitor unavailable'
        })
      }
    } finally {
      this.polling = false
    }
  }

  private push(payload: MonitorUpdateEvent): void {
    const win = this.getWindow()
    win?.webContents.send(IPC.monitorUpdate, payload)
  }
}
