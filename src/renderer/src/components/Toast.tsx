interface ToastProps {
  message: string | null
  onClose: () => void
}

export function Toast({ message, onClose }: ToastProps): React.JSX.Element | null {
  if (!message) return null

  return (
    <div className="toast" role="status">
      <span className="toast-message">{message}</span>
      <button type="button" className="toast-dismiss" onClick={onClose} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}
