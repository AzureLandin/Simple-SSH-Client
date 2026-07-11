# Terminal One Dark + Font Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a fixed One Dark xterm theme, default font Hack with system fallbacks, and let users pick terminal font family + size in Settings (persisted, live update).

**Architecture:** Extend `AppSettings` + `SettingsStore` for font fields; main-process `font-list` via IPC for the dropdown; `terminal-theme.ts` + font helpers in renderer; `TerminalView` takes font props and hot-updates; Settings modal adds Terminal section.

**Tech Stack:** Electron, React, xterm.js, `font-list`, existing SettingsStore / i18n

---

## File structure

| File | Role |
|------|------|
| `src/shared/types.ts` | `AppSettings` fields + `fonts.list` on `ElectronApi` / `IPC` |
| `src/main/settings-store.ts` | Defaults, normalize/clamp font family & size |
| `src/main/ipc.ts` | `fonts:list` handler |
| `src/preload/index.ts` | Expose `api.fonts.list` |
| `src/renderer/src/terminal-theme.ts` | One Dark `ITheme` + font stack helper |
| `src/renderer/src/components/TerminalView.tsx` | Theme, font props, live options update |
| `src/renderer/src/components/SettingsModal.tsx` | Font select + size input |
| `src/renderer/src/components/SessionTabs.tsx` | Pass font props to `TerminalView` |
| `src/renderer/src/App.tsx` | Load/save terminal settings state |
| `src/renderer/src/App.css` | Terminal background match One Dark |
| `src/renderer/src/i18n/locales/{zh,en}.json` | Settings strings |
| `tests/settings-store.test.ts` | Defaults + clamp |
| `package.json` | Add `font-list` dependency |

---

### Task 1: Settings model + tests

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/settings-store.ts`
- Modify: `tests/settings-store.test.ts`

- [ ] **Step 1: Extend `AppSettings`**

```ts
export interface AppSettings {
  language: LanguageCode
  terminalFontFamily: string
  terminalFontSize: number
}
```

- [ ] **Step 2: Update `SettingsStore` defaults and normalize**

```ts
const DEFAULT_SETTINGS: AppSettings = {
  language: 'zh',
  terminalFontFamily: 'Hack',
  terminalFontSize: 14
}

const FONT_SIZE_MIN = 10
const FONT_SIZE_MAX = 24

function normalizeTerminalFontFamily(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SETTINGS.terminalFontFamily
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : DEFAULT_SETTINGS.terminalFontFamily
}

function normalizeTerminalFontSize(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.terminalFontSize
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(n)))
}
```

`get` / `set` / `read` must include both new fields (merge defaults for old files).

- [ ] **Step 3: Update tests**

Expect default `{ language: 'zh', terminalFontFamily: 'Hack', terminalFontSize: 14 }`.  
Add cases: missing fields → defaults; size `8` → `10`; size `99` → `24`; empty family → `Hack`; persist both fields.

- [ ] **Step 4: Run `npm test -- tests/settings-store.test.ts` — expect PASS**

---

### Task 2: System font list IPC

**Files:**
- Modify: `package.json` (add `font-list`)
- Modify: `src/shared/types.ts` (`IPC.fontsList`, `ElectronApi.fonts`)
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: `npm install font-list`**

- [ ] **Step 2: IPC**

```ts
// types
fontsList: 'fonts:list'
// ElectronApi
fonts: { list: () => Promise<string[]> }

// ipc.ts
ipcMain.handle(IPC.fontsList, async () => {
  try {
    const { getFonts } = await import('font-list')
    const fonts = await getFonts({ disableQuoting: true })
    return [...new Set(fonts.map((f) => f.trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b)
    )
  } catch {
    return []
  }
})
```

- [ ] **Step 3: Preload `api.fonts.list`**

---

### Task 3: One Dark theme + TerminalView

**Files:**
- Create: `src/renderer/src/terminal-theme.ts`
- Modify: `src/renderer/src/components/TerminalView.tsx`
- Modify: `src/renderer/src/App.css` (`.terminal-view` / terminal area bg → `#282c34`)

- [ ] **Step 1: Theme + stack helper**

```ts
import type { ITheme } from '@xterm/xterm'

export const ONE_DARK_THEME: ITheme = {
  background: '#282c34',
  foreground: '#abb2bf',
  cursor: '#528bff',
  cursorAccent: '#282c34',
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
  return `"${primary.replace(/"/g, '')}", Consolas, "Courier New", monospace`
}
```

- [ ] **Step 2: `TerminalView` props `fontFamily` / `fontSize`; create with theme + stack; `useEffect` on font props to update options, fit, resize**

---

### Task 4: Settings UI + App wiring + i18n

**Files:**
- Modify: `SettingsModal.tsx`, `App.tsx`, `SessionTabs.tsx`, `zh.json`, `en.json`

- [ ] **Step 1: i18n keys** — `settings.terminal`, `settings.fontFamily`, `settings.fontSize`

- [ ] **Step 2: SettingsModal** — load `fonts.list` on mount; select + number input; callbacks `onTerminalFontChange`

- [ ] **Step 3: App** — state for family/size from settings.get; handlers that persist; pass into SettingsModal + SessionTabs → TerminalView

- [ ] **Step 4: `npm run typecheck` + `npm test` — expect PASS**

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| One Dark theme | 3 |
| Hack default + fallback stack | 1, 3 |
| Font family + size in Settings | 4 |
| Persist settings.json | 1 |
| System fonts via main | 2 |
| Live update open terminals | 3, 4 |
| Clamp / empty family | 1 |
| No bundled fonts / no multi-theme | (non-goals, skipped) |
