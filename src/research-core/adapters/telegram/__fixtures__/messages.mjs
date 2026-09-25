// TELEGRAM FIXTURES — what the pipeline is tested against until credentials exist.
//
// Every message below is in the shape TelegramMessage declares, and the text
// in each is what somebody would actually type into a Tbilisi housing channel
// in that language — not an English sentence run through a translator, which
// would test the lexicon against its own assumptions rather than against the
// language.
//
// FIXTURES ARE EVIDENCE ABOUT THE CODE, NOT ABOUT TELEGRAM.
//
// Passing these proves the adapter, the normalizer, the dedup and the
// classifier behave. It proves nothing at all about whether Telegram will
// return this shape, because nobody here has ever called Telegram. That is
// why the readiness model keeps FIXTURE_TESTED and LIVE_TESTED apart, and why
// a green run of this file must never colour a provider row green.

const HOUR = 3600;
const DAY = 24 * HOUR;

/** Fixed, so every assertion about age means the same thing on every run. */
export const NOW_SECONDS = 1_790_000_000;
export const NOW_MS = NOW_SECONDS * 1000;

export const CHANNEL = {
  id: '-1001234567890',
  username: 'tbilisi_property',
  title: 'Tbilisi Property — ბინები თბილისში',
  kind: 'CHANNEL',
  participants: 18_400,
  // The channel has a discussion group, so its posts have comments.
  linkedChatId: '-1009876543210',
  publiclyReadable: true,
};

export const PRIVATE_CHANNEL = {
  id: '-1005555555555',
  username: 'closed_investors_ge',
  title: 'Closed Investors GE',
  kind: 'SUPERGROUP',
  participants: null,
  linkedChatId: null,
  publiclyReadable: false,
};

/** A channel with no discussion group: posts exist, comments cannot. */
export const NO_DISCUSSION_CHANNEL = {
  ...CHANNEL,
  id: '-1002222222222',
  username: 'ge_listings_only',
  title: 'GE Listings Only',
  linkedChatId: null,
};

function message(overrides) {
  return {
    id: '1',
    chatId: CHANNEL.id,
    date: NOW_SECONDS - HOUR,
    editDate: null,
    text: '',
    replyToMessageId: null,
    discussionOriginChatId: null,
    discussionOriginMessageId: null,
    authorUsername: null,
    authorDisplayName: null,
    fromChannel: false,
    views: null,
    ...overrides,
  };
}

/* ── supply: people with something ─────────────────────────────────────── */

export const GEORGIAN_SELLER = message({
  id: '101',
  date: NOW_SECONDS - 2 * HOUR,
  text: 'იყიდება 2 ოთახიანი ბინა ვაკეში, 68 კვ.მ, ფასი 165000 დოლარი. მესაკუთრე.',
  fromChannel: true,
  views: 3200,
});

export const GEORGIAN_LANDLORD = message({
  id: '102',
  date: NOW_SECONDS - 5 * HOUR,
  text: 'ქირავდება ბინა საბურთალოზე, 3 ოთახი, თვიური ქირა 1200 ლარი. გრძელვადიანი.',
  fromChannel: true,
});

export const BROKER_INVENTORY = message({
  id: '103',
  date: NOW_SECONDS - 6 * HOUR,
  // An agency posting inventory is perfectly good SUPPLY. It is only a
  // rejection on the demand side, where "we have clients looking" is a pitch.
  text: 'Our agency has 14 apartments for sale in Vake and Saburtalo. Contact us for the full list.',
  authorUsername: 'vake_realty',
  authorDisplayName: 'Vake Realty',
});

/* ── demand: people who want something ─────────────────────────────────── */

export const GEORGIAN_BUYER = message({
  id: '201',
  chatId: CHANNEL.linkedChatId,
  date: NOW_SECONDS - HOUR,
  text: 'ვეძებ საყიდლად 2 ოთახიან ბინას ვაკეში, ბიუჯეტი 150000 დოლარამდე.',
  replyToMessageId: '101',
  discussionOriginChatId: CHANNEL.id,
  discussionOriginMessageId: '101',
  authorUsername: 'nino_k',
  authorDisplayName: 'ნინო',
});

export const GEORGIAN_TENANT = message({
  id: '202',
  chatId: CHANNEL.linkedChatId,
  date: NOW_SECONDS - 3 * HOUR,
  text: 'ვეძებ ბინას ქირით საბურთალოზე, 2 ოთახი, ბიუჯეტი 900 ლარამდე თვეში.',
  replyToMessageId: '102',
  discussionOriginChatId: CHANNEL.id,
  discussionOriginMessageId: '102',
  authorDisplayName: 'Giorgi',
});

export const RUSSIAN_INVESTOR = message({
  id: '203',
  chatId: CHANNEL.linkedChatId,
  date: NOW_SECONDS - 4 * HOUR,
  text: 'Ищу квартиру в Тбилиси для инвестиций, интересует доходность от аренды. Бюджет до 120000 долларов.',
  replyToMessageId: '101',
  discussionOriginChatId: CHANNEL.id,
  discussionOriginMessageId: '101',
  authorUsername: 'dmitri_invest',
  authorDisplayName: 'Дмитрий',
});

export const HEBREW_INVESTOR = message({
  id: '204',
  chatId: CHANNEL.linkedChatId,
  date: NOW_SECONDS - 7 * HOUR,
  text: 'מחפש דירה להשקעה בטביליסי, מעוניין בתשואה משכירות. תקציב עד 150 אלף דולר.',
  authorDisplayName: 'Yossi',
});

export const ARABIC_INVESTOR = message({
  id: '205',
  chatId: CHANNEL.linkedChatId,
  date: NOW_SECONDS - 9 * HOUR,
  text: 'أبحث عن شقة للاستثمار في تبليسي، الميزانية حتى 130 ألف دولار.',
  authorDisplayName: 'Khaled',
});

export const TURKISH_BUYER = message({
  id: '206',
  chatId: CHANNEL.linkedChatId,
  date: NOW_SECONDS - 11 * HOUR,
  text: 'Tiflis\'te satılık daire arıyorum, yatırım için. Bütçem 140 bin dolar civarında.',
  authorDisplayName: 'Mehmet',
});

/* ── the awkward ones ──────────────────────────────────────────────────── */

export const IRRELEVANT = message({
  id: '301',
  chatId: CHANNEL.linkedChatId,
  date: NOW_SECONDS - HOUR,
  text: 'Does anyone know a good plumber near Rustaveli? Ours cancelled twice.',
  authorDisplayName: 'Ana',
});

/** Same message, scanned again, unchanged. Must not become a second lead. */
export const GEORGIAN_BUYER_AGAIN = { ...GEORGIAN_BUYER };

/**
 * Same message id, different text: the seller marked it sold.
 *
 * This is the case that separates identity from fingerprint. It is the SAME
 * signal saying something new, and a re-scan must report it as changed rather
 * than as a second listing at a second price.
 */
export const GEORGIAN_SELLER_EDITED = message({
  ...GEORGIAN_SELLER,
  text: 'იყიდება 2 ოთახიანი ბინა ვაკეში, 68 კვ.მ, ფასი 165000 დოლარი. გაიყიდა.',
  editDate: NOW_SECONDS - 30 * 60,
});

/**
 * A DIFFERENT message carrying identical text — the same listing
 * cross-posted into a second channel, which is routine on Telegram. One
 * lead, not two.
 */
export const CROSSPOSTED_SELLER = message({
  ...GEORGIAN_SELLER,
  id: '999',
  chatId: NO_DISCUSSION_CHANNEL.id,
  date: NOW_SECONDS - HOUR,
});

/** Eleven months old. Real, and not a live lead. */
export const STALE_BUYER = message({
  id: '401',
  chatId: CHANNEL.linkedChatId,
  date: NOW_SECONDS - 330 * DAY,
  text: 'ვეძებ საყიდლად ბინას ვაკეში, ბიუჯეტი 150000 დოლარამდე.',
  authorDisplayName: 'Old Post',
});

/** A photo with no caption, and a service message. Neither is evidence. */
export const EMPTY_MESSAGES = [
  message({ id: '501', text: '' }),
  message({ id: '502', text: '   ' }),
];

/** Telegram returning something that is not the documented shape. */
export const MALFORMED = [
  null,
  undefined,
  { id: '601' },
  { id: '602', chatId: CHANNEL.id, text: 42, date: 'yesterday' },
  { id: '603', chatId: CHANNEL.id, text: 'ვეძებ ბინას', date: null },
];

/** The same person, in three messages. One entity, three pieces of evidence. */
export const SAME_ENTITY_THREE_TIMES = [
  message({
    id: '701',
    chatId: CHANNEL.linkedChatId,
    date: NOW_SECONDS - 3 * DAY,
    text: 'Ищу квартиру в Тбилиси, 2 комнаты, до 120000 долларов.',
    authorUsername: 'dmitri_invest',
    authorDisplayName: 'Дмитрий',
  }),
  message({
    id: '702',
    chatId: CHANNEL.linkedChatId,
    date: NOW_SECONDS - 2 * DAY,
    text: 'Может кто-то посоветует район в Тбилиси для покупки квартиры?',
    authorUsername: 'dmitri_invest',
    authorDisplayName: 'Дмитрий',
  }),
  message({
    id: '703',
    chatId: CHANNEL.linkedChatId,
    date: NOW_SECONDS - HOUR,
    text: 'Ищу квартиру в Тбилиси для инвестиций, бюджет до 120000.',
    authorUsername: 'dmitri_invest',
    authorDisplayName: 'Дмитрий',
  }),
];

/** Two pages of history, so pagination is exercised rather than assumed. */
export const PAGE_ONE = [GEORGIAN_SELLER, GEORGIAN_LANDLORD];
export const PAGE_TWO = [BROKER_INVENTORY];

export const COMMENTS_ON_101 = [GEORGIAN_BUYER, RUSSIAN_INVESTOR];
export const COMMENTS_ON_102 = [GEORGIAN_TENANT];

export const ALL_DEMAND = [
  GEORGIAN_BUYER,
  GEORGIAN_TENANT,
  RUSSIAN_INVESTOR,
  HEBREW_INVESTOR,
  ARABIC_INVESTOR,
  TURKISH_BUYER,
];

export const ALL_SUPPLY = [GEORGIAN_SELLER, GEORGIAN_LANDLORD, BROKER_INVENTORY];
