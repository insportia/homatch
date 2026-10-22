// Copy for External Matching campaigns (workspace, history, service identity),
// the unlocked contact library, the message assistant and Email Studio.
// Source of truth: one JSON file per language next to this module, English
// first; assembled here into the shared splicer's [en, ka, ru, tr, ar, he] shape.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (lang) => JSON.parse(fs.readFileSync(path.join(here, `campaign-studio-i18n-${lang}.json`), 'utf8'));
const bundles = ['en', 'ka', 'ru', 'tr', 'ar', 'he'].map(read);

export const CAMPAIGN_STUDIO_STRINGS = Object.fromEntries(
  Object.keys(bundles[0]).map((key) => [key, bundles.map((b) => b[key])]),
);
