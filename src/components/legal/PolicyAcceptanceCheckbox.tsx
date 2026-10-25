import { Link } from 'react-router-dom';
import { Checkbox } from '@/components/ui/checkbox';
import { useLanguage } from '@/contexts/LanguageContext';

/*
 * "I have read and agree to the Terms of Service and have read the Privacy
 * Policy." Unticked by default, always; the two document names are links
 * that open the documents in a new tab so the form is not lost.
 *
 * The sentence carries {{terms}} and {{privacy}} holes for the two link
 * texts, so word order can differ per language (Georgian, Arabic and Hebrew
 * do not put them where English does). t() strips unfilled holes, so they
 * are filled with markers and the sentence is split on those.
 */
const TERMS = '\u0001T\u0001';
const PRIVACY = '\u0001P\u0001';

export function PolicyAcceptanceCheckbox({
  checked,
  onChange,
  showError,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  showError: boolean;
}) {
  const { t } = useLanguage();
  const sentence = t('legal_accept_sentence', { terms: TERMS, privacy: PRIVACY });
  const parts = sentence.split(/(\u0001[TP]\u0001)/);
  const linkClass = 'font-medium text-primary underline underline-offset-2 hover:text-foreground';

  return (
    <div className="space-y-1.5">
      <label className="flex items-start gap-2.5 text-sm" data-policy-acceptance="">
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => onChange(v === true)}
          className="mt-0.5"
          aria-invalid={showError && !checked}
          aria-describedby={showError && !checked ? 'policy-acceptance-error' : undefined}
          aria-required="true"
        />
        <span className="text-muted-foreground leading-relaxed">
          {parts.map((part, i) => {
            if (part === TERMS) {
              return <Link key={i} to="/terms" target="_blank" rel="noopener" className={linkClass}>{t('legal_accept_terms_link')}</Link>;
            }
            if (part === PRIVACY) {
              return <Link key={i} to="/privacy" target="_blank" rel="noopener" className={linkClass}>{t('legal_accept_privacy_link')}</Link>;
            }
            return <span key={i}>{part}</span>;
          })}
        </span>
      </label>
      {showError && !checked && (
        <p id="policy-acceptance-error" role="alert" className="text-xs text-destructive">
          {t('legal_accept_required')}
        </p>
      )}
    </div>
  );
}
