import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Building2, Users, Banknote, Globe2, CheckCircle2, Mail,
  ArrowRight, Shield, BarChart2, Target, Zap,
} from 'lucide-react';

const PARTNER_CATEGORIES = [
  {
    icon: Building2,
    title: 'Real Estate Developers',
    desc: 'Feature your projects on Homatch with verified Trust Scores. Reach active buyers and renters at the moment of decision.',
    placements: ['Featured Project on Homepage', 'Sponsored in Search Results', 'Developer Trust Profile Boost'],
  },
  {
    icon: Users,
    title: 'Agencies & Brokers',
    desc: 'Promote your listings and agency profile to verified property seekers across Tbilisi, Batumi and beyond.',
    placements: ['Sponsored Listings in Results', 'Agency Spotlight Card', 'Premium Match Placement'],
  },
  {
    icon: Banknote,
    title: 'Mortgage & Finance',
    desc: 'Connect with qualified buyers at the verification and matching stage — when financing decisions are made.',
    placements: ['Mortgage Calculator Widget', 'Property Detail Sidebar', 'Verification Center Banner'],
  },
  {
    icon: Globe2,
    title: 'Relocation, Legal & Services',
    desc: 'Offer your services to relocating buyers, legal review clients and property service seekers.',
    placements: ['Services Panel in Property Detail', 'AI Assistant Recommendations', 'Onboarding Placement'],
  },
];

const PLACEMENT_RULES = [
  { icon: Shield,   text: 'Every sponsored placement shows a visible "Sponsored" or "Ad" label' },
  { icon: BarChart2, text: 'Sponsored status NEVER affects Trust Score, Match Score or organic ranking' },
  { icon: Target,   text: 'Target by market, language and date range' },
  { icon: Zap,      text: 'Performance reports available to verified partners' },
];

export default function PartnersPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <section className="relative border-b border-border py-16 px-4">
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <Badge variant="secondary" className="border-primary/30 text-primary bg-primary/10 mb-2">
            Partner with Homatch
          </Badge>
          <h1 className="text-3xl md:text-4xl font-bold text-foreground tracking-tight">
            Reach Verified Real Estate Seekers
          </h1>
          <p className="text-base text-muted-foreground max-w-xl mx-auto">
            Advertise to buyers, renters, sellers and investors at the exact moment they are searching, matching and verifying on Homatch.
          </p>
          <div className="flex flex-col md:flex-row gap-3 justify-center pt-2">
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
              onClick={() => document.getElementById('inquiry')?.scrollIntoView({ behavior: 'smooth' })}>
              Get in Touch <ArrowRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" className="border-border gap-2"
              onClick={() => navigate('/verify')}>
              <Shield className="h-4 w-4" /> View Verification Center
            </Button>
          </div>
        </div>
      </section>

      {/* Transparency rules */}
      <section className="py-10 px-4 border-b border-border bg-card/30">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-5 text-center">
            Our Advertising Principles
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PLACEMENT_RULES.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card">
                <Icon className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Partner categories */}
      <section className="py-12 px-4 border-b border-border">
        <div className="max-w-3xl mx-auto space-y-6">
          <h2 className="text-xl font-bold text-foreground text-center">Partner Categories</h2>
          <div className="space-y-4">
            {PARTNER_CATEGORIES.map(({ icon: Icon, title, desc, placements }) => (
              <Card key={title} className="border-border bg-card">
                <CardContent className="pt-5 pb-5">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground text-sm mb-1">{title}</h3>
                      <p className="text-sm text-muted-foreground mb-3">{desc}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {placements.map(p => (
                          <Badge key={p} variant="secondary" className="text-[10px] border-border">
                            <CheckCircle2 className="h-2.5 w-2.5 mr-1 text-primary" />{p}
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
            <h2 className="text-xl font-bold text-foreground mb-2">Express Partnership Interest</h2>
            <p className="text-sm text-muted-foreground">Tell us about your business and we'll be in touch.</p>
          </div>
          <Card className="border-border bg-card">
            <CardContent className="pt-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Company Name *</label>
                  <input className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Acme Developers" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Contact Email *</label>
                  <input type="email" className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary" placeholder="you@company.com" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Partner Category</label>
                <select className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
                  <option value="">Select category…</option>
                  <option>Real Estate Developer</option>
                  <option>Agency / Broker</option>
                  <option>Mortgage / Finance</option>
                  <option>Relocation / Legal / Services</option>
                  <option>Other</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Message</label>
                <textarea rows={3} className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary resize-none" placeholder="Tell us about your goals and target markets…" />
              </div>
              <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
                <Mail className="h-4 w-4" /> Send Inquiry
              </Button>
              <p className="text-[10px] text-muted-foreground/60 text-center">
                Sponsored placements are always labeled and never influence organic scores or rankings.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
