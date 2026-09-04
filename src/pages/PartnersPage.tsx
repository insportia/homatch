import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import {
  Building2, Users, Banknote, Globe2, CheckCircle2, Mail,
  ArrowRight, Shield, BarChart2, Target, Zap, Loader2,
} from 'lucide-react';

// Content lives in translation keys, resolved at render time via t() —
// only the icon and key names are static here.
const PARTNER_CATEGORIES = [
  {
    icon: Building2,
    titleKey: 'partners_cat1_title',
    descKey: 'partners_cat1_desc',
    placementKeys: ['partners_cat1_p1', 'partners_cat1_p2', 'partners_cat1_p3'],
  },
  {
    icon: Users,
    titleKey: 'partners_cat2_title',
    descKey: 'partners_cat2_desc',
    placementKeys: ['partners_cat2_p1', 'partners_cat2_p2', 'partners_cat2_p3'],
  },
  {
    icon: Banknote,
    titleKey: 'partners_cat3_title',
    descKey: 'partners_cat3_desc',
    placementKeys: ['partners_cat3_p1', 'partners_cat3_p2', 'partners_cat3_p3'],
  },
  {
    icon: Globe2,
    titleKey: 'partners_cat4_title',
    descKey: 'partners_cat4_desc',
    placementKeys: ['partners_cat4_p1', 'partners_cat4_p2', 'partners_cat4_p3'],
  },
];

const PLACEMENT_RULES = [
  { icon: Shield,    textKey: 'partners_rule1' },
  { icon: BarChart2, textKey: 'partners_rule2' },
  { icon: Target,    textKey: 'partners_rule3' },
  { icon: Zap,       textKey: 'partners_rule4' },
];

export default function PartnersPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error(t('partners_email_required_error'));
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from('partner_inquiries').insert({
        company: company.trim() || null,
        email: email.trim(),
        category: category || null,
        message: message.trim() || null,
      });
      if (error) throw error;
      toast.success(t('partners_submit_success'));
      setCompany('');
      setEmail('');
      setCategory('');
      setMessage('');
    } catch (err) {
      console.error(err);
      toast.error(t('partners_submit_error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <section className="relative border-b border-border py-16 px-4">
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <Badge variant="secondary" className="border-primary/30 text-primary bg-primary/10 mb-2">
            {t('partners_badge')}
          </Badge>
          <h1 className="text-3xl md:text-4xl font-bold text-foreground tracking-tight">
            {t('partners_hero_title')}
          </h1>
          <p className="text-base text-muted-foreground max-w-xl mx-auto">
            {t('partners_hero_desc')}
          </p>
          <div className="flex flex-col md:flex-row gap-3 justify-center pt-2">
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
              onClick={() => document.getElementById('inquiry')?.scrollIntoView({ behavior: 'smooth' })}>
              {t('partners_cta_contact')} <ArrowRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" className="border-border gap-2"
              onClick={() => navigate('/verify')}>
              <Shield className="h-4 w-4" /> {t('partners_cta_verify')}
            </Button>
          </div>
        </div>
      </section>

      {/* Transparency rules */}
      <section className="py-10 px-4 border-b border-border bg-card/30">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-5 text-center">
            {t('partners_principles_heading')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PLACEMENT_RULES.map(({ icon: Icon, textKey }) => (
              <div key={textKey} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card">
                <Icon className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground">{t(textKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Partner categories */}
      <section className="py-12 px-4 border-b border-border">
        <div className="max-w-3xl mx-auto space-y-6">
          <h2 className="text-xl font-bold text-foreground text-center">{t('partners_categories_heading')}</h2>
          <div className="space-y-4">
            {PARTNER_CATEGORIES.map(({ icon: Icon, titleKey, descKey, placementKeys }) => (
              <Card key={titleKey} className="border-border bg-card">
                <CardContent className="pt-5 pb-5">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground text-sm mb-1">{t(titleKey)}</h3>
                      <p className="text-sm text-muted-foreground mb-3">{t(descKey)}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {placementKeys.map(pKey => (
                          <Badge key={pKey} variant="secondary" className="text-[10px] border-border">
                            <CheckCircle2 className="h-2.5 w-2.5 mr-1 text-primary" />{t(pKey)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Inquiry form */}
      <section id="inquiry" className="py-12 px-4">
        <div className="max-w-xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-xl font-bold text-foreground mb-2">{t('partners_inquiry_heading')}</h2>
            <p className="text-sm text-muted-foreground">{t('partners_inquiry_subheading')}</p>
          </div>
          <Card className="border-border bg-card">
            <form onSubmit={handleSubmit}>
              <CardContent className="pt-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">{t('partners_company_label')}</label>
                    <input value={company} onChange={(e) => setCompany(e.target.value)} className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary" placeholder={t('partners_company_ph')} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">{t('partners_email_label')}</label>
                    <input type="email" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary" placeholder={t('partners_email_ph')} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">{t('partners_category_label')}</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
                    <option value="">{t('partners_category_ph')}</option>
                    <option>{t('partners_cat_option_developer')}</option>
                    <option>{t('partners_cat_option_agency')}</option>
                    <option>{t('partners_cat_option_mortgage')}</option>
                    <option>{t('partners_cat_option_relocation')}</option>
                    <option>{t('partners_cat_option_other')}</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">{t('partners_message_label')}</label>
                  <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary resize-none" placeholder={t('partners_message_ph')} />
                </div>
                <Button type="submit" disabled={submitting} className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} {t('partners_send_btn')}
                </Button>
                <p className="text-[10px] text-muted-foreground/60 text-center">
                  {t('partners_disclaimer')}
                </p>
              </CardContent>
            </form>
          </Card>
        </div>
      </section>
    </div>
  );
}
