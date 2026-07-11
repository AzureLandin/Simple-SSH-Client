# Terminal One Dark + Font Settings — Design Spec

**Date:** 2026-07-11  
**Status:** Approved  
**Scope:** Beautify the xterm terminal with a One Dark–style theme, default to Hack (system fallback), and add font family + size controls in Settings.

## Goals

- Apply a fixed **One Dark–inspired** xterm color theme (background, foreground, cursor, ANSI 16 colors).
- Default font stack: `Hack, Consolas, "Courier New", monospace` (no bundled font files).
- Default font size: **14**.
- Allow users to choose **terminal font family** and **font size** in the existing Settings modal.
- Persist choices in `settings.json` and apply them live to open terminals.
- List system fonts via the **main process** for the Settings dropdown.

## Non-Goals

- Multiple selectable color themes / theme marketplace
- Bundling Hack (or any) font files in the app
- Line height / letter-spacing controls
- Per-session font overrides
- Changing SFTP / sidebar chrome to match One Dark beyond what already exists

## Defaults & Look

| Item | Value |
|------|--------|
| Theme | One Dark–style xterm `ITheme` constant |
| Font family default | `"Hack"` (CSS stack includes Consolas / Courier New / monospace fallbacks when applying to xterm) |
| Font size default | `14` |
| Size range (UI) | `10`–`24` |
| Padding | Slightly increased terminal padding so content is not flush to edges |

Theme lives in a small shared/renderer constant module (e.g. `src/renderer/src/terminal-theme.ts`) and is passed into `Terminal` on create. Theme is not user-configurable in this iteration.

## Settings & Persistence

Extend `AppSettings`:

```ts
interface AppSettings {
  language: LanguageCode
  terminalFontFamily: string  // default "Hack"
  terminalFontSize: number    // default 14
}
```

`SettingsStore` merges defaults when reading older `settings.json` files that lack the new fields.

Settings modal gains a **Terminal** section:

- Font family: `<select>` populated from system font list
- Font size: number input or stepper, clamped to 10–24
- Changes call `settings.set` immediately (same pattern as language) and update app state so terminals refresh without restart

i18n keys under `settings.*` / `terminal.*` for zh and en.

## Architecture

```
SettingsModal
  ├─ fonts.list() ──IPC──► main: font-list (or equivalent)
  └─ settings.set({ terminalFontFamily, terminalFontSize })
           │
           ▼
    SettingsStore → userData/settings.json
           │
           ▼
    App state → TerminalView props (fontFamily, fontSize)
           │
           ▼
    xterm options + fit + sessions.resize
```

### Components / modules

| Piece | Responsibility |
|-------|----------------|
| `terminal-theme.ts` | One Dark xterm theme constant |
| `SettingsStore` / `AppSettings` | Persist font family & size |
| IPC `fonts:list` | Main process enumerates system fonts; returns sorted unique family names |
| `SettingsModal` | Language + terminal font controls |
| `TerminalView` | Apply theme; accept font props; hot-update on prop change |
| `App` | Load settings on start; pass font settings into `TerminalView` / `SessionTabs` |

### Live update

When `fontFamily` or `fontSize` props change on an existing `Terminal`:

1. Assign `term.options.fontFamily` / `term.options.fontSize`
2. `fitAddon.fit()`
3. `sessions.resize(sessionId, cols, rows)`

Font family applied to xterm should be a stack, e.g.  
`"${chosen}, Consolas, \"Courier New\", monospace"`  
when `chosen` is not already a generic fallback, so missing fonts degrade gracefully.

### System fonts

- Prefer a maintained Node package such as `font-list` in the main process.
- Deduplicate and sort names for the UI.
- If listing fails, Settings still allows keeping the current/default family (show current value; empty list or a short error toast).

## Error Handling

- Font list failure: do not block Settings; show empty/fallback select with current family.
- Invalid stored size (NaN / out of range): clamp to default range when reading settings.
- Empty font family string: treat as default `"Hack"`.

## Testing

- Unit: settings merge defaults for missing terminal fields; clamp font size.
- Manual: open Settings, change font/size, confirm open terminal updates; restart app and confirm persistence; machine without Hack still renders via Consolas fallback.
