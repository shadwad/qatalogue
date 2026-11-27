import React from 'react';
import { LoadFailure } from './LoadFailure';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /** Replaces the whole page, for an error outside any one view. */
  fullPage?: boolean;
}

/**
 * Catches a view that fails to load or render, so the page shows a way forward rather than going blank. Reloading is the
 * remedy because React keeps a failed lazy import, and the URL brings the reader back to the same view.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, { failed: boolean }> {
  declare props: ErrorBoundaryProps;
  state = { failed: false };

  // React logs the error itself.
  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div className={`flex justify-center p-10 lg:p-16 ${this.props.fullPage ? 'h-[100dvh] items-center bg-surface' : 'flex-1'}`}>
        <LoadFailure
          what={this.props.fullPage ? 'Qatalogue' : 'This view'}
          hint="Check your connection and reload the page."
          retryLabel="Reload"
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }
}
