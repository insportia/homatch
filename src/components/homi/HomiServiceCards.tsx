import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, BadgeCheck, FileText, Landmark, Megaphone, MessageCircle, Plane, Search, ShieldCheck, Sparkles, TrendingUp, Users,
  type LucideIcon,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  parseServiceActions, routeForAction, SERVICE_ACTION_SERVICE, type ServiceAction, type ServiceActionId,
} from '@/lib/ai/serviceActions';
import { pitchKeys, type PitchableService } from '@/lib/homi/pitch';
import { useServiceControls, type ServiceKey } from '@/lib/serviceControls';

/*
 * HOMATCH SERVICES INSIDE A HOMI ANSWER.
 *
 * A card per service the answer touched: icon, name, what it does for the
 * person, and a gold arrow. It NAVIGATES to the real product (routes come
 * from the code catalogue in lib/ai/serviceActions.ts, never from the model)
 * and never sends a message or spends anything: the product's own screen
 * states any price. A paused product (Admin → Service Control Center) shows
 * no card.
 *
 * The service note (pitch) is HOMATCH's own reviewed copy for a service the
 * model chose, at most once per service per conversation (lib/homi/pitch.ts).
 */

const ICON: Record<ServiceActionId, LucideIcon> = {
  VERIFY: ShieldCheck,
  CONTRACT_INTELLIGENCE: FileText,
  INVESTMENT: TrendingUp,
  MORTGAGE: Landmark,
  FIND_PROPERTY: Search,
  FIND_BUYERS_TENANTS: Users,
  BROKERS: BadgeCheck,
  META_ADS: Megaphone,
  FOR_EXPATS: Plane,
  CONTACT: MessageCircle,
};

export interface HomiServiceContext {
  /** The person's own words, carried to Find Property as a starting brief (router state, never the URL). */
  findQuery?: string | null;
  propertyId?: string | null;
}

function useOpenService(context: HomiServiceContext) {
  const navigate = useNavigate();
  return (action: ServiceAction) => {
    if (action.id === 'FIND_PROPERTY' && context.findQuery) {
      navigate('/find-property/new', { state: { homiQuery: context.findQuery.slice(0, 500) } });
      return;
    }
    navigate(routeForAction(action, { propertyId: context.propertyId ?? null }));
  };
}

function useLive(ids: ServiceActionId[]): ServiceAction[] {
  const { services } = useServiceControls();
  return parseServiceActions(ids).filter((a) => {
    const key = SERVICE_ACTION_SERVICE[a.id];
    return !key || services[key as ServiceKey]?.frontend !== false;
  });
}

export function HomiServiceCards({ services, context, className }: {
  services: ServiceActionId[];
  context: HomiServiceContext;
  className?: string;
}) {
  const { t } = useLanguage();
  const open = useOpenService(context);
  const live = useLive(services);
  if (!live.length) return null;
  return (
    <div className={cn('grid gap-2', live.length > 1 && 'sm:grid-cols-2', className)} data-homi-services>
      {live.map((action) => {
        const Icon = ICON[action.id];
        return (
          <button
            key={action.id}
            type="button"
            onClick={() => open(action)}
            className="group flex w-full min-w-0 items-center gap-3 rounded-2xl border border-[hsl(var(--gold-border))] bg-card p-3 text-start shadow-card transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-[hsl(38_92%_56%)] hover:shadow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#0C1119] ring-1 ring-inset ring-[hsl(38_92%_56%)]/40">
              <Icon className="h-5 w-5 text-[hsl(38_92%_60%)]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block break-words text-[15px] font-semibold leading-snug text-foreground">{t(action.labelKey as never)}</span>
              <span className="mt-0.5 block break-words text-[13px] leading-snug text-muted-foreground">{t(`homi_svc_${action.id.toLowerCase()}_desc` as never)}</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))] transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

export function HomiPitchCard({ pitch, context, className }: {
  pitch: PitchableService;
  context: HomiServiceContext;
  className?: string;
}) {
  const { t } = useLanguage();
  const open = useOpenService(context);
  const [action] = useLive([pitch]);
  if (!action) return null;
  const keys = pitchKeys(pitch);
  return (
    <aside
      className={cn('overflow-hidden rounded-2xl bg-[#0C1119] p-4 text-white shadow-card ring-1 ring-inset ring-[hsl(38_92%_56%)]/40', className)}
      data-homi-pitch={pitch}
      aria-label={t(keys.title as never)}
    >
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[hsl(38_92%_62%)]">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        {t('homi_pitch_eyebrow')}
      </p>
      <p className="mt-1.5 text-base font-semibold leading-snug">{t(keys.title as never)}</p>
      <p className="mt-1 text-sm leading-relaxed text-white/80">{t(keys.body as never)}</p>
      <button
        type="button"
        onClick={() => open(action)}
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-[hsl(38_92%_54%)] px-4 text-sm font-semibold text-[#161309] transition-colors hover:bg-[hsl(38_92%_60%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        {t('homi_pitch_cta')}
        <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
      </button>
    </aside>
  );
}
