# Credential Save (safeStorage) — Design Spec

**Date:** 2026-07-11  
**Status:** Draft for review  
**Scope:** Persist per-host passwords and private-key material without a master password (second of three follow-ups: i18n → credentials → SFTP)

## Goals

- After a **first successful connection**, ask whether to save credentials for that host.
- If the user accepts, save:
  - **password** (when auth is password), and/or
  - **private key file contents** (when auth is private key) so later connects do not depend on the original path.
- No master-password UX: save and autofill should feel automatic after the one-time prompt.
- Never store secrets in plaintext in `hosts.json` or git-tracked files.

## Non-Goals

- Master password / app vault unlock flow
- Cloud sync of credentials
- OS Keychain UI beyond what Electron `safeStorage` uses internally
- Encrypting non-secret host metadata
- SFTP (separate spec)
- Password recovery if OS encryption is wiped (user must re-enter)

## Security model

| Item | Decision |
|------|----------|
| API | Electron [`safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage) |
| Where secrets live | Main process only; encrypted blobs on disk under `userData` |
| `hosts.json` | Non-secret fields only + flags (`credentialsPrompted`, `credentialsSaved`) |
| Renderer | May receive password/key **only for the active connect attempt** over IPC (same as today); must not list or dump the whole secret store |
| Fallback | If `safeStorage.isEncryptionAvailable()` is false → do not save; show a clear error; **never** fall back to plaintext |

On Windows, `safeStorage` typically uses DPAPI bound to the user account.

## Data layout

### `hosts.json` (extended, still non-secret)

Existing `HostConfig` fields plus:

```ts
credentialsPrompted?: boolean  // already asked after first success
credentialsSaved?: boolean     // user accepted and secrets were stored
```

Keep `privateKeyPath` as optional display/fallback path; when `credentialsSaved` and key material exists in the secret store, connect uses stored key bytes first.

### Secret store file

Path: `userData/credentials.json` (or `.dat`) containing **only ciphertext**, e.g.:

```json
{
  "version": 1,
  "entries": {
    "<hostId>": {
      "password": "<base64 safeStorage blob>",
      "privateKey": "<base64 safeStorage blob>"
    }
  }
}
```

- Encrypt each string with `safeStorage.encryptString` before write.
- Decrypt only in main when building an SSH connect attempt.
- Deleting a host removes its secret entry.
- Clearing saved credentials for a host deletes the entry and sets `credentialsSaved: false` (optional UI later; minimum: delete-with-host).

## UX flow

1. User connects (enters password or uses key path as today).
2. On **success**, if `!host.credentialsPrompted`:
   - Show dialog: save credentials for this host? (Yes / No)
3. **Yes:**
   - Ensure encryption available.
   - Store password and/or private key contents under `hostId`.
   - Set `credentialsPrompted: true`, `credentialsSaved: true`.
4. **No:**
   - Set `credentialsPrompted: true`, `credentialsSaved: false`.
   - Do not ask again for that host (unless we add an explicit “Save credentials” action later — optional, not required for v1 of this feature).
5. Later connects:
   - If `credentialsSaved`, main loads secrets, skips password modal when password auth; for private key, use stored PEM/bytes even if path missing.

## Main-process modules

| Module | Responsibility |
|--------|----------------|
| `CredentialStore` | Read/write encrypted entries; encrypt/decrypt via `safeStorage`; delete by hostId |
| `ConnectionStore` | Persist `credentialsPrompted` / `credentialsSaved` flags |
| `SessionManager` / connect path | After successful connect, signal renderer to prompt; on save, call `CredentialStore`; on later connect, inject secrets |

## IPC (additions)

```ts
credentials: {
  /** Save secrets for host after user accepts prompt; main reads key file if needed */
  save: (hostId: string, payload: { password?: string; privateKeyPath?: string }) => Promise<void>
  /** Clear saved secrets for host */
  clear: (hostId: string) => Promise<void>
  /** Whether safeStorage can encrypt on this machine */
  isAvailable: () => Promise<boolean>
}
```

Notes:
- Prefer passing `password` only at save time from the session that just succeeded (already in renderer memory).
- For private key, prefer main re-reading `privateKeyPath` at save time so key bytes never need to round-trip through renderer unnecessarily; if path is gone, require user to pick file again before save.
- Do **not** expose `listAllSecrets` or decrypted dump APIs to the renderer.

Optional event: `hosts:credentials-prompt` from main after connect success, or handle entirely in renderer when `connect()` resolves and flags say unprompted — renderer-driven is simpler and matches current architecture.

**Recommended:** renderer, after successful `sessions.connect`, checks host flags via `hosts.list`/`get` and shows the prompt; on Yes calls `credentials.save`.

## Error handling

- Encryption unavailable → toast/dialog; leave flags unprompted or set prompted false so user can retry when available — prefer set `credentialsPrompted: false` only if save failed after Yes; if unavailable before prompt, still allow prompt but Yes fails with message.
- Save I/O failure → do not set `credentialsSaved: true`.
- Decrypt failure on connect → fall back to manual password / key file prompt; optionally clear corrupt entry.

## Testing

- Unit-test `CredentialStore` with mocked `safeStorage` (encrypt/decrypt round-trip, delete, missing entry).
- Manual: first connect prompt Yes/No; restart app; Yes path autofills; delete host removes secrets; machine without encryption shows failure without plaintext file.

## Relation to other specs

- i18n: prompt and errors use translation keys.
- SFTP: reuse the same saved credentials when opening an SFTP session for a host.

## Open decisions for implementation plan

- Exact filename (`credentials.json` vs binary)
- Whether host edit UI gets a “Forget saved credentials” button in this iteration (recommended yes, small)
