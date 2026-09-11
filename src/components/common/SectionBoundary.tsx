// HOMATCH — one broken section must not cost the customer the whole report.
//
// Until now there was exactly one error boundary in the application, wrapped
// around the entire route tree. Anything that threw anywhere replaced the
// page — so a verification with a perfectly good verdict, ownership section
// and market comparison was reduced to a grey screen because one optional
// block arrived in a shape its renderer did not expect. The customer lost
// everything they had paid for over a subsection they may not have read.
//
// A due-diligence report is a list of independent findings. It should degrade
// like one: the block that cannot render says so, in its own space, and the
// rest of the page is unaffected (PART A §5).
//
// This is deliberately NOT a general-purpose wrapper to put around everything.
// A boundary is a promise that the thing inside is optional. Around a payment
// confirmation it would be a lie.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { AlertCircle } from 'lucide-react';
import { reportError, type ErrorContext } from '@/lib/errorReporting';

interface Props {
  children: React.ReactNode;
  /** Names the block in the diagnostic. Never shown to the customer. */
  name: string;
  /** Ids and shapes for the log — see errorReporting's own rules. */
  context?: ErrorContext;
  /** Replaces the default notice where a block has a better shape of its own. */
  fallback?: React.ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * The notice.
 *
 * Quiet on purpose. A section we could not draw says nothing at all about the
 * property, and rendering it in warning colours beside real findings is how a
 * rendering bug starts reading as a defect in the building.
 */
const Unavailable: React.FC = () => {
  const { t } = useLanguage();
  return (
    <div
      className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3.5 flex items-start gap-2.5"
      role="status"
    >
      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium break-words">{t('section_unavailable')}</p>
        <p className="text-sm text-muted-foreground leading-relaxed break-words">
          {t('section_unavailable_hint')}
        </p>
      </div>
    </div>
  );
};

export class SectionBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportError(error, {
      ...this.props.context,
      boundary: this.props.name,
      route: typeof window !== 'undefined' ? window.location.pathname : undefined,
    });
    // The component stack is the single most useful line for finding which
    // renderer disagreed with the data, and it holds no customer content.
    // eslint-disable-next-line no-console
    console.error('[SectionBoundary]', this.props.name, info.componentStack);
  }

  /**
   * Re-arm when the subject changes.
   *
   * Without this, opening a report that fails and then navigating to a
   * healthy one leaves the notice in place — the boundary has no idea the
   * thing underneath it is now different data.
   */
  componentDidUpdate(prev: Props): void {
    if (this.state.failed && prev.context?.subjectId !== this.props.context?.subjectId) {
      this.setState({ failed: false });
    }
  }

  render(): React.ReactNode {
    if (this.state.failed) return this.props.fallback ?? <Unavailable />;
    return this.props.children;
  }
}
