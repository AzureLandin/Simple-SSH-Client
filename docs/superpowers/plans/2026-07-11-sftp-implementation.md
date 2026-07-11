# SFTP Implementation Plan

> **For agentic workers:** Implement task-by-task per spec.

**Goal:** Expandable bottom SFTP panel bound to active SSH session (list/upload/download/mkdir/rename/delete).

**Spec:** `docs/superpowers/specs/2026-07-11-sftp-design.md`

### Tasks
1. `SftpService` on ssh2 client + unit tests for path helpers
2. IPC channels + dialogs for upload/download
3. `SftpPanel` UI + App layout (terminal top, panel bottom)
4. i18n strings
