import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import IntersectObserver from '@/components/common/IntersectObserver';
import { HomatchArchitectureMotion } from '@/components/common/HomatchArchitectureMotion';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/contexts/AuthContext';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import { routes } from './routes';

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

interface EBState { hasError: boolean; message: string | null }

function ErrorFallback({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-background">
      <p className="text-lg font-semibold mb-2">{t('app_error_occurred')}</p>
      <p className="text-sm text-muted-foreground mb-4">{message ?? t('app_unknown_error')}</p>
      <button className="text-sm underline text-primary" onClick={onRetry}>{t('app_refresh_page')}</button>
    </div>
  );
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, EBState> {
  constructor(props: { children: React.ReactNode }) { super(props); this.state = { hasError: false, message: null }; }
  static getDerivedStateFromError(error: Error): EBState { return { hasError: true, message: error?.message ?? null }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
    const isDomRemovalError = error?.name === 'NotFoundError' || /removeChild|not a child of this node/i.test(error?.message ?? '');
    if (isDomRemovalError && sessionStorage.getItem('homatch-dom-recovery') !== '1') {
      sessionStorage.setItem('homatch-dom-recovery', '1'); window.location.reload(); return;
    }
    sessionStorage.removeItem('homatch-dom-recovery');
  }
  render() {
    if (this.state.hasError) return <ErrorFallback message={this.state.message} onRetry={() => { sessionStorage.removeItem('homatch-dom-recovery'); this.setState({ hasError: false, message: null }); window.location.reload(); }} />;
    return this.props.children;
  }
}

const App: React.FC = () => (
  <Router>
    <LanguageProvider>
      <AuthProvider>
        <DomMutationGuard />
        <IntersectObserver />
        <HomatchArchitectureMotion />
        <ErrorBoundary>
          <Routes>
            {routes.map((route, index) => <Route key={index} path={route.path} element={route.element} />)}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </LanguageProvider>
  </Router>
);

export default App;
