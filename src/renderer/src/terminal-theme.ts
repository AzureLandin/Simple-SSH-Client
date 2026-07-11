import type { ITheme } from '@xterm/xterm'

/** Atom One Dark–inspired xterm palette (fixed; not user-selectable in this iteration). */
export const ONE_DARK_THEME: ITheme = {
  background: '#1e1e1e',
  foreground: '#abb2bf',
  cursor: '#528bff',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#3e4451',
  black: '#282c34',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#abb2bf',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff'
}

export function buildTerminalFontStack(family: string): string {
  const primary = family.trim() || 'Hack'
  if (primary === 'monospace') return 'monospace'
  const safe = primary.replace(/"/g, '')
  return `"${safe}", Consolas, "Courier New", monospace`
}

export const TERMINAL_FONT_SIZE_MIN = 10
export const TERMINAL_FONT_SIZE_MAX = 24

export function clampTerminalFontSize(size: number): number {
  if (!Number.isFinite(size)) return 14
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(size)))
}
