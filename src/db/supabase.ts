import { createClient } from "@supabase/supabase-js";
import {
  IMPERSONATION_AUTH_KEY,
  impersonationAuthStorage,
  installReadOnlyGuards,
  readImpersonation,
} from "@/lib/impersonation";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/*
 * ONE CLIENT PER TAB, CHOSEN ONCE.
 *
 * An ordinary tab gets the ordinary client: PKCE, persisted to localStorage,
 * refreshed automatically. A tab an administrator switched into "Log in as
 * user" gets a client with its OWN storage key, backed by memory and seeded
 * with the target's short-lived access token — so the admin's persisted
 * session is never read or overwritten — and narrowed to reading. See
 * src/lib/impersonation.ts.
 */
const impersonation = typeof window !== "undefined" ? readImpersonation() : null;

export const supabase = impersonation
  ? installReadOnlyGuards(createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storageKey: IMPERSONATION_AUTH_KEY,
        storage: impersonationAuthStorage(impersonation),
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }))
  : createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    });
