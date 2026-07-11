# SFTP Bottom Panel — Design Spec

**Date:** 2026-07-11  
**Status:** Draft for review  
**Scope:** Remote file operations in an expandable bottom panel, bound to the active SSH terminal session (third of three follow-ups: i18n → credentials → SFTP)

## Goals

- Provide SFTP for the **currently connected** terminal session.
- UI: expandable **bottom panel** under the terminal; left sidebar remains host list.
- First version supports: browse, upload, download, mkdir, rename, delete.

## Non-Goals

- Local/remote dual-pane manager (WinSCP-style)
- SFTP without an active shell session
- Drag-and-drop upload, resume/partial transfers, chmod/chown UI
- Multiple concurrent SFTP UIs per session (one panel tied to active session)
- Archive extract, edit-remote-in-place

## Layout

```
┌──────────────┬────────────────────────────────┐
│ Host list    │ Terminal (active session)        │
│              ├────────────────────────────────┤
│              │ ▴ SFTP panel (collapsed/expanded)│
│              │ Remote listing + actions         │
└──────────────┴────────────────────────────────┘
```

- Collapsed by default; user expands via a handle / “Files” control.
- Panel height user-resizable (persist optional in settings later; not required for v1).
- If no connected active session: panel shows empty/disabled state (“Connect a session first”).
- Switching terminal tabs switches the SFTP view to that session’s cwd state (per-session path memory in renderer or main).

## Connection model

- Reuse the existing `ssh2` `Client` for the session: `client.sftp(callback)`.
- `SessionManager` (or a dedicated `SftpController` used by it) owns SFTP subsystem lifecycle per `sessionId`.
- When the session closes, SFTP handles are disposed and the panel resets for that id.
- No second login; credentials already established for the shell session apply.

## Features (v1)

| Action | Behavior |
|--------|----------|
| List | List current remote directory (name, size, modify time, isDirectory) |
| Navigate | Enter directory; go to parent (`..`) |
| Upload | Native open-file dialog → write into current remote directory (same basename; confirm overwrite if exists) |
| Download | Choose remote file → native save dialog → write locally |
| Mkdir | Prompt for name → `mkdir` |
| Rename | Prompt for new name → `rename` |
| Delete | Confirm → `unlink` or recursive delete for directories (v1: **files only**, or simple empty-dir remove; prefer: files + empty directories; non-empty dir → error asking to clear first **or** recursive delete with strong confirm — **decision: recursive delete for directories with explicit confirm**) |

## Main-process API shape

Conceptual IPC (exact channel names in implementation plan):

```ts
sftp: {
  list: (sessionId: string, remotePath?: string) => Promise<SftpEntry[]>
  // if remotePath omitted, use session's current SFTP cwd (default: home or `/`)
  cwd: (sessionId: string) => Promise<string>
  chdir: (sessionId: string, remotePath: string) => Promise<string>
  mkdir: (sessionId: string, name: string) => Promise<void>
  rename: (sessionId: string, from: string, to: string) => Promise<void>
  remove: (sessionId: string, remotePath: string) => Promise<void>
  upload: (sessionId: string, localPath: string, remoteName?: string) => Promise<void>
  download: (sessionId: string, remotePath: string, localPath: string) => Promise<void>
  onTransferProgress: (cb: (e: { sessionId: string; direction: 'up' | 'down'; transferred: number; total?: number }) => void) => () => void
}
```

Dialogs for local paths: reuse/extend `dialog` helpers in main (open file for upload, save dialog for download).

`SftpEntry`:

```ts
{
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifyTime: number
}
```

## Renderer

- Component: `SftpPanel` in the main column under the terminal area.
- State: expanded boolean; for active `sessionId`, current path + listing + loading/error + transfer progress.
- Actions toolbar: Up, Refresh, Upload, New folder; row actions: Download / Rename / Delete (files vs dirs as appropriate).
- All strings go through i18n keys (zh/en).

## Security

- Renderer never gets raw `fs` or SFTP handles; only IPC.
- Main normalizes remote paths, rejects unsafe patterns where practical (`..` resolution against intended root is soft — full chroot is out of scope; still resolve paths and avoid writing outside user-selected local save paths).
- Overwrite and delete require confirmation in UI.
- Transfer streams stay in main.

## Errors

- Not connected / session missing → typed error to UI.
- Permission denied, not found, not empty (if non-recursive) → mapped messages via existing or extended error helper.
- Transfer failure → abort stream, toast, leave partial remote file policy: attempt unlink partial on failed upload when possible.

## Testing

- Unit-test path join helpers / entry mapping if extracted as pure functions.
- Manual: connect → expand panel → list home → mkdir → upload → download → rename → delete → disconnect clears panel; switch tabs keeps separate cwd.

## Dependencies on other specs

- **Credentials:** same session already authenticated (saved creds help establish the shell session first).
- **i18n:** all new UI copy in locale files.

## Open decisions for implementation plan

- Default initial remote path (`sftp.realpath('.')` / home)
- Exact recursive-delete confirm copy
- Whether panel height is persisted in `settings.json` in the same iteration as i18n settings
