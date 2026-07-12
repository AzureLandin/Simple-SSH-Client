import * as RadixSelect from '@radix-ui/react-select'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  'aria-label'?: string
  id?: string
}

export function Select({
  value,
  options,
  onChange,
  disabled = false,
  placeholder,
  id,
  'aria-label': ariaLabel
}: SelectProps): React.JSX.Element {
  return (
    <RadixSelect.Root value={value} onValueChange={onChange} disabled={disabled}>
      <RadixSelect.Trigger id={id} className="app-select-trigger" aria-label={ariaLabel}>
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon asChild>
          <span className="app-select-chevron" aria-hidden />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          className="app-select-content"
          position="popper"
          sideOffset={4}
          onEscapeKeyDown={(e) => e.stopPropagation()}
        >
          <RadixSelect.ScrollUpButton className="app-select-scroll-btn">▴</RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="app-select-viewport">
            {options.map((opt) => (
              <RadixSelect.Item key={opt.value} className="app-select-option" value={opt.value}>
                <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="app-select-scroll-btn">▾</RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}
