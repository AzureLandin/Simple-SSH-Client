import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LanguageCode } from '../../../shared/types'

interface SettingsModalProps {
  language: LanguageCode
  terminalFontFamily: string
  terminalFontSize: number
  mcpIdleTimeoutMinutes: number
  mcpMaxSessions: number
  onLanguageChange: (language: LanguageCode) => void
  onTerminalFontFamilyChange: (family: string) => void
  onTerminalFontSizeChange: (size: number) => void
  onMcpIdleTimeoutMinutesChange: (minutes: number) => void
  onMcpMaxSessionsChange: (max: number) => void
  onClose: () => void
}

const IDLE_TIMEOUT_OPTIONS = [1, 5, 10, 15, 30, 60, 120]
const MAX_SESSION_OPTIONS = [1, 2, 4, 8, 16, 32]

export function SettingsModal({
  language,
  terminalFontFamily,
  terminalFontSize,
  mcpIdleTimeoutMinutes,
  mcpMaxSessions,
  onLanguageChange,
  onTerminalFontFamilyChange,
  onTerminalFontSizeChange,
  onMcpIdleTimeoutMinutesChange,
  onMcpMaxSessionsChange,
  onClose
}: SettingsModalProps): React.JSX.Element {
  const { t } = useTranslation()
  const [fonts, setFonts] = useState<string[]>([])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    void (async () => {
      try {
        const list = await window.api.fonts.list()
        setFonts(list)
      } catch {
        setFonts([])
      }
    })()
  }, [])

  const fontOptions =
    fonts.includes(terminalFontFamily) || !terminalFontFamily
      ? fonts
      : [terminalFontFamily, ...fonts]

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <h3 id="settings-modal-title" className="modal-title">
            {t('settings.title')}
          </h3>
          <button
            type="button"
            className="settings-modal-close"
            aria-label={t('common.dismiss')}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <label className="form-field">
          <span>{t('common.language')}</span>
          <select
            value={language}
            onChange={(e) => onLanguageChange(e.target.value as LanguageCode)}
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </label>

        <fieldset className="settings-section">
          <legend>{t('settings.terminal')}</legend>

          <label className="form-field">
            <span>{t('settings.fontFamily')}</span>
            <select
              value={terminalFontFamily}
              onChange={(e) => onTerminalFontFamilyChange(e.target.value)}
            >
              {fontOptions.length === 0 ? (
                <option value={terminalFontFamily}>{terminalFontFamily}</option>
              ) : (
                fontOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="form-field">
            <span>{t('settings.fontSize')}</span>
            <input
              type="number"
              min={10}
              max={24}
              step={1}
              value={terminalFontSize}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isFinite(n)) return
                onTerminalFontSizeChange(n)
              }}
            />
          </label>
        </fieldset>

        <fieldset className="settings-section">
          <legend>{t('settings.mcp')}</legend>
          <p className="settings-hint">{t('settings.mcpHint')}</p>

          <label className="form-field">
            <span>{t('settings.mcpIdleTimeout')}</span>
            <select
              value={String(
                IDLE_TIMEOUT_OPTIONS.includes(mcpIdleTimeoutMinutes)
                  ? mcpIdleTimeoutMinutes
                  : Math.min(120, Math.max(1, mcpIdleTimeoutMinutes))
              )}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isFinite(n)) return
                onMcpIdleTimeoutMinutesChange(n)
              }}
            >
              {(IDLE_TIMEOUT_OPTIONS.includes(mcpIdleTimeoutMinutes)
                ? IDLE_TIMEOUT_OPTIONS
                : [...IDLE_TIMEOUT_OPTIONS, mcpIdleTimeoutMinutes].sort((a, b) => a - b)
              ).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>{t('settings.mcpMaxSessions')}</span>
            <select
              value={String(
                MAX_SESSION_OPTIONS.includes(mcpMaxSessions)
                  ? mcpMaxSessions
                  : Math.min(32, Math.max(1, mcpMaxSessions))
              )}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isFinite(n)) return
                onMcpMaxSessionsChange(n)
              }}
            >
              {(MAX_SESSION_OPTIONS.includes(mcpMaxSessions)
                ? MAX_SESSION_OPTIONS
                : [...MAX_SESSION_OPTIONS, mcpMaxSessions].sort((a, b) => a - b)
              ).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <div className="form-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            {t('common.dismiss')}
          </button>
        </div>
      </div>
    </div>
  )
}
