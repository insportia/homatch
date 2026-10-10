// HOMATCH EMAIL STUDIO — the one-click unsubscribe page.
//
// Served from email-webhook (verify_jwt = false, already deployed) because a person
// clicking a link in their mail client has no Supabase session, and production is at
// the edge-function cap. It does NOT weaken the webhook: POST provider events still
// need the Svix signature; this is a GET that needs OUR signature —
// HMAC-SHA256("email-studio:<recipient id>") keyed with the service role key, the
// same scheme as _shared/suppression.ts signUnsubscribeToken (outreach-unsubscribe).
// A forged or altered id/token pair does nothing and gets the "invalid" page.
//
// Unsubscribing withdraws the member's marketing-email consent for every seller
// (lead_contact_preferences.accept_marketing_email = false) and records a studio
// suppression; email_studio_unsubscribe() does both, idempotently.

import { verifyUnsubscribeToken } from './suppression.ts';

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

const COPY: Record<string, { title: string; success: string; already: string; invalid: string; error: string }> = {
  en: { title: 'Unsubscribe', success: 'You have been unsubscribed. Property owners on HOMATCH will no longer send you offers by email.', already: 'You were already unsubscribed.', invalid: 'This unsubscribe link is invalid or has expired.', error: 'Something went wrong. Please try again later.' },
  ka: { title: 'გამოწერის გაუქმება', success: 'გამოწერა გაუქმებულია. HOMATCH-ზე ქონების მფლობელები აღარ გამოგიგზავნიან შეთავაზებებს ელ-ფოსტით.', already: 'გამოწერა უკვე გაუქმებული გქონდათ.', invalid: 'ეს ბმული არასწორია ან ვადაგასულია.', error: 'დაფიქსირდა შეცდომა. სცადეთ მოგვიანებით.' },
  ru: { title: 'Отписка', success: 'Вы отписаны. Владельцы недвижимости на HOMATCH больше не будут присылать вам предложения по электронной почте.', already: 'Вы уже были отписаны.', invalid: 'Эта ссылка недействительна или устарела.', error: 'Что-то пошло не так. Попробуйте позже.' },
  tr: { title: 'Abonelikten çık', success: 'Aboneliğiniz iptal edildi. HOMATCH’teki mülk sahipleri artık size e-postayla teklif göndermeyecek.', already: 'Zaten abonelikten çıkmıştınız.', invalid: 'Bu bağlantı geçersiz veya süresi dolmuş.', error: 'Bir şeyler ters gitti. Lütfen daha sonra tekrar deneyin.' },
  ar: { title: 'إلغاء الاشتراك', success: 'تم إلغاء اشتراكك. لن يرسل إليك مالكو العقارات على HOMATCH عروضًا عبر البريد الإلكتروني بعد الآن.', already: 'كنت قد ألغيت اشتراكك بالفعل.', invalid: 'هذا الرابط غير صالح أو منتهي الصلاحية.', error: 'حدث خطأ ما. يرجى المحاولة لاحقًا.' },
  he: { title: 'הסרה מרשימת התפוצה', success: 'הוסרת מרשימת התפוצה. בעלי נכסים ב־HOMATCH לא ישלחו לך עוד הצעות בדוא״ל.', already: 'כבר הוסרת בעבר.', invalid: 'הקישור אינו תקין או שפג תוקפו.', error: 'משהו השתבש. נסו שוב מאוחר יותר.' },
};

function page(lang: string, key: 'success' | 'already' | 'invalid' | 'error', status = 200): Response {
  const l = COPY[lang] ? lang : 'en';
  const c = COPY[l];
  const dir = l === 'ar' || l === 'he' ? 'rtl' : 'ltr';
  const html = `<!doctype html><html lang="${l}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${c.title}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f6f3ec;color:#14213a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.card{max-width:440px;background:#fff;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center}
.mark{font-weight:800;letter-spacing:.18em;color:#c9973a;font-size:13px;margin:0 0 16px}h1{font-size:18px;margin:0 0 12px}p{font-size:15px;line-height:1.6;color:#3d465a;margin:0}</style></head>
<body><div class="card"><p class="mark">HOMATCH</p><h1>${c.title}</h1><p>${c[key]}</p></div></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}

/** True when this GET is a studio unsubscribe link (the webhook routes it here). */
export function isStudioUnsubscribe(url: URL): boolean {
  return url.searchParams.has('esu');
}

/**
 * GET shows a confirmation the click already applied (one click, as the law and the
 * inbox providers expect); POST is the RFC 8058 one-click form some clients send.
 */
export async function handleStudioUnsubscribe(url: URL, sb: Rpc): Promise<Response> {
  const recipientId = url.searchParams.get('esu') ?? '';
  const token = url.searchParams.get('t') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(recipientId) || !/^[0-9a-f]{64}$/.test(token)) return page('en', 'invalid', 400);
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) return page('en', 'error', 503);
  if (!(await verifyUnsubscribeToken(`email-studio:${recipientId}`, token, key))) return page('en', 'invalid', 400);
  try {
    const { data, error } = await sb.rpc('email_studio_unsubscribe', { p_recipient_id: recipientId });
    if (error) throw new Error(error.message);
    const r = (data ?? {}) as { ok?: boolean; already?: boolean; language?: string };
    if (!r.ok) return page('en', 'invalid', 404);
    return page(String(r.language ?? 'en'), r.already ? 'already' : 'success');
  } catch (e) {
    console.error('[email-studio-unsubscribe] failed:', (e as Error)?.message);
    return page('en', 'error', 500);
  }
}
