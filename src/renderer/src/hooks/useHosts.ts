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

  const create = async (input: HostInput): Promise<HostConfig> => {
    const host = await window.api.hosts.create(input)
    await refresh()
    return host
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
