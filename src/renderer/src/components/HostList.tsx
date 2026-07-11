import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HostConfig, HostInput } from '../../../shared/types'
import { HostForm } from './HostForm'

interface HostListProps {
  hosts: HostConfig[]
  onConnect: (host: HostConfig) => void
  onCreate: (input: HostInput) => Promise<void>
  onUpdate: (id: string, patch: Partial<HostInput>) => Promise<void>
  onRemove: (id: string) => Promise<void>
  language: 'zh' | 'en'
  onLanguageChange: (language: 'zh' | 'en') => void
}

type FormMode = { type: 'create' } | { type: 'edit'; host: HostConfig }

export function HostList({
  hosts,
  onConnect,
  onCreate,
  onUpdate,
  onRemove,
  language,
  onLanguageChange
}: HostListProps): React.JSX.Element {
  const { t } = useTranslation()
  const [formMode, setFormMode] = useState<FormMode | null>(null)

  const handleDelete = async (host: HostConfig): Promise<void> => {
    if (!window.confirm(t('hosts.deleteConfirm', { name: host.name }))) return
    await onRemove(host.id)
  }

  const handleFormSubmit = async (input: HostInput): Promise<void> => {
    if (formMode?.type === 'edit') {
      await onUpdate(formMode.host.id, input)
    } else {
      await onCreate(input)
    }
    setFormMode(null)
  }

  return (
    <div className="host-list">
      <div className="host-list-header">
        <h2 className="host-list-title">{t('hosts.title')}</h2>
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={() => setFormMode({ type: 'create' })}
        >
          {t('hosts.new')}
        </button>
      </div>

      <label className="language-switcher">
        <span>{t('common.language')}</span>
        <select
          value={language}
          onChange={(e) => onLanguageChange(e.target.value as 'zh' | 'en')}
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </label>

      {formMode && (
        <div className="host-form-overlay">
          <HostForm
            initial={
              formMode.type === 'edit'
                ? { ...formMode.host, id: formMode.host.id }
                : undefined
            }
            onSubmit={handleFormSubmit}
            onCancel={() => setFormMode(null)}
          />
        </div>
      )}

      <ul className="host-items">
        {hosts.length === 0 && <li className="host-empty">{t('hosts.empty')}</li>}
        {hosts.map((host) => (
          <li key={host.id} className="host-item">
            <div className="host-item-info">
              <span className="host-item-name">{host.name}</span>
              <span className="host-item-detail">
                {host.host}:{host.port}
              </span>
              <span className="host-item-detail">{host.username}</span>
            </div>
            <div className="host-item-actions">
              <button type="button" className="btn-primary btn-sm" onClick={() => onConnect(host)}>
                {t('hosts.connect')}
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setFormMode({ type: 'edit', host })}
              >
                {t('hosts.edit')}
              </button>
              <button
                type="button"
                className="btn-danger btn-sm"
                onClick={() => void handleDelete(host)}
              >
                {t('hosts.delete')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
