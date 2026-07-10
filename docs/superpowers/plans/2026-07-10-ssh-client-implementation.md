# SSH Desktop Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows-first Electron desktop SSH client with React + TypeScript that can save hosts, open multi-tab terminals, and connect via password or private key.

**Architecture:** Electron main process owns SSH (`ssh2`), host JSON persistence, and known_hosts. Renderer is React + xterm and talks only through a typed preload IPC whitelist. Shared types live in `src/shared`.

**Tech Stack:** Electron, electron-vite, TypeScript, React, `ssh2`, `@xterm/xterm`, `@xterm/addon-fit`, Vitest, electron-builder

**Spec:** `docs/superpowers/specs/2026-07-10-ssh-client-design.md`

---

## File structure

```
E:\Projects\SSH-Client\
  package.json
  electron.vite.config.ts
  electron-builder.yml
  tsconfig.json
  tsconfig.node.json
  tsconfig.web.json
  vitest.config.ts
  src/
    shared/
      types.ts                 # HostConfig, AppError, IPC shapes
      map-ssh-error.ts         # Map Node/ssh2 errors → AppError (pure)
    main/
      index.ts                 # App ready, BrowserWindow, security flags
      connection-store.ts      # Host CRUD + JSON file I/O
      known-hosts.ts           # Fingerprint store
      ssh-client.ts            # ssh2 wrapper (one connection)
      session-manager.ts       # Multi-session registry
      ipc.ts                   # ipcMain handlers
    preload/
      index.ts                 # contextBridge API
      index.d.ts               # window.api typings
    renderer/
      index.html
      src/
        main.tsx
        App.tsx
        App.css
        components/
          HostList.tsx
          HostForm.tsx
          SessionTabs.tsx
          TerminalView.tsx
          Toast.tsx
        hooks/
          useHosts.ts
          useSessions.ts
  tests/
    connection-store.test.ts
    map-ssh-error.test.ts
    known-hosts.test.ts
  docs/
    superpowers/
      specs/...
      plans/...
```

No React Router in v1: single `App` layout (sidebar hosts + main session area).

---

### Task 1: Scaffold electron-vite + React + TS

**Files:**
- Create: project root Electron/React scaffold (keep existing `docs/`)
- Modify: `package.json` (name, scripts, deps)

- [ ] **Step 1: Scaffold into a temp folder, then merge into repo root**

Because the repo already contains `docs/`, scaffold beside it then move app files up:

```powershell
cd E:\Projects\SSH-Client
npm create @quick-start/electron@latest _scaffold -- --template react-ts
```

If the tool prompts interactively, choose: no updater plugin, no mirror (unless in China and you need it).

- [ ] **Step 2: Move scaffold files to repo root**

```powershell
cd E:\Projects\SSH-Client
# Move everything from _scaffold to root except .git if present
Get-ChildItem _scaffold -Force | Where-Object { $_.Name -ne '.git' } | ForEach-Object {
  Move-Item $_.FullName -Destination . -Force
}
Remove-Item _scaffold -Recurse -Force
```

- [ ] **Step 3: Set package name and install base deps**

Edit `package.json` `"name"` to `"ssh-client"`.

```powershell
npm install
npm install ssh2
npm install -D @types/ssh2 vitest @xterm/xterm @xterm/addon-fit
```

Note: `@xterm/*` is used by the renderer; installing at root is fine for electron-vite.

- [ ] **Step 4: Add Vitest script and config**

Create `vitest.config.ts`:

```typescript
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  },
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  }
})
```

In `package.json` scripts add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Verify scaffold runs**

```powershell
npm run dev
```

Expected: Electron window opens with the template React UI (will replace later). Stop the process after confirming.

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "chore: scaffold electron-vite react-ts app"
```

---

### Task 2: Shared types

**Files:**
- Create: `src/shared/types.ts`

- [ ] **Step 1: Add shared domain + IPC types**

Create `src/shared/types.ts`:

```typescript
export type AuthMethod = 'password' | 'privateKey'

export interface HostConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  /** Absolute path; only used when authMethod === 'privateKey' */
  privateKeyPath?: string
}

export type HostInput = Omit<HostConfig, 'id'>

export type SshErrorCode =
  | 'CONNECTION_REFUSED'
  | 'TIMEOUT'
  | 'AUTH_FAILED'
  | 'HOST_UNREACHABLE'
  | 'HOST_KEY_CHANGED'
  | 'CONFIG_READ_FAILED'
  | 'CONFIG_WRITE_FAILED'
  | 'SESSION_NOT_FOUND'
  | 'UNKNOWN'

export interface AppError {
  code: SshErrorCode
  message: string
}

export interface ConnectOptions {
  password?: string
  /** When true, accept and store a new/changed host key */
  acceptHostKey?: boolean
}

export interface SessionDataEvent {
  sessionId: string
  data: string
}

export interface SessionClosedEvent {
  sessionId: string
}

export interface SessionErrorEvent {
  sessionId: string
  error: AppError
}

export interface ElectronApi {
  hosts: {
    list: () => Promise<HostConfig[]>
    create: (input: HostInput) => Promise<HostConfig>
    update: (id: string, patch: Partial<HostInput>) => Promise<HostConfig>
    remove: (id: string) => Promise<void>
  }
  sessions: {
    connect: (
      hostId: string,
      options?: ConnectOptions
    ) => Promise<{ sessionId: string }>
    write: (sessionId: string, data: string) => Promise<void>
    resize: (sessionId: string, cols: number, rows: number) => Promise<void>
    disconnect: (sessionId: string) => Promise<void>
    onData: (cb: (event: SessionDataEvent) => void) => () => void
    onClosed: (cb: (event: SessionClosedEvent) => void) => () => void
    onError: (cb: (event: SessionErrorEvent) => void) => () => void
  }
  dialog: {
    openPrivateKeyFile: () => Promise<string | null>
  }
}

export const IPC = {
  hostsList: 'hosts:list',
  hostsCreate: 'hosts:create',
  hostsUpdate: 'hosts:update',
  hostsRemove: 'hosts:remove',
  sessionsConnect: 'sessions:connect',
  sessionsWrite: 'sessions:write',
  sessionsResize: 'sessions:resize',
  sessionsDisconnect: 'sessions:disconnect',
  sessionData: 'session:data',
  sessionClosed: 'session:closed',
  sessionError: 'session:error',
  dialogOpenPrivateKey: 'dialog:openPrivateKey'
} as const
```

- [ ] **Step 2: Commit**

```powershell
git add src/shared/types.ts
git commit -m "feat: add shared host and IPC types"
```

---

### Task 3: Error mapping (TDD)

**Files:**
- Create: `src/shared/map-ssh-error.ts`
- Test: `tests/map-ssh-error.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/map-ssh-error.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { mapSshError } from '../src/shared/map-ssh-error'

describe('mapSshError', () => {
  it('maps ECONNREFUSED', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    expect(mapSshError(err)).toEqual({
      code: 'CONNECTION_REFUSED',
      message: 'Connection refused'
    })
  })

  it('maps ETIMEDOUT', () => {
    const err = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
    expect(mapSshError(err).code).toBe('TIMEOUT')
  })

  it('maps ENOTFOUND / EHOSTUNREACH to HOST_UNREACHABLE', () => {
    expect(mapSshError(Object.assign(new Error('x'), { code: 'ENOTFOUND' })).code).toBe(
      'HOST_UNREACHABLE'
    )
    expect(mapSshError(Object.assign(new Error('x'), { code: 'EHOSTUNREACH' })).code).toBe(
      'HOST_UNREACHABLE'
    )
  })

  it('maps auth failure messages to AUTH_FAILED', () => {
    expect(mapSshError(new Error('All configured authentication methods failed')).code).toBe(
      'AUTH_FAILED'
    )
  })

  it('maps unknown errors', () => {
    expect(mapSshError(new Error('weird')).code).toBe('UNKNOWN')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```powershell
npm test -- tests/map-ssh-error.test.ts
```

Expected: FAIL (module not found / `mapSshError` not defined)

- [ ] **Step 3: Implement**

Create `src/shared/map-ssh-error.ts`:

```typescript
import type { AppError } from './types'

export function mapSshError(err: unknown): AppError {
  const error = err as { code?: string; message?: string; level?: string }
  const code = error?.code
  const message = error?.message ?? 'Unknown error'

  if (code === 'ECONNREFUSED') {
    return { code: 'CONNECTION_REFUSED', message: 'Connection refused' }
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET') {
    return { code: 'TIMEOUT', message: 'Connection timed out' }
  }
  if (code === 'ENOTFOUND' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return { code: 'HOST_UNREACHABLE', message: 'Host unreachable' }
  }
  if (/authentication methods failed|Permission denied|All configured authentication/i.test(message)) {
    return { code: 'AUTH_FAILED', message: 'Authentication failed' }
  }
  if (code === 'HOST_KEY_CHANGED') {
    return { code: 'HOST_KEY_CHANGED', message: 'Host key has changed' }
  }

  return { code: 'UNKNOWN', message }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```powershell
npm test -- tests/map-ssh-error.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add src/shared/map-ssh-error.ts tests/map-ssh-error.test.ts
git commit -m "feat: map ssh/network errors to AppError codes"
```

---

### Task 4: ConnectionStore (TDD)

**Files:**
- Create: `src/main/connection-store.ts`
- Test: `tests/connection-store.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/connection-store.test.ts`:

```typescript
import { mkdtempSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, beforeEach } from 'vitest'
import { ConnectionStore } from '../src/main/connection-store'
import type { HostInput } from '../src/shared/types'

const sample: HostInput = {
  name: 'lab',
  host: '192.168.1.10',
  port: 22,
  username: 'root',
  authMethod: 'password'
}

describe('ConnectionStore', () => {
  let filePath: string
  let store: ConnectionStore

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'ssh-client-'))
    filePath = join(dir, 'hosts.json')
    store = new ConnectionStore(filePath)
  })

  it('lists empty when file missing', async () => {
    await expect(store.list()).resolves.toEqual([])
  })

  it('creates a host with generated id and persists', async () => {
    const host = await store.create(sample)
    expect(host.id).toBeTruthy()
    expect(host.name).toBe('lab')
    const raw = JSON.parse(readFileSync(filePath, 'utf8'))
    expect(raw.hosts).toHaveLength(1)
    expect(raw.hosts[0].id).toBe(host.id)
  })

  it('updates and removes hosts', async () => {
    const host = await store.create(sample)
    const updated = await store.update(host.id, { name: 'prod' })
    expect(updated.name).toBe('prod')
    await store.remove(host.id)
    await expect(store.list()).resolves.toEqual([])
  })

  it('does not write password fields (hosts have no password key)', async () => {
    const host = await store.create(sample)
    const text = readFileSync(filePath, 'utf8')
    expect(text).not.toMatch(/password/i)
    expect(host).not.toHaveProperty('password')
  })

  it('throws CONFIG_READ_FAILED on corrupt JSON without overwriting', async () => {
    const { writeFileSync } = await import('fs')
    writeFileSync(filePath, '{not-json', 'utf8')
    await expect(store.list()).rejects.toMatchObject({ code: 'CONFIG_READ_FAILED' })
    expect(readFileSync(filePath, 'utf8')).toBe('{not-json')
  })

  it('getById returns undefined when missing', async () => {
    await expect(store.getById('nope')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```powershell
npm test -- tests/connection-store.test.ts
```

Expected: FAIL (module not found)

- [ ] **Step 3: Implement ConnectionStore**

Create `src/main/connection-store.ts`:

```typescript
import { randomUUID } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { AppError, HostConfig, HostInput } from '../shared/types'

interface HostsFile {
  hosts: HostConfig[]
}

function configError(code: AppError['code'], message: string): AppError {
  return { code, message }
}

export class ConnectionStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<HostConfig[]> {
    const data = await this.read()
    return data.hosts
  }

  async getById(id: string): Promise<HostConfig | undefined> {
    const data = await this.read()
    return data.hosts.find((h) => h.id === id)
  }

  async create(input: HostInput): Promise<HostConfig> {
    const data = await this.read()
    const host: HostConfig = { ...input, id: randomUUID() }
    data.hosts.push(host)
    await this.write(data)
    return host
  }

  async update(id: string, patch: Partial<HostInput>): Promise<HostConfig> {
    const data = await this.read()
    const index = data.hosts.findIndex((h) => h.id === id)
    if (index < 0) {
      throw configError('UNKNOWN', `Host not found: ${id}`)
    }
    const updated: HostConfig = { ...data.hosts[index], ...patch, id }
    data.hosts[index] = updated
    await this.write(data)
    return updated
  }

  async remove(id: string): Promise<void> {
    const data = await this.read()
    data.hosts = data.hosts.filter((h) => h.id !== id)
    await this.write(data)
  }

  private async read(): Promise<HostsFile> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      try {
        const parsed = JSON.parse(raw) as HostsFile
        if (!parsed || !Array.isArray(parsed.hosts)) {
          throw new Error('invalid shape')
        }
        return parsed
      } catch {
        throw configError('CONFIG_READ_FAILED', 'Hosts file is corrupt')
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException & AppError
      if (e.code === 'CONFIG_READ_FAILED') throw e
      if (e.code === 'ENOENT') return { hosts: [] }
      throw configError('CONFIG_READ_FAILED', e.message ?? 'Failed to read hosts file')
    }
  }

  private async write(data: HostsFile): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8')
    } catch (err) {
      const e = err as Error
      throw configError('CONFIG_WRITE_FAILED', e.message)
    }
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```powershell
npm test -- tests/connection-store.test.ts
```

Expected: PASS (fix `existsSync` unused import in test if lint complains — remove it)

- [ ] **Step 5: Commit**

```powershell
git add src/main/connection-store.ts tests/connection-store.test.ts
git commit -m "feat: add ConnectionStore with JSON persistence"
```

---

### Task 5: KnownHosts store (TDD)

**Files:**
- Create: `src/main/known-hosts.ts`
- Test: `tests/known-hosts.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/known-hosts.test.ts`:

```typescript
import { mkdtempSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, beforeEach } from 'vitest'
import { KnownHosts } from '../src/main/known-hosts'

describe('KnownHosts', () => {
  let filePath: string
  let store: KnownHosts

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'ssh-kh-'))
    filePath = join(dir, 'known_hosts.json')
    store = new KnownHosts(filePath)
  })

  it('returns unknown for new host', async () => {
    await expect(store.check('h', 22, 'fp1')).resolves.toEqual({ status: 'unknown' })
  })

  it('returns ok when fingerprint matches', async () => {
    await store.remember('h', 22, 'fp1')
    await expect(store.check('h', 22, 'fp1')).resolves.toEqual({ status: 'ok' })
  })

  it('returns changed when fingerprint differs', async () => {
    await store.remember('h', 22, 'fp1')
    await expect(store.check('h', 22, 'fp2')).resolves.toEqual({
      status: 'changed',
      previous: 'fp1'
    })
  })

  it('persists to disk', async () => {
    await store.remember('h', 22, 'fp1')
    const raw = JSON.parse(readFileSync(filePath, 'utf8'))
    expect(raw['h:22']).toBe('fp1')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```powershell
npm test -- tests/known-hosts.test.ts
```

- [ ] **Step 3: Implement**

Create `src/main/known-hosts.ts`:

```typescript
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'

export type HostKeyCheck =
  | { status: 'ok' }
  | { status: 'unknown' }
  | { status: 'changed'; previous: string }

type StoreFile = Record<string, string>

export class KnownHosts {
  constructor(private readonly filePath: string) {}

  private key(host: string, port: number): string {
    return `${host}:${port}`
  }

  async check(host: string, port: number, fingerprint: string): Promise<HostKeyCheck> {
    const data = await this.read()
    const previous = data[this.key(host, port)]
    if (!previous) return { status: 'unknown' }
    if (previous === fingerprint) return { status: 'ok' }
    return { status: 'changed', previous }
  }

  async remember(host: string, port: number, fingerprint: string): Promise<void> {
    const data = await this.read()
    data[this.key(host, port)] = fingerprint
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8')
  }

  private async read(): Promise<StoreFile> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as StoreFile
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') return {}
      throw err
    }
  }
}
```

- [ ] **Step 4: Run — expect PASS**

```powershell
npm test -- tests/known-hosts.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add src/main/known-hosts.ts tests/known-hosts.test.ts
git commit -m "feat: add known_hosts fingerprint store"
```

---

### Task 6: SshClient wrapper

**Files:**
- Create: `src/main/ssh-client.ts`

No live sshd required for unit tests in v1; keep the wrapper thin and event-based.

- [ ] **Step 1: Implement SshClient**

Create `src/main/ssh-client.ts`:

```typescript
import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import { mapSshError } from '../shared/map-ssh-error'
import type { HostConfig } from '../shared/types'
import type { KnownHosts } from './known-hosts'

export interface SshConnectParams {
  host: HostConfig
  password?: string
  acceptHostKey?: boolean
  cols?: number
  rows?: number
}

export class SshClient {
  private client: Client | null = null
  private stream: ClientChannel | null = null

  constructor(private readonly knownHosts: KnownHosts) {}

  async connect(params: SshConnectParams): Promise<void> {
    const { host, password, acceptHostKey, cols = 80, rows = 24 } = params

    let fingerprint = ''
    const config: ConnectConfig = {
      host: host.host,
      port: host.port,
      username: host.username,
      readyTimeout: 20000,
      hostVerifier: (key: Buffer) => {
        fingerprint = createHash('sha256').update(key).digest('base64')
        return true
      }
    }

    if (host.authMethod === 'privateKey') {
      if (!host.privateKeyPath) {
        throw { code: 'AUTH_FAILED', message: 'Private key path missing' }
      }
      config.privateKey = await readFile(host.privateKeyPath)
    } else {
      config.password = password
    }

    await new Promise<void>((resolve, reject) => {
      const client = new Client()
      this.client = client
      client
        .on('ready', () => resolve())
        .on('error', (err) => reject(mapSshError(err)))
        .connect(config)
    })

    // v1: verify after handshake, then dispose if rejected (simple; good enough for learning app)
    const check = await this.knownHosts.check(host.host, host.port, fingerprint)
    if (check.status === 'changed' && !acceptHostKey) {
      this.dispose()
      throw { code: 'HOST_KEY_CHANGED', message: 'Host key has changed' }
    }
    if (check.status === 'unknown' || (check.status === 'changed' && acceptHostKey)) {
      await this.knownHosts.remember(host.host, host.port, fingerprint)
    }

    await new Promise<void>((resolve, reject) => {
      if (!this.client) {
        reject({ code: 'UNKNOWN', message: 'Client missing' })
        return
      }
      this.client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) {
          reject(mapSshError(err))
          return
        }
        this.stream = stream
        resolve()
      })
    })
  }

  write(data: string): void {
    this.stream?.write(data)
  }

  resize(cols: number, rows: number): void {
    this.stream?.setWindow(rows, cols, 0, 0)
  }

  onData(cb: (data: string) => void): void {
    this.stream?.on('data', (buf: Buffer) => cb(buf.toString('utf8')))
  }

  onClose(cb: () => void): void {
    this.stream?.on('close', cb)
    this.client?.on('close', cb)
  }

  dispose(): void {
    try {
      this.stream?.close()
    } catch {
      /* ignore */
    }
    try {
      this.client?.end()
    } catch {
      /* ignore */
    }
    this.stream = null
    this.client = null
  }
}
```

- [ ] **Step 2: Commit**

```powershell
git add src/main/ssh-client.ts
git commit -m "feat: add ssh2 SshClient wrapper with host key check"
```

---

### Task 7: SessionManager

**Files:**
- Create: `src/main/session-manager.ts`

- [ ] **Step 1: Implement SessionManager**

Create `src/main/session-manager.ts`:

```typescript
import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import type { ConnectOptions, HostConfig } from '../shared/types'
import { IPC } from '../shared/types'
import { ConnectionStore } from './connection-store'
import { KnownHosts } from './known-hosts'
import { SshClient } from './ssh-client'

interface Session {
  id: string
  hostId: string
  client: SshClient
}

export class SessionManager {
  private sessions = new Map<string, Session>()

  constructor(
    private readonly store: ConnectionStore,
    private readonly knownHosts: KnownHosts,
    private readonly getWindow: () => BrowserWindow | null
  ) {}

  async connect(hostId: string, options: ConnectOptions = {}): Promise<{ sessionId: string }> {
    const host = await this.store.getById(hostId)
    if (!host) {
      throw { code: 'UNKNOWN', message: `Host not found: ${hostId}` }
    }

    const client = new SshClient(this.knownHosts)
    const sessionId = randomUUID()

    try {
      await client.connect({
        host,
        password: options.password,
        acceptHostKey: options.acceptHostKey
      })
    } catch (err) {
      client.dispose()
      throw err
    }

    const session: Session = { id: sessionId, hostId, client }
    this.sessions.set(sessionId, session)

    client.onData((data) => {
      this.send(IPC.sessionData, { sessionId, data })
    })
    client.onClose(() => {
      this.sessions.delete(sessionId)
      this.send(IPC.sessionClosed, { sessionId })
    })

    return { sessionId }
  }

  write(sessionId: string, data: string): void {
    this.require(sessionId).client.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.require(sessionId).client.resize(cols, rows)
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.client.dispose()
    this.sessions.delete(sessionId)
    this.send(IPC.sessionClosed, { sessionId })
  }

  private require(sessionId: string): Session {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw { code: 'SESSION_NOT_FOUND', message: `Session not found: ${sessionId}` }
    }
    return session
  }

  private send(channel: string, payload: unknown): void {
    const win = this.getWindow()
    win?.webContents.send(channel, payload)
  }
}
```

- [ ] **Step 2: Commit**

```powershell
git add src/main/session-manager.ts
git commit -m "feat: add SessionManager for multi-tab SSH sessions"
```

---

### Task 8: IPC + preload bridge

**Files:**
- Create: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Implement ipc registration**

Create `src/main/ipc.ts`:

```typescript
import { dialog, ipcMain } from 'electron'
import type { ConnectionStore } from './connection-store'
import type { SessionManager } from './session-manager'
import { IPC, type ConnectOptions, type HostInput } from '../shared/types'

export function registerIpc(store: ConnectionStore, sessions: SessionManager): void {
  ipcMain.handle(IPC.hostsList, async () => store.list())
  ipcMain.handle(IPC.hostsCreate, async (_e, input: HostInput) => store.create(input))
  ipcMain.handle(IPC.hostsUpdate, async (_e, id: string, patch: Partial<HostInput>) =>
    store.update(id, patch)
  )
  ipcMain.handle(IPC.hostsRemove, async (_e, id: string) => store.remove(id))

  ipcMain.handle(IPC.sessionsConnect, async (_e, hostId: string, options?: ConnectOptions) =>
    sessions.connect(hostId, options)
  )
  ipcMain.handle(IPC.sessionsWrite, async (_e, sessionId: string, data: string) => {
    sessions.write(sessionId, data)
  })
  ipcMain.handle(IPC.sessionsResize, async (_e, sessionId: string, cols: number, rows: number) => {
    sessions.resize(sessionId, cols, rows)
  })
  ipcMain.handle(IPC.sessionsDisconnect, async (_e, sessionId: string) => {
    sessions.disconnect(sessionId)
  })

  ipcMain.handle(IPC.dialogOpenPrivateKey, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select private key',
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
```

- [ ] **Step 2: Implement preload**

Replace `src/preload/index.ts` with:

```typescript
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type ConnectOptions, type ElectronApi, type HostInput } from '../shared/types'

const api: ElectronApi = {
  hosts: {
    list: () => ipcRenderer.invoke(IPC.hostsList),
    create: (input: HostInput) => ipcRenderer.invoke(IPC.hostsCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.hostsUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.hostsRemove, id)
  },
  sessions: {
    connect: (hostId, options?: ConnectOptions) =>
      ipcRenderer.invoke(IPC.sessionsConnect, hostId, options),
    write: (sessionId, data) => ipcRenderer.invoke(IPC.sessionsWrite, sessionId, data),
    resize: (sessionId, cols, rows) =>
      ipcRenderer.invoke(IPC.sessionsResize, sessionId, cols, rows),
    disconnect: (sessionId) => ipcRenderer.invoke(IPC.sessionsDisconnect, sessionId),
    onData: (cb) => {
      const listener = (_: Electron.IpcRendererEvent, payload: Parameters<typeof cb>[0]) => cb(payload)
      ipcRenderer.on(IPC.sessionData, listener)
      return () => ipcRenderer.removeListener(IPC.sessionData, listener)
    },
    onClosed: (cb) => {
      const listener = (_: Electron.IpcRendererEvent, payload: Parameters<typeof cb>[0]) => cb(payload)
      ipcRenderer.on(IPC.sessionClosed, listener)
      return () => ipcRenderer.removeListener(IPC.sessionClosed, listener)
    },
    onError: (cb) => {
      const listener = (_: Electron.IpcRendererEvent, payload: Parameters<typeof cb>[0]) => cb(payload)
      ipcRenderer.on(IPC.sessionError, listener)
      return () => ipcRenderer.removeListener(IPC.sessionError, listener)
    }
  },
  dialog: {
    openPrivateKeyFile: () => ipcRenderer.invoke(IPC.dialogOpenPrivateKey)
  }
}

contextBridge.exposeInMainWorld('api', api)
```

Replace `src/preload/index.d.ts` with:

```typescript
import type { ElectronApi } from '../shared/types'

declare global {
  interface Window {
    api: ElectronApi
  }
}

export {}
```

- [ ] **Step 3: Wire main process**

Update `src/main/index.ts` to:

1. Keep `contextIsolation: true` and `nodeIntegration: false` (template default — verify).
2. After `app.whenReady()`:
   - `const userData = app.getPath('userData')`
   - `const store = new ConnectionStore(join(userData, 'hosts.json'))`
   - `const knownHosts = new KnownHosts(join(userData, 'known_hosts.json'))`
   - Create `BrowserWindow`, keep reference in `let mainWindow`
   - `const sessions = new SessionManager(store, knownHosts, () => mainWindow)`
   - `registerIpc(store, sessions)`

Ensure preload path from the scaffold is unchanged.

- [ ] **Step 4: Ensure electron-vite can resolve shared imports from main/preload**

If build fails on `../shared/types`, add alias in `electron.vite.config.ts` for main/preload or keep relative imports as shown (preferred in this plan).

- [ ] **Step 5: Smoke-run**

```powershell
npm run dev
```

Expected: app opens without IPC errors in console.

- [ ] **Step 6: Commit**

```powershell
git add src/main/ipc.ts src/main/index.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat: expose typed host and session IPC via preload"
```

---

### Task 9: React host list + form UI

**Files:**
- Create: `src/renderer/src/hooks/useHosts.ts`
- Create: `src/renderer/src/components/HostList.tsx`
- Create: `src/renderer/src/components/HostForm.tsx`
- Create: `src/renderer/src/components/Toast.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.css`

- [ ] **Step 1: useHosts hook**

```typescript
import { useCallback, useEffect, useState } from 'react'
import type { HostConfig, HostInput } from '../../../shared/types'

export function useHosts() {
  const [hosts, setHosts] = useState<HostConfig[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setHosts(await window.api.hosts.list())
      setError(null)
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load hosts')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = async (input: HostInput) => {
    await window.api.hosts.create(input)
    await refresh()
  }

  const update = async (id: string, patch: Partial<HostInput>) => {
    await window.api.hosts.update(id, patch)
    await refresh()
  }

  const remove = async (id: string) => {
    await window.api.hosts.remove(id)
    await refresh()
  }

  return { hosts, error, refresh, create, update, remove }
}
```

- [ ] **Step 2: HostForm**

`HostForm` fields: name, host, port (number default 22), username, authMethod select, privateKeyPath + "Browse" button calling `window.api.dialog.openPrivateKeyFile()`. On submit call `onSubmit(input)`. Include Cancel.

- [ ] **Step 3: HostList**

Sidebar list of hosts with Connect / Edit / Delete. "New host" opens `HostForm`. Selecting Connect calls `onConnect(host)` provided by parent (parent will ask password if needed).

- [ ] **Step 4: Toast**

Simple fixed-position message component: `{ message: string | null; onClose: () => void }`.

- [ ] **Step 5: App layout shell**

`App.tsx` layout:

```
┌──────────┬────────────────────────────┐
│ HostList │  SessionTabs + Terminal    │
│          │  (placeholder until Task10)│
└──────────┴────────────────────────────┘
```

Minimal CSS in `App.css`: dark neutral sidebar (~240px), content flex column, no purple gradient theme.

- [ ] **Step 6: Manual check**

```powershell
npm run dev
```

Create a host, reload app, confirm it persists in `%APPDATA%/<app-name>/hosts.json`.

- [ ] **Step 7: Commit**

```powershell
git add src/renderer/src
git commit -m "feat: add React host list and form with persistence"
```

---

### Task 10: Sessions + TerminalView (xterm)

**Files:**
- Create: `src/renderer/src/hooks/useSessions.ts`
- Create: `src/renderer/src/components/SessionTabs.tsx`
- Create: `src/renderer/src/components/TerminalView.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: useSessions hook**

Track tabs:

```typescript
export type UiSessionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface UiSession {
  sessionId: string
  hostId: string
  title: string
  status: UiSessionStatus
  errorMessage?: string
}
```

API:
- `sessions: UiSession[]`
- `activeSessionId`
- `setActiveSessionId`
- `connect(host, options)` → sets connecting, on success pushes tab; on failure toast + error status
- `disconnect(sessionId)`
- `reconnect(session)` — disconnect old if needed, connect again with same hostId (prompt password again for password auth)

Subscribe once to `onData` / `onClosed` / `onError` in `useEffect`; fan-out data via a simple `Map<sessionId, Set<(d: string) => void>>` or custom event bus so `TerminalView` can subscribe by id.

Recommended pattern: keep `dataListenersRef` in the hook:

```typescript
const dataListenersRef = useRef(new Map<string, (data: string) => void>())

useEffect(() => {
  const offData = window.api.sessions.onData(({ sessionId, data }) => {
    dataListenersRef.current.get(sessionId)?.(data)
  })
  const offClosed = window.api.sessions.onClosed(({ sessionId }) => {
    setSessions((prev) =>
      prev.map((s) => (s.sessionId === sessionId ? { ...s, status: 'disconnected' } : s))
    )
  })
  const offError = window.api.sessions.onError(({ sessionId, error }) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.sessionId === sessionId
          ? { ...s, status: 'error', errorMessage: error.message }
          : s
      )
    )
    setToast(error.message)
  })
  return () => {
    offData()
    offClosed()
    offError()
  }
}, [])

function registerDataListener(sessionId: string, cb: (data: string) => void) {
  dataListenersRef.current.set(sessionId, cb)
  return () => dataListenersRef.current.delete(sessionId)
}
```

- [ ] **Step 2: TerminalView**

```typescript
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export function TerminalView(props: {
  sessionId: string
  registerDataListener: (sessionId: string, cb: (data: string) => void) => () => void
  visible: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: { background: '#1e1e1e' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    fit.fit()
    termRef.current = term

    const unsub = props.registerDataListener(props.sessionId, (data) => term.write(data))
    const onData = term.onData((data) => {
      void window.api.sessions.write(props.sessionId, data)
    })

    const ro = new ResizeObserver(() => {
      fit.fit()
      void window.api.sessions.resize(props.sessionId, term.cols, term.rows)
    })
    ro.observe(containerRef.current)

    void window.api.sessions.resize(props.sessionId, term.cols, term.rows)

    return () => {
      unsub()
      onData.dispose()
      ro.disconnect()
      term.dispose()
      termRef.current = null
    }
  }, [props.sessionId, props.registerDataListener])

  return (
    <div
      ref={containerRef}
      style={{ display: props.visible ? 'block' : 'none', height: '100%', width: '100%' }}
    />
  )
}
```

Keep all session terminals mounted but hide inactive ones with `display: none` so scrollback survives tab switches.

- [ ] **Step 3: SessionTabs**

Tab bar: title = host name; show status dot; close button → `disconnect`; click selects active tab. Below tabs: active `TerminalView`(s). For disconnected/error tabs show a banner with Reconnect.

- [ ] **Step 4: Password / host-key prompts in App**

When Connect clicked:
1. If `authMethod === 'password'`, prompt with `window.prompt` or a small modal for password (modal preferred).
2. Call `sessions.connect(hostId, { password })`.
3. If error code `HOST_KEY_CHANGED`, confirm with user; if yes retry with `{ acceptHostKey: true, password }`.
4. First-seen keys are auto-stored by main (no prompt) per spec.

Also surface main-thrown errors: wrap `sessions.connect` so rejected `AppError` objects set toast text.

- [ ] **Step 5: Manual acceptance**

Against a real SSH server (or local OpenSSH):

1. Password login works; typing echoes / shell works  
2. Private key login works  
3. Two tabs to same or different hosts  
4. Resize window → shell width updates (`stty size`)  
5. Kill remote session → tab shows disconnected + reconnect works  
6. Wrong password → toast / error, no crash  

- [ ] **Step 6: Commit**

```powershell
git add src/renderer/src
git commit -m "feat: multi-tab xterm sessions with SSH I/O"
```

---

### Task 11: Windows packaging

**Files:**
- Modify: `package.json` build config / `electron-builder.yml` (scaffold may already include)

- [ ] **Step 1: Confirm builder config targets win**

Ensure `package.json` or `electron-builder.yml` includes Windows nsis/portable target. App id/productName: `SSH Client` / `ssh-client`.

- [ ] **Step 2: Build**

```powershell
npm run build
```

Expected: installer or portable artifact under `dist/`.

- [ ] **Step 3: Smoke-test the packaged app**

Install/run artifact; confirm host create + connect still works (userData path differs from dev).

- [ ] **Step 4: Commit**

```powershell
git add package.json electron-builder.yml
git commit -m "chore: configure Windows electron-builder packaging"
```

---

### Task 12: Final verification checklist

- [ ] **Step 1: Run unit tests**

```powershell
npm test
```

Expected: all tests PASS

- [ ] **Step 2: Manual checklist (tick in PR/commit message)**

- [ ] Host CRUD persists across restart  
- [ ] Password auth  
- [ ] Private key auth  
- [ ] Multi-tab  
- [ ] Resize  
- [ ] Disconnect / reconnect  
- [ ] Auth failure shows message  
- [ ] Host key change warns and can accept  
- [ ] Passwords never appear in `hosts.json`  
- [ ] `contextIsolation` on / `nodeIntegration` off  

- [ ] **Step 3: Commit any leftover fixes**

```powershell
git add -A
git commit -m "fix: polish v1 SSH client acceptance issues"
```

(Skip empty commit if clean.)

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Electron + TS + React + ssh2 + xterm | 1, 6, 9, 10 |
| Main owns SSH; preload whitelist; isolation | 8 |
| Host CRUD + JSON userData | 4, 9 |
| Password + private key auth | 6, 9, 10 |
| Multi-tab sessions | 7, 10 |
| Terminal I/O + resize + ANSI (xterm) | 10 |
| Connection status + errors | 3, 10 |
| No password on disk | 4, 9 |
| Key path only; key not returned to renderer | 6, 8 |
| known_hosts first-store + change warn | 5, 6, 10 |
| Windows package first | 11 |
| Unit tests for store + error map | 3, 4, 5 |

## Type consistency notes

- IPC channel names: only via `IPC.*` in `src/shared/types.ts`
- Renderer access: only `window.api` (`ElectronApi`)
- Errors: `{ code: SshErrorCode; message: string }` (`AppError`)
- Session id field name: `sessionId` everywhere (not `id` in IPC payloads)

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-10-ssh-client-implementation.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration  
2. **Inline Execution** — execute tasks in this session with executing-plans, batching with checkpoints  

Which approach?
