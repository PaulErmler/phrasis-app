"""Reading a Leipzig-style gloss well enough to score a readable-English one.

Wikipedia and GlossLM gloss in the Leipzig style, which is what linguists
read: `thief hit-PST.3SG woman-PRT and run-PST.3SG away`. The app glosses for
learners, which is readable English in the source's own word order: `thief
hit-ed woman-[obj] and ran away`.

An earlier version of this file tried to CONVERT one into the other with a tag
table. It went wrong in ways that would have poisoned the eval: `I.NOM` became
`[i]` because `I` is uppercase, German's circumfixed participle
`PST.PTCP-see-PST.PTCP` became `ed-ing-see-ed-ing`, and `DEF.ART` became
`the-the`. A manufactured reference that is wrong is worse than no reference.

So nothing is converted. The source line is kept verbatim as `glossRaw`, and
the only thing derived from it is the LEXICAL SKELETON: the same units with
the grammatical tags removed, which is a deletion rather than a judgment.
`see-IPFV-1SG girl-ACC` yields `see girl`. Scoring compares the model's gloss
to that skeleton position by position, so it measures what the source actually
asserts (which word means what, and in which order) and leaves the app's
surface convention to the mechanical checks and the judge's rubric.
"""
import re

# Uppercase strings that are ordinary English gloss words, not Leipzig tags.
# Without this, `I.NOM` reads as two tags and the pronoun disappears.
NOT_A_TAG = {'I', 'A', 'O', 'OK', 'TV', 'US', 'UK'}

# Category labels that stand alone as a whole unit. They gloss a grammatical
# word that has no English equivalent, so the skeleton keeps a marker rather
# than an empty slot, which would silently shorten the reference.
STANDALONE = {
    'TOP': 'TOPIC', 'TOPIC': 'TOPIC', 'FOC': 'FOCUS', 'Q': 'QUESTION',
    'QUES': 'QUESTION', 'INT': 'QUESTION', 'INTERR': 'QUESTION',
    'CL': 'CLASSIFIER', 'CLF': 'CLASSIFIER', 'COP': 'BE', 'NEG': 'NOT',
    'DEF': 'THE', 'ART': 'THE', 'INDF': 'A', 'INDEF': 'A', 'PART': 'PARTICLE',
    'POL': 'POLITE', 'HON': 'POLITE', 'REFL': 'SELF', 'RECP': 'EACHOTHER',
}

# A possessive/genitive particle standing ALONE is a word in its own right with
# an English counterpart (Mandarin 的, Japanese の). Bundled with a person tag
# it is a possessive ending instead — `1SG-GEN` means "my", not "of" — and the
# pronoun is what a gloss should carry, so those units stay unscorable rather
# than being scored against the wrong word.
STANDALONE_ONLY = {'POSS': 'OF', 'GEN': 'OF'}

# Leipzig tags are conventionally uppercase, but the sources are not
# consistent: `home-dat come-aor you help-aor-1pl` is a real reference line,
# and reading `dat` as a lexeme made a correct gloss ("to-house comes to-you
# we-help") score 25%. Case-insensitive matching needs a closed vocabulary,
# because plenty of English gloss words (`in`, `on`, `part`) are also tags.
KNOWN_TAGS = {
 'NOM','ACC','GEN','DAT','INS','INSTR','LOC','ABL','ELA','INE','ILL','ADE','ALL',
 'PTV','PRT','PAR','ESS','TRA','ABE','COM','VOC','ERG','ABS','SUP','SUBL','DEL',
 'TERM','CAU','SG','PL','DU','PST','PRS','PRES','FUT','PFV','IPFV','AOR','PROG',
 'PTCP','PTC','PASTPTC','INF','GER','CVB','SBJV','IMP','COND','POT','CAUS','PASS',
 'REFL','RECP','DEF','INDF','CLF','NMLZ','ADN','COP','EVID','HON','NEG','MIS',
 'POSS','TOP','FOC','CL','Q','QUES','INT','INTERR','PART','POL','ART','ADJ','ADV',
 'ANIM','INAN','AN','MASC','FEM','NEUT','OC','FIN','DYN','STAT','IND','DECL','LINK',
 'LNK','PRV','FRQ','MSD','ATTR','QUOT','SBJ','SUBJ','OBJ','AGR','THM','APPL','HAB',
}
_PERSON = re.compile(r'^[123](SG|PL|DU)?$|^(SG|PL|DU)[123]$')

TAGCHARS = re.compile(r'^[A-Z0-9./:]+$')

def is_tag(part: str) -> bool:
    """True for a Leipzig grammatical tag. Uppercase shape is accepted broadly;
    lowercase only against the closed KNOWN_TAGS vocabulary, so an English
    gloss word is never mistaken for a tag."""
    if not part or part in NOT_A_TAG:
        return False
    # A bare number is a person marker (`must:3`), not a lexeme.
    if part.isdigit():
        return True
    if not any(c.isalpha() for c in part):
        return False
    if part.upper() == part and TAGCHARS.match(part) is not None:
        return True
    up = part.upper()
    return up in KNOWN_TAGS or _PERSON.match(up) is not None

def lexical_unit(unit: str):
    """One Leipzig unit -> its lexical content, or a STANDALONE marker, or None
    when the unit is pure grammatical concord and carries no lexeme."""
    unit = unit.strip().strip('.,;:!?()[]"\'')
    if not unit:
        return None
    parts = [p for p in re.split(r'[-=.:;~+]', unit) if p]
    lex = [p for p in parts if not is_tag(p)]
    if lex:
        return '-'.join(lex).lower()
    for p in parts:                       # no lexeme: keep a category marker
        if p.upper() in STANDALONE:
            return STANDALONE[p.upper()].lower()
    if len(parts) == 1 and parts[0].upper() in STANDALONE_ONLY:
        return STANDALONE_ONLY[parts[0].upper()].lower()
    return None

def skeleton(raw: str):
    """The gloss's lexical skeleton, one entry per source word. `None` marks a
    position whose gloss is pure concord, which the scorer skips rather than
    counting as a miss."""
    return [lexical_unit(u) for u in raw.split()]
