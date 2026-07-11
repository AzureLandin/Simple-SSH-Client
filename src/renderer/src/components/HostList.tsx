import { useState } from 'react'
import type { HostConfig, HostInput } from '../../../shared/types'
import { HostForm } from './HostForm'

interface HostListProps {
  hosts: HostConfig[]
  onConnect: (host: HostConfig) => void
  onCreate: (input: HostInput) => Promise<void>
  onUpdate: (id: string, patch: Partial<HostInput>) => Promise<void>
  onRemove: (id: string) => Promise<void>
}

type FormMode = { type: 'create' } | { type: 'edit'; host: HostConfig }

export function HostList({
  hosts,
  onConnect,
  onCreate,
  onUpdate,
  onRemove
}: HostListProps): React.JSX.Element {
  const [formMode, setFormMode] = useState<FormMode | null>(null)

  const handleDelete = async (host: HostConfig): Promise<void> => {
    if (!window.confirm(`Delete host "${host.name}"?`)) return
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
        <h2 className="host-list-title">Hosts</h2>
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={() => setFormMode({ type: 'create' })}
        >
          New host
        </button>
      </div>

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
        {hosts.length === 0 && <li className="host-empty">No hosts yet</li>}
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
                Connect
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setFormMode({ type: 'edit', host })}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn-danger btn-sm"
                onClick={() => void handleDelete(host)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
