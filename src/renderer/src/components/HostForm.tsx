import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuthMethod, HostInput } from '../../../shared/types'
import { Select } from './Select'

interface HostFormProps {
  initial?: Partial<HostInput> & { id?: string }
  onSubmit: (input: HostInput) => Promise<void> | void
  onCancel: () => void
}

export function HostForm({ initial, onSubmit, onCancel }: HostFormProps): React.JSX.Element {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [host, setHost] = useState(initial?.host ?? '')
  const [port, setPort] = useState(String(initial?.port ?? 22))
  const [username, setUsername] = useState(initial?.username ?? '')
  const [authMethod, setAuthMethod] = useState<AuthMethod>(initial?.authMethod ?? 'password')
  const [privateKeyPath, setPrivateKeyPath] = useState(initial?.privateKeyPath ?? '')
  const [submitting, setSubmitting] = useState(false)

  const handleBrowse = async (): Promise<void> => {
    const path = await window.api.dialog.openPrivateKeyFile()
    if (path) setPrivateKeyPath(path)
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const portNum = Number(port)
    if (!name.trim() || !host.trim() || !username.trim() || !Number.isFinite(portNum)) return

    const input: HostInput = {
      name: name.trim(),
      host: host.trim(),
      port: portNum,
      username: username.trim(),
      authMethod,
      ...(authMethod === 'privateKey' && privateKeyPath ? { privateKeyPath } : {})
    }

    setSubmitting(true)
    try {
      await onSubmit(input)
    } finally {
      setSubmitting(false)
    }
  }

  const isEdit = Boolean(initial?.id)

  return (
    <form className="host-form" onSubmit={(e) => void handleSubmit(e)}>
      <h3 className="host-form-title">{isEdit ? t('form.editTitle') : t('form.newTitle')}</h3>

      <label className="form-field">
        <span>{t('form.name')}</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
      </label>

      <label className="form-field">
        <span>{t('form.host')}</span>
        <input
          type="text"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          required
          placeholder="example.com"
        />
      </label>

      <label className="form-field">
        <span>{t('form.port')}</span>
        <input
          type="number"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          required
          min={1}
          max={65535}
        />
      </label>

      <label className="form-field">
        <span>{t('form.username')}</span>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </label>

      <div className="form-field">
        <span>{t('form.auth')}</span>
        <Select
          value={authMethod}
          onChange={(v) => setAuthMethod(v as AuthMethod)}
          options={[
            { value: 'password', label: t('form.password') },
            { value: 'privateKey', label: t('form.privateKey') }
          ]}
        />
      </div>

      {authMethod === 'privateKey' && (
        <label className="form-field">
          <span>{t('form.privateKeyPath')}</span>
          <div className="form-field-row">
            <input
              type="text"
              value={privateKeyPath}
              onChange={(e) => setPrivateKeyPath(e.target.value)}
              placeholder="/path/to/key"
            />
            <button type="button" onClick={() => void handleBrowse()}>
              {t('form.browse')}
            </button>
          </div>
        </label>
      )}

      <div className="form-actions">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
          {t('form.cancel')}
        </button>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? t('form.saving') : isEdit ? t('form.save') : t('form.create')}
        </button>
      </div>
    </form>
  )
}
