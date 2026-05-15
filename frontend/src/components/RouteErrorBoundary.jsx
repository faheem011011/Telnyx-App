import { Component } from 'react';

export default class RouteErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[RouteErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center surface">
          <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
            <span className="text-2xl">⚠</span>
          </div>
          <h2 className="text-base font-display font-semibold mb-1">This page crashed</h2>
          <p className="text-sm text-muted mb-4 max-w-xs">
            An unexpected error occurred. Other pages are still working — navigate away or try again.
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="btn-primary py-2 text-sm"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
