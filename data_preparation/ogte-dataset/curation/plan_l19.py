"""Curation plan for OGTE Level 19 — High Near-Native (~271 sentences).

At L19 the learner has near-native command: idiomatic phrasing, sarcasm
and irony delivered straight, rhetorical sophistication, register
virtuosity across registers from clinical to casual to literary. Arcs
target conversational Q/A pairs and tight thematic clusters drawn from
the rather eclectic vocabulary at this level (medical, military,
culinary, paranormal, civic, online, etc.). Vocabulary breadth is
preserved — no content word repeats across more than 3 consecutive rows.

Curation philosophy (refined for L19, a small file):
  - Preserve aggressively — only 271 sentences total.
  - Long sentences and embedded clauses are fine — learners need them.
  - Idiomatic & figurative speech is the whole point at L19; keep most.
  - Sarcasm / irony / passive-aggression are valuable at L19 (the
    learner needs to recognize and produce them); keep them.
  - Specific medical conditions, body parts, civic terms, alcohol /
    drug references in moderation are fine.
  - Removal rate runs slightly above target (~12.5%) because the
    input contains two heavy drills ('upstairs' x22, 'soldiers' x14
    plus 'paperwork' x8) that must be thinned to satisfy the
    no-content-word-in-4-consecutive-rows rule. Drill overflow
    accounts for ~18 of the 34 removals; the remainder is the usual
    duplicates, sexist generalizations, gore, and preachy content.
"""

from __future__ import annotations


L19_PLAN = {
    "removals": [
        # === Drill overflow: 'upstairs' (input has ~22 entries, way too dense) ===
        {"id": "1779744", "reason": "'They walked upstairs.' — upstairs-drill overflow, vague."},
        {"id": "2216905", "reason": "'I ran upstairs.' — upstairs-drill overflow, near-duplicate of 5858395 'I rushed upstairs.'"},
        {"id": "2243713", "reason": "'They're working upstairs.' — upstairs-drill overflow, vague."},
        {"id": "2247701", "reason": "'I'll check upstairs.' — upstairs-drill overflow, vague."},
        {"id": "2247877", "reason": "'I'll wait upstairs.' — upstairs-drill overflow, vague."},
        {"id": "5938324", "reason": "'I went back upstairs.' — upstairs-drill overflow, vague."},
        {"id": "50565",   "reason": "'Carry the bags upstairs.' — upstairs-drill overflow, context-less imperative."},
        {"id": "38935",   "reason": "'The toilet is upstairs.' — upstairs-drill overflow, near-duplicate of 3259038 'The bathroom is upstairs.'"},
        {"id": "2033713", "reason": "'I want you to go upstairs immediately.' — upstairs-drill overflow, vague imperative (kept 72896 + 72895)."},
        {"id": "3735984", "reason": "'Everybody's upstairs.' — upstairs-drill overflow, vague."},
        {"id": "23672",   "reason": "'Would you carry my luggage upstairs?' — upstairs-drill overflow + luggage-cluster filler."},
        {"id": "3259038", "reason": "'The bathroom is upstairs.' — upstairs-drill overflow, vague (kept the toilet/bathroom pair would be redundant)."},
        {"id": "72896",   "reason": "'Go upstairs and go to bed.' — upstairs-drill overflow, near-duplicate imperative of 72895."},

        # === Drill overflow: 'paperwork' (8 rows in a row in input) ===
        {"id": "2360201", "reason": "'I have paperwork to finish up.' — paperwork-drill overflow, near-duplicate of 2358879 'I've already done the paperwork.'"},

        # === Duplicates within the L19 file ===
        {"id": "1499937", "reason": "'This is a sunflower.' — exact-pattern duplicate of 42651 'It's a sunflower.'"},
        {"id": "3976579", "reason": "'This is a magic wand.' — duplicate framing of 3818753 'Where's your magic wand?'"},
        {"id": "6105967", "reason": "'That's a bad pun.' — duplicate framing of 1483 'This is a pun.'"},
        {"id": "1541481", "reason": "'Mary died during childbirth.' — duplicate of 1541480 'Mary died in childbirth.'"},
        {"id": "5147059", "reason": "'You're not invincible.' — duplicate-flip of 2248153 'I'm not invincible.'"},
        {"id": "5858191", "reason": "'I'm a bit chubby.' — near-duplicate of 5633132 'I was a chubby kid.'"},
        {"id": "2327607", "reason": "'I want a scooter.' — duplicate framing of 1495897 'I have a scooter.'"},
        {"id": "3821623", "reason": "'I just spotted a panther.' — paraphrase duplicate of 3821622 'I just saw a panther.'"},

        # === Sexist / gendered prescription ===
        {"id": "6118333", "reason": "'You're not supposed to wear lipstick at school.' — gendered prescription."},
        {"id": "4486410", "reason": "'…spent most of the time griping about their husbands.' — wives-complain-about-husbands stereotype."},

        # === Gore / heavy detail (keep most medical, drop the gruesome) ===
        {"id": "953488",  "reason": "'…paralyzed man was eaten alive by maggots.' — gruesome detail."},
        {"id": "543753",  "reason": "'A swarm of hornets attacked the children.' — disturbing, children-victim framing."},

        # === Preachy / opinion-stamping ===
        {"id": "2874622", "reason": "'Kissing a person who smokes is like licking an ashtray.' — preachy/opinionated, awkward isolated."},
        {"id": "3085730", "reason": "'Simplicity is worse than robbery.' — obscure foreign proverb, not natural English."},

        # === Extremely niche / context-less ===
        {"id": "4846652", "reason": "'Mary tied an apron around her waist and then took the turkey out of the oven.' — clunky long narrative, doubles the turkey-cluster vocab."},
        {"id": "322011",  "reason": "'Let's pretend that we're soldiers.' — childish-pretend register clashes with L19."},
        {"id": "2268533", "reason": "'The soldiers fired.' — near-duplicate of 4498696 'The soldiers opened fire.'"},
        {"id": "2252579", "reason": "'The soldiers laughed.' — clunky standalone, soldiers-drill thinner."},
        {"id": "2645699", "reason": "'We all became soldiers.' — odd in isolation, soldiers-drill thinner."},
        {"id": "5136945", "reason": "'About thirty soldiers were wounded.' — duplicate framing of 4494037 'Three soldiers were wounded.'; further thins soldiers-drill."},
    ],
    "arcs": [
        # ===========================================================
        # === FIRST ARCS (3 hand-picked highest-quality openers) ===
        # ===========================================================

        # FIRST #1: Sarcasm / irony / detection — flagship L19 register
        {
            "position": "first",
            "items": [
                "3731188",  # Do I detect sarcasm?
                {"text": "Maybe just a touch.", "added_for": "touch", "reason": "warm half-admission, natural answer to 'Do I detect sarcasm?'"},
                "2203313",  # You're sarcastic.
                "5860767",  # You're being sarcastic, I hope.
                {"text": "Of course — I wouldn't dream of being serious.", "added_for": "dream|serious", "reason": "self-aware sarcastic reply, lets L19 learner feel the register"},
            ],
        },

        # FIRST #2: Persistence / pays off — quiet confidence, polished register
        {
            "position": "first",
            "items": [
                "4501358",  # Persistence pays off.
                "4501352",  # Persistence will pay off.
                "2203176",  # We're persistent.
                "2242992",  # They're relentless.
            ],
        },

        # FIRST #3: Prognosis / dire — clinical register, near-native gravitas
        {
            "position": "first",
            "items": [
                "2234122",  # What's the prognosis?
                "4494467",  # The prognosis was dire.
                {"text": "Is there anything we can do?", "added_for": "anything", "reason": "natural follow-up after grim news"},
                "3307520",  # The tumor was benign.
                {"text": "That's the first good news all week.", "added_for": "news|week", "reason": "relieved reply, idiomatic register"},
            ],
        },

        # ===========================================================
        # === Soldiers / military (clustered, vocab-spread) ===
        # ===========================================================
        # Original input clusters ~14 'soldiers' lines back-to-back —
        # split into three short arcs broken by non-'soldiers' arcs so
        # the token never spans 4 consecutive rows.
        [
            "1388227",  # The soldiers are dead.
            "4498696",  # The soldiers opened fire.
            "681655",   # Soldiers must follow orders.
            {"text": "How many casualties were there?", "added_for": "casualties", "reason": "follow-up after 'opened fire'; breaks 'soldiers' chain"},
            "320102",   # Soldiers are used to danger.
            "4501715",  # The soldiers remained still.
            "3727472",  # My sons are soldiers.
        ],
        # Civic break — UN arc inserted between the soldier blocks
        # to defuse the 'soldiers' streak across the seam.
        [
            "72166",    # What does UN stand for?
            "415500",   # UN stands for United Nations.
        ],
        # ===========================================================
        # === Civic / voting (anchored at idx ~14, which lets the
        # === 'voting' arc slip between '4502457 surrounded' (idx 13)
        # === and the second soldier mini-arc — defuses 'soldiers'
        # === streak across the seam) ===
        # ===========================================================
        # NOTE: 4502457 ('The soldiers surrounded the village.') is
        # intentionally NOT in an arc — it lands as a singleton at
        # idx 13, between soldier-block-1 and the voting arc, which
        # gives a 1-sentence breath before voting.
        [
            "5001101",  # I don't plan to vote in the upcoming elections.
            "6096337",  # Aren't you going to vote in the upcoming election?
        ],

        # Second soldier mini-arc (occupation/wounded/died) — 3 items,
        # exactly at the 'max 3 in a row' limit; the voting arc just
        # before, and practically arc just after, break the streak on
        # both sides.
        [
            "681606",   # The soldiers occupied the building.
            "4494037",  # Three soldiers were wounded.
            "4497277",  # Three soldiers died protecting us.
        ],

        # ===========================================================
        # === Curfew ===
        # ===========================================================
        [
            "323939",   # Is there a curfew?
            "3734413",  # The curfew begins at 7:00 p.m.
        ],

        # ===========================================================
        # === 'Practically' — adverbial hedging ===
        # ===========================================================
        [
            "3728515",  # I'm practically an adult.
            "474057",   # Practically every family has a TV.
            "4834104",  # I got it practically for free.
        ],

        # ===========================================================
        # === Idioms: cold turkey / talk turkey / turkey-the-bird ===
        # ===========================================================
        [
            "928195",   # Let's talk turkey.
            "294118",   # He quit smoking cold turkey.
            "69241",    # Have you ever eaten turkey?
            {"text": "Only at Thanksgiving.", "added_for": "thanksgiving", "reason": "natural answer to 'ever eaten turkey'"},
            "1804044",  # I ate a turkey sandwich.
            "1804045",  # I made myself a turkey sandwich.
        ],

        # ===========================================================
        # === Revelation / underwear (moments of disclosure) ===
        # ===========================================================
        [
            "3725667",  # I had a revelation.
            "1891004",  # I'm in my underwear.
        ],

        # ===========================================================
        # === Persistent cough / spotlight ===
        # ===========================================================
        # Note: persistence/persistent already opened in first arc #2;
        # the cough is medical and safely distinct.
        [
            "53462",    # I have a persistent cough.
            "4501273",  # The spotlight is on.
        ],

        # ===========================================================
        # === Karma / spotlight / metaphor ===
        # ===========================================================
        [
            "5418388",  # That's bad karma.
            "4666478",  # I don't believe in karma.
        ],

        # ===========================================================
        # === Upstairs — the big cluster, thinned and broken twice ===
        # ===========================================================
        # Original had ~22 'upstairs' rows back-to-back. After 13
        # removals 11 'upstairs' rows remain (9 in the main idx-43-57
        # block + 65502 at idx 80 + 3978487 at idx 96). The 9 in the
        # main block are placed in one arc with two non-'upstairs'
        # additions inserted so 'upstairs' never spans 4 consecutive
        # rows. 65502 and 3978487 live as singletons in their natural
        # positions much later in the file.
        [
            "5858395",  # I rushed upstairs.
            "251206",   # My study is upstairs.
            "302442",   # He carried the box upstairs.
            {"text": "Mind the loose step.", "added_for": "loose|step", "reason": "natural caretaker remark, breaks 'upstairs' streak"},
            "4012209",  # The children were asleep upstairs.
            "5265823",  # I heard a noise upstairs.
            "72895",    # Go upstairs and bring down my trunk.
            {"text": "Sure, give it here.", "added_for": "give|here", "reason": "willing-helper reply, breaks 'upstairs' streak"},
            "1463502",  # They rented the upstairs room to a student.
            "257269",   # I asked for the key and went upstairs to my room.
            "3223405",  # Some kind of party upstairs kept me up until one last night.
        ],

        # ===========================================================
        # === In sync / paperwork (modern workplace) ===
        # ===========================================================
        # 'paperwork' would otherwise span 7 consecutive rows.
        # Removing 2360201 (duplicate-ish 'paperwork to finish up')
        # plus one inserted reply keeps the streak at max 3.
        [
            "2240841",  # We're in sync.
            "2245862",  # I hate paperwork.
            "3724516",  # I'll start the paperwork.
            "2358879",  # I've already done the paperwork.
            {"text": "Don't burn yourself out.", "added_for": "burn|out", "reason": "warm reply, breaks the long 'paperwork' streak"},
            "2882452",  # I was just catching up on paperwork.
            "909561",   # She spends over a third of her time doing paperwork.
            "909568",   # Some healthcare workers spend more time doing paperwork than taking care of patients.
        ],

        # ===========================================================
        # === Small change / nickels / debit / freebies ===
        # ===========================================================
        [
            "2647199",  # Do you have a nickel?
            "4823870",  # I forgot my debit card at home.
        ],

        # ===========================================================
        # === Riding shotgun / car-roles ===
        # ===========================================================
        [
            "2247803",  # I'll ride shotgun.
        ],

        # ===========================================================
        # === Subjective / objective (aesthetic philosophy) ===
        # ===========================================================
        [
            "2245000",  # Beauty is subjective.
            "2249133",  # It's not subjective.
        ],

        # ===========================================================
        # === Prom / school dance ===
        # ===========================================================
        # prom items 70-72 are contiguous; 887058 lives much later
        # (idx 94) and naturally lands as a singleton near the
        # heart-cluster, which breaks the 'prom' streak.
        [
            "3821343",  # Are you really going to ask Mary to the prom?
            "2026771",  # Would you please do me the favor of going to the prom with me?
            "5691920",  # I won't be able to go to the prom.
        ],

        # ===========================================================
        # === Algebra / calculus / mathematics ===
        # ===========================================================
        [
            "275390",   # Algebra is a branch of mathematics.
            "3374196",  # I hate calculus.
        ],

        # ===========================================================
        # === Simplicity as virtue ===
        # ===========================================================
        [
            "5418224",  # Simplicity is a virtue.
            "327637",   # I like the simplicity of her dress.
        ],

        # ===========================================================
        # === Zombies / paranoia / paranormal ===
        # ===========================================================
        [
            "2892540",  # What do you know about zombies?
            "1841502",  # You're being paranoid.
            "3446854",  # You're sounding paranoid.
            {"text": "Maybe — or maybe I'm the only one paying attention.", "added_for": "attention", "reason": "rhetorically loaded retort, flagship L19 sarcasm"},
        ],

        # ===========================================================
        # === Philosopher (rhetorical compliment) ===
        # ===========================================================
        [
            "2821420",  # You're quite a philosopher.
            "908734",   # Who's your favorite philosopher?
        ],

        # ===========================================================
        # === Shaving / razor ===
        # ===========================================================
        [
            "2497792",  # I cut myself with a razor.
            "1545119",  # How often do you change your razor blade?
        ],

        # ===========================================================
        # === Voluntarily / coercion ===
        # ===========================================================
        [
            "3732074",  # Are you here voluntarily?
            "2545425",  # I'm doing it voluntarily.
        ],

        # ===========================================================
        # === Pranks / hoaxes / mischief ===
        # ===========================================================
        [
            "5290505",  # It was only meant as a harmless prank.
            "4121173",  # This had better not be some kind of prank.
            "3823813",  # Unfortunately, it's a hoax.
            "3823812",  # It was definitely a hoax.
            "4501394",  # The photo was a hoax.
        ],

        # ===========================================================
        # === Footsteps / footprints (intruder / detection) ===
        # ===========================================================
        [
            "22026",    # I hear footsteps outside.
            "3130460",  # I could hear footsteps coming up the stairs.
        ],
        [
            "2323048",  # I don't see any footprints anywhere.
            "5572831",  # I wonder whose footprints these are.
            "22972",    # We found the footprints in the sand.
            {"text": "Could be a deer.", "added_for": "deer", "reason": "natural guess reply, breaks 6-row 'footprints' streak"},
            "5572833",  # Who left these muddy footprints on the front porch?
            "2401256",  # We found one large footprint and a couple of different size smaller footprints.
            "5572837",  # I saw three sets of footprints in the snow from the road up to my front door.
        ],

        # ===========================================================
        # === Lipstick ===
        # ===========================================================
        [
            "2334784",  # What's your favorite color of lipstick?
            "3170707",  # Mary usually wears bright red lipstick.
        ],

        # ===========================================================
        # === Heartbeat / heartbreaking / heartbroken (heart-cluster) ===
        # ===========================================================
        # 'heart' content base spans 3 sub-words; split into two arcs so
        # no 'heart*' family word covers 4 consecutive rows.
        [
            "4689839",  # I'd do it all again in a heartbeat.
            "4494752",  # It was heartbreaking.
            "4495360",  # What a heartbreaking story!
        ],
        [
            "3824090",  # I'm heartbroken.
            "1173606",  # He was heartbroken.
        ],

        # ===========================================================
        # === Panther / big cats ===
        # ===========================================================
        [
            "3821622",  # I just saw a panther.
        ],

        # ===========================================================
        # === Coca-Cola / drinks order ===
        # ===========================================================
        [
            "62170",    # May I have a Coca-Cola?
            "3329726",  # Can I have a double espresso?
            "458955",   # Is this jasmine tea?
            "2645090",  # Do you want some bourbon?
            "2265783",  # Do you like pineapple drinks?
        ],

        # ===========================================================
        # === Quarantine / sickness ===
        # ===========================================================
        [
            "3722976",  # I'm under quarantine.
        ],

        # ===========================================================
        # === Downstream / camping / outdoors ===
        # ===========================================================
        [
            "2335048",  # Our camp is about 5 miles downstream from here.
        ],

        # ===========================================================
        # === Allergies / dietary ===
        # ===========================================================
        [
            "1689836",  # I'm allergic to gluten.
        ],

        # ===========================================================
        # === Vile / horrendous / heartless (strong negatives) ===
        # ===========================================================
        [
            "3670429",  # That was a vile thing to do.
            "4493942",  # It was a horrendous experience.
            "4828286",  # It was an embarrassing fiasco.
            "2254528",  # What a fiasco!
        ],

        # ===========================================================
        # === Traffic / freeway ===
        # ===========================================================
        [
            "4789471",  # There's a lot of traffic on the freeway.
            "682156",   # There was a terrible accident on the freeway.
        ],

        # ===========================================================
        # === Backstage / concerts ===
        # ===========================================================
        [
            "4144668",  # Can I come backstage?
            "4144671",  # I have backstage passes.
            "4529722",  # We weren't allowed backstage.
        ],

        # ===========================================================
        # === Breathtaking / scenery ===
        # ===========================================================
        [
            "3826026",  # It's breathtaking.
            "3826025",  # The scenery was breathtaking.
        ],

        # ===========================================================
        # === Sucker / gullibility ===
        # ===========================================================
        [
            "3820484",  # Do I look like a sucker?
            {"text": "Of course not — I'd never insult you like that.", "added_for": "insult", "reason": "L19 idiomatic-sarcastic reply"},
            "2044748",  # I'm a sucker for happy endings.
        ],

        # ===========================================================
        # === Blackouts / medical episodes ===
        # ===========================================================
        [
            "3736853",  # I had a blackout.
        ],

        # ===========================================================
        # === Condolences / loss ===
        # ===========================================================
        [
            "4495428",  # Please accept my condolences.
            "2374087",  # I just wanted to express my condolences.
        ],

        # ===========================================================
        # === Pineapple / sunflower / botanicals ===
        # ===========================================================
        [
            "3821499",  # It's a pineapple.
            "42651",    # It's a sunflower.
        ],

        # ===========================================================
        # === Archaeology / archaic / curiosity ===
        # ===========================================================
        [
            "4487332",  # Have you ever studied archaeology?
            "5006735",  # This expression is archaic.
        ],

        # ===========================================================
        # === Autopsy / pathology ===
        # ===========================================================
        [
            "4501380",  # No autopsy was performed.
            "3431059",  # Dr. Jackson is performing an autopsy.
            "2016916",  # I'd like a copy of the autopsy report.
        ],

        # ===========================================================
        # === Fasting / religious or medical ===
        # ===========================================================
        [
            "2203675",  # Who's fasting?
            "2111733",  # I'm fasting.
        ],

        # ===========================================================
        # === Scooter / personal transport ===
        # ===========================================================
        [
            "1495897",  # I have a scooter.
        ],

        # ===========================================================
        # === Aliens / abduction (paranormal humor) ===
        # ===========================================================
        [
            "253209",   # I was abducted by aliens.
            "2640911",  # I dreamed I had been abducted by aliens.
            {"text": "And what did the aliens want from you?", "added_for": "want", "reason": "deadpan follow-up keeping the register playful"},
        ],

        # ===========================================================
        # === Lighthouse / coastal ===
        # ===========================================================
        [
            "3733522",  # There's the lighthouse.
        ],

        # ===========================================================
        # === Puns / cringe / humor ===
        # ===========================================================
        [
            "1483",     # This is a pun.
            "3825518",  # It made me cringe.
        ],

        # ===========================================================
        # === Reboot / restart (tech) ===
        # ===========================================================
        [
            "1775403",  # You need to reboot your computer.
            "4496808",  # Did you hear your computer beep?
            "3619085",  # It's a minor glitch.
            "2892409",  # Was there a malfunction?
            "4014638",  # What caused the malfunction?
            "2463065",  # Leave your message after the beep.
        ],

        # ===========================================================
        # === Yummy / culinary appreciation ===
        # ===========================================================
        [
            "4502546",  # It tastes really yummy.
            "1334717",  # I want an English muffin.
            "1933697",  # I ate chicken nuggets.
            "4817033",  # What time is brunch?
        ],

        # ===========================================================
        # === Spooky / atmosphere ===
        # ===========================================================
        [
            "4394837",  # It was spooky.
            "3618863",  # It's a little spooky out here.
        ],

        # ===========================================================
        # === Pep rally / school spirit ===
        # ===========================================================
        [
            "273978",   # When is the pep rally?
            "4494469",  # The pep rally was loud.
        ],

        # ===========================================================
        # === Weeding / yardwork ===
        # ===========================================================
        [
            "4666494",  # Help me pull these weeds.
            "408289",   # We have to pull the weeds.
            "5903791",  # I was in the garden all afternoon, pulling weeds.
        ],

        # ===========================================================
        # === Trustworthy / reputation ===
        # ===========================================================
        [
            "2203470",  # We're trustworthy.
            "301948",   # I believe that he's trustworthy.
        ],

        # ===========================================================
        # === Hangover / morning after ===
        # ===========================================================
        [
            "280988",   # I have a hangover.
            "2359554",  # I've got a bad hangover.
        ],

        # ===========================================================
        # === Jackpot / windfall ===
        # ===========================================================
        [
            "2493744",  # I've hit the jackpot.
            "3312959",  # We hit the jackpot.
        ],

        # ===========================================================
        # === Bragging / self-promotion ===
        # ===========================================================
        # 'brag'/'bragging' spans 3 rows; safely split.
        [
            "2275950",  # I didn't want to brag.
            "3001003",  # I'm not bragging.
            "478383",   # I'm tired of listening to your bragging.
            {"text": "Then maybe stop giving me reasons to.", "added_for": "reasons", "reason": "tart comeback, L19 register"},
        ],

        # ===========================================================
        # === Diapers / babies / cribs ===
        # ===========================================================
        [
            "3480066",  # The baby needs a diaper change.
            "1860644",  # Leave the baby in the crib.
        ],

        # ===========================================================
        # === Hereditary / disease ===
        # ===========================================================
        [
            "4502522",  # The disease we are talking about is hereditary.
        ],

        # ===========================================================
        # === Confiscation / school discipline ===
        # ===========================================================
        [
            "523980",   # My license was confiscated.
            "2358635",  # I confiscated a gun from a student this morning.
            "327478",   # If you leave your textbooks at school during the break, they'll get confiscated.
        ],

        # ===========================================================
        # === Goalies / sport roles ===
        # ===========================================================
        [
            "5358127",  # Is it hard being a goalie?
        ],

        # ===========================================================
        # === Grumpy / moods ===
        # ===========================================================
        [
            "2202921",  # You're grumpy.
            "3347141",  # You sure sound grumpy.
        ],

        # ===========================================================
        # === Reggae / music tastes ===
        # ===========================================================
        [
            "5840431",  # I like reggae.
            "2050687",  # I heard some reggae music playing in the distance.
        ],

        # ===========================================================
        # === Magic wand / whimsy ===
        # ===========================================================
        [
            "3818753",  # Where's your magic wand?
        ],

        # ===========================================================
        # === Concise / brief / essay ===
        # ===========================================================
        [
            "3825599",  # Try to be concise.
            "3825600",  # I'll be brief and concise.
            "286743",   # His essay was concise and to the point.
        ],

        # ===========================================================
        # === Statesman / inventor (biographical) ===
        # ===========================================================
        [
            "1347334",  # Benjamin Franklin was an American statesman and inventor.
        ],

        # ===========================================================
        # === Astounding / impressive results ===
        # ===========================================================
        [
            "2248674",  # Isn't that astounding?
            "4501811",  # The results were astounding.
            "3312864",  # We got a standing ovation.
        ],

        # ===========================================================
        # === Invincible / paralyzed (vulnerability) ===
        # ===========================================================
        [
            "2248153",  # I'm not invincible.
            "4499810",  # I was nearly paralyzed.
        ],

        # ===========================================================
        # === Chubby (body, gentle) ===
        # ===========================================================
        [
            "5633132",  # I was a chubby kid.
        ],

        # ===========================================================
        # === Insomnia / sleep troubles ===
        # ===========================================================
        [
            "4494383",  # Insomnia is very common.
            "3823546",  # Do you suffer from insomnia?
        ],

        # ===========================================================
        # === Overboard (literal & figurative) ===
        # ===========================================================
        [
            "3821661",  # Throw them overboard.
            "5859408",  # I jumped overboard.
            "4054885",  # Be careful not to fall overboard.
        ],

        # ===========================================================
        # === Childbirth ===
        # ===========================================================
        [
            "1541480",  # Mary died in childbirth.
        ],

        # ===========================================================
        # === Helium (chemistry trivia) ===
        # ===========================================================
        [
            "2549565",  # Helium is a gas.
        ],

        # ===========================================================
        # === Persecuted (history / politics) ===
        # ===========================================================
        [
            "2243396",  # They were persecuted.
            "5858872",  # I felt persecuted.
        ],

        # ===========================================================
        # === Proactive ===
        # ===========================================================
        [
            "3172340",  # Are you proactive?
            "4495087",  # We were proactive.
        ],

        # ===========================================================
        # === Hypocrite ===
        # ===========================================================
        [
            "2218025",  # You're a hypocrite.
            "2713443",  # You're such a hypocrite.
        ],

        # ===========================================================
        # === Counterfeit / fraud ===
        # ===========================================================
        [
            "2252697",  # These are counterfeit.
        ],

        # ===========================================================
        # === Astrology / astronomy ===
        # ===========================================================
        [
            "4806580",  # Don't confuse astrology with astronomy.
            "887451",   # She told him that she believed in astrology.
        ],

        # ===========================================================
        # === Bodyguard ===
        # ===========================================================
        [
            "5858382",  # I'm your bodyguard.
            "2546713",  # I'll be your bodyguard.
        ],

        # ===========================================================
        # === Obnoxious / annoying ===
        # ===========================================================
        [
            "2203123",  # You're obnoxious.
            "4494449",  # This odor is obnoxious.
        ],

        # ===========================================================
        # === Colossal / setback (scale words) ===
        # ===========================================================
        [
            "3281680",  # What a colossal waste of time!
            "1587252",  # This is a serious setback.
            "870646",   # It's only a minor setback.
        ],

        # ===========================================================
        # === Handshake / ceremony ===
        # ===========================================================
        [
            "3164471",  # Our club has a secret handshake.
        ],

        # ===========================================================
        # === Conjecture / speculation ===
        # ===========================================================
        [
            "3733447",  # That's pure conjecture.
        ],

        # ===========================================================
        # === Goggles / safety gear ===
        # ===========================================================
        [
            "3331067",  # You've got my goggles.
            "3115651",  # You should be wearing your safety goggles.
        ],

        # ===========================================================
        # === Amnesia (memory loss) ===
        # ===========================================================
        [
            "2245873",  # I have amnesia.
        ],

        # ===========================================================
        # === Slander / legal ===
        # ===========================================================
        [
            "4495018",  # Slander is a crime.
        ],

        # ===========================================================
        # === Measles / migraines (illnesses) ===
        # ===========================================================
        [
            "5858214",  # I have the measles.
            "2266896",  # I came down with measles.
            "320325",   # I have a migraine.
        ],

        # ===========================================================
        # === Giraffes / zoo trivia ===
        # ===========================================================
        [
            "2921563",  # What sound does a giraffe make?
            "259712",   # I had never seen a giraffe till I visited the zoo.
        ],

        # ===========================================================
        # === Meddling / interference ===
        # ===========================================================
        [
            "1719227",  # Stop meddling.
            "482672",   # I have no intention of meddling in your affairs.
        ],

        # ===========================================================
        # === Paramedics / emergency ===
        # ===========================================================
        [
            "2300058",  # I called 911 and the paramedics came.
            "5807351",  # Paramedics arrived on the scene within minutes.
        ],

        # ===========================================================
        # === Dishwasher ===
        # ===========================================================
        [
            "3818453",  # Did the dishwasher work?
        ],

        # ===========================================================
        # === Zebras / animal trivia ===
        # ===========================================================
        [
            "5046521",  # Why do zebras have stripes?
        ],

        # ===========================================================
        # === Cleanliness / obsession ===
        # ===========================================================
        [
            "2250549",  # My wife is obsessed with cleanliness.
        ],

        # ===========================================================
        # === Whiskey / single drink ===
        # ===========================================================
        [
            "5916337",  # I took a swig of whiskey.
        ],

        # ===========================================================
        # === Foundation / house structure (opener content from row 1) ===
        # ===========================================================
        [
            "60134",    # This house has a solid foundation.
        ],
    ],
}
