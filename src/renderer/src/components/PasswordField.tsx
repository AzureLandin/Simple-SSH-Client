import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface PasswordFieldProps {
  id?: string
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  required?: boolean
  autoFocus?: boolean
  autoComplete?: string
  placeholder?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
  className?: string
}

export function PasswordField({
  id,
  label,
  value,
  onChange,
  disabled,
  required,
  autoFocus,
  autoComplete = 'current-password',
  placeholder,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  className
}: PasswordFieldProps): React.JSX.Element {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)

  return (
    <label className="form-field">
      <span>{label}</span>
      <div className="form-field-row password-field-row">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          required={required}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          className={className}
        />
        <button
          type="button"
          className="btn-secondary password-visibility-toggle"
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          aria-pressed={visible}
          aria-label={visible ? t('form.hidePassword') : t('form.showPassword')}
          title={visible ? t('form.hidePassword') : t('form.showPassword')}
        >
          {visible ? t('form.hidePassword') : t('form.showPassword')}
        </button>
      </div>
    </label>
  )
}
