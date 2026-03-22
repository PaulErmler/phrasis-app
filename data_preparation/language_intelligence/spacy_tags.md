A list of the tags that spacy uses.
https://github.com/explosion/spaCy/blob/master/spacy/glossary.py

"""
spaCy POS Tagging and Dependency Parsing Script

This script processes sentences using spaCy and extracts linguistic features.

=== POS TAGS (Universal Part-of-Speech Tags) ===
ADJ : adjective (e.g., big, old, green)
ADP : adposition (e.g., in, to, during)
ADV : adverb (e.g., very, tomorrow, down, where)
AUX : auxiliary (e.g., is, has, will, should)
CCONJ : coordinating conjunction (e.g., and, or, but)
DET : determiner (e.g., a, an, the)
INTJ : interjection (e.g., psst, ouch, bravo, hello)
NOUN : noun (e.g., girl, cat, tree, air, beauty)
NUM : numeral (e.g., 1, 2017, one, seventy-seven)
PART : particle (e.g., 's, not)
PRON : pronoun (e.g, I, you, he, she, myself, themselves)
PROPN : proper noun (e.g., Mary, John, London, NATO)
PUNCT : punctuation (e.g., ., (, ), ?)
SCONJ : subordinating conjunction (e.g., if, while, that)
SYM : symbol (e.g., $, %, §, ©, +, −, ×, ÷, =)
VERB : verb (e.g., run, runs, running, eat, ate, eaten)
X : other (e.g., foreign words, typos, abbreviations)
SPACE : space

=== TAG (Fine-grained POS Tags - Penn Treebank) ===
CC : coordinating conjunction (and, but, or)
CD : cardinal digit (one, two, three)
DT : determiner (a, the)
EX : existential there (there is)
FW : foreign word
IN : preposition/subordinating conjunction (in, of, like)
JJ : adjective (green, nice)
JJR : adjective, comparative (greener, nicer)
JJS : adjective, superlative (greenest, nicest)
LS : list marker (1), 2))
MD : modal (could, will, should)
NN : noun, singular (table, chair)
NNS : noun plural (tables, chairs)
NNP : proper noun, singular (Mike, London)
NNPS : proper noun, plural (Americans, Indians)
PDT : predeterminer (all the, both the)
POS : possessive ending ('s)
PRP : personal pronoun (I, he, she, you)
PRP$ : possessive pronoun (my, his, hers, your)
RB : adverb (very, silently, quickly)
RBR : adverb, comparative (better, faster)
RBS : adverb, superlative (best, fastest)
RP : particle (give up, put off)
TO : to (to go, to him)
UH : interjection (errrrrrrrm, uh, wow)
VB : verb, base form (take, be)
VBD : verb, past tense (took, was)
VBG : verb, gerund/present participle (taking, being)
VBN : verb, past participle (taken, been)
VBP : verb, sing. present, non-3d (take, am)
VBZ : verb, 3rd person sing. present (takes, is)
WDT : wh-determiner (which, that)
WP : wh-pronoun (who, what)
WP$ : possessive wh-pronoun (whose)
WRB : wh-abverb (where, when)
$ : dollar sign

# : pound sign

'' : closing quotation mark
`` : opening quotation mark
( : opening parenthesis
) : closing parenthesis
, : comma
. : sentence terminator
: : colon or ellipsis
SYM : symbol
HYPH : hyphen
NFP : non-final punctuation
ADD : email
AFX : affix
GW : goes with
XX : unknown

=== DEP (Dependency Relations) ===
acl : clausal modifier of noun (adjectival clause)
acomp : adjectival complement
advcl : adverbial clause modifier
advmod : adverbial modifier
agent : agent
amod : adjectival modifier
appos : appositional modifier
attr : attribute
aux : auxiliary
auxpass : passive auxiliary
case : case marking
cc : coordinating conjunction
ccomp : clausal complement
compound : compound
conj : conjunct
cop : copula
csubj : clausal subject
csubjpass: clausal passive subject
dative : dative
dep : unspecified dependency
det : determiner
dobj : direct object
expl : expletive
intj : interjection
mark : marker
meta : meta modifier
neg : negation modifier
nmod : nominal modifier
npadvmod : noun phrase as adverbial modifier
nsubj : nominal subject
nsubjpass: passive nominal subject
nummod : numeric modifier
oprd : object predicate
parataxis: parataxis
pcomp : complement of preposition
pobj : object of preposition
poss : possession modifier
preconj : pre-correlative conjunction
predet : predeterminer
prep : prepositional modifier
prt : particle
punct : punctuation
quantmod : modifier of quantifier
relcl : relative clause modifier
root : root
xcomp : open clausal complement

=== SHAPE ===
Shape describes the word's orthographic features:
x : lowercase letter
X : uppercase letter
d : digit
For example:

- "Apple" -> Xxxxx
- "U.K." -> X.X.
- "$1" -> $d
- "billion" -> xxxx

=== IS_ALPHA ===
True if the token consists of alphabetic characters only
False if it contains numbers, punctuation, or special characters

=== IS_STOP ===
True if the token is a stop word (common words like "the", "is", "at", "which")
False otherwise
"""
