import re,html,unicodedata

def strip_wiki(s):
    """Wiki markup -> plain text. Order matters."""
    s = s.replace('\n',' ')
    # refs, comments, small templates that carry no text
    s = re.sub(r'<ref[^>]*?/>','',s)
    s = re.sub(r'<ref.*?</ref>','',s,flags=re.S|re.I)
    s = re.sub(r'<!--.*?-->','',s,flags=re.S)
    # {{lang|xx|TEXT}} / {{transliteration|xx|TEXT}} / {{wikt-lang|xx|TEXT}} -> TEXT
    for _ in range(6):
        s2 = re.sub(r'\{\{\s*(?:lang|langx|transliteration|transl|wikt-lang|lang-\w+|script|nowrap|nobr|noitalic|smallcaps|sc)\s*\|([^{}|]*\|)*?([^{}|]*)\}\}', r'\2', s, flags=re.I)
        # {{gloss|x}} / {{abbr|A|B}} -> first arg
        s2 = re.sub(r'\{\{\s*(?:abbr|tooltip)\s*\|([^{}|]*)\|[^{}]*\}\}', r'\1', s2, flags=re.I)
        s2 = re.sub(r'\{\{\s*(?:gloss|q|qualifier)\s*\|([^{}|]*)\}\}', r'\1', s2, flags=re.I)
        s2 = re.sub(r'\{\{\s*(?:font color|color)\s*\|[^{}|]*\|([^{}|]*)\}\}', r'\1', s2, flags=re.I)
        s2 = re.sub(r'\{\{\s*(?:font color|color)\s*\|[^{}|]*\|[^{}|]*\|([^{}|]*)\}\}', r'\1', s2, flags=re.I)
        if s2==s: break
        s=s2
    # any remaining template: drop it
    s = re.sub(r'\{\{[^{}]*\}\}','',s)
    # links
    s = re.sub(r'\[\[[^\]\|]*\|([^\]]*)\]\]', r'\1', s)
    s = re.sub(r'\[\[([^\]]*)\]\]', r'\1', s)
    s = re.sub(r'\[https?://\S+\s+([^\]]*)\]', r'\1', s)
    s = re.sub(r'https?://\S+','',s)
    # html
    s = re.sub(r'<br\s*/?>',' ',s,flags=re.I)
    s = re.sub(r'<[^>]+>','',s)
    s = html.unescape(s)
    # emphasis
    s = s.replace("'''''","").replace("'''","").replace("''","")
    s = s.replace('&nbsp;',' ').replace(' ',' ')
    s = re.sub(r'\s+',' ',s).strip()
    return s

# Leipzig-ish tags we keep as bracketed markers
KEEP_TAG = {
 'TOP':'TOP','TOPIC':'TOP','NOM':'NOM','SBJ':'NOM','SUBJ':'NOM','ACC':'ACC','OBJ':'ACC',
 'Q':'Q','QUES':'Q','INT':'Q','POL':'POL','HON':'POL','HOR':'POL','FORM':'POL',
}
def norm_gloss_unit(u):
    """One gloss unit -> app convention: hyphen-joined, bare tags bracketed."""
    u = u.strip()
    if not u: return ''
    # a unit that is nothing but Leipzig tags separated by . or - and has no
    # lowercase lexical part: keep as bracketed tags
    core = u.strip('.,;:!?')
    parts = re.split(r'[-.=]', core)
    lex = [p for p in parts if p and not p.isupper()]
    tags = [p for p in parts if p and p.isupper() and len(p)>1]
    if not lex and tags:
        mapped=[KEEP_TAG.get(t,t) for t in tags]
        return '['+'.'.join(mapped)+']'
    # otherwise: lowercase the tags into readable words joined by hyphen
    return u.replace(' ','-')

def words(s):
    return [w for w in re.split(r'\s+', s.strip()) if w]
