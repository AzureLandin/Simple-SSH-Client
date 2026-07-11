export type AuthMethod = 'password' | 'privateKey'

export type LanguageCode = 'zh' | 'en'

export interface AppSettings {
  language: LanguageCode
}

export interface HostConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  /** Absolute path; only used when authMethod === 'privateKey' */
  privateKeyPath?: string
  credentialsPrompted?: boolean
  credentialsSaved?: boolean
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
  settings: {
    get: () => Promise<AppSettings>
    set: (patch: Partial<AppSettings>) => Promise<AppSettings>
  }
  credentials: {
    isAvailable: () => Promise<boolean>
    save: (
      hostId: string,
      payload: { password?: string; privateKeyPath?: string }
    ) => Promise<void>
    clear: (hostId: string) => Promise<void>
    markPrompted: (hostId: string, saved: boolean) => Promise<void>
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
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  credentialsIsAvailable: 'credentials:isAvailable',
  credentialsSave: 'credentials:save',
  credentialsClear: 'credentials:clear',
  credentialsMarkPrompted: 'credentials:markPrompted',
  dialogOpenPrivateKey: 'dialog:openPrivateKey'
} as const
