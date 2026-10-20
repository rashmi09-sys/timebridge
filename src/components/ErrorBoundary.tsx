import { Component, createRef, type ErrorInfo, type ReactNode } from 'react';
import { SIMULATION_DISCLOSURE } from './SiteHeader';

interface State {
  error: Error | null;
}

/**
 * Last line of defence for rendering errors. Instead of a blank page, the guest is told that
 * nothing was booked and gets two ways back: re-render the page as it was, or start a fresh
 * booking. Focus moves to the heading so keyboard and screen-reader users land on the message.
 * (React error boundaries catch errors while rendering, not in event handlers or promises;
 * those paths already have their own error states in the booking flow.)
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };
  private heading = createRef<HTMLHeadingElement>();

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No telemetry in this demo; keep the details in the console for whoever is debugging.
    console.error('TimeBridge crashed while rendering', error, info.componentStack);
  }

  componentDidUpdate(_: unknown, prev: State) {
    if (this.state.error && !prev.error) this.heading.current?.focus();
  }

  private retry = () => this.setState({ error: null });

  private startOver = () => {
    // Keep only the guest's zone and the demo clock; drop any other state in the URL.
    const params = new URLSearchParams(window.location.search);
    const keep = new URLSearchParams();
    for (const key of ['tz', 'now']) {
      const value = params.get(key);
      if (value) keep.set(key, value);
    }
    const query = keep.toString();
    window.location.assign(`${window.location.pathname}${query ? `?${query}` : ''}`);
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <>
        <main className="page">
          <section className="card card-error" aria-labelledby="error-title">
            <h1 id="error-title" className="error-title" tabIndex={-1} ref={this.heading}>
              Something went wrong
            </h1>
            <p className="error-text">
              The booking page hit an unexpected problem and couldn’t be shown. Nothing was booked.
            </p>
            <div className="error-actions">
              <button type="button" className="button button-primary" onClick={this.retry}>
                Try again
              </button>
              <button type="button" className="button button-secondary" onClick={this.startOver}>
                Start over
              </button>
            </div>
          </section>
        </main>
        <footer className="site-footer">
          <p>{SIMULATION_DISCLOSURE}</p>
        </footer>
      </>
    );
  }
}
