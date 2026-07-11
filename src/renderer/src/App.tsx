import { useState } from 'react'
import type { HostConfig } from '../../../shared/types'
import { HostList } from './components/HostList'
import { Toast } from './components/Toast'
import { useHosts } from './hooks/useHosts'

function App(): React.JSX.Element {
  const { hosts, error, create, update, remove } = useHosts()
  const [localMessage, setLocalMessage] = useState<string | null>(null)

  const handleConnect = (host: HostConfig): void => {
    setLocalMessage(`Connect to ${host.name} (terminal coming next)`)
  }

  const toastMessage = localMessage ?? error

  return (
    <div className="app">
      <aside className="sidebar">
        <HostList
          hosts={hosts}
          onConnect={handleConnect}
          onCreate={create}
          onUpdate={update}
          onRemove={remove}
        />
      </aside>
      <main className="main">
        <p className="main-placeholder">Select a host and click Connect</p>
      </main>
      <Toast message={toastMessage} onClose={() => setLocalMessage(null)} />
    </div>
  )
}

export default App
