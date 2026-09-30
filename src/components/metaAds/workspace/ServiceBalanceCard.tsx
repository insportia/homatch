// META ADS — the HOMATCH service balance, one block per currency:
// DEPOSITED / AVAILABLE / RESERVED / CONSUMED / RELEASED. Amounts in
// different currencies are never added together. The non-refundable
// disclosure is mandatory and always rendered.
import { useState } from 'react';
import { Loader2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { depositCheckout, moneyIn, type ServiceBalanceRow } from '@/services/metaAds';

/** Stripe checkout minimum, in cents ($5). */
export const MIN_DEPOSIT_CENTS = 500;

export function ServiceBalanceCard({ rows, feePercent }: { rows: ServiceBalanceRow[]; feePercent?: number | null }) {
  const { t, lang } = useLanguage();
  const balanceExplanation = serviceBalanceExplanation(lang, feePercent);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('50');
  const [busy, setBusy] = useState(false);

  const deposit = async () => {
    const cents = Math.round(parseFloat(amount.replace(',', '.')) * 100);
    if (!Number.isFinite(cents) || cents < MIN_DEPOSIT_CENTS) { toast.error(t('mads_deposit_min')); return; }
    setBusy(true);
    try {
      const { url } = await depositCheckout(cents);
      window.location.href = url;
    } catch {
      toast.error(t('mads_deposit_unavailable'));
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="mm-w-bal-title" className="overflow-hidden rounded-2xl bg-[#0C1119] p-5 text-white shadow-hover">
      <h2 id="mm-w-bal-title" className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-[hsl(38_92%_60%)]">
        <Wallet className="h-4 w-4" aria-hidden="true" />{t('mm_w_bal_title')}
      </h2>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-white/75">{t('mm_w_bal_empty')}</p>
      ) : (
        <div className="mt-3 space-y-4">
          {rows.map(r => (
            <div key={r.currency} aria-label={t('mm_w_bal_currency', { currency: r.currency })}>
              {rows.length > 1 && <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-white/60">{t('mm_w_bal_currency', { currency: r.currency })}</p>}
              <p className="text-2xs text-white/60">{t('mm_w_bal_available')}</p>
              <p className="font-display text-3xl font-bold tabular-nums" dir="ltr">{moneyIn(r.available_cents, r.currency, lang)}</p>
              <dl className="mt-2 space-y-1.5 text-[13px] text-white/80 tabular-nums">
                <Line label={t('mm_w_bal_deposited')} value={moneyIn(r.deposited_cents, r.currency, lang)} />
                <Line label={t('mm_w_bal_reserved')} hint={t('mm_w_bal_reserved_hint')} value={moneyIn(r.reserved_service_cents, r.currency, lang)} />
                <Line label={t('mm_w_bal_consumed')} hint={t('mm_w_bal_consumed_hint')} value={moneyIn(r.consumed_service_cents, r.currency, lang)} />
                <Line label={t('mm_w_bal_released')} hint={t('mm_w_bal_released_hint')} value={moneyIn(r.released_cents, r.currency, lang)} />
              </dl>
            </div>
          ))}
        </div>
      )}

      {feePercent != null && <p className="mt-3 text-[13px] text-white/70">{t('mm_w_bal_fee', { percent: feePercent })}</p>}

      <p className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] leading-relaxed text-white/80">
        {balanceExplanation}
      </p>

      <Button onClick={() => setOpen(true)}
        className="mt-4 w-full bg-[hsl(38_92%_54%)] font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)]">
        {t('mads_add_funds')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('mads_add_funds')}</DialogTitle>
            <DialogDescription>{balanceExplanation}</DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2" dir="ltr">
            <span className="text-lg font-bold" aria-hidden="true">$</span>
            <Input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} aria-label={t('mads_add_funds')} />
          </label>
          <p className="text-[13px] text-muted-foreground">{t('mm_w_bal_min')}</p>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{balanceExplanation}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('general_cancel')}</Button>
            <Button onClick={deposit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('mads_deposit_go')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Line({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="min-w-0">
        <span>{label}</span>
        {hint && <span className="block text-2xs text-white/55">{hint}</span>}
      </dt>
      <dd className="shrink-0" dir="ltr">{value}</dd>
    </div>
  );
}


function serviceBalanceExplanation(lang: string, feePercent?: number | null): string {
  const pct = feePercent ?? 9;
  if (pct === 0) {
    const zero: Record<string, string> = {
      en: 'This balance is only for HOMATCH service fees. Your service fee is 0%, so no HOMATCH top-up is required for Meta Ads. Meta charges the advertising budget directly to your connected ad account.',
      ka: 'ეს ბალანსი მხოლოდ HOMATCH-ის მომსახურების საკომისიოსთვისაა. თქვენი მომსახურების საკომისიო 0%-ია, ამიტომ Meta Ads-ისთვის HOMATCH ბალანსის შევსება არ გჭირდებათ. სარეკლამო ბიუჯეტს Meta პირდაპირ თქვენს დაკავშირებულ სარეკლამო ანგარიშს ჩამოაჭრის.',
      ru: 'Этот баланс предназначен только для комиссии HOMATCH. Ваша комиссия — 0%, поэтому пополнять баланс HOMATCH для Meta Ads не нужно. Рекламный бюджет Meta списывает напрямую с подключённого рекламного аккаунта.',
      tr: 'Bu bakiye yalnızca HOMATCH hizmet bedeli içindir. Hizmet bedeliniz %0 olduğundan Meta Ads için HOMATCH bakiyesine para eklemeniz gerekmez. Reklam bütçesini Meta doğrudan bağlı reklam hesabınızdan tahsil eder.',
      ar: 'هذا الرصيد مخصص فقط لرسوم خدمة HOMATCH. رسوم خدمتك 0%، لذلك لا تحتاج إلى شحن رصيد HOMATCH لإعلانات Meta. تخصم Meta ميزانية الإعلان مباشرةً من حسابك الإعلاني المرتبط.',
      he: 'היתרה הזו מיועדת רק לדמי השירות של HOMATCH. דמי השירות שלכם הם 0%, ולכן אין צורך להטעין את יתרת HOMATCH עבור Meta Ads. Meta מחייבת את תקציב הפרסום ישירות מחשבון המודעות המחובר.',
    };
    return zero[lang] ?? zero.en;
  }
  const exampleFee = (100 * pct / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const copy: Record<string, string> = {
    en: `This balance is only for the HOMATCH service fee — it is not your Meta advertising budget. Meta charges the ad budget directly to your connected ad account. Example: if your advertising budget is $100 and your service fee is ${pct}%, you need $\${exampleFee} in your HOMATCH balance. Unused funds stay in your HOMATCH balance for future campaigns and are not withdrawable as cash.`,
    ka: `ეს ბალანსი მხოლოდ HOMATCH-ის მომსახურების საკომისიოსთვისაა და არ წარმოადგენს Meta-ს სარეკლამო ბიუჯეტს. სარეკლამო ბიუჯეტს Meta პირდაპირ თქვენს დაკავშირებულ სარეკლამო ანგარიშს ჩამოაჭრის. მაგალითი: თუ თქვენი სარეკლამო ბიუჯეტია $100 და მომსახურების საკომისიო ${pct}%-ია, HOMATCH-ის ბალანსზე უნდა გქონდეთ $\${exampleFee}. გამოუყენებელი თანხა რჩება HOMATCH-ის ბალანსზე მომავალი კამპანიებისთვის და ნაღდ ფულად ვერ გაიტანთ.`,
    ru: `Этот баланс предназначен только для комиссии HOMATCH и не является рекламным бюджетом Meta. Meta списывает рекламный бюджет напрямую с подключённого рекламного аккаунта. Пример: если рекламный бюджет — $100, а комиссия — ${pct}%, на балансе HOMATCH нужно $\${exampleFee}. Неиспользованные средства остаются на балансе HOMATCH для будущих кампаний и не выводятся наличными.`,
    tr: `Bu bakiye yalnızca HOMATCH hizmet bedeli içindir; Meta reklam bütçeniz değildir. Meta reklam bütçesini doğrudan bağlı reklam hesabınızdan tahsil eder. Örnek: reklam bütçeniz $100 ve hizmet bedeliniz %${pct} ise HOMATCH bakiyenizde $\${exampleFee} bulunmalıdır. Kullanılmayan tutar gelecekteki kampanyalar için HOMATCH bakiyenizde kalır ve nakit olarak çekilemez.`,
    ar: `هذا الرصيد مخصص فقط لرسوم خدمة HOMATCH وليس ميزانية إعلانات Meta. تخصم Meta ميزانية الإعلان مباشرةً من حسابك الإعلاني المرتبط. مثال: إذا كانت ميزانية الإعلان $100 ورسوم الخدمة ${pct}%، فيجب أن يتوفر $\${exampleFee} في رصيد HOMATCH. يبقى المبلغ غير المستخدم في رصيد HOMATCH للحملات المستقبلية ولا يمكن سحبه نقدًا.`,
    he: `היתרה הזו מיועדת רק לדמי השירות של HOMATCH ואינה תקציב הפרסום ב-Meta. Meta מחייבת את תקציב הפרסום ישירות מחשבון המודעות המחובר. לדוגמה: אם תקציב הפרסום הוא $100 ודמי השירות הם ${pct}%, צריכים להיות $\${exampleFee} ביתרת HOMATCH. סכום שלא נוצל נשאר ביתרת HOMATCH לקמפיינים עתידיים ואינו ניתן למשיכה במזומן.`,
  };
  return copy[lang] ?? copy.en;
}
