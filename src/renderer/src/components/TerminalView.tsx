import { useEffect, useRef } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import {
  ONE_DARK_THEME,
  buildTerminalFontStack,
  clampTerminalFontSize
} from '../terminal-theme'

interface TerminalViewProps {
  sessionId: string
  registerDataListener: (sessionId: string, cb: (data: string) => void) => () => void
  visible: boolean
  fontFamily: string
  fontSize: number
  onFontSizeChange?: (size: number) => void
}

export function TerminalView({
  sessionId,
  registerDataListener,
  visible,
  fontFamily,
  fontSize,
  onFontSizeChange
}: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const fontSizeRef = useRef(fontSize)
  const onFontSizeChangeRef = useRef(onFontSizeChange)

  fontSizeRef.current = fontSize
  onFontSizeChangeRef.current = onFontSizeChange

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: buildTerminalFontStack(fontFamily),
      fontSize,
      theme: ONE_DARK_THEME,
      allowTransparency: false
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    try {
      fit.fit()
    } catch {
      /* container may be zero-sized on first paint */
    }
    termRef.current = term
    fitRef.current = fit

    const unsub = registerDataListener(sessionId, (data) => term.write(data))
    const onData = term.onData((data) => {
      void window.api.sessions.write(sessionId, data)
    })

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
        void window.api.sessions.resize(sessionId, term.cols, term.rows)
      } catch {
        /* ignore fit errors */
      }
    })
    ro.observe(containerRef.current)

    try {
      void window.api.sessions.resize(sessionId, term.cols, term.rows)
    } catch {
      /* ignore */
    }

    return () => {
      unsub()
      onData.dispose()
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // Font props are applied via a separate effect so changing font does not rebuild the terminal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, registerDataListener])

  useEffect(() => {
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    term.options.fontFamily = buildTerminalFontStack(fontFamily)
    term.options.fontSize = fontSize
    try {
      fit.fit()
      void window.api.sessions.resize(sessionId, term.cols, term.rows)
    } catch {
      /* ignore */
    }
  }, [fontFamily, fontSize, sessionId])

  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
        const term = termRef.current
        if (term) {
          void window.api.sessions.resize(sessionId, term.cols, term.rows)
        }
      } catch {
        /* ignore */
      }
    })
  }, [visible, sessionId])

  // Ctrl/Cmd + mouse wheel zooms terminal font size.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      if (!onFontSizeChangeRef.current) return
      e.preventDefault()
      e.stopPropagation()
      if (e.deltaY === 0) return
      const step = e.deltaY < 0 ? 1 : -1
      onFontSizeChangeRef.current(clampTerminalFontSize(fontSizeRef.current + step))
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div
      ref={containerRef}
      className="terminal-view"
      style={{ display: visible ? 'block' : 'none' }}
    />
  )
}
