import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import IntersectObserver from '@/components/common/IntersectObserver';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/contexts/AuthContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { routes } from './routes';

// React can throw a NotFoundError/removeChild crash when browser translation
// extensions mutate text nodes behind React's back. Homatch already has its own
// language switcher, so prevent external page translators from rewriting the DOM.
const DomMutationGuard: React.FC = () => {
  useEffect(() => {
    document.documentElement.setAttribute('translate', 'no');
    document.documentElement.classList.add('notranslate');
    document.body.setAttribute('translate', 'no');
    document.body.classList.add('notranslate');

    return () => {
      document.documentElement.removeAttribute('translate');
      document.documentElement.classList.remove('notranslate');
      document.body.removeAttribute('translate');
      document.body.classList.remove('notranslate');
    };
  }, []);

  return null;
};

// ── Error Boundary ─────────────────────────────────────────────
interface EBState { hasError: boolean; message: string }
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, EBState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, message: error?.message ?? 'Unknown error' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);

    // Recover once from the known DOM desynchronisation error instead of leaving
    // the user on a dead error screen. A one-shot session guard prevents loops.
    const isDomRemovalError =
      error?.name === 'NotFoundError' ||
      /removeChild|not a child of this node/i.test(error?.message ?? '');

    if (isDomRemovalError && sessionStorage.getItem('homatch-dom-recovery') !== '1') {
      sessionStorage.setItem('homatch-dom-recovery', '1');
      window.location.reload();
      return;
    }

    sessionStorage.removeItem('homatch-dom-recovery');
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-background">
          <p className="text-lg font-semibold mb-2">An application error has occurred.</p>
          <p className="text-sm text-muted-foreground mb-4">{this.state.message}</p>
          <button
            className="text-sm underline text-primary"
            onClick={() => {
              sessionStorage.removeItem('homatch-dom-recovery');
              this.setState({ hasError: false, message: '' });
              window.location.reload();
            }}
          >
            Refresh the page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const App: React.FC = () => {
  return (
    <Router>
      <LanguageProvider>
        <AuthProvider>
          <DomMutationGuard />
          <IntersectObserver />
          <ErrorBoundary>
            <Routes>
              {routes.map((route, index) => (
                <Route key={index} path={route.path} element={route.element} />
              ))}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
          <Toaster richColors position="top-right" />
        </AuthProvider>
      </LanguageProvider>
    </Router>
  );
};

export default App;
