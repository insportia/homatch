// EMAIL DESIGNER — the built-in template library. Owner brief §7.
//
// Every template is a designer document, so it is fully editable block by block. Copy NEVER
// invents a fact: anything the sender must supply is a visible [placeholder] in square brackets,
// and the Campaign Risk Engine refuses to pass an email that still contains one
// (TEMPLATE_PLACEHOLDER), so a template cannot go out half-filled. Images start empty — no stock
// photo is passed off as the sender's property — and render nothing until the sender adds one.
//
// Copy ships in English, Georgian and Russian; Turkish, Arabic and Hebrew start from English and
// HOMI translates on request (the language selector in the wizard offers it).

import { type Block, createBlock, DEFAULT_THEME, DOC_VERSION, type EmailDoc, type Theme } from './document.ts';

export type TemplateKind =
  | 'ANNOUNCEMENT' | 'INVESTMENT' | 'INTRODUCTION' | 'NEWSLETTER' | 'PRODUCT_UPDATE' | 'EVENT' | 'TRANSACTIONAL' | 'FOLLOW_UP';
export const TEMPLATE_KINDS: TemplateKind[] = ['ANNOUNCEMENT', 'INVESTMENT', 'INTRODUCTION', 'NEWSLETTER', 'PRODUCT_UPDATE', 'EVENT', 'TRANSACTIONAL', 'FOLLOW_UP'];

type Lang = 'en' | 'ka' | 'ru';
type Copy = Record<string, string>;

const DARK: Theme = { ...DEFAULT_THEME, canvas: '#EFEAE2', card: '#FFFFFF', accent: '#C9973A', link: '#8A6420', fontFamily: 'system' };
const NAVY_HEADER = '#0C1119';

/* ── copy ─────────────────────────────────────────────────────────────────────────────────── */
const C: Record<TemplateKind, Record<Lang, Copy>> = {
  ANNOUNCEMENT: {
    en: { eyebrow: 'NEW LISTING', title: '[Property name] is now available', body: 'Dear {{first_name|there}},\n\nWe are pleased to present [property type] in [district, city]: [size] m², [number] bedrooms, [one or two standout features].\n\nThe price is [price]. Viewings can be arranged at a time that suits you.', cta: 'View the property', note: 'Details are provided by the owner and may change.' },
    ka: { eyebrow: 'ახალი განცხადება', title: '[ქონების დასახელება] უკვე ხელმისაწვდომია', body: 'გამარჯობა, {{first_name|}}!\n\nწარმოგიდგენთ [ქონების ტიპი] [უბანი, ქალაქი]-ში: [ფართი] მ², [რაოდენობა] საძინებელი, [ერთი-ორი გამორჩეული მახასიათებელი].\n\nფასი: [ფასი]. დათვალიერება შესაძლებელია თქვენთვის სასურველ დროს.', cta: 'ქონების ნახვა', note: 'ინფორმაცია მოწოდებულია მესაკუთრის მიერ და შეიძლება შეიცვალოს.' },
    ru: { eyebrow: 'НОВОЕ ПРЕДЛОЖЕНИЕ', title: '[Название объекта] уже доступен', body: 'Здравствуйте, {{first_name|}}!\n\nПредставляем [тип объекта] в [район, город]: [площадь] м², [количество] спальни, [одна-две особенности].\n\nЦена: [цена]. Просмотр — в удобное для вас время.', cta: 'Посмотреть объект', note: 'Сведения предоставлены владельцем и могут измениться.' },
  },
  INVESTMENT: {
    en: { eyebrow: 'INVESTMENT OPPORTUNITY', title: '[Project or property name]', body: 'Dear {{first_name|investor}},\n\n[Project or property name] in [location] is open to investors. Below are the facts as they stand today — please review them with your own advisor before deciding.', facts: 'Price from: [price]\nCompletion: [date or status]\nUnit types: [types]\nDeveloper: [developer name]', cta: 'Request the full information pack', note: 'This email is not financial advice. Past performance and projections do not guarantee future results.' },
    ka: { eyebrow: 'საინვესტიციო შესაძლებლობა', title: '[პროექტის ან ქონების დასახელება]', body: 'გამარჯობა, {{first_name|}}!\n\n[პროექტის ან ქონების დასახელება] [მდებარეობა]-ში ღიაა ინვესტორებისთვის. ქვემოთ მოცემულია მიმდინარე ფაქტები — გადაწყვეტილებამდე გთხოვთ, განიხილოთ ისინი თქვენს მრჩეველთან.', facts: 'ფასი: [ფასი]-დან\nდასრულება: [თარიღი ან სტატუსი]\nბინების ტიპები: [ტიპები]\nდეველოპერი: [დეველოპერის სახელი]', cta: 'სრული ინფორმაციის მოთხოვნა', note: 'ეს წერილი არ არის ფინანსური რჩევა. წარსული შედეგები და პროგნოზები მომავალ შემოსავალს არ იძლევა გარანტიას.' },
    ru: { eyebrow: 'ИНВЕСТИЦИОННАЯ ВОЗМОЖНОСТЬ', title: '[Название проекта или объекта]', body: 'Здравствуйте, {{first_name|}}!\n\n[Название проекта или объекта] в [местоположение] открыт для инвесторов. Ниже — факты на сегодня; пожалуйста, обсудите их со своим консультантом.', facts: 'Цена от: [цена]\nСдача: [дата или статус]\nТипы квартир: [типы]\nЗастройщик: [название]', cta: 'Запросить полную информацию', note: 'Это письмо не является финансовой рекомендацией. Прошлые результаты и прогнозы не гарантируют доход.' },
  },
  INTRODUCTION: {
    en: { eyebrow: 'INTRODUCTION', title: 'Hello from [your company]', body: 'Dear {{first_name|there}},\n\nMy name is [your name], [your role] at [your company]. We help [who you help] with [what you do] in [where].\n\nIf that is relevant to you, I would be glad to arrange a short call.', cta: 'Book a short call', note: '' },
    ka: { eyebrow: 'გაცნობა', title: 'გამარჯობა [თქვენი კომპანია]-სგან', body: 'გამარჯობა, {{first_name|}}!\n\nმე ვარ [თქვენი სახელი], [თანამდებობა] [თქვენი კომპანია]-ში. ვეხმარებით [ვის ეხმარებით] [რაში] [სად].\n\nთუ ეს თქვენთვის აქტუალურია, სიამოვნებით მოვაწყობ მოკლე ზარს.', cta: 'მოკლე ზარის დაჯავშნა', note: '' },
    ru: { eyebrow: 'ЗНАКОМСТВО', title: 'Здравствуйте от [ваша компания]', body: 'Здравствуйте, {{first_name|}}!\n\nМеня зовут [ваше имя], [должность] в [ваша компания]. Мы помогаем [кому] с [чем] в [где].\n\nЕсли это актуально, буду рад договориться о коротком звонке.', cta: 'Назначить звонок', note: '' },
  },
  NEWSLETTER: {
    en: { eyebrow: 'NEWSLETTER · [MONTH YEAR]', title: '[Newsletter headline]', body: 'Dear {{first_name|reader}},\n\n[Opening paragraph: what this issue covers.]', s1t: '[First story title]', s1: '[Two or three sentences.]', s2t: '[Second story title]', s2: '[Two or three sentences.]', cta: 'Read more', note: '' },
    ka: { eyebrow: 'სიახლეები · [თვე წელი]', title: '[სიახლეების სათაური]', body: 'გამარჯობა, {{first_name|}}!\n\n[შესავალი: რას მოიცავს ეს ნომერი.]', s1t: '[პირველი თემის სათაური]', s1: '[ორი-სამი წინადადება.]', s2t: '[მეორე თემის სათაური]', s2: '[ორი-სამი წინადადება.]', cta: 'დაწვრილებით', note: '' },
    ru: { eyebrow: 'НОВОСТИ · [МЕСЯЦ ГОД]', title: '[Заголовок выпуска]', body: 'Здравствуйте, {{first_name|}}!\n\n[Вступление: о чём этот выпуск.]', s1t: '[Заголовок первой темы]', s1: '[Два-три предложения.]', s2t: '[Заголовок второй темы]', s2: '[Два-три предложения.]', cta: 'Читать далее', note: '' },
  },
  PRODUCT_UPDATE: {
    en: { eyebrow: 'WHAT IS NEW', title: '[What changed]', body: 'Dear {{first_name|there}},\n\n[One paragraph: what is new and why it matters to the reader.]', facts: '• [First improvement]\n• [Second improvement]\n• [Third improvement]', cta: 'See what is new', note: '' },
    ka: { eyebrow: 'რა არის ახალი', title: '[რა შეიცვალა]', body: 'გამარჯობა, {{first_name|}}!\n\n[ერთი აბზაცი: რა არის ახალი და რატომ არის მნიშვნელოვანი.]', facts: '• [პირველი გაუმჯობესება]\n• [მეორე გაუმჯობესება]\n• [მესამე გაუმჯობესება]', cta: 'სიახლეების ნახვა', note: '' },
    ru: { eyebrow: 'ЧТО НОВОГО', title: '[Что изменилось]', body: 'Здравствуйте, {{first_name|}}!\n\n[Один абзац: что нового и почему это важно.]', facts: '• [Первое улучшение]\n• [Второе улучшение]\n• [Третье улучшение]', cta: 'Узнать подробнее', note: '' },
  },
  EVENT: {
    en: { eyebrow: 'INVITATION', title: '[Event name]', body: 'Dear {{first_name|there}},\n\nWe would be delighted to welcome you to [event name].', facts: 'Date: [date]\nTime: [time]\nPlace: [address]', cta: 'Reserve your place', note: 'Places are limited by the venue capacity.' },
    ka: { eyebrow: 'მოწვევა', title: '[ღონისძიების სახელი]', body: 'გამარჯობა, {{first_name|}}!\n\nსიამოვნებით გიმასპინძლებთ [ღონისძიების სახელი]-ზე.', facts: 'თარიღი: [თარიღი]\nდრო: [დრო]\nადგილი: [მისამართი]', cta: 'ადგილის დაჯავშნა', note: 'ადგილების რაოდენობა შეზღუდულია.' },
    ru: { eyebrow: 'ПРИГЛАШЕНИЕ', title: '[Название мероприятия]', body: 'Здравствуйте, {{first_name|}}!\n\nБудем рады видеть вас на [название мероприятия].', facts: 'Дата: [дата]\nВремя: [время]\nМесто: [адрес]', cta: 'Забронировать место', note: 'Количество мест ограничено.' },
  },
  TRANSACTIONAL: {
    en: { eyebrow: 'CONFIRMATION', title: 'Your [request] is confirmed', body: 'Dear {{first_name|there}},\n\nThis confirms your [request] with [your company].', facts: 'Reference: [reference]\nDate: [date]\nDetails: [details]', cta: 'View the details', note: 'Use this template only for messages the recipient asked for (confirmations, receipts), never for promotion.' },
    ka: { eyebrow: 'დადასტურება', title: 'თქვენი [მოთხოვნა] დადასტურებულია', body: 'გამარჯობა, {{first_name|}}!\n\nადასტურებთ თქვენს [მოთხოვნა]-ს [თქვენი კომპანია]-ში.', facts: 'ნომერი: [ნომერი]\nთარიღი: [თარიღი]\nდეტალები: [დეტალები]', cta: 'დეტალების ნახვა', note: 'გამოიყენეთ მხოლოდ მიმღების მიერ მოთხოვნილი შეტყობინებებისთვის, არა რეკლამისთვის.' },
    ru: { eyebrow: 'ПОДТВЕРЖДЕНИЕ', title: 'Ваш [запрос] подтверждён', body: 'Здравствуйте, {{first_name|}}!\n\nПодтверждаем ваш [запрос] в [ваша компания].', facts: 'Номер: [номер]\nДата: [дата]\nДетали: [детали]', cta: 'Посмотреть детали', note: 'Только для сообщений, которые получатель запросил сам, — не для рекламы.' },
  },
  FOLLOW_UP: {
    en: { eyebrow: '', title: 'Following up on [topic]', body: 'Dear {{first_name|there}},\n\nThank you for your interest in [topic]. [One sentence reminding them of the context.]\n\nWould [day or time] work for a short conversation? If it is no longer relevant, simply let me know.', cta: 'Reply to this email', note: '' },
    ka: { eyebrow: '', title: 'გაგრძელება: [თემა]', body: 'გამარჯობა, {{first_name|}}!\n\nგმადლობთ [თემა]-ით დაინტერესებისთვის. [ერთი წინადადება კონტექსტზე.]\n\nმოგიხერხდებათ მოკლე საუბარი [დღე ან დრო]? თუ აღარ არის აქტუალური, უბრალოდ შემატყობინეთ.', cta: 'პასუხის გაგზავნა', note: '' },
    ru: { eyebrow: '', title: 'По поводу [тема]', body: 'Здравствуйте, {{first_name|}}!\n\nСпасибо за интерес к [тема]. [Одно предложение о контексте.]\n\nУдобно ли вам коротко поговорить [день или время]? Если уже неактуально — просто дайте знать.', cta: 'Ответить на письмо', note: '' },
  },
};

/* ── layout ───────────────────────────────────────────────────────────────────────────────── */
const P = (t: number, r: number, b: number, l: number) => ({ t, r, b, l });

function header(eyebrow: string): Block[] {
  return [
    { ...createBlock('heading'), type: 'heading', text: 'HOMATCH', level: 3, align: 'left', color: '#E8C27A', fontSize: 14, fontWeight: 800, background: NAVY_HEADER, padding: P(22, 32, eyebrow ? 4 : 22, 32) } as Block,
    ...(eyebrow ? [{ ...createBlock('text'), type: 'text', text: eyebrow, align: 'left', color: '#B9A27A', fontSize: 11, fontWeight: 700, background: NAVY_HEADER, padding: P(0, 32, 22, 32) } as Block] : []),
  ];
}

function build(kind: TemplateKind, lang: Lang): EmailDoc {
  const c = C[kind][lang] ?? C[kind].en;
  const blocks: Block[] = [...header(c.eyebrow)];
  const push = (b: Block) => blocks.push(b);
  if (kind === 'ANNOUNCEMENT' || kind === 'INVESTMENT' || kind === 'EVENT') {
    push({ ...createBlock('image'), padding: P(0, 0, 0, 0), radius: 0, width: 600, alt: c.title } as Block);
  }
  push({ ...createBlock('heading'), type: 'heading', text: c.title, level: 1, align: 'left', padding: P(28, 32, 8, 32) } as Block);
  push({ ...createBlock('text'), type: 'text', text: c.body, align: 'left', padding: P(8, 32, 8, 32) } as Block);
  if (c.facts) {
    push({ ...createBlock('text'), type: 'text', text: c.facts, align: 'left', fontSize: 15, background: '#F7F3EC', borderWidth: 1, borderColor: '#EBE3D3', padding: P(16, 20, 16, 20) } as Block);
  }
  if (kind === 'NEWSLETTER') {
    push({ ...createBlock('divider'), padding: P(16, 32, 16, 32) } as Block);
    push({
      ...createBlock('columns'), type: 'columns', ratio: '50-50', stackOnMobile: true, gap: 20, padding: P(4, 32, 4, 32),
      columns: [
        [{ ...createBlock('heading'), type: 'heading', text: c.s1t, level: 3, align: 'left' }, { ...createBlock('text'), type: 'text', text: c.s1, align: 'left', fontSize: 15 }],
        [{ ...createBlock('heading'), type: 'heading', text: c.s2t, level: 3, align: 'left' }, { ...createBlock('text'), type: 'text', text: c.s2, align: 'left', fontSize: 15 }],
      ],
    } as Block);
  }
  if (kind !== 'FOLLOW_UP') {
    push({ ...createBlock('button'), type: 'button', label: c.cta, href: '', align: 'left', buttonColor: '#C9973A', textColor: '#0C1119', radius: 10, padding: P(16, 32, 16, 32) } as Block);
  }
  push({ ...createBlock('divider'), padding: P(16, 32, 8, 32) } as Block);
  push({ ...createBlock('contact'), type: 'contact', name: '[Your name]', email: '', phone: '', address: '', align: 'left', padding: P(8, 32, 8, 32) } as Block);
  if (c.note) push({ ...createBlock('footer'), type: 'footer', text: c.note, align: 'left', padding: P(4, 32, 20, 32) } as Block);
  else push({ ...createBlock('spacer'), type: 'spacer', height: 12 } as Block);
  return { version: DOC_VERSION, theme: { ...DARK }, blocks };
}

export function builtInTemplate(kind: TemplateKind, lang: string): EmailDoc {
  const l: Lang = lang === 'ka' || lang === 'ru' ? lang : 'en';
  return build(kind, l);
}

/** The subject a template suggests (the sender edits it). */
export function templateSubject(kind: TemplateKind, lang: string): string {
  const l: Lang = lang === 'ka' || lang === 'ru' ? lang : 'en';
  return (C[kind][l] ?? C[kind].en).title;
}

/** Visible [placeholders] the sender has not replaced yet (merge fields and links excluded). */
export function unfilledPlaceholders(text: string): string[] {
  return [...new Set([...String(text ?? '').matchAll(/\[([^\]\n]{2,60})\](?!\()/g)].map((m) => m[1]))];
}
