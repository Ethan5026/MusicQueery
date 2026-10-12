// Error state for a crashed screen (M8): one tab's render error shows here, logged to the remote log, instead of
// blanking the whole app. Keyed by tab in the shell, so switching tabs starts clean.
import { Component, type ReactNode } from 'react'
import { log } from '../debug/log'

interface Props {
  name: string
  children: ReactNode
}

export class Boundary extends Component<Props, { error: Error | null }> {
  override state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    log('error', 'ui.crash', { tab: this.props.name, msg: error.message, stack: (info.componentStack ?? '').slice(0, 600) })
  }

  override render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="page">
        <div className="empty" role="alert" data-testid="crash">
          <p>This screen hit a problem: {error.message}</p>
          <button type="button" className="btn primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button type="button" className="btn" onClick={() => location.reload()}>
            Reload the app
          </button>
        </div>
      </div>
    )
  }
}
