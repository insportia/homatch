import React from 'react';
import type { ReactNode } from 'react';
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
// CasesPage import removed (2026-09-06 "REMOVE MY DEALS/CASES" mandate) —
// the /cases route below is intentionally not registered. The file itself
// is left in place (dormant), not deleted, in case this product surface
// is revisited later.
import PartnersPage from './pages/PartnersPage';
// Outreach pages
import OutreachHubPage from './pages/outreach/OutreachHubPage';
import CommunitiesPage from './pages/outreach/CommunitiesPage';
import ContactListsPage from './pages/outreach/ContactListsPage';
import EmailCampaignsPage from './pages/outreach/EmailCampaignsPage';
import SmsCampaignsPage from './pages/outreach/SmsCampaignsPage';
import AiCallCenterPage from './pages/outreach/AiCallCenterPage';
import OutreachInsightsPage from './pages/outreach/OutreachInsightsPage';
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
import AdminProvidersPage from './pages/admin/AdminProvidersPage';
import AdminPricingPage from './pages/admin/AdminPricingPage';
import AdminSpendCapsPage from './pages/admin/AdminSpendCapsPage';
import AdminDiagnosticsPage from './pages/admin/AdminDiagnosticsPage';
import AdminSponsoredPage from './pages/admin/AdminSponsoredPage';
import AdminSettingsPage from './pages/admin/AdminSettingsPage';
import AdminHealthPage from './pages/admin/AdminHealthPage';
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
  { name: 'Login',             path: '/auth/login',               element: <LoginPage />,         public: true },
  { name: 'Signup',            path: '/auth/signup',              element: <SignupPage />,        public: true },
  { name: 'Auth Callback',     path: '/auth/callback',            element: <AuthCallbackPage />,  public: true },
  { name: 'Reset Password',    path: '/auth/reset-password',      element: <ResetPasswordPage />, public: true },
  { name: 'Privacy Policy',    path: '/privacy',                  element: <PrivacyPage />,       public: true },
  { name: 'Terms of Service',  path: '/terms',                    element: <TermsPage />,         public: true },
  { name: 'AI Assistant',      path: '/ai',                       element: <AIPage />,            public: false },
  { name: 'Verify',            path: '/verify',                   element: <VerifyPage />,        public: true },
  // 'My Deals' / '/cases' route intentionally removed from the product
  // (2026-09-06 mandate) — see the CasesPage import comment above.
  { name: 'Partners',          path: '/partners',                 element: <PartnersPage />,      public: true },
  // Customer
  { name: 'Dashboard',         path: '/dashboard',                element: <DashboardPage /> },
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
  { name: 'Outreach Hub',      path: '/outreach',                 element: <OutreachHubPage /> },
  { name: 'Communities',       path: '/outreach/communities',     element: <CommunitiesPage /> },
  { name: 'Contact Lists',     path: '/outreach/contact-lists',   element: <ContactListsPage /> },
  { name: 'Email Campaigns',   path: '/outreach/email',           element: <EmailCampaignsPage /> },
  { name: 'SMS Campaigns',     path: '/outreach/sms',             element: <SmsCampaignsPage /> },
  { name: 'AI Call Center',    path: '/outreach/calls',           element: <AiCallCenterPage /> },
  { name: 'Outreach Insights', path: '/outreach/insights',        element: <OutreachInsightsPage /> },
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
  { name: 'Admin Live Chat Reports', path: '/admin/live-chat-reports', element: adminWrap(<AdminLiveChatReportsPage />), adminOnly: true },
  { name: 'Admin Providers',   path: '/admin/providers',          element: adminWrap(<AdminProvidersPage />),   adminOnly: true },
  { name: 'Admin Pricing',     path: '/admin/pricing',            element: adminWrap(<AdminPricingPage />),     adminOnly: true },
  { name: 'Admin Spend Caps',  path: '/admin/spend-caps',         element: adminWrap(<AdminSpendCapsPage />),   adminOnly: true },
  { name: 'Admin Diagnostics', path: '/admin/diagnostics',        element: adminWrap(<AdminDiagnosticsPage />), adminOnly: true },
  { name: 'Admin Sponsored',   path: '/admin/sponsored',          element: adminWrap(<AdminSponsoredPage />),   adminOnly: true },
  { name: 'Admin Settings',    path: '/admin/settings',           element: adminWrap(<AdminSettingsPage />),    adminOnly: true },
  { name: 'Admin Health',      path: '/admin/health',             element: adminWrap(<AdminHealthPage />),      adminOnly: true },
];
