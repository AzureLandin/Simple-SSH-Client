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