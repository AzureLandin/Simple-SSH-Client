# Credential Save Implementation Plan

> **For agentic workers:** Use executing-plans or implement task-by-task.

**Goal:** Save per-host passwords/private keys via Electron safeStorage; prompt once after first successful connect.

**Spec:** `docs/superpowers/specs/2026-07-11-credential-vault-design.md`

### Tasks
1. `CredentialStore` + unit tests (mocked safeStorage)
2. Extend `SshClient` to accept in-memory private key; `SessionManager` loads secrets on connect; clear on host delete
3. IPC `credentials.save/clear/isAvailable`
4. Renderer: prompt after connect; autofill when `credentialsSaved`
5. i18n strings for prompt
