/* The per-language bundles cut from translations.ts at build time
   (vite.config.ts, i18nLanguageChunks). */
declare module 'virtual:homatch-i18n/*' {
  const bundle: Record<string, string>;
  export default bundle;
}
