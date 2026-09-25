import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  title?: string
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[notlarim]', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="error-box" role="alert">
        <h2>{this.props.title ?? 'Bu bölüm açılamadı'}</h2>
        <p>Notların cihazında kayıtlı duruyor. Sayfayı yenileyip tekrar dene.</p>
        <div className="error-actions">
          <button className="btn primary" onClick={() => location.reload()}>
            Sayfayı yenile
          </button>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Tekrar dene
          </button>
        </div>
        <code className="error-detail">{this.state.error.message}</code>
      </div>
    )
  }
}
