import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface ConfirmModalProps {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel
}: ConfirmModalProps): React.JSX.Element {
  const { t } = useTranslation()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="modal-overlay" role="presentation" onClick={onCancel}>
      <div
        className="modal confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-modal-title" className="modal-title">
          {title}
        </h3>
        <p className="confirm-modal-message">{message}</p>
        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button type="button" className="btn-primary" onClick={onConfirm} autoFocus>
            {confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
