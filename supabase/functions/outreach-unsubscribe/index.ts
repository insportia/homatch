// outreach-unsubscribe Edge Function
// Public, no-auth endpoint (verify_jwt: false, same pattern as retell-webhook
// and payment-webhook — the caller is a person's email client, not a
// Supabase session) that a one-click unsubscribe link in an outreach email
// points to. Real gap this closes: outreach_contacts.unsubscribed was
// already checked by outreach-send before every EMAIL/SMS send, and
// checkEligibility() in _shared/suppression.ts already treated it as a hard
// stop — but nothing in the system could ever SET that flag from a
// recipient's own action, because no email ever contained an unsubscribe
// link and no endpoint existed to handle a click on one. The enforcement
// was real; the way to trigger it didn't exist.
//
// GET /outreach-unsubscribe?contact=<id>&token=<hmac> — token is
// HMAC-SHA256(contact_id) signed by outreach-send when it builds the email
// (see signUnsubscribeToken in _shared/suppression.ts), so a contact id
// alone (guessable, sequential-looking UUIDs aside) can't unsubscribe
// someone else's contact. Always returns a small standalone HTML page (not
// JSON) since a browser opens this link directly.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Inlined rather than imported from ../_shared/suppression.ts (which also
// exports this same pair for outreach-send to use when it signs a link):
// the multi-file deploy for this function kept producing a broken bundled
// entrypoint path in this sandbox's deploy tool (a "source/source/index.ts"
// double-prefix, then a "path does not exist" on the next attempt) even
// though the identical file layout works for other functions in this repo
// (contact-import, outreach-send). Rather than fight that, this one small,
// self-contained function inlines its own copy of the two crypto helpers —
// keep this in sync with _shared/suppression.ts's signUnsubscribeToken /
// verifyUnsubscribeToken if either changes.
async function signUnsubscribeToken(contactId: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(contactId));
  return Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function verifyUnsubscribeToken(contactId: string, token: string, secret: string): Promise<boolean> {
  const expected = await signUnsubscribeToken(contactId, secret);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Minimal, server-rendered copy — this page is reached from an email client
// with no app session, so it doesn't go through the app's own i18n system.
// Kept in the same 6 languages the rest of the app supports.
const COPY: Record<string, { title: string; success: string; already: string; invalid: string; error: string }> = {
  en: { title: 'Unsubscribe', success: 'You have been unsubscribed. You will no longer receive marketing emails from Homatch.', already: 'You were already unsubscribed.', invalid: 'This unsubscribe link is invalid or has expired.', error: 'Something went wrong. Please try again later.' },
  ka: { title: 'გამოწერის გაუქმება', success: 'თქვენ გამოწერა გაუქმებულია. Homatch-ისგან სარეკლამო ელ-წერილებს აღარ მიიღებთ.', already: 'თქვენ უკვე გამოწერილი არ ხართ.', invalid: 'ეს ბმული არასწორია ან ვადაგასულია.', error: 'დაფიქსირდა შეცდომა. სცადეთ მოგვიანებით.' },
  ru: { title: 'Отписка', success: 'Вы отписаны. Вы больше не будете получать маркетинговые письма от Homatch.', already: 'Вы уже были отписаны.', invalid: 'Эта ссылка недействительна или устарела.', error: 'Что-то пошло не так. Попробуйте позже.' },
  tr: { title: 'Abonelikten çık', success: 'Aboneliğiniz iptal edildi. Artık Homatch\'tan pazarlama e-postası almayacaksınız.', already: 'Zaten abonelikten çıkmıştınız.', invalid: 'Bu abonelikten çıkma bağlantısı geçersiz veya süresi dolmuş.', error: 'Bir şeyler ters gitti. Lütfen daha sonra tekrar deneyin.' },
  ar: { title: 'إلغاء الاشتراك', success: 'تم إلغاء اشتراكك. لن تتلقى بعد الآن رسائل تسويقية من Homatch.', already: 'كنت قد ألغيت اشتراكك بالفعل.', invalid: 'رابط إلغاء الاشتراك هذا غير صالح أو منتهي الصلاحية.', error: 'حدث خطأ ما. يرجى المحاولة لاحقًا.' },
  he: { title: 'ביטול הרשמה', success: 'ההרשמה שלך בוטלה. לא תקבל/י יותר הודעות שיווקיות מ-Homatch.', already: 'כבר ביטלת את ההרשמה בעבר.', invalid: 'קישור ביטול ההרשמה אינו תקין או שפג תוקפו.', error: 'משהו השתבש. נסה/י שוב מאוחר יותר.' },
};

function page(lang: string, key: 'success' | 'already' | 'invalid' | 'error', status = 200): Response {
  const c = COPY[lang] ?? COPY.en;
  const dir = lang === 'ar' || lang === 'he' ? 'rtl' : 'ltr';
  const html = `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${c.title}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f7f7f5;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.card{max-width:420px;background:#fff;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center}
h1{font-size:18px;margin:0 0 12px}p{font-size:14px;line-height:1.6;color:#444;margin:0}</style></head>
<body><div class="card"><h1>${c.title}</h1><p>${c[key]}</p></div></body></html>`;
  return new Response(html, { status, headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const contactId = url.searchParams.get('contact') || '';
    const token = url.searchParams.get('token') || '';
    if (!contactId || !token) return page('en', 'invalid', 400);

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ok = await verifyUnsubscribeToken(contactId, token, serviceKey);
    if (!ok) return page('en', 'invalid', 400);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
    const { data: contact, error: fetchErr } = await supabase
      .from('outreach_contacts')
      .select('id, language, unsubscribed')
      .eq('id', contactId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!contact) return page('en', 'invalid', 404);

    const lang = (contact.language && COPY[contact.language]) ? contact.language : 'en';
    if (contact.unsubscribed) return page(lang, 'already');

    const { error: updErr } = await supabase.from('outreach_contacts')
      .update({ unsubscribed: true, unsubscribed_at: new Date().toISOString() })
      .eq('id', contactId);
    if (updErr) throw updErr;

    return page(lang, 'success');
  } catch (err) {
    console.error('[outreach-unsubscribe] error:', err);
    return page('en', 'error', 500);
  }
});
