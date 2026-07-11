# Remote Monitor Implementation Plan

**Spec:** `docs/superpowers/specs/2026-07-11-remote-monitor-design.md`

### Tasks
1. Parse helpers + unit tests (`/proc/stat`, meminfo, loadavg, net/dev)
2. `MonitorService` exec polling + start/stop by session
3. IPC + types + preload `monitor.onUpdate`
4. Sidebar UI + i18n; wire active session from App
5. Verify tests / typecheck
