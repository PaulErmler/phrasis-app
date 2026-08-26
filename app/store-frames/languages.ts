/**
 * Language list for the store frames, read off `SUPPORTED_LANGUAGES` so the
 * names and flags match what the app actually offers.
 */
import { SUPPORTED_LANGUAGES } from '@/lib/languages';

export interface LangPill {
  code: string;
  label: string;
  flag: string;
  variant?: string;
  group: string;
}

const GROUP_LABEL: Record<string, string> = {
  romance: 'Romance',
  germanic: 'Germanic',
  slavic: 'Slavic',
  baltic: 'Baltic & Nordic',
  'asian-east': 'East Asian',
  'asian-southeast': 'Southeast Asian',
  'south-asian': 'South Asian',
  semitic: 'Middle East',
  african: 'African',
  other: 'Other',
};

/** "Arabic (Levantine)" becomes label "Arabic", variant "Levantine". */
function split(name: string): { label: string; variant?: string } {
  const m = name.match(/^(.*?)\s*\((.*)\)$/);
  return m ? { label: m[1], variant: m[2] } : { label: name };
}

export const LANGS: LangPill[] = SUPPORTED_LANGUAGES.filter(
  (l) => l.code !== 'en' && l.code !== 'es_mixed',
).map((l) => ({
  code: l.code,
  flag: l.flag,
  group: GROUP_LABEL[l.category] ?? 'Other',
  ...split(l.name),
}));

/** One entry per language, dialects folded away. */
export const BASE_LANGS: LangPill[] = (() => {
  const seen = new Set<string>();
  const out: LangPill[] = [];
  for (const l of LANGS) {
    if (seen.has(l.label)) continue;
    seen.add(l.label);
    out.push(l);
  }
  return out;
})();

export const GROUPED: { group: string; langs: LangPill[] }[] = (() => {
  const order = [
    'Romance',
    'Germanic',
    'Slavic',
    'Baltic & Nordic',
    'East Asian',
    'Southeast Asian',
    'South Asian',
    'Middle East',
    'African',
    'Other',
  ];
  return order
    .map((group) => ({
      group,
      langs: BASE_LANGS.filter((l) => l.group === group),
    }))
    .filter((g) => g.langs.length > 0);
})();

export const COUNTS = {
  languages: BASE_LANGS.length,
  withDialects: LANGS.length,
};
