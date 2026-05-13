"""Curation plan for OGTE Level 14 — Early Advanced (~1091 sentences).

At L14, learners handle abstract reasoning, nuanced opinions, polite
confrontation, formal/informal register switches, indirect speech,
hypotheticals & subjunctives, professional vocabulary (lawyer,
investigation, evaluation, policy, conviction, premise) and mild
humor / irony.

The single biggest drill in the input is "tired" (40+ "I'm tired of …"
sentences clustered by rarest_word). The plan defuses this by trimming
to a small number of strong examples and inserting vocabulary-varied
rewrites (exhausted, weary, burned out, fed up) so no content word ever
appears in more than 3 consecutive rows.

Curation philosophy (consistent with L10-L13):
  - Long sentences fine — they teach complex structures.
  - Common idioms valuable (last straw, count your blessings,
    cart before the horse, slept like a log) — keep.
  - Mild crime / police / theft / convict / confession references
    are fine; only gore-heavy is dropped.
  - Body parts, narratives, mild political content are fine.
  - Proper names in moderation are fine; only US-civics-quiz pile-ups
    and dated brands removed.
"""

from __future__ import annotations


L14_PLAN = {
    "removals": [
        # === Brands / dated tech / niche US-political quiz items ===
        {"id": "2454385", "reason": "'I deleted my Facebook account.' — dated brand."},
        {"id": "953732", "reason": "'I wish I could figure out how to get Flash to work on my iPad.' — dated brand combo (Flash + iPad)."},
        {"id": "73307", "reason": "'In 1860, Lincoln was elected President of the United States.' — duplicate of 1356015 (Lincoln civics quiz)."},
        {"id": "1167427", "reason": "'Today is election day in Poland.' — niche country-specific."},
        {"id": "4101242", "reason": "'I've been to Boston countless times.' — Boston pile-up + dated frame."},
        {"id": "2006553", "reason": "'There's a fishing lodge near Boston that I often go to.' — Boston pile-up."},
        {"id": "37449", "reason": "'Thomas Edison invented the light bulb.' — trivia-quiz."},

        # === Overtly sexist / gendered framings ===
        {"id": "5834709", "reason": "'How do you balance being a mother, a wife and a lawyer?' — gendered question."},
        {"id": "1334627", "reason": "'You punch like a girl.' — sexist insult."},
        {"id": "887097", "reason": "'She dumped him for a richer man.' — gold-digger trope."},
        {"id": "887098", "reason": "'She dumped him for a younger man.' — near-duplicate gendered trope."},

        # === Religion / proverb that doesn't generalize well ===
        {"id": "992006", "reason": "'Poverty is the root of all evil.' — preachy proverb (misquote)."},
        {"id": "272452", "reason": "'When poverty comes in at the door, love flies out the window.' — opaque proverb."},
        {"id": "3725616", "reason": "'You're guilty as sin.' — accusatory + religious idiom."},
        {"id": "3281684", "reason": "'It would be a sin to waste it.' — preachy."},
        {"id": "270116", "reason": "'No man can serve two masters.' — biblical proverb."},
        {"id": "5100337", "reason": "'Dogs have masters, cats have servants.' — opaque-cute trope."},
        {"id": "2060450", "reason": "'A man who is his own lawyer has a fool for a client.' — proverb."},
        {"id": "410321", "reason": "'A living dog is better than a dead lion.' — proverb."},
        {"id": "354108", "reason": "'A drowning man will catch at a straw.' — opaque proverb."},
        {"id": "266796", "reason": "'The nail that sticks up gets hammered down.' — opaque proverb."},
        {"id": "19729", "reason": "'Haste makes waste.' — terse proverb."},
        {"id": "3387162", "reason": "'Time cures all things.' — near-duplicate of 3824884 / 263894."},

        # === Drama / awkward register isolation ===
        {"id": "847127", "reason": "'Lawyers are all liars.' — generalization + 'liars' awkward in isolation."},
        {"id": "3725408", "reason": "'You're the historian.' — odd accusatory."},
        {"id": "67560", "reason": "'Many criminals in America are addicted to drugs.' — country-specific + heavy."},

        # === Exact / near-duplicates ===
        {"id": "5136941", "reason": "'An investigation has been launched.' — near-duplicate of 4500348."},
        {"id": "5680851", "reason": "'I'm so tired of keeping secrets.' — duplicate of 5656507."},
        {"id": "2952886", "reason": "'I'm tired of all your complaining.' — duplicate of 2539444."},
        {"id": "1553438", "reason": "'I'm getting tired of your complaints.' — duplicate of 16921."},
        {"id": "2063340", "reason": "'I could've sworn I saw something.' — near-duplicate of 2063338."},
        {"id": "619792", "reason": "'I could have sworn something moved.' — near-duplicate of 2063338."},
        {"id": "1449860", "reason": "'I was very tired, so I fell asleep right away.' — near-duplicate of 255255."},
        {"id": "63952", "reason": "'Mom is fixing supper now.' — supper-drill duplicate of 1439844."},
        {"id": "298580", "reason": "'He prepared supper by himself.' — supper-drill duplicate."},
        {"id": "324597", "reason": "'After he finished supper, he began to read the novel.' — supper-drill duplicate."},
        {"id": "5119438", "reason": "'After eating supper, I washed the dishes.' — supper-drill duplicate."},
        {"id": "324642", "reason": "'I watched the news on TV after supper.' — supper-drill duplicate."},
        {"id": "324659", "reason": "'The telephone rang while I was having supper.' — supper-drill duplicate."},
        {"id": "16740", "reason": "'You should apologize to Dad for not coming home in time for supper.' — supper-drill overflow."},
        {"id": "319384", "reason": "'My father takes a bath before supper.' — odd supper-drill overflow."},
        {"id": "3195697", "reason": "'Try not to be late for supper.' — supper-drill overflow."},
        {"id": "599162", "reason": "'My friends invited me to supper.' — supper-drill overflow."},
        {"id": "259223", "reason": "'I got my son to cook supper.' — supper-drill overflow."},
        {"id": "249451", "reason": "'We were seated at the supper table.' — supper-drill overflow."},
        {"id": "251863", "reason": "'My mother is busy cooking supper.' — supper-drill overflow."},
        {"id": "26836", "reason": "'No sooner had it stopped raining than a beautiful rainbow appeared.' — near-duplicate of 388845."},
        {"id": "278900", "reason": "'The weather forecast says it will be fine tomorrow.' — duplicate-overflow of forecast cluster."},
        {"id": "1442", "reason": "'I shouldn't have logged off.' — odd in isolation, overlaps with 4500722."},
        {"id": "453355", "reason": "'I play violin.' — duplicate of 362737."},
        {"id": "73078", "reason": "Long 'Please be sure to take one dose three times a day.' — clunky."},
        {"id": "2245228", "reason": "'Continue your analysis.' — near-duplicate of 2245229 (investigations)."},
        {"id": "5851719", "reason": "'I sat on a log.' — odd in isolation."},

        # === Tired-drill overflow (KEEP ~10 best, REMOVE the rest) ===
        # The original CSV has 40+ "I'm tired of …" sentences. Trim hard and
        # supplement with rewrites that introduce 'exhausted/weary/fed up/
        # burned out' so the drill is broken across the level.
        {"id": "2548196", "reason": "'I'm tired of losing.' — tired-drill overflow."},
        {"id": "5171696", "reason": "'I'm tired of fighting.' — tired-drill overflow."},
        {"id": "255127", "reason": "'I'm tired of watching television.' — tired-drill overflow."},
        {"id": "3824462", "reason": "'I'm tired of this game.' — tired-drill overflow."},
        {"id": "4080955", "reason": "'I'm tired of your comments.' — tired-drill overflow."},
        {"id": "5220165", "reason": "'I'm tired of you guys.' — tired-drill overflow."},
        {"id": "5171697", "reason": "'I'm tired of all these lies.' — tired-drill overflow."},
        {"id": "2952887", "reason": "'I'm tired of watching TV. Let's do something else.' — tired-drill + TV duplicate."},
        {"id": "5806911", "reason": "'I'm usually too tired to do anything after work.' — tired-drill overflow."},
        {"id": "5614659", "reason": "'I'm tired of feeling like I don't belong.' — tired-drill overflow."},
        {"id": "531645", "reason": "'I'm tired of dancing.' — tired-drill overflow."},
        {"id": "5171695", "reason": "'I'm tired of swimming.' — tired-drill overflow."},
        {"id": "2542411", "reason": "'I'm just tired of standing up.' — tired-drill overflow."},
        {"id": "2542307", "reason": "'I'm tired of dealing with you.' — tired-drill overflow."},
        {"id": "2542308", "reason": "'I'm tired of covering for you.' — tired-drill overflow."},
        {"id": "5699743", "reason": "'I got tired of looking at that painting.' — tired-drill overflow."},
        {"id": "2545883", "reason": "'I'm tired of pretending.' — tired-drill overflow."},
        {"id": "2544057", "reason": "'I'm tired of listening to you.' — tired-drill overflow."},
        {"id": "5255765", "reason": "'I'm tired of always listening to the same kind of music.' — tired-drill overflow."},
        {"id": "5705383", "reason": "'I'm getting tired of hearing Christmas music everywhere I go.' — tired-drill overflow."},
        {"id": "2546493", "reason": "'I'm too tired to argue.' — tired-drill overflow."},
        {"id": "4216023", "reason": "'I'm tired of arguing.' — tired-drill overflow."},
        {"id": "3446930", "reason": "'I'm tired of answering questions.' — tired-drill overflow."},
        {"id": "2538680", "reason": "'I'm tired of being treated like a child.' — tired-drill overflow."},
        {"id": "3732570", "reason": "'I'm sick and tired of being called a kid.' — tired-drill overflow."},
        {"id": "2047645", "reason": "'I'm tired of being careful.' — tired-drill overflow."},
        {"id": "2539699", "reason": "'I'm tired of dealing with this mess.' — tired-drill overflow."},
        {"id": "2533427", "reason": "'You can't imagine how tired I am.' — tired-drill overflow."},
        {"id": "2375791", "reason": "'I knew you'd be tired.' — tired-drill overflow."},
        {"id": "291793", "reason": "'He got tired and turned back.' — tired-drill overflow."},
        {"id": "4500745", "reason": "'Only one of the boys looked tired.' — tired-drill overflow."},
        {"id": "281131", "reason": "'The sun was hot and they were tired.' — tired-drill overflow."},
        {"id": "388556", "reason": "'She kept working even though she was tired.' — tired-drill overflow."},
        {"id": "256077", "reason": "'I worked hard all day, so I was very tired.' — tired-drill overflow."},
        {"id": "9721", "reason": "'You look tired. You ought to rest for an hour or two.' — tired-drill overflow."},
        {"id": "6524608", "reason": "'I ought to study tonight, but I'm tired so I'm going to bed.' — tired-drill overflow."},
        {"id": "2308122", "reason": "Long 'I could have stayed a while longer…tired, so I decided to leave.' — clunky + tired-drill."},
        {"id": "3205107", "reason": "'I bet you're going to tell me you're too tired to help.' — tired-drill overflow."},
        {"id": "1860586", "reason": "'Take a seat. You look tired.' — tired-drill overflow."},
        {"id": "1901681", "reason": "'I'm tired of waiting in line.' — tired-drill overflow."},
        {"id": "2129", "reason": "'I'm tired of eating fast food.' — tired-drill overflow."},
        {"id": "268933", "reason": "'I'm tired from lack of sleep.' — tired-drill overflow."},
        {"id": "37761", "reason": "'I'm so tired that I don't feel like studying tonight.' — tired-drill overflow."},
        {"id": "5438395", "reason": "'I'm not the least bit tired.' — tired-drill overflow."},
        {"id": "317817", "reason": "'I'm tired, but I'm going anyway.' — tired-drill overflow."},
        {"id": "1091970", "reason": "'I'm too tired to concentrate on this problem right now.' — tired-drill overflow."},
        {"id": "317811", "reason": "'I'm too tired to walk any further.' — tired-drill overflow."},
        {"id": "5681869", "reason": "'I'm surprised at how tired I am.' — tired-drill overflow."},
        {"id": "21278", "reason": "Long '…we got a little tired.' — tired-drill overflow."},
        {"id": "1526431", "reason": "'I'm too tired to run.' — tired-drill overflow."},
        {"id": "2951994", "reason": "'I didn't realize you were tired.' — tired-drill overflow."},
        {"id": "289622", "reason": "Long 'Tired from the hard work, he went to bed earlier than usual.' — tired-drill overflow."},
        {"id": "1120772", "reason": "'I'm incredibly tired.' — tired-drill overflow (keep 'I'm awfully tired')."},
        {"id": "2248266", "reason": "'I'm suddenly tired.' — tired-drill overflow."},
        {"id": "4919000", "reason": "'Everyone's going to be tired.' — tired-drill overflow."},
        {"id": "1446156", "reason": "'We're tired and thirsty.' — tired-drill overflow."},

        # === Tatoeba near-duplicate plurals / minor wording ===
        {"id": "2585127", "reason": "'These pants are dirty.' — duplicate of 1895541."},
        {"id": "2643382", "reason": "'I think we should wear masks.' — masks-drill overflow."},
        {"id": "1039425", "reason": "'Two men wearing ski masks entered the bank.' — duplicate framing of 681958."},
        {"id": "2640918", "reason": "'All the bank robbers were wearing masks.' — duplicate of 2539684."},
        {"id": "274733", "reason": "'You shouldn't interfere in other people's business.' — near-duplicate of 269923."},
        {"id": "2253789", "reason": "'Trust your instincts.' — duplicate of 2245501."},
        {"id": "2243525", "reason": "'They won't intervene.' — near-duplicate of 2241174."},
        {"id": "4663800", "reason": "'Your French has improved considerably.' — duplicate of 1580295 (English vs French)."},
        {"id": "260237", "reason": "'I competed with him for the championship.' — duplicate of championship-cluster."},
        {"id": "5811837", "reason": "'More than 45 million Americans live in poverty.' — country-specific statistic."},

        # === Misc tightening: vague abstract isolations ===
        {"id": "2123587", "reason": "'It's pointless.' — context-less."},
        {"id": "325163", "reason": "'Lightning normally accompanies thunder.' — factoid."},
        {"id": "3826381", "reason": "'I'm sweeping the balcony.' — odd isolated action."},
        {"id": "3568790", "reason": "'These logs are heavy.' — odd in isolation."},
        {"id": "4877611", "reason": "'Can they send me a brochure?' — duplicate of 3160467 framing."},
        {"id": "5851280", "reason": "'I'm a mechanic.' — odd context-less identity."},
        {"id": "4495667", "reason": "'These two problems appear unrelated.' — near-duplicate of 2123549."},
        {"id": "2202588", "reason": "'I'm athletic.' — paired duplicate of 2202586."},

        # === Cigarette / smoking overflow (keep best, drop heaviest) ===
        {"id": "40683", "reason": "Long 'Every time cigarettes go up in price…' — preachy + cigarette overflow."},
        {"id": "3636204", "reason": "'Cigarette smoke bothers me a lot.' — cigarette-drill overflow."},
        {"id": "4512744", "reason": "'Cigarette butts are the biggest source of litter in the world.' — preachy."},
        {"id": "3078322", "reason": "'The room was filled with cigarette smoke.' — cigarette-drill overflow."},

        # === Drawer over-saturation (keep ~5 best of ~11) ===
        {"id": "5858413", "reason": "'I shut the drawer.' — drawer-drill overflow."},
        {"id": "3426310", "reason": "'The drawer is empty.' — drawer-drill overflow."},
        {"id": "27151", "reason": "'I forgot to lock the drawer.' — drawer-drill overflow."},
        {"id": "239406", "reason": "'I searched the drawer for the key.' — drawer-drill overflow."},
        {"id": "3168073", "reason": "'Which one is your sock drawer?' — drawer-drill overflow."},
        {"id": "4538053", "reason": "'I hid it in my sock drawer.' — drawer-drill overflow."},
        {"id": "2374690", "reason": "'I kept it locked in my top desk drawer.' — drawer-drill overflow."},

        # === Ghosts factoid overflow (keep main arc) ===
        {"id": "324442", "reason": "'Ghosts exist.' — opening assertion redundant with arc."},
        {"id": "2248244", "reason": "'I'm seeing ghosts.' — ghost-drill overflow."},
        {"id": "2796355", "reason": "'Do ghosts have shadows?' — ghost-drill overflow."},

        # === Toast over-saturation (keep ~4 best of ~9) ===
        {"id": "1961841", "reason": "'I thought you'd want butter on your toast.' — toast-drill overflow."},
        {"id": "2028645", "reason": "'I'd like some toast if you are making some.' — toast-drill overflow."},
        {"id": "259474", "reason": "Long 'I like to spread honey on my toast in the morning.' — toast-drill overflow."},
        {"id": "3154848", "reason": "Long 'I ate three eggs and two pieces of toast for breakfast.' — toast-drill overflow."},
        {"id": "2033967", "reason": "Long 'All I want is a cup of coffee and a piece of toast.' — toast-drill overflow."},

        # === Politics / election micro-tightening (keep core arc) ===
        {"id": "248002", "reason": "'We often talked about Japanese politics.' — country-specific politics."},

        # === Fog factoid overflow (keep ~3) ===
        {"id": "56786", "reason": "'I can't see the road signs in this fog.' — fog-drill overflow."},
        {"id": "282263", "reason": "'It is dangerous to fly in this heavy fog.' — fog-drill overflow."},
        {"id": "2217810", "reason": "Long '…not a single person could be seen.' — fog-drill overflow (duplicate of 2229293)."},
        {"id": "322847", "reason": "'The fog has lifted.' — near-duplicate of 2761700."},

        # === Misc context-less commands / clunky ===
        {"id": "2245864", "reason": "'I hate rats.' — duplicate of 2249622 framing."},
        {"id": "5852859", "reason": "'I wore a mask.' — duplicate of 483681 framing."},
        {"id": "3363722", "reason": "'Seal the doors.' — paired duplicate of 2249860."},
        {"id": "2280269", "reason": "'Do you like bugs?' — paired duplicate of 2271873."},
        {"id": "2647279", "reason": "'Who picked the corn?' — odd context-less question."},
        {"id": "2641043", "reason": "'Have you ever seen a tiger around here?' — odd context."},
        {"id": "5910083", "reason": "'I went duck hunting last weekend.' — hunting overflow."},
        {"id": "1553518", "reason": "'Do you have a hunting license?' — hunting overflow."},
        {"id": "55128", "reason": "'These butterflies are rare in our country.' — country-vague."},
        {"id": "2245909", "reason": "'I heard explosions.' — duplicate of 3824803."},
        {"id": "60707", "reason": "Long 'Is this ladder strong enough to bear my weight?' — clunky."},
        {"id": "60485", "reason": "'This hotel can accommodate 500 guests.' — niche specific."},

        # === Final small tonal trims ===
        {"id": "2548741", "reason": "'I'm a little shaky.' — near-duplicate of 2546627."},
        {"id": "5318464", "reason": "'Mary pretended to polish her nails.' — clunky niche action."},
        {"id": "2031946", "reason": "'I want an hourly update about what's happening.' — context-less demand."},
        {"id": "2588723", "reason": "Long 'It's not uncommon for people to give fake personal information…' — clunky abstract."},
        {"id": "4923545", "reason": "Long memorizing-deck-of-cards sentence — abstract opinion."},
        {"id": "5483581", "reason": "'One of our gas cans is missing.' — niche context-less."},
        {"id": "2255401", "reason": "'You've been convicted.' — accusatory in isolation."},
        {"id": "4687350", "reason": "'There's no instruction manual for parenthood.' — meta-aphorism."},
        {"id": "2042786", "reason": "Long 'One thing I don't ever want to do again is punch a time clock.' — clunky idiom."},
        {"id": "2270510", "reason": "'Don't mock me.' — duplicate of 2218206 register."},
        {"id": "5675234", "reason": "'Most people nowadays don't understand friendship.' — preachy generalization."},
    ],

    "arcs": [
        # ============================================================
        # === THREE HIGHEST-QUALITY OPENING ARCS (position: first) ===
        # ============================================================

        # --- Opener 1: opinion / nuanced reasoning — flagship L14 register ---
        {
            "position": "first",
            "items": [
                "3826754",  # What's your analysis?
                {"text": "Honestly, I'm still weighing my options.", "added_for": "options|weighing", "reason": "nuanced reply"},
                {"text": "Could you elaborate on that?", "added_for": "elaborate", "reason": "polite request for expansion"},
                "4529773",  # I agree with your assessment.
                "4529843",  # Was that a fair assessment?
                {"text": "I think it was reasonable, all things considered.", "added_for": "reasonable|considered", "reason": "hedged opinion"},
            ],
        },

        # --- Opener 2: investigation / official statement (advanced professional register) ---
        {
            "position": "first",
            "items": [
                "2953879",  # We'll start an investigation immediately.
                "4664309",  # The investigation could take weeks.
                {"text": "What's the official position?", "added_for": "official|position", "reason": "natural follow-up Q"},
                {"text": "They haven't decided yet.", "added_for": "decided", "reason": "natural reply (per spec example)"},
                "5870002",  # We need an independent investigation.
                "3513490",  # How's your investigation going?
            ],
        },

        # --- Opener 3: hypotheticals / modal reflection / polite hedge ---
        {
            "position": "first",
            "items": [
                "2406807",  # I strongly advise you to reconsider.
                "3127858",  # I suggest you reconsider your decision.
                {"text": "Have you given it more thought?", "added_for": "thought", "reason": "natural follow-up Q (per spec)"},
                {"text": "I'm still weighing my options.", "added_for": "weighing", "reason": "natural reply (per spec)"},
                "4529079",  # Under normal circumstances, I'd agree to do that.
                "5916579",  # You must've been tired.
            ],
        },

        # ============================================================
        # === Politics / election ===
        # ============================================================
        [
            "500548",   # Are you involved in politics?
            "5676704",  # I hate talking about politics.
            "5932957",  # I find politics very interesting.
            {"text": "Why do you find it interesting?", "added_for": "interesting", "reason": "natural follow-up Q"},
            "2539701",  # I'm thinking of going into politics.
            "241757",   # If students today had more free time, they might show more interest in politics.
        ],
        [
            "5784185",  # We often discuss politics.
            "22866",    # We argued politics.
            "5320503",  # I don't like to argue about politics.
            {"text": "Then let's change the subject.", "added_for": "subject|change", "reason": "polite topic-shift"},
            "27292",    # We would often sit up all night discussing politics.
            "248939",   # We must separate politics from religion.
        ],
        [
            "682348",   # I didn't vote in the last election.
            "283969",   # There is little hope of his winning the election.
            "273532",   # The result of the election will be announced tomorrow.
            "31909",    # Mary felt happy when she learned the results of the election.
            "1315808",  # There's a good chance that he'll be elected.
            "457538",   # His chances of being elected are good.
            "283968",   # Is there any possibility that he'll win the election?
            {"text": "It's too close to call.", "added_for": "close|call", "reason": "idiomatic political reply"},
        ],
        [
            "3824984",  # You weren't elected.
            "4831739",  # Did you watch the presidential debate?
            {"text": "Most of it. I muted the rest.", "added_for": "muted|most", "reason": "natural reply"},
            "4494781",  # Are you a Republican?
            "2644661",  # Why are you a Republican?
            {"text": "I'd rather not discuss party politics.", "added_for": "party|discuss", "reason": "polite hedge"},
            "1356015",  # Lincoln was elected President of the United States in 1860.
        ],

        # ============================================================
        # === Lawyer / legal (lots of material — split into themed arcs) ===
        # ============================================================
        [
            "2254914",  # Who's your lawyer?
            "2547227",  # I'm calling my lawyer.
            "1403176",  # I demand to speak with my lawyer.
            {"text": "We'll arrange that immediately.", "added_for": "arrange|immediately", "reason": "polite legal-reply"},
            "2254642",  # Where's my lawyer?
        ],
        [
            "4015717",  # How did your meeting with your lawyer go?
            {"text": "It went well, considering.", "added_for": "considering", "reason": "hedged reply"},
            "4262926",  # I have an appointment with my lawyer today.
            "3921626",  # My lawyers said I should meet with you.
            "3921176",  # My lawyer has advised me to cooperate.
        ],
        [
            "2387645",  # I need to hire a lawyer.
            "2953791",  # We should hire a lawyer.
            "2301299",  # I can recommend a good lawyer.
            {"text": "I'd appreciate that.", "added_for": "appreciate", "reason": "polite thanks"},
            "2451143",  # Can you introduce me to a lawyer who speaks French?
            "3826939",  # We'll get you the best lawyer we can afford.
        ],
        [
            "2953954",  # We've already hired a lawyer.
            "5850396",  # I've hired a new lawyer.
            "4529068",  # The defense lawyer didn't ask the right questions.
            "2452037",  # The lawyer decided to appeal the case.
            "886911",   # She advised him to see a lawyer.
            "320436",   # Why don't you consult a lawyer?
        ],
        [
            "1555874",  # My father-in-law is a lawyer.
            "250006",   # I have a cousin who is a lawyer.
            "253298",   # I know a girl whose father is a lawyer.
            "261715",   # I intend to become a lawyer.
            "5226708",  # I haven't yet talked to my lawyer about this.
        ],

        # ============================================================
        # === Tired (HEAVY drill — defused: 3 small arcs, varied vocab) ===
        # ============================================================
        # Original CSV had 40+ tired sentences. Most removed above; here we
        # keep a few of the best and interleave with exhausted / weary /
        # burned-out rewrites to break the repetition.
        [
            "302948",   # He seems tired.
            "3347156",  # You look rather tired.
            "3095216",  # Weren't you tired?
            {"text": "I'm exhausted, actually.", "added_for": "exhausted|actually", "reason": "vocab-vary 'tired' (rewrite)"},
            "2952864",  # I'm starting to feel tired.
            "24996",    # I'm sort of tired.
        ],
        [
            "5853228",  # Everyone's tired.
            "2094850",  # Everybody's tired.
            {"text": "Let's call it a day.", "added_for": "call|day", "reason": "idiomatic reply"},
            "2362099",  # I feel tired and exhausted.
            "1890965",  # I'm awfully tired.
            "2546627",  # I'm feeling very shaky.
        ],
        [
            "3721655",  # My arms are tired.
            "2648469",  # My legs are tired.
            {"text": "Sit down for a while.", "added_for": "sit|while", "reason": "natural advice"},
            "4523302",  # Sooner or later, I'll probably get tired of doing this.
            "5853192",  # I tire easily.
            "6105945",  # Doing that was tiring.
            "1701458",  # Today was a tiring day.
        ],
        [
            "5656507",  # I'm tired of keeping secrets.
            "2450019",  # I'm tired of altering my plans every time you change your mind.
            {"text": "Then tell me what you really want.", "added_for": "really|want", "reason": "honest comeback"},
            "16921",    # I'm tired of your complaints.
            "2539444",  # I'm really tired of your complaining.
        ],
        [
            "73072",    # I got tired of lying in bed all day.
            "255482",   # I am so tired that I can hardly walk.
            "307461",   # He was so tired that he could hardly stand.
            "2537610",  # I'm tired of just sitting here and doing nothing.
            "261504",   # I'm tired of working a nine-to-five job.
            {"text": "Maybe it's time for a change.", "added_for": "time|change", "reason": "natural empathetic reply"},
        ],
        [
            "1882",     # I slept a little during lunch break because I was so tired.
            "255255",   # I fell sound asleep because I was very tired.
            "284491",   # When I talked with him on the phone, he sounded tired.
            "2406525",  # I slept like a log.
        ],

        # ============================================================
        # === Pants / clothes / wardrobe ===
        # ============================================================
        [
            "1895541",  # Your pants are dirty.
            "4501580",  # Pull your pants up.
            "2771735",  # How much do these pants cost?
            "3822618",  # These pants are too small for me.
            "569076",   # Those pants are a little too tight in the waist.
            "1422128",  # I bought two pairs of pants.
            "2796772",  # I bought a suit with two pairs of pants.
        ],
        [
            "2404163",  # I ripped my pants.
            "2549555",  # I tore my pants.
            "3342801",  # You tore your pants.
            "2889142",  # I wiped the dirt off my pants.
            {"text": "Did you fall?", "added_for": "fall", "reason": "natural Q after torn-pants"},
        ],

        # ============================================================
        # === Friendship / appreciation ===
        # ============================================================
        [
            "1970208",  # I value our friendship.
            "2948913",  # Your friendship is important.
            "503856",   # Your friendship means a lot to me.
            {"text": "Likewise.", "added_for": "likewise", "reason": "warm reciprocal reply"},
            "1970213",  # I don't deserve your friendship.
            "4665347",  # How did your friendship begin?
        ],
        [
            "4529634",  # It might affect our friendship.
            "4891505",  # Don't let this ruin your friendship.
            "1954555",  # We can't let this ruin our friendship.
            "905092",   # Friendship lasts longer than memories.
            "269568",   # True friendship is priceless.
        ],
        [
            "4663372",  # Maintaining friendships can be challenging.
            "4664353",  # Friendships tend to be challenging.
            {"text": "Worth the effort, though.", "added_for": "effort|worth", "reason": "warm hedge"},
        ],

        # ============================================================
        # === Investigation / official conduct ===
        # ============================================================
        [
            "2218469",  # You're under investigation.
            "5136940",  # An investigation has been ordered.
            "4664800",  # The investigation is continuing.
            "4663464",  # Police are continuing their investigation.
            "4500348",  # An investigation was launched.
            "4496763",  # The investigation was incomplete.
            "2358998",  # I have an investigation to conduct.
        ],
        [
            "2245229",  # Continue your investigations.
            {"text": "We will. Thank you.", "added_for": "thank", "reason": "polite professional reply"},
        ],

        # ============================================================
        # === Regret / sacrifice / apology (subjunctive territory) ===
        # ============================================================
        [
            "5109244",  # Sacrifice is sometimes necessary.
            "1954600",  # I can't let you sacrifice yourself.
            "4500955",  # We made sacrifices.
            "3310036",  # We've both made sacrifices.
            "2247394",  # I sacrificed everything.
            {"text": "Was it worth it?", "added_for": "worth", "reason": "honest follow-up Q"},
            "3831387",  # Your sacrifice won't go unnoticed.
        ],
        [
            "2011950",  # I'd like to make amends.
            "4402015",  # We're not trying to make amends.
            "887040",   # She confronted him and demanded an apology.
            {"text": "Did he apologize?", "added_for": "apologize", "reason": "natural follow-up Q"},
            {"text": "Eventually, yes.", "added_for": "eventually", "reason": "natural reply"},
        ],

        # ============================================================
        # === Resign / reconsider / quit (career decisions) ===
        # ============================================================
        [
            "2111797",  # I resigned.
            "2203778",  # Who resigned?
            "5858703",  # I chose to resign.
            "3129787",  # If that happens, I'll resign.
            "251220",   # My boss was forced to resign.
            "3127898",  # No one's suggesting that you should resign.
            "258352",   # He handed in his resignation.
        ],
        [
            "4998383",  # This is my letter of resignation.
            "790326",   # He decided to submit his resignation.
            "2294000",  # I beg you to reconsider.
            "3395531",  # I'm asking you to reconsider.
            {"text": "I've made up my mind.", "added_for": "mind|made", "reason": "firm reply"},
        ],

        # ============================================================
        # === Procedure / standard / routine ===
        # ============================================================
        [
            "2249286",  # It's standard procedure.
            "2249413",  # Just follow procedure.
            "2280393",  # Please explain the procedure.
            {"text": "Let me give you an example.", "added_for": "example", "reason": "natural follow-up (per spec)"},
            "2290334",  # I didn't know the exact procedure.
            "1415954",  # I explained the procedures to him.
            "2953732",  # We need to start emergency procedures.
        ],
        [
            "2249236",  # It's routine procedure.
            "6550160",  # It's a routine procedure.
            "2892424",  # We want a complete evaluation.
            "4664611",  # The evaluation could take months.
        ],

        # ============================================================
        # === Priorities / decisions / leadership ===
        # ============================================================
        [
            "4500549",  # We need leadership.
            "2207452",  # Get your priorities straight.
            "2360197",  # I have other priorities.
            "4500975",  # Pain management is the priority.
            "5363898",  # Storage space isn't a priority.
            "2892038",  # That's not exactly a top priority.
        ],
        [
            "909571",   # Spending time with your family should be your priority.
            "909572",   # Spending time with your significant other should be high on your priority list.
            "5205490",  # I just want a little more freedom to make my own decisions.
            {"text": "That's perfectly reasonable.", "added_for": "perfectly|reasonable", "reason": "validating reply"},
        ],

        # ============================================================
        # === Friendship / fascination / extraordinary (positive abstract) ===
        # ============================================================
        [
            "3131757",  # Something extraordinary happened.
            "2954923",  # You're an extraordinary woman.
            "5613787",  # We have an extraordinary design team.
            "3142733",  # That's a fascinating question.
            "5888160",  # I find languages fascinating.
            "4017139",  # This is a fascinating article.
        ],
        [
            "5726372",  # I think Australia is fascinating.
            "953456",   # I found the subject fascinating.
            "4663776",  # I think that would've been fascinating.
            "2111734",  # I'm fascinated.
            "2202847",  # We're fascinated.
        ],

        # ============================================================
        # === Accomplishment / goals ===
        # ============================================================
        [
            "997243",   # Did you accomplish your goals?
            "3396795",  # What were you hoping to accomplish?
            "4013067",  # How did you manage to accomplish that?
            {"text": "It took years of work.", "added_for": "years|work", "reason": "honest reply"},
            "5046399",  # We're very proud of what we've been able to accomplish.
            "302296",   # He accomplished his mission.
        ],
        [
            "4495446",  # We've accomplished that goal.
            "4529331",  # What has violence ever accomplished?
            "2953533",  # We accomplished everything we wanted to.
            "4495442",  # We've accomplished almost everything we set out to do.
            "4529026",  # The first stage of the operation has been accomplished.
        ],

        # ============================================================
        # === Conviction / confession / suspect / police ===
        # ============================================================
        [
            "2247469",  # I was convicted.
            "1933585",  # I appreciate your conviction.
            "3825595",  # You signed a confession.
            "4016591",  # Why did you sign the confession?
            {"text": "I had no choice.", "added_for": "choice", "reason": "natural reply"},
            "2252584",  # The suspect confessed.
            "296839",   # He confessed his guilt.
            "2011368",  # I want to confess.
            "2308011",  # I confess I'm afraid to go by myself.
        ],

        # ============================================================
        # === Capture / escape / criminal / thief ===
        # ============================================================
        [
            "267981",   # The boy captured the bird with a net.
            "4496285",  # We'll capture them.
            "2953585",  # We captured some of the terrorists.
            "2757597",  # The police captured the escaped criminal.
            "4496284",  # Have the escaped prisoners been captured?
            "2643362",  # One of the lions has escaped.
            "23176",    # We captured the thief.
        ],
        [
            "266259",   # The prisoner was given his freedom.
            "317705",   # They fought for freedom.
            "239796",   # Freedom of speech is restricted in some countries.
            "28768",    # We defeated the enemy.
            "1293181",  # He admitted his defeat.
            "2255419",  # You've defeated me.
        ],

        # ============================================================
        # === License / driver's / paperwork ===
        # ============================================================
        [
            "2308144",  # I could lose my license.
            "4014039",  # What's your license plate number?
            "4495526",  # Did you read the license agreement?
            "4384264",  # Do you have a license to operate a motor boat?
            "2359732",  # I've got to get my license renewed.
            "2640010",  # My driver's license is valid for three more years.
        ],
        [
            "2644119",  # Here's my driver's license.
            "2668180",  # Someone stole my driver's license.
            "1445461",  # I finally got a driver's license.
            "16302",    # I think you'll have very little difficulty in getting a driver's license.
            "4497082",  # The guy driving the truck that crashed into our car didn't have a driver's license.
            "887011",   # She bought him a car, but he didn't have a driver's license …
            "1221409",  # You can get a car license after you turn eighteen.
        ],

        # ============================================================
        # === Registration / form / paperwork ===
        # ============================================================
        [
            "4501675",  # Registration starts at 2:30.
            "4501693",  # No registration is required.
            "4305624",  # Fill out the registration form.
            "4305622",  # Fill out the questionnaire.
            "4495994",  # Registration began October 20th.
            "4501674",  # Registration starts October 20th.
        ],

        # ============================================================
        # === Updates / corresponding / staying in touch ===
        # ============================================================
        [
            "2249504",  # Keep me updated.
            "5851609",  # I want updates.
            "4495696",  # I appreciate the updates.
            "2646530",  # Thanks for the update.
            "4498331",  # I've updated the blog entry.
            {"text": "Looks great.", "added_for": "looks|great", "reason": "natural compliment"},
            "5786451",  # We're updating the site.
            "903713",   # There is an urgent need for them to update their system.
        ],
        [
            "3818654",  # Why don't you update your website?
            "4187426",  # How can I update this software?
            {"text": "There's a tutorial online.", "added_for": "tutorial|online", "reason": "natural reply"},
            "71195",    # I look forward to corresponding with you.
            "2418527",  # Thank you for your prompt reply.
        ],

        # ============================================================
        # === Complaints / passive-aggressive ===
        # ============================================================
        [
            "2016897",  # I want to lodge a formal complaint.
            "4499553",  # I lodged a complaint with the police.
            {"text": "What was the outcome?", "added_for": "outcome", "reason": "follow-up Q"},
            {"text": "Still pending.", "added_for": "pending", "reason": "professional reply"},
        ],

        # ============================================================
        # === Childhood / nostalgia ===
        # ============================================================
        [
            "2007328",  # Let's talk about your childhood.
            "2331593",  # I had a horrible childhood.
            {"text": "I'm sorry to hear that.", "added_for": "sorry|hear", "reason": "empathetic reply"},
            "500477",   # This picture reminds me of my childhood.
            "60090",    # This song reminds me of my childhood.
            "909588",   # What you spend time doing in your childhood affects the rest of your life.
        ],

        # ============================================================
        # === Essays / writing / school ===
        # ============================================================
        [
            "1114890",  # Write a short essay.
            "323345",   # I have a few essays to write by tomorrow.
            "1300501",  # When I was in school, I really hated writing essays.
            {"text": "Same here. I dreaded them.", "added_for": "dreaded|same", "reason": "empathetic agreement"},
            "909564",   # She spent a lot of time writing her essay.
            "3162046",  # Thank you for helping me with my essay.
        ],
        [
            "2953237",  # My teacher asked me to rewrite my essay.
            "3325880",  # My French teacher told to rewrite my essay.
            {"text": "What did they want changed?", "added_for": "changed|want", "reason": "natural follow-up"},
        ],

        # ============================================================
        # === Vocabulary / grammar / language learning ===
        # ============================================================
        [
            "3542628",  # My vocabulary is limited.
            "2540991",  # I'll show you my vocabulary list.
            "681201",   # I want to increase my vocabulary.
            "909593",   # You should spend a little time each day reviewing vocabulary.
            "2698760",  # I'm struggling with French grammar.
            "1894029",  # I'm having a hard time with German grammar.
            "3932725",  # Grammar is confusing.
            "4663466",  # Mastering a foreign language is difficult.
        ],
        [
            "1315801",  # He translated the verse into English.
            "3122191",  # Do you know what they call a French horn in French?
            {"text": "Surprisingly, it's just called 'horn'.", "added_for": "surprisingly|called", "reason": "playful trivia reply"},
        ],

        # ============================================================
        # === Cancer / cure / medicine ===
        # ============================================================
        [
            "3733441",  # There's no known cure.
            "63426",    # We can cure some types of cancer.
            "682514",   # Scientists haven't found a cure for cancer yet.
            "6108339",  # I think doctors will eventually find a cure for cancer.
            "4850038",  # Maybe they can help us find a cure.
            "297977",   # He cured my illness.
            "20801",    # Cancer can be cured if discovered in time.
        ],
        [
            "44314",    # The initial symptoms of the disease are fever and sore throat.
            "4014153",  # What symptoms have you noticed?
            {"text": "A persistent cough and fatigue.", "added_for": "persistent|cough", "reason": "medical reply"},
            "29986",    # Do you have this symptom often?
            "268190",   # You should consult a doctor if the symptoms get worse.
            "2234107",  # What's the diagnosis?
            "4140577",  # What's your diagnosis?
        ],
        [
            "2245406",  # Double the dose.
            "5909323",  # The doctor said that I'm unfit for duty.
            "1362096",  # She's unfit for the job.
            "303088",   # He regained consciousness in the hospital.
            "5853063",  # I don't want to discourage you from trying to do that.
        ],

        # ============================================================
        # === Wounds / scars / healing ===
        # ============================================================
        [
            "4499272",  # Some wounds never heal.
            "2268668",  # The wound healed.
            "46574",    # The wound has not healed yet.
            "681149",   # It takes time to heal from a divorce.
            "274956",   # There may be some scars.
            "1886689",  # What's that scar from?
            "2406634",  # Long: I still have a scar on my left leg …
            "3824884",  # Time heals everything.
            "263894",   # Time heals all wounds.
        ],

        # ============================================================
        # === Body parts / aches / scratches ===
        # ============================================================
        [
            "1190450",  # My toe started bleeding.
            "274478",   # I have a pain in my little toe.
            "4311147",  # The big toe on my right foot hurts.
            "274479",   # Watch your toes.
            "3071602",  # My toes are frozen.
            "1951595",  # I can't feel my fingers or my toes.
            "2206678",  # Don't step on my toes.
            "1985914",  # It keeps you on your toes.
            "1534328",  # Can you touch your toes without bending your legs?
        ],
        [
            "1205633",  # I want to scratch my nose.
            "3387155",  # Scratch my back and I'll scratch yours.
            "526888",   # My cat likes it when I scratch her behind the ears.
            "4710275",  # Why is my dog always scratching himself?
            "282011",   # I can hear a cat scratching at the window.
            "1096363",  # Someone scratched my car.
            "2721215",  # My cat scratched me.
            "2953112",  # It's just a scratch, OK?
        ],
        [
            "2439722",  # Can you rub my shoulders?
            {"text": "Sure, sit down.", "added_for": "sit", "reason": "natural reply"},
            "2404167",  # I rubbed my feet.
            "317196",   # She rubbed her eyes.
            "325642",   # The faster we rub our hands together, the warmer they get.
        ],

        # ============================================================
        # === Slap / punch / scuffle (mild violence) ===
        # ============================================================
        [
            "5175121",  # I didn't punch anybody.
            "2026920",  # I want to know who threw the first punch.
            "4015983",  # Have you ever been punched in the face?
            "2254874",  # Who punched you?
            "2890330",  # Would you care for a drink of punch?
            "2361662",  # I ought to punch you for saying that.
        ],
        [
            "4907416",  # Don't make me slap you.
            "5856486",  # Why did you slap me?
            "302884",   # He slapped her.
            "25687",    # I got slapped on both cheeks.
        ],

        # ============================================================
        # === Curse / blessing / superstition ===
        # ============================================================
        [
            "1449619",  # It's a curse.
            "3422020",  # The curse was broken.
            "4397560",  # They cursed us.
            "240479",   # Don't swear in public.
            "2407146",  # I swear I'm telling the truth.
            "2407150",  # I swear it wasn't my fault.
            "2652921",  # I swear I'll always protect you.
            "5860557",  # I started swearing.
            "5828620",  # I swore.
            "5857211",  # A few years ago, I swore never to fall in love again.
        ],
        [
            "1895749",  # You have my blessing.
            "3151447",  # Give me your blessing.
            "2245242",  # Count your blessings.
            "5945304",  # You should count your blessings.
            "2283724",  # I'm blessed.
            "3374199",  # I feel blessed.
            "2111946",  # Bless you.
        ],

        # ============================================================
        # === Ghost / supernatural / dragon ===
        # ============================================================
        [
            "3199914",  # Tell us a ghost story.
            "4829422",  # Do you know any ghost stories?
            "4663646",  # I'm not convinced ghosts actually exist.
            "243823",   # Nowadays nobody believes in ghosts.
            "2314965",  # I didn't know you believed in ghosts.
            {"text": "I'm not sure I do either.", "added_for": "sure|either", "reason": "honest reply"},
        ],
        [
            "4124544",  # Are dragons real?
            "499590",   # Dragons are imaginary animals.
            "325503",   # The dragon is an imaginary creature.
            "2050649",  # The Giants play the Dragons tomorrow.
            "25616",    # The prince was changed into a frog.
        ],

        # ============================================================
        # === Coincidence / instinct / intuition ===
        # ============================================================
        [
            "4016634",  # What an amazing coincidence!
            "5090017",  # This is no mere coincidence.
            "2330095",  # I guess this is a coincidence.
            "3396668",  # I doubt that's just a coincidence.
            "2538942",  # I'm assuming it was just a coincidence.
        ],
        [
            "317054",   # She's acting on instinct.
            "3736372",  # I acted on instinct.
            "2245501",  # Follow your instincts.
            {"text": "What does your gut tell you?", "added_for": "gut", "reason": "natural follow-up"},
            "5126566",  # That sounds vaguely familiar.
            "5306656",  # That man looks vaguely familiar.
        ],

        # ============================================================
        # === Manipulation / mockery / confrontation ===
        # ============================================================
        [
            "2275350",  # Don't try to manipulate me.
            "2954568",  # You know how to manipulate me.
            "5859792",  # I felt manipulated.
            "3311060",  # We're all being manipulated.
            "2218206",  # You're mocking me.
            "2648163",  # Are you mocking me?
            {"text": "Not at all. I'm serious.", "added_for": "serious", "reason": "honest deflection"},
        ],
        [
            "2271874",  # I don't like confrontation.
            "903825",   # I think it's time for me to confront that problem.
            "269923",   # Don't interfere in other people's affairs.
            "2241174",  # We must intervene.
            "2111547",  # Somebody intervened.
            "2203713",  # Who intervened?
            "2203709",  # I'm interfering.
            "2203710",  # We're interfering.
        ],

        # ============================================================
        # === Outsider / belonging / loneliness ===
        # ============================================================
        [
            "2548640",  # They are outsiders.
            "5853121",  # I'm an outsider.
            "261576",   # I was an outsider.
            "1487699",  # I felt isolated.
            "4499802",  # I was totally isolated.
            "1311271",  # I have cabin fever.
        ],

        # ============================================================
        # === Tire / car / mechanic ===
        # ============================================================
        [
            "4496530",  # Check your tire pressure.
            "3467971",  # My bike has a flat tire.
            "4014655",  # The left front tire looks low.
            "2627924",  # The rear tire of my bicycle is flat.
            "41126",    # I had to push my bicycle because I had a flat tire.
            "2078108",  # How much do you charge to fix a flat tire?
            "2406862",  # I suppose I could change a tire if I had to.
            "41121",    # I pumped up the tire.
            "2510810",  # This car needs new tires.
            "2042779",  # You might want to consider buying some new tires for your car.
        ],
        [
            "2463825",  # I broke the clutch.
            "5751377",  # The clutch isn't working right.
            "2541154",  # Who's going to pay the mechanic?
            "2073712",  # The pump didn't work properly.
            "2275775",  # Didn't you fix the pump?
            "269002",   # The function of the heart is to pump blood.
        ],

        # ============================================================
        # === Air conditioner / appliances ===
        # ============================================================
        [
            "4644995",  # The air conditioner is broken.
            "5179250",  # Let's turn on the air conditioner.
            "256462",   # I can't do without an air conditioner in the summer.
            "908916",   # Which air conditioner do you think is the most efficient?
        ],

        # ============================================================
        # === Drawer / household interior ===
        # ============================================================
        [
            "2245182",  # Close that drawer.
            "2280434",  # This drawer won't open.
            "2389574",  # I opened the drawer to get a pencil.
            "3426208",  # Why is this knife not in the drawer?
            "3738418",  # Have you looked in the bottom drawer?
            "625192",   # Every successful writer has a drawer full of rejection letters.
            "48840",    # The desk has three drawers.
            "4016141",  # Did you go through my drawers?
        ],

        # ============================================================
        # === Cooking / breakfast / toast ===
        # ============================================================
        [
            "2011837",  # Who wants french toast?
            "3563957",  # The toast is cold.
            "38294",    # I've burnt the toast.
            {"text": "I'll make another piece.", "added_for": "another|piece", "reason": "natural reply"},
            "1936393",  # I'd like to propose a toast.
            "3819591",  # The bread is stuck in the toaster.
            "2358835",  # I have a toaster.
        ],
        [
            "2011623",  # Who wants more bacon?
            "34033",    # Would you like bacon or sausage?
            "1961265",  # I thought I smelled bacon.
            "3374203",  # I smelled bacon.
        ],
        [
            "55597",    # This is homemade jam.
            "3287432",  # There's nothing like a dish of homemade ice cream.
            "4121174",  # The lamb was cooked perfectly.
            "2283608",  # I don't like powdered sugar.
            "852616",   # Please peel the potatoes.
            "1744804",  # I have to peel the apples.
            "5859308",  # I peeled the apple.
            "3635821",  # Keep our eyes peeled.
        ],

        # ============================================================
        # === Supper / mealtimes (trimmed) ===
        # ============================================================
        [
            "3184877",  # Stay for supper.
            "1072639",  # Have you already eaten supper?
            "1439844",  # My mother is preparing supper.
            {"text": "It smells delicious.", "added_for": "smells|delicious", "reason": "natural compliment"},
        ],

        # ============================================================
        # === Toilet / household maintenance ===
        # ============================================================
        [
            "38941",    # The toilet doesn't flush.
            "3819480",  # Remember to flush the toilet.
            "5874650",  # We need to reinforce the roof.
            "4850023",  # There was no structural damage.
            "4496196",  # Many buildings sustained substantial damage.
            "4174314",  # The bridge collapsed when one of the cables snapped.
        ],

        # ============================================================
        # === Hammer / tools / household repair ===
        # ============================================================
        [
            "3117282",  # Get a hammer and nails.
            "2711727",  # Could I borrow a hammer?
            {"text": "Sure, it's in the garage.", "added_for": "garage", "reason": "natural reply"},
            "4076838",  # Where's the hammer?
            "2541762",  # I'm using the hammer right now.
            "549901",   # I borrowed my father's hammer to build a dog house.
            "2202926",  # We're hammered.
        ],

        # ============================================================
        # === Sewing / buttons ===
        # ============================================================
        [
            "316871",   # She is sewing a dress.
            "3361137",  # I have a sewing machine, but I rarely use it.
            "313794",   # She can sew very well.
            "3022458",  # Please sew these buttons on.
            "29235",    # Would you sew a button on my shirt?
            "644637",   # My hands were shaking too much to thread the needle.
        ],
        [
            "3822089",  # I hate needles.
            "3726958",  # I don't like needles.
            {"text": "Most people don't.", "added_for": "most", "reason": "validating reply"},
        ],

        # ============================================================
        # === Garbage / disposal / clutter ===
        # ============================================================
        [
            "56406",    # Put the garbage outside.
            "1290715",  # Don't throw garbage away here.
            "1290714",  # Don't dump garbage here.
            "1951610",  # I can't find any garbage bags.
            "322359",   # They collect our garbage every Monday.
            "4772242",  # Have you taken out the garbage?
            "56405",    # The garbage collector comes three times a week.
            "434662",   # Don't litter!
            "3399654",  # What a dump.
        ],

        # ============================================================
        # === Lions / tigers / wild animals ===
        # ============================================================
        [
            "29847",    # The lion struggled to get out of his cage.
            "29834",    # We've got to catch the lion alive.
            "4493789",  # Tickets are available from Lions Club members.
            "563720",   # He likes tigers.
            "1870095",  # What do tigers eat?
            "257317",   # I aimed at the tiger and fired, but missed him.
        ],

        # ============================================================
        # === Deer / hunting / wildlife ===
        # ============================================================
        [
            "2249072",  # It's deer season.
            "4494065",  # Deer are fairly intelligent.
            "269480",   # We didn't see many deer in the forest.
            "290950",   # He couldn't bring himself to shoot the deer.
            "53504",    # A baby deer can stand as soon as it's born.
        ],

        # ============================================================
        # === Frogs / amphibians ===
        # ============================================================
        [
            "5254795",  # Frogs eat flies.
            "953487",   # I hear that he eats frogs.
            "57893",    # There used to be a lot of frogs in this pond.
            "265649",   # The snake swallowed a frog.
            "4198288",  # The only word written on the page was the word 'frog.'
        ],

        # ============================================================
        # === Insects / bugs / mosquitos ===
        # ============================================================
        [
            "2271873",  # I don't like bugs.
            "2407140",  # I swallowed a bug.
            "23597",    # A mosquito just bit me.
            "6140",     # I've got mosquito bites all over my arm.
            "256554",   # I got bitten by mosquitoes.
            "4794027",  # I was bitten by a mosquito.
            "4662700",  # Mosquitoes seem to be more attracted to people wearing dark clothes.
            "4662664",  # Someone told me that people with type O blood …
            "4496177",  # Don't forget to bring bug spray.
        ],
        [
            "62960",    # Spiders spin webs.
            "2793914",  # The spider is spinning a web.
            "62968",    # Have you ever seen a spider spinning its web?
            "280114",   # My head is spinning.
            "3353685",  # What do you think would happen if the earth stopped spinning?
        ],

        # ============================================================
        # === Ducks / birds / wildlife (light) ===
        # ============================================================
        [
            "2245414",  # Duck your head!
            "3724386",  # I suggest you duck.
            "401429",   # It's similar to a duck.
            "4497987",  # Don't feed the ducks.
            "2541893",  # I'm going to go feed the ducks.
            "3130327",  # We could see some ducks on the lake.
            "5154731",  # I hate it when people try to duck their responsibilities.
        ],

        # ============================================================
        # === Rats / vermin ===
        # ============================================================
        [
            "71250",    # You're such a pack rat.
            "2543034",  # I'm beginning to smell a rat.
            "2249622",  # Nobody likes rats.
            "4013699",  # I think that's rat poison.
            "3068959",  # I need to buy some rat poison.
        ],

        # ============================================================
        # === Butterflies / metamorphosis ===
        # ============================================================
        [
            "261436",   # I caught a beautiful butterfly.
            "4536145",  # How long does a butterfly live?
            "3170739",  # Have you ever seen a purple butterfly?
            "18954",    # I have butterflies in my stomach.
        ],

        # ============================================================
        # === Weather / fog / mist ===
        # ============================================================
        [
            "278919",   # The weather forecast is not necessarily reliable.
            "278905",   # According to the weather forecast, it will clear up tomorrow.
            "2229293",  # Because of the dense fog, nobody could be seen.
            "2761700",  # The fog lifted quickly.
            "6115708",  # The mist is clearing.
            "322862",   # A boat suddenly appeared out of the mist.
            "4493783",  # The flight was canceled because of the thick fog.
        ],
        [
            "388845",   # As soon as it stopped raining a beautiful rainbow appeared.
            "29540",    # How long is the Rainbow Bridge?
            "2350812",  # It rained continuously for three days.
            "1074387",  # We came dangerously close to freezing to death.
            "241517",   # I was chilled to the bone.
            "31798",    # It has become noticeably colder.
        ],

        # ============================================================
        # === Cabin / shore / outdoors ===
        # ============================================================
        [
            "3736684",  # The cabin was absolutely silent.
            "2335213",  # The cabin had no water or electricity.
            "294686",   # He walked along the shore.
            "22181",    # I saw a fishing boat about a mile off the shore.
            "5207756",  # I swam toward the shore.
            "2640936",  # We're about three kilometers off shore.
        ],
        [
            "2731662",  # Let's wait till high tide.
            "277845",   # The tide is rising fast.
            "325455",   # The stream is not very swift.
            "3045737",  # Let's go for a spin around the park.
            "3724616",  # I'll take this trail.
            "4665726",  # The trail is clearly marked.
        ],

        # ============================================================
        # === Adventure / surfing / sport ===
        # ============================================================
        [
            "4135117",  # Would you teach me to surf?
            "4134512",  # Who taught you to surf so well?
            "4135116",  # I've started teaching my kids to surf.
            "4397581",  # Surfing looks like fun.
            "5850201",  # I went surfing yesterday.
            "5839978",  # I'm a surfer.
            "909563",   # She spends way too much time surfing the web.
        ],
        [
            "4890524",  # Let's hit the slopes.
            "248631",   # We climbed up the steep mountain.
            "262725",   # We went up the mountain by cable car.
            "275352",   # I want to charter a bus.
            "3825513",  # We met on a cruise.
            "4663752",  # There's no cruise control on this car.
        ],

        # ============================================================
        # === Statue / palace / architecture ===
        # ============================================================
        [
            "25649",    # The royal palace was built on a hill.
            "327479",   # The palace was heavily guarded.
            "4497104",  # The statue was damaged.
            "248861",   # We must move this statue very carefully.
            "882758",   # There are statues in the park.
            "682072",   # I have several statues in my garden.
            "522633",   # The Queen's crown was made of gold.
        ],

        # ============================================================
        # === Cigarettes / smoking / drugs ===
        # ============================================================
        [
            "291663",   # He gave up cigarettes.
            "3738458",  # Where did you hide my cigarettes?
            "319077",   # My father smokes a pack of cigarettes a day.
            "3826953",  # I think I'm seriously addicted.
            "2547175",  # I'm not a drug addict.
            "2247917",  # I'm an addict.
            "4497081",  # Crack is very addictive.
            "4497541",  # Do you think video games are addictive?
        ],

        # ============================================================
        # === Citizen / civic / civic duty ===
        # ============================================================
        [
            "2542973",  # I'm just a concerned citizen.
            "4666071",  # Are you a Canadian citizen?
            "1293129",  # You must respect senior citizens.
            "1699402",  # It's popular among senior citizens.
            "4493767",  # Tickets are $5 for adults, and $2 for senior citizens and children.
            "273660",   # A good citizen obeys the laws.
        ],

        # ============================================================
        # === Volunteer / nonprofit / social ===
        # ============================================================
        [
            "245037",   # There's no membership fee for joining.
            "4664621",  # That concern has been eliminated.
            "2953953",  # We've already eliminated half the possibilities.
            "4664029",  # It's difficult to eliminate cheating.
            "4664894",  # An injustice has been corrected.
            "4880010",  # That sounds like discrimination to me.
            "2245719",  # I don't discriminate.
        ],

        # ============================================================
        # === Poverty / society / inequality ===
        # ============================================================
        [
            "4494613",  # Poverty is everywhere.
            "680376",   # Some people blame poverty for crime.
            "263021",   # We live in the suburbs.
            "250551",   # My house is in the suburbs.
            "277586",   # There are some people who sleep in the daytime and work at night.
        ],

        # ============================================================
        # === Soldier / war / loyalty (light, not glorifying) ===
        # ============================================================
        [
            "2252578",  # The soldier ran.
            "5852740",  # I'm a soldier.
            "2111714",  # I'm loyal.
            "5618996",  # We have really loyal repeat customers.
        ],

        # ============================================================
        # === Masks / disguise / spies ===
        # ============================================================
        [
            "483681",   # He wore a mask so no one would recognize him.
            "3312125",  # We'll be wearing gas masks.
            "681958",   # Two men wearing masks robbed the bank.
            "2539684",  # The bank robbers were wearing masks.
            "2953639",  # We have captured one of their spies.
            "2244921",  # Are those explosives?
            "2253692",  # They've got explosives.
        ],

        # ============================================================
        # === Explosion / panic / disaster ===
        # ============================================================
        [
            "1544368",  # What caused the explosion?
            "2314888",  # I didn't cause the explosion.
            "4015985",  # There was a loud explosion.
            "4500640",  # That sounded like an explosion.
            "829541",   # It was such a powerful explosion that the roof was blown off.
            "3824803",  # I heard the explosions.
            "23835",    # The fire caused a panic in the theater.
            "4013866",  # There's no reason for panic.
            "6033393",  # I had a panic attack.
            "3821624",  # We can't risk causing a panic.
            "41552",    # There's no need to panic. There's plenty of time.
            "2111801",  # I panicked.
            "2111882",  # Everybody panicked.
        ],

        # ============================================================
        # === Chaos / order / structure ===
        # ============================================================
        [
            "4495335",  # It'll be chaos.
            "5370760",  # It was pure chaos.
            "4493650",  # Traffic has been halted.
            "2663231",  # Many problems resolve themselves.
            "2663445",  # We've resolved the problem.
            "3821181",  # The matter has been resolved.
            "5301576",  # I take partial responsibility.
        ],

        # ============================================================
        # === Romance / divorce / heart ===
        # ============================================================
        [
            "1384376",  # My girlfriend dumped me.
            {"text": "I'm sorry to hear that.", "added_for": "sorry|hear", "reason": "empathetic"},
            "42113",    # It was a one-sided love affair.
            "4017364",  # Who doesn't want love and affection?
        ],

        # ============================================================
        # === Dance / ballet / theatre ===
        # ============================================================
        [
            "2548868",  # How was the ballet?
            "3310845",  # We're going to the ballet.
            "4665727",  # The orchestra began to play.
            "21577",    # I'm going to join the school orchestra.
            "362737",   # I play the violin.
        ],

        # ============================================================
        # === Whistle / sound / music ===
        # ============================================================
        [
            "3722602",  # I won't blow the whistle.
            "1174145",  # The police officer blew his whistle.
            "1977737",  # Mary played the tin whistle when she was young.
            "3409275",  # The crowd was silent.
            "5069821",  # Just be silent and listen.
            "1312933",  # When he spoke, everyone became silent.
            "3719392",  # Everyone was silent for a minute.
            "1317088",  # When he finished speaking, everyone was silent.
            "24770",    # Not knowing what to say, I remained silent.
            "283587",   # There was an awkward silence when he appeared.
            "2243280",  # They nodded silently.
            "2665328",  # I hate silent movies.
        ],

        # ============================================================
        # === Awkward / strange social moments ===
        # ============================================================
        [
            "3171871",  # It's awkward.
            "4495051",  # Is that deliberate?
            "2648491",  # It was deliberate.
            "5136926",  # It's only a minor misunderstanding.
            "3605287",  # Don't worry about the minor details.
            "1832194",  # Since you're a minor, you aren't allowed to enter.
            "4016418",  # There are minor differences.
            "3528441",  # That's a minor detail.
        ],

        # ============================================================
        # === Reading / literature / biography ===
        # ============================================================
        [
            "5933750",  # This biography is fascinating.
            "6102206",  # I'm reading a biography.
            "3735743",  # I've never read any of the classics.
            "34550",    # Bill is still a legendary figure in this company.
            "295180",   # He writes scripts.
            "4494719",  # The script was awful.
        ],

        # ============================================================
        # === Logic / reasoning / premises ===
        # ============================================================
        [
            "4494596",  # The premise was wrong.
            "4499733",  # I understand the premise.
            "2187216",  # It's inadequate.
            "4664801",  # The funding could be inadequate.
            "2187231",  # It's redundant.
            "3731866",  # Wouldn't that be redundant?
            "2123549",  # That's unrelated.
            "4666237",  # I was thoroughly confused.
        ],

        # ============================================================
        # === Thorough / detail / quality of work ===
        # ============================================================
        [
            "2111951",  # Be thorough.
            "4869814",  # Thank you for your thorough explanation.
            "254836",   # I studied it thoroughly.
            "2643467",  # We've studied it thoroughly.
            "4498297",  # I thoroughly enjoyed the movie.
            "61538",    # We thoroughly enjoyed the delicious meal.
            "4663788",  # Everything has been thoroughly cleaned.
            "5404506",  # Every room was searched thoroughly.
            "5811737",  # It took a great deal of time to analyze the data.
            "2359005",  # I've analyzed the data.
            "2359006",  # I've analyzed the liquid.
            "2359007",  # I've analyzed the recording.
            "5631653",  # You over-analyze everything.
            "2402265",  # You're over-analyzing.
        ],

        # ============================================================
        # === Insight / understanding / appreciation ===
        # ============================================================
        [
            "2646002",  # Thanks for the insight.
            "1933577",  # I appreciate your insights.
            "3831452",  # Your generosity is appreciated.
            "5558865",  # We thank you for your generosity.
        ],

        # ============================================================
        # === Partial / partially / nuance ===
        # ============================================================
        [
            "2251188",  # That's partially correct.
            "4666285",  # You're partially correct.
            "42122",    # It was a partial success.
            "2796750",  # I can only afford to make a partial payment.
        ],

        # ============================================================
        # === Tourist / destination / travel ===
        # ============================================================
        [
            "2483121",  # It's a popular tourist destination.
            "3636399",  # What's your final destination?
            "4016456",  # How far is it to our destination?
            "299401",   # He got ready for departure.
            "275806",   # The heavy snow made them put off their departure.
            "4664525",  # We've been cleared for departure.
            "70418",    # What time does your plane depart?
            "5155360",  # I'm departing this evening.
            "400148",   # The group departed as soon as he arrived.
            "326178",   # The train's departure will be delayed.
        ],

        # ============================================================
        # === Aviation / commercial flying ===
        # ============================================================
        [
            "2359093",  # I've been flying commercial jets for 13 years.
            "3728074",  # I chartered a jet.
            "2734388",  # Don't exceed the speed limit.
            "2954532",  # You've exceeded your authority.
            "2954941",  # You're exceeding your authority.
        ],

        # ============================================================
        # === Brochures / pamphlets ===
        # ============================================================
        [
            "3160467",  # May I have another brochure?
            "271507",   # Let's get some brochures from the travel bureau.
        ],

        # ============================================================
        # === Calm / chill / casual register ===
        # ============================================================
        [
            "2951593",  # Chill out.
            "3731912",  # Would you chill out?
            "1832117",  # Proceed with caution.
            "2246050",  # I recommend caution.
            "2247436",  # I urge caution.
            "2549401",  # Breathe normally.
            "2249397",  # Just breathe normally.
        ],

        # ============================================================
        # === Loosen / chill / relax (varied) ===
        # ============================================================
        [
            "1845492",  # Loosen up.
            "2249569",  # Loosen your tie.
            "2245302",  # Don't be hasty.
            "2007779",  # Let's not be hasty.
            "1359485",  # That's the last straw.
        ],

        # ============================================================
        # === Polish / shoes / appearance ===
        # ============================================================
        [
            "309366",   # Her car has a nice polish.
            "35680",    # You should polish your shoes before you go to the party.
            "3820864",  # I polished my shoes.
            "3079086",  # I had my shoes polished.
            "5850577",  # Mary seldom uses nail polish.
        ],

        # ============================================================
        # === Glowing / appearance / compliments ===
        # ============================================================
        [
            "2218330",  # You're positively glowing.
            "2249584",  # Mary is glowing.
            {"text": "Something must be going right.", "added_for": "right|going", "reason": "natural follow-up"},
            "3737630",  # Mary is extraordinarily pretty.
            "3736644",  # It was extraordinarily difficult.
        ],

        # ============================================================
        # === Splendid / magnificent / admiration ===
        # ============================================================
        [
            "42723",    # That's a splendid idea.
            "2954465",  # You did a splendid job.
            "325446",   # It's magnificent.
            "36055",    # This scenery is magnificent.
            "2954648",  # You never cease to impress me.
        ],

        # ============================================================
        # === Renewed / contract / professional ===
        # ============================================================
        [
            "6003787",  # My contract probably won't be renewed.
            {"text": "What's the reason?", "added_for": "reason", "reason": "natural follow-up Q"},
            {"text": "Budget cuts, apparently.", "added_for": "budget|apparently", "reason": "professional reply"},
            "3142792",  # It's a questionable policy.
            "1989669",  # It's confidential.
            "2248811",  # It was confidential.
            "4980195",  # I was sworn to secrecy.
        ],

        # ============================================================
        # === Flexibility / accommodation / negotiation ===
        # ============================================================
        [
            "5536715",  # We don't have much flexibility.
            "2953826",  # We'd be happy to accommodate you.
            "3824334",  # The changes have been gradual.
            "4530702",  # I'm contemplating this option.
            "317419",   # She is contemplating a trip.
            "4500310",  # We intend to persist.
        ],

        # ============================================================
        # === Bullets / unwanted / spam ===
        # ============================================================
        [
            "1538694",  # I keep receiving unwanted emails.
            "4499683",  # Someone deleted my comment.
            "3824902",  # I accidentally deleted everything.
            "681423",   # I have to delete many files from my computer.
            "953384",   # I can't figure out how to delete what I just posted.
            "2662781",  # I'm having a problem deleting one of my files.
            "4500722",  # Click here to log in.
        ],

        # ============================================================
        # === Computers / disks / files ===
        # ============================================================
        [
            "3178626",  # It's probably a virus.
            "3818792",  # It's not a virus.
            "2941435",  # The hard disk was completely destroyed.
            "953175",   # Did you give a copy of the disk to anyone?
        ],

        # ============================================================
        # === Maps / unfold / direction ===
        # ============================================================
        [
            "963350",   # Let's unfold the map on the table and discuss it.
            "2909062",  # I teach geography.
            "259416",   # I like geography and history.
            "2389840",  # I own 30 acres of land about 3 miles out of town.
            "259309",   # I bought an eight-acre farm for my retirement.
        ],

        # ============================================================
        # === Ancestors / history / generations ===
        # ============================================================
        [
            "744529",   # I can trace my ancestors back 200 years.
            "248821",   # We must learn to live in harmony with nature.
            "2294789",  # This is a triangle.
            "1454067",  # A leap year has three hundred and sixty-six days.
            "2483429",  # Except for leap years, February has only 28 days.
        ],

        # ============================================================
        # === Eagle / wildlife / nature ===
        # ============================================================
        [
            "5827341",  # The eagle flew away.
            "5688287",  # There's an alley behind my house.
            "60323",    # This is a dead-end alley.
            "3417552",  # My car is parked in the alley.
            "290638",   # He jumped over the hedge.
            "5938987",  # I'm watering the lawn.
            "3022192",  # When did you seed the lawn?
            "310901",   # She hurried across the lawn.
            "29625",    # I didn't know apple trees grow from seeds.
        ],

        # ============================================================
        # === Misc small clusters ===
        # ============================================================
        [
            "265900",   # Hold on to the rail.
            "60705",    # Hold this ladder steady.
            "2538416",  # I wonder if they have a rope ladder.
            "299702",   # He hung his coat on a hook.
            "321125",   # Hang your hat on the hook.
            "294974",   # He balanced himself on a log.
            "1062338",  # It's a vicious circle.
        ],

        # ============================================================
        # === Money / debt / repayment ===
        # ============================================================
        [
            "18564",    # It's money down the drain.
            "1390605",  # I must repay my debts.
            "258421",   # I must repay the debt.
            "4368156",  # Debts must be repaid.
            "258342",   # I have a lot of money at my disposal.
            "5293170",  # We offer free shipping.
            "22213",    # I work for a shipping company.
        ],

        # ============================================================
        # === Maid / household help ===
        # ============================================================
        [
            "476463",   # He has a maid.
            "4798964",  # The maid will clean the guest room.
            "3735586",  # I'm the gardener.
            "268581",   # I had the gardener plant some trees.
            "3150791",  # I bought that from a street vendor.
        ],

        # ============================================================
        # === Misc questions / hooks ===
        # ============================================================
        [
            "2006437",  # It looks like you've hooked a big one.
            "2046903",  # Can you squeeze me into your busy schedule?
            {"text": "I'll try my best.", "added_for": "best|try", "reason": "polite reply"},
            "410513",   # She tried to squeeze the juice from the orange.
            "2243326",  # They squeezed together.
        ],

        # ============================================================
        # === Stake / reputation / risk ===
        # ============================================================
        [
            "3831266",  # My reputation is at stake.
            "2542471",  # I'm aware of what is at stake.
        ],
        [
            "2528234",  # I have the ace of clubs.
            "2267002",  # I have the ace of hearts.
            "2528238",  # I have the ace of diamonds.
            "5850597",  # I had four aces.
        ],

        # ============================================================
        # === Vanish / disappear / mystery ===
        # ============================================================
        [
            "2111354",  # They vanished.
            "2203878",  # Who vanished?
            {"text": "We're not sure.", "added_for": "sure", "reason": "honest reply"},
            "2240993",  # We're historians.
            "4011729",  # What kind of historian are you?
            "4846759",  # Countless lives have been lost.
        ],

        # ============================================================
        # === Encouragement / discouragement ===
        # ============================================================
        [
            "3727912",  # I don't want to discourage you from doing that.
            "3341855",  # My parents discouraged me from traveling alone.
            "1426484",  # Don't be discouraged just because you're not all that talented.
        ],

        # ============================================================
        # === Boredom / curiosity ===
        # ============================================================
        [
            "4494206",  # Boredom is a huge problem.
            "2042768",  # I really do want to devote some more time to studying French.
            "293739",   # He devoted his life to his study.
            "887067",   # She devoted herself to him.
            "4498456",  # Experimentation can be good.
        ],

        # ============================================================
        # === Truth / fake / authenticity ===
        # ============================================================
        [
            "2111296",  # They're fake.
            "4826252",  # It's obviously fake.
            "4015979",  # Perhaps it's a fake.
            "4494722",  # The message was fake.
            "2566220",  # This diamond is fake.
            "3162950",  # That's a fake beard, isn't it?
            "4013572",  # It's barely recognizable.
        ],
        [
            "2249127",  # It's not predictable.
            "3821410",  # You're predictable.
            "2713424",  # It's not that noticeable.
            "325629",   # There are noticeable differences between the two.
        ],

        # ============================================================
        # === Coal cellar / attic / old houses ===
        # ============================================================
        [
            "3316606",  # We don't use our coal cellar anymore.
            "5102449",  # We went back down into the cellar.
            "2362168",  # I just finished cleaning the attic.
            "2291864",  # I always wondered what was in your attic.
            "2674223",  # Who knows what we'll find up in the attic?
            "4059009",  # I think we have some mice in the attic.
        ],

        # ============================================================
        # === Light bulbs / lighting ===
        # ============================================================
        [
            "573742",   # The bulb has burned out.
            "2259727",  # Three bulbs have burned out.
            "1950174",  # These light bulbs can't all be bad.
            "4015923",  # Why is that light flashing?
            "4135029",  # Why's the yellow light flashing?
            "2649718",  # Did you see that flash of lightning?
            "4014755",  # Did you flash your lights?
            "4482379",  # There were some burned-out structures along the road.
        ],

        # ============================================================
        # === Whichever / choice ===
        # ============================================================
        [
            "37985",    # Take whichever you like.
            "37995",    # You can choose whichever color you like.
        ],

        # ============================================================
        # === Closing reflective arc (Christmas / merry / family) ===
        # ============================================================
        [
            "1723",     # Merry Christmas!
            "62819",    # I wish you a Merry Christmas.
            {"text": "Same to you and your family.", "added_for": "same|family", "reason": "warm holiday reply"},
        ],
    ],
}
