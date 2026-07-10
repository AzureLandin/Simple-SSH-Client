# SSH Desktop Client — Design Spec

**Date:** 2026-07-10  
**Status:** Draft for review  
**Product:** Windows-first desktop SSH client (later macOS/Linux)

## Goals

- Ship a usable desktop SSH terminal for daily server access.
- Use the project as a learning path for **TypeScript** and **Node.js**.
- Start on **Windows**, keep a clear path to other platforms later.

## Non-Goals (v1)

- SFTP / file manager
- Port forwarding / ProxyJump
- Theme marketplace, plugin system, auto-update
- Cloud sync / team features
- Remembered passwords in config (no password persistence in v1)

## Stack Decision

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Desktop shell | **Electron** | Main process is Node.js; matches learning goals; strong Windows → cross-platform path |
| Language | **TypeScript** everywhere (main, preload, renderer) | One language across the app |
| UI | **React** + TypeScript | Modern UI framework; largest Electron ecosystem |
| SSH | **`ssh2`** | Mature Node SSH client |
| Terminal | **`@xterm/xterm`** + fit addon | Standard web terminal; resize support |
| Host storage | Local JSON under app userData | Simple, inspectable; no DB in v1 |
| Bundler / scaffold | **electron-vite** (or equivalent) | Fast dev loop; clear main/preload/renderer split |
| Packaging | **electron-builder**, Windows first | Defer macOS/Linux installers |

**Rejected for v1:** Tauri (Rust backend conflicts with Node learning focus), pure HTML UI (user prefers a modern framework).

## Architecture

Classic Electron process split with a hard security boundary:

```
Renderer (React + xterm)
  - Host list, session tabs, settings UI
  - Terminal view bound to a sessionId
  - No direct fs / net / ssh2 access
        │
        │ IPC via preload bridge (whitelist API)
        ▼
Main (Node.js + TypeScript)
  - ConnectionStore — CRUD for saved hosts
  - SessionManager — session lifecycle by sessionId
  - SshClient — ssh2 connect / auth / shell / resize
  - Window & app lifecycle
```

### Modules

| Module | Process | Responsibility |
|--------|---------|----------------|
| `ConnectionStore` | Main | Load/save hosts; create/update/delete |
| `SessionManager` | Main | Create/destroy sessions; route I/O by `sessionId` |
| `SshClient` | Main | Wrap `ssh2`: connect, auth, shell channel, resize |
| `preload` + IPC | Bridge | Expose typed, limited APIs to the renderer |
| `HostList` / `SessionTabs` | Renderer (React) | Host management and tab UI |
| `TerminalView` | Renderer (React) | xterm instance wired to one session |

### Connection data flow

1. User clicks Connect → renderer calls `api.sessions.connect(hostId)` (password passed only for that attempt if needed).
2. Main: `SessionManager` loads host → `SshClient` connects → opens shell.
3. On success, returns `sessionId`; UI opens a tab and mounts `TerminalView`.
4. Keystrokes: xterm → `api.sessions.write(sessionId, data)` → SSH channel.
5. Remote output: Main emits `session:data` → renderer writes to xterm.
6. Close/error: Main emits `session:closed` / `session:error` → UI updates state.

## v1 Features

- Create / edit / delete hosts (hostname, port, username)
- Password auth and private-key auth (user-selected key file path)
- Multi-tab sessions (multiple concurrent connections)
- Terminal I/O, PTY resize on window/fit changes, basic ANSI colors
- Connection status: connecting / connected / disconnected / failure reason
- Persist host list to JSON under userData (e.g. `%APPDATA%/ssh-client/hosts.json`)

## Configuration & Secrets

- **Hosts file:** JSON in Electron `userData` directory.
- **Passwords:** Never written to disk in v1; only sent over IPC for the active connect attempt.
- **Private keys:** Store file path only; Main reads the key for auth; key material is not sent back to the renderer.
- **Host key verification:** Simplified known_hosts — record fingerprint on first connect; warn on change.

## Security

- `contextIsolation: true`, `nodeIntegration: false`
- Renderer only uses preload-exposed whitelist APIs (`connect`, `write`, `resize`, host CRUD, etc.)
- SSH and filesystem stay in Main

## Error Handling

- Connect failures (refused, timeout, auth failure, unreachable) → typed error to UI; non-blocking message; tab marked failed
- Mid-session disconnect → status line in terminal; tab shows disconnected; allow reconnect
- Config read/write failure → show error; do not overwrite a good file with corrupt data

## Testing

- Unit tests for pure logic (`ConnectionStore`, error mapping)
- Optional later: `SshClient` against local sshd or mocks
- Manual acceptance: password/key login, multi-tab, resize, disconnect/reconnect, host persistence

## Future (out of v1 scope)

- SFTP, port forwarding, ProxyJump
- OS keychain for saved passwords
- macOS / Linux packages
- Auto-update, themes, plugins

## Open decisions for implementation plan

- Exact electron-vite template layout and React Router (if any)
- Minimal visual design tokens (keep simple for v1)
- Precise IPC API TypeScript shapes
