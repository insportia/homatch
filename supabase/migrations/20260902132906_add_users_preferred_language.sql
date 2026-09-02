-- Homatch-wide i18n repair: persist the user's chosen interface language on
-- their account so it can be restored on a new device/session. This is the
-- ONLY new column added for the localization work — no separate preferences
-- table, since users already has room for simple account-level settings
-- (see nickname/phone from the prior migration).
--
-- Nullable and unconstrained-by-CHECK on purpose: the application is the
-- single source of truth for the supported-language set (SupportedLanguage
-- in src/types/types.ts); a CHECK constraint here would require a migration
-- every time a language is added/removed. The value is validated against
-- the same fixed set on both read (LanguageContext.applyProfileLanguage)
-- and write (LanguageSwitcher / ProfilePage) paths, and Edge Functions
-- normalize any locale/language input server-side (resolveLang) before
-- ever using it, so an unexpected value here can not reach a prompt or the
-- UI unvalidated.
alter table public.users
  add column if not exists preferred_language text;

comment on column public.users.preferred_language is
  'User-selected Homatch interface language (en/ka/ru/tr/ar/he). Written only when the user explicitly changes language while signed in; read once on login as a fallback when the device has no local language preference yet. Never overwrites a preference already made on the current device.';
