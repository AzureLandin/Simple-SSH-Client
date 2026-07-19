import type { ResolvedTheme, ThemePreference } from '../../shared/types'

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'light') return 'light'
  if (preference === 'dark') return 'dark'
  return prefersDark ? 'dark' : 'light'
}

export function applyResolvedTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme
}

export function getSystemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function subscribeSystemPrefersDark(listener: (prefersDark: boolean) => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = (): void => listener(mq.matches)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
