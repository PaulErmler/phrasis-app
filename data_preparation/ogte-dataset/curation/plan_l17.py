"""Curation plan for OGTE Level 17 — Early Near-Native (~1322 sentences).

At L17 learners are crossing into near-native territory: subtle nuance,
advanced idioms used richly, register sensitivity (formal / informal /
sarcastic / euphemistic), indirect speech, sophisticated phrasing,
and selectively used regional/culturally-specific markers. Arcs target
conversational Q/A pairs and tight thematic clusters with vocabulary
breadth (no drill repetition of the same content word across more
than 3 consecutive rows).

Curation philosophy (refined for L17):
  - Long sentences, embedded clauses, modal hedges are fine — learners need them.
  - Idioms ('come in handy', 'racking his brains', 'an ax to grind',
    'rolling stone gathers no moss') are richly valuable; keep most.
  - Family / disagreement / sarcasm / passive-aggressive drama is fine.
  - Specific numbers, dates and proper nouns in moderation are fine.
  - Mild crime / cops / suspect / custody references are fine.
  - Body parts (elbow, rib, fist, belly, chin), narratives, mild
    political content (not country-specific drilling) are fine.
  - Still removed: dated brands, overtly sexist lines, extremely niche
    cultural drills (Mt. Fuji x6, drunken-driving-Texas), exact
    duplicates, and the worst hungry / grandfather / cops drills.
"""

from __future__ import annotations


L17_PLAN = {
    "removals": [
        # ---- Country-specific political / legal drilling ----
        {"id": "2196901", "reason": "'How many counties are there in Florida?' — US-specific trivia."},
        {"id": "5740575", "reason": "'Riots broke out in Boston.' — Boston-specific."},
        {"id": "952860", "reason": "'The blood alcohol limit for drunken driving is .08 percent in Texas.' — US-state trivia."},
        {"id": "5077142", "reason": "'Corporal punishment is forbidden in Sweden.' — country-specific factoid."},
        {"id": "1898311", "reason": "'My grandfather died in Korea.' — country-specific war framing."},
        {"id": "4017111", "reason": "'Are fireworks legal in Australia?' — country-specific."},
        {"id": "4806341", "reason": "Long 'coal mined… in Australia' — country-specific factoid."},
        {"id": "4806343", "reason": "Long 'coal mined… in China' — country-specific factoid."},
        {"id": "3024004", "reason": "'The airline sent my suitcase to Boston by mistake.' — Boston overflow."},

        # ---- Mt. Fuji overflow (keep one, drop drill) ----
        {"id": "242966", "reason": "'We can see Mt. Fuji clearly today.' — Mt Fuji drill overflow."},
        {"id": "249332", "reason": "'We admired the view of Mt. Fuji.' — Mt Fuji drill overflow."},
        {"id": "31457", "reason": "'I want to climb Mt. Fuji again.' — Mt Fuji drill overflow."},
        {"id": "25822", "reason": "'We can see Mt. Fuji in the distance.' — Mt Fuji drill overflow."},
        {"id": "327986", "reason": "'It took all night to climb Mt Fuji.' — Mt Fuji drill overflow."},
        {"id": "498112", "reason": "'We finally reached the top of Mt. Fuji.' — Mt Fuji drill overflow (keep 261486)."},

        # ---- Grandfather drill overflow (very long cluster, keep variety) ----
        {"id": "4699997", "reason": "'My grandfather no longer drives.' — duplicate of 4699986."},
        {"id": "4012623", "reason": "'My grandfather owned a car just like this.' — grandfather drill overflow."},
        {"id": "2150564", "reason": "Long 'My father, grandfather, great-grandfather…' — clunky drill."},
        {"id": "2416112", "reason": "'My grandfather died in the Second World War.' — duplicate framing with 251345."},
        {"id": "251333", "reason": "'My grandfather is still active at eighty.' — grandfather drill overflow."},
        {"id": "251335", "reason": "'My grandfather lived to be ninety.' — duplicate of 273860."},
        {"id": "273861", "reason": "'My grandfather always sits in this chair.' — grandfather drill overflow."},
        {"id": "321446", "reason": "'My grandfather usually eats breakfast at six.' — grandfather drill overflow."},
        {"id": "2240022", "reason": "Long '… 88th birthday tomorrow.' — duplicate of 2240026."},

        # ---- Grandmother drill overflow ----
        {"id": "273903", "reason": "'My grandmother speaks slowly.' — grandmother drill overflow."},
        {"id": "65595", "reason": "'My grandmother lives by herself.' — grandmother drill overflow."},
        {"id": "1894017", "reason": "'My grandmother had an operation in Germany.' — drill + country-specific."},
        {"id": "3281730", "reason": "'My grandmother always said it was a sin to waste food.' — moralizing drill."},
        {"id": "273896", "reason": "'My grandmother is always complaining of the cold.' — gendered nagging trope."},

        # ---- Hungry drill overflow (large cluster, keep variety) ----
        {"id": "2547157", "reason": "'I'm not hungry either.' — hungry drill overflow."},
        {"id": "2547158", "reason": "'I'm not hungry anyway.' — duplicate of 2547157."},
        {"id": "2648111", "reason": "'I'm sort of hungry.' — duplicate of 2648516."},
        {"id": "2375788", "reason": "'I knew you'd be hungry.' — duplicate framing."},
        {"id": "4764536", "reason": "'I'm not feeling that hungry yet.' — hungry drill overflow."},
        {"id": "2539449", "reason": "'I'm probably going to be hungry soon.' — hungry drill overflow."},
        {"id": "2642458", "reason": "'None of us are hungry right now.' — duplicate framing of 4495309."},
        {"id": "2293282", "reason": "Long duplicate of 1961626 ('I thought you might be hungry')."},
        {"id": "2326270", "reason": "'I figured you must be hungry by now.' — hungry drill overflow."},
        {"id": "2362223", "reason": "'I just had a sandwich so I'm not hungry.' — hungry drill overflow."},
        {"id": "2323284", "reason": "'I don't want pizza. I'm not hungry.' — hungry drill overflow."},
        {"id": "2307978", "reason": "Long 'I changed my mind about dinner…' — hungry drill overflow."},
        {"id": "247153", "reason": "'Nobody was hungry except me.' — hungry drill overflow."},
        {"id": "5166581", "reason": "'I think everybody's hungry.' — duplicate of 2648145."},
        {"id": "475748", "reason": "'I was hungry and thirsty.' — duplicate of 1690392."},
        {"id": "2406789", "reason": "'I stole some food because I was very hungry.' — hungry + crime framing."},
        {"id": "2293285", "reason": "'I assumed you were hungry.' — hungry drill overflow."},

        # ---- Cop / cops drill overflow ----
        {"id": "2549707", "reason": "'I'm not a cop.' — duplicate framing of 2247887."},
        {"id": "5859670", "reason": "'I lied to the cops.' — accusatory + cop drill overflow."},

        # ---- Idiots drill overflow ----
        {"id": "4850157", "reason": "'You idiots deserve to lose.' — accusatory + drill overflow."},
        {"id": "3732589", "reason": "'There are plenty of idiots in the world.' — idiots drill overflow."},
        {"id": "5429982", "reason": "'You're an absolute idiot.' — duplicate of 2543265 framing."},
        {"id": "2218118", "reason": "'You're both idiots.' — accusatory + duplicate framing."},

        # ---- Suitcase drill overflow (cluster of ~18 sentences) ----
        {"id": "3820473", "reason": "'Someone else took my suitcase.' — duplicate of 276152."},
        {"id": "4499532", "reason": "'Your suitcase looks exactly like mine.' — suitcase drill overflow."},
        {"id": "55525", "reason": "'Who does this suitcase belong to?' — suitcase drill overflow."},
        {"id": "4013176", "reason": "'There are no wheels on this suitcase.' — suitcase drill overflow."},
        {"id": "2326538", "reason": "'I folded my shirts and put them in my suitcase.' — overflow."},
        {"id": "2329332", "reason": "Long 'I gathered together my things…' — suitcase drill overflow."},
        {"id": "2863745", "reason": "'I could only take what fit into the suitcase.' — overflow."},
        {"id": "2358830", "reason": "'I have a T-shirt in my suitcase.' — overflow."},

        # ---- Headache cluster overflow ----
        {"id": "274404", "reason": "'My son is my biggest headache.' — odd parenting comment."},
        {"id": "5825904", "reason": "'These headaches of mine are getting worse.' — duplicate of 2931907."},

        # ---- Niche / awkward / dated / political ----
        {"id": "3730560", "reason": "'What's your pre-tax income?' — invasive + niche."},
        {"id": "3354956", "reason": "'You should run for governor.' — US-political register."},
        {"id": "4921436", "reason": "'The governor supports the bill.' — US-political register."},
        {"id": "1316106", "reason": "'He supports the Democratic Party.' — US-political register."},
        {"id": "5834523", "reason": "'How is a new pope elected?' — niche religious-political."},
        {"id": "5118315", "reason": "'Corporal punishment is still allowed in many countries.' — political factoid."},
        {"id": "3826505", "reason": "'I've requested political asylum.' — duplicate of 3826503."},

        # ---- Violence / gore overflow ----
        {"id": "887033", "reason": "'She choked him with her bare hands.' — gore overflow."},
        {"id": "5271531", "reason": "'Torture is wrong.' — duplicate framing of 5077429."},
        {"id": "2308012", "reason": "Long torture-confession sentence — torture drill heavy."},
        {"id": "3280959", "reason": "'They were tortured.' — torture overflow."},
        {"id": "4499385", "reason": "'The man who held up the liquor store wore a mask.' — robbery niche."},
        {"id": "628074", "reason": "'The police used a battering ram to break down the door.' — heavy crime."},

        # ---- Dated / wanna register overflow ----
        {"id": "3181119", "reason": "'Do you wanna talk?' — duplicate framing of 4197700."},
        {"id": "20450", "reason": "'I don't wanna go back.' — wanna drill overflow."},
        {"id": "241763", "reason": "'I wanna quit my job.' — wanna drill overflow."},

        # ---- DNA / forensic cluster overflow ----
        {"id": "6099399", "reason": "'They lost the DNA sample.' — duplicate framing of 4816773."},
        {"id": "1921132", "reason": "'A DNA test showed he was innocent.' — DNA drill overflow."},
        {"id": "4134988", "reason": "Long 'The police detective carefully collected samples…' — overflow."},

        # ---- Exact / near duplicates ----
        {"id": "2247924", "reason": "'I'm an attorney.' — duplicate framing of 5916625."},
        {"id": "475886", "reason": "'Thanks for the info.' — near-duplicate trivial of 6126559."},
        {"id": "2306464", "reason": "'Are you Catholic?' — paired-duplicate of 2248128."},
        {"id": "5852733", "reason": "'I'm a surgeon.' — duplicate of 3374152."},
        {"id": "453667", "reason": "'I'm a diabetic.' — duplicate of 5839992."},
        {"id": "4502851", "reason": "'Water has no calories.' — duplicate of 4502850."},
        {"id": "4523891", "reason": "'The planet closest to the sun is Mercury.' — duplicate of 4523889."},
        {"id": "4501588", "reason": "'Who authorized this purchase?' — paired-duplicate of 4498642."},
        {"id": "4495573", "reason": "'These allegations are false.' — allegation drill overflow."},
        {"id": "4498716", "reason": "'Duct tape is good for fixing anything.' — duplicate of 4498717."},
        {"id": "3522083", "reason": "'This is a hybrid.' — duplicate of 1887292."},
        {"id": "4502934", "reason": "'The elevators aren't working.' — paired with 5221363."},
        {"id": "2202713", "reason": "'You're credible.' — paired-duplicate of 2202712."},
        {"id": "2203236", "reason": "'You're psychic.' — paired-duplicate of 2203234."},
        {"id": "2203377", "reason": "'You're sneaky.' — paired-duplicate of 2203376."},
        {"id": "5851147", "reason": "'I'm being sued.' — near-duplicate of 2248355."},
        {"id": "5860785", "reason": "'I have a pierced ear.' — duplicate of 2396095 framing."},
        {"id": "5466181", "reason": "'Mary got her ears pierced.' — duplicate of 2396095."},
        {"id": "5851838", "reason": "'I lit the oven.' — duplicate framing with 5851845."},
        {"id": "1463072", "reason": "'We are doomed.' — duplicate of 3311122."},
        {"id": "5276582", "reason": "'Hand me that wrench.' — duplicate of 50293."},
        {"id": "1992903", "reason": "'…broke into very small pieces.' — duplicate of 1992902."},
        {"id": "1773413", "reason": "'You're a total wreck.' — paired-duplicate of 1773412."},
        {"id": "4496611", "reason": "'The elevator doors closed.' — abstract trivial."},

        # ---- Vague / accusatory single-line content-less ----
        {"id": "2202574", "reason": "'You're arrogant.' — duplicate-vague of 5899613."},
        {"id": "2218147", "reason": "'You're flattering me.' — accusatory."},
        {"id": "2202576", "reason": "'You're articulate.' — duplicate framing of 5859682."},
        {"id": "2202557", "reason": "'You're agitated.' — duplicate framing of 2218090."},
        {"id": "2202589", "reason": "'You're attentive.' — duplicate of 1851041."},
        {"id": "2202662", "reason": "'You're compassionate.' — vague."},
        {"id": "2202805", "reason": "'You're elusive.' — vague."},
        {"id": "2218097", "reason": "'You're being detained.' — context-less."},
        {"id": "1895606", "reason": "'You're insane.' — duplicate-paired of 2242984."},
        {"id": "2547451", "reason": "'You're a filthy liar.' — accusatory + duplicate of 6099169."},
        {"id": "2255277", "reason": "'You were reckless.' — duplicate-paired of 2203258."},
        {"id": "2202570", "reason": "'I'm analytical.' — duplicate-paired of 3172415."},
        {"id": "2243229", "reason": "'They look horrified.' — duplicate framing of 2202960."},

        # ---- Misc minor / closing ----
        {"id": "2451294", "reason": "'Is French taught in elementary schools?' — language-policy niche."},
        {"id": "5916525", "reason": "'You're young and naive.' — naive drill overflow."},
        {"id": "4494526", "reason": "'You're a naive person.' — naive drill overflow."},
        {"id": "1954681", "reason": "'You can't possibly be that naive.' — accusatory."},
        {"id": "5102000", "reason": "'We sang in a choir when we were kids.' — duplicate framing of 4501512."},
        {"id": "5915853", "reason": "'I used to be a forest ranger.' — niche role."},
        {"id": "5860534", "reason": "'I used to be a coal miner.' — niche role."},
        {"id": "2794457", "reason": "'I am not a prophet.' — odd in isolation."},
        {"id": "5828912", "reason": "'I'm a monk.' — paired-duplicate of 2012964."},
        {"id": "5828976", "reason": "'I'm bipolar.' — niche medical label in isolation."},
        {"id": "5840000", "reason": "'I'm hesitant.' — abstract one-word."},
        {"id": "2240998", "reason": "'We're newcomers.' — duplicate of 5851266."},
        {"id": "3155316", "reason": "'We're having a barbecue next Saturday.' — barbecue overflow."},
        {"id": "320466", "reason": "Long 'I congratulate you on winning first prize…' — overflow."},
        {"id": "2388110", "reason": "'I never got a chance to congratulate you.' — overflow."},
        {"id": "4501712", "reason": "'All the cabins remain shuttered.' — niche/poetic out of context."},
        {"id": "5201663", "reason": "'I don't like Brussels sprouts.' — niche food + odd brag."},
        {"id": "5829217", "reason": "'I have a Ph.D.' — odd brag in isolation."},
        {"id": "5858643", "reason": "'I was a boy scout.' — niche role isolated."},
        {"id": "5858276", "reason": "'I opened the hood.' — duplicate-paired of 33063."},
        {"id": "5821627", "reason": "'Mary is folding the laundry.' — laundry drill overflow."},
        {"id": "4517683", "reason": "Long sewing-machine sentence — clunky duplicate of 4517682."},
        {"id": "3737995", "reason": "'How's the spice pudding?' — odd niche."},
        {"id": "4493999", "reason": "'Three civilians were wounded.' — niche war framing."},
    ],
    "arcs": [
        # ===========================================================
        # === FIRST ARCS (3 hand-picked highest-quality openers) ===
        # ===========================================================

        # FIRST #1: Indirect speech, sophisticated hedge — flagship L17 register.
        {
            "position": "first",
            "items": [
                "3183326",  # May I speak frankly?
                {"text": "Please do.", "added_for": "do", "reason": "polite invitation to speak frankly"},
                "1839102",  # Frankly speaking, he's wrong.
                "325412",   # Frankly speaking, this novel isn't very interesting.
                "4574323",  # Frankly speaking, I don't think you have what it takes to become a teacher.
                {"text": "That's harsh, but I appreciate the honesty.", "added_for": "harsh|honesty", "reason": "natural reply to frank criticism, L17 register"},
                "4495553",  # I disagree strongly.
                "4529770",  # I disagree with that comment.
                "913836",   # Let's agree to disagree.
            ],
        },

        # FIRST #2: Modal reflection — should've / would've / must've.
        {
            "position": "first",
            "items": [
                "2891973",  # That would've been awesome.
                "3372941",  # You should've called the cops.
                {"text": "Maybe I should have, in hindsight.", "added_for": "hindsight", "reason": "natural reflective reply"},
                "4495678",  # We probably should've applied for a visa much earlier.
                "2643789",  # You should've had some pie.
                "3178461",  # We must've blown a fuse.
                "296409",   # They must've skipped out of town.
            ],
        },

        # FIRST #3: Discretion / appreciation — refined relational register.
        {
            "position": "first",
            "items": [
                "2291883",  # I appreciate your discretion.
                "657067",   # I hope I can count on your discretion.
                {"text": "Absolutely. Not a word.", "added_for": "word", "reason": "warm reassurance reply"},
                "2111963",  # Be discreet.
                "1860378",  # Don't worry. I'll be discreet.
                "4495510",  # Parental discretion is advised.
            ],
        },

        # ===========================================================
        # === Frankly / honestly / spoken candor (continued) ===
        # ===========================================================
        [
            "1347331",  # She speaks frankly.
            "19389",    # We talked quite frankly.
            "325410",   # Frankly speaking, he is an unreliable man.
        ],

        # ===========================================================
        # === Hungry — drill broken into themed sub-arcs ===
        # ===========================================================
        [
            "1048296",  # I'm slightly hungry.
            "1771706",  # I'm super hungry.
            "2648516",  # I'm fairly hungry.
            {"text": "Then let's grab something.", "added_for": "grab", "reason": "break hungry-drill with action-suggestion"},
            "2764199",  # Mom, I'm hungry.
            "2294114",  # I bet you're hungry.
        ],
        [
            "2544089",  # I'm starting to get hungry.
            "295966",   # He's power-hungry.
            "2951990",  # I didn't realize you were hungry.
            {"text": "I didn't want to be a bother.", "added_for": "bother", "reason": "natural reply"},
            "3287384",  # I can cook you something if you're hungry.
        ],
        [
            "4495309",  # No one's hungry.
            "2648145",  # Everybody's hungry.
            "2648986",  # Nobody's hungry.
        ],
        [
            "2326232",  # I figured everyone was hungry.
            "1961626",  # I thought you might be hungry, so I made some sandwiches.
            {"text": "You're a lifesaver.", "added_for": "lifesaver", "reason": "warm idiomatic thanks"},
            "1690392",  # I'm hungry and thirsty.
            "259484",   # I haven't eaten since breakfast and I'm very hungry.
            "4440572",  # I ate lunch at around eleven because I was hungry.
        ],
        [
            "2647674",  # I'm terribly hungry.
            "4494163",  # They were terribly hungry.
            "32683",    # If you're still hungry, have another hamburger.
            "4579227",  # Even though I ate three bowls of cereal for breakfast, I'm still hungry.
        ],
        [
            "314121",   # She whispered to me that she was hungry.
            "953085",   # All five rabbits were eaten by the hungry wolves.
            "18157",    # Hunger is the best sauce.
            "3732653",  # Hunger makes anything taste good.
            "3732727",  # Hunger is the best spice.
            "4529522",  # What can hunger strikes achieve?
        ],

        # ===========================================================
        # === Grandfather — split, vocab-widened ===
        # ===========================================================
        [
            "307809",   # He reminds me of my grandfather.
            "300797",   # He resembles his grandfather.
            "3130079",  # I was named after my great-grandfather.
            "65095",    # My grandfather is a bit hard of hearing.
            {"text": "Make sure he can see your face when you speak.", "added_for": "see", "reason": "natural caring tip"},
        ],
        [
            "2057644",  # My grandfather loved reading.
            "1487358",  # My grandfather likes reading books.
            "3831267",  # My grandfather was a hero.
            "251345",   # My grandfather was a soldier during the war.
            "251336",   # My grandfather was part Indian.
        ],
        [
            "819064",   # My grandfather was a farmer.
            "250235",   # My grandfather is a carpenter.
            "3831741",  # My grandfather built this house.
            "273874",   # My grandfather gave me a birthday present.
            "4699986",  # My grandfather no longer has a driver's license.
        ],
        [
            "1192412",  # My grandfather goes for walks on days when the weather is good.
            "2239912",  # I bought a scarf for my grandfather for his 88th birthday.
            "273860",   # My grandfather lived to be ninety-nine years old.
            "326407",   # An old man sat surrounded by his grandchildren.
        ],

        # ===========================================================
        # === Grandmother / grandma / grandparents ===
        # ===========================================================
        [
            "1499835",  # My grandmother is sick.
            "285280",   # His grandmother looks healthy.
            "3822750",  # My grandmother raised me.
            {"text": "She must have been special.", "added_for": "special", "reason": "warm reply"},
            "1336561",  # My grandmother loves watching TV.
            "5592285",  # My grandmother passed away last year.
            "436453",   # I'm visiting my grandmother in the hospital.
            "2335905",  # My grandmother fell and broke her hip.
        ],
        [
            "3171780",  # This is a ring my grandmother wore.
            "5189017",  # I used to stay with my grandmother for a couple of weeks every summer.
            "27278",    # My youngest brother was brought up by our grandmother.
            "909562",   # She spends time with her grandmother every Sunday.
            "3832021",  # My grandmother knit that by hand.
            "4517682",  # My grandmother used to use her sewing machine a lot when she was younger.
            "259159",   # I have a dim memory of my grandmother.
        ],
        [
            "533205",   # My grandma has gotten very old.
            "64941",    # My grandma injured her leg in a fall.
            "247158",   # We're worried about Grandma and Grandpa.
            "394891",   # Where does your grandpa live?
            {"text": "Out in the countryside.", "added_for": "countryside", "reason": "natural answer"},
            "4664171",  # My grandchildren attend this school.
            "5193410",  # I want to leave my farm to my grandchildren.
            "814624",   # My grandson is still a baby.
            "2358730",  # I have a granddaughter about your age.
            "4017276",  # Are your grandparents still alive?
            "4593853",  # First cousins have one set of grandparents in common.
            "5189016",  # I used to visit my grandparents several times a month when I was a kid.
            "4497470",  # My grandparents didn't have indoor plumbing.
            "953468",   # Long Thai-food + grandmother sentence.
        ],

        # ===========================================================
        # === Patience / patient ===
        # ===========================================================
        [
            "2248100",  # I'm losing patience.
            "2541923",  # I'm beginning to lose patience.
            "245956",   # Children sometimes lack patience.
            {"text": "It's a virtue, they say.", "added_for": "virtue", "reason": "natural idiomatic reply"},
            "4501767",  # This requires patience.
            "4494889",  # Patience is the key.
            "19071",    # Patience is essential for a teacher.
            "30984",    # With a little more patience, you would have succeeded.
            "2358920",  # I've always admired your patience.
            "4501761",  # Exceptional patience is required.
        ],

        # ===========================================================
        # === Privacy / classified ===
        # ===========================================================
        [
            "2243276",  # They needed privacy.
            "3830668",  # I value my privacy.
            "2325792",  # I expected a little privacy.
            {"text": "I'll give you some space.", "added_for": "space", "reason": "natural reply"},
            "4664796",  # There are also privacy concerns.
            "825980",   # We must respect other people's privacy.
            "4665717",  # This document is classified.
            "1954798",  # We can't reveal classified information.
        ],

        # ===========================================================
        # === Honor / civic / duty ===
        # ===========================================================
        [
            "4494710",  # This is a huge honor.
            "4963977",  # I'm on the honor roll.
            "2546682",  # I'll honor your wishes.
            "2202948",  # You're honorable.
            "715037",   # There is no honor among thieves.
            "1925378",  # It's your civic duty to vote.
            "3825036",  # I'm just doing my civic duty.
            "3370778",  # Mary is the maid of honor.
        ],

        # ===========================================================
        # === Cops / cop / suspect / custody ===
        # ===========================================================
        [
            "2247887",  # I'm a cop.
            "1890968",  # I'm calling the cops.
            {"text": "Wait — let's not jump to conclusions.", "added_for": "conclusions", "reason": "natural escalation hedge"},
            "4502564",  # Tell the cops the truth.
            "3636143",  # The place is surrounded by cops.
            "4497085",  # The place was crawling with cops.
            "4496254",  # The lone police officer called for backup.
        ],
        [
            "3240701",  # We've got a suspect in custody.
            "3240707",  # The police have a suspect in custody.
            "2163164",  # The police detained several suspects for questioning.
            "4500962",  # The police officers took the man who was yelling into custody.
            "681501",   # The police could not control the mob.
            "4498764",  # A mob quickly formed.
        ],

        # ===========================================================
        # === Allegations / accusations / evidence ===
        # ===========================================================
        [
            "2439795",  # These allegations are ridiculous.
            "4495576",  # Are these allegations true?
            {"text": "Not as far as I know.", "added_for": "far", "reason": "natural hedged N"},
            "1010102",  # Can you prove the allegations?
            "4529921",  # It's an absurd allegation.
            "4529631",  # It's a very serious allegation.
            "4816773",  # No DNA evidence was found.
            "886942",   # She allegedly murdered him.
        ],

        # ===========================================================
        # === Witch / witches / haunted / sinister ===
        # ===========================================================
        [
            "941696",   # The witch hunt has begun.
            "5565106",  # Mary dressed up as a witch.
            "4663775",  # I used to think that witches were real.
            "2249187",  # It's probably haunted.
            "1415982",  # This house is haunted.
            "4502226",  # That sounds sinister.
            "3619936",  # That's a horrifying thought.
            "2248846",  # It was horrifying.
        ],

        # ===========================================================
        # === Idiots / disgrace ===
        # ===========================================================
        [
            "1111986",  # I'm such an idiot.
            "2543265",  # You're acting like an idiot.
            "2111275",  # They're idiots.
            "3732149",  # What a bunch of idiots!
            {"text": "Don't be so harsh on them.", "added_for": "harsh", "reason": "balancing reply"},
            "2218013",  # You're a disgrace.
            "277285",   # I would rather die than disgrace myself.
        ],

        # ===========================================================
        # === Naive / arrogant / cynical / reckless ===
        # ===========================================================
        [
            "2954948",  # You're incredibly naive.
            "4664832",  # It's naive to believe otherwise.
            {"text": "Maybe I am, but I'd rather hope.", "added_for": "hope", "reason": "sophisticated comeback"},
            "5899613",  # You're very arrogant.
            "2547700",  # I'm not that cynical.
            "3825496",  # Do you think I'm cynical?
            "2203258",  # You're reckless.
        ],

        # ===========================================================
        # === Trash / garbage / clutter ===
        # ===========================================================
        [
            "61822",    # Don't throw trash here.
            "4012281",  # Have you taken out the trash?
            {"text": "I'll do it after dinner.", "added_for": "after", "reason": "natural reply"},
            "5620298",  # We've got to get rid of all this trash.
            "273194",   # There's a lot of trash on the far bank of the river.
            "3819102",  # I burned the trash.
            "5916631",  # I've emptied the trash.
            "2253784",  # Tomorrow's trash day.
        ],

        # ===========================================================
        # === Stadium / fans / spectators ===
        # ===========================================================
        [
            "51975",    # There were lots of people in the stadium.
            "324095",   # There were a lot of excited fans in the stadium.
            "324097",   # The stadium was packed with excited spectators.
            "257329",   # I arrived at the stadium at 4:00 p.m., but the game had already started.
        ],

        # ===========================================================
        # === ID / identification / photo ID ===
        # ===========================================================
        [
            "1306579",  # His ID was fake.
            "4501768",  # Proper ID is required.
            "2539771",  # I'm going to need to see a photo ID.
            {"text": "I left mine in the car.", "added_for": "car", "reason": "natural realistic reply"},
            "5573336",  # Bring your student ID card.
            "915843",   # I need to renew my ID card.
            "2951634",  # Do you have identification?
            "2539753",  # I'm not carrying any identification.
        ],

        # ===========================================================
        # === Info / verify ===
        # ===========================================================
        [
            "6126559",  # Where did you get this info?
            {"text": "I'd rather not say.", "added_for": "rather", "reason": "polite hedge"},
            "1886284",  # Can anyone verify that?
            "3469016",  # Let me verify that.
            "2951605",  # Could you verify that your computer is plugged in?
        ],

        # ===========================================================
        # === Catholic / monk / nun / religion ===
        # ===========================================================
        [
            "2248128",  # I'm not Catholic.
            "2012964",  # I think I want to be a monk.
            "1886325",  # Are you really a nun?
            "3821862",  # Mary wants to be a nun.
            "1030055",  # Mary lived in a convent for a few months.
            "2045839",  # The preacher gave a beautiful sermon.
            "5825325",  # The sermon was awfully long.
        ],

        # ===========================================================
        # === Mining / coal ===
        # ===========================================================
        [
            "2282183",  # I grew up in a mining town.
        ],

        # ===========================================================
        # === Therapy / therapist ===
        # ===========================================================
        [
            "4015518",  # Maybe therapy would help.
            "5853128",  # I'm a therapist.
            "2546528",  # I'm seeing a therapist.
            "3115673",  # I've been in therapy since I was thirteen.
            "2248975",  # It'll be therapeutic.
            "4494388",  # Cookie is a therapy dog.
        ],

        # ===========================================================
        # === Depression / sadness ===
        # ===========================================================
        [
            "4853376",  # Depression is an awful thing.
            "5859027",  # I became depressed.
            "2406819",  # I suddenly feel depressed.
            "3825401",  # When it rains, I get depressed.
            "1838385",  # I'd be depressed if they asked me to quit the team.
            "2220428",  # That sounds depressing.
            "4497207",  # It was truly depressing.
            "6099149",  # It's a depressing prospect.
            "2291828",  # I always eat junk food when I'm depressed.
        ],

        # ===========================================================
        # === Loneliness / lonely / mourning ===
        # ===========================================================
        [
            "852246",   # He isn't lonely anymore.
            "5938338",  # I was sad and lonely.
            "293734",   # He set out on a lonely journey.
            "887437",   # She thinks about him when she's feeling lonely.
            "3822977",  # What causes loneliness?
            {"text": "Disconnection, mostly.", "added_for": "disconnection", "reason": "thoughtful L17 answer"},
            "2276013",  # I don't handle loneliness well.
            "4014705",  # What's the best cure for loneliness?
            "3822217",  # We're in mourning.
            "5853073",  # I'm in mourning.
        ],

        # ===========================================================
        # === Cute / stunning / marvelous ===
        # ===========================================================
        [
            "2214310",  # You're kind of cute when you're mad.
            "5649044",  # Cats are cute.
            "5287944",  # Baby ducks are cute.
            "4774124",  # Mary looks cute no matter what she wears.
            "1927429",  # The girl who works at that bakery is cute.
            "2248668",  # Isn't it stunning?
            "1493355",  # Mary looks absolutely stunning.
            "2255041",  # You look marvelous.
        ],

        # ===========================================================
        # === Outfit / matching / wardrobe ===
        # ===========================================================
        [
            "2377633",  # I like your outfit.
            "2434504",  # I love your outfit.
            {"text": "Thanks — it's new.", "added_for": "new", "reason": "natural reply to compliment"},
            "5288157",  # Mary and Alice wore matching outfits.
        ],

        # ===========================================================
        # === Closet / wardrobe / skeletons ===
        # ===========================================================
        [
            "2372870",  # I just organized my closet.
            "2545247",  # The closet door is stuck.
            "2095467",  # There's someone hiding in the closet.
            {"text": "Did you check?", "added_for": "check", "reason": "natural reply"},
            "2361198",  # I don't have enough closet space.
            "253434",   # I hung my coat in the hall closet.
            "2360847",  # I hid the bracelet in a shoe in my closet.
            "3083552",  # Mary looked through her closet trying to find something suitable to wear.
            "953523",   # I looked in my closet for something to wear, but couldn't find anything appropriate for the occasion.
            "36672",    # There is a skeleton in every closet.
            "37541",    # Every family has a skeleton in the closet.
        ],

        # ===========================================================
        # === Insanity / sane / bizarre / hysterical ===
        # ===========================================================
        [
            "2242984",  # They're insane.
            "3172330",  # Are you sane?
            "1898448",  # A sane man wouldn't do that.
            "2467388",  # It's bizarre.
            "2233661",  # This is bizarre.
            "1483022",  # Mary is hysterical.
            "2233694",  # This is hysterical.
        ],

        # ===========================================================
        # === Genius / phenomenal / breakthrough ===
        # ===========================================================
        [
            "2207264",  # You're a genius.
            "2247891",  # I'm a genius.
            {"text": "I wouldn't go that far.", "added_for": "far", "reason": "modest L17 hedge"},
            "3821531",  # It's phenomenal.
            "4494985",  # This is phenomenal.
            "5090013",  # This is a real breakthrough.
            "5098200",  # That was a huge breakthrough.
            "3147919",  # This is a priceless masterpiece.
        ],

        # ===========================================================
        # === Awesome / impressive / startling ===
        # ===========================================================
        [
            "2892392",  # Tonight is going to be awesome.
            "2953621",  # We had an awesome time at the zoo.
            "4529505",  # It was an awesome accomplishment.
            "3831393",  # Your resume is very impressive.
            "4500212",  # We were duly impressed.
            "5938352",  # I was duly impressed.
            "4493937",  # The possibilities are infinite.
            "4496421",  # The changes are startling.
        ],

        # ===========================================================
        # === Disgusting / appalling / horrifying ===
        # ===========================================================
        [
            "4495357",  # What a disgusting individual!
            "4502386",  # This stuff is disgusting.
            "3596811",  # Smoking is a disgusting habit.
            "3363730",  # I'm disgusted.
            "4401048",  # I was disgusted.
            "1895776",  # You disgust me.
            "2111464",  # That's appalling.
            "1488440",  # This is appalling.
        ],

        # ===========================================================
        # === Hideous / filthy / rotten ===
        # ===========================================================
        [
            "2202943",  # You're hideous.
            "3727759",  # It looks hideous.
            "6099169",  # You're filthy.
            "3732144",  # What rotten luck!
            "5111943",  # This banana is rotten.
            "5270372",  # The wood is rotten.
            "4166863",  # Did you know that rotten eggs float?
            "541073",   # There were many rotten apples in the basket.
            "1327526",  # Some eggs weren't rotten, but the rest of them were.
            "319421",   # One rotten apple spoils the barrel.
            "3287160",  # It smells like something's rotting.
            "4664619",  # That smell could be rotting meat.
        ],

        # ===========================================================
        # === Stink / foul / odors ===
        # ===========================================================
        [
            "4834656",  # You stink.
            "2290894",  # Your shoes stink.
            "4502188",  # There was a foul smell.
            "5641833",  # I thought it was a foul ball.
            "301891",   # He uses foul language whenever he gets angry.
        ],

        # ===========================================================
        # === Compliments / flattering / gracious ===
        # ===========================================================
        [
            "1822841",  # Thanks for the compliment.
            "2387116",  # I meant that as a compliment.
            "1959122",  # I'm not sure if it's a compliment or an insult.
            {"text": "Take it as a compliment.", "added_for": "take", "reason": "natural follow-up"},
            "2251309",  # That's very flattering.
            "5939025",  # You're very gracious.
            "3426372",  # Mary is gracious to everyone.
            "2389588",  # I ought to wear this tie more often. I've gotten a lot of compliments today.
            "652410",   # It's more polite to say thin than skinny.
        ],

        # ===========================================================
        # === Suitcase / luggage / packing ===
        # ===========================================================
        [
            "3260514",  # Which is your suitcase?
            "276152",   # Somebody has stolen my suitcase.
            {"text": "Did you report it?", "added_for": "report", "reason": "natural concerned reply"},
            "4694949",  # I could hardly close the suitcase.
            "4014677",  # This suitcase is heavier than it looks.
            "52369",    # The suitcase contained nothing but dirty clothes.
            "6118318",  # You should be packing your suitcase right now.
            "61004",    # Would you mind helping me carry this suitcase?
            "4014374",  # Could you keep an eye on my suitcase for a few minutes?
            "709098",   # A customs official asked me to open my suitcase.
        ],

        # ===========================================================
        # === Travel / visa / consulate / asylum ===
        # ===========================================================
        [
            "34797",    # Please extend this visa.
            "72158",    # Do you accept Visa?
            "256731",   # I have a tourist visa.
            "2643066",  # Aren't you from the consulate?
            "3826503",  # I want political asylum.
            "5852761",  # I'm a refugee.
            "1315796",  # He donated $10,000 to the refugee fund.
            "303625",   # He was exiled from his country.
            "2248342",  # I've been exiled.
        ],

        # ===========================================================
        # === Aisle / elevator / hallway ===
        # ===========================================================
        [
            "278423",   # Could I sit on the aisle?
            "1008012",  # Would you prefer a window or an aisle seat?
            {"text": "Window, please.", "added_for": "window", "reason": "natural answer"},
            "2245584",  # Hold the elevator.
            "434776",   # Give me a room near the elevator.
            "534213",   # I took the elevator to the fourth floor.
            "262714",   # We rode in an elevator.
            "5221363",  # I hate elevators.
            "5724135",  # The hallway needs to be wide enough for a wheelchair.
            "1426416",  # The hallway is slippery, so watch your step.
        ],

        # ===========================================================
        # === Stairs / downstairs ===
        # ===========================================================
        [
            "2199060",  # I ran downstairs.
            "2243147",  # They headed downstairs.
            "3727501",  # They walked downstairs.
            "4494023",  # Your friends are downstairs.
            "1898255",  # Please use the bathroom downstairs.
            "2643352",  # The lights are on downstairs.
            "264905",   # I left my dictionary downstairs.
            "2220690",  # Go ahead. I'll meet you downstairs.
            "2358718",  # I have a friend waiting downstairs.
            "311386",   # She had the box carried downstairs.
            "5201368",  # I went downstairs and turned off the light.
        ],

        # ===========================================================
        # === Wheelchair / mobility ===
        # ===========================================================
        [
            "3590467",  # Do you need a license to use an electric wheelchair?
            "3590468",  # Does an electric wheelchair require a driver's license?
        ],

        # ===========================================================
        # === Vacancy / hotel / evacuation ===
        # ===========================================================
        [
            "4494715",  # There is one vacancy.
            "434550",   # Do you have a vacancy?
            {"text": "Just for one night?", "added_for": "night", "reason": "natural reception reply"},
            "4494346",  # The hotel was evacuated.
            "5364147",  # The building has been evacuated.
            "4493811",  # The hotels along the beach were evacuated.
            "2245469",  # Everyone's been evacuated.
        ],
        [
            "2877927",  # Evacuation will be difficult.
            "4501301",  # Evacuation orders have been issued.
            "2249825",  # Prepare to evacuate.
            "3312372",  # We have to evacuate immediately.
            "1325010",  # We have 24 hours to evacuate the city.
            "1713907",  # The alarm rang and everyone had to evacuate.
        ],

        # ===========================================================
        # === Unrest / riot / crisis ===
        # ===========================================================
        [
            "807040",   # The unrest lasted three days.
            "4495236",  # There were riots.
            "4494249",  # The problem is prevalent.
            "4664623",  # Prejudice will continue to exist.
            "4501294",  # Operations are already underway.
            "4496881",  # Construction is already underway.
            "5135016",  # An investigation is underway.
            "4500543",  # That headline was extremely misleading.
        ],

        # ===========================================================
        # === Censorship / discretion / parental ===
        # ===========================================================
        [
            "3825825",  # What do you think of censorship?
            {"text": "I'm against it in most cases.", "added_for": "against", "reason": "natural opinion reply"},
            "5454835",  # We don't censor anything.
        ],

        # ===========================================================
        # === Brave / coward / fist ===
        # ===========================================================
        [
            "1316522",  # He tried to be brave while he was being held hostage.
            "260495",   # I called him a coward to his face.
            "409202",   # The coward is the first to raise his fist.
            "2240985",  # We're cowards.
            "890806",   # I can't stand cowards.
            "2253844",  # Use your fist.
            "886995",   # She attacked him with her fists.
            "1190279",  # I shoved my hands into my pockets.
            "299222",   # He shoved the letter into his pocket.
        ],

        # ===========================================================
        # === Hostage / terrorism ===
        # ===========================================================
        [
            "3823714",  # They've got a hostage.
            "3733623",  # The hostages are alive.
            "4904861",  # The hostages are facing death.
            "681885",   # The terrorists released the hostages.
            "4529749",  # The hostages appear to be OK.
            {"text": "That's a relief.", "added_for": "relief", "reason": "natural anxious reply"},
        ],

        # ===========================================================
        # === Treason / loyalty ===
        # ===========================================================
        [
            "2123551",  # That's treason.
            "2891973",  # That would be treason.
            "4495490",  # We admire your loyalty.
            "3142954",  # Are you questioning my loyalty?
            {"text": "Of course not.", "added_for": "course", "reason": "natural reply"},
        ],

        # ===========================================================
        # === Conspiracy / illusion / speculation ===
        # ===========================================================
        [
            "3365417",  # It's a conspiracy.
            "3825582",  # It's all a conspiracy.
            "2249040",  # It's an illusion.
            "55959",    # This looks longer than that, but it is an optical illusion.
            "1229352",  # Illusions are short lived.
            "2251212",  # That's pure speculation.
            "4499938",  # I can only speculate.
            "2013625",  # I wouldn't want to speculate.
            "2361154",  # I don't engage in idle speculation.
        ],

        # ===========================================================
        # === Verdict / lawsuit / sued ===
        # ===========================================================
        [
            "4529821",  # I disagree with the verdict.
            "2248355",  # I've been sued.
            "5840453",  # I jumped bail.
            "5852705",  # I'm an ex-con.
            "1836096",  # I'm not a crook.
            "1700092",  # This guy is a crook.
            "3921534",  # My lawyer's talking to the prosecutor.
        ],

        # ===========================================================
        # === Attorney / surgeon / physician ===
        # ===========================================================
        [
            "5916625",  # I've hired an attorney.
            "3374152",  # I'm the surgeon.
            "2954195",  # Who's your primary physician?
            {"text": "I don't have one yet.", "added_for": "yet", "reason": "natural reply"},
            "2247885",  # I'm a civilian.
            "256155",   # I'm a salesman.
            "5109438",  # That car salesman isn't honest.
            "2767500",  # I have a diploma.
            "260581",   # I think his job resume is questionable.
        ],

        # ===========================================================
        # === Veterans / military ===
        # ===========================================================
        [
            "4501111",  # Veterans need more jobs.
        ],

        # ===========================================================
        # === Pickup / tow / wreck / vehicle ===
        # ===========================================================
        [
            "2540226",  # I was rear-ended by a pickup truck.
            "1773412",  # I'm a total wreck.
            "1849070",  # You're a nervous wreck.
            "4497272",  # Thirteen people died in the train wreck.
            "1955072",  # We can't tow this car.
            "3312650",  # We could use a tow.
            "2513233",  # Your car is being towed.
            "5045080",  # Your car has been towed away.
            "2543858",  # Your car's totally wrecked.
            "1345958",  # The train flipped over.
        ],

        # ===========================================================
        # === Trunk / hood / car parts ===
        # ===========================================================
        [
            "36923",    # Is your trunk locked?
            "5852450",  # I shut the trunk.
            "4012259",  # There's a blanket in the trunk.
            "2361963",  # I've got a rope in my trunk.
            "1365196",  # He popped the trunk.
            "2541740",  # The spare tire is in the trunk.
            "33063",    # Open the hood.
        ],

        # ===========================================================
        # === Hybrid / automated cars ===
        # ===========================================================
        [
            "1887292",  # I drive a hybrid.
            "5874470",  # This train is fully automated.
            "4478222",  # This factory is almost fully automated.
        ],

        # ===========================================================
        # === Calculate / calculator / arithmetic ===
        # ===========================================================
        [
            "2012085",  # Do you want a calculator?
            "2377298",  # I left my calculator on my desk.
            "262137",   # I must calculate how much money I'll spend next week.
            "42827",    # I calculated that it would cost 300 dollars.
            "3734281",  # It's a calculated risk.
            "4825453",  # I made a rough calculation.
            "2359072",  # I've been doing some calculations.
            "2359936",  # I've made a mistake in my calculations.
            "295728",   # He's good at arithmetic.
            "2329593",  # I got a B in arithmetic.
        ],

        # ===========================================================
        # === Pros & cons / weighing decisions ===
        # ===========================================================
        [
            "5592439",  # We have to weigh the pros and cons.
            "4817126",  # As long as you are thinking about the pros and cons of a relationship, I don't think you can call it love.
            {"text": "That's a thought-provoking idea.", "added_for": "thought", "reason": "L17 reflective reply"},
        ],

        # ===========================================================
        # === Headaches / aches / pains ===
        # ===========================================================
        [
            "3151091",  # You're giving me a headache.
            "2544928",  # I woke up with a headache.
            "280178",   # Do you have a headache and a sore throat?
            {"text": "Both, actually.", "added_for": "both", "reason": "natural Y answer to compound Q"},
            "398524",   # When I think about those students, it gives me a headache.
            "283536",   # The reason he was absent was that he had a severe headache.
            "280120",   # I have a splitting headache.
            "2931907",  # Do you still suffer from headaches?
        ],

        # ===========================================================
        # === Diabetes / cholesterol / asthma ===
        # ===========================================================
        [
            "280075",   # I have diabetes.
            "3825391",  # Do you have diabetes?
            "5839992",  # I'm diabetic.
            "56108",    # My cholesterol is high.
            "56107",    # My cholesterol levels are high.
            "326617",   # I had an asthma attack.
            "5100570",  # Do you have any asthma medicine?
            "1341356",  # To get a prescription, go to a doctor.
            "4504138",  # Can you get that medicine over the counter or do you need a prescription?
        ],

        # ===========================================================
        # === Transplant / organ / surgery ===
        # ===========================================================
        [
            "3360266",  # You need a heart transplant.
            "2396222",  # Is it really possible to do a brain transplant?
            {"text": "Not yet, but science is advancing.", "added_for": "science", "reason": "natural L17 reply"},
        ],

        # ===========================================================
        # === Belly / kidney / rib / body ===
        # ===========================================================
        [
            "5858417",  # I have a beer belly.
            "323760",   # The eye is bigger than the belly.
            "5397102",  # Mary wants to get her belly button pierced.
            "270666",   # I have kidney trouble.
            "3723052",  # I had a kidney stone.
            "4135235",  # I have a kidney condition.
            "2362134",  # I just cracked a rib.
            "5859546",  # I have a broken rib.
            "326604",   # I fractured my arm.
        ],

        # ===========================================================
        # === Elbow / arm / numb ===
        # ===========================================================
        [
            "2270319",  # Don't bend your elbow.
            "3436691",  # My elbow still hurts.
            "39418",    # I have tennis elbow.
            "3367217",  # I have a mosquito bite on my elbow.
            "2293487",  # I banged my elbow against the wall.
            "292504",   # He leaned on his elbows.
            "4239301",  # Keep your elbows off the table.
            "317437",   # She put her elbows on her knees.
            "252095",   # My arms went numb.
            "3821871",  # My fingers are numb.
            "3831334",  # My legs are getting numb.
        ],

        # ===========================================================
        # === Chin / shoulders / limp / shrug ===
        # ===========================================================
        [
            "3506456",  # Keep your chin up.
            "2478831",  # I shrugged my shoulders.
            "5828895",  # I shrugged.
            "5916083",  # I still have a slight limp.
            "3359717",  # Why are you walking with a limp?
            {"text": "I twisted it last week.", "added_for": "twisted", "reason": "natural answer"},
        ],

        # ===========================================================
        # === Choking / breathing / vomiting ===
        # ===========================================================
        [
            "2218126",  # You're choking me.
            "887034",   # She choked him.
            "4496172",  # I could scarcely breathe.
            "18952",    # I feel like vomiting.
        ],

        # ===========================================================
        # === Hand / fingers / wrench ===
        # ===========================================================
        [
            "50293",    # Hand me the wrench.
        ],

        # ===========================================================
        # === Braces / teeth / crooked ===
        # ===========================================================
        [
            "5829224",  # I have braces.
            "322885",   # My daughter has braces.
            "263635",   # I have crooked teeth.
            "35826",    # Your tie is crooked.
        ],

        # ===========================================================
        # === Handwriting / signature ===
        # ===========================================================
        [
            "1323927",  # His handwriting is bad.
            "1495806",  # Whose handwriting is this?
            "298357",   # His handwriting is poor.
            "5930289",  # I have terrible handwriting.
            {"text": "Doctors are notorious for that.", "added_for": "notorious", "reason": "natural L17 idiom"},
            "5768000",  # Do you recognize this handwriting?
            "70416",    # Your handwriting is similar to mine.
            "2561716",  # There was a handwritten note on the door.
            "4495423",  # Handwritten essays won't be accepted.
        ],

        # ===========================================================
        # === Curly / skinny / appearance ===
        # ===========================================================
        [
            "5852150",  # I have curly hair.
            "3367316",  # My hair is naturally curly.
            "282707",   # My hair is greasy.
            "1476207",  # It's a bit greasy.
            "5916720",  # You're awfully skinny.
            "276941",   # Men like to look masculine.
            "4493220",  # Mary isn't very feminine.
            "4372809",  # Mary is a formidable woman.
        ],

        # ===========================================================
        # === Wig / makeup / hair ===
        # ===========================================================
        [
            "2649210",  # Is that a wig?
            "3818542",  # Take off your wig.
            "2951666",  # Do you have hair clippers?
            "2542293",  # Mary went to the beauty salon.
            "2255369",  # You'll get wrinkles.
            "254039",   # I ironed out the wrinkles in my pants.
        ],

        # ===========================================================
        # === Trimmed / beard / scissors ===
        # ===========================================================
        [
            "3254058",  # I'd like to have my hair trimmed.
            "512939",   # He trimmed his beard for the wedding.
            "1961282",  # I thought I told you to trim your beard.
            "4628647",  # Why are you holding a pair of scissors?
            "258062",   # I cut the paper with a pair of scissors.
            "258147",   # I sometimes use scissors as a can opener.
        ],

        # ===========================================================
        # === Sunglasses / shades ===
        # ===========================================================
        [
            "2707469",  # I'm wearing sunglasses.
            "2826550",  # He's wearing sunglasses.
        ],

        # ===========================================================
        # === Robe / pajamas ===
        # ===========================================================
        [
            "2649014",  # Is that my robe?
            "2640011",  # Mary slipped off her robe and got into the shower.
        ],

        # ===========================================================
        # === Apron / housekeeping ===
        # ===========================================================
        [
            "4061753",  # Mary wiped her eyes with her apron.
            "5276257",  # Mary dried her hands on her apron.
            "3823676",  # I have a housekeeper.
            "1898308",  # My mother never wanted to be just a housewife.
        ],

        # ===========================================================
        # === Laundry / chores ===
        # ===========================================================
        [
            "3459863",  # Could you hang up the laundry?
            {"text": "I'll do it in a minute.", "added_for": "minute", "reason": "natural reply"},
            "32514",    # May I wash all my laundry at once?
            "281842",   # I do the laundry on Sundays.
            "5853226",  # On a hot day like this, the laundry will be dry in no time.
            "1976506",  # Mary is hanging up the laundry.
            "2007745",  # Let's mop the floor.
            "1887613",  # I promise I'll mop the floor tomorrow morning.
        ],

        # ===========================================================
        # === Groceries / shopping / store ===
        # ===========================================================
        [
            "430012",   # I go grocery shopping every morning.
            "4190431",  # This grocery store only sells organic food.
            "4495922",  # Plastic grocery bags have been banned.
            "2799751",  # I'll help you shop for groceries.
            "2293496",  # I barely have enough money for groceries.
        ],

        # ===========================================================
        # === Pie / dessert / cake / baking ===
        # ===========================================================
        [
            "39477",    # I want ice cream for dessert.
            "4016457",  # Would you like to order dessert?
            {"text": "Just coffee, thanks.", "added_for": "coffee", "reason": "polite N to dessert"},
            "4499542",  # Chocolate cake is my favorite dessert.
            "2380401",  # I made an apple pie for dessert.
            "39471",    # I'm trying to save room for dessert.
            "4499716",  # Desserts are my specialty.
        ],
        [
            "5808002",  # Another batch of cookies are coming out of the oven.
            "2844217",  # Add salt and baking soda to the water.
            "1887090",  # I baked you a loaf of bread.
            "1887445",  # I just remembered that I was supposed to buy a loaf of bread.
            "5023017",  # The bun was half eaten.
        ],

        # ===========================================================
        # === Pudding / lemonade / sweets / candy ===
        # ===========================================================
        [
            "34125",    # Here's your pudding.
            "5798390",  # Mary made chocolate pudding for the boys.
            "3123475",  # Would you like some lemonade?
            "3150462",  # Would you like to buy some lemonade?
            "2243313",  # They sell candy.
            "4016793",  # Here's a piece of candy.
            "954579",   # What surprised me most was that she didn't like candy.
        ],

        # ===========================================================
        # === Snacks / hamburger / sandwich ===
        # ===========================================================
        [
            "5859526",  # I fixed us a snack.
            "19708",    # There's enough time for a quick snack.
            "5162550",  # The urge to snack is hard to resist.
            "3731601",  # Did you pack any snacks?
            "5135014",  # Free snacks will be provided.
            "247878",   # We prepared snacks beforehand.
            "906969",   # What's your favorite salty snack?
            {"text": "Salted peanuts.", "added_for": "peanuts", "reason": "natural answer"},
        ],

        # ===========================================================
        # === Garlic / mustard / spices ===
        # ===========================================================
        [
            "898590",   # Will feeding my dog garlic cause any problems?
            "5916509",  # I forgot to buy mustard.
            "6126086",  # Don't put too much mustard on my sandwich.
            "953982",   # Is eating a clove of garlic every day beneficial to your health?
        ],

        # ===========================================================
        # === Goat / cheese / dairy ===
        # ===========================================================
        [
            "2361642",  # I love goat cheese.
            "6459866",  # Is this goat cheese?
            "5850713",  # I fed the goats.
            "5218243",  # These goats are extremely friendly.
            "4135290",  # I haven't eaten dairy products for a while.
            "953588",   # I seldom eat dairy products.
        ],

        # ===========================================================
        # === Grapes / fruit ===
        # ===========================================================
        [
            "60579",    # These grapes taste sour.
            "68625",    # The grapes are sour.
            "1876650",  # We spent the afternoon eating grapes.
            "2291891",  # I asked for grape juice.
            "261563",   # I like grape jelly best.
            "57385",    # These grapes are ripe.
            "4133559",  # There are some grapes in the refrigerator.
        ],
        [
            "4285793",  # Peaches are sweet.
            "4133543",  # I don't like peaches.
            "2772380",  # I planted a peach tree in my yard.
            "3084103",  # This is a pear.
            "60753",    # This pear smells nice.
            "5878896",  # Berries can be frozen.
            "3022188",  # When is blueberry season?
            "3315053",  # I'm not a big fan of blueberry pancakes.
        ],
        [
            "244893",   # The cherry blossoms are at their best.
            "248757",   # We got to Washington in time for the cherry blossoms.
            {"text": "They're stunning this year.", "added_for": "stunning", "reason": "natural reply"},
        ],

        # ===========================================================
        # === Eating disorders / scrambled ===
        # ===========================================================
        [
            "2248105",  # I'm making pancakes.
            "4042271",  # I'm making scrambled eggs.
            "4498203",  # I ate scrambled eggs and sausage for breakfast.
            "2358977",  # I have an eating disorder.
            "5360563",  # Mary has an eating disorder.
        ],

        # ===========================================================
        # === Boil / cube / ice / kettle ===
        # ===========================================================
        [
            "4496105",  # Boil the potatoes until they are tender.
            "59703",    # This beef is tender.
            "5541623",  # A cube has six sides.
            "681181",   # This is an ice cube.
            "2387491",  # I need ice cubes.
            "324248",   # The kettle is boiling.
            "5852924",  # I'll put the kettle on and we'll have a cup of tea.
        ],

        # ===========================================================
        # === Cocktail / champagne / drinks ===
        # ===========================================================
        [
            "906724",   # What's your favorite cocktail?
            {"text": "An old-fashioned.", "added_for": "fashioned", "reason": "L17 sophisticated drink name"},
            "1892665",  # I didn't see you at my cocktail party last weekend.
            "4502055",  # Cocktails will be at 6:00 and dinner will be served at 6:30.
            "4879971",  # Do you drink diet soda?
            "4013275",  # Could you get me a club soda?
            "267093",   # Draft beer tastes especially good on a hot day.
            "1521830",  # My father doesn't drink liquor.
            "57762",    # Liquor is not sold at this store.
            "301203",   # He satisfied his thirst with a large glass of beer.
            "35763",    # I'm dying of thirst.
        ],

        # ===========================================================
        # === Stuffed / digestion ===
        # ===========================================================
        [
            "2203413",  # We're stuffed.
            "361345",   # I'm stuffed!
            "29227",    # Wine helps digest food.
            "4091901",  # Wine helps with digestion.
        ],

        # ===========================================================
        # === Skip — meal / class / chapter ===
        # ===========================================================
        [
            "5851662",  # I seldom skip meals.
            "27668",    # It won't hurt you to skip one meal.
            "4014284",  # I wish I hadn't skipped breakfast this morning.
            "2007840",  # Let's skip class.
            "1392",     # My physics teacher doesn't care if I skip classes.
            "254651",   # I skipped the first few pages of the book.
            "293817",   # He skipped a grade.
            "249214",   # We skipped his turn on purpose.
            "3733890",  # I shouldn't have skipped the meeting.
            "268308",   # I skipped out on my appointment with my boss.
            "2158046",  # Skip the boring chapters.
            "4829395",  # I want to hear the whole story, and don't skip any details.
            "4495856",  # Avoid the temptation to skip lunch.
        ],

        # ===========================================================
        # === School / classroom / subjects ===
        # ===========================================================
        [
            "249042",   # We have been assigned the large classroom.
            "1111141",  # We used to play musical chairs in elementary school.
            "3553385",  # My favorite subjects in high school were geometry and history.
            "5836861",  # Prisons are overcrowded.
        ],

        # ===========================================================
        # === Reunion / homecoming ===
        # ===========================================================
        [
            "2548423",  # How was the reunion?
            {"text": "Surreal, in a good way.", "added_for": "surreal", "reason": "L17 nuanced answer"},
            "1037206",  # I went to the reunion.
            "2387082",  # I married my high school sweetheart.
        ],

        # ===========================================================
        # === Scholarship / applicants / university ===
        # ===========================================================
        [
            "30832",    # If I were you, I would apply for the scholarship.
            "58506",    # The scholarship enabled him to study abroad.
            "4529290",  # Aren't there any qualified applicants?
            "25677",    # Applicants must be under thirty years old.
            "953721",   # I wish I could afford to send my daughter to an Ivy League university.
            "5835660",  # Why did you decide on majoring in journalism?
            {"text": "I love to dig for the truth.", "added_for": "dig", "reason": "natural answer to majoring Q"},
        ],

        # ===========================================================
        # === Detention / bullying ===
        # ===========================================================
        [
            "5858335",  # I'm in detention.
            "5135006",  # Bullying is a learned behavior.
            "4502881",  # Bullying won't be tolerated.
            "68738",    # Go and beat up that bully.
            "546789",   # Every playground has its bully.
            "5170657",  # That boy's a big bully.
            "3732973",  # They bullied me.
            "5853095",  # I was bullied.
            "687351",   # I don't approve of the way he bullies others.
            "4662731",  # It would be nice if we could get some new playground equipment.
        ],

        # ===========================================================
        # === Torment / humiliate / shame ===
        # ===========================================================
        [
            "2026381",  # I don't want to torment you any longer.
            "2111433",  # That's humiliating.
            "2533447",  # You can't imagine how humiliating this is.
            "2248252",  # I'm so humiliated.
            "1427156",  # I was humiliated in public.
        ],

        # ===========================================================
        # === Intimidate / brace ===
        # ===========================================================
        [
            "4500339",  # It was intimidating.
            "1658092",  # It's a bit intimidating.
            "1951975",  # You can't intimidate us.
            "3360324",  # You can't intimidate me.
            "5101458",  # Don't be intimidated.
            "2248152",  # I'm not intimidated.
            "3024482",  # Brace yourself.
            "2249661",  # Now brace yourself.
        ],

        # ===========================================================
        # === Sneaky / dishonest / dubious ===
        # ===========================================================
        [
            "2203376",  # We're sneaky.
            "2111447",  # That's dishonest.
            "2187206",  # It's dishonest.
            "5423322",  # I'm still dubious.
        ],

        # ===========================================================
        # === Erase / hide / cover ===
        # ===========================================================
        [
            "1112564",  # You can't erase the past.
            "1341458",  # It's written in pencil, so you can erase it.
            "2325180",  # I erased my hard disk by accident.
            "2325181",  # I erased my name off the list.
            "305307",   # Their names were erased from the list.
            "4538055",  # I hid it under the mattress.
            "4497432",  # Do you really hide your money under the mattress?
            {"text": "Of course not — that's where everyone looks.", "added_for": "everyone", "reason": "L17 wry humor"},
        ],

        # ===========================================================
        # === Refuge / porch ===
        # ===========================================================
        [
            "325314",   # We took refuge from the storm in a nearby barn.
            "306175",   # They waited on the porch until it stopped raining.
            "4498202",  # We usually eat outside on the porch in the summer.
        ],

        # ===========================================================
        # === Tractor / farm / pasture ===
        # ===========================================================
        [
            "4144648",  # Can I drive the tractor?
            "4904711",  # Do you want to drive the tractor?
            {"text": "I've never driven one before.", "added_for": "driven", "reason": "natural reply"},
            "322038",   # There are a lot of sheep in the pasture.
            "262116",   # I saw a flock of sheep.
            "280288",   # Birds of a feather flock together.
            "19509",    # Cattle were grazing in the field.
        ],

        # ===========================================================
        # === Birds — pigeon / crow / parrot / owl ===
        # ===========================================================
        [
            "2782353",  # Have you ever seen a baby pigeon?
            "2592944",  # I enjoy feeding the pigeons.
            "298971",   # He used pigeons in his experiment.
            "49598",    # The crow flew away.
            "25582",    # The bird on the roof is a crow.
            "2549571",  # Crows are black.
            "5807178",  # Crows are smart.
            "2038372",  # When do owls sleep?
            "65171",    # A parrot can imitate human speech.
        ],

        # ===========================================================
        # === Hatred / hostility ===
        # ===========================================================
        [
            "326277",   # Love is blind. Hatred is also blind.
            "887401",   # She stared at him with hatred.
        ],

        # ===========================================================
        # === Shark / cage / fishing ===
        # ===========================================================
        [
            "4999951",  # It might be a shark.
            "896806",   # Is this cage shark-proof?
            "1841587",  # Sharks eat fish.
            "953080",   # According to the news, he was eaten by sharks.
            "5786690",  # Trout is my favorite fish.
            "2006483",  # Have you ever been trout fishing?
            "3738053",  # Are the trout biting?
            "3824660",  # Have you ever gone spear fishing?
            "3818854",  # They threw spears at us.
        ],

        # ===========================================================
        # === Squash / rugby / sports ===
        # ===========================================================
        [
            "2246039",  # I play squash.
            "2050659",  # We should play squash together sometime.
            "5839930",  # I play rugby.
            "2646244",  # We were playing rugby.
            "248230",   # We had a very vigorous debate.
        ],

        # ===========================================================
        # === Chess / tournament / referee ===
        # ===========================================================
        [
            "1316819",  # He won the first prize at the chess tournament.
            "4499633",  # I have won several tournaments.
            "4665497",  # The referee blew his whistle.
            "3131477",  # What happened in the third inning?
            {"text": "Three runs scored.", "added_for": "runs", "reason": "natural baseball answer"},
        ],

        # ===========================================================
        # === Skating / skater ===
        # ===========================================================
        [
            "258145",   # I sometimes skate.
            "59332",    # Can we roller-skate in this park?
            "52034",    # Don't forget your ice skates.
            "4635176",  # Do you own a pair of ice skates?
            "5682166",  # Mary is a figure skater.
            "908707",   # Who's your favorite figure skater?
        ],

        # ===========================================================
        # === Wrestling / wrestler ===
        # ===========================================================
        [
            "255554",   # I like pro wrestling.
            "908756",   # Who's your favorite wrestler?
            "2793705",  # Let's arm wrestle.
            "2793707",  # Do you want to arm wrestle?
            {"text": "You're on.", "added_for": "on", "reason": "playful challenge accept"},
        ],

        # ===========================================================
        # === Boxing / smack ===
        # ===========================================================
        [
            "4980181",  # I wanted to smack you.
        ],

        # ===========================================================
        # === Music — bass / trumpet / choir / tenor ===
        # ===========================================================
        [
            "3821466",  # Were you the bass player?
            "2389871",  # I play bass in a jazz band.
            "5290491",  # I play both the trumpet and the piano.
            "909574",   # The amount of time you spend practicing the trumpet is up to you.
            "5839934",  # I sing tenor.
            "248424",   # We joined in on the chorus.
            "3636310",  # How was choir practice?
            "4501512",  # We have choir practice every Monday.
            "4740663",  # To join the choir, you have to be able to read music.
            "906784",   # What's your favorite hymn?
            "2049675",  # A string quartet is rehearsing in the next room.
            "73375",    # After a ten-minute break, we resumed our rehearsal.
        ],

        # ===========================================================
        # === Acoustic / guitar / lyrics ===
        # ===========================================================
        [
            "2050694",  # When was the last time you played an acoustic guitar?
            "1954777",  # I can't remember the lyrics.
            "4494344",  # The lyrics are humorous.
            "1840575",  # Do you translate lyrics?
            "1125794",  # It's a catchy song.
            "5945202",  # This is a really catchy song.
            "5705362",  # What's your favorite Christmas carol?
            {"text": "Silent Night, no contest.", "added_for": "silent", "reason": "natural cultured answer"},
        ],

        # ===========================================================
        # === Banquet / formal ===
        # ===========================================================
        [
            "2064601",  # Show me something that I can wear to a banquet.
        ],

        # ===========================================================
        # === Engagement / marriage / maternity ===
        # ===========================================================
        [
            "54466",    # I congratulate you on your engagement.
            "263440",   # I congratulate you on passing the examination.
            "2406866",  # I suppose I should congratulate you.
            "4999143",  # What's your marital status?
            "909528",   # How much time do you spend with your spouse?
            "4502863",  # Spouses are also welcome.
            "2997372",  # Mary is on maternity leave.
            "1141240",  # Mary took maternity leave.
        ],

        # ===========================================================
        # === Maiden name / married / handbag ===
        # ===========================================================
        [
            "2540743",  # What's your mother's maiden name?
            "2541622",  # What's your wife's maiden name?
            "1096129",  # Mary went back to using her maiden name.
            "5004894",  # Are you the new nanny?
            "5422769",  # Mary lost her handbag.
            "1764599",  # This is her handbag.
        ],

        # ===========================================================
        # === Children / cradle / teddy ===
        # ===========================================================
        [
            "272359",   # A baby is sleeping in the cradle.
            "4284689",  # The little girl hugged her teddy bear.
            "3736040",  # Children imitate their parents.
            "1159842",  # Mary started plucking her eyebrows when she was twelve years old.
        ],

        # ===========================================================
        # === Acquaintance / introduction ===
        # ===========================================================
        [
            "2539186",  # I'm pleased to make your acquaintance.
            "64646",    # I'm very happy to make your acquaintance.
            "291796",   # He has a lot of acquaintances.
            "254571",   # I am acquainted with the author.
            "290496",   # He is acquainted with the custom.
            "255525",   # I got acquainted with her in France.
        ],

        # ===========================================================
        # === Implication / inference ===
        # ===========================================================
        [
            "4496583",  # The implications are clear.
            "5358580",  # Think about the implications.
            "4496586",  # The implication was clear.
            "2404153",  # I resent that implication.
            "3114166",  # I resent your implication.
            {"text": "It wasn't meant that way.", "added_for": "meant", "reason": "natural de-escalation"},
            "4501597",  # The question was rhetorical.
            "2293189",  # I assume that was a rhetorical question.
        ],

        # ===========================================================
        # === Disagreement / dispute / conflict ===
        # ===========================================================
        [
            "2646259",  # We had a disagreement.
            "4495543",  # It was a disagreement.
            "4529592",  # We never had any disagreements.
            "2203649",  # Who disagreed?
            "5828936",  # I disagreed.
            "4662881",  # Did I hear you correctly? Are you saying you disagree?
            {"text": "I think you misheard me.", "added_for": "misheard", "reason": "polite clarification"},
            "4498136",  # I doubt if sanctions will work.
            "4502968",  # Sanctions might work.
        ],

        # ===========================================================
        # === Dread / anxiety / frantic ===
        # ===========================================================
        [
            "280243",   # Why do you think animals dread fire?
            "1409030",  # He dreaded having to spend Christmas in the hospital.
            "2202883",  # We're frantic.
            "4502917",  # No wonder you're frantic.
            "2202960",  # We're horrified.
            "2203418",  # I'm stunned.
            "2203416",  # We're stunned.
        ],

        # ===========================================================
        # === Provoked / agitated / aroused ===
        # ===========================================================
        [
            "2184756",  # Don't provoke me.
            "5853065",  # I was provoked into saying that.
            "2218090",  # You're becoming agitated.
            "3732455",  # My curiosity was aroused.
        ],

        # ===========================================================
        # === Cautious / careful ===
        # ===========================================================
        [
            "5499500",  # We're being cautious.
            "5521409",  # We want to be extra cautious.
            "2243087",  # They continued cautiously.
            "2243111",  # They entered cautiously.
        ],

        # ===========================================================
        # === Compassion / soft ===
        # ===========================================================
        [
            "2644672",  # Where is your compassion?
            "5090710",  # Try to have some compassion.
            "57402",    # This cloth feels like velvet.
            "6029627",  # If you pick up the velvet, you can feel how soft it is.
            "1283941",  # I like the color violet.
            "1444709",  # If you mix blue and red, you get violet.
        ],

        # ===========================================================
        # === Doomed / immortal / eternal ===
        # ===========================================================
        [
            "3311122",  # We're doomed.
            "3823601",  # No one is immortal.
            "5496400",  # Do you believe in eternal life?
            {"text": "I'd like to think so.", "added_for": "think", "reason": "L17 hedged faith"},
        ],

        # ===========================================================
        # === Proverbs — ignorance, early bird, rose ===
        # ===========================================================
        [
            "276998",   # Ignorance is bliss.
            "2348",     # The early bird catches the worm.
            "1830613",  # I ate half the apple before I noticed there was a worm in it.
            "18556",    # He who pays the piper calls the tune.
            "393884",   # Better an egg today than a hen tomorrow.
            "38252",    # Every rose has its thorn.
            "2266974",  # I got a thorn in my finger.
            "279026",   # A rolling stone gathers no moss.
        ],

        # ===========================================================
        # === Hitch / wry ===
        # ===========================================================
        [
            "3724161",  # There's another hitch.
            "4495133",  # There was a hitch.
            {"text": "Of course there is.", "added_for": "course", "reason": "wry L17 reply"},
        ],

        # ===========================================================
        # === Idioms — ax to grind / racking brains ===
        # ===========================================================
        [
            "5640421",  # I don't have an ax to grind.
            "43719",    # He's racking his brains about how to deal with the matter.
            "681104",   # I grind my own coffee beans every morning.
        ],

        # ===========================================================
        # === Idioms — wild goose chase / cut slack ===
        # ===========================================================
        [
            "322812",   # It was a wild goose chase.
            "1887718",  # I think it's a wild goose chase.
            "1265414",  # Cut me some slack.
            {"text": "Fine, but just this once.", "added_for": "once", "reason": "natural reply"},
        ],

        # ===========================================================
        # === Make scarce / shove over ===
        # ===========================================================
        [
            "3722219",  # I'll make myself scarce.
            "2985625",  # Is food scarce around here?
            "2111556",  # Shove over.
            "2647100",  # Shove it in the slot.
        ],

        # ===========================================================
        # === Ponder / suffice / scarcely ===
        # ===========================================================
        [
            "4500604",  # Let's ponder that for a moment.
            "2250907",  # That should suffice.
            "264801",   # I scarcely believed my eyes.
            "33300",    # I scarcely slept a wink.
            "298857",   # He can scarcely write his name.
        ],

        # ===========================================================
        # === Theoretically / concede ===
        # ===========================================================
        [
            "4013674",  # It's theoretically possible.
            "4502933",  # Theoretically it should work.
            "4496810",  # Neither side will concede.
        ],

        # ===========================================================
        # === Validate / authorize ===
        # ===========================================================
        [
            "57876",    # Can you validate this parking ticket?
            "4498642",  # Who authorized the filming?
            "2241413",  # We need authorization.
            "2246001",  # I need authorization.
        ],

        # ===========================================================
        # === Obligation / mandatory / comply ===
        # ===========================================================
        [
            "2359011",  # I have another obligation.
            "3312890",  # We still have an obligation.
            "2301282",  # I can no longer fulfill my obligations.
            "5239211",  # You're not obligated to come.
            "5259718",  # I'm obligated to fix this.
            "3822882",  # It's mandatory.
            "2244992",  # Attendance is mandatory.
            "4495853",  # Attendance is free.
            "2255157",  # You must comply.
            "4502825",  # We want to comply.
        ],

        # ===========================================================
        # === Probation / parole / voting ===
        # ===========================================================
        [
            "2218320",  # You're on probation.
            "2240647",  # We're on probation.
            "297181",   # He was deprived of his civil rights.
            "4288128",  # You can vote by absentee ballot.
            "4496323",  # We cast our ballots.
            "4846718",  # The ballots are being counted.
            "5755249",  # The counting of the ballots took half an hour.
        ],

        # ===========================================================
        # === Reelection ===
        # ===========================================================
        [
            "2544103",  # I'm running for reelection.
        ],

        # ===========================================================
        # === Ironic / amused / amusement ===
        # ===========================================================
        [
            "2111424",  # That's ironic.
            "4665284",  # That would be somewhat ironic.
            "4529928",  # I guess I'm easily amused.
            "267237",   # The girls amused themselves playing games.
            "62617",    # We amused ourselves by playing games.
            "289438",   # He amused us with a funny story.
            "2256903",  # That's rather amusing.
            "2325880",  # I fail to see what's so amusing.
            "5386172",  # It made me chuckle.
            "4665495",  # This always makes me chuckle.
            "46742",    # Bruce chuckled to himself as he read the letter.
            "4013856",  # When was the last time you went to an amusement park?
        ],

        # ===========================================================
        # === Hum / quiet sounds ===
        # ===========================================================
        [
            "3823674",  # What's causing that hum?
            "5850299",  # I often hum while I work.
        ],

        # ===========================================================
        # === Profile picture / logo / font ===
        # ===========================================================
        [
            "3583288",  # Have you ever seen this logo before?
            "906955",   # What's your favorite font?
            "1744619",  # Why do you use this font?
            {"text": "It looks more professional.", "added_for": "professional", "reason": "natural reply"},
        ],

        # ===========================================================
        # === Overtime / work ===
        # ===========================================================
        [
            "5858885",  # I worked overtime.
            "301497",   # He stayed late and worked overtime.
            "304009",   # He was forced to work overtime.
            "3470021",  # Our boss made us work overtime yesterday.
            "1860481",  # Don't expect overtime.
        ],

        # ===========================================================
        # === Webcam / tech ===
        # ===========================================================
        [
            "5858593",  # I bought a webcam.
        ],

        # ===========================================================
        # === Materials / metal / oak ===
        # ===========================================================
        [
            "2465499",  # Aluminum is a metal.
            "60862",    # This table is made of good oak.
            "236776",   # This factory manufactures automobile parts.
            "243856",   # I was recently in an automobile accident.
        ],

        # ===========================================================
        # === Civilization / mankind / history ===
        # ===========================================================
        [
            "272259",   # Oil has played an important part in the progress of civilization.
            "270640",   # If mankind doesn't take care of the environment, the environment may eliminate mankind.
            "271167",   # Nobody can deny the fact the world economy revolves around the American economy.
            "324792",   # Prophets have been forecasting the end of the world for centuries.
        ],

        # ===========================================================
        # === Astronomy / galaxy / mountain ===
        # ===========================================================
        [
            "1444925",  # I love astronomy.
            "4806584",  # Astronomy is one of the oldest sciences.
            "27043",    # There are many galaxies in the universe.
            "326591",   # An eagle was soaring high up in the air.
            "65301",    # Mt. Everest is the highest mountain in the world.
            "261486",   # I've climbed Mt. Fuji twice.
            "4833255",  # The airplane ascended to four thousand feet.
        ],

        # ===========================================================
        # === Magnets / cylinders / cell biology ===
        # ===========================================================
        [
            "808047",   # How do magnets work?
            "4084633",  # How do you find the volume of a cylinder?
            "4523889",  # Mercury is the closest planet to the sun.
            "1209655",  # Bacteria are everywhere.
            "2065142",  # It's a single-cell organism.
            "327747",   # Sleep deprivation increases risk of heart attacks.
        ],

        # ===========================================================
        # === Shakespeare / Hamlet ===
        # ===========================================================
        [
            "35096",    # Who wrote Hamlet?
            {"text": "Shakespeare, of course.", "added_for": "shakespeare", "reason": "natural answer to literary Q"},
        ],

        # ===========================================================
        # === Manuscript / handwriting / rewrite ===
        # ===========================================================
        [
            "18469",    # Can you manage to complete the manuscript by Friday?
            "302502",   # He showed me the manuscript of his new play.
            "1293292",  # He quickly scanned my manuscript.
            "887458",   # She told him to rewrite his resume.
            "1060459",  # His work is repetitive.
        ],

        # ===========================================================
        # === Crime novel / retailers ===
        # ===========================================================
        [
            "968126",   # I'm halfway through this crime novel.
            "5679138",  # Christmas is a busy time for retailers.
        ],

        # ===========================================================
        # === Halfway / stroll / moonlight ===
        # ===========================================================
        [
            "2240769",  # We're halfway home.
            "17293",    # Let's meet halfway between your house and mine.
            "5078432",  # Can't we just stroll around the park?
            "2243296",  # They resumed walking.
            "5395078",  # We swam in the moonlight.
            "4496680",  # Moonlight came through the windows.
            "238785",   # The moonlight reflected on the lake.
        ],

        # ===========================================================
        # === Hop in / ride ===
        # ===========================================================
        [
            "1111548",  # Hop in.
            "3152550",  # Hop in. I'll give you a ride.
            {"text": "Thanks — I'd appreciate that.", "added_for": "appreciate", "reason": "natural reply"},
        ],

        # ===========================================================
        # === Saddle / horses / canoe / ship ===
        # ===========================================================
        [
            "2985731",  # Can you ride without a saddle?
            "2985587",  # Let's saddle our horses and go riding.
            "262721",   # We rented a canoe.
            "5790086",  # This canoe is not safe.
            "6555120",  # We cut down the largest tree we could find so we could make a canoe.
            "273415",   # The ship dropped anchor.
            "2258975",  # It's a cargo ship.
        ],

        # ===========================================================
        # === Pier / doorstep / footing ===
        # ===========================================================
        [
            "887346",   # She pushed him off the pier.
            "2644998",  # This was on the doorstep.
            "2923870",  # It's easy to lose your footing on loose gravel.
        ],

        # ===========================================================
        # === Bicycle (kept minimal) ===
        # ===========================================================
        [
            "25972",    # A lot of bicycles are illegally parked in front of the station.
        ],

        # ===========================================================
        # === Lever / pulley / fuse / rigged ===
        # ===========================================================
        [
            "5851885",  # I pulled the lever.
            "29503",    # Press down on the lever.
            "34636",    # A fuse has blown.
            "5851845",  # I lit the fuse.
            "1669552",  # The game is rigged.
            "5499309",  # The system is rigged.
        ],

        # ===========================================================
        # === Chimney / fireplace / smoke ===
        # ===========================================================
        [
            "68561",    # That chimney is very high.
            "1419612",  # Smoke poured out of the chimney.
            "3223024",  # Let's sit by the fireplace.
            "295417",   # He vowed to give up smoking.
        ],

        # ===========================================================
        # === Insulation / plumbing ===
        # ===========================================================
        [
            "4496204",  # The insulation shouldn't burn.
            "5933734",  # My house has no insulation.
            "5933731",  # My house isn't insulated.
            "3821456",  # Call a plumber.
            "5852789",  # I'm a plumber.
        ],

        # ===========================================================
        # === Gauge / meter ===
        # ===========================================================
        [
            "3722354",  # I checked the gauge.
            "4349620",  # The rain gauge is broken.
            "3171845",  # The gas gauge is on empty.
        ],

        # ===========================================================
        # === Duct tape ===
        # ===========================================================
        [
            "4498717",  # Duct tape fixes everything.
        ],

        # ===========================================================
        # === Tiles / carpet / rug ===
        # ===========================================================
        [
            "1992902",  # The tiles that fell from the roof broke into pieces.
            "2953338",  # The carpet clashes with the drapes.
            "3508212",  # I hate this rug.
            "2985333",  # We rolled up the rug.
        ],

        # ===========================================================
        # === Vase / fragile ===
        # ===========================================================
        [
            "4600662",  # This vase is very fragile.
            "4015824",  # These are very fragile.
        ],

        # ===========================================================
        # === Coupon / inventory / wholesale / warehouse ===
        # ===========================================================
        [
            "2359567",  # I've got a coupon.
            "2662927",  # That's the problem with buying wholesale.
            "2248268",  # I'm taking inventory.
            "2359103",  # I've been going over the inventory.
            "5706682",  # We have probably about three hundred of those in our warehouse.
            "4498326",  # The men entered the warehouse with their weapons ready.
        ],

        # ===========================================================
        # === Sticker / price / transaction ===
        # ===========================================================
        [
            "3147959",  # Nobody I know ever paid sticker price for a car.
            "2544620",  # They lowered their prices.
            "1293303",  # I lowered my meat consumption.
            "4496792",  # It's a complicated transaction.
        ],

        # ===========================================================
        # === Bankruptcy / disappointment ===
        # ===========================================================
        [
            "4397507",  # We're bankrupt.
            "274871",   # Many small companies went bankrupt.
            "4879991",  # The loss was a disappointment.
            "4663368",  # That concert was a complete disappointment.
            "34808",    # The picnic was a disappointment.
            "5678433",  # I'm not disappointed whatsoever.
            "5134407",  # That made no sense whatsoever.
            "953478",   # I have no interest whatsoever in eating English food.
        ],

        # ===========================================================
        # === Pending / staggering ===
        # ===========================================================
        [
            "4495713",  # Funeral arrangements are pending.
            "4501427",  # Plans are still pending.
            "4498634",  # The figures are staggering.
            "4494012",  # The difference is staggering.
            "4501368",  # We're striving for perfection.
            "4501370",  # We strive for perfection.
            "3461470",  # We all strive for success.
        ],

        # ===========================================================
        # === Momentum / drastic change ===
        # ===========================================================
        [
            "4499029",  # The momentum was gone.
            "5573403",  # We've made a drastic improvement.
            "5620161",  # We've seen drastic changes since then.
        ],

        # ===========================================================
        # === Tax / deductible / business ===
        # ===========================================================
        [
            "4494087",  # Tickets are tax deductible.
            "5136942",  # All donations are tax deductible.
            "5192470",  # Business expenses are tax-deductible.
        ],

        # ===========================================================
        # === Escort / civility ===
        # ===========================================================
        [
            "2247716",  # I'll escort you.
            "64234",    # May I escort you home?
            {"text": "That's very kind.", "added_for": "kind", "reason": "natural reply"},
        ],

        # ===========================================================
        # === Unbelievably / exceptional ===
        # ===========================================================
        [
            "2795062",  # She's unbelievably naive.
            "1178681",  # Mary is exceptionally attractive.
        ],

        # ===========================================================
        # === Startled / sorry / vibrating ===
        # ===========================================================
        [
            "2245424",  # Everybody was startled.
            "3329903",  # I'm sorry I startled you.
            "1370511",  # We were startled by the explosion.
            "1690156",  # My phone is vibrating.
        ],

        # ===========================================================
        # === Intruder / poking nose ===
        # ===========================================================
        [
            "3823520",  # Did you get a good look at the intruder?
            "252804",   # I don't mean to poke my nose into your affairs.
            "3678688",  # Stop poking me.
        ],

        # ===========================================================
        # === Despise / grudge / menace ===
        # ===========================================================
        [
            "2245678",  # I despise you.
            "5933727",  # I despise my neighbors.
            "295653",   # He has a grudge against you.
            "2218031",  # You're a menace.
        ],

        # ===========================================================
        # === Argument / invalid / irrational ===
        # ===========================================================
        [
            "3823519",  # Your argument is invalid.
            "2548700",  # I'm not an invalid.
            "4494587",  # There is no ambiguity.
            "1654195",  # It's completely irrational.
            "2218103",  # You're being irrational.
        ],

        # ===========================================================
        # === Catastrophe / ordeal / flop ===
        # ===========================================================
        [
            "2547047",  # This is a catastrophe.
            "3821731",  # It'll be a long ordeal.
            "1534405",  # The party was a flop.
        ],

        # ===========================================================
        # === Reluctance / overly ===
        # ===========================================================
        [
            "2301408",  # I can understand your reluctance.
            "2547347",  # I wasn't overly tired.
            "4666460",  # I'm not overly concerned.
        ],

        # ===========================================================
        # === Excessive / utterly / intuition ===
        # ===========================================================
        [
            "2248681",  # Isn't that excessive?
            "5004808",  # This seems excessive.
            "4494093",  # This is utterly ridiculous.
            "5143984",  # Everything happened simultaneously.
            "1611127",  # It's simple and intuitive.
            "3342438",  # Trust your intuition.
            "5203251",  # You should trust your intuition.
            "5756480",  # We put too much faith in our intuition.
        ],

        # ===========================================================
        # === Trivial / exceptions ===
        # ===========================================================
        [
            "367413",   # The proof is trivial.
            "4500993",  # This is a trivial matter.
            "4493963",  # There are exceptions, however.
            "1230859",  # This rule has no exceptions.
            "1327471",  # There are no rules without exceptions.
            "326039",   # I insist that exceptions not be made.
        ],

        # ===========================================================
        # === Substitute / alternate ===
        # ===========================================================
        [
            "3723528",  # There's no substitute.
            "4013186",  # Perhaps we could find a substitute.
            "3127929",  # May I suggest an alternate plan?
            {"text": "Please, go ahead.", "added_for": "ahead", "reason": "polite invite"},
        ],

        # ===========================================================
        # === Premature ===
        # ===========================================================
        [
            "4494029",  # Twins are usually premature.
            "2546794",  # I was born prematurely.
        ],

        # ===========================================================
        # === Stocking / reinforcements ===
        # ===========================================================
        [
            "5132193",  # We're stocking up on everything.
            "17262",    # There is a big hole in your stocking.
            "2245626",  # I brought reinforcements.
        ],

        # ===========================================================
        # === Garment / accessories / bumps ===
        # ===========================================================
        [
            "250279",   # I can't find my garment bag.
        ],
        [
            "2396095",  # I got my ears pierced.
        ],
        [
            "3825995",  # I've got goose bumps.
        ],

        # ===========================================================
        # === Skinny-dipping / dare ===
        # ===========================================================
        [
            "5178448",  # Let's go skinny-dipping.
            "4497840",  # Did you go skinny-dipping?
            {"text": "Once, in college.", "added_for": "college", "reason": "candid casual reply"},
        ],

        # ===========================================================
        # === Cat / curled / soft animals ===
        # ===========================================================
        [
            "282003",   # The cat was curled up asleep.
        ],

        # ===========================================================
        # === Helicopter / pilot / hovering ===
        # ===========================================================
        [
            "4496977",  # We could see the helicopter hovering above the pond.
            "4405274",  # The pilot bailed out before the plane crashed.
            "2539306",  # You're a certified pilot, aren't you?
        ],

        # ===========================================================
        # === Hail / cab ===
        # ===========================================================
        [
            "326657",   # Have you ever seen it hail?
            "5313708",  # There's no need to hail a taxi.
            "5852152",  # I hailed a cab.
        ],

        # ===========================================================
        # === Parking attendant / flip ===
        # ===========================================================
        [
            "5831755",  # How long have you been working as a parking attendant?
            "3312179",  # We'll flip for it.
            "2245499",  # Flip a coin.
            "5859668",  # I flipped the coin.
            "3825867",  # Please shuffle the cards.
            "36910",    # Please shuffle the cards carefully.
        ],

        # ===========================================================
        # === Mansion / villa ===
        # ===========================================================
        [
            "57210",    # Who owns this villa?
            "311599",   # She lives in quite a big mansion.
            "30784",    # If my house were a mansion, I would invite everyone I know to my birthday party.
        ],

        # ===========================================================
        # === Celebrity / glamorous ===
        # ===========================================================
        [
            "2546244",  # You're a celebrity now.
            "2707427",  # I'm not a celebrity.
            "310767",   # She's a glamorous girl.
        ],

        # ===========================================================
        # === Credibility ===
        # ===========================================================
        [
            "3825525",  # You've lost your credibility.
            "3825526",  # They've lost all credibility.
        ],

        # ===========================================================
        # === Souvenir / overseas ===
        # ===========================================================
        [
            "4929659",  # Did you get a souvenir for your girlfriend?
            "67611",    # I'm looking forward to touring bookstores in the US.
            "941301",   # On Friday evenings, a group of us with spouses working overseas meet at Chuck's Bar and Grill.
        ],

        # ===========================================================
        # === Punk rock ===
        # ===========================================================
        [
            "6026742",  # When I was younger, I used to listen to a lot of punk rock.
        ],

        # ===========================================================
        # === Hazelnuts / harvest ===
        # ===========================================================
        [
            "4376362",  # Hazelnuts are harvested in mid-autumn.
        ],

        # ===========================================================
        # === Democratic society ===
        # ===========================================================
        [
            "249398",   # We live in a democratic society.
        ],

        # ===========================================================
        # === Explorers / navigation ===
        # ===========================================================
        [
            "272150",   # Early explorers used the stars for navigation.
        ],

        # ===========================================================
        # === Stereotype / imitation ===
        # ===========================================================
        [
            "3518523",  # It's an old stereotype.
            "3518516",  # It's a family trait.
            "4374357",  # That's imitation leather.
            "291293",   # He compared the imitation with the original.
        ],

        # ===========================================================
        # === Civilized / civility ===
        # ===========================================================
        [
            "31561",    # You could try and be a bit more civilized.
        ],

        # ===========================================================
        # === Initials / signature ===
        # ===========================================================
        [
            "2270117",  # What are your initials?
            "1428412",  # The couple carved their initials into the oak tree.
        ],

        # ===========================================================
        # === Vivid / imagination ===
        # ===========================================================
        [
            "4496654",  # The colors are vivid.
            "3390624",  # You've got a vivid imagination.
        ],

        # ===========================================================
        # === Ample / inferior ===
        # ===========================================================
        [
            "248899",   # We have ample food.
            "326164",   # We have ample time to catch our train.
            "69892",    # There is no reason for you to feel inferior to anyone.
        ],

        # ===========================================================
        # === Favorable ===
        # ===========================================================
        [
            "327513",   # Almost all of the reviews of the play were favorable.
        ],

        # ===========================================================
        # === Conspicuous ===
        # ===========================================================
        [
            "2249317",  # It's too conspicuous.
        ],

        # ===========================================================
        # === Uneven floor ===
        # ===========================================================
        [
            "4494876",  # The floor is uneven.
        ],

        # ===========================================================
        # === Aspirations / life goals ===
        # ===========================================================
        [
            "4494140",  # What are your aspirations?
            {"text": "To live a meaningful life.", "added_for": "meaningful", "reason": "L17 introspective answer"},
        ],

        # ===========================================================
        # === Consolation prize ===
        # ===========================================================
        [
            "678246",   # I didn't win, but at least I got a consolation prize.
        ],

        # ===========================================================
        # === Daunting task ===
        # ===========================================================
        [
            "4494593",  # The task was daunting.
            "4502965",  # The work is daunting.
        ],

        # ===========================================================
        # === Peer pressure ===
        # ===========================================================
        [
            "545682",   # Don't give in to peer pressure.
        ],

        # ===========================================================
        # === Salvation Army ===
        # ===========================================================
        [
            "2329340",  # I gave some of my old clothes to the Salvation Army.
        ],

        # ===========================================================
        # === Patriotic ===
        # ===========================================================
        [
            "4497592",  # That was the patriotic thing to do.
        ],

        # ===========================================================
        # === Traumatic experience ===
        # ===========================================================
        [
            "5252365",  # It was a traumatic experience.
        ],

        # ===========================================================
        # === Sensational ===
        # ===========================================================
        [
            "2248934",  # It wasn't sensational.
            "2255280",  # You were sensational.
        ],

        # ===========================================================
        # === Exert ===
        # ===========================================================
        [
            "322835",   # Don't exert yourself.
        ],

        # ===========================================================
        # === Bedside manner ===
        # ===========================================================
        [
            "953253",   # Dr. Jackson has a good bedside manner.
        ],

        # ===========================================================
        # === Bleach / cleaning ===
        # ===========================================================
        [
            "4016927",  # It smells like bleach.
        ],

        # ===========================================================
        # === Newcomer ===
        # ===========================================================
        [
            "5851266",  # I'm a newcomer.
        ],

        # ===========================================================
        # === Vent / feelings ===
        # ===========================================================
        [
            "2133953",  # I need to vent my anger.
        ],

        # ===========================================================
        # === Distractions ===
        # ===========================================================
        [
            "2012420",  # I don't want distractions.
            "4494167",  # There are no distractions.
        ],

        # ===========================================================
        # === Obsession ===
        # ===========================================================
        [
            "4846647",  # I don't understand this obsession of yours.
        ],

        # ===========================================================
        # === Self-esteem ===
        # ===========================================================
        [
            "4679880",  # The lower your self-esteem, the more you tend to focus on negative things.
        ],

        # ===========================================================
        # === Feasibility / plan ===
        # ===========================================================
        [
            "4501435",  # Is this plan feasible?
            {"text": "Theoretically, yes.", "added_for": "theoretically", "reason": "L17 hedged Y"},
        ],

        # ===========================================================
        # === Unsure / patient pause ===
        # ===========================================================
        [
            "5828927",  # I'm unsure.
            {"text": "Take your time.", "added_for": "time", "reason": "patient reply"},
        ],

        # ===========================================================
        # === Chunk of time ===
        # ===========================================================
        [
            "909558",   # She spends a pretty good chunk of time just sitting there and looking out the window.
        ],

        # ===========================================================
        # === Insanely complex ===
        # ===========================================================
        [
            "1848899",  # It's insanely complex.
        ],
    ],
}
