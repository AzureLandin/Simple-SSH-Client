import { useEffect, useRef } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

interface TerminalViewProps {
  sessionId: string
  registerDataListener: (sessionId: string, cb: (data: string) => void) => () => void
  visible: boolean
}

export function TerminalView({
  sessionId,
  registerDataListener,
  visible
}: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: { background: '#1e1e1e' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    const unsub = registerDataListener(sessionId, (data) => term.write(data))
    const onData = term.onData((data) => {
      void window.api.sessions.write(sessionId, data)
    })

    const ro = new ResizeObserver(() => {
      fit.fit()
      void window.api.sessions.resize(sessionId, term.cols, term.rows)
    })
    ro.observe(containerRef.current)

    void window.api.sessions.resize(sessionId, term.cols, term.rows)

    return () => {
      unsub()
      onData.dispose()
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [sessionId, registerDataListener])

  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => {
      fitRef.current?.fit()
      const term = termRef.current
      if (term) {
        void window.api.sessions.resize(sessionId, term.cols, term.rows)
      }
    })
  }, [visible, sessionId])

  return (
    <div
      ref={containerRef}
      className="terminal-view"
      style={{ display: visible ? 'block' : 'none' }}
    />
  )
}
