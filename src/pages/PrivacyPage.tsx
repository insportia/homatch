import React from 'react';
import { Link } from 'react-router-dom';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { Shield } from 'lucide-react';

const LAST_UPDATED = 'August 28, 2026';

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="text-sm text-muted-foreground leading-relaxed space-y-2">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* ── Nav ──────────────────────────────────────────────── */}
      <header className="border-b border-border/50 px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link to="/">
            <HomatchLogo size="sm" />
          </Link>
          <Link
            to="/terms"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Terms of Service →
          </Link>
        </div>
      </header>

      {/* ── Content ──────────────────────────────────────────── */}
      <main className="flex-1 px-4 py-12">
        <div className="max-w-3xl mx-auto space-y-10">
          {/* Header */}
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border border-border bg-secondary">
              <Shield className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-primary uppercase tracking-wide">Privacy Policy</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground text-balance">
              Homatch Privacy Policy
            </h1>
            <p className="text-sm text-muted-foreground">
              Last updated: {LAST_UPDATED}
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Homatch ("we", "us", or "our") operates the website{' '}
              <a href="https://homatch.live" className="text-primary hover:underline">
                homatch.live
              </a>{' '}
              and the Homatch AI property-matching service. This Privacy Policy explains how we
              collect, use, store, and protect your personal information when you use our service.
              By using Homatch, you agree to the practices described in this policy.
            </p>
          </div>

          <div className="w-full h-px bg-border/50" />

          <Section title="1. Information We Collect">
            <p>We collect information you provide directly, information collected automatically, and information from third-party services you connect.</p>
            <p className="font-medium text-foreground mt-3">a) Account Information (Google Sign-In)</p>
            <p>
              When you sign in with Google, we receive the following data from Google's OAuth 2.0
              service: your name, email address, and profile photo URL. This information is used
              solely to create and manage your Homatch account.
            </p>
            <p className="font-medium text-foreground mt-3">b) Property Data</p>
            <p>
              URLs of property listings you submit for analysis, property details you enter manually
              (price, location, size, property type), and preferences you specify in your search
              profile.
            </p>
            <p className="font-medium text-foreground mt-3">c) Usage Data</p>
            <p>
              Log data (IP address, browser type, pages visited, timestamps), device information,
              and aggregated analytics about how you use the service.
            </p>
            <p className="font-medium text-foreground mt-3">d) Payment Information</p>
            <p>
              If you purchase credits, payment processing is handled by Stripe. We store only the
              transaction amount, currency, and status. We do not store full card numbers or
              sensitive payment details.
            </p>
          </Section>

          <Section title="2. How We Use Your Information">
            <ul className="list-disc list-inside space-y-1.5">
              <li>To create and authenticate your account</li>
              <li>To run AI property-matching analysis on your submitted listings</li>
              <li>To deliver match results and notifications to you</li>
              <li>To process credit purchases and manage your credit balance</li>
              <li>To provide customer support</li>
              <li>To improve the accuracy and performance of our matching algorithms</li>
              <li>To send service-related emails (account activity, important updates)</li>
              <li>To comply with legal obligations</li>
            </ul>
            <p className="mt-3">
              <span className="font-medium text-foreground">Google User Data:</span> Data obtained
              from Google Sign-In (name, email, profile photo) is used exclusively for
              authentication and to personalise your account experience. It is not used for
              advertising, sold to third parties, or shared with any party except as described in
              Section 4.
            </p>
          </Section>

          <Section title="3. Data Storage and Security">
            <p>
              Your data is stored in a Supabase-managed PostgreSQL database hosted on secure
              cloud infrastructure (AWS). We implement the following security measures:
            </p>
            <ul className="list-disc list-inside space-y-1.5 mt-2">
              <li>All data transmitted between your browser and our servers is encrypted using TLS/HTTPS</li>
              <li>Database access is protected by Row-Level Security (RLS) — you can only access your own data</li>
              <li>Passwords are never stored; authentication is delegated to Google OAuth via Supabase Auth</li>
              <li>Access tokens are short-lived and stored only in memory or secure storage</li>
              <li>Database credentials and API keys are stored as encrypted secrets, never in source code</li>
            </ul>
            <p className="mt-3">
              Despite our security measures, no system is 100% secure. We encourage you to use a
              strong password on your Google account and to notify us immediately at{' '}
              <a href="mailto:privacy@homatch.live" className="text-primary hover:underline">
                privacy@homatch.live
              </a>{' '}
              if you suspect unauthorised access to your account.
            </p>
          </Section>

          <Section title="4. Information Sharing and Disclosure">
            <p>We do not sell, rent, or trade your personal information. We may share data only in these limited circumstances:</p>
            <ul className="list-disc list-inside space-y-1.5 mt-2">
              <li>
                <span className="font-medium text-foreground">Service Providers:</span> Third-party
                vendors who help us operate the service (Supabase for database/auth, Stripe for
                payments, OpenAI for AI processing). These providers are contractually bound to use
                your data only to provide services to us.
              </li>
              <li>
                <span className="font-medium text-foreground">Legal Requirements:</span> If required
                by law, regulation, or valid legal process (e.g., court order or subpoena).
              </li>
              <li>
                <span className="font-medium text-foreground">Business Transfer:</span> In the event
                of a merger, acquisition, or sale of assets, your data may be transferred as part of
                that transaction. You will be notified in advance.
              </li>
              <li>
                <span className="font-medium text-foreground">Safety:</span> To protect the rights,
                property, or safety of Homatch, our users, or the public.
              </li>
            </ul>
          </Section>

          <Section title="5. Cookies and Tracking">
            <p>
              We use essential cookies and local storage to maintain your session and preferences.
              We do not use third-party advertising cookies. We may use anonymised analytics to
              understand aggregate usage patterns. You can disable cookies in your browser settings,
              but this may affect functionality.
            </p>
          </Section>

          <Section title="6. Data Retention">
            <p>
              We retain your account data for as long as your account is active or as needed to
              provide the service. If you delete your account, we will delete your personal data
              within 30 days, except where we are required to retain it for legal purposes. Aggregated,
              anonymised analytics data may be retained indefinitely.
            </p>
          </Section>

          <Section title="7. Your Rights">
            <p>Depending on your location, you may have the following rights regarding your personal data:</p>
            <ul className="list-disc list-inside space-y-1.5 mt-2">
              <li><span className="font-medium text-foreground">Access:</span> Request a copy of data we hold about you</li>
              <li><span className="font-medium text-foreground">Correction:</span> Request correction of inaccurate data</li>
              <li><span className="font-medium text-foreground">Deletion:</span> Request deletion of your account and associated data</li>
              <li><span className="font-medium text-foreground">Portability:</span> Request your data in a machine-readable format</li>
              <li><span className="font-medium text-foreground">Objection:</span> Object to certain types of processing</li>
            </ul>
            <p className="mt-3">
              To exercise any of these rights, contact us at{' '}
              <a href="mailto:privacy@homatch.live" className="text-primary hover:underline">
                privacy@homatch.live
              </a>
              . We will respond within 30 days.
            </p>
          </Section>

          <Section title="8. Google API Services Disclosure">
            <p>
              Homatch uses Google OAuth 2.0 for authentication. Our use and transfer of information
              received from Google APIs adheres to the{' '}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements. We only request access to your basic profile
              information (name, email, profile photo) and do not access your Google Drive, Gmail,
              Contacts, or any other Google services.
            </p>
          </Section>

          <Section title="9. Children's Privacy">
            <p>
              Homatch is not directed at children under 16 years of age. We do not knowingly collect
              personal information from children under 16. If we discover we have inadvertently
              collected such data, we will delete it promptly.
            </p>
          </Section>

          <Section title="10. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time. When we make material changes,
              we will update the "Last updated" date at the top of this page and, where appropriate,
              notify you by email. Your continued use of the service after changes take effect
              constitutes your acceptance of the revised policy.
            </p>
          </Section>

          <Section title="11. Contact Us">
            <p>
              If you have any questions or concerns about this Privacy Policy or our data practices,
              please contact us:
            </p>
            <div className="mt-2 p-4 rounded-xl border border-border bg-card space-y-1">
              <p className="font-medium text-foreground">Homatch</p>
              <p>
                Email:{' '}
                <a href="mailto:privacy@homatch.live" className="text-primary hover:underline">
                  privacy@homatch.live
                </a>
              </p>
              <p>
                Website:{' '}
                <a href="https://homatch.live" className="text-primary hover:underline">
                  homatch.live
                </a>
              </p>
            </div>
          </Section>
        </div>
      </main>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-border/50 px-4 py-5">
        <div className="max-w-3xl mx-auto flex flex-col md:flex-row items-center justify-between gap-2">
          <Link to="/">
            <HomatchLogo size="sm" />
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/privacy" className="text-xs text-primary">Privacy Policy</Link>
            <Link to="/terms" className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">Terms of Service</Link>
          </div>
          <p className="text-xs text-muted-foreground/50">
            © {new Date().getFullYear()} Homatch. AI Property Matching.
          </p>
        </div>
      </footer>
    </div>
  );
}
