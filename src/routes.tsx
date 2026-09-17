/*
 * EVERY PAGE USED TO BE IN THE FIRST BUNDLE, INCLUDING THE ONES NOBODY OPENED.
 *
 * routes.tsx imported all 104 pages eagerly, so the main chunk was 5.8MB and
 * a visitor landing on the home page parsed the Developer workspace, Studio,
 * the admin screens and everything they import before AI TALK could start.
 * Measured on a throttled phone: six to eleven long tasks on load, the worst
 * over two seconds of blocked main thread.
 *
 * They are fetched when their route is entered now. HomePage stays eager on
 * purpose -- it is what AI TALK lives on, and making the landing page wait
 * for a second round trip to show itself would move the problem rather than
 * fix it.
 */
import React, { lazy } from 'react';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const SignupPage = lazy(() => import('./pages/auth/SignupPage'));
const AuthCallbackPage = lazy(() => import('./pages/auth/AuthCallbackPage'));
const ResetPasswordPage = lazy(() => import('./pages/auth/ResetPasswordPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const TermsPage = lazy(() => import('./pages/TermsPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ActivityPage = lazy(() => import('./pages/ActivityPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const AddPropertyPage = lazy(() => import('./pages/property/AddPropertyPage'));
const URLImportPage = lazy(() => import('./pages/property/URLImportPage'));
const PrivateListingPage = lazy(() => import('./pages/property/PrivateListingPage'));
const PropertyDetailPage = lazy(() => import('./pages/property/PropertyDetailPage'));
const MatchesPage = lazy(() => import('./pages/property/MatchesPage'));
const CreditsPage = lazy(() => import('./pages/CreditsPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const LiveChatPage = lazy(() => import('./pages/LiveChatPage'));
const ViewingsPage = lazy(() => import('./pages/ViewingsPage'));
const ActiveSearchPage = lazy(() => import('./pages/ActiveSearchPage'));
const DeveloperProfilePage = lazy(() => import('./pages/DeveloperProfilePage'));
const AIPage = lazy(() => import('./pages/AIPage'));
const VerifyPage = lazy(() => import('./pages/VerifyPage'));
const MortgagePage = lazy(() => import('./pages/MortgagePage'));
const VerificationCasePage = lazy(() => import('./pages/VerificationCasePage'));
const LegacyDealRoomRedirect = lazy(() => import('./pages/LegacyDealRoomRedirect'));
// CasesPage import removed (2026-09-06 "REMOVE MY DEALS/CASES" mandate) —
// the /cases route below is intentionally not registered. The file itself
// is left in place (dormant), not deleted, in case this product surface
// is revisited later.
const PartnersPage = lazy(() => import('./pages/PartnersPage'));
const PricingPage = lazy(() => import('./pages/PricingPage'));
const DevelopersPage = lazy(() => import('./pages/DevelopersPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
/*
 * HOMATCH FOR DEVELOPERS — the private sales workspace.
 *
 * /developers stays exactly what it was: the public commercial page. The
 * product itself lives underneath it at /developers/home, /developers/projects
 * and so on, which is why the marketing route keeps its exact path and every
 * one of these is deeper. A visitor who has never signed in still lands on
 * the page that explains the offer.
 */
const DeveloperStartPage = lazy(() => import('./pages/developer/DeveloperStartPage'));
const DeveloperHomePage = lazy(() => import('./pages/developer/DeveloperHomePage'));
const DeveloperProjectsPage = lazy(() => import('./pages/developer/DeveloperProjectsPage'));
const DeveloperProjectPage = lazy(() => import('./pages/developer/DeveloperProjectPage'));
const DeveloperContactsPage = lazy(() => import('./pages/developer/DeveloperContactsPage'));
const DeveloperSalesOverviewPage = lazy(() => import('./pages/developer/DeveloperSalesOverviewPage'));
const DeveloperViewingsPage = lazy(() => import('./pages/developer/DeveloperViewingsPage'));
const DeveloperReservationsPage = lazy(() => import('./pages/developer/DeveloperReservationsPage'));
const DeveloperOffersPage = lazy(() => import('./pages/developer/DeveloperOffersPage'));
const DeveloperContractsPage = lazy(() => import('./pages/developer/DeveloperContractsPage'));
const DeveloperCommissionsPage = lazy(() => import('./pages/developer/DeveloperCommissionsPage'));
const DeveloperHandoverPage = lazy(() => import('./pages/developer/DeveloperHandoverPage'));
const DeveloperPaymentsPage = lazy(() => import('./pages/developer/DeveloperPaymentsPage'));
const DeveloperLedgerPage = lazy(() => import('./pages/developer/DeveloperLedgerPage'));
const DeveloperDocumentsPage = lazy(() => import('./pages/developer/DeveloperDocumentsPage'));
const DeveloperMarketingPage = lazy(() => import('./pages/developer/DeveloperMarketingPage'));
const DeveloperInsightsPage = lazy(() => import('./pages/developer/DeveloperInsightsPage'));
const DeveloperSettingsPage = lazy(() => import('./pages/developer/DeveloperSettingsPage'));
const DeveloperExportTemplatesPage = lazy(() => import('./pages/developer/DeveloperExportTemplatesPage'));
const DeveloperAuditPage = lazy(() => import('./pages/developer/DeveloperAuditPage'));
const SharedUnitPage = lazy(() => import('./pages/developer/SharedUnitPage'));
const PublicProjectPage = lazy(() => import('./pages/developer/PublicProjectPage'));
const BuyerRoomPage = lazy(() => import('./pages/developer/BuyerRoomPage'));
const TwinViewerPage = lazy(() => import('./pages/developer/TwinViewerPage'));
const StudioPage = lazy(() => import('./pages/developer/StudioPage'));
const StudioProjectPage = lazy(() => import('./pages/developer/StudioProjectPage'));
/* The verification screen for the 2D -> 3D pipeline. Lazy like its
   siblings: it pulls the floor-plan renderer and nothing else does. */
const StudioFloorPlanPage = lazy(() => import('./pages/developer/StudioFloorPlanPage'));
// Outreach pages
const OutreachHubPage = lazy(() => import('./pages/outreach/OutreachHubPage'));
const CommunitiesPage = lazy(() => import('./pages/outreach/CommunitiesPage'));
const ContactListsPage = lazy(() => import('./pages/outreach/ContactListsPage'));
const EmailCampaignsPage = lazy(() => import('./pages/outreach/EmailCampaignsPage'));
const SmsCampaignsPage = lazy(() => import('./pages/outreach/SmsCampaignsPage'));
const OutreachInsightsPage = lazy(() => import('./pages/outreach/OutreachInsightsPage'));
// Communications Hub. These EVOLVE the Outreach area rather than replacing it:
// every route above still exists and still works (§8).
const CommunicationsOverviewPage = lazy(() => import('./pages/outreach/CommunicationsOverviewPage'));
const AgentsPage = lazy(() => import('./pages/outreach/AgentsPage'));
const AgentBuilderPage = lazy(() => import('./pages/outreach/AgentBuilderPage'));
const CampaignsPage = lazy(() => import('./pages/outreach/CampaignsPage'));
const CampaignBuilderPage = lazy(() => import('./pages/outreach/CampaignBuilderPage'));
const ContactsPage = lazy(() => import('./pages/outreach/ContactsPage'));
const ContactImportPage = lazy(() => import('./pages/outreach/ContactImportPage'));
const ContactProfilePage = lazy(() => import('./pages/outreach/ContactProfilePage'));
const WhatsAppPage = lazy(() => import('./pages/outreach/WhatsAppPage'));
const WhatsAppInboxPage = lazy(() => import('./pages/outreach/WhatsAppInboxPage'));
const WhatsAppTemplatesPage = lazy(() => import('./pages/outreach/WhatsAppTemplatesPage'));
const ChannelAccountsPage = lazy(() => import('./pages/outreach/ChannelAccountsPage'));
const CommunicationsAnalyticsPage = lazy(() => import('./pages/outreach/CommunicationsAnalyticsPage'));
const CallsPage = lazy(() => import('./pages/outreach/CallsPage'));
const CommunicationsBillingPage = lazy(() => import('./pages/outreach/CommunicationsBillingPage'));
// Admin pages
import AdminLayout from './components/layouts/AdminLayout';
const AdminOverviewPage = lazy(() => import('./pages/admin/AdminOverviewPage'));
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsersPage'));
const AdminUser360Page = lazy(() => import('./pages/admin/AdminUser360Page'));
const AdminPropertiesPage = lazy(() => import('./pages/admin/AdminPropertiesPage'));
const AdminCampaignsPage = lazy(() => import('./pages/admin/AdminCampaignsPage'));
const AdminOutreachPage = lazy(() => import('./pages/admin/AdminOutreachPage'));
const AdminMarketsPage = lazy(() => import('./pages/admin/AdminMarketsPage'));
const AdminSourcesPage = lazy(() => import('./pages/admin/AdminSourcesPage'));
const AdminSignalsPage = lazy(() => import('./pages/admin/AdminSignalsPage'));
const AdminMatchesPage = lazy(() => import('./pages/admin/AdminMatchesPage'));
const AdminCreditsPage = lazy(() => import('./pages/admin/AdminCreditsPage'));
const AdminPaymentsPage = lazy(() => import('./pages/admin/AdminPaymentsPage'));
const AdminFinancePage = lazy(() => import('./pages/admin/AdminFinancePage'));
const AdminProvidersPage = lazy(() => import('./pages/admin/AdminProvidersPage'));
const AdminVoiceAiPage = lazy(() => import('./pages/admin/AdminVoiceAiPage'));
const AdminPricingPage = lazy(() => import('./pages/admin/AdminPricingPage'));
const AdminSpendCapsPage = lazy(() => import('./pages/admin/AdminSpendCapsPage'));
const AdminDiagnosticsPage = lazy(() => import('./pages/admin/AdminDiagnosticsPage'));
const AdminSponsoredPage = lazy(() => import('./pages/admin/AdminSponsoredPage'));
const AdminSettingsPage = lazy(() => import('./pages/admin/AdminSettingsPage'));
const AdminHealthPage = lazy(() => import('./pages/admin/AdminHealthPage'));
const AdminRiskPage = lazy(() => import('./pages/admin/AdminRiskPage'));
const SiteStudioPage = lazy(() => import('./pages/admin/SiteStudioPage'));
const AppContentPage = lazy(() => import('./pages/admin/AppContentPage'));
const AdminEngagementPage = lazy(() => import('./pages/admin/AdminEngagementPage'));
const AdminLiveChatReportsPage = lazy(() => import('./pages/admin/AdminLiveChatReportsPage'));

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
  /*
   * The public surfaces of Homatch for Developers. Both are reachable with no
   * account, and neither can read a dev_* table — see the import comment.
   */
  { name: 'Shared unit',       path: '/s/:token',                 element: <SharedUnitPage />,    public: true, visible: false },
  { name: 'Public project',    path: '/projects/:developer/:project', element: <PublicProjectPage />, public: true, visible: false },
  /* A buyer's own room. Public in the sense that it needs no account; the
     token in the path is the credential, and it is checked in SQL. */
  { name: 'Buyer room',        path: '/buyer/:token',             element: <BuyerRoomPage />, public: true, visible: false },
  /* The Digital Twin. /p is the page a buyer opens; /embed is the same page
     with the chrome removed, so an iframe on a developer's own website shows
     THIS canonical project rather than a copy of it that can drift. */
  { name: 'Twin viewer',       path: '/p/:workspace/:project',    element: <TwinViewerPage />, public: true, visible: false },
  { name: 'Twin embed',        path: '/embed/:workspace/:project', element: <TwinViewerPage embedded />, public: true, visible: false },

  /* HOMATCH PROJECT STUDIO — internal. Not under /developers, because it is
     not a developer's workspace: it spans every customer, and the people who
     use it are our own 3D team. The route renders an explanation for anybody
     who is not on dt_studio_staff, and every function behind it refuses them
     again in SQL. */
  { name: 'Studio',            path: '/studio',                   element: <StudioPage />, visible: false },
  { name: 'Studio floor plan', path: '/studio/plan/:id',          element: <StudioFloorPlanPage />, visible: false },
  { name: 'Studio project',    path: '/studio/:projectId',        element: <StudioProjectPage />, visible: false },
  /*
   * THE DEVELOPER WORKSPACE.
   *
   * Every one of these renders inside DeveloperShell, which requires a signed-in
   * account with an active membership and sends anybody else to /developers/start.
   * The shell also hides navigation the role cannot use — and the server refuses
   * it a second time regardless, which is the half that actually enforces it.
   */
  { name: 'Developer start',   path: '/developers/start',         element: <DeveloperStartPage />, visible: false },
  { name: 'Developer Home',    path: '/developers/home',          element: <DeveloperHomePage /> },
  { name: 'Developer Projects', path: '/developers/projects',     element: <DeveloperProjectsPage /> },
  { name: 'Developer Project', path: '/developers/projects/:id',  element: <DeveloperProjectPage />, visible: false },
  { name: 'Developer Contacts', path: '/developers/contacts',     element: <DeveloperContactsPage /> },
  { name: 'Developer Sales',   path: '/developers/sales',         element: <DeveloperSalesOverviewPage /> },
  { name: 'Developer Viewings', path: '/developers/sales/viewings', element: <DeveloperViewingsPage />, visible: false },
  { name: 'Developer Reservations', path: '/developers/sales/reservations', element: <DeveloperReservationsPage />, visible: false },
  { name: 'Developer Offers',  path: '/developers/sales/offers',  element: <DeveloperOffersPage />, visible: false },
  { name: 'Developer Contracts', path: '/developers/sales/contracts', element: <DeveloperContractsPage />, visible: false },
  /* The old /deals path is where this screen used to live. It still resolves,
     because a link to a contract in somebody's email must not go dead. */
  { name: 'Developer Deals',   path: '/developers/sales/deals',   element: <DeveloperContractsPage />, visible: false },
  { name: 'Developer Commissions', path: '/developers/sales/commissions', element: <DeveloperCommissionsPage />, visible: false },
  { name: 'Developer Handover', path: '/developers/sales/handover', element: <DeveloperHandoverPage />, visible: false },
  { name: 'Developer Payments', path: '/developers/sales/payments', element: <DeveloperPaymentsPage />, visible: false },
  { name: 'Developer Sales Ledger', path: '/developers/sales/ledger', element: <DeveloperLedgerPage />, visible: false },
  { name: 'Developer Documents', path: '/developers/documents',   element: <DeveloperDocumentsPage /> },
  { name: 'Developer Marketing', path: '/developers/marketing',   element: <DeveloperMarketingPage /> },
  { name: 'Developer Insights', path: '/developers/insights',     element: <DeveloperInsightsPage /> },
  { name: 'Developer Settings', path: '/developers/settings',     element: <DeveloperSettingsPage /> },
  { name: 'Developer Export Templates', path: '/developers/settings/exports', element: <DeveloperExportTemplatesPage />, visible: false },
  { name: 'Developer Audit',   path: '/developers/settings/audit',  element: <DeveloperAuditPage />, visible: false },
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
  /* The builder, per product. A wizard whose first step asks which channel
     you meant is a wizard that did not know -- and it is reached from a
     button inside a product that already does. */
  { name: 'Calls Campaign Builder', path: '/outreach/calls/campaigns/new', element: <CampaignBuilderPage />, visible: false },
  { name: 'WhatsApp Campaign Builder', path: '/outreach/whatsapp/campaigns/new', element: <CampaignBuilderPage />, visible: false },
  { name: 'Calls Agents',      path: '/outreach/calls/agents',       element: <AgentsPage />,           visible: false },
  { name: 'Calls Numbers',     path: '/outreach/calls/numbers',      element: <ChannelAccountsPage />,  visible: false },
  { name: 'Calls Contacts',    path: '/outreach/calls/contacts',     element: <ContactsPage />,         visible: false },
  /* Import, per product. "Import contacts" pressed inside Email is an EMAIL
     audience import; the same wizard with the channel it was opened from. */
  { name: 'Calls Import',      path: '/outreach/calls/contacts/import',    element: <ContactImportPage />, visible: false },
  { name: 'WhatsApp Import',   path: '/outreach/whatsapp/contacts/import', element: <ContactImportPage />, visible: false },
  { name: 'Email Import',      path: '/outreach/email/contacts/import',    element: <ContactImportPage />, visible: false },

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
