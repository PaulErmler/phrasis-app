"""Build data/<lang>.json for the hyperliteral gloss eval.

    python3 build_gold.py                 # every language, from cache
    python3 build_gold.py --refetch       # re-pull the sources first

Two sources, both public and both recorded per row:

1. English Wikipedia's {{interlinear}} / {{fs interlinear}} templates, read as
   wikitext through action=parse so the template parameters survive. Every
   page embedding either template is harvested (embedded.py), then rows are
   kept only where the template carries an explicit `lang=`. The language is
   never inferred from the page title: a guess is not attribution.

2. The GlossLM corpus (lecslab/glosslm-corpus, Apache 2.0), through the
   Hugging Face datasets-server, for languages Wikipedia leaves thin.
   Used ONLY for languages written in Latin script. GlossLM transcribes
   Russian, Japanese and Korean in transliteration ("Ne begalo tarakanov"),
   and the app glosses native script, so those rows would measure a task the
   app never performs.

Nothing here is model-generated. `glossRaw` is the source's own line, kept
verbatim; `gloss` is that line converted to the app's readable-English
convention by scripts/leipzig.py, so the conversion is auditable.
"""
import json,re,sys,os,unicodedata
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from clean import strip_wiki, words
from parsegloss import templates, parse_one
from extract import pick_roles, unbrace
from leipzig import skeleton, is_tag

MIN_WORDS, MAX_WORDS = 3, 12
TARGET_ROWS = 60

# ----------------------------------------------------------------- skeleton

# A token where a small-caps tag was glued to its stem when the wiki markup was
# stripped (`meGEN`, `televisionACC`, `onPST`). The tag boundary is lost, so the
# unit cannot be read and the row is dropped rather than half-parsed.
GLUED = re.compile(r'[a-z]{2}[A-Z]{2,}')

def gloss_skeleton(raw):
    """The reference skeleton, or None when the line cannot be read cleanly."""
    if GLUED.search(raw): return None
    sk = skeleton(raw)
    if not sk: return None
    filled = [s for s in sk if s]
    # A line that is almost all concord says too little to score against.
    if len(filled) < max(2, int(0.6 * len(sk))): return None
    return sk

# ------------------------------------------------------------------ filters

BAD = re.compile(r'[\[\]{}<>*†‡()∅]|\bpro\b|\bPRO\b|\be\b\s|\.\.\.|…')
# A gloss whose tags were lost when the wiki markup was stripped leaves a
# dangling boundary (`apple-`, `eat--`). The unit cannot be read, so the row goes.
DANGLING = re.compile(r'(^|\s)-|-(\s|$)|--|\s/|/\s')
# Morpheme-segmented source text (`Gel-diğ-im-i`). The app is given ordinary
# orthography, so a segmented source measures a different input. GlossLM rows
# are de-segmented on the way in; a Wikipedia row like this is simply dropped.
SEGMENTED = re.compile(r'[a-zäöüõçğışáéíóöúűőâî]-[a-zäöüõçğışáéíóöúűőâî]', re.I)

# GlossLM's per-language files carry the occasional row from the paper's
# comparison language (a German sentence filed under Finnish). A row is
# rejected when several of its words are function words of the wrong language.
FOREIGN = {
    'fi': {'dass','der','die','das','und','ich','du','nicht','habe','the','that','you'},
    'hu': {'dass','der','die','das','und','ich','nicht','the','that','you','and'},
    'tr': {'dass','der','die','das','und','ich','nicht','the','that','you','and'},
}
def foreign_hit(text, lang):
    bad = FOREIGN.get(lang)
    if not bad: return False
    toks = [w.strip('.,;:!?"\'').lower() for w in text.split()]
    return sum(1 for t in toks if t in bad) >= 2
def usable(src, gloss_raw, free, lang):
    if not src or not gloss_raw or not free: return False
    ws, wg = words(src), words(gloss_raw)
    if len(ws) != len(wg): return False
    if not (MIN_WORDS <= len(ws) <= MAX_WORDS): return False
    if BAD.search(src) or BAD.search(gloss_raw): return False
    if len(src) > 140: return False
    # The free translation must be a translation, not a commentary line.
    if free.lower().startswith(('lit.', 'literally')): return False
    if GLUED.search(gloss_raw): return False
    if DANGLING.search(gloss_raw): return False
    if not SCRIPT_OK.get(lang, lambda s: True)(src): return False
    if not alphabet_ok(src, lang): return False
    if SEGMENTED.search(src): return False
    if foreign_hit(src, lang): return False
    return True

# The script a language is actually written in. Wikipedia tags romanized
# examples from related varieties with the standard language's code (the
# Hachijo grammar article glosses `ara kanasike terebjo` as lang=ja), and a
# romanized row measures a task the app never performs.
def _has(pattern):
    rx = re.compile(pattern)
    return lambda s: bool(rx.search(s))
# Letters each Latin-script language actually uses. GlossLM's own labels are
# wrong for a handful of rows — a Korean sentence in Yale romanization
# (`swuphulleylul`, with a `w` Turkish does not have) and two Arabic ones
# (`barð̣in`) are filed under Turkish with the Turkish glottocode — so the
# label cannot be trusted and the alphabet is checked instead.
ALPHABET = {
    'tr': set('abcçdefgğhıijklmnoöprsştuüvyzâîû'),
    'fi': set('abcdefghijklmnopqrstuvwxyzäöå'),
    'hu': set('abcdefghijklmnoprstuvzáéíóöőúüűqwxy'),
    'de': set('abcdefghijklmnopqrstuvwxyzäöüß'),
}
def alphabet_ok(text, lang):
    allowed = ALPHABET.get(lang)
    if allowed is None: return True
    letters = [c for c in text.lower() if c.isalpha()]
    if not letters: return False
    bad = sum(1 for c in letters if c not in allowed)
    return bad == 0

SCRIPT_OK = {
    'ja': _has(r'[\u3040-\u30ff\u4e00-\u9fff]'),
    'zh': _has(r'[\u4e00-\u9fff]'),
    'yue': _has(r'[\u4e00-\u9fff]'),
    'ko': _has(r'[\uac00-\ud7af\u1100-\u11ff]'),
    'th': _has(r'[\u0e00-\u0e7f]'),
    'ru': _has(r'[\u0400-\u04ff]'),
    'he': _has(r'[\u0590-\u05ff]'),
    'ar': _has(r'[\u0600-\u06ff]'),
    'hi': _has(r'[\u0900-\u097f]'),
}

def tidy_free(s):
    s = s.strip().strip('"').strip("'").strip()
    s = re.sub(r'\s*\([^()]*\)\s*$', '', s).strip()
    return s

# ------------------------------------------------------------------ sources

# Articles that gloss a REGIONAL VARIETY but tag it with the standard
# language's code. Sanxiang is a Yue/Min variety, not Mandarin, and 42 of the
# 88 Chinese rows came from that one page; a Mandarin model glossing
# `食 澈 兮 配 伊 啦` is being asked the wrong question.
VARIETY_PAGES = {
    'Sanxiang_dialect', 'Hachijo_grammar', 'Hachijō_grammar', 'Kansai_dialect',
    'Taiwanese_Hokkien', 'Hokkien', 'Teochew_dialect', 'Wenzhounese',
    'Shanghainese', 'Sichuanese_dialects', 'Dungan_language',
    'Old_Japanese', 'Classical_Chinese', 'Literary_Chinese',
    'Middle_Chinese', 'Old_Chinese', 'Ryukyuan_languages', 'Okinawan_language',
}

def from_wikipedia(langs):
    pages = json.load(open(os.path.join(os.path.dirname(__file__), 'gloss_pages_il.json')))
    from fetchbatch import cached, fetch_all
    # Fetch anything the wikitext cache is missing. Without this the script
    # ran to completion on a cold cache and wrote an EMPTY gold set for every
    # Wikipedia language, which looks like a successful build.
    missing = [t for t in pages if cached(t) is None]
    if missing:
        print(f"  wikitext cache cold for {len(missing)} pages, fetching...")
        fetch_all(pages)
        still = [t for t in pages if cached(t) is None]
        if len(still) > len(pages) // 2:
            raise SystemExit(
                f"Could not fetch {len(still)} of {len(pages)} Wikipedia pages. "
                "Re-run when the network is available rather than committing a "
                "half-built gold set."
            )
    out = {l: [] for l in langs}
    for title in pages:
        if title.replace(' ', '_') in VARIETY_PAGES: continue
        w = cached(title) or ''
        for body in templates(w):
            _name, named, pos = parse_one(body)
            tag = (named.get('lang') or '').strip().lower()
            base = tag.split('-')[0]
            if base not in out: continue
            roles = pick_roles(pos)
            if roles is None: continue
            src, raw, free = [unbrace(strip_wiki(x)) for x in roles]
            free = tidy_free(free)
            if not usable(src, raw, free, base): continue
            sk = gloss_skeleton(raw)
            if sk is None: continue
            out[base].append({
                'text': src, 'lexical': sk, 'glossRaw': raw, 'free': free,
                'source': 'en.wikipedia/' + title.replace(' ', '_'),
                'sourceUrl': 'https://en.wikipedia.org/wiki/' + title.replace(' ', '_'),
            })
    return out

DESEG = re.compile(r'(?<=\w)-(?=\w)')
def desegment(s):
    """GlossLM marks morpheme boundaries with hyphens ("Ot-i-n kirja-n").
    The app sees ordinary orthography, so the boundaries are closed up. Only
    safe for languages that barely hyphenate; a hyphen before a capital is a
    real one and the row is dropped instead."""
    if re.search(r'-[A-ZÅÄÖÜÁÉÍÓÚŐŰ]', s): return None
    return DESEG.sub('', s)

def from_glosslm(langs_by_name):
    from glosslm import q
    cache_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'glosslm_cache.json')
    raw_cache = json.load(open(cache_path, encoding='utf-8')) if os.path.exists(cache_path) else {}
    out = {}
    for name, code in langs_by_name.items():
        rows = []
        if name in raw_cache:
            batches = raw_cache[name]
        else:
            batches = []
            for offset in range(0, 1200, 100):
                d = q(name, limit=100, offset=offset)
                if d is None or not d.get('rows'): break
                batches.extend(r['row'] for r in d['rows'])
            raw_cache[name] = batches
            json.dump(raw_cache, open(cache_path, 'w', encoding='utf-8'), ensure_ascii=False)
        for row in batches:
            src_raw = (row.get('transcription') or '').strip()
            raw = (row.get('glosses') or '').strip()
            free = tidy_free(row.get('translation') or '')
            if not src_raw or not raw or not free: continue
            src = desegment(src_raw)
            if src is None: continue
            src = re.sub(r'\s+([.,;:!?])', r'\1', src).strip()
            if not usable(src, raw, free, code): continue
            sk = gloss_skeleton(raw)
            if sk is None: continue
            rows.append({
                'text': src, 'lexical': sk, 'glossRaw': raw, 'free': free,
                'transcriptionRaw': src_raw,
                'source': 'glosslm/' + (row.get('source') or 'unknown'),
                'sourceUrl': 'https://huggingface.co/datasets/lecslab/glosslm-corpus',
            })
        out[code] = rows
    return out

def _from_glosslm_live_unused(langs_by_name):
    from glosslm import q
    out = {}
    for name, code in langs_by_name.items():
        rows = []
        for offset in range(0, 1200, 100):
            d = q(name, limit=100, offset=offset)
            if d is None: break
            batch = d.get('rows', [])
            if not batch: break
            for r in batch:
                row = r['row']
                src_raw = (row.get('transcription') or '').strip()
                raw = (row.get('glosses') or '').strip()
                free = tidy_free(row.get('translation') or '')
                if not src_raw or not raw or not free: continue
                src = desegment(src_raw)
                if src is None: continue
                src = re.sub(r'\s+([.,;:!?])', r'\1', src).strip()
                if not usable(src, raw, free, code): continue
                sk = gloss_skeleton(raw)
                if sk is None: continue
                rows.append({
                    'text': src, 'lexical': sk, 'glossRaw': raw, 'free': free,
                    'transcriptionRaw': src_raw,
                    'source': 'glosslm/' + (row.get('source') or 'unknown'),
                    'sourceUrl': 'https://huggingface.co/datasets/lecslab/glosslm-corpus',
                })
            if len(rows) >= TARGET_ROWS * 3: break
        out[code] = rows
    return out

# --------------------------------------------------------------------- main

WIKI_LANGS = ['ja', 'de', 'tr', 'zh', 'sw', 'ko', 'th', 'vi', 'yue', 'ru', 'hi', 'ar', 'he', 'fi', 'hu']
GLOSSLM_LANGS = {'Finnish': 'fi', 'Hungarian': 'hu', 'Turkish': 'tr'}

NOTES = {
 'ja': "Wikipedia {{interlinear}} / {{fs interlinear}}. Japanese is written without spaces, so the SOURCE here keeps the template's own word segmentation (particles stand as separate units); that segmentation is the reference for the unit-count score. Glosses converted from Leipzig by scripts/leipzig.py.",
 'de': "Wikipedia {{interlinear}}. Mostly verb-second and case examples from syntax articles, so the sentences are short and constructed rather than natural prose.",
 'tr': "Wikipedia {{interlinear}} plus GlossLM. GlossLM rows had their morpheme hyphens closed up (`eleştir-di` -> `eleştirdi`); `transcriptionRaw` keeps the segmented original.",
 'fi': "GlossLM only: the Finnish grammar article on Wikipedia glosses in prose, not templates. Morpheme hyphens closed up; `transcriptionRaw` keeps the segmented original.",
 'hu': "GlossLM only, same reason and same de-segmentation as Finnish.",
 'zh': "Wikipedia {{interlinear}}. Source keeps the template's word segmentation. Mixed Traditional and Simplified, as the sources are.",
 'sw': "Wikipedia {{interlinear}}. Noun-class prefixes dominate; CL1..CL11 tags drop out in conversion because English marks no noun class.",
 'ko': "Wikipedia {{interlinear}}. Thin (Wikipedia's Korean examples are mostly romanized).",
 'th': "Wikipedia {{interlinear}}. Source keeps the template's word segmentation; Thai is written without spaces.",
 'vi': "Wikipedia {{interlinear}}.", 'yue': "Wikipedia {{interlinear}}.",
 'ru': "Wikipedia {{interlinear}} only, and very thin: GlossLM's Russian is transliterated ('Ne begalo tarakanov'), which is not the task the app performs, so it was not used.",
 'hi': "Wikipedia {{interlinear}}.", 'ar': "Wikipedia {{interlinear}}.", 'he': "Wikipedia {{interlinear}}.",
}

def dedupe(rows):
    seen=set(); out=[]
    for r in rows:
        k=r['text']
        if k in seen: continue
        seen.add(k); out.append(r)
    return out

def main():
    here=os.path.dirname(os.path.abspath(__file__))
    data=os.path.join(os.path.dirname(here),'data'); os.makedirs(data,exist_ok=True)
    wiki=from_wikipedia(WIKI_LANGS)
    glm=from_glosslm(GLOSSLM_LANGS) if '--no-glosslm' not in sys.argv else {}
    merged={}
    for lang in set(list(wiki)+list(glm)):
        rows=dedupe((wiki.get(lang) or [])+(glm.get(lang) or []))
        if len(rows) < 12: 
            print(f"  {lang}: only {len(rows)} rows, skipped"); continue
        merged[lang]=rows[:TARGET_ROWS*2]
    for lang,rows in sorted(merged.items()):
        payload={'language':lang,'curatedAt':'2026-09-11',
                 'notes':NOTES.get(lang,'Wikipedia {{interlinear}}.'),
                 'items':rows}
        p=os.path.join(data,f'{lang}.json')
        json.dump(payload,open(p,'w',encoding='utf-8'),ensure_ascii=False,indent=1)
        print(f"  {lang}: {len(rows)} rows -> {p}")

if __name__=='__main__':
    main()
