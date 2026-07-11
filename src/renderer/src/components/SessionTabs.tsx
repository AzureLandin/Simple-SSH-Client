import { useTranslation } from 'react-i18next'
import type { UiSession } from '../hooks/useSessions'
import { TerminalView } from './TerminalView'

interface SessionTabsProps {
  sessions: UiSession[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onReconnect: (session: UiSession) => void
  registerDataListener: (sessionId: string, cb: (data: string) => void) => () => void
}

function statusClass(status: UiSession['status']): string {
  return `session-status-dot session-status-${status}`
}

export function SessionTabs({
  sessions,
  activeSessionId,
  onSelect,
  onClose,
  onReconnect,
  registerDataListener
}: SessionTabsProps): React.JSX.Element {
  const { t } = useTranslation()
  const activeSession = sessions.find((s) => s.sessionId === activeSessionId)

  return (
    <div className="session-tabs">
      <div className="session-tab-bar" role="tablist">
        {sessions.map((session) => (
          <div
            key={session.sessionId}
            className={`session-tab${session.sessionId === activeSessionId ? ' session-tab-active' : ''}`}
            role="tab"
            aria-selected={session.sessionId === activeSessionId}
            onClick={() => onSelect(session.sessionId)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(session.sessionId)
              }
            }}
            tabIndex={0}
          >
            <span className={statusClass(session.status)} aria-hidden />
            <span className="session-tab-title">{session.title}</span>
            <button
              type="button"
              className="session-tab-close"
              aria-label={`${t('session.close')} ${session.title}`}
              onClick={(e) => {
                e.stopPropagation()
                void onClose(session.sessionId)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="session-terminal-area">
        {activeSession &&
          (activeSession.status === 'disconnected' || activeSession.status === 'error') && (
            <div className="session-banner" role="alert">
              <span>
                {activeSession.status === 'error'
                  ? (activeSession.errorMessage ?? t('session.error'))
                  : t('session.disconnected')}
              </span>
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => onReconnect(activeSession)}
              >
                {t('session.reconnect')}
              </button>
            </div>
          )}

        <div className="session-terminals">
          {sessions.map((session) => (
            <TerminalView
              key={session.sessionId}
              sessionId={session.sessionId}
              registerDataListener={registerDataListener}
              visible={session.sessionId === activeSessionId}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
