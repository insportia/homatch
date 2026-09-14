import React from 'react';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import LoginPage from './pages/auth/LoginPage';
import SignupPage from './pages/auth/SignupPage';
import AuthCallbackPage from './pages/auth/AuthCallbackPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import ProfilePage from './pages/ProfilePage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';
import DashboardPage from './pages/DashboardPage';
import ActivityPage from './pages/ActivityPage';
import NotificationsPage from './pages/NotificationsPage';
import AddPropertyPage from './pages/property/AddPropertyPage';
import URLImportPage from './pages/property/URLImportPage';
import PrivateListingPage from './pages/property/PrivateListingPage';
import PropertyDetailPage from './pages/property/PropertyDetailPage';
import MatchesPage from './pages/property/MatchesPage';
import CreditsPage from './pages/CreditsPage';
import ChatPage from './pages/ChatPage';
import LiveChatPage from './pages/LiveChatPage';
import ViewingsPage from './pages/ViewingsPage';
import ActiveSearchPage from './pages/ActiveSearchPage';
import DeveloperProfilePage from './pages/DeveloperProfilePage';
import AIPage from './pages/AIPage';
import VerifyPage from './pages/VerifyPage';
import MortgagePage from './pages/MortgagePage';
import VerificationCasePage from './pages/VerificationCasePage';
import LegacyDealRoomRedirect from './pages/LegacyDealRoomRedirect';
// CasesPage import removed (2026-09-06 "REMOVE MY DEALS/CASES" mandate) —
// the /cases route below is intentionally not registered. The file itself
// is left in place (dormant), not deleted, in case this product surface
// is revisited later.
import PartnersPage from './pages/PartnersPage';
import PricingPage from './pages/PricingPage';
import DevelopersPage from './pages/DevelopersPage';
import AboutPage from './pages/AboutPage';
// Outreach pages
import OutreachHubPage from './pages/outreach/OutreachHubPage';
import CommunitiesPage from './pages/outreach/CommunitiesPage';
import ContactListsPage from './pages/outreach/ContactListsPage';
import EmailCampaignsPage from './pages/outreach/EmailCampaignsPage';
import SmsCampaignsPage from './pages/outreach/SmsCampaignsPage';
import OutreachInsightsPage from './pages/outreach/OutreachInsightsPage';
// Communications Hub. These EVOLVE the Outreach area rather than replacing it:
// every route above still exists and still works (§8).
import CommunicationsOverviewPage from './pages/outreach/CommunicationsOverviewPage';
import AgentsPage from './pages/outreach/AgentsPage';
import AgentBuilderPage from './pages/outreach/AgentBuilderPage';
import CampaignsPage from './pages/outreach/CampaignsPage';
import CampaignBuilderPage from './pages/outreach/CampaignBuilderPage';
import ContactsPage from './pages/outreach/ContactsPage';
import ContactImportPage from './pages/outreach/ContactImportPage';
import ContactProfilePage from './pages/outreach/ContactProfilePage';
import WhatsAppPage from './pages/outreach/WhatsAppPage';
import WhatsAppInboxPage from './pages/outreach/WhatsAppInboxPage';
import WhatsAppTemplatesPage from './pages/outreach/WhatsAppTemplatesPage';
import ChannelAccountsPage from './pages/outreach/ChannelAccountsPage';
import CommunicationsAnalyticsPage from './pages/outreach/CommunicationsAnalyticsPage';
import CallsPage from './pages/outreach/CallsPage';
import CommunicationsBillingPage from './pages/outreach/CommunicationsBillingPage';
// Admin pages
import AdminLayout from './components/layouts/AdminLayout';
import AdminOverviewPage from './pages/admin/AdminOverviewPage';
import AdminUsersPage from './pages/admin/AdminUsersPage';
import AdminUser360Page from './pages/admin/AdminUser360Page';
import AdminPropertiesPage from './pages/admin/AdminPropertiesPage';
import AdminCampaignsPage from './pages/admin/AdminCampaignsPage';
import AdminOutreachPage from './pages/admin/AdminOutreachPage';
import AdminMarketsPage from './pages/admin/AdminMarketsPage';
import AdminSourcesPage from './pages/admin/AdminSourcesPage';
import AdminSignalsPage from './pages/admin/AdminSignalsPage';
import AdminMatchesPage from './pages/admin/AdminMatchesPage';
import AdminCreditsPage from './pages/admin/AdminCreditsPage';
import AdminPaymentsPage from './pages/admin/AdminPaymentsPage';
import AdminFinancePage from './pages/admin/AdminFinancePage';
import AdminProvidersPage from './pages/admin/AdminProvidersPage';
import AdminVoiceAiPage from './pages/admin/AdminVoiceAiPage';
import AdminPricingPage from './pages/admin/AdminPricingPage';
import AdminSpendCapsPage from './pages/admin/AdminSpendCapsPage';
import AdminDiagnosticsPage from './pages/admin/AdminDiagnosticsPage';
import AdminSponsoredPage from './pages/admin/AdminSponsoredPage';
import AdminSettingsPage from './pages/admin/AdminSettingsPage';
import AdminHealthPage from './pages/admin/AdminHealthPage';
import AdminRiskPage from './pages/admin/AdminRiskPage';
import SiteStudioPage from './pages/admin/SiteStudioPage';
import AppContentPage from './pages/admin/AppContentPage';
import AdminEngagementPage from './pages/admin/AdminEngagementPage';
import AdminLiveChatReportsPage from './pages/admin/AdminLiveChatReportsPage';

export interface RouteConfig {
  name: string;
  path: string;
  element: ReactNode;
  visible?: boolean;
  public?: boolean;
  adminOnly?: boolean;
}

const adminWrap = (page: ReactNode) => <AdminLayout>{page}</AdminLayout>;

export const routes: RouteConfig[] = [
  // Public
  { name: 'Home',              path: '/',                         element: <HomePage />,          public: true },
  // What Homatch is, for somebody who arrived here without seeing the home
  // page first. Product explanation, not a corporate About Us.
  { name: 'About',             path: '/about',                    element: <AboutPage />,         public: true },
  { name: 'Login',             path: '/auth/login',               element: <LoginPage />,         public: true },
  { name: 'Signup',            path: '/auth/signup',              element: <SignupPage />,        public: true },
  { name: 'Auth Callback',     path: '/auth/callback',            element: <AuthCallbackPage />,  public: true },
  { name: 'Reset Password',    path: '/auth/reset-password',      element: <ResetPasswordPage />, public: true },
  { name: 'Privacy Policy',    path: '/privacy',                  element: <PrivacyPage />,       public: true },
  { name: 'Terms of Service',  path: '/terms',                    element: <TermsPage />,         public: true },
  { name: 'AI Assistant',      path: '/ai',                       element: <AIPage />,            public: false },
  // VERIFICATION CENTER. The single customer destination for due diligence:
  // start a verification here, and return to any verification you already
  // have from the same screen. Public like before — a signed-out visitor can
  // run a check; the saved-case list below only renders for a signed-in user
  // and is owner-only under RLS regardless.
  { name: 'Verification Center', path: '/verify',                 element: <VerifyPage />,        public: true },
  // One property = one persistent Verification Case. Authenticated only: a
  // case is a customer's private due-diligence work, and every table behind
  // it is owner-only under RLS.
  { name: 'Verification Case', path: '/verify/:id',               element: <VerificationCasePage /> },
  // Public like Verify: the calculator + educational explanations must work
  // for a signed-out visitor (mandate requirement); saving a scenario or
  // uploading a bank offer still requires auth, enforced by mortgage_scenarios
  // / mortgage_offers RLS (auth_user_id()-based, see the migration), not by
  // gating this route.
  { name: 'Mortgage',          path: '/mortgage',                 element: <MortgagePage />,      public: true },
  // 'My Deals' / '/cases' route intentionally removed from the product
  // (2026-09-06 mandate) — see the CasesPage import comment above.
  { name: 'Partners',          path: '/partners',                 element: <PartnersPage />,      public: true },
  // Public on purpose. A signed-out visitor comparing plans is the whole
  // point of the page, and the plan catalogue is readable by anon.
  { name: 'Pricing',           path: '/pricing',                  element: <PricingPage />,       public: true },
  /*
   * HOMATCH FOR DEVELOPERS.
   *
   * Public, and composed from registry sections rather than written as JSX,
   * because it is a commercial offer whose packaging is still being decided
   * and every sentence on it needs to be changeable without a deploy. See
   * DevelopersPage for what it deliberately does not claim.
   */
  { name: 'Developers',        path: '/developers',               element: <DevelopersPage />,    public: true },
  // Customer
  { name: 'Dashboard',         path: '/dashboard',                element: <DashboardPage /> },
  // Compatibility only. "Deal Room" was briefly a separate destination; it is
  // now absorbed into the Verification Center, and these paths redirect there
  // rather than serving a second UI for the same data.
  { name: 'Legacy verification redirect', path: '/deal-rooms',             element: <LegacyDealRoomRedirect /> },
  { name: 'Legacy verification redirect (case)',  path: '/deal-rooms/:id',         element: <LegacyDealRoomRedirect /> },
  { name: 'Activity',          path: '/activity',                 element: <ActivityPage /> },
  { name: 'Notifications',     path: '/notifications',            element: <NotificationsPage /> },
  { name: 'Credits',           path: '/credits',                  element: <CreditsPage /> },
  { name: 'Profile',           path: '/profile',                  element: <ProfilePage /> },
  { name: 'Chat',              path: '/chat',                     element: <ChatPage /> },
  { name: 'Live Chat',         path: '/live-chat',                element: <LiveChatPage /> },
  { name: 'Viewings',          path: '/viewings',                 element: <ViewingsPage /> },
  { name: 'Active Search',     path: '/active-search',            element: <ActiveSearchPage /> },
  { name: 'Developer Profile', path: '/developer/:id',            element: <DeveloperProfilePage /> },
  { name: 'Add Property',      path: '/property/add',             element: <AddPropertyPage /> },
  { name: 'Import Property',   path: '/property/import',          element: <URLImportPage /> },
  { name: 'Create Listing',    path: '/property/create',          element: <PrivateListingPage /> },
  { name: 'Property Detail',   path: '/property/:id',             element: <PropertyDetailPage /> },
  { name: 'Property Matches',  path: '/property/:id/matches',     element: <MatchesPage /> },
  // Outreach
  { name: 'Communications',    path: '/outreach',                 element: <CommunicationsOverviewPage /> },
  { name: 'Outreach Hub',      path: '/outreach/hub',             element: <OutreachHubPage />,  visible: false },
  { name: 'Communities',       path: '/outreach/communities',     element: <CommunitiesPage /> },
  { name: 'Contact Lists',     path: '/outreach/contact-lists',   element: <ContactListsPage /> },
  { name: 'Email Campaigns',   path: '/outreach/email',           element: <EmailCampaignsPage /> },
  { name: 'SMS Campaigns',     path: '/outreach/sms',             element: <SmsCampaignsPage /> },
  /*
   * /outreach/calls IS the AI Call Center, and it mounts CallsPage.
   *
   * It used to mount AiCallCenterPage, the pre-Communications screen, while
   * the real one sat at /outreach/calls/log where nothing linked to it. So
   * every route into the product — the home page, the footer, the action
   * launcher, the shell nav, the site registry, and the Communications hub's
   * own channel card — delivered people to a page whose banner read "AI
   * calling is disabled (outreach_calling_enabled=false). Campaigns are
   * created as DRAFT with MOCK provider."
   *
   * That sentence was true of the old screen and false of the product: AI
   * calling is real, it is kill-switched pending pricing, and it reads its
   * state from comm_provider_routes rather than the old outreach_* flags.
   *
   * /outreach/calls/log redirects here rather than 404ing, because it was
   * briefly live and may be bookmarked.
   */
  { name: 'AI Call Center',    path: '/outreach/calls',           element: <CallsPage /> },
  { name: 'Calls (legacy path)', path: '/outreach/calls/log',     element: <Navigate to="/outreach/calls" replace />, visible: false },
  { name: 'Outreach Insights', path: '/outreach/insights',        element: <OutreachInsightsPage /> },
  { name: 'Agents',            path: '/outreach/agents',          element: <AgentsPage /> },
  { name: 'Agent Builder',     path: '/outreach/agents/:id',      element: <AgentBuilderPage />, visible: false },
  { name: 'Campaigns',         path: '/outreach/campaigns',       element: <CampaignsPage /> },
  { name: 'Campaign Builder',  path: '/outreach/campaigns/new',   element: <CampaignBuilderPage />, visible: false },
  /* The audience had an import wizard and a per-person profile and no list.
     This is where a customer looks at who they can actually reach. */
  { name: 'Contacts',          path: '/outreach/contacts',        element: <ContactsPage /> },
  { name: 'Import Contacts',   path: '/outreach/contacts/import', element: <ContactImportPage />, visible: false },
  { name: 'Contact',           path: '/outreach/contacts/:id',    element: <ContactProfilePage />, visible: false },
  { name: 'WhatsApp',          path: '/outreach/whatsapp',        element: <WhatsAppPage /> },
  { name: 'WhatsApp Inbox',    path: '/outreach/whatsapp/inbox',  element: <WhatsAppInboxPage /> },
  { name: 'WhatsApp Templates', path: '/outreach/whatsapp/templates', element: <WhatsAppTemplatesPage />, visible: false },
  { name: 'Phone Numbers',     path: '/outreach/numbers',         element: <ChannelAccountsPage />, visible: true },
  /*
   * ── ONE COPY OF EACH SHARED SCREEN PER PRODUCT ────────────────────
   *
   * Contacts, Numbers, Campaigns, Lists and Analytics are one component each.
   * They are NOT one destination each: a person inside AI Calls who opens
   * Contacts must stay inside AI Calls, and the old shared /outreach/contacts
   * dropped them into a page that showed every channel at once.
   *
   * The component is shared; the ROUTE is what carries the product, because
   * the URL is the only piece of state a refresh restores. See
   * components/communications/channel.ts -- each screen reads its channel from
   * the path, so a bookmark to /outreach/calls/contacts cannot open as
   * anything else.
   *
   * The unscoped paths are kept and redirect, because they have been linked.
   */
  { name: 'Calls Campaigns',   path: '/outreach/calls/campaigns',    element: <CampaignsPage />,        visible: false },
  { name: 'Calls Agents',      path: '/outreach/calls/agents',       element: <AgentsPage />,           visible: false },
  { name: 'Calls Numbers',     path: '/outreach/calls/numbers',      element: <ChannelAccountsPage />,  visible: false },
  { name: 'Calls Contacts',    path: '/outreach/calls/contacts',     element: <ContactsPage />,         visible: false },

  { name: 'WhatsApp Numbers',  path: '/outreach/whatsapp/numbers',   element: <ChannelAccountsPage />,  visible: false },
  { name: 'WhatsApp Contacts', path: '/outreach/whatsapp/contacts',  element: <ContactsPage />,         visible: false },

  { name: 'Email Contacts',    path: '/outreach/email/contacts',     element: <ContactsPage />,         visible: false },
  { name: 'Email Lists',       path: '/outreach/email/lists',        element: <ContactListsPage />,     visible: false },
  { name: 'Email Analytics',   path: '/outreach/email/analytics',    element: <CommunicationsAnalyticsPage />, visible: false },

  { name: 'Communications Analytics', path: '/outreach/analytics', element: <CommunicationsAnalyticsPage /> },
  { name: 'Communications Billing', path: '/outreach/billing',    element: <CommunicationsBillingPage /> },
  // Admin (wrapped in AdminLayout which enforces is_admin server-side)
  { name: 'Admin Overview',    path: '/admin',                    element: adminWrap(<AdminOverviewPage />),    adminOnly: true },
  { name: 'Admin Users',       path: '/admin/users',              element: adminWrap(<AdminUsersPage />),       adminOnly: true },
  { name: 'Admin User 360',    path: '/admin/user360',            element: adminWrap(<AdminUser360Page />),     adminOnly: true },
  { name: 'Admin Properties',  path: '/admin/properties',         element: adminWrap(<AdminPropertiesPage />),  adminOnly: true },
  { name: 'Admin Campaigns',   path: '/admin/campaigns',          element: adminWrap(<AdminCampaignsPage />),   adminOnly: true },
  { name: 'Admin Outreach',    path: '/admin/outreach',           element: adminWrap(<AdminOutreachPage />),    adminOnly: true },
  { name: 'Admin Markets',     path: '/admin/markets',            element: adminWrap(<AdminMarketsPage />),     adminOnly: true },
  { name: 'Admin Sources',     path: '/admin/sources',            element: adminWrap(<AdminSourcesPage />),     adminOnly: true },
  { name: 'Admin Signals',     path: '/admin/signals',            element: adminWrap(<AdminSignalsPage />),     adminOnly: true },
  { name: 'Admin Matches',     path: '/admin/matches',            element: adminWrap(<AdminMatchesPage />),     adminOnly: true },
  { name: 'Admin Credits',     path: '/admin/credits',            element: adminWrap(<AdminCreditsPage />),     adminOnly: true },
  { name: 'Admin Payments',    path: '/admin/payments',           element: adminWrap(<AdminPaymentsPage />),    adminOnly: true },
  { name: 'Admin Finance',     path: '/admin/finance',            element: adminWrap(<AdminFinancePage />),     adminOnly: true },
  { name: 'Admin Live Chat Reports', path: '/admin/live-chat-reports', element: adminWrap(<AdminLiveChatReportsPage />), adminOnly: true },
  { name: 'Admin Providers',   path: '/admin/providers',          element: adminWrap(<AdminProvidersPage />),   adminOnly: true },
  { name: 'Admin Voice AI',    path: '/admin/voice-ai',           element: adminWrap(<AdminVoiceAiPage />),     adminOnly: true },
  { name: 'Admin Pricing',     path: '/admin/pricing',            element: adminWrap(<AdminPricingPage />),     adminOnly: true },
  { name: 'Admin Spend Caps',  path: '/admin/spend-caps',         element: adminWrap(<AdminSpendCapsPage />),   adminOnly: true },
  { name: 'Admin Diagnostics', path: '/admin/diagnostics',        element: adminWrap(<AdminDiagnosticsPage />), adminOnly: true },
  { name: 'Admin Sponsored',   path: '/admin/sponsored',          element: adminWrap(<AdminSponsoredPage />),   adminOnly: true },
  { name: 'Admin Settings',    path: '/admin/settings',           element: adminWrap(<AdminSettingsPage />),    adminOnly: true },
  { name: 'Admin Health',      path: '/admin/health',             element: adminWrap(<AdminHealthPage />),      adminOnly: true },
  { name: 'Admin Risk',        path: '/admin/risk',               element: adminWrap(<AdminRiskPage />),        adminOnly: true },
  { name: 'Site Studio',       path: '/admin/site-studio',        element: adminWrap(<SiteStudioPage />),       adminOnly: true },
  /* The other 4,773 strings. Site Studio edits nine marketing pages;
     everything a signed-in customer reads lived only in the bundle. */
  { name: 'App Content',       path: '/admin/app-content',        element: adminWrap(<AppContentPage />),       adminOnly: true },
  /* The install and notification funnel. Reads pwa_events, which is
     write-only for visitors and readable only under is_admin(). */
  { name: 'Admin Engagement',  path: '/admin/engagement',         element: adminWrap(<AdminEngagementPage />),  adminOnly: true },
];
