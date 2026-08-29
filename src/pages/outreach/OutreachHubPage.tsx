import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, Users, Mail, MessageSquare, Phone, Megaphone, ChevronRight } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

const channels = [
  { icon: Globe, labelKey: 'outreach_channel_communities', descKey: 'outreach_channel_communities_desc', path: '/outreach/communities', badge: 'outreach_badge_internal_only' },
  { icon: Users, labelKey: 'outreach_channel_contacts', descKey: 'outreach_channel_contacts_desc', path: '/outreach/contact-lists', badge: null },
  { icon: Mail, labelKey: 'outreach_channel_email', descKey: 'outreach_channel_email_desc', path: '/outreach/email', badge: 'outreach_badge_disabled' },
  { icon: MessageSquare, labelKey: 'outreach_channel_sms', descKey: 'outreach_channel_sms_desc', path: '/outreach/sms', badge: 'outreach_badge_disabled' },
  { icon: Phone, labelKey: 'outreach_channel_calls', descKey: 'outreach_channel_calls_desc', path: '/outreach/calls', badge: 'outreach_badge_disabled' },
];

export default function OutreachHubPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  return (
    <RouteGuard>
      <AppLayout>
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-primary" />
              {t('outreach_title')}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t('outreach_subtitle')}</p>
          </div>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">{t('outreach_all_disabled_banner')}</AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 gap-3">
            {channels.map(({ icon: Icon, labelKey, descKey, path, badge }) => (
              <Card key={path} className="cursor-pointer hover:border-primary/40 transition-colors"
                onClick={() => navigate(path)}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{t(labelKey as Parameters<typeof t>[0])}</span>
                        {badge && (
                          <Badge variant="outline" className="text-[10px] px-1.5 text-muted-foreground">
                            {t(badge as Parameters<typeof t>[0])}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{t(descKey as Parameters<typeof t>[0])}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </AppLayout>
    </RouteGuard>
  );
}
