import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HostConfig, HostInput } from '../../../shared/types'
import { HostForm } from './HostForm'

interface HostPickerModalProps {
  hosts: HostConfig[]
  connecting?: boolean
  onConnect: (host: HostConfig) => void
  onCreate: (input: HostInput) => Promise<void>
  onUpdate: (id: string, patch: Partial<HostInput>) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onClose: () => void
}

type FormMode = { type: 'create' } | { type: 'edit'; host: HostConfig }

export function HostPickerModal({
  hosts,
  connecting = false,
  onConnect,
  onCreate,
  onUpdate,
  onRemove,
  onClose
}: HostPickerModalProps): React.JSX.Element {
  const { t } = useTranslation()
  const [formMode, setFormMode] = useState<FormMode | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !formMode) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [formMode, onClose])

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
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal host-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="host-picker-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="host-picker-header">
          <h3 id="host-picker-title" className="modal-title">
            {t('hostsPicker.title')}
          </h3>
          <div className="host-picker-header-actions">
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => setFormMode({ type: 'create' })}
            >
              {t('hosts.new')}
            </button>
            <button
              type="button"
              className="settings-modal-close"
              aria-label={t('common.dismiss')}
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>

        {formMode && (
          <div className="host-form-overlay host-form-overlay-in-modal">
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

        <ul className="host-picker-list">
          {hosts.length === 0 && (
            <li className="host-empty">
              <p>{t('hostsPicker.empty')}</p>
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => setFormMode({ type: 'create' })}
              >
                {t('hosts.new')}
              </button>
            </li>
          )}
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
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={connecting}
                  onClick={() => onConnect(host)}
                >
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
    </div>
  )
}
