import { Component } from 'react';

// A live demo should not blank out because one render threw. This catches the
// error, keeps the shell readable, and offers a way back.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('AVNI render error', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center bg-ink p-6">
        <div className="recess w-full max-w-[520px] px-5 py-5">
          <div className="lbl mb-2 text-warn">console fault</div>
          <p className="text-[13px] leading-5 text-t1">
            A panel stopped rendering. The scene and your session data are untouched — reload to bring the
            console back.
          </p>
          <p className="data-mono mt-3 max-h-24 overflow-y-auto rounded border border-edge bg-panel px-2.5 py-2 text-[10.5px] leading-4 text-t3">
            {String(this.state.error?.message || this.state.error)}
          </p>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-md border border-edge px-3 py-1.5 text-[11.5px] text-t2 hover:text-t1"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-[11.5px] font-semibold text-accent hover:bg-accent/20"
            >
              Reload console
            </button>
          </div>
        </div>
      </div>
    );
  }
}
