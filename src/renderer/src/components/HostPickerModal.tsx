import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HostConfig, HostInput } from '../../../shared/types'
import { HostForm } from './HostForm'
import { ModalShell, useModalClose } from './ModalShell'

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

function HostPickerModalBody({
  hosts,
  connecting,
  onConnect,
  onCreate,
  onUpdate,
  onRemove,
  formMode,
  setFormMode
}: {
  hosts: HostConfig[]
  connecting: boolean
  onConnect: (host: HostConfig) => void
  onCreate: (input: HostInput) => Promise<void>
  onUpdate: (id: string, patch: Partial<HostInput>) => Promise<void>
  onRemove: (id: string) => Promise<void>
  formMode: FormMode | null
  setFormMode: (mode: FormMode | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const requestClose = useModalClose()

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
    <>
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
            onClick={requestClose}
          >
            ×
          </button>
        </div>
      </div>

      {formMode ? (
        <div className="host-form-overlay host-form-overlay-in-modal">
          <HostForm
            initial={
              formMode.type === 'edit' ? { ...formMode.host, id: formMode.host.id } : undefined
            }
            onSubmit={handleFormSubmit}
            onCancel={() => setFormMode(null)}
          />
        </div>
      ) : (
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
        {hosts.map((host) => {
          const initial = host.name.trim().charAt(0).toUpperCase() || '#'
          const authLabel =
            host.authMethod === 'privateKey' ? t('form.privateKey') : t('form.password')
          return (
            <li key={host.id} className="host-item">
              <div className="host-item-top">
                <div className="host-item-avatar" aria-hidden>
                  {initial}
                </div>
                <div className="host-item-info">
                  <span className="host-item-name">{host.name}</span>
                  <div className="host-item-meta">
                    <div className="host-item-meta-row">
                      <span className="host-item-label">{t('form.host')}</span>
                      <span className="host-item-value">
                        {host.host}
                        <span className="host-item-port">:{host.port}</span>
                      </span>
                    </div>
                    <div className="host-item-meta-row">
                      <span className="host-item-label">{t('form.username')}</span>
                      <span className="host-item-value">{host.username}</span>
                    </div>
                    <div className="host-item-meta-row">
                      <span className="host-item-label">{t('form.auth')}</span>
                      <span className="host-item-badge">{authLabel}</span>
                    </div>
                  </div>
                </div>
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
          )
        })}
      </ul>
      )}
    </>
  )
}

export function HostPickerModal({
  hosts,
  connecting = false,
  onConnect,
  onCreate,
  onUpdate,
  onRemove,
  onClose
}: HostPickerModalProps): React.JSX.Element {
  const [formMode, setFormMode] = useState<FormMode | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && formMode) setFormMode(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [formMode])

  return (
    <ModalShell
      onClose={onClose}
      dialogClassName="host-picker-modal"
      labelledBy="host-picker-title"
      closeOnEscape={!formMode}
    >
      <HostPickerModalBody
        hosts={hosts}
        connecting={connecting}
        onConnect={onConnect}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onRemove={onRemove}
        formMode={formMode}
        setFormMode={setFormMode}
      />
    </ModalShell>
  )
}
