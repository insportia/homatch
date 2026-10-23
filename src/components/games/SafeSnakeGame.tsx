// The Snake game, isolated from the page it is opened beside.
//
// Prod 12272abd (2026-10-23): a V2 verification was running when the owner
// opened Snake, and the whole app fell to the global error page. The game is
// a lazily loaded chunk rendered in a portal with nothing between it and the
// app's ErrorBoundary, so anything thrown there — a chunk that no longer
// exists after a deploy (the tab predates it), or an error inside the game —
// unmounted the Verify workspace with it. The job itself kept running.
//
// Now: the chunk is fetched with one retry (a network blip or a stale chunk
// that a second request can still get), and an error boundary around the
// game closes it and tells the host, instead of passing the error upward.
// Never a page reload: the page beside the game is the thing that matters.
import React, { lazy, Suspense } from 'react';
import { reportError } from '@/lib/errorReporting';
import { isChunkLoadError } from '@/lib/lazyRoute';

type SnakeProps = React.ComponentProps<typeof import('./SnakeGame').default>;

export async function loadSnakeOnceRetried<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (!isChunkLoadError(error)) throw error;
    return await load();
  }
}

const SnakeGame = lazy(() => loadSnakeOnceRetried(() => import('./SnakeGame')));

class GameBoundary extends React.Component<{ onFailed: () => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    reportError(error, { boundary: 'snake', route: typeof window !== 'undefined' ? window.location.pathname : undefined });
    this.props.onFailed();
  }

  render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** Snake that can fail on its own: `onFailed` closes it; the page beside it never sees the error. */
export default function SafeSnakeGame({ onFailed, ...props }: SnakeProps & { onFailed: () => void }) {
  return (
    <GameBoundary onFailed={onFailed}>
      <Suspense fallback={null}>
        <SnakeGame {...props} />
      </Suspense>
    </GameBoundary>
  );
}
