import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HostConfig, LanguageCode, ThemePreference } from '../../shared/types'
import { ConfirmModal } from './components/ConfirmModal'
import { ErrorBoundary } from './components/ErrorBoundary'
import { HostPickerModal } from './components/HostPickerModal'
import { ModalShell, useModalClose } from './components/ModalShell'
import { SessionTabs } from './components/SessionTabs'
import { SettingsModal } from './components/SettingsModal'
import { SidebarPanel } from './components/SidebarPanel'
import { Toast } from './components/Toast'
import { useHosts } from './hooks/useHosts'
import { ConnectError, type UiSession, useSessions } from './hooks/useSessions'
import i18n from './i18n'
import {
  applyResolvedTheme,
  getSystemPrefersDark,
  resolveTheme,
  subscribeSystemPrefersDark
} from './theme'

type PasswordAction =
  | { type: 'connect'; host: HostConfig }
  | { type: 'reconnect'; host: HostConfig; session: UiSession }

type ConfirmRequest = {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  resolve: (ok: boolean) => void
}

function PasswordModalBody({
  host,
  busy,
  onSubmit
}: {
  host: HostConfig
  busy: boolean
  onSubmit: (password: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const requestClose = useModalClose()
  const [password, setPassword] = useState('')

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (busy) return
    onSubmit(password)
  }

  return (
    <form onSubmit={handleSubmit}>
      <h3 id="password-modal-title" className="modal-title">
        {t('auth.passwordTitle', { name: host.name })}
      </h3>
      <p className="modal-subtitle">
        {host.username}@{host.host}:{host.port}
      </p>
      <label className="form-field">
        <span>{t('auth.passwordLabel')}</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
          disabled={busy}
        />
      </label>
      <div className="form-actions">
        <button type="button" className="btn-secondary" onClick={requestClose} disabled={busy}>
          {t('form.cancel')}
        </button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {t('auth.connect')}
        </button>
      </div>
    </form>
  )
}

function PasswordModal({
  host,
  busy,
  onSubmit,
  onCancel
}: {
  host: HostConfig
  busy: boolean
  onSubmit: (password: string) => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <ModalShell
      onClose={onCancel}
      dialogClassName="password-modal"
      labelledBy="password-modal-title"
      closeOnEscape={!busy}
      closeOnOverlayClick={false}
    >
      <PasswordModalBody host={host} busy={busy} onSubmit={onSubmit} />
    </ModalShell>
  )
}

function App(): React.JSX.Element {
  const { t } = useTranslation()
  const { hosts, error: hostsError, create, update, remove, refresh } = useHosts()
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
  const [language, setLanguage] = useState<LanguageCode>('zh')
  const [themePreference, setThemePreference] = useState<ThemePreference>('system')
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    typeof window !== 'undefined' ? getSystemPrefersDark() : true
  )
  const [terminalFontFamily, setTerminalFontFamily] = useState('Hack')
  const [terminalFontSize, setTerminalFontSize] = useState(14)
  const [mcpIdleTimeoutMinutes, setMcpIdleTimeoutMinutes] = useState(10)
  const [mcpMaxSessions, setMcpMaxSessions] = useState(8)
  const [sftpExpanded, setSftpExpanded] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [hostsOpen, setHostsOpen] = useState(false)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)
  const connectingRef = useRef(false)
  const savePromptedRef = useRef(new Set<string>())

  const resolvedTheme = resolveTheme(themePreference, systemPrefersDark)

  useEffect(() => {
    applyResolvedTheme(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    if (themePreference !== 'system') return
    return subscribeSystemPrefersDark(setSystemPrefersDark)
  }, [themePreference])

  useEffect(() => {
    void (async () => {
      try {
        const settings = await window.api.settings.get()
        setLanguage(settings.language)
        setThemePreference(settings.themePreference)
        setTerminalFontFamily(settings.terminalFontFamily)
        setTerminalFontSize(settings.terminalFontSize)
        setMcpIdleTimeoutMinutes(settings.mcpIdleTimeoutMinutes)
        setMcpMaxSessions(settings.mcpMaxSessions)
        await i18n.changeLanguage(settings.language)
      } catch {
        setLanguage('zh')
        setThemePreference('system')
        setTerminalFontFamily('Hack')
        setTerminalFontSize(14)
        setMcpIdleTimeoutMinutes(10)
        setMcpMaxSessions(8)
        await i18n.changeLanguage('zh')
      }
    })()
  }, [])

  const askConfirm = (request: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> =>
    new Promise((resolve) => {
      setConfirmRequest({ ...request, resolve })
    })

  const handleLanguageChange = async (next: LanguageCode): Promise<void> => {
    const previous = language
    setLanguage(next)
    await i18n.changeLanguage(next)
    try {
      await window.api.settings.set({ language: next })
    } catch {
      setLanguage(previous)
      await i18n.changeLanguage(previous)
      setToast(t('auth.connectionFailed'))
    }
  }

  const handleThemePreferenceChange = async (next: ThemePreference): Promise<void> => {
    const previous = themePreference
    setThemePreference(next)
    try {
      const saved = await window.api.settings.set({ themePreference: next })
      setThemePreference(saved.themePreference)
    } catch {
      setThemePreference(previous)
      setToast(t('auth.connectionFailed'))
    }
  }

  const handleTerminalFontFamilyChange = async (next: string): Promise<void> => {
    const previous = terminalFontFamily
    setTerminalFontFamily(next)
    try {
      const saved = await window.api.settings.set({ terminalFontFamily: next })
      setTerminalFontFamily(saved.terminalFontFamily)
    } catch {
      setTerminalFontFamily(previous)
      setToast(t('auth.connectionFailed'))
    }
  }

  const handleTerminalFontSizeChange = async (next: number): Promise<void> => {
    const previous = terminalFontSize
    setTerminalFontSize(next)
    try {
      const saved = await window.api.settings.set({ terminalFontSize: next })
      setTerminalFontSize(saved.terminalFontSize)
    } catch {
      setTerminalFontSize(previous)
      setToast(t('auth.connectionFailed'))
    }
  }

  const handleMcpIdleTimeoutMinutesChange = async (next: number): Promise<void> => {
    const previous = mcpIdleTimeoutMinutes
    setMcpIdleTimeoutMinutes(next)
    try {
      const saved = await window.api.settings.set({ mcpIdleTimeoutMinutes: next })
      setMcpIdleTimeoutMinutes(saved.mcpIdleTimeoutMinutes)
    } catch {
      setMcpIdleTimeoutMinutes(previous)
      setToast(t('auth.connectionFailed'))
    }
  }

  const handleMcpMaxSessionsChange = async (next: number): Promise<void> => {
    const previous = mcpMaxSessions
    setMcpMaxSessions(next)
    try {
      const saved = await window.api.settings.set({ mcpMaxSessions: next })
      setMcpMaxSessions(saved.mcpMaxSessions)
    } catch {
      setMcpMaxSessions(previous)
      setToast(t('auth.connectionFailed'))
    }
  }

  const maybePromptSaveCredentials = async (
    host: HostConfig,
    password?: string
  ): Promise<void> => {
    const latest = (await window.api.hosts.list()).find((h) => h.id === host.id) ?? host
    if (latest.credentialsPrompted || savePromptedRef.current.has(latest.id)) return
    savePromptedRef.current.add(latest.id)

    const save = await askConfirm({
      title: t('auth.saveCredentialsTitle'),
      message: t('auth.saveCredentials', { name: latest.name }),
      confirmLabel: t('auth.saveCredentialsConfirm'),
      cancelLabel: t('auth.saveCredentialsSkip')
    })

    if (!save) {
      await window.api.credentials.markPrompted(latest.id, false)
      await refresh()
      return
    }
    try {
      const available = await window.api.credentials.isAvailable()
      if (!available) {
        setToast(t('auth.credentialsUnavailable'))
        await window.api.credentials.markPrompted(latest.id, false)
        await refresh()
        return
      }
      await window.api.credentials.save(latest.id, {
        ...(password ? { password } : {}),
        ...(latest.privateKeyPath ? { privateKeyPath: latest.privateKeyPath } : {})
      })
      await refresh()
    } catch (e) {
      setToast(e instanceof Error ? e.message : t('auth.credentialsUnavailable'))
    }
  }

  const runConnect = async (
    host: HostConfig,
    options?: { password?: string; acceptHostKey?: boolean }
  ): Promise<void> => {
    try {
      await connect(host, options)
      setPasswordAction(null)
      setHostsOpen(false)
      await maybePromptSaveCredentials(host, options?.password)
    } catch (e) {
      if (e instanceof ConnectError && e.code === 'HOST_KEY_CHANGED') {
        const accept = await askConfirm({
          title: t('auth.hostKeyChangedTitle'),
          message: t('auth.hostKeyChanged', { message: e.message })
        })
        if (accept) {
          await runConnect(host, { ...options, acceptHostKey: true })
          return
        }
        setToast(e.message)
        return
      }
      const message = e instanceof Error ? e.message : t('auth.connectionFailed')
      setToast(message)
    }
  }

  const attemptConnect = async (
    host: HostConfig,
    options?: { password?: string; acceptHostKey?: boolean }
  ): Promise<void> => {
    if (connectingRef.current) return
    connectingRef.current = true
    setConnecting(true)
    try {
      await runConnect(host, options)
    } finally {
      connectingRef.current = false
      setConnecting(false)
    }
  }

  const runReconnect = async (
    session: UiSession,
    host: HostConfig,
    options?: { password?: string; acceptHostKey?: boolean }
  ): Promise<void> => {
    try {
      await reconnect(session, host, options)
      setPasswordAction(null)
    } catch (e) {
      if (e instanceof ConnectError && e.code === 'HOST_KEY_CHANGED') {
        const accept = await askConfirm({
          title: t('auth.hostKeyChangedTitle'),
          message: t('auth.hostKeyChangedReconnect', { message: e.message })
        })
        if (accept) {
          await runReconnect(session, host, { ...options, acceptHostKey: true })
          return
        }
        setToast(e.message)
        return
      }
      const message = e instanceof Error ? e.message : t('auth.reconnectFailed')
      setToast(message)
    }
  }

  const attemptReconnect = async (
    session: UiSession,
    host: HostConfig,
    options?: { password?: string; acceptHostKey?: boolean }
  ): Promise<void> => {
    if (connectingRef.current) return
    connectingRef.current = true
    setConnecting(true)
    try {
      await runReconnect(session, host, options)
    } finally {
      connectingRef.current = false
      setConnecting(false)
    }
  }

  const handleConnect = (host: HostConfig): void => {
    if (connectingRef.current) return
    if (host.authMethod === 'password' && !host.credentialsSaved) {
      setPasswordAction({ type: 'connect', host })
      return
    }
    void attemptConnect(host)
  }

  const handlePasswordSubmit = (password: string): void => {
    if (!passwordAction || connectingRef.current) return
    if (passwordAction.type === 'connect') {
      void attemptConnect(passwordAction.host, { password })
    } else {
      void attemptReconnect(passwordAction.session, passwordAction.host, { password })
    }
  }

  const handleReconnect = (session: UiSession): void => {
    if (connectingRef.current) return
    const host = hosts.find((h) => h.id === session.hostId)
    if (!host) {
      setToast(t('auth.hostNotFound'))
      return
    }
    if (host.authMethod === 'password' && !host.credentialsSaved) {
      setPasswordAction({ type: 'reconnect', host, session })
      return
    }
    void attemptReconnect(session, host)
  }

  const toastMessage = sessionsToast ?? hostsError

  return (
    <div className="app">
      <aside className="sidebar">
        <ErrorBoundary>
          <SidebarPanel
            activeSessionId={activeSessionId}
            activeSessionTitle={
              sessions.find((s) => s.sessionId === activeSessionId)?.title ?? null
            }
            connected={
              sessions.find((s) => s.sessionId === activeSessionId)?.status === 'connected'
            }
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </ErrorBoundary>
      </aside>
      <main className="main main-with-sessions">
        <ErrorBoundary>
          <SessionTabs
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelect={setActiveSessionId}
            onClose={(id) => void disconnect(id)}
            onReconnect={handleReconnect}
            registerDataListener={registerDataListener}
            sftpExpanded={sftpExpanded}
            onToggleSftp={() => setSftpExpanded((v) => !v)}
            onOpenHosts={() => setHostsOpen(true)}
            terminalFontFamily={terminalFontFamily}
            terminalFontSize={terminalFontSize}
            resolvedTheme={resolvedTheme}
            onTerminalFontSizeChange={(size) => void handleTerminalFontSizeChange(size)}
          />
        </ErrorBoundary>
      </main>
      {hostsOpen && (
        <HostPickerModal
          hosts={hosts}
          connecting={connecting}
          onConnect={handleConnect}
          onCreate={create}
          onUpdate={update}
          onRemove={remove}
          onClose={() => setHostsOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsModal
          language={language}
          themePreference={themePreference}
          terminalFontFamily={terminalFontFamily}
          terminalFontSize={terminalFontSize}
          mcpIdleTimeoutMinutes={mcpIdleTimeoutMinutes}
          mcpMaxSessions={mcpMaxSessions}
          onLanguageChange={(lang) => void handleLanguageChange(lang)}
          onThemePreferenceChange={(theme) => void handleThemePreferenceChange(theme)}
          onTerminalFontFamilyChange={(family) => void handleTerminalFontFamilyChange(family)}
          onTerminalFontSizeChange={(size) => void handleTerminalFontSizeChange(size)}
          onMcpIdleTimeoutMinutesChange={(minutes) => void handleMcpIdleTimeoutMinutesChange(minutes)}
          onMcpMaxSessionsChange={(max) => void handleMcpMaxSessionsChange(max)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {passwordAction && (
        <PasswordModal
          host={passwordAction.host}
          busy={connecting}
          onSubmit={handlePasswordSubmit}
          onCancel={() => {
            if (!connectingRef.current) setPasswordAction(null)
          }}
        />
      )}
      {confirmRequest && (
        <ConfirmModal
          title={confirmRequest.title}
          message={confirmRequest.message}
          confirmLabel={confirmRequest.confirmLabel}
          cancelLabel={confirmRequest.cancelLabel}
          onConfirm={() => {
            const { resolve } = confirmRequest
            setConfirmRequest(null)
            resolve(true)
          }}
          onCancel={() => {
            const { resolve } = confirmRequest
            setConfirmRequest(null)
            resolve(false)
          }}
        />
      )}
      <Toast message={toastMessage} onClose={() => setToast(null)} />
    </div>
  )
}

export default App
