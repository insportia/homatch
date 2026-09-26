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

import type { ReactNode } from 'react';
import React from 'react';
import { lazyRoute } from '@/lib/lazyRoute';
import { Navigate } from 'react-router-dom';
import HomePage from './pages/HomePage';

const LoginPage = lazyRoute(() => import('./pages/auth/LoginPage'));
const SignupPage = lazyRoute(() => import('./pages/auth/SignupPage'));
const AuthCallbackPage = lazyRoute(() => import('./pages/auth/AuthCallbackPage'));
const ResetPasswordPage = lazyRoute(() => import('./pages/auth/ResetPasswordPage'));
const ProfilePage = lazyRoute(() => import('./pages/ProfilePage'));
const PrivacyPage = lazyRoute(() => import('./pages/PrivacyPage'));
const TermsPage = lazyRoute(() => import('./pages/TermsPage'));
const DashboardPage = lazyRoute(() => import('./pages/DashboardPage'));
const ActivityPage = lazyRoute(() => import('./pages/ActivityPage'));
const NotificationsPage = lazyRoute(() => import('./pages/NotificationsPage'));
const AddPropertyPage = lazyRoute(() => import('./pages/property/AddPropertyPage'));
const URLImportPage = lazyRoute(() => import('./pages/property/URLImportPage'));
const PrivateListingPage = lazyRoute(() => import('./pages/property/PrivateListingPage'));
const PropertyDetailPage = lazyRoute(() => import('./pages/property/PropertyDetailPage'));
const MatchesPage = lazyRoute(() => import('./pages/property/MatchesPage'));
const CreditsPage = lazyRoute(() => import('./pages/CreditsPage'));
const ChatPage = lazyRoute(() => import('./pages/ChatPage'));
const LiveChatPage = lazyRoute(() => import('./pages/LiveChatPage'));
const ViewingsPage = lazyRoute(() => import('./pages/ViewingsPage'));
const ActiveSearchPage = lazyRoute(() => import('./pages/ActiveSearchPage'));
const DeveloperProfilePage = lazyRoute(() => import('./pages/DeveloperProfilePage'));
const AIPage = lazyRoute(() => import('./pages/AIPage'));
const VerifyPage = lazyRoute(() => import('./pages/VerifyPage'));
const MortgagePage = lazyRoute(() => import('./pages/MortgagePage'));
const ForExpatsPage = lazyRoute(() => import('./pages/ForExpatsPage'));
const ExpatTopicPage = lazyRoute(() => import('./pages/ExpatTopicPage'));
const ExpatPlanPage = lazyRoute(() => import('./pages/ExpatPlanPage'));
/*
 * HOMATCH INVESTMENT INTELLIGENCE.
 *
 * A first-class product alongside Verify and Mortgage, not a tool inside
 * one of them. Lazy like its siblings and public like /mortgage: the whole
 * deterministic workspace runs in the browser and works signed out, and
 * only the AI Consultant and the market sweep need an account (both
 * enforce that server-side, not by gating this route).
 */
const InvestmentPage = lazyRoute(() => import('./pages/InvestmentPage'));
const VerificationCasePage = lazyRoute(() => import('./pages/VerificationCasePage'));
const ContractsPage = lazyRoute(() => import('./pages/ContractsPage'));
const ContractResultPage = lazyRoute(() => import('./pages/ContractResultPage'));
const ContractsHistoryPage = lazyRoute(() => import('./pages/ContractsHistoryPage'));
const VerifyHistoryPage = lazyRoute(() => import('./pages/VerifyHistoryPage'));
const LegacyDealRoomRedirect = lazyRoute(() => import('./pages/LegacyDealRoomRedirect'));
// CasesPage import removed (2026-09-06 "REMOVE MY DEALS/CASES" mandate) —
// the /cases route below is intentionally not registered. The file itself
// is left in place (dormant), not deleted, in case this product surface
// is revisited later.
const PartnersPage = lazyRoute(() => import('./pages/PartnersPage'));
const PricingPage = lazyRoute(() => import('./pages/PricingPage'));
const DevelopersPage = lazyRoute(() => import('./pages/DevelopersPage'));
const AboutPage = lazyRoute(() => import('./pages/AboutPage'));
/*
 * HOMATCH FOR DEVELOPERS — the private sales workspace.
 *
 * /developers stays exactly what it was: the public commercial page. The
 * product itself lives underneath it at /developers/home, /developers/projects
 * and so on, which is why the marketing route keeps its exact path and every
 * one of these is deeper. A visitor who has never signed in still lands on
 * the page that explains the offer.
 */
const DeveloperStartPage = lazyRoute(() => import('./pages/developer/DeveloperStartPage'));
const DeveloperHomePage = lazyRoute(() => import('./pages/developer/DeveloperHomePage'));
const DeveloperProjectsPage = lazyRoute(() => import('./pages/developer/DeveloperProjectsPage'));
const DeveloperProjectPage = lazyRoute(() => import('./pages/developer/DeveloperProjectPage'));
const DeveloperContactsPage = lazyRoute(() => import('./pages/developer/DeveloperContactsPage'));
const DeveloperSalesOverviewPage = lazyRoute(() => import('./pages/developer/DeveloperSalesOverviewPage'));
const DeveloperViewingsPage = lazyRoute(() => import('./pages/developer/DeveloperViewingsPage'));
const DeveloperReservationsPage = lazyRoute(() => import('./pages/developer/DeveloperReservationsPage'));
const DeveloperOffersPage = lazyRoute(() => import('./pages/developer/DeveloperOffersPage'));
const DeveloperContractsPage = lazyRoute(() => import('./pages/developer/DeveloperContractsPage'));
const DeveloperCommissionsPage = lazyRoute(() => import('./pages/developer/DeveloperCommissionsPage'));
const DeveloperHandoverPage = lazyRoute(() => import('./pages/developer/DeveloperHandoverPage'));
const DeveloperPaymentsPage = lazyRoute(() => import('./pages/developer/DeveloperPaymentsPage'));
const DeveloperLedgerPage = lazyRoute(() => import('./pages/developer/DeveloperLedgerPage'));
const DeveloperDocumentsPage = lazyRoute(() => import('./pages/developer/DeveloperDocumentsPage'));
const DeveloperMarketingPage = lazyRoute(() => import('./pages/developer/DeveloperMarketingPage'));
const DeveloperInsightsPage = lazyRoute(() => import('./pages/developer/DeveloperInsightsPage'));
const DeveloperSettingsPage = lazyRoute(() => import('./pages/developer/DeveloperSettingsPage'));
const DeveloperExportTemplatesPage = lazyRoute(() => import('./pages/developer/DeveloperExportTemplatesPage'));
const DeveloperAuditPage = lazyRoute(() => import('./pages/developer/DeveloperAuditPage'));
const SharedUnitPage = lazyRoute(() => import('./pages/developer/SharedUnitPage'));
const PublicProjectPage = lazyRoute(() => import('./pages/developer/PublicProjectPage'));
const BuyerRoomPage = lazyRoute(() => import('./pages/developer/BuyerRoomPage'));
const TwinViewerPage = lazyRoute(() => import('./pages/developer/TwinViewerPage'));
const StudioPage = lazyRoute(() => import('./pages/developer/StudioPage'));
const StudioProjectPage = lazyRoute(() => import('./pages/developer/StudioProjectPage'));
/* The verification screen for the 2D -> 3D pipeline. Lazy like its
   siblings: it pulls the floor-plan renderer and nothing else does. */
const StudioFloorPlanPage = lazyRoute(() => import('./pages/developer/StudioFloorPlanPage'));
// Outreach pages
const OutreachHubPage = lazyRoute(() => import('./pages/outreach/OutreachHubPage'));
const CommunitiesPage = lazyRoute(() => import('./pages/outreach/CommunitiesPage'));
const ContactListsPage = lazyRoute(() => import('./pages/outreach/ContactListsPage'));
const EmailCampaignsPage = lazyRoute(() => import('./pages/outreach/EmailCampaignsPage'));
const SmsCampaignsPage = lazyRoute(() => import('./pages/outreach/SmsCampaignsPage'));
const OutreachInsightsPage = lazyRoute(() => import('./pages/outreach/OutreachInsightsPage'));
// Communications Hub. These EVOLVE the Outreach area rather than replacing it:
// every route above still exists and still works (§8).
const CommunicationsOverviewPage = lazyRoute(() => import('./pages/outreach/CommunicationsOverviewPage'));
const AgentsPage = lazyRoute(() => import('./pages/outreach/AgentsPage'));
const AgentBuilderPage = lazyRoute(() => import('./pages/outreach/AgentBuilderPage'));
const CampaignsPage = lazyRoute(() => import('./pages/outreach/CampaignsPage'));
const CampaignBuilderPage = lazyRoute(() => import('./pages/outreach/CampaignBuilderPage'));
const ContactsPage = lazyRoute(() => import('./pages/outreach/ContactsPage'));
const ContactImportPage = lazyRoute(() => import('./pages/outreach/ContactImportPage'));
const ContactProfilePage = lazyRoute(() => import('./pages/outreach/ContactProfilePage'));
const WhatsAppPage = lazyRoute(() => import('./pages/outreach/WhatsAppPage'));
const WhatsAppInboxPage = lazyRoute(() => import('./pages/outreach/WhatsAppInboxPage'));
const WhatsAppTemplatesPage = lazyRoute(() => import('./pages/outreach/WhatsAppTemplatesPage'));
const ChannelAccountsPage = lazyRoute(() => import('./pages/outreach/ChannelAccountsPage'));
const CommunicationsAnalyticsPage = lazyRoute(() => import('./pages/outreach/CommunicationsAnalyticsPage'));
const CallsPage = lazyRoute(() => import('./pages/outreach/CallsPage'));
const CommunicationsBillingPage = lazyRoute(() => import('./pages/outreach/CommunicationsBillingPage'));

// Admin pages
import AdminLayout from './components/layouts/AdminLayout';

const AdminOverviewPage = lazyRoute(() => import('./pages/admin/AdminOverviewPage'));
const AdminUsersPage = lazyRoute(() => import('./pages/admin/AdminUsersPage'));
const AdminUser360Page = lazyRoute(() => import('./pages/admin/AdminUser360Page'));
const AdminPropertiesPage = lazyRoute(() => import('./pages/admin/AdminPropertiesPage'));
const AdminCampaignsPage = lazyRoute(() => import('./pages/admin/AdminCampaignsPage'));
const AdminOutreachPage = lazyRoute(() => import('./pages/admin/AdminOutreachPage'));
const AdminMarketsPage = lazyRoute(() => import('./pages/admin/AdminMarketsPage'));
const AdminSourcesPage = lazyRoute(() => import('./pages/admin/AdminSourcesPage'));
const AdminSocialDiscoveryPage = lazyRoute(() => import('./pages/admin/AdminSocialDiscoveryPage'));
const AdminSignalsPage = lazyRoute(() => import('./pages/admin/AdminSignalsPage'));
const AdminMatchesPage = lazyRoute(() => import('./pages/admin/AdminMatchesPage'));
const AdminCreditsPage = lazyRoute(() => import('./pages/admin/AdminCreditsPage'));
const AdminPaymentsPage = lazyRoute(() => import('./pages/admin/AdminPaymentsPage'));
const AdminFinancePage = lazyRoute(() => import('./pages/admin/AdminFinancePage'));
const AdminProvidersPage = lazyRoute(() => import('./pages/admin/AdminProvidersPage'));
const AdminVerifyCogsPage = lazyRoute(() => import('./pages/admin/AdminVerifyCogsPage'));
const AdminVoiceAiPage = lazyRoute(() => import('./pages/admin/AdminVoiceAiPage'));
const AdminPricingPage = lazyRoute(() => import('./pages/admin/AdminPricingPage'));
const AdminSpendCapsPage = lazyRoute(() => import('./pages/admin/AdminSpendCapsPage'));
const AdminDiagnosticsPage = lazyRoute(() => import('./pages/admin/AdminDiagnosticsPage'));
const AdminStoragePage = lazyRoute(() => import('./pages/admin/AdminStoragePage'));
const AdminSponsoredPage = lazyRoute(() => import('./pages/admin/AdminSponsoredPage'));
const AdminSettingsPage = lazyRoute(() => import('./pages/admin/AdminSettingsPage'));
const AdminHealthPage = lazyRoute(() => import('./pages/admin/AdminHealthPage'));
const AdminRiskPage = lazyRoute(() => import('./pages/admin/AdminRiskPage'));
const SiteStudioPage = lazyRoute(() => import('./pages/admin/SiteStudioPage'));
const AppContentPage = lazyRoute(() => import('./pages/admin/AppContentPage'));
const AdminEngagementPage = lazyRoute(() => import('./pages/admin/AdminEngagementPage'));
const AdminLiveChatReportsPage = lazyRoute(() => import('./pages/admin/AdminLiveChatReportsPage'));
const AdminHomePage = lazyRoute(() => import('./pages/admin/AdminHomePage'));
const CommunicationOverviewPage = lazyRoute(() => import('./pages/admin/communication/CommunicationOverviewPage'));
const CommunicationVoicePage = lazyRoute(() => import('./pages/admin/communication/CommunicationVoicePage'));
const CommunicationCallCenterPage = lazyRoute(() => import('./pages/admin/communication/CommunicationCallCenterPage'));
const CommunicationEmailPage = lazyRoute(() => import('./pages/admin/communication/CommunicationEmailPage'));
const CommunicationWhatsAppPage = lazyRoute(() => import('./pages/admin/communication/CommunicationWhatsAppPage'));
const CommunicationUsagePage = lazyRoute(() => import('./pages/admin/communication/CommunicationUsagePage'));
const CommunicationAdvancedPage = lazyRoute(() => import('./pages/admin/communication/CommunicationAdvancedPage'));

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
  // Every verification this customer has run. The Center itself shows the
  // recent few; this is the rest, with search. Declared before the dynamic
  // route below so the literal path is never read as a case id.
  { name: 'Verification History', path: '/verify/history',        element: <VerifyHistoryPage /> },
  // One property = one persistent Verification Case. Authenticated only: a
  // case is a customer's private due-diligence work, and every table behind
  // it is owner-only under RLS. No longer reachable from the customer
  // journey — Verify results now open in the Center itself and contracts
  // have their own product — but kept so existing links never go dead.
  { name: 'Verification Case', path: '/verify/:id',               element: <VerificationCasePage /> },

  // CONTRACTS. A first-class product, not a feature inside a workspace: a
  // customer with a contract to understand comes straight here, uploads it,
  // and reads the result on its own page. Authenticated, because a contract
  // is the most sensitive thing anyone hands Homatch and every row behind
  // these screens is owner-only under RLS.
  { name: 'Contracts',         path: '/contracts',                element: <ContractsPage /> },
  // Before /contracts/:id, so the literal path is never captured as an id.
  { name: 'Contract History',  path: '/contracts/history',        element: <ContractsHistoryPage /> },
  { name: 'Contract',          path: '/contracts/:id',            element: <ContractResultPage /> },
  // Public like Verify: the calculator + educational explanations must work
  // for a signed-out visitor (mandate requirement); saving a scenario or
  // uploading a bank offer still requires auth, enforced by mortgage_scenarios
  // / mortgage_offers RLS (auth_user_id()-based, see the migration), not by
  // gating this route.
  { name: 'Mortgage',          path: '/mortgage',                 element: <MortgagePage />,      public: true },
  // Public for the same reason /mortgage is: every figure on the page is
  // computed in the browser by src/investment/calculations, so a signed-out
  // visitor gets the complete analytical product. The Consultant and the
  // market sweep return 401 on their own and the page says so in place.
  { name: 'Investment Intelligence', path: '/investment',         element: <InvestmentPage />,    public: true },
  /*
   * FOR EXPATS. Public, and more deliberately so than its neighbours: the
   * whole product proposition is that a foreigner who has never heard of
   * Homatch can understand Georgia before being asked for anything (§66).
   * Only the plan requires an account, and it requires one because it
   * stores somebody's citizenship and family — not to gate the value.
   *
   * The topic route is LAST of the three so that /for-expats/georgia/plan
   * could never be swallowed by :slug. It cannot today — the plan lives at
   * /for-expats/plan — and the ordering keeps it true if that ever moves.
   */
  { name: 'For Expats',        path: '/for-expats',               element: <Navigate to="/for-expats/georgia" replace />, public: true },
  { name: 'For Expats',        path: '/for-expats/georgia',       element: <ForExpatsPage />,     public: true },
  { name: 'My Expat Plan',     path: '/for-expats/plan',          element: <ExpatPlanPage />,     public: false },
  { name: 'For Expats topic',  path: '/for-expats/georgia/:slug', element: <ExpatTopicPage />,    public: true },
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
  { name: 'Admin Home',        path: '/admin',                    element: adminWrap(<AdminHomePage />),        adminOnly: true },
  { name: 'Admin Metrics',     path: '/admin/metrics',            element: adminWrap(<AdminOverviewPage />),    adminOnly: true },

  /*
   * AI & COMMUNICATION — one destination for every channel.
   *
   * These are routes rather than tabs so each one can be linked,
   * bookmarked and reached with the back button. The order matches the
   * secondary navigation in CommunicationShell, which reads it from
   * src/admin/navigation.ts.
   */
  { name: 'Admin Communication',        path: '/admin/communication',             element: adminWrap(<CommunicationOverviewPage />),   adminOnly: true },
  { name: 'Admin Voice',                path: '/admin/communication/voice',       element: adminWrap(<CommunicationVoicePage />),      adminOnly: true },
  { name: 'Admin Call Center',          path: '/admin/communication/call-center', element: adminWrap(<CommunicationCallCenterPage />), adminOnly: true },
  { name: 'Admin Email',                path: '/admin/communication/email',       element: adminWrap(<CommunicationEmailPage />),      adminOnly: true },
  { name: 'Admin WhatsApp',             path: '/admin/communication/whatsapp',    element: adminWrap(<CommunicationWhatsAppPage />),   adminOnly: true },
  { name: 'Admin Comms Usage',          path: '/admin/communication/usage',       element: adminWrap(<CommunicationUsagePage />),      adminOnly: true },
  { name: 'Admin Comms Advanced',       path: '/admin/communication/advanced',    element: adminWrap(<CommunicationAdvancedPage />),   adminOnly: true },
  { name: 'Admin Users',       path: '/admin/users',              element: adminWrap(<AdminUsersPage />),       adminOnly: true },
  { name: 'Admin User 360',    path: '/admin/user360',            element: adminWrap(<AdminUser360Page />),     adminOnly: true },
  { name: 'Admin Properties',  path: '/admin/properties',         element: adminWrap(<AdminPropertiesPage />),  adminOnly: true },
  { name: 'Admin Campaigns',   path: '/admin/campaigns',          element: adminWrap(<AdminCampaignsPage />),   adminOnly: true },
  { name: 'Admin Outreach',    path: '/admin/outreach',           element: adminWrap(<AdminOutreachPage />),    adminOnly: true },
  { name: 'Admin Markets',     path: '/admin/markets',            element: adminWrap(<AdminMarketsPage />),     adminOnly: true },
  { name: 'Admin Sources',     path: '/admin/sources',            element: adminWrap(<AdminSourcesPage />),     adminOnly: true },
  /* Connected Social Accounts. One place to connect an account and see what
     connecting actually buys.

     There is deliberately NO callback route here: the platform redirects
     straight to the edge function, which exchanges the code server-side and
     then sends the browser back to this page. An authorization code that never
     enters browser JavaScript cannot be read out of a history entry, a referrer
     or an extension. */
  { name: 'Admin Social Discovery', path: '/admin/social-discovery', element: adminWrap(<AdminSocialDiscoveryPage />), adminOnly: true },
  { name: 'Admin Signals',     path: '/admin/signals',            element: adminWrap(<AdminSignalsPage />),     adminOnly: true },
  { name: 'Admin Matches',     path: '/admin/matches',            element: adminWrap(<AdminMatchesPage />),     adminOnly: true },
  { name: 'Admin Credits',     path: '/admin/credits',            element: adminWrap(<AdminCreditsPage />),     adminOnly: true },
  { name: 'Admin Payments',    path: '/admin/payments',           element: adminWrap(<AdminPaymentsPage />),    adminOnly: true },
  { name: 'Admin Finance',     path: '/admin/finance',            element: adminWrap(<AdminFinancePage />),     adminOnly: true },
  { name: 'Admin Live Chat Reports', path: '/admin/live-chat-reports', element: adminWrap(<AdminLiveChatReportsPage />), adminOnly: true },
  { name: 'Admin Providers',   path: '/admin/providers',          element: adminWrap(<AdminProvidersPage />),   adminOnly: true },
  { name: 'Admin Verify COGS', path: '/admin/verify-cogs',        element: adminWrap(<AdminVerifyCogsPage />),  adminOnly: true },
  /*
   * The eleven-tab voice tooling moved into AI & communication. The URL
   * still resolves, because bookmarks to it predate the redesign and a
   * 404 is not an acceptable answer to a link that used to work. It is a
   * redirect and not a second copy: there is one Advanced page.
   */
  { name: 'Admin Voice AI (moved)', path: '/admin/voice-ai',      element: <Navigate to="/admin/communication/advanced" replace />, adminOnly: true, visible: false },
  { name: 'Admin Overview (moved)', path: '/admin/overview',      element: <Navigate to="/admin/metrics" replace />,               adminOnly: true, visible: false },
  { name: 'Admin Comms (alias)',    path: '/admin/comms',         element: <Navigate to="/admin/communication" replace />,          adminOnly: true, visible: false },
  { name: 'Admin Comms (alias 2)',  path: '/admin/communications', element: <Navigate to="/admin/communication" replace />,         adminOnly: true, visible: false },
  { name: 'Admin AI (alias)',       path: '/admin/ai',            element: <Navigate to="/admin/communication" replace />,          adminOnly: true, visible: false },
  { name: 'Admin Voice (alias)',    path: '/admin/voice',         element: <Navigate to="/admin/communication/voice" replace />,    adminOnly: true, visible: false },
  { name: 'Admin Email (alias)',    path: '/admin/email',         element: <Navigate to="/admin/communication/email" replace />,    adminOnly: true, visible: false },
  { name: 'Admin WhatsApp (alias)', path: '/admin/whatsapp',      element: <Navigate to="/admin/communication/whatsapp" replace />, adminOnly: true, visible: false },
  { name: 'Admin Calls (alias)',    path: '/admin/call-center',   element: <Navigate to="/admin/communication/call-center" replace />, adminOnly: true, visible: false },
  { name: 'Admin Pricing',     path: '/admin/pricing',            element: adminWrap(<AdminPricingPage />),     adminOnly: true },
  { name: 'Admin Spend Caps',  path: '/admin/spend-caps',         element: adminWrap(<AdminSpendCapsPage />),   adminOnly: true },
  { name: 'Admin Diagnostics', path: '/admin/diagnostics',        element: adminWrap(<AdminDiagnosticsPage />), adminOnly: true },
  { name: 'Admin Storage',     path: '/admin/storage',            element: adminWrap(<AdminStoragePage />),     adminOnly: true },
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
