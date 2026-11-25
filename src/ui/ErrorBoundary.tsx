"use client";

import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  /** Shown instead of the children once they throw. Give the boundary a new `key` to try them again. */
  fallback: ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * Keeps a crash inside one part of the screen instead of letting it replace the
 * whole page. React only offers error boundaries as class components.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
