import {
  AlertTriangle, ArrowRight, Award, BadgeCheck, Banknote, BarChart3, Bell,
  Building2, Calculator, Calendar, Camera, CheckCircle2, Clock, Compass,
  CreditCard, Database, FileSearch, FileText, Filter, Gauge, Globe, Handshake,
  Home, Key, Landmark, Layers, LineChart, Lock, Mail, MapPin, MessageSquare,
  Phone, PieChart, Scale, Search, Send, ShieldCheck, Sparkles, Star, Target,
  TrendingUp, Users, Wallet, Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * THE ICONS AN ADMIN MAY CHOOSE FROM.
 *
 * A CURATED SET, NOT A FILE UPLOAD
 *
 * The obvious way to let somebody change an icon is to let them upload an
 * SVG. An SVG is a document: it can carry script, external references and
 * event handlers, and pasting one into a page is pasting markup into a page.
 * This product's whole content model is built on storing plain strings for
 * exactly that reason, and an icon slot should not be the one hole in it.
 *
 * So an icon choice is a NAME, resolved here against a fixed list. The worst
 * an admin can store is a name nothing matches, which renders the icon the
 * section ships. There is no input that reaches the DOM as markup.
 *
 * WHY THESE FORTY-FOUR
 *
 * They are the ones this product already draws with — the vocabulary of
 * property, verification, money, communication and analysis that the sections
 * were designed around. A set that includes everything would let an admin put
 * a birthday cake on a due-diligence report; a set drawn from the existing
 * design cannot produce a page that looks like a different product.
 */
export const ICON_SET: Readonly<Record<string, LucideIcon>> = {
  AlertTriangle, ArrowRight, Award, BadgeCheck, Banknote, BarChart3, Bell,
  Building2, Calculator, Calendar, Camera, CheckCircle2, Clock, Compass,
  CreditCard, Database, FileSearch, FileText, Filter, Gauge, Globe, Handshake,
  Home, Key, Landmark, Layers, LineChart, Lock, Mail, MapPin, MessageSquare,
  Phone, PieChart, Scale, Search, Send, ShieldCheck, Sparkles, Star, Target,
  TrendingUp, Users, Wallet, Zap,
};

/** Every name an admin may pick, in the order the picker shows them. */
export const ICON_NAMES: readonly string[] = Object.keys(ICON_SET);

export function isIconName(name: string): boolean {
  // Membership by list, not `in`: `'toString' in ICON_SET` is true, and an
  // admin storing "toString" must not resolve to something that is not an icon.
  return ICON_NAMES.includes(name);
}

/**
 * The component for a stored name, or the fallback the section ships.
 *
 * Never throws and never returns undefined: a page that stored an icon this
 * build no longer has must still render.
 */
export function iconFor(name: string | undefined, fallback: LucideIcon): LucideIcon {
  if (!name) return fallback;
  return ICON_SET[name] ?? fallback;
}
