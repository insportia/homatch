/*
 * HOMATCH SERVICE WORKER
 *
 * Written by hand rather than generated, because the thing that matters here
 * is what is NOT cached, and that is easier to be sure of in thirty lines
 * than in a Workbox config.
 *
 * WHAT THIS CACHES
 *   The app shell and immutable build assets. Vite fingerprints every file
 *   under /assets/, so a hashed URL can be cached forever and a new build
 *   simply requests different URLs.
 *
 * WHAT THIS MUST NEVER CACHE, AND WHY
 *   Anything with a customer in it. A verification report, a contract
 *   analysis, a wallet balance, an auth token, a document the customer
 *   uploaded — none of it goes in the Cache API. A cache is shared per
 *   ORIGIN, not per session, so a cached authenticated response is a
 *   response that can outlive a sign-out and be served to whoever uses the
 *   device next. This is why the fetch handler below bails out on anything
 *   that is not a same-origin GET for a static asset, and why Supabase and
 *   every /functions/, /rest/, /auth/ and /storage/ path is refused
 *   explicitly rather than by omission.
 *
 * NAVIGATION
 *   Network first. Homatch is not an offline product — a verification needs
 *   the backend — so a stale shell served ahead of a reachable network would
 *   only hide real failures. The cached shell is the fallback for a genuine
 *   offline navigation, so an installed app opens to something rather than
 *   to the browser's dinosaur.
 */

/* Stamped per BUILD (vite.config.ts replaces __BUILD__), not bumped by
   hand. A byte-identical worker across deploys meant an installed app
   never fired `updatefound` and could run a stale bundle until the person
   deleted and reinstalled it. Every deploy now: new worker installs, the
   shell precache refreshes, activate deletes every previous build's caches
   (the prefix check below), and the page offers a one-tap reload. */
const VERSION = 'homatch-__BUILD__';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

/* Enough to paint something when genuinely offline. Deliberately small: the
   real assets are fingerprinted and cached on first use instead. */
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/favicon.png', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        // Anything from a previous VERSION goes, so a bad cache cannot
        // outlive one deploy.
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

/** Paths that carry customer data and must always go to the network. */
function isPrivate(url) {
  return /\/(functions|rest|auth|storage|realtime)\//.test(url.pathname)
    || url.hostname.endsWith('.supabase.co');
}

/** Fingerprinted build output: safe to keep, because the name changes. */
function isImmutableAsset(url) {
  return url.origin === self.location.origin
    && (/^\/assets\//.test(url.pathname) || /^\/images\//.test(url.pathname));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // A cache can only ever answer a GET. Everything else — and every request
  // that carries credentials — goes straight to the network, untouched.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isPrivate(url)) return;
  if (url.origin !== self.location.origin) return;

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        // Only a good, basic response is worth keeping.
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(ASSETS).then((c) => c.put(request, copy));
        }
        return res;
      })),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((hit) => hit || Response.error())),
    );
  }
});

/* Lets the page tell a waiting worker to take over, so an update does not
   wait for every tab to close. The page asks; the worker never forces it
   mid-session, which would swap the bundle under a running form. */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  /* The language the site is open in (src/lib/swLanguage.ts): kept in the
     Cache API so it survives the worker being stopped between pushes. */
  if (event.data && event.data.type === 'HOMATCH_LANG' && PUSH_LANGS.includes(event.data.lang)) {
    event.waitUntil(caches.open(PREFS_CACHE).then((c) => c.put(LANG_URL, new Response(event.data.lang))).catch(() => {}));
  }
});

/* ── PUSH IN THE SITE'S LANGUAGE (owner 2026-10-24) ─────────────────────
   The server stores a notification's title in English; the in-app centre
   translates it, the phone did not. Typed notifications are drawn here from
   PUSH_COPY in the language the site was last open in; anything else keeps
   the server's text. */
const PREFS_CACHE = 'homatch-prefs';
const LANG_URL = '/__homatch/lang';
const PUSH_LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];
/* <push-copy> generated by scripts/sw-push-copy.mjs — do not edit by hand */
const PUSH_COPY = {
  "VERIFY_COMPLETE": {
    "en": [
      "Your verification is ready",
      "The report has finished and is ready to read."
    ],
    "ka": [
      "ქონების შემოწმება დასრულდა",
      "ანგარიში დასრულდა — შეგიძლიათ გაეცნოთ."
    ],
    "ru": [
      "Ваша проверка готова",
      "Отчёт готов — его можно открыть."
    ],
    "tr": [
      "Doğrulamanız hazır",
      "Rapor tamamlandı ve okunmaya hazır."
    ],
    "ar": [
      "التحقق الخاص بك جاهز",
      "اكتمل التقرير وهو جاهز للقراءة."
    ],
    "he": [
      "הבדיקה שלכם מוכנה",
      "הדוח הושלם ומוכן לקריאה."
    ]
  },
  "LOW_CREDITS": {
    "en": [
      "Your credits are running low",
      "You no longer have enough credits to open another result."
    ],
    "ka": [
      "თქვენი კრედიტები იწურება",
      "აღარ გაქვთ საკმარისი კრედიტი შემდეგი შედეგის გასახსნელად."
    ],
    "ru": [
      "Кредиты заканчиваются",
      "Кредитов больше не хватает, чтобы открыть ещё один матч."
    ],
    "tr": [
      "Krediniz azalıyor",
      "Başka bir eşleşmeyi açmak için yeterli krediniz kalmadı."
    ],
    "ar": [
      "رصيدك من النقاط على وشك النفاد",
      "لم يعد لديك رصيد كافٍ لفتح مطابقة أخرى."
    ],
    "he": [
      "הקרדיטים שלך אוזלים",
      "אין לך מספיק קרדיטים כדי לפתוח התאמה נוספת."
    ]
  },
  "RESEARCH_PRODUCT_PURCHASED": {
    "en": [
      "Research pack purchased",
      "Your research units are ready to use."
    ],
    "ka": [
      "კვლევის პაკეტი შეძენილია",
      "თქვენი კვლევის ერთეულები მზადაა გამოსაყენებლად."
    ],
    "ru": [
      "Пакет исследований куплен",
      "Ваши единицы исследований готовы к использованию."
    ],
    "tr": [
      "Araştırma paketi satın alındı",
      "Araştırma biriminiz kullanıma hazır."
    ],
    "ar": [
      "تم شراء حزمة الأبحاث",
      "وحدات الأبحاث جاهزة للاستخدام."
    ],
    "he": [
      "חבילת מחקר נרכשה",
      "יחידות המחקר שלך מוכנות לשימוש."
    ]
  },
  "PROPERTY_ACTION_REQUIRED": {
    "en": [
      "One of your properties needs something",
      "A search cannot start until it is done."
    ],
    "ka": [
      "თქვენს ერთ-ერთ ქონებას ყურადღება სჭირდება",
      "ამის გარეშე ძიება ვერ დაიწყება."
    ],
    "ru": [
      "Один из ваших объектов требует действия",
      "Пока это не сделано, поиск не начнётся."
    ],
    "tr": [
      "İlanlarınızdan biri bir şey bekliyor",
      "Bu yapılmadan arama başlayamaz."
    ],
    "ar": [
      "أحد عقاراتك يحتاج إلى إجراء",
      "لا يمكن بدء البحث قبل إتمامه."
    ],
    "he": [
      "אחד הנכסים שלכם מחכה למשהו",
      "חיפוש לא יוכל להתחיל לפני כן."
    ]
  },
  "SEARCH_COMPLETE": {
    "en": [
      "Your search has results",
      "New properties matching your plan were found."
    ],
    "ka": [
      "თქვენს ძიებას შედეგი აქვს",
      "იპოვნება ახალი ქონება, რომელიც თქვენს გეგმას ედარდება."
    ],
    "ru": [
      "По вашему поиску есть результаты",
      "Найдены новые объекты, подходящие под ваш запрос."
    ],
    "tr": [
      "Aramanız için sonuçlar var",
      "Planınıza uyan yeni ilanlar bulundu."
    ],
    "ar": [
      "هناك نتائج لبحثك",
      "عثرنا على عقارات جديدة تطابق خطتك."
    ],
    "he": [
      "יש תוצאות לחיפוש שלכם",
      "נמצאו נכסים חדשים שמתאימים לתוכנית שלכם."
    ]
  },
  "DOCUMENT_ANALYZED": {
    "en": [
      "Your document has been analysed",
      "The analysis is ready to read."
    ],
    "ka": [
      "ხელშეკრულების ანალიზი დასრულდა",
      "შენი დოკუმენტი მზად არის."
    ],
    "ru": [
      "Анализ документа завершён",
      "Результаты готовы."
    ],
    "tr": [
      "Belgenizin analizi tamamlandı",
      "Sonuçlar okunmaya hazır."
    ],
    "ar": [
      "اكتمل تحليل مستندك",
      "النتائج جاهزة للقراءة."
    ],
    "he": [
      "ניתוח המסמך הושלם",
      "התוצאות מוכנות לקריאה."
    ]
  }
};
/* </push-copy> */

async function siteLanguage() {
  try {
    const hit = await (await caches.open(PREFS_CACHE)).match(LANG_URL);
    const lang = hit ? (await hit.text()).trim() : '';
    return PUSH_LANGS.includes(lang) ? lang : null;
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   WEB PUSH

   WHY THE PAYLOAD IS TRUSTED BUT THE LINK IS NOT

   A push payload arrives encrypted to this device's own keys, so only a
   sender holding the VAPID private key could have produced it. That makes
   the CONTENT trustworthy. It does not make a URL inside it safe to open:
   an absolute URL in a notification is a redirect, and a redirect somebody
   else can aim is a phishing primitive. So `deep_link` is treated as a path
   on this origin and anything else is discarded.

   WHY A NOTIFICATION IS ALWAYS SHOWN

   Every browser that implements push requires `userVisibleOnly: true`, and
   enforces it: a push event that ends without showing a notification earns
   a "this site sent a background push" warning, and eventually the
   subscription is revoked. A malformed payload therefore still gets a
   notification — the product's name and a neutral line — rather than
   silence that costs the subscription.
   ══════════════════════════════════════════════════════════════════════ */

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    /* Not JSON. Handled by the fallbacks below rather than by giving up:
       see why a notification is always shown. */
  }

  const storedTitle = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title.slice(0, 120)
    : 'Homatch';
  const storedBody = typeof payload.body === 'string' ? payload.body.slice(0, 300) : '';

  /* A path on this origin, or nothing. */
  const link = typeof payload.deep_link === 'string'
    && payload.deep_link.startsWith('/')
    && !payload.deep_link.startsWith('//')
    ? payload.deep_link
    : '/';

  event.waitUntil(siteLanguage().then((lang) => {
  const copy = lang && typeof payload.type === 'string' && PUSH_COPY[payload.type] ? PUSH_COPY[payload.type][lang] : null;
  const title = copy ? copy[0] : storedTitle;
  const body = copy ? copy[1] : storedBody;
  return self.registration.showNotification(title, {
    body,
    lang: lang || undefined,
    dir: lang === 'ar' || lang === 'he' ? 'rtl' : 'auto',
    icon: '/icon-192.png',
    /* The status-bar icon: Android draws only its alpha channel, so a full-colour
       square showed as a plain white square. A white H on transparency shows the mark. */
    badge: '/badge-96.png',
    /* Collapses an aggregate: twelve match notifications with one group key
       replace each other rather than stacking twelve deep. */
    tag: typeof payload.group_key === 'string' ? payload.group_key.slice(0, 60) : undefined,
    renotify: Boolean(payload.group_key),
    data: { link, id: typeof payload.id === 'string' ? payload.id : null },
    requireInteraction: payload.priority === 'CRITICAL',
  });
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  const target = new URL(link, self.location.origin);
  /* Belt and braces: even a link that got this far cannot leave the origin. */
  if (target.origin !== self.location.origin) return;

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    /* Focus a tab that is already here rather than opening a fourth copy of
       the app, then navigate it. */
    for (const client of clients) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      await client.focus();
      if ('navigate' in client) await client.navigate(target.href).catch(() => {});
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});

/* The browser can retire a subscription on its own — a key rotation, a long
   silence, a user clearing site data. The page cannot hear about it, so the
   worker re-subscribes and lets the app reconcile on its next load. */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
  })());
});
