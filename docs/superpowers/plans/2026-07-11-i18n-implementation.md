# i18n (zh/en) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Chinese/English UI switching with i18next, persisted via `settings.json`.

**Architecture:** Main-process `SettingsStore` + IPC; renderer initializes i18next and uses `useTranslation()`; language select in host sidebar.

**Tech Stack:** i18next, react-i18next, existing Electron IPC patterns

**Spec:** `docs/superpowers/specs/2026-07-11-i18n-design.md`

---

## File structure

```
src/main/settings-store.ts
src/shared/types.ts          # AppSettings, settings IPC
src/main/ipc.ts              # register settings handlers
src/main/index.ts            # wire SettingsStore
src/preload/index.ts
src/renderer/src/i18n/index.ts
src/renderer/src/i18n/locales/zh.json
src/renderer/src/i18n/locales/en.json
src/renderer/src/components/*  # t() keys
src/renderer/src/App.tsx
src/renderer/src/main.tsx
tests/settings-store.test.ts
```

---

### Task 1: SettingsStore (TDD)

**Files:**
- Create: `src/main/settings-store.ts`
- Test: `tests/settings-store.test.ts`

- [ ] **Step 1: Failing tests** for default `{ language: 'zh' }` when missing; get/set language; invalid language falls back to zh; corrupt JSON throws typed error without overwrite.

- [ ] **Step 2: Implement** `SettingsStore` mirroring ConnectionStore file patterns.

- [ ] **Step 3: Commit** `feat: add SettingsStore for language preference`

---

### Task 2: Types + IPC + preload

- [ ] Extend `AppSettings`, `ElectronApi.settings`, `IPC.settingsGet/Set`
- [ ] Wire `registerIpc` + construct store in `index.ts`
- [ ] Commit `feat: expose settings IPC for language`

---

### Task 3: i18n setup + locale files

- [ ] `npm install i18next react-i18next`
- [ ] Create zh.json / en.json with all UI keys
- [ ] Create `i18n/index.ts`; import in `main.tsx` before render
- [ ] On App mount: `api.settings.get()` → `i18n.changeLanguage`
- [ ] Commit `feat: add i18next with zh/en locale files`

---

### Task 4: Wire UI strings + language switcher

- [ ] Replace hardcoded English in HostList, HostForm, SessionTabs, Toast, App (password modal, confirms, placeholder)
- [ ] Add language `<select>` in host sidebar
- [ ] Commit `feat: localize UI and add language switcher`

---

### Task 5: Verify

- [ ] `npm test` passes
- [ ] Manual: switch language, restart, persistence
