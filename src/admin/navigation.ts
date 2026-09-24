// HOMATCH Admin — one description of where everything lives.
//
// WHY THIS FILE EXISTS
//
// The sidebar used to be a flat list of twenty-six links, written in the
// vocabulary of the people who built the product: Sources, Signals,
// Providers, Voice AI, Verify COGS, Spend Caps. Somebody who wants to
// change the voice the assistant speaks with had to already know that the
// control was inside Settings, below a routing panel, under the heading
// "Communications". The functionality was there. It was not findable.
//
// So navigation is data now, and this is the data. The sidebar renders
// it, the search searches it, and the redirect table is derived from it —
// which means a destination cannot appear in one and be missing from
// another, and a page cannot quietly stop being reachable.
//
// THE GROUPING RULE
//
// Group by what somebody WANTS TO DO, never by which service implements
// it. "I want to change the AI voice" is a communication task, so Voice
// sits under AI & communication next to Email and WhatsApp — not under a
// heading called Providers, which is the answer to a different question.
//
// THE SEARCH KEYWORD RULE
//
// `keywords` is the opposite: it is deliberately full of jargon. A reader
// who knows the word "Cartesia", "TTS", "Vapi" or "Resend" should land on
// the right page by typing it, even though none of those words appears in
// the navigation itself. Knowing the jargon must not be REQUIRED; knowing
// it must still WORK.

import {Activity, AudioLines, BadgeDollarSign,BarChart3,Bell,Building2, CreditCard,Gauge, Globe, HardDrive, HeartPulse, 
  LayoutDashboard, Mail,
  MessageCircle, MessageSquareWarning, 
  Paintbrush, PhoneCall, Puzzle, Radio, 
  Receipt, Send, Server, Settings2, ShieldAlert, ShieldCheck, SlidersHorizontal, 
  Type, UserSearch, Users, Wrench, Zap, 
} from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';

export interface AdminDestination {
  path: string;
  labelKey: TranslationKey;
  icon: typeof Users;
  /**
   * Extra words that should find this page.
   *
   * Lower case, matched as substrings. Provider and implementation names
   * belong here and nowhere else in the navigation.
   */
  keywords: string[];
}

export interface AdminGroup {
  id: string;
  labelKey: TranslationKey;
  icon: typeof Users;
  /** Where clicking the group itself goes. Always the first destination. */
  items: AdminDestination[];
}

export const ADMIN_GROUPS: AdminGroup[] = [
  {
    id: 'overview',
    labelKey: 'admin_group_overview',
    icon: LayoutDashboard,
    items: [
      {
        path: '/admin', labelKey: 'admin_nav_home', icon: LayoutDashboard,
        keywords: ['home', 'control', 'status', 'dashboard', 'start', 'attention'],
      },
      {
        path: '/admin/metrics', labelKey: 'admin_nav_metrics', icon: BarChart3,
        keywords: ['metrics', 'stats', 'platform', 'overview', 'revenue', 'margin', 'kpi'],
      },
    ],
  },
  {
    id: 'users',
    labelKey: 'admin_group_users',
    icon: Users,
    items: [
      {
        path: '/admin/users', labelKey: 'admin_nav_users', icon: Users,
        keywords: ['user', 'account', 'admin', 'ban', 'plan', 'role'],
      },
      {
        path: '/admin/user360', labelKey: 'admin_nav_user360', icon: UserSearch,
        keywords: ['user 360', 'lookup', 'find a user', 'impersonate', 'history'],
      },
    ],
  },
  {
    id: 'property',
    labelKey: 'admin_group_property',
    icon: Building2,
    items: [
      {
        path: '/admin/properties', labelKey: 'admin_nav_properties', icon: Building2,
        keywords: ['property', 'listing', 'import', 'inventory'],
      },
      {
        path: '/admin/campaigns', labelKey: 'admin_nav_campaigns', icon: Zap,
        keywords: ['campaign', 'matching run', 'search'],
      },
      {
        path: '/admin/matches', labelKey: 'admin_nav_matches', icon: Puzzle,
        keywords: ['match', 'unlock', 'result'],
      },
      {
        path: '/admin/markets', labelKey: 'admin_nav_markets', icon: Globe,
        keywords: ['market', 'city', 'country', 'region'],
      },
      {
        path: '/admin/sources', labelKey: 'admin_nav_sources', icon: Radio,
        keywords: ['source', 'crawler', 'portal', 'discovery', 'dataforseo', 'serp'],
      },
      {
        path: '/admin/signals', labelKey: 'admin_nav_signals', icon: Activity,
        keywords: ['signal', 'intent', 'raw', 'qualified', 'classifier'],
      },
    ],
  },
  {
    id: 'comms',
    labelKey: 'admin_group_comms',
    icon: AudioLines,
    items: [
      {
        path: '/admin/communication', labelKey: 'admin_nav_comms_overview', icon: AudioLines,
        keywords: ['communication', 'ai', 'channels', 'overview'],
      },
      {
        path: '/admin/communication/voice', labelKey: 'admin_nav_voice', icon: AudioLines,
        keywords: [
          'voice', 'ai talk', 'aitalk', 'mariam', 'speak', 'speech', 'sound',
          'cartesia', 'tts', 'voice id', 'speed', 'accent', 'audio',
        ],
      },
      {
        path: '/admin/communication/call-center', labelKey: 'admin_nav_call_center', icon: PhoneCall,
        keywords: [
          'call', 'phone', 'calling', 'call center', 'callcentre', 'agent',
          'vapi', 'telephony', 'number', 'recording', 'outbound', 'inbound',
        ],
      },
      {
        path: '/admin/communication/email', labelKey: 'admin_nav_email', icon: Mail,
        keywords: ['email', 'mail', 'inbox', 'reply', 'resend', 'smtp', 'sender', 'webhook', 'mx'],
      },
      {
        path: '/admin/communication/whatsapp', labelKey: 'admin_nav_whatsapp', icon: MessageCircle,
        keywords: ['whatsapp', 'wa', 'meta', 'template', 'business number', 'messaging'],
      },
      {
        path: '/admin/communication/usage', labelKey: 'admin_nav_comms_usage', icon: Gauge,
        keywords: ['usage', 'cost', 'spend', 'minutes', 'tokens', 'consumption', 'cogs'],
      },
      {
        path: '/admin/communication/advanced', labelKey: 'admin_nav_comms_advanced', icon: SlidersHorizontal,
        keywords: [
          'advanced', 'stt', 'speech recognition', 'deepgram', 'elevenlabs',
          'pronunciation', 'vocabulary', 'personality', 'failover', 'routing',
          'voice library', 'audition', 'latency', 'model', 'brain',
        ],
      },
      {
        path: '/admin/outreach', labelKey: 'admin_nav_outreach', icon: Send,
        keywords: ['outreach', 'campaign performance', 'observability', 'sends', 'delivery'],
      },
      {
        path: '/admin/live-chat-reports', labelKey: 'admin_livechat_title', icon: MessageSquareWarning,
        keywords: ['live chat', 'chat report', 'abuse', 'moderation'],
      },
      {
        path: '/admin/risk', labelKey: 'admin_nav_risk', icon: ShieldAlert,
        keywords: ['risk', 'compliance', 'approval', 'review', 'blocked campaign'],
      },
    ],
  },
  {
    id: 'money',
    labelKey: 'admin_group_money',
    icon: BadgeDollarSign,
    items: [
      {
        path: '/admin/finance', labelKey: 'admin_nav_finance', icon: BadgeDollarSign,
        keywords: ['finance', 'revenue', 'profit', 'margin', 'report', 'cost'],
      },
      {
        path: '/admin/credits', labelKey: 'admin_nav_credits', icon: CreditCard,
        keywords: ['credit', 'wallet', 'balance', 'topup', 'grant'],
      },
      {
        path: '/admin/payments', labelKey: 'admin_nav_payments', icon: Receipt,
        keywords: ['payment', 'invoice', 'stripe', 'charge', 'refund'],
      },
      {
        path: '/admin/pricing', labelKey: 'admin_nav_pricing', icon: Settings2,
        keywords: ['pricing', 'price', 'plan', 'tariff', 'simulator', 'catalogue'],
      },
      {
        path: '/admin/spend-caps', labelKey: 'admin_nav_spend_caps', icon: ShieldAlert,
        keywords: ['spend cap', 'limit', 'budget', 'ceiling', 'provider spend'],
      },
      {
        path: '/admin/verify-cogs', labelKey: 'admin_nav_verify_cogs', icon: ShieldCheck,
        keywords: ['verify', 'cogs', 'cost of goods', 'verification cost'],
      },
    ],
  },
  {
    id: 'website',
    labelKey: 'admin_group_website',
    icon: Paintbrush,
    items: [
      {
        path: '/admin/site-studio', labelKey: 'studio_title', icon: Paintbrush,
        keywords: ['site studio', 'landing', 'page', 'design', 'homepage'],
      },
      {
        path: '/admin/app-content', labelKey: 'admin_nav_content', icon: Type,
        keywords: ['content', 'copy', 'text', 'wording', 'override'],
      },
      {
        path: '/admin/sponsored', labelKey: 'admin_nav_sponsored', icon: Activity,
        keywords: ['sponsored', 'placement', 'promoted', 'advert'],
      },
      {
        path: '/admin/engagement', labelKey: 'admin_nav_engagement', icon: Bell,
        keywords: ['engagement', 'push', 'notification', 'pwa', 'reminder'],
      },
    ],
  },
  {
    id: 'system',
    labelKey: 'admin_group_system',
    icon: Server,
    items: [
      {
        path: '/admin/health', labelKey: 'admin_nav_health', icon: HeartPulse,
        keywords: ['health', 'status', 'uptime', 'system'],
      },
      {
        path: '/admin/providers', labelKey: 'admin_nav_providers', icon: Server,
        keywords: [
          'provider', 'routing', 'credential', 'kill switch', 'api key',
          'cartesia', 'vapi', 'meta', 'resend', 'elevenlabs', 'openai',
        ],
      },
      {
        path: '/admin/diagnostics', labelKey: 'admin_nav_diagnostics', icon: Wrench,
        keywords: ['diagnostics', 'import', 'debug', 'trace', 'error'],
      },
      {
        path: '/admin/storage', labelKey: 'admin_nav_storage', icon: HardDrive,
        keywords: ['storage', 'file', 'bucket', 'upload', 'object'],
      },
      {
        path: '/admin/settings', labelKey: 'admin_nav_settings', icon: SlidersHorizontal,
        keywords: ['settings', 'configuration', 'flag', 'toggle', 'admin settings'],
      },
    ],
  },
];

/** Every destination, flattened, in sidebar order. */
export const ADMIN_DESTINATIONS: AdminDestination[] = ADMIN_GROUPS.flatMap((g) => g.items);

/**
 * Where an old bookmark should land.
 *
 * Only paths whose page MOVED are here. Everything else kept its URL, and
 * a redirect for an unmoved page would be a second name for one thing.
 */
export const ADMIN_REDIRECTS: Record<string, string> = {
  /* The metrics dashboard that used to be the front door. */
  '/admin/overview': '/admin/metrics',
  /* Eleven tabs of speech tooling, now the Advanced section of the
     communication centre. The voice itself is no longer in here. */
  '/admin/voice-ai': '/admin/communication/advanced',
  /* Guesses somebody might reasonably type. */
  '/admin/comms': '/admin/communication',
  '/admin/communications': '/admin/communication',
  '/admin/ai': '/admin/communication',
  '/admin/voice': '/admin/communication/voice',
  '/admin/email': '/admin/communication/email',
  '/admin/whatsapp': '/admin/communication/whatsapp',
  '/admin/call-center': '/admin/communication/call-center',
};

/** The group a path belongs to, for highlighting the sidebar. */
export function groupForPath(pathname: string): AdminGroup | null {
  let best: { group: AdminGroup; length: number } | null = null;
  for (const group of ADMIN_GROUPS) {
    for (const item of group.items) {
      const exact = pathname === item.path;
      const nested = item.path !== '/admin' && pathname.startsWith(`${item.path}/`);
      if ((exact || nested) && (!best || item.path.length > best.length)) {
        best = { group, length: item.path.length };
      }
    }
  }
  return best?.group ?? null;
}

/** The destination a path is on, by longest match. */
export function destinationForPath(pathname: string): AdminDestination | null {
  let best: AdminDestination | null = null;
  for (const item of ADMIN_DESTINATIONS) {
    const exact = pathname === item.path;
    const nested = item.path !== '/admin' && pathname.startsWith(`${item.path}/`);
    if ((exact || nested) && (!best || item.path.length > best.path.length)) best = item;
  }
  return best;
}

/**
 * Find destinations by what somebody typed.
 *
 * Matches the translated label first, then the keywords, so "Cartesia"
 * reaches Voice even though the word Cartesia is not in the navigation.
 * Returns at most `limit`, best match first.
 */
export function searchAdmin(
  query: string,
  label: (key: TranslationKey) => string,
  limit = 8,
): Array<{ item: AdminDestination; group: AdminGroup }> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<{ item: AdminDestination; group: AdminGroup; score: number }> = [];
  for (const group of ADMIN_GROUPS) {
    for (const item of group.items) {
      const name = label(item.labelKey).toLowerCase();
      const groupName = label(group.labelKey).toLowerCase();
      let score = 0;
      if (name === q) score = 100;
      else if (name.startsWith(q)) score = 80;
      else if (name.includes(q)) score = 60;
      else if (item.keywords.some((k) => k === q)) score = 50;
      else if (item.keywords.some((k) => k.startsWith(q))) score = 40;
      else if (item.keywords.some((k) => k.includes(q))) score = 30;
      else if (groupName.includes(q)) score = 10;
      if (score > 0) scored.push({ item, group, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ item, group }) => ({ item, group }));
}

/*
 * KNOWN DEFECT — SITE STUDIO HAS TOO LITTLE ROOM TO PREVIEW A DESKTOP.
 *
 * Site Studio is an editor nested inside this sidebar. Measured at a 1920px
 * viewport, its preview iframe is x=568 width=976 -- below the 1024px the
 * public site needs before it renders desktop navigation. So the preview
 * correctly shows the tablet layout, and an owner on a large monitor cannot
 * click the navigation labels they opened Site Studio to edit.
 *
 * The sidebar reached w-64/lg:w-72 in the Admin redesign because group labels
 * such as "Properties & matching" were being truncated. Both are real; they
 * are in tension, and the resolution is the editor taking the full width,
 * which changes preview geometry enough that the Studio regression suite has
 * to be re-verified as a whole. That belongs with the Site Studio work rather
 * than bolted on here, so this is recorded and not silently left unnoticed.
 *
 * Reproduce: tests/studio/blocks.test.mjs, "the navigation and footer are
 * edited once, for the whole site".
 */
