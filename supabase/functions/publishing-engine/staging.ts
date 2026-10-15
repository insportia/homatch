/** Isolated publishing preview entrypoint. This cannot run against production. */
if (Deno.env.get('SUPABASE_URL') !== 'https://icqzvgbztuuvgmwcyyav.supabase.co') throw Error('STAGING_PROJECT_REQUIRED');
await import('./index.ts');
export {};
