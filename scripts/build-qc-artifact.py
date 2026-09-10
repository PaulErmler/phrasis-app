"""Turn a translation-QC run into a BLIND A/B rating page.

    python3 scripts/build-qc-artifact.py catalogue   # or: flores


Blind means blind: the page never says which side is the translation and
which is the quality pass, there is no reveal control, and neither the
mapping nor the per-sentence COMET score is anywhere in the DOM — not in the
text, not in a data attribute, not in the script. A rater who inspects the
page source still cannot tell.

The mapping lives in .scratch/flores-qc/blind-key.json instead, next to the
results. The page exports votes as (flores id, A/B/=) and the key turns those
into pass1/pass2 wins afterwards.

Aggregate metrics sit at the FOOT of the page, after the rating: they cannot
identify a side, but "COMET says it is a wash" read first would anchor the
judgement the metrics are there to be checked against.

"""

import difflib
import html
import json
import os
import re
import sys

DATASET = sys.argv[1] if len(sys.argv) > 1 else 'flores'
ROOT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    '.scratch/translation-qc',
    DATASET,
)
OUT = os.path.join(ROOT, 'rating.html')
KEY_OUT = os.path.join(ROOT, 'blind-key.json')
data = json.load(open(os.path.join(ROOT, 'results.json')))
rows = [r for r in data['rows'] if r['pass1'] and r['pass2']]
changed = [r for r in rows if r['pass1'] != r['pass2']]
same = [r for r in rows if r['pass1'] == r['pass2']]
m = data.get('metrics')
e = html.escape


def a_is_pass1(row):
    """Stable per-sentence coin flip: does pass 1 sit in slot A?"""
    h = 2166136261
    for ch in str(row['id']) + row['source'][:16]:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h % 2 == 0


CONTEXT_LABEL = {
    'speaker_gender': 'speaker',
    'referent_gender': 'referent',
    'addressee_gender': 'addressee',
    'register': 'register',
}


def context_chips(row):
    """The <context> block the model was given, as chips — the gender and
    register both passes were held to."""
    out = []
    for line in row.get('context', []):
        line = line.strip()
        if not line.startswith('<'):
            continue
        tag = line[1:line.index('>')]
        value = line[line.index('>') + 1:line.rindex('</')]
        dim = ' dim' if value == 'unspecified' else ''
        out.append(
            f'<span class="chip{dim}"><span class="k">{e(CONTEXT_LABEL.get(tag, tag))}</span>'
            f'{e(value)}</span>'
        )
    return ''.join(out)


def diff_pair(a, b):
    """Mark the words that differ, on both sides.

    Symmetric by construction: each side highlights only its own differing
    spans, so the highlighting says "these words are not the same" and never
    which side is the edit. Tokens keep their trailing space so the rebuilt
    string is the original text.
    """
    ta = re.findall(r'\S+\s*', a)
    tb = re.findall(r'\S+\s*', b)
    ma, mb = [], []
    sm = difflib.SequenceMatcher(a=[t.strip() for t in ta], b=[t.strip() for t in tb], autojunk=False)
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == 'equal':
            ma.append(e(''.join(ta[i1:i2])))
            mb.append(e(''.join(tb[j1:j2])))
            continue
        if i2 > i1:
            chunk = ''.join(ta[i1:i2])
            trail = chunk[len(chunk.rstrip()):]
            ma.append(f'<mark>{e(chunk.rstrip())}</mark>{trail}')
        if j2 > j1:
            chunk = ''.join(tb[j1:j2])
            trail = chunk[len(chunk.rstrip()):]
            mb.append(f'<mark>{e(chunk.rstrip())}</mark>{trail}')
    return ''.join(ma), ''.join(mb)


cards = []
key = {}
for i, r in enumerate(changed, 1):
    p1a = a_is_pass1(r)
    key[str(r['id'])] = {'A': 'pass1' if p1a else 'pass2', 'B': 'pass2' if p1a else 'pass1'}
    a, b = (r['pass1'], r['pass2']) if p1a else (r['pass2'], r['pass1'])
    a_html, b_html = diff_pair(a, b)
    ref_controls = (
        '<button type="button" class="refbtn" aria-expanded="false">Show reference</button>'
        if r.get('reference') else ''
    )
    ref_block = (
        f'<p class="ref" hidden lang="de"><span class="k">human reference</span>'
        f'{e(r["reference"])}</p>'
        if r.get('reference') else ''
    )
    cards.append(f'''<article class="pair" data-id="{r['id']}">
  <header class="phead">
    <span class="tag">{i:02d} <span class="sep">/</span> {DATASET} {r['id']}</span>
    <div class="ctx">{context_chips(r)}</div>
  </header>
  <p class="src" lang="en">{e(r['source'])}</p>
  <div class="cands">
    <button class="cand" type="button" data-side="A">
      <span class="side">A</span><span class="txt" lang="de">{a_html}</span>
    </button>
    <button class="cand" type="button" data-side="B">
      <span class="side">B</span><span class="txt" lang="de">{b_html}</span>
    </button>
  </div>
  <div class="controls">
    <div class="votes" role="group" aria-label="Which reads better">
      <button type="button" class="vote" data-v="A"><kbd>1</kbd> A better</button>
      <button type="button" class="vote" data-v="="><kbd>2</kbd> Equal</button>
      <button type="button" class="vote" data-v="B"><kbd>3</kbd> B better</button>
    </div>
    {ref_controls}
  </div>
  {ref_block}
</article>''')

json.dump(
    {'note': 'Which slot held which pass. Kept out of the page so the rating stays blind.',
     'seed': data['seed'], 'map': key},
    open(KEY_OUT, 'w'),
    indent=1,
)

same_rows = ''.join(
    f'<li><span class="tag">{DATASET} {r["id"]}</span><span lang="de">{e(r["pass1"])}</span></li>'
    for r in same
)

EYEBROWS = {
    'flores': 'FLORES-200 devtest · en→de · blind pairwise trial',
    'catalogue': 'Phrasis curriculum · short sentences · en→de · blind pairwise trial',
}
eyebrow = EYEBROWS.get(DATASET, DATASET + ' · en→de · blind pairwise trial')

if m:
    metrics_block = f"""<h2>Reference metrics<span>aggregate only — these cannot tell you which side is which</span></h2>
  <section class="metrics" aria-label="Automatic metrics">
    <div class="metric"><span class="lab">COMET system 1</span><span class="v">{m['comet']['pass1']:.4f}</span><span class="d">wmt22-comet-da</span></div>
    <div class="metric"><span class="lab">COMET system 2</span><span class="v">{m['comet']['pass2']:.4f}</span><span class="d {'pos' if m['comet']['delta'] > 0 else 'neg'}">{m['comet']['delta']:+.4f}</span></div>
    <div class="metric"><span class="lab">chrF++</span><span class="v">{m['chrf2']['pass1']:.2f} <span style="opacity:.4">&rarr;</span> {m['chrf2']['pass2']:.2f}</span><span class="d {'pos' if m['chrf2']['delta'] > 0 else 'neg'}">{m['chrf2']['delta']:+.2f}</span></div>
    <div class="metric"><span class="lab">BLEU</span><span class="v">{m['bleu']['pass1']:.2f} <span style="opacity:.4">&rarr;</span> {m['bleu']['pass2']:.2f}</span><span class="d {'pos' if m['bleu']['delta'] > 0 else 'neg'}">{m['bleu']['delta']:+.2f}</span></div>
    <div class="metric"><span class="lab">per-sentence COMET</span><span class="v">{m['changed']['comet_up']}<span style="opacity:.4">/</span>{m['changed']['comet_down']}</span><span class="d">up / down of {m['changed']['n']}</span></div>
  </section>
  <p class="mnote">Scored against the human reference with <code>Unbabel/wmt22-comet-da</code>. System 1 and system 2 here are not A and B: the A/B assignment is reshuffled for every sentence.</p>"""
else:
    metrics_block = f"""<h2>No automatic metric<span>{len(changed)} of {len(rows)} sentences changed</span></h2>
  <p class="mnote">These are curriculum sentences, which have no human reference translation, so COMET cannot be computed for them &mdash; it scores a candidate against a reference, and the only German we hold is machine output from the same pipeline. Scoring against that would reward resembling the previous translation, not being right. Your reading is the whole signal here.</p>"""

page = f'''<title>Blind Translation Trial</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Serif:ital,wght@0,400;0,600;1,400&display=swap">
<style>
  :root {{
    --ground:#f4f3ef; --panel:#ffffff; --panel-2:#faf9f6;
    --ink:#191a1d; --ink-2:#585d66; --ink-3:#8a9099;
    --rule:#e3e1da; --rule-2:#c9c6bd;
    --accent:#3a46a4; --accent-soft:#e7e9f7; --on-accent:#ffffff;
    --good:#2f6b47; --bad:#a03c3c;
    --hl:#fbeec4; --hl-line:#c8a83a;
    --shadow:0 1px 2px rgba(25,26,29,.05);
  }}
  @media (prefers-color-scheme: dark) {{
    :root:not([data-theme="light"]) {{
      --ground:#131416; --panel:#1b1d20; --panel-2:#212429;
      --ink:#eceef0; --ink-2:#a6acb4; --ink-3:#767c85;
      --rule:#2b2f34; --rule-2:#3d434a;
      --accent:#96a1ee; --accent-soft:#22263c; --on-accent:#11131a;
      --good:#8ecfa5; --bad:#e8918d;
      --hl:#42381c; --hl-line:#a98f3d;
      --shadow:none;
    }}
  }}
  :root[data-theme="dark"] {{
    --ground:#131416; --panel:#1b1d20; --panel-2:#212429;
    --ink:#eceef0; --ink-2:#a6acb4; --ink-3:#767c85;
    --rule:#2b2f34; --rule-2:#3d434a;
    --accent:#96a1ee; --accent-soft:#22263c; --on-accent:#11131a;
    --good:#8ecfa5; --bad:#e8918d;
    --hl:#42381c; --hl-line:#a98f3d;
    --shadow:none;
  }}

  body {{ background:var(--ground); color:var(--ink);
    font-family:"IBM Plex Sans",system-ui,sans-serif; line-height:1.5; }}
  .wrap {{ max-width:62rem; margin:0 auto; padding:2.5rem 1.15rem 6rem; }}
  .k, .lab {{ font-size:.625rem; font-weight:600; letter-spacing:.1em;
    text-transform:uppercase; color:var(--ink-3); }}

  h1 {{ font-size:clamp(1.6rem,4vw,2.3rem); font-weight:700; letter-spacing:-.02em;
    margin:0 0 .5rem; text-wrap:balance; }}
  .intro {{ max-width:44rem; color:var(--ink-2); margin:0; font-size:1rem; }}
  .intro code, .intro strong {{ color:var(--ink); }}
  .intro code {{ font-family:"IBM Plex Mono",monospace; font-size:.85em; }}

  .bar {{ position:sticky; top:0; z-index:5; margin:1.75rem 0 0; padding:.6rem .9rem;
    background:var(--panel); border:1px solid var(--rule); box-shadow:var(--shadow);
    display:flex; align-items:center; gap:1rem; flex-wrap:wrap; }}
  .track {{ flex:1 1 12rem; height:.4rem; background:var(--rule); min-width:8rem; }}
  .fill {{ height:100%; width:0; background:var(--accent); transition:width .18s ease; }}
  .tally {{ font-family:"IBM Plex Mono",monospace; font-size:.8rem; color:var(--ink-2);
    font-variant-numeric:tabular-nums; }}
  .barbtn {{ font:inherit; font-size:.8rem; padding:.3rem .7rem; cursor:pointer;
    background:var(--panel-2); color:var(--ink); border:1px solid var(--rule-2); }}
  .barbtn:hover {{ border-color:var(--accent); }}
  .barbtn:focus-visible, .cand:focus-visible, .vote:focus-visible, .refbtn:focus-visible {{
    outline:2px solid var(--accent); outline-offset:2px; }}

  .pair {{ margin-top:1.1rem; padding:1rem 1.1rem 1.1rem; background:var(--panel);
    border:1px solid var(--rule); box-shadow:var(--shadow); }}
  .pair.done {{ border-color:var(--rule-2); background:var(--panel-2); }}
  .phead {{ display:flex; justify-content:space-between; align-items:baseline; gap:1rem;
    flex-wrap:wrap; margin-bottom:.5rem; }}
  .tag {{ font-family:"IBM Plex Mono",monospace; font-size:.7rem; color:var(--ink-3); }}
  .tag .sep {{ opacity:.5; }}
  .ctx {{ display:flex; gap:.35rem; flex-wrap:wrap; }}
  .chip {{ font-family:"IBM Plex Mono",monospace; font-size:.66rem; padding:.1rem .4rem;
    background:var(--accent-soft); color:var(--ink-2); display:inline-flex; gap:.35rem; }}
  .chip.dim {{ background:transparent; border:1px solid var(--rule); color:var(--ink-3); }}
  .chip .k {{ letter-spacing:.06em; }}
  .src {{ margin:0 0 .75rem; font-size:.95rem; color:var(--ink-2); }}

  .cands {{ display:grid; gap:.6rem; grid-template-columns:1fr; }}
  @media (min-width:44rem) {{ .cands {{ grid-template-columns:1fr 1fr; }} }}
  .cand {{ display:grid; grid-template-columns:auto 1fr; gap:.6rem; align-items:start;
    text-align:left; font:inherit; cursor:pointer; padding:.7rem .8rem;
    background:var(--panel-2); border:1px solid var(--rule); color:var(--ink); }}
  .cand:hover {{ border-color:var(--rule-2); }}
  .cand .side {{ font-family:"IBM Plex Mono",monospace; font-size:.72rem; font-weight:600;
    color:var(--ink-3); padding-top:.15rem; }}
  .cand .txt {{ font-family:"IBM Plex Serif",Georgia,serif; font-size:1.02rem; line-height:1.55; }}
  /* The words that differ. Same treatment on both sides: it marks difference,
     not direction, so it cannot say which candidate is the edit. */
  .cand mark {{ background:var(--hl); color:inherit;
    box-shadow:inset 0 -1px 0 var(--hl-line); border-radius:1px; padding:0 .06em; }}
  .cand.picked {{ border-color:var(--accent); background:var(--accent-soft); }}
  .cand.picked .side {{ color:var(--accent); }}

  .controls {{ display:flex; justify-content:space-between; align-items:center;
    gap:.75rem; flex-wrap:wrap; margin-top:.7rem; }}
  .votes {{ display:flex; gap:.4rem; flex-wrap:wrap; }}
  .vote {{ font:inherit; font-size:.82rem; padding:.3rem .7rem; cursor:pointer;
    background:var(--panel); color:var(--ink-2); border:1px solid var(--rule-2);
    display:inline-flex; align-items:center; gap:.4rem; }}
  .vote:hover {{ color:var(--ink); border-color:var(--accent); }}
  .vote[aria-pressed="true"] {{ background:var(--accent); border-color:var(--accent);
    color:var(--on-accent); }}
  .vote kbd {{ font-family:"IBM Plex Mono",monospace; font-size:.66rem; opacity:.65; }}
  .refbtn {{ font:inherit; font-size:.75rem; padding:.25rem .5rem; cursor:pointer;
    background:transparent; color:var(--ink-3); border:1px solid var(--rule); }}
  .ref {{ margin:.7rem 0 0; font-family:"IBM Plex Serif",Georgia,serif; font-size:.92rem;
    color:var(--ink-2); border-left:2px solid var(--rule-2); padding-left:.7rem; }}
  .ref .k {{ display:block; font-family:"IBM Plex Sans",sans-serif; margin-bottom:.15rem; }}

  h2 {{ margin:3rem 0 0; padding-bottom:.45rem; border-bottom:1px solid var(--rule-2);
    font-size:.72rem; font-weight:700; letter-spacing:.13em; text-transform:uppercase;
    color:var(--ink-2); display:flex; justify-content:space-between; gap:1rem;
    flex-wrap:wrap; }}
  h2 span {{ font-family:"IBM Plex Mono",monospace; font-weight:400; letter-spacing:0;
    text-transform:none; color:var(--ink-3); }}
  .unchanged {{ list-style:none; padding:0; margin:.8rem 0 0; display:flex;
    flex-direction:column; gap:.5rem; }}
  .unchanged li {{ display:grid; grid-template-columns:6rem 1fr; gap:.7rem;
    font-family:"IBM Plex Serif",Georgia,serif; font-size:.9rem; color:var(--ink-2);
    padding-bottom:.5rem; border-bottom:1px solid var(--rule); }}
  .unchanged .tag {{ font-family:"IBM Plex Mono",monospace; padding-top:.2rem; }}

  .metrics {{ margin:.9rem 0 0; border:1px solid var(--rule); background:var(--panel);
    box-shadow:var(--shadow); display:grid;
    grid-template-columns:repeat(auto-fit,minmax(10rem,1fr)); }}
  .metric {{ padding:.85rem 1rem; border-right:1px solid var(--rule);
    display:flex; flex-direction:column; gap:.15rem; }}
  .metric:last-child {{ border-right:0; }}
  .metric .v {{ font-family:"IBM Plex Mono",monospace; font-size:1.15rem; font-weight:600;
    font-variant-numeric:tabular-nums; }}
  .metric .d {{ font-family:"IBM Plex Mono",monospace; font-size:.75rem; color:var(--ink-2); }}
  .d.neg {{ color:var(--bad); }} .d.pos {{ color:var(--good); }}
  .mnote {{ margin:.7rem 0 0; font-size:.85rem; color:var(--ink-3); max-width:44rem; }}

  footer {{ margin-top:2.5rem; color:var(--ink-3); font-size:.82rem; max-width:46rem; }}
  footer code {{ font-family:"IBM Plex Mono",monospace; }}
  @media (prefers-reduced-motion:reduce) {{ * {{ transition:none !important; }} }}
</style>

<div class="wrap">
  <p class="lab">{eyebrow}</p>
  <h1>Which German reads better?</h1>
  <p class="intro">Two systems translated the same {len(rows)} sentences; they disagreed on <strong>{len(changed)}</strong> of them, which are the pairs below, with the differing words highlighted. For each, pick the German a native speaker would rather have written, or Equal. <strong>Nothing on this page says which system is which</strong> — not the labels, not the order, not the highlighting, not the page source — and there is no reveal button. Rate, hit Copy results, and the answer key is applied afterwards. The chips carry the speaker gender, referent gender, addressee gender and register that both systems were given, so a candidate that ignores them is wrong however well it reads.</p>

  <div class="bar">
    <span class="tally" id="count">0 / {len(changed)} rated</span>
    <div class="track"><div class="fill" id="fill"></div></div>
    <span class="tally" id="tally">A 0 · = 0 · B 0</span>
    <button class="barbtn" id="copyBtn" type="button">Copy results</button>
  </div>

  {''.join(cards)}

  <h2>Both systems agreed<span>{len(same)} of 100 — identical output, nothing to rate</span></h2>
  <ul class="unchanged">{same_rows}</ul>

  {metrics_block}

  <footer>
    <p>Ratings are stored in this browser only. Copy results puts them on the clipboard as TSV — flores id, your verdict, and both sentences as you saw them.</p>
  </footer>
</div>

<script>
  const KEY = 'flores-blind-v1';
  const pairs = [...document.querySelectorAll('.pair')];
  let store = {{}};
  try {{ store = JSON.parse(localStorage.getItem(KEY) || '{{}}'); }} catch (e) {{ store = {{}}; }}

  const save = () => {{
    try {{ localStorage.setItem(KEY, JSON.stringify(store)); }} catch (e) {{ /* private window */ }}
  }};

  function paint(el) {{
    const v = store[el.dataset.id];
    el.classList.toggle('done', !!v);
    el.querySelectorAll('.vote').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.v === v)),
    );
    el.querySelectorAll('.cand').forEach((c) =>
      c.classList.toggle('picked', !!v && v !== '=' && c.dataset.side === v),
    );
  }}

  function tally() {{
    let a = 0, b = 0, t = 0, n = 0;
    for (const el of pairs) {{
      const v = store[el.dataset.id];
      if (!v) continue;
      n++;
      if (v === 'A') a++; else if (v === 'B') b++; else t++;
    }}
    document.getElementById('count').textContent = n + ' / ' + pairs.length + ' rated';
    document.getElementById('fill').style.width = (100 * n / pairs.length) + '%';
    document.getElementById('tally').textContent = 'A ' + a + ' · = ' + t + ' · B ' + b;
  }}

  function vote(el, v) {{
    if (store[el.dataset.id] === v) delete store[el.dataset.id];
    else store[el.dataset.id] = v;
    save(); paint(el); tally();
  }}

  pairs.forEach((el) => {{
    el.querySelectorAll('.vote').forEach((b) =>
      b.addEventListener('click', () => vote(el, b.dataset.v)),
    );
    el.querySelectorAll('.cand').forEach((c) =>
      c.addEventListener('click', () => vote(el, c.dataset.side)),
    );
    const rb = el.querySelector('.refbtn');
    if (rb) rb.addEventListener('click', () => {{
      const ref = el.querySelector('.ref');
      ref.hidden = !ref.hidden;
      rb.setAttribute('aria-expanded', String(!ref.hidden));
      rb.textContent = ref.hidden ? 'Show reference' : 'Hide reference';
    }});
    paint(el);
  }});
  tally();

  document.getElementById('copyBtn').addEventListener('click', async () => {{
    const lines = ['flores_id\\tverdict\\tA\\tB'];
    for (const el of pairs) {{
      const v = store[el.dataset.id];
      if (!v) continue;
      const [a, b] = [...el.querySelectorAll('.cand .txt')].map((t) => t.textContent.trim());
      lines.push([el.dataset.id, v, a, b].join('\\t'));
    }}
    const btn = document.getElementById('copyBtn');
    try {{
      await navigator.clipboard.writeText(lines.join('\\n'));
      btn.textContent = 'Copied ' + (lines.length - 1) + ' rows';
    }} catch (e) {{
      btn.textContent = 'Copy blocked — select the page instead';
    }}
    setTimeout(() => {{ btn.textContent = 'Copy results'; }}, 2500);
  }});

  // 1 / 2 / 3 rate whichever pair sits nearest the middle of the viewport.
  document.addEventListener('keydown', (ev) => {{
    if (!['1', '2', '3'].includes(ev.key)) return;
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const mid = window.innerHeight / 2;
    let best = null, bestD = Infinity;
    for (const el of pairs) {{
      const r = el.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - mid);
      if (d < bestD) {{ bestD = d; best = el; }}
    }}
    if (best) vote(best, {{ '1': 'A', '2': '=', '3': 'B' }}[ev.key]);
  }});
</script>
'''

open(OUT, 'w').write(page)
print(OUT, round(os.path.getsize(OUT) / 1000), 'kB')
print(KEY_OUT, len(key), 'sentences keyed')
