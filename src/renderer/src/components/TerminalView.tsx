import { useEffect, useRef } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { ResolvedTheme } from '../../../shared/types'
import {
  buildTerminalFontStack,
  clampTerminalFontSize,
  getTerminalTheme
} from '../terminal-theme'

interface TerminalViewProps {
  sessionId: string
  registerDataListener: (sessionId: string, cb: (data: string) => void) => () => void
  visible: boolean
  fontFamily: string
  fontSize: number
  resolvedTheme: ResolvedTheme
  onFontSizeChange?: (size: number) => void
}

export function TerminalView({
  sessionId,
  registerDataListener,
  visible,
  fontFamily,
  fontSize,
  resolvedTheme,
  onFontSizeChange
}: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const fontSizeRef = useRef(fontSize)
  const onFontSizeChangeRef = useRef(onFontSizeChange)
  const resolvedThemeRef = useRef(resolvedTheme)

  fontSizeRef.current = fontSize
  onFontSizeChangeRef.current = onFontSizeChange
  resolvedThemeRef.current = resolvedTheme

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: buildTerminalFontStack(fontFamily),
      fontSize,
      theme: getTerminalTheme(resolvedThemeRef.current),
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

    let fitTimer: number | null = null
    const scheduleFit = (immediate = false): void => {
      if (fitTimer != null) window.clearTimeout(fitTimer)
      const run = (): void => {
        fitTimer = null
        try {
          fit.fit()
          void window.api.sessions.resize(sessionId, term.cols, term.rows)
        } catch {
          /* ignore fit errors */
        }
      }
      if (immediate) run()
      else fitTimer = window.setTimeout(run, 80)
    }

    const ro = new ResizeObserver(() => {
      scheduleFit(false)
    })
    ro.observe(containerRef.current)

    try {
      scheduleFit(true)
    } catch {
      /* ignore */
    }

    return () => {
      unsub()
      onData.dispose()
      ro.disconnect()
      if (fitTimer != null) window.clearTimeout(fitTimer)
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
    const term = termRef.current
    if (!term) return
    term.options.theme = getTerminalTheme(resolvedTheme)
  }, [resolvedTheme])

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
