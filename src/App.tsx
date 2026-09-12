import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import IntersectObserver from '@/components/common/IntersectObserver';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/contexts/AuthContext';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import { routes } from './routes';
import { reportError } from '@/lib/errorReporting';
import { JobsProvider } from '@/contexts/JobsContext';
import { JobIndicator } from '@/components/jobs/JobIndicator';
import { noteInAppNavigation } from '@/lib/backNavigation';

/*
 * Counts route changes so SmartBack can tell the difference between "there
 * is a Homatch screen behind us" and "this tab opened straight onto a deep
 * link". It has to live inside <Router> to see the location at all, and it
 * renders nothing. The FIRST location is not a navigation — arriving is not
 * going back — so the initial mount is skipped.
 */
const NavigationCounter: React.FC = () => {
  const { pathname } = useLocation();
  const first = React.useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    noteInAppNavigation();
  }, [pathname]);
  return null;
};
const DomMutationGuard: React.FC = () => { useEffect(() => { document.documentElement.setAttribute('translate','no'); document.documentElement.classList.add('notranslate'); document.body.setAttribute('translate','no'); document.body.classList.add('notranslate'); return()=>{document.documentElement.removeAttribute('translate');document.documentElement.classList.remove('notranslate');document.body.removeAttribute('translate');document.body.classList.remove('notranslate');};},[]); return null; };
interface EBState { hasError:boolean }
/*
 * THE MESSAGE IS NOT THE CUSTOMER'S.
 *
 * This used to render `error.message` verbatim, which is how a buyer opening
 * the verification they had paid for was shown
 *
 *     Cannot read properties of undefined (reading 'filter')
 *
 * A thrown message names an internal property on an internal object. It tells
 * the person reading it nothing they can act on, and it tells us nothing we
 * did not already get from the log — reportError() keeps the message, the
 * stack and the route (PART E §54).
 *
 * The DOM-removal self-heal below still needs the message, so it is read
 * inside componentDidCatch and deliberately never put into state.
 */
function ErrorFallback({onRetry}:{onRetry:()=>void}){const{t}=useLanguage();return <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-background"><p className="text-lg font-semibold mb-2">{t('app_error_occurred')}</p><p className="text-sm text-muted-foreground mb-4">{t('app_error_generic_hint')}</p><button className="text-sm underline text-primary" onClick={onRetry}>{t('app_refresh_page')}</button></div>}
class ErrorBoundary extends React.Component<{children:React.ReactNode},EBState>{constructor(props:{children:React.ReactNode}){super(props);this.state={hasError:false}}static getDerivedStateFromError():EBState{return{hasError:true}}componentDidCatch(error:Error,info:React.ErrorInfo){reportError(error,{boundary:'app',route:typeof window!=='undefined'?window.location.pathname:undefined});console.error('[ErrorBoundary]',info.componentStack);const isDomRemovalError=error?.name==='NotFoundError'||/removeChild|not a child of this node/i.test(error?.message??'');if(isDomRemovalError&&sessionStorage.getItem('homatch-dom-recovery')!=='1'){sessionStorage.setItem('homatch-dom-recovery','1');window.location.reload();return}sessionStorage.removeItem('homatch-dom-recovery')}render(){if(this.state.hasError)return <ErrorFallback onRetry={()=>{sessionStorage.removeItem('homatch-dom-recovery');this.setState({hasError:false});window.location.reload()}}/>;return this.props.children}}
/*
 * JobsProvider and JobIndicator sit OUTSIDE <Routes>, which is the whole
 * point of them. A route change re-renders what is inside <Routes> and
 * nothing else, so the thing watching a running verification is not the thing
 * the customer navigates away from. It is also outside <ErrorBoundary>: a
 * page that throws must not take the progress indicator with it, since the
 * job is still running and that is exactly when the customer needs to see so.
 */
const App:React.FC=()=> <Router><LanguageProvider><AuthProvider><JobsProvider><NavigationCounter/><DomMutationGuard/><IntersectObserver/><ErrorBoundary><Routes>{routes.map((route,index)=><Route key={index} path={route.path} element={route.element}/>) }<Route path="*" element={<Navigate to="/" replace/>}/></Routes></ErrorBoundary><JobIndicator/><Toaster richColors position="top-right"/></JobsProvider></AuthProvider></LanguageProvider></Router>;
export default App;
