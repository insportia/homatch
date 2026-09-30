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
  const balanceCopy = serviceBalanceCopy(lang, feePercent);
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
        <p className="mt-3 text-sm text-white/75">{balanceCopy.empty}</p>
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

      {feePercent != null && <p className="mt-3 text-[13px] text-white/70">{balanceCopy.feeLabel}</p>}

      <p className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] leading-relaxed text-white/80">
        {balanceCopy.card}
      </p>

      <Button onClick={() => setOpen(true)}
        className="mt-4 w-full bg-[hsl(38_92%_54%)] font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)]">
        {t('mads_add_funds')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] flex-col overflow-hidden p-0 md:max-w-sm">
          <DialogHeader className="shrink-0 px-6 pt-6">
            <DialogTitle>{t('mads_add_funds')}</DialogTitle>
            <DialogDescription>{balanceCopy.dialog}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-4">
          <label className="flex items-center gap-2" dir="ltr">
            <span className="text-lg font-bold" aria-hidden="true">$</span>
            <Input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} aria-label={t('mads_add_funds')} />
          </label>
          <p className="text-[13px] text-muted-foreground">{t('mm_w_bal_min')}</p>
          </div>
          <DialogFooter className="shrink-0 border-t bg-background px-6 py-4">
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


function serviceBalanceCopy(lang: string, feePercent?: number | null) {
  const pct = feePercent ?? 9;
  const exampleFee = (100 * pct / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

  const ka = pct === 0 ? {
    empty: 'HOMATCH-ის მომსახურების ბალანსზე თანხის დამატება არ გჭირდებათ.',
    feeLabel: 'HOMATCH-ის მომსახურების საკომისიო: 0%',
    card: 'თქვენთვის HOMATCH-ის მომსახურების საკომისიო 0%-ია. Meta-ს სარეკლამო ბიუჯეტს Meta პირდაპირ თქვენს დაკავშირებულ სარეკლამო ანგარიშს ჩამოაჭრის.',
    dialog: 'თქვენთვის HOMATCH-ის მომსახურების საკომისიო 0%-ია, ამიტომ ამ ბალანსის შევსება Meta Ads-ის გასაშვებად საჭირო არ არის.',
  } : {
    empty: 'ბალანსი ჯერ არ შეგივსიათ. თანხა დაგჭირდებათ მხოლოდ HOMATCH-ის მომსახურების საკომისიოს გადასახდელად.',
    feeLabel: `HOMATCH-ის მომსახურების საკომისიო: ${pct}%`,
    card: `ეს ბალანსი გამოიყენება მხოლოდ HOMATCH-ის მომსახურების საკომისიოსთვის. Meta-ს სარეკლამო ბიუჯეტი აქედან არ იხარჯება. მაგალითად, თუ სარეკლამო ბიუჯეტია $100, HOMATCH-ის ${pct}% მომსახურების საკომისიო არის $\${exampleFee}.`,
    dialog: `შეავსეთ მხოლოდ HOMATCH-ის მომსახურების საკომისიოს ბალანსი. მაგალითად, $100 სარეკლამო ბიუჯეტზე ${pct}% საკომისიო არის $\${exampleFee}. Meta-ს $100 სარეკლამო ბიუჯეტს Meta პირდაპირ თქვენს დაკავშირებულ სარეკლამო ანგარიშს ჩამოაჭრის. გამოუყენებელი თანხა დარჩება HOMATCH-ის ბალანსზე მომავალი კამპანიებისთვის და ნაღდ ფულად ვერ გაიტანთ.`,
  };

  if (lang === 'ka') return ka;

  const zero: Record<string, ReturnType<typeof serviceBalanceCopyFallback>> = {
    en: serviceBalanceCopyFallback('No top-up is required for the HOMATCH service balance.', 'HOMATCH service fee: 0%', 'Your HOMATCH service fee is 0%. Meta charges the advertising budget directly to your connected ad account.', 'Your HOMATCH service fee is 0%, so no HOMATCH service-balance top-up is required.'),
    ru: serviceBalanceCopyFallback('Пополнять баланс HOMATCH не требуется.', 'Комиссия HOMATCH: 0%', 'Ваша комиссия HOMATCH — 0%. Рекламный бюджет Meta списывает напрямую с подключённого рекламного аккаунта.', 'Ваша комиссия HOMATCH — 0%, поэтому пополнять этот баланс для Meta Ads не требуется.'),
    tr: serviceBalanceCopyFallback('HOMATCH hizmet bakiyesine para eklemeniz gerekmez.', 'HOMATCH hizmet bedeli: %0', 'HOMATCH hizmet bedeliniz %0. Meta reklam bütçesini doğrudan bağlı reklam hesabınızdan tahsil eder.', 'HOMATCH hizmet bedeliniz %0 olduğundan bu bakiyeyi Meta Ads için doldurmanız gerekmez.'),
    ar: serviceBalanceCopyFallback('لا تحتاج إلى شحن رصيد خدمة HOMATCH.', 'رسوم خدمة HOMATCH: 0%', 'رسوم خدمة HOMATCH لديك 0%. تخصم Meta ميزانية الإعلان مباشرةً من حسابك الإعلاني المرتبط.', 'رسوم خدمة HOMATCH لديك 0%، لذلك لا يلزم شحن هذا الرصيد لإعلانات Meta.'),
    he: serviceBalanceCopyFallback('אין צורך להטעין את יתרת השירות של HOMATCH.', 'דמי השירות של HOMATCH: 0%', 'דמי השירות של HOMATCH עבורכם הם 0%. Meta מחייבת את תקציב הפרסום ישירות מחשבון המודעות המחובר.', 'דמי השירות של HOMATCH עבורכם הם 0%, ולכן אין צורך להטעין את היתרה עבור Meta Ads.'),
  };
  if (pct === 0) return zero[lang] ?? zero.en;

  const standard: Record<string, ReturnType<typeof serviceBalanceCopyFallback>> = {
    en: serviceBalanceCopyFallback('Your balance is empty. Add funds only to cover the HOMATCH service fee.', `HOMATCH service fee: ${pct}%`, `This balance is only for the HOMATCH service fee; Meta ad spend is not taken from it. Example: with a $100 ad budget, the ${pct}% HOMATCH service fee is $\${exampleFee}.`, `Add only the HOMATCH service-fee amount. Example: for a $100 ad budget, a ${pct}% service fee is $\${exampleFee}. Meta charges the $100 ad budget directly to your connected ad account. Unused funds remain in your HOMATCH balance for future campaigns and cannot be withdrawn as cash.`),
    ru: serviceBalanceCopyFallback('Баланс пуст. Пополните его только для оплаты комиссии HOMATCH.', `Комиссия HOMATCH: ${pct}%`, `Этот баланс используется только для комиссии HOMATCH; рекламный бюджет Meta отсюда не списывается. Пример: при бюджете $100 комиссия HOMATCH ${pct}% составляет $\${exampleFee}.`, `Пополните только сумму комиссии HOMATCH. Пример: при рекламном бюджете $100 комиссия ${pct}% составляет $\${exampleFee}. Meta списывает рекламные $100 напрямую с подключённого рекламного аккаунта. Неиспользованные средства остаются на балансе HOMATCH для будущих кампаний и не выводятся наличными.`),
    tr: serviceBalanceCopyFallback('Bakiyeniz boş. Yalnızca HOMATCH hizmet bedelini karşılamak için para ekleyin.', `HOMATCH hizmet bedeli: %${pct}`, `Bu bakiye yalnızca HOMATCH hizmet bedeli içindir; Meta reklam harcaması buradan alınmaz. Örnek: $100 reklam bütçesinde %${pct} HOMATCH hizmet bedeli $\${exampleFee} olur.`, `Yalnızca HOMATCH hizmet bedeli tutarını ekleyin. Örnek: $100 reklam bütçesinde %${pct} hizmet bedeli $\${exampleFee} olur. Meta $100 reklam bütçesini doğrudan bağlı reklam hesabınızdan tahsil eder. Kullanılmayan tutar gelecekteki kampanyalar için HOMATCH bakiyenizde kalır ve nakit çekilemez.`),
    ar: serviceBalanceCopyFallback('رصيدك فارغ. أضف أموالاً فقط لتغطية رسوم خدمة HOMATCH.', `رسوم خدمة HOMATCH: ${pct}%`, `هذا الرصيد مخصص فقط لرسوم خدمة HOMATCH؛ ولا تُخصم منه ميزانية إعلانات Meta. مثال: عند ميزانية إعلانية قدرها $100، تكون رسوم HOMATCH بنسبة ${pct}% هي $\${exampleFee}.`, `أضف فقط مبلغ رسوم خدمة HOMATCH. مثال: عند ميزانية إعلانية قدرها $100، تكون الرسوم بنسبة ${pct}% هي $\${exampleFee}. تخصم Meta ميزانية الإعلان البالغة $100 مباشرةً من حسابك الإعلاني المرتبط. يبقى المبلغ غير المستخدم في رصيد HOMATCH للحملات المستقبلية ولا يمكن سحبه نقدًا.`),
    he: serviceBalanceCopyFallback('היתרה ריקה. הוסיפו כסף רק לכיסוי דמי השירות של HOMATCH.', `דמי השירות של HOMATCH: ${pct}%`, `היתרה הזו משמשת רק לדמי השירות של HOMATCH; תקציב הפרסום של Meta אינו נגבה ממנה. לדוגמה: בתקציב פרסום של $100, דמי שירות של ${pct}% הם $\${exampleFee}.`, `הוסיפו רק את סכום דמי השירות של HOMATCH. לדוגמה: בתקציב פרסום של $100, דמי שירות של ${pct}% הם $\${exampleFee}. Meta מחייבת את תקציב הפרסום בסך $100 ישירות מחשבון המודעות המחובר. סכום שלא נוצל נשאר ביתרת HOMATCH לקמפיינים עתידיים ואינו ניתן למשיכה במזומן.`),
  };
  return standard[lang] ?? standard.en;
}

function serviceBalanceCopyFallback(empty: string, feeLabel: string, card: string, dialog: string) {
  return { empty, feeLabel, card, dialog };
}
