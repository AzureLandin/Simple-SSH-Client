import { useState } from 'react'
import type { HostConfig } from '../../../shared/types'
import { HostList } from './components/HostList'
import { SessionTabs } from './components/SessionTabs'
import { Toast } from './components/Toast'
import { useHosts } from './hooks/useHosts'
import { ConnectError, type UiSession, useSessions } from './hooks/useSessions'

type PasswordAction =
  | { type: 'connect'; host: HostConfig }
  | { type: 'reconnect'; host: HostConfig; session: UiSession }

function PasswordModal({
  host,
  onSubmit,
  onCancel
}: {
  host: HostConfig
  onSubmit: (password: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [password, setPassword] = useState('')

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    onSubmit(password)
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="password-modal-title">
      <form className="modal password-modal" onSubmit={handleSubmit}>
        <h3 id="password-modal-title" className="modal-title">
          Password for {host.name}
        </h3>
        <p className="modal-subtitle">
          {host.username}@{host.host}:{host.port}
        </p>
        <label className="form-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
        </label>
        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            Connect
          </button>
        </div>
      </form>
    </div>
  )
}

function App(): React.JSX.Element {
  const { hosts, error: hostsError, create, update, remove } = useHosts()
  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    toast: sessionsToast,
    setToast,
    connect,
    disconnect,
    reconnect,
    registerDataListener
  } = useSessions()

  const [passwordAction, setPasswordAction] = useState<PasswordAction | null>(null)
  const [connecting, setConnecting] = useState(false)

  const attemptConnect = async (
    host: HostConfig,
    options?: { password?: string; acceptHostKey?: boolean }
  ): Promise<void> => {
    setConnecting(true)
    try {
      await connect(host, options)
      setPasswordAction(null)
    } catch (e) {
      if (e instanceof ConnectError && e.code === 'HOST_KEY_CHANGED') {
        const accept = window.confirm(
          `${e.message}\n\nThe host key has changed. Accept the new key and connect?`
        )
        if (accept) {
          await attemptConnect(host, { ...options, acceptHostKey: true })
          return
        }
        setToast(e.message)
        return
      }
      const message = e instanceof Error ? e.message : 'Connection failed'
      setToast(message)
    } finally {
      setConnecting(false)
    }
  }

  const attemptReconnect = async (
    session: UiSession,
    host: HostConfig,
    options?: { password?: string; acceptHostKey?: boolean }
  ): Promise<void> => {
    setConnecting(true)
    try {
      await reconnect(session, host, options)
      setPasswordAction(null)
    } catch (e) {
      if (e instanceof ConnectError && e.code === 'HOST_KEY_CHANGED') {
        const accept = window.confirm(
          `${e.message}\n\nThe host key has changed. Accept the new key and reconnect?`
        )
        if (accept) {
          await attemptReconnect(session, host, { ...options, acceptHostKey: true })
          return
        }
        setToast(e.message)
        return
      }
      const message = e instanceof Error ? e.message : 'Reconnection failed'
      setToast(message)
    } finally {
      setConnecting(false)
    }
  }

  const handleConnect = (host: HostConfig): void => {
    if (connecting) return
    if (host.authMethod === 'password') {
      setPasswordAction({ type: 'connect', host })
      return
    }
    void attemptConnect(host)
  }

  const handlePasswordSubmit = (password: string): void => {
    if (!passwordAction) return
    if (passwordAction.type === 'connect') {
      void attemptConnect(passwordAction.host, { password })
    } else {
      void attemptReconnect(passwordAction.session, passwordAction.host, { password })
    }
  }

  const handleReconnect = (session: UiSession): void => {
    if (connecting) return
    const host = hosts.find((h) => h.id === session.hostId)
    if (!host) {
      setToast('Host configuration not found')
      return
    }
    if (host.authMethod === 'password') {
      setPasswordAction({ type: 'reconnect', host, session })
      return
    }
    void attemptReconnect(session, host)
  }

  const toastMessage = sessionsToast ?? hostsError

  return (
    <div className="app">
      <aside className="sidebar">
        <HostList
          hosts={hosts}
          onConnect={handleConnect}
          onCreate={create}
          onUpdate={update}
          onRemove={remove}
        />
      </aside>
      <main className={`main${sessions.length > 0 ? ' main-with-sessions' : ''}`}>
        {sessions.length > 0 ? (
          <SessionTabs
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelect={setActiveSessionId}
            onClose={(id) => void disconnect(id)}
            onReconnect={handleReconnect}
            registerDataListener={registerDataListener}
          />
        ) : (
          <p className="main-placeholder">Select a host and click Connect</p>
        )}
      </main>
      {passwordAction && (
        <PasswordModal
          host={passwordAction.host}
          onSubmit={handlePasswordSubmit}
          onCancel={() => setPasswordAction(null)}
        />
      )}
      <Toast message={toastMessage} onClose={() => setToast(null)} />
    </div>
  )
}

export default App
