"""Turn the cached Wikipedia wikitext into candidate gloss rows.

The {{interlinear}} / {{fs interlinear}} templates carry 2-6 content lines and
the roles are positional but NOT fixed: with three lines a page may mean
source/gloss/free OR source/transliteration/free, and with four it is
source/transliteration/gloss/free. Picking the wrong line silently fills the
gold set with romaji instead of glosses, so the role is detected, never assumed.
"""
import re,json,sys
from clean import strip_wiki, words

ENGLISH=set()
for line in open('/usr/share/dict/words',encoding='utf-8',errors='ignore'):
    w=line.strip().lower()
    if w: ENGLISH.add(w)
ENGLISH |= {"i","a","the","to","of","is","was","are","were","be","been","not","no",
 "that","this","these","those","he","she","it","they","we","you","him","her","them",
 "us","my","your","his","its","our","their","in","on","at","by","for","with","from",
 "and","or","but","if","as","than","then","there","here","who","what","when","where",
 "why","how","do","does","did","have","has","had","will","would","can","could","up",
 "down","out","off","over","about","into","onto","am","one","two","go","goes","went"}

TAG=re.compile(r'^[0-9]*[A-Z][A-Z0-9]+$')     # ACC, 1SG, PST, 3PL
def unbrace(s):
    """{multi word} marks one aligned unit -> hyphen-joined, the app convention."""
    return re.sub(r'\{([^{}]*)\}', lambda m: '-'.join(m.group(1).split()) or '∅', s)

def score_gloss(line):
    """How gloss-like a line is: the share of tokens carrying an English lemma
    or a Leipzig tag, plus the raw count of each. A romanization of Korean or
    Thai scores on the share alone (short syllables like `ni` and `an` are
    English words), so the caller also demands real evidence: several English
    lemmas, or a Leipzig tag."""
    toks=words(line)
    if not toks: return (0.0,0,0)
    eng=0; tags=0
    for t in toks:
        parts=[p for p in re.split(r'[-=.\[\]()/]', t.strip('.,;:!?\'"')) if p]
        if any(TAG.match(p) for p in parts): tags+=1; continue
        if any(p.lower() in ENGLISH and len(p)>2 for p in parts): eng+=1
    return ((eng+tags)/len(toks), eng, tags)

def pick_roles(pos):
    """(source, gloss, free) or None. `free` is the last line; the gloss is the
    most gloss-like of the middle lines, and must beat a floor so a page that
    supplies only a transliteration is rejected rather than guessed at."""
    pos=[p for p in pos if p.strip()!='']
    if len(pos)<3: return None
    src, free, middles = pos[0], pos[-1], pos[1:-1]
    scored=[(score_gloss(unbrace(strip_wiki(m))), m) for m in middles]
    scored.sort(key=lambda x:-x[0][0])
    (share, eng, tags), gloss = scored[0]
    # Share alone admits romanizations; require the line to also carry real
    # glossing evidence — a Leipzig tag, or several English words of substance.
    if share < 0.6: return None
    if tags == 0 and eng < 3: return None
    return src, gloss, free
