import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectOptions, HostConfig } from '../../../shared/types'

export type UiSessionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface UiSession {
  sessionId: string
  hostId: string
  title: string
  status: UiSessionStatus
  errorMessage?: string
  authMethod: 'password' | 'privateKey'
}

export class ConnectError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
    this.name = 'ConnectError'
  }
}

function normalizeInvokeError(e: unknown): { code?: string; message: string } {
  if (e && typeof e === 'object') {
    const obj = e as Record<string, unknown>
    let message =
      typeof obj.message === 'string' ? obj.message : typeof e === 'string' ? e : 'Connection failed'
    let code = typeof obj.code === 'string' ? obj.code : undefined

    if (!code && message) {
      try {
        const parsed = JSON.parse(message) as { code?: string; message?: string }
        if (typeof parsed.code === 'string') {
          code = parsed.code
          if (typeof parsed.message === 'string') message = parsed.message
        }
      } catch {
        /* not JSON */
      }
    }

    return { code, message }
  }

  return { message: String(e) }
}

async function invokeConnect(
  hostId: string,
  options?: ConnectOptions
): Promise<{ sessionId: string }> {
  try {
    return await window.api.sessions.connect(hostId, options)
  } catch (e) {
    const { code, message } = normalizeInvokeError(e)
    if (code) throw new ConnectError(code, message)
    throw new Error(message)
  }
}

export function useSessions() {
  const [sessions, setSessions] = useState<UiSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const dataListenersRef = useRef(new Map<string, (data: string) => void>())

  useEffect(() => {
    const offData = window.api.sessions.onData(({ sessionId, data }) => {
      dataListenersRef.current.get(sessionId)?.(data)
    })
    const offClosed = window.api.sessions.onClosed(({ sessionId }) => {
      setSessions((prev) =>
        prev.map((s) => (s.sessionId === sessionId ? { ...s, status: 'disconnected' } : s))
      )
    })
    const offError = window.api.sessions.onError(({ sessionId, error }) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.sessionId === sessionId ? { ...s, status: 'error', errorMessage: error.message } : s
        )
      )
      setToast(error.message)
    })
    return () => {
      offData()
      offClosed()
      offError()
    }
  }, [])

  const registerDataListener = useCallback(
    (sessionId: string, cb: (data: string) => void): (() => void) => {
      dataListenersRef.current.set(sessionId, cb)
      return () => {
        dataListenersRef.current.delete(sessionId)
      }
    },
    []
  )

  const connect = useCallback(async (host: HostConfig, options?: ConnectOptions): Promise<void> => {
    const { sessionId } = await invokeConnect(host.id, options)
    const session: UiSession = {
      sessionId,
      hostId: host.id,
      title: host.name,
      status: 'connected',
      authMethod: host.authMethod
    }
    setSessions((prev) => [...prev, session])
    setActiveSessionId(sessionId)
  }, [])

  const disconnect = useCallback(async (sessionId: string): Promise<void> => {
    try {
      await window.api.sessions.disconnect(sessionId)
    } catch {
      /* session may already be gone */
    }
    setSessions((prev) => {
      const next = prev.filter((s) => s.sessionId !== sessionId)
      setActiveSessionId((active) => {
        if (active !== sessionId) return active
        return next.length > 0 ? next[next.length - 1]!.sessionId : null
      })
      return next
    })
    dataListenersRef.current.delete(sessionId)
  }, [])

  const reconnect = useCallback(
    async (session: UiSession, host: HostConfig, options?: ConnectOptions): Promise<void> => {
      try {
        await window.api.sessions.disconnect(session.sessionId)
      } catch {
        /* ignore */
      }

      try {
        const { sessionId } = await invokeConnect(host.id, options)
        setSessions((prev) =>
          prev.map((s) =>
            s.sessionId === session.sessionId
              ? {
                  sessionId,
                  hostId: host.id,
                  title: host.name,
                  status: 'connected' as const,
                  authMethod: host.authMethod
                }
              : s
          )
        )
        setActiveSessionId(sessionId)
      } catch (e) {
        const { code, message } =
          e instanceof ConnectError
            ? { code: e.code, message: e.message }
            : normalizeInvokeError(e)
        if (code) throw new ConnectError(code, message)
        setToast(message)
        setSessions((prev) =>
          prev.map((s) =>
            s.sessionId === session.sessionId
              ? { ...s, status: 'error', errorMessage: message }
              : s
          )
        )
      }
    },
    []
  )

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    toast,
    setToast,
    connect,
    disconnect,
    reconnect,
    registerDataListener
  }
}
