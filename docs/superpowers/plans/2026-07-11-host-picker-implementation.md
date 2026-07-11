# Host Picker Implementation Plan

> **For agentic workers:** Implement task-by-task per spec `docs/superpowers/specs/2026-07-11-host-picker-design.md`.

**Goal:** FinalShell-style hosts button + modal; sidebar placeholder only.

### Tasks
1. `SidebarPanel` placeholder + settings footer
2. `HostPickerModal` (list/CRUD/connect from current HostList)
3. Main top bar Hosts button (always visible) in `SessionTabs` / App shell
4. i18n + CSS; close picker after successful connect
5. Verify typecheck/tests
