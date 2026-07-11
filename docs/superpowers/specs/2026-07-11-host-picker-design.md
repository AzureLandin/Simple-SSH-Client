# Host Picker Dialog (FinalShell-style) — Design Spec

**Date:** 2026-07-11  
**Status:** Approved for implementation  
**Scope:** Move host CRUD/connect out of the sidebar into a modal opened from a top-bar folder button; leave sidebar as a placeholder for future monitoring.

## Goals

- Match FinalShell’s interaction pattern: **hosts are not a permanent sidebar list**; open a **host manager dialog** from a **folder/hosts button** on the main top bar.
- Keep full host management in that dialog: list, create, edit, delete, connect.
- Free the left sidebar for future content (monitoring); for this change, show a simple placeholder only.
- Preserve existing connect flows: password prompt, host-key confirm, credential-save confirm, sessions, SFTP.

## Non-Goals

- Remote CPU / memory / network monitoring UI or data collection
- Real host folders / grouping
- Changes to SSH/SFTP protocol or credential storage model
- Redesigning the settings dialog beyond keeping its sidebar entry

## Layout

```
┌─────────────┬──────────────────────────────────────────────┐
│  Sidebar    │  Top bar: [Hosts] | session tabs…            │
│  placeholder│──────────────────────────────────────────────│
│             │  Terminal                                     │
│             │──────────────────────────────────────────────│
│  [Settings] │  SFTP panel                                   │
└─────────────┴──────────────────────────────────────────────┘
```

### Sidebar

- Remove the always-visible host list from the sidebar.
- Show a short placeholder (title + one sentence: e.g. monitoring coming later).
- Keep the bottom **Settings** button and existing settings modal.

### Main top bar

- Always visible when the main session area is shown (including zero sessions).
- Left: **Hosts** button (folder-style affordance / label via i18n).
- Right / remaining: existing session tab strip (unchanged behavior when sessions exist).
- With zero sessions: top bar still shows Hosts button; main body shows the existing empty placeholder text (updated copy to point at Hosts).

## Host dialog

### Open / close

- Open: click top-bar Hosts button.
- Close: Esc, overlay click, explicit close control, or **after a successful connect** (default).

### Contents

Reuse current host management capabilities inside a modal (same visual language as Settings / Confirm modals):

| Action | Behavior |
|--------|----------|
| List | Show all saved hosts (name, host:port, username) |
| New | Open existing host form (create) inside/over the dialog |
| Edit | Open existing host form (edit) |
| Delete | Confirm then remove (existing confirm pattern) |
| Connect | Same as today’s connect: password modal if needed, then session tab |

Empty state: message + primary **New host** action.

### Connect pipeline

Unchanged after the user chooses Connect:

1. Password modal if password auth and credentials not saved  
2. `sessions.connect` / host-key handling  
3. Credential-save prompt on first success  
4. Close host dialog on success  

Reconnect from a session tab continues to use the existing reconnect path (no need to reopen the host dialog).

## i18n

Add keys under something like `hostsPicker.*` / update `session.placeholder` for:

- Top-bar Hosts button label  
- Dialog title  
- Sidebar placeholder title/body  
- Empty-host copy  

Chinese default remains; English strings required.

## Implementation notes (guidance, not a task list)

- Extract or adapt current `HostList` / `HostForm` so the dialog owns list + CRUD; App wires connect handlers as today.
- Prefer one modal stack rule: host dialog may sit under password/confirm modals when those open during connect.
- Do not regress SFTP, settings, or credential vault behavior.

## Success criteria

- Sidebar no longer lists hosts; placeholder + Settings only.  
- Hosts button always available in the main top bar.  
- Dialog supports create / edit / delete / connect.  
- Successful connect opens a session tab and closes the host dialog.  
- Existing auth / save-credential / SFTP flows still work.  
