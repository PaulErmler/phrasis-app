"""Curation plan for OGTE Level 18 — Mid Near-Native (~883 sentences).

At L18 learners are operating in mid near-native register: highly nuanced
opinion, sarcasm and irony, advanced idioms (red herring, dime a dozen,
err on the side of caution), complex hypotheticals, rhetorical phrasing,
professional and literary registers (testify, acquitted, adjourned,
contingency, pervasive), and culturally fluent vocabulary (downtown,
Halloween, Valentine's, sushi, salsa, scuba). Arcs lean conversational
with Q/A pairs, tight thematic clusters, and broad vocabulary inside
each arc to avoid drill repetition.

Curation philosophy (L18-specific):
  - Idioms and proverbs are rich at L18 and mostly kept — only the most
    dated/obscure are pruned ("As you sow, so will you reap" — kept;
    "He that will steal an egg will steal an ox" — dropped).
  - Long sentences with embedded clauses are valuable at this level.
  - Niche vocabulary (cocaine, grenade, sabotage, arson, parole) is the
    *point* of L18 — kept unless context-less and tonally menacing.
  - Cultural register (Halloween, Valentine's, sushi, tequila) kept;
    US-only proper nouns (Harvard, Boston as the only example) thinned
    to a handful.
  - Mild dark themes (homicide, burglary, traitor) fine in moderation;
    only the gore-heavy/glorifying-violence outliers dropped.
  - Drill patterns (allergic-to-X x6, unexpected-X x10, homework x25)
    thinned to keep vocab breadth without 4+ consecutive content-word
    repeats.
  - Removed: overtly sexist generalizations, near-exact duplicates,
    dated-tech brands, drill overflow.
"""

from __future__ import annotations


L18_PLAN = {
    "removals": [
        # ---- Exact / near-duplicate clutter ----
        {"id": "3735161", "reason": "'I'm heading downtown.' — near-exact duplicate of 3735160 'I'm headed downtown.'"},
        {"id": "903715", "reason": "'There is an urgent need for volunteers.' — duplicate of 2712749 with contraction."},
        {"id": "3719079", "reason": "'There's yogurt in the refrigerator.' — duplicate of 3719078 'There is yogurt in the fridge.'"},
        {"id": "2034584", "reason": "'Many inmates on death row say they don't want to die.' — paired-negation duplicate of 2031972."},
        {"id": "3328542", "reason": "'Can I have your autograph?' — duplicate of 3328193 'Can I get your autograph?'"},
        {"id": "4013553", "reason": "'It really is a good replica.' — duplicate of 3821197."},
        {"id": "4494114", "reason": "'That would be catastrophic.' — duplicate of 4494091 'This would be catastrophic.'"},
        {"id": "4665044", "reason": "'The contract expires next year.' — near-duplicate of 4665045 'The contract expired on Monday.'"},
        {"id": "5876335", "reason": "'The situation was dire.' — duplicate of 2209602 with past tense."},
        {"id": "2178965", "reason": "'I hate fluorescent lighting.' — near-duplicate of 2178964 'I hate fluorescent lights.'"},
        {"id": "2270358", "reason": "'Don't evade the question.' — near-duplicate of 2270357 'Don't evade the issue.'"},
        {"id": "2483477", "reason": "'It's only a placebo.' — near-duplicate of 1453226 'It's just a placebo.'"},
        {"id": "2202546", "reason": "'You're adorable.' — paired-duplicate of 2187195 'It's adorable.'"},
        {"id": "2203228", "reason": "'You're prudent.' — paired-duplicate of 2203227 'We're prudent.'"},
        {"id": "2203277", "reason": "'You're resilient.' — paired-duplicate of 2203276 'We're resilient.'"},
        {"id": "2647740", "reason": "'You were in a coma.' — paired-duplicate of 5853274 'I was in a coma.'"},
        {"id": "5916159", "reason": "'You're being hypocritical.' — duplicate of 4404437 'You're all hypocritical.'"},
        {"id": "1682656", "reason": "'You're completely delusional.' — duplicate of 2317568 with intensifier."},
        {"id": "2255268", "reason": "'You were incompetent.' — past-tense duplicate of 3436774."},
        {"id": "3038964", "reason": "'That's very ingenious.' — duplicate of 2111426 with intensifier."},
        {"id": "5891320", "reason": "'I'm cautiously optimistic.' — duplicate of 4494027 'We're cautiously optimistic.'"},
        {"id": "5064144", "reason": "'It's not very durable.' — paired-negation duplicate of 4502000."},
        {"id": "5395410", "reason": "'It wasn't a burglary.' — paired-negation duplicate of 4627179."},
        {"id": "2883969", "reason": "'That's something of an understatement.' — near-duplicate of 2251057."},
        {"id": "5009612", "reason": "'We know it's a hassle.' — duplicate of 5000883 'It was a big hassle.'"},
        {"id": "2546284", "reason": "'We're all out of booze.' — duplicate of 2220861 'You're out of booze.'"},
        {"id": "270937", "reason": "'A water molecule has two hydrogen atoms…' — near-duplicate of 681505 'A molecule is made up of atoms.'"},
        {"id": "1073457", "reason": "'Dinosaurs became extinct a very long time ago.' — near-duplicate of 19145."},
        {"id": "3059399", "reason": "'I got some shampoo in my eyes and it burns.' — duplicate of 3059400 (hurts/burns)."},

        # ---- Drill overflow (within head-word clusters) ----
        # 'downtown' drill — keep most, drop only US-Boston pile-ups
        {"id": "3148279", "reason": "'We have an office located in downtown Boston.' — downtown + Boston pile-up overflow."},
        {"id": "4716089", "reason": "'It's expensive to rent an office in downtown Boston.' — downtown + Boston overflow."},
        # 'volunteer/volunteers' drill — very dense, keep core, drop overflow
        {"id": "2531343", "reason": "'I'm happy you volunteered to help.' — paired-duplicate of 2531342 (grateful/happy)."},
        {"id": "2111583", "reason": "'Nobody's volunteering.' — abstract context-less volunteer drill."},
        # 'homework' drill — 25 sentences, thin heavily
        {"id": "266719", "reason": "'Turn in your homework.' — homework drill overflow."},
        {"id": "2764188", "reason": "'I'm busy doing homework.' — homework drill overflow."},
        {"id": "306846", "reason": "'They are beginning their homework.' — homework drill overflow."},
        {"id": "254442", "reason": "'I was doing my homework then.' — homework drill overflow."},
        {"id": "256437", "reason": "'I heard some students complain about the homework.' — homework drill overflow."},
        {"id": "258540", "reason": "'I watch TV after I finish my homework.' — homework drill overflow."},
        {"id": "467993", "reason": "'My older brother finished his homework very quickly.' — homework drill overflow."},
        {"id": "258549", "reason": "'It took me three hours to do my homework.' — homework drill overflow."},
        {"id": "856805", "reason": "'She helped her younger brother with his homework.' — homework drill overflow."},
        # 'unexpected' drill — 12 sentences, thin
        {"id": "4498430", "reason": "'Nothing unexpected happened.' — unexpected drill overflow."},
        {"id": "4498427", "reason": "'The unexpected always happens.' — unexpected drill overflow."},
        {"id": "4529398", "reason": "'There were some unexpected answers.' — paired-duplicate of 4529310."},
        # 'allergic' drill — 8 sentences, thin
        {"id": "4428228", "reason": "'I'm allergic to corn.' — allergic drill overflow."},
        # 'motorcycle' drill — kept
        # 'underestimate' drill — 5 sentences, thin
        {"id": "529650", "reason": "'Don't underestimate your opponent.' — duplicate of 1542461 'opponents'."},
        # 'optimistic' drill — 7 sentences, kept (used in first arc)
        # 'mall' drill — keep core
        {"id": "2048404", "reason": "'I have a part-time job working as a Santa at the mall.' — niche mall + Santa overflow."},
        # 'stew' drill — kept (vocab differs per sentence)
        # 'spaghetti' drill — kept
        # 'gasoline' drill — 4 sentences, thin
        {"id": "63714", "reason": "'Gasoline is used for fuel.' — factoid drill overflow."},
        # 'fingerprints' drill — keep one
        {"id": "238318", "reason": "'The police compared the fingerprints on the gun…' — fingerprints drill overflow."},
        # 'cavity/cavities' overlap
        {"id": "277679", "reason": "'I don't have any cavities.' — duplicate framing of 4976786 'I've never had a cavity.'"},
        # 'sirens' drill — keep two
        {"id": "5189337", "reason": "'I'm used to hearing sirens.' — sirens drill overflow."},
        # 'expire/expired/expires' — keep all (vocab differs)
        # 'pony/ponies' overlap
        {"id": "5840433", "reason": "'I like ponies.' — duplicate of 1950657/3236212 pony cluster."},

        # ---- Dated brands / pop-culture / tech ----
        # (L18 has Facebook-free input — none found.)

        # ---- Overtly sexist / appearance-comparing women ----
        {"id": "5472121", "reason": "'Mary doesn't wear as much makeup as Alice.' — women-comparing-cosmetics framing."},
        {"id": "5053200", "reason": "'Mary wears too much makeup.' — judgmental comment about woman's makeup."},
        {"id": "312770", "reason": "'She wears a lot of makeup.' — appearance-judging."},
        {"id": "2993324", "reason": "'Mary never leaves her house without first putting on makeup.' — appearance-judging woman."},
        {"id": "2737249", "reason": "'Mary was wearing a bikini that last time I saw her.' — appraising woman's body."},
        {"id": "916084", "reason": "'Even without makeup, she's very cute.' — backhanded appearance comment."},
        {"id": "887119", "reason": "'She forced him to eat spinach.' — gendered shrew trope."},
        {"id": "55586", "reason": "'This is a great time-saving gadget for the housewife.' — sexist 1950s register."},
        {"id": "2661991", "reason": "'She's a stubborn woman.' — gendered judgment."},

        # ---- Niche US-centric proper nouns (thin) ----
        {"id": "6440368", "reason": "'Boston is my hometown.' — Boston overflow."},
        {"id": "5821529", "reason": "'I can drive to Boston and back on one tank of gasoline.' — Boston + gasoline pile-up."},
        {"id": "62873", "reason": "'The Grand Canyon is one of the most popular places in the USA.' — US-tourism factoid."},
        {"id": "4310529", "reason": "'Sixty-nine percent of adult Americans are overweight.' — US-specific factoid."},
        {"id": "73280", "reason": "'In 1964, Rev. King won the Nobel Peace Prize.' — niche US history; respectful but odd standalone."},
        {"id": "1497180", "reason": "'On February 14th, Americans celebrate Valentine's Day.' — US-specific factoid duplicate of 4913160."},
        {"id": "4499705", "reason": "'I'm a freshman at Harvard.' — Harvard overflow."},

        # ---- Tonally menacing / context-less imperatives ----
        {"id": "5440627", "reason": "'Don't waste ammunition.' — military menacing register."},
        {"id": "2249854", "reason": "'Save your ammunition.' — menacing imperative."},
        {"id": "3735934", "reason": "'Hand over your firearms.' — menacing imperative."},
        {"id": "1117802", "reason": "'I have a grenade.' — menacing context-less."},
        {"id": "2111957", "reason": "'Be ruthless.' — menacing imperative."},
        {"id": "1954267", "reason": "'Cuff him.' — police-procedural fragment."},

        # ---- Gore-heavy / war-glorifying / disaster overflow ----
        {"id": "4494503", "reason": "'It was a huge massacre.' — gore-heavy."},
        {"id": "3822762", "reason": "'It was a massacre.' — gore-heavy."},
        {"id": "2030064", "reason": "'The enemy wanted to discuss a truce with us.' — war framing standalone."},

        # ---- Niche pseudo-science / weak factoids ----
        {"id": "63038", "reason": "'Whales can remain submerged for a long time.' — odd factoid."},
        {"id": "2860606", "reason": "'Mandarin oranges have a lot of vitamin C.' — niche factoid."},
        {"id": "4744164", "reason": "'Bananas are a good source of potassium.' — factoid drill."},
        {"id": "4256637", "reason": "'Halloween was originally a Celtic festival.' — niche factoid (keep cultural ones)."},
        {"id": "3393700", "reason": "'Yoga comes from India.' — factoid drill."},

        # ---- Obscure proverbs / dated idiom phrasing ----
        {"id": "2113274", "reason": "'He that will steal an egg will steal an ox.' — archaic proverb."},
        {"id": "266082", "reason": "'As you sow, so will you reap.' — dated proverb register."},
        {"id": "459245", "reason": "'Too many cooks spoil the broth.' — dated proverb (keep richer idioms)."},

        # ---- Vague accusatory / context-less labels ----
        {"id": "2218062", "reason": "'You're all racists.' — vague accusatory."},
        {"id": "2244961", "reason": "'Are you psychotic?' — accusatory label."},
        {"id": "2218035", "reason": "'You're a psycho.' — accusatory label."},
        {"id": "2317568", "reason": "'You're delusional.' — accusatory label."},
        {"id": "3436774", "reason": "'You're incompetent.' — accusatory label."},
        {"id": "2203125", "reason": "'You're obscene.' — paired-accusatory."},
        {"id": "2218007", "reason": "'You're a babe.' — pickup-line register."},
        {"id": "2280376", "reason": "'Mary is a babe.' — appraising woman."},
        {"id": "2713694", "reason": "'You're such a brat.' — accusatory."},
        {"id": "3821860", "reason": "'You're obese.' — fat-shaming accusatory."},
        {"id": "3330257", "reason": "'I'm obese.' — paired with 3821860; awkward register."},
        {"id": "2218085", "reason": "'You're arguing semantics.' — dismissive accusatory."},
        {"id": "2275170", "reason": "'Don't be a stubborn fool.' — name-calling imperative."},
        {"id": "2960843", "reason": "'Don't be so petty.' — accusatory."},
        {"id": "5916303", "reason": "'You certainly are clumsy.' — accusatory."},
        {"id": "4404437", "reason": "'You're all hypocritical.' — accusatory."},
        {"id": "2549181", "reason": "'You're a lunatic.' — name-calling label."},

        # ---- Anachronistic / fantasy register ----
        {"id": "2262754", "reason": "'The cavalry has arrived.' — anachronistic register (keep idiomatic-only)."},

        # ---- Misc tonal mismatch / awkward in isolation ----
        {"id": "1107540", "reason": "'You can't teach a crab how to walk straight.' — obscure metaphor."},
        {"id": "3501301", "reason": "'If life deals you lemons, make lemonade.' — cliche proverb."},
        {"id": "1040737", "reason": "'A leopard can't change his spots.' — proverb duplicate."},
        {"id": "2218325", "reason": "'You're our savior.' — exaggerated label."},
        {"id": "5852011", "reason": "'I'm not a fascist.' — politically charged label."},
        {"id": "5852585", "reason": "'I'm not petty.' — paired-negation of 2960843."},
        {"id": "5839998", "reason": "'I'm grieving.' — heavy context-less."},
        {"id": "2546248", "reason": "'You'll catch pneumonia.' — old-fashioned warning."},
        {"id": "5839956", "reason": "'I'm a cowboy.' — niche identity standalone."},
        {"id": "5859390", "reason": "'I'm a limo driver.' — niche identity standalone."},
        {"id": "5858273", "reason": "'I'm a physicist.' — niche identity (keep the second framing)."},
        {"id": "464693", "reason": "'Bob became a pastor.' — niche role."},
        {"id": "5851574", "reason": "'I was deported.' — heavy context-less."},
        {"id": "3374191", "reason": "'I got expelled.' — heavy context-less; keep the longer expelled."},
        {"id": "3635866", "reason": "'I'm on parole.' — heavy context-less."},
        {"id": "1198879", "reason": "'I enlisted in the Air Force.' — niche military identity."},

        # ---- Math/science factoid noise ----
        {"id": "323053", "reason": "'There will be a lunar eclipse tomorrow.' — duplicate framing of 4493791 (solar eclipse)."},
        {"id": "4662882", "reason": "'Caffeine can temporarily increase your blood pressure.' — wordy factoid."},
        {"id": "5837534", "reason": "'How much caffeine is fatal?' — odd morbid factoid."},
        {"id": "807658", "reason": "'Petroleum has been important since ancient times.' — encyclopedia register."},
        {"id": "59613", "reason": "'This metal is called zinc.' — encyclopedia register."},

        # ---- Heavy / niche overflow ----
        {"id": "4501093", "reason": "'Volunteers are desperately needed.' — volunteer overflow + heavy 'desperately'."},

        # ---- Closing tonal cleanup ----
        {"id": "3823673", "reason": "'They say to err is human.' — duplicate framing of 20868."},
        {"id": "21262", "reason": "'The optimist looks into a mirror…' — obscure proverb."},
        {"id": "2846015", "reason": "'Optimists see opportunities in disasters…' — proverb overflow."},
        {"id": "73599", "reason": "'A stitch in time saves nine is a proverb.' — meta-proverb."},
        {"id": "325347", "reason": "'A barber is a man who shaves and cuts men's hair.' — dictionary-definition register."},
        {"id": "50030", "reason": "'The hijacker demanded a ransom of two million dollars.' — heavy context-less."},
        {"id": "4496092", "reason": "'All the buildings on this block will be demolished.' — duplicate framing of 6093565."},
    ],
    "arcs": [
        # ===========================================================
        # === FIRST ARCS (3 hand-picked highest-quality openers) ===
        # ===========================================================

        # FIRST #1: Casual greeting → small talk → plan — natural L18 opener
        {
            "position": "first",
            "items": [
                "1806291",  # What's up, dude?
                {"text": "Not much — just running a few errands.", "added_for": "errands", "reason": "natural casual answer pulling in errands vocab"},
                "2358707",  # I have a few errands.
                "2359565",  # I've got a couple errands to run.
                {"text": "Want some company?", "added_for": "company", "reason": "warm follow-up offer"},
                "3735160",  # I'm headed downtown.
                "4016144",  # What's the fastest way to get downtown?
                {"text": "Take the back streets.", "added_for": "streets", "reason": "natural answer to fastest-way Q"},
            ],
        },

        # FIRST #2: Optimism / outlook — flagship L18 nuanced opinion register
        {
            "position": "first",
            "items": [
                "4999932",  # I'm fairly optimistic.
                "4494027",  # We're cautiously optimistic.
                "2283686",  # You don't sound very optimistic.
                {"text": "I'm trying to stay positive.", "added_for": "positive", "reason": "natural reply softening pessimism"},
                "1193323",  # Nobody feels optimistic today.
                "3227114",  # I wish I could be more optimistic about what's going to happen.
                "4999689",  # I'm neither optimistic nor pessimistic.
                "4530075",  # I admire your optimism.
                "2276203",  # I don't share your optimism.
                "5092317",  # There's reason for optimism.
            ],
        },

        # FIRST #3: Idioms + hypotheticals — high-register L18 wordplay
        {
            "position": "first",
            "items": [
                "1365853",  # They're a dime a dozen.
                "5315686",  # If I had a dime for every time I heard that, I'd be rich.
                {"text": "Trust me, I've heard it all.", "added_for": "trust", "reason": "natural follow-up to dime-for-every-time"},
                "982672",   # Better to err on the side of caution.
                "20868",    # To err is human, to forgive divine.
                "3170719",  # It's a red herring.
                {"text": "Don't get distracted by it.", "added_for": "distracted", "reason": "natural warning paired with red-herring idiom"},
            ],
        },

        # ===========================================================
        # === Downtown / mall / shopping (rest of cluster) ===
        # ===========================================================
        [
            "5502433",  # There's a fire downtown.
            "259853",   # I often go downtown on Sunday.
            "4497542",  # Do you have a map of the downtown area?
            "5123835",  # I'm not in the mood to go downtown.
            "41101",    # There are many hotels downtown.
        ],
        [
            "59634",    # Is there a mall near here?
            "27271",    # Where's the nearest shopping mall?
            "3023987",  # There's a mini mall on Park Street.
            {"text": "It's just a few blocks away.", "added_for": "blocks", "reason": "break mall-repetition with directions"},
            "3469911",  # I went to the mall with my friends.
            "52853",    # Is there a bus that goes to the mall?
            "4538661",  # I rarely go to the mall, but I went yesterday.
        ],
        [
            "5163823",  # The new shopping mall that opened last week closes at midnight every night.
            "4500739",  # We walked through the mall, looking for a shoe store.
            "1418611",  # The mall is deserted.
        ],

        # ===========================================================
        # === Volunteers / community ===
        # ===========================================================
        [
            "2111593",  # Nobody volunteers.
            "4502769",  # Volunteers are always welcome.
            "4498858",  # Volunteers get a T-shirt.
            "2717564",  # So far, we only have three volunteers.
            "4663401",  # Volunteers are cleaning up the park today.
            "5591212",  # We have a good group of volunteers.
            "2712749",  # There's an urgent need for volunteers.
        ],
        [
            "2531347",  # No one wants to volunteer.
            "2531350",  # I was hoping you'd volunteer.
            "1936300",  # I'd like to volunteer my services.
            {"text": "What would you like me to do?", "added_for": "do", "reason": "natural follow-up to volunteering"},
            "2530648",  # Would you be willing to volunteer at the animal shelter two or three days a week?
            "5189088",  # I used to volunteer at the local soup kitchen.
            "2531342",  # I'm grateful you volunteered to help.
            "2203880",  # Who's volunteering?
            "2250088",  # Thanks for volunteering.
            "2111584",  # Nobody's volunteered.
        ],

        # ===========================================================
        # === Halloween / costume / vampire (cultural cluster) ===
        # ===========================================================
        [
            "5478477",  # Halloween is still weeks away.
            "1894511",  # I'm looking forward to your Halloween party.
            "5701013",  # I can't wait to see your Halloween costume.
            {"text": "What are you going as?", "added_for": "going", "reason": "natural Q about costume"},
            "5614651",  # I dressed up as a vampire for Halloween.
            "5615904",  # I went to the Halloween party as a vampire.
            "1977271",  # He wore a pirate costume for Halloween.
            "4903126",  # Are vampires real?
            {"text": "Only in the movies.", "added_for": "movies", "reason": "natural answer to 'are vampires real'"},
            "2331605",  # I had a nightmare about vampires.
        ],

        # ===========================================================
        # === Valentine's Day / romance ===
        # ===========================================================
        [
            "2718492",  # February 14th is Valentine's Day.
            "4890522",  # Valentine's Day is coming up.
            "4913160",  # Valentine's Day is celebrated all around the world.
            "2208682",  # I hate being alone on Valentine's Day.
            {"text": "It's just another day.", "added_for": "another", "reason": "warm consolation reply"},
            "5158728",  # I sent Mary flowers on Valentine's Day.
            "5105684",  # They kissed each other goodnight.
            "2706406",  # Can I get a goodnight kiss?
        ],

        # ===========================================================
        # === Tattoo / body art ===
        # ===========================================================
        [
            "3735295",  # Show me your tattoo.
            "953196",   # Do you have any tattoos?
            "3826522",  # I'm a tattoo artist.
            "3506855",  # Don't you regret getting that tattoo?
            "2916643",  # I had to get my tattoo removed.
            "3383085",  # What's the worst tattoo you've ever seen?
            {"text": "You don't want to know.", "added_for": "know", "reason": "natural cagey answer"},
        ],

        # ===========================================================
        # === Hairstyle / haircut / appearance ===
        # ===========================================================
        [
            "2793987",  # I changed my hairstyle.
            "2359842",  # I've had this same hairstyle for years.
            "3255564",  # Mom, that hairstyle makes you look old.
            {"text": "Watch your tone.", "added_for": "tone", "reason": "natural retort to a rude remark"},
            "1167589",  # He gets a haircut once a month.
            "318212",   # I got a shave and a haircut.
            "287337",   # I couldn't help laughing at his haircut.
            "325416",   # Frankly speaking, I don't like your haircut.
            "2645220",  # We have the same barber.
        ],

        # ===========================================================
        # === Homework — part 1 (split to break content-word repeat) ===
        # ===========================================================
        [
            "253877",   # I'm finishing my homework.
            "251195",   # My homework is nearly complete.
            "4960770",  # Have you completed your homework?
            {"text": "Just about — give me a minute.", "added_for": "minute", "reason": "break repetition, natural follow-up"},
            "258555",   # I was unable to finish my homework.
            "69649",    # Have you finished your English homework yet?
            "1259418",  # She began doing her homework immediately after dinner.
        ],
        [
            "321569",   # I offered to help her with her homework.
            "662140",   # Thank you for helping me with my homework.
            "259579",   # I promised to help my brother with his homework.
            {"text": "That was kind of you.", "added_for": "kind", "reason": "warm reply"},
            "5853039",  # This is definitely more fun than doing homework.
            "2335899",  # I was planning to do my homework, but I fell asleep.
            "45975",    # The math homework proved to be easier than I had expected.
        ],
        [
            "5224384",  # I bet I'm not the only one who didn't do his homework.
            "953501",   # I knew I shouldn't have put off doing my homework until the last minute.
            "2042918",  # I figured you wouldn't want the teacher to know you hadn't done your homework yet.
            {"text": "I'll be ready by morning, I promise.", "added_for": "morning", "reason": "natural reassurance"},
            "2199778",  # My friend copied my homework and the teacher found out.
            "3823756",  # Don't copy other students' homework.
        ],
        [
            "954381",   # There have been a lot of complaints from students about the amount of homework that Mr. Jackson gives.
            "2288179",  # You keep forgetting to do your homework.
            "1098697",  # Did you do yesterday's homework?
            {"text": "It slipped my mind.", "added_for": "slipped", "reason": "natural excuse"},
            "252980",   # I'm too sleepy to do my homework.
            "3256696",  # Our teacher reminded us not to forget our homework.
        ],
        [
            "317311",   # She is accustomed to doing her homework before dinner.
            "1152823",  # I watched baseball on TV after I finished my homework.
        ],

        # ===========================================================
        # === Allergies / food sensitivity ===
        # ===========================================================
        [
            "4499606",  # I'm allergic to cigarette smoke.
            "250229",   # My nephew is allergic to eggs.
            "4442305",  # Are you allergic to anything else?
            {"text": "Just shellfish, I think.", "added_for": "shellfish", "reason": "natural answer to 'anything else'"},
            "3820727",  # I think I'm allergic to that soap.
            "2546036",  # I'm allergic to carrots.
            "887014",   # She bought him a dog. However, he was allergic to dogs, so they had to give it away.
        ],
        [
            "32221",    # I have an allergy to milk.
            "953073",   # A lot of people are dealing with allergies now.
            "2596564",  # When you have food allergies, eating out is difficult, isn't it?
            {"text": "It really limits where I can go.", "added_for": "limits", "reason": "natural commiseration"},
            "2540893",  # I'm severely allergic to peanuts.
            "2951989",  # I didn't realize you were allergic to peanuts.
        ],

        # ===========================================================
        # === Suspended / expelled / probation (school discipline) ===
        # ===========================================================
        [
            "1895554",  # You've been suspended.
            "326511",   # The peace talks have been suspended for a while.
            "2329602",  # I got expelled from school during my senior year.
            "3821158",  # I got my license revoked.
            "4663916",  # I consider that racial discrimination.
        ],

        # ===========================================================
        # === Unexpected / surprise ===
        # ===========================================================
        [
            "2245487",  # Expect the unexpected.
            "2744090",  # I've learned to expect the unexpected.
            "1532831",  # Suddenly, something unexpected happened.
            "247406",   # We had unexpected visitors.
            "4013163",  # What an unexpected surprise!
            "4013704",  # What an unexpected pleasure!
            "3824311",  # We don't like unexpected guests.
            "4529310",  # There were some unexpected questions.
            "673952",   # We had no unexpected incidents during our trip.
        ],

        # ===========================================================
        # === Medication / medical (light) ===
        # ===========================================================
        [
            "436867",   # I need pain medication.
            "4494359",  # Medication is an option.
            "1928782",  # I have taken my medication.
            "3109715",  # Are you currently using any medication?
            "4194302",  # Medication and alcohol often don't mix.
            "5664804",  # I forgot my medications.
            "4013126",  # What medications are you taking?
            {"text": "Just an inhaler.", "added_for": "inhaler", "reason": "natural answer to medication Q"},
            "21839",    # You should buy some cough medicine and aspirin.
            "993131",   # Do you by any chance have some aspirin?
            "954182",   # My doctor told me to quit taking aspirin.
        ],

        # ===========================================================
        # === Flu / vaccine / illness ===
        # ===========================================================
        [
            "2549494",  # It's flu season.
            "3178598",  # It's probably the flu.
            "251744",   # My father is suffering from influenza.
            "2548939",  # We have a vaccine.
            "3264785",  # I understand a new vaccine is being tested.
            "5463377",  # I went to get vaccinated.
            "325461",   # I was vaccinated against the flu.
            "2548036",  # We have an epidemic.
            "4496889",  # The epidemic has been contained.
            "282473",   # Pneumonia causes difficulty in breathing.
            "244203",   # Germs can cause sickness.
        ],

        # ===========================================================
        # === Repeatedly / lying / honesty ===
        # ===========================================================
        [
            "3821198",  # You've lied to me repeatedly.
            {"text": "I had my reasons.", "added_for": "reasons", "reason": "natural defensive reply"},
            "5853166",  # I've asked you repeatedly not to sing so late at night.
            "5480904",  # Have the decency to keep quiet.
        ],

        # ===========================================================
        # === Witness / testify / oath (legal register) ===
        # ===========================================================
        [
            "2247202",  # You are under oath.
            "5840403",  # I may testify.
            "4497618",  # The victim didn't have to testify.
            "316320",   # She testified against him.
            "388438",   # She testified that she saw the man.
            "303980",   # He was acquitted.
            "5850062",  # I was acquitted.
            "4500335",  # The interrogation is over.
            "2872116",  # The police will release the victim's name after they have notified his next of kin.
            "4493581",  # The next of kin have been notified.
            "3821980",  # I haven't yet been notified.
            "4501227",  # The public was notified on October 20th.
            "4493664",  # We had no notification.
        ],

        # ===========================================================
        # === Crime: burglary / arson / sabotage / homicide ===
        # ===========================================================
        [
            "4627179",  # There's been a burglary.
            "400568",   # The police officer arrested the burglar.
            "238264",   # The police caught the burglar red-handed.
            "3316619",  # The police think the burglar entered through a basement window.
            "3826526",  # They think it was arson.
            "4530041",  # Arson is a criminal act.
            "4502469",  # Sabotage was suspected.
            "4879936",  # I'm a homicide detective.
            "3726153",  # I'm an undercover cop.
            "5109643",  # The police officer drew his revolver.
            "2641762",  # Your fingerprints were on the gun.
            {"text": "I can explain.", "added_for": "explain", "reason": "natural defensive reply to incriminating evidence"},
        ],

        # ===========================================================
        # === Siren / urgency / ambush ===
        # ===========================================================
        [
            "54161",    # The siren blew.
            "3825314",  # I heard a siren in the distance.
            "3821674",  # We could hear sirens outside.
            "4495699",  # We could hear sirens approaching.
            "1723682",  # It's an ambush!
            "4496321",  # They carry firearms.
            "4497927",  # I don't have a firearm.
            "3328175",  # Can you handle a firearm?
        ],

        # ===========================================================
        # === Traitors / loyalty / pact ===
        # ===========================================================
        [
            "761868",   # There's a traitor among us.
            "304632",   # He turned traitor.
            "2111234",  # They're traitors.
            "2648012",  # They were traitors.
            "2007814",  # Let's make a pact.
            {"text": "I'm in.", "added_for": "in", "reason": "natural agreement to pact"},
            "3737836",  # Why do you distrust me?
            {"text": "Past experience.", "added_for": "past", "reason": "natural curt reply"},
        ],

        # ===========================================================
        # === Underestimate / outnumbered / cautious ===
        # ===========================================================
        [
            "1461",     # Don't underestimate my power.
            "1542461",  # Don't underestimate your opponents.
            "4502716",  # Never underestimate your audience.
            "3620036",  # I underestimated you.
            "3737364",  # We underestimated the enemy.
            "4502717",  # You underestimate your charisma.
            "1615188",  # We were outnumbered.
            "2247501",  # I was outnumbered.
            "4501722",  # We must remain vigilant.
            "4665150",  # We'll continue to be vigilant.
        ],

        # ===========================================================
        # === Dire / catastrophic / volatile (high register) ===
        # ===========================================================
        [
            "2209602",  # The situation is dire.
            "4502174",  # It's a volatile situation.
            "4494091",  # This would be catastrophic.
            "4597222",  # These are turbulent times.
            "325206",   # We had a rough flight because of turbulence.
            "4502213",  # That sounds downright painful.
            "5006427",  # It's downright scary.
            "4846782",  # This place is downright creepy.
            {"text": "Let's get out of here.", "added_for": "out", "reason": "natural escape reply"},
        ],

        # ===========================================================
        # === Contingency / endeavor / fruitful (professional) ===
        # ===========================================================
        [
            "2539619",  # We're working on a contingency plan.
            "4497735",  # Do we have a contingency plan?
            {"text": "We're drafting one now.", "added_for": "drafting", "reason": "natural workplace answer"},
            "4493958",  # This is a worthwhile endeavor.
            "5168301",  # I wish you the best of luck in your next endeavor.
            "5611184",  # We've had very fruitful discussions.
            "1875763",  # Things escalated quickly.
            "2835707",  # We are adjourned until 2:30.
            "4501014",  # The meeting adjourned at 2:30 p.m.
        ],

        # ===========================================================
        # === Hypothetical / candid / persuasive ===
        # ===========================================================
        [
            "2892187",  # This is all hypothetical.
            "3396900",  # It was just a hypothetical question.
            "2007888",  # Let's be candid.
            "2013637",  # I'd like your candid opinion.
            {"text": "You may not like it.", "added_for": "like", "reason": "natural caveat reply"},
            "2203181",  # You're persuasive.
            "2546236",  # You're very persuasive.
            "2203227",  # We're prudent.
        ],

        # ===========================================================
        # === Idioms / similes / proverbs (advanced register) ===
        # ===========================================================
        [
            "1702321",  # We're up a creek without a paddle.
            "26773",    # We played golf in spite of the rain.
            "325263",   # In spite of the storm, he went out.
            "4772587",  # In spite of the bad weather, they decided to go by car.
            "327681",   # It's all right to drink, but drink in moderation.
            "4493772",  # Beer is not really so unhealthy, at least in moderation.
        ],

        # ===========================================================
        # === Bluff / deception / blatant ===
        # ===========================================================
        [
            "4016924",  # It's obviously a bluff.
            "1951380",  # We can't call their bluff.
            "3594055",  # That's a blatant lie.
            "4500621",  # This is a blatant lie.
            "4495260",  # It was deceptive.
            "887078",   # She didn't try to evade the truth.
            "2270357",  # Don't evade the issue.
            "1260892",  # I hate hypocrisy.
            "4984721",  # I'm sick of the hypocrisy.
        ],

        # ===========================================================
        # === Pessimism / pertinent / understatement ===
        # ===========================================================
        [
            "2249126",  # It's not pertinent.
            "4496982",  # Could you please summarize the pertinent points?
            "2251057",  # That's an understatement.
            "4502592",  # That kind of thinking is pervasive.
            "2187261",  # That's ludicrous.
            "4495709",  # What a ludicrous argument!
            "2111431",  # That's immoral.
            "2187214",  # It's immoral.
        ],

        # ===========================================================
        # === Insecurity / surreal / nostalgic ===
        # ===========================================================
        [
            "5012676",  # It was kind of surreal.
            "2546169",  # I was feeling nostalgic.
            "1451731",  # When I hear that song, I think about my hometown.
            "278055",   # I was kept waiting for an eternity.
            "1345",     # I've always wondered what it'd be like to have siblings.
            "2609453",  # I have no siblings.
        ],

        # ===========================================================
        # === Freak / freaking / freaked (emotional register) ===
        # ===========================================================
        [
            "2248000",  # I'm freaking out.
            "3348436",  # You're freaking me out.
            "2245782",  # I freaked out.
            "2645206",  # Weren't you freaked out?
            "2396303",  # Now don't freak out, OK?
            "4017391",  # It was a freak accident.
            "2240572",  # We're freaks.
        ],

        # ===========================================================
        # === Suspense / ominous / sly ===
        # ===========================================================
        [
            "5586514",  # Don't keep me in suspense.
            "2250921",  # That sounds ominous.
            "4502218",  # That sure sounds ominous.
            "3168289",  # Aren't you the sly one?
            "3724162",  # Let's take it down a notch.
        ],

        # ===========================================================
        # === Hectic / chaotic / busy ===
        # ===========================================================
        [
            "4015574",  # Things got a bit hectic.
            "5129443",  # We have a hectic week ahead of us.
            "5000883",  # It was a big hassle.
            {"text": "Tell me about it.", "added_for": "tell", "reason": "natural commiseration"},
        ],

        # ===========================================================
        # === Adorable / fabulous / charming ===
        # ===========================================================
        [
            "2187195",  # It's adorable.
            "2111297",  # They're fabulous.
            "2255046",  # You look radiant.
            "2202646",  # You're charismatic.
            "4104413",  # Your grandfather is very charismatic.
            "2203150",  # You're outgoing.
            "294729",   # He is outgoing.
        ],

        # ===========================================================
        # === Hilarious / glee / ecstatic ===
        # ===========================================================
        [
            "2713516",  # You guys are hilarious.
            "4494158",  # This picture is hilarious.
            "4494326",  # This story is hilarious.
            "4016662",  # Are you going to join the glee club?
            "4495214",  # We were ecstatic.
            "3826259",  # Let the festivities begin.
        ],

        # ===========================================================
        # === Lame / petty / clumsy / sloppy ===
        # ===========================================================
        [
            "2249343",  # It's totally lame.
            "2323302",  # I don't want to hear your lame excuses.
            "3678936",  # I'm clumsy.
            "2240783",  # We're getting sloppy.
            "5901343",  # You're behaving like a spoiled brat.
            "2327208",  # Your behavior was disgraceful.
            "4496835",  # Your conduct is disgraceful.
        ],

        # ===========================================================
        # === Rookie / mistake / scam ===
        # ===========================================================
        [
            "3562585",  # I'm a rookie.
            "2380397",  # I made a rookie mistake.
            "2718534",  # I should've known it was a scam.
            "6524435",  # I wonder whether or not this is some sort of scam.
            "6033417",  # I had a good mentor.
            {"text": "He taught me everything.", "added_for": "taught", "reason": "natural follow-up to mentor"},
        ],

        # ===========================================================
        # === Tuition / freshman / college dorm ===
        # ===========================================================
        [
            "2247889",  # I'm a freshman.
            "2713780",  # I'm a bachelor.
            "2762869",  # Are you a bachelor?
            "3185819",  # Who paid your tuition?
            "21517",    # They announced an increase in tuition fees.
            "1152401",  # My college has a dorm.
            "251410",   # My university has a dorm.
            "1199362",  # Have you gotten used to living in the dorm?
            "6126387",  # All freshmen have to study French.
            "6126092",  # All freshmen are required to study French.
        ],

        # ===========================================================
        # === Successor / promotion (workplace) ===
        # ===========================================================
        [
            "4538747",  # Your successor has already been chosen.
            {"text": "Who is it?", "added_for": "who", "reason": "natural Q about successor"},
            "4500544",  # We need competent leaders.
            "1318822",  # I think he's a competent person.
            "5191957",  # I'm an avid golfer.
        ],

        # ===========================================================
        # === Audition / artist / songwriter (creative) ===
        # ===========================================================
        [
            "2646600",  # How was your audition?
            {"text": "I think it went well.", "added_for": "well", "reason": "natural answer to audition Q"},
            "4740672",  # You have to audition to join the choir.
            "5858269",  # I'm a songwriter.
            "3251389",  # I'm a freelance journalist.
            "5933742",  # I'm reading a fascinating autobiography.
            "4099321",  # I'm also interested in Greek mythology.
            "4098157",  # I've always been interested in botany.
        ],

        # ===========================================================
        # === Tradition / festival / celebration ===
        # ===========================================================
        [
            "4495239",  # The feud is over.
            "4493791",  # There will be a total solar eclipse tomorrow.
            "3552568",  # Did you see the lunar eclipse yesterday?
            "5679179",  # Fir trees are often used as Christmas trees.
            "6555179",  # That's a fir tree.
        ],

        # ===========================================================
        # === Stubborn / ruthless / cunning ===
        # ===========================================================
        [
            "31971",    # Mary is too stubborn to apologize.
            "4999894",  # I'm a pretty stubborn guy.
            "2331690",  # I had no idea you were so ruthless.
            {"text": "I do what I have to.", "added_for": "have", "reason": "natural defensive reply"},
            "852277",   # He acted like a lunatic.
        ],

        # ===========================================================
        # === Slim chance / probable / odds ===
        # ===========================================================
        [
            "3150864",  # Are you still buying lottery tickets?
            "25322",    # If you were to win the lottery, what would you buy with the money?
            {"text": "I'd buy a house by the sea.", "added_for": "sea", "reason": "natural answer to lottery Q"},
            "316969",   # She won ten million yen in the lottery.
            "253696",   # I paid 2,000 yen for this atlas.
        ],

        # ===========================================================
        # === Sunset / scenic moments ===
        # ===========================================================
        [
            "2045763",  # The sunset is beautiful.
            "2771655",  # It'll soon be sunset.
            "63076",    # Lovely sunset, isn't it?
            "4570598",  # It got cold after sunset.
            "4529175",  # We arrived at the lake just before sunset.
            "249320",   # We admired the beautiful sunset.
        ],

        # ===========================================================
        # === Lemon / cinnamon / culinary moments ===
        # ===========================================================
        [
            "29490",    # A tea with lemon, please.
            "5938428",  # I squeezed the lemon.
            "435751",   # Lemons are sour.
            "60327",    # These lemons are fresh.
            "63732",    # Hot lemon with honey is a good remedy for colds.
            "2212234",  # Why don't you try putting a little cinnamon in your coffee?
            "53443",    # Could I have three cinnamon donuts?
        ],

        # ===========================================================
        # === Food: pork / beef / chicken / sushi / pizza ===
        # ===========================================================
        [
            "4013689",  # Is this beef or pork?
            "953999",   # Is eating pork a sin?
            "3735517",  # I should've cooked the pork longer.
            "3123922",  # Everyone here knows you don't eat pork.
            "4664876",  # How many pork chops did you buy?
            "64378",    # Let's have sushi.
            "954279",   # Some people eat sushi with their hands.
        ],
        [
            "2247448",  # I want tacos.
            "5389459",  # Those aren't tacos.
            "2498784",  # I had a peanut butter and jelly sandwich.
            "954160",   # Many children enjoy eating peanut butter sandwiches.
            "898560",   # Have you ever tried feeding your dog peanut butter?
            "2007226",  # Let's go find a place that serves Buffalo wings.
            "4135464",  # Which would you recommend, spaghetti or pizza?
            "2431542",  # I'm pretty good at cooking spaghetti.
            "680921",   # You have some spaghetti sauce on your face.
            {"text": "Oh, how embarrassing.", "added_for": "embarrassing", "reason": "natural reaction"},
        ],

        # ===========================================================
        # === Vegetarian / vegetables / fruit ===
        # ===========================================================
        [
            "644856",   # My wife is a vegetarian.
            "244210",   # Can you recommend any vegetarian dishes?
            "34018",    # I'm a vegetarian, so I'd rather not have meat, if that's okay.
            "953255",   # Even though my friend was a vegetarian, I didn't tell him that the soup had some meat in it.
        ],
        [
            "2682180",  # I actually like broccoli.
            "4746172",  # I hate celery.
            "63177",    # Cabbage can be eaten raw.
            "507260",   # Give me a head of cabbage.
            "2703324",  # What's the difference between cabbage and lettuce?
            "3097489",  # These look like spinach plants.
            "954195",   # My son never eats his spinach.
            "5813922",  # Do you like mashed potatoes?
            "1815700",  # Would you like more mashed potatoes?
        ],
        [
            "3822456",  # Who cut the melon?
            "4483909",  # This squash smells like melon.
            "1487415",  # I want to drink coconut milk.
            "3825685",  # This is a coconut.
            "39789",    # The buds began to open.
            "522621",   # There's bamboo growing in the garden.
        ],

        # ===========================================================
        # === Stew / soup / cooking ===
        # ===========================================================
        [
            "253880",   # I started to make stew.
            "2288932",  # Don't forget to stir the stew.
            "4493921",  # This stew is a little too salty.
            "4495483",  # This stew would taste better if you added some black pepper.
            "2245962",  # I love chili.
            "2248102",  # I'm making chili.
        ],

        # ===========================================================
        # === Yogurt / dairy / breakfast ===
        # ===========================================================
        [
            "2518286",  # The yogurt is delicious.
            "60374",    # This yogurt tastes strange.
            "3719078",  # There is yogurt in the fridge.
            "5539516",  # Could you pass me the maple syrup?
            "62158",    # How about a cup of cocoa?
        ],

        # ===========================================================
        # === Booze / cider / tequila / gin (drinks) ===
        # ===========================================================
        [
            "2220861",  # You're out of booze.
            "749147",   # I love apple cider.
            "3123353",  # Would you like some cider?
            "52483",    # I'd like a gin and tonic.
            "2012753",  # What I want is a gin and tonic.
            "4536128",  # I'd like a shot of tequila.
            "1839640",  # Would you like a shot of tequila?
            {"text": "Make it two.", "added_for": "two", "reason": "natural drink-order reply"},
        ],

        # ===========================================================
        # === Snacks / crackers / sandwiches ===
        # ===========================================================
        [
            "1830555",  # I've eaten all the crackers.
            "5800466",  # We are out of cheese and crackers.
            "2249756",  # Pass the ketchup.
            "1224563",  # Please give me two hot dogs with mustard and ketchup.
            "1498963",  # I love vanilla ice cream.
            "2331834",  # I had to make a choice between chocolate and vanilla.
        ],

        # ===========================================================
        # === Seafood / lobster / octopus / oysters ===
        # ===========================================================
        [
            "5851908",  # I like lobster.
            "3154824",  # I very seldom eat lobster.
            "5851446",  # I seldom eat seafood.
            "953479",   # I have not eaten any seafood since the recent oil spill.
            "4133482",  # I don't eat oysters.
            "2270356",  # Don't eat the oysters.
            "4498057",  # Do you eat octopus?
            "953922",   # I've never eaten a live octopus.
            "4098255",  # It's possible that we won't be able to eat tuna in the future.
        ],

        # ===========================================================
        # === Beverages / coffee / tea ===
        # ===========================================================
        [
            "906695",   # What's your favorite beverage?
            {"text": "Black coffee.", "added_for": "black", "reason": "natural answer to favorite-beverage Q"},
            "4662821",  # Please don't bring alcoholic beverages into the stadium.
        ],

        # ===========================================================
        # === Animals: pets / wildlife ===
        # ===========================================================
        [
            "3385963",  # Was that a squirrel?
            "4660507",  # I’ve always wanted to have a pet squirrel.
            "497132",   # Squirrels move quickly.
            "5397912",  # What do you find so interesting about squirrels?
            "6106420",  # Is that a leopard?
            "5183156",  # I've never seen a scorpion.
        ],
        [
            "2784695",  # The alligator ate the dog.
            "4132898",  # I've never eaten alligator meat.
            "1717660",  # Have you ever fed a crocodile?
            "1103222",  # I can't tell a frog from a toad.
            "42225",    # Is it a butterfly or a moth?
            "4536143",  # What's the average lifespan of a butterfly?
            "898553",   # If you feed your dog properly, you can increase his lifespan.
        ],
        [
            "2331589",  # I had a hamster named Cookie.
            "1950657",  # I can't afford to buy a pony.
            "3236212",  # Every girl dreams of owning a pony.
            "2261099",  # Your cat is overweight.
            "3676611",  # Why doesn't your dog wear a muzzle?
            "65170",    # A parrot can mimic a person's voice.
            "68227",    # That hut is crawling with lizards and insects.
            "4542352",  # I could hear an owl hooting in the distance.
        ],

        # ===========================================================
        # === Mule / donkey / barn animals ===
        # ===========================================================
        [
            "326439",   # The old man loaded his mule with bags full of sand.
            "2406636",  # I still have bruises where the mule kicked me.
            {"text": "Are you all right?", "added_for": "right", "reason": "natural concerned reply"},
            "1008899",  # Dinosaurs once ruled the earth.
            "19145",    # Dinosaurs are now extinct.
        ],

        # ===========================================================
        # === Submarine / vessel / ashore ===
        # ===========================================================
        [
            "4494913",  # Is that a submarine?
            "253794",   # I've never seen a yellow submarine in my life.
            "5652567",  # I'm going ashore.
            "3310920",  # We're not going ashore.
        ],

        # ===========================================================
        # === Vehicles: motorcycle / jeep / motel ===
        # ===========================================================
        [
            "3594034",  # That's a cool motorcycle.
            "3185202",  # Stay away from my motorcycle.
            "251361",   # My grandmother can ride a motorcycle.
            "6106155",  # I was pulled over by a motorcycle cop.
            "2042844",  # I hear you're selling your motorcycle. How much do you want for it?
            "953636",   # I think it's highly unlikely that I'll ever see my stolen motorcycle again.
            "5439699",  # I can lend you my motorcycle.
            "4014272",  # Have you ever ridden a motorcycle?
            "3822218",  # I like to ride motorcycles.
            "4799210",  # I really like riding motorcycles.
        ],
        [
            "2549566",  # Get in the Jeep.
            "2404168",  # I run a motel.
            "2438249",  # We drove back to the motel.
            "2544298",  # I'll be staying in a motel.
            "4493155",  # This motel has a swimming pool.
            "2544284",  # I'll get a room at a motel.
            "2307985",  # I checked into a motel and went right to sleep.
            "2891818",  # Pull up to the curb.
            "5858401",  # I sat on the curb.
        ],

        # ===========================================================
        # === Driving: gasoline / ignition / intersection ===
        # ===========================================================
        [
            "3826693",  # Gasoline isn't cheap anymore.
            "2042907",  # I think the first thing you might want to do is put some gasoline in your car.
            "63715",    # Gasoline is sold by the liter.
            "5666404",  # I left the keys in the ignition.
            "4497362",  # Did you really leave your car unlocked with the key in the ignition?
            {"text": "What was I thinking?", "added_for": "thinking", "reason": "natural self-rebuke reply"},
            "3226540",  # This intersection is dangerous.
            "4529000",  # You should slow down when you approach a four-way intersection.
        ],

        # ===========================================================
        # === Workout / yoga / sports ===
        # ===========================================================
        [
            "3818445",  # I want to workout.
            "4915787",  # I'm trying to get a tan.
            "5839940",  # I teach yoga.
            "295049",   # He is good at gymnastics.
            "288049",   # He's a volleyball player.
            "3818782",  # I've always liked volleyball.
            "255394",   # I like volleyball as well as basketball.
            "336060",   # Some people like volleyball, others enjoy tennis.
            "4499605",  # I'm the quarterback of the team.
            "1096362",  # Someone stole my tennis racket.
            "293331",   # He hit the ball with his racket.
            "243020",   # Can I borrow your tennis racket today?
            "279181",   # I left my tennis racket on the train.
            "17187",    # Choose your favorite racket.
            "52292",    # Have you ever tried scuba diving?
        ],

        # ===========================================================
        # === Dance: salsa / tango / flute ===
        # ===========================================================
        [
            "2325172",  # I enjoy salsa dancing.
            "456419",   # My favorite dance is the tango.
            "4134172",  # Who taught you to tango?
            "1756445",  # My favorite music instrument is the flute.
            "2050676",  # I played the flute when I was in high school.
            "5821590",  # I've already told my parents that I want a flute for my birthday.
            "1125114",  # It's a harp.
            "4095923",  # I'd like to learn to play the harp.
        ],

        # ===========================================================
        # === Headphones / amplifier / gadgets ===
        # ===========================================================
        [
            "3457084",  # These headphones don't work.
            "3821834",  # Take your headphones off.
            "3391153",  # That amplifier doesn't work.
            "244327",   # I built an amplifier yesterday.
            "906768",   # What's your favorite gadget?
            "6029577",  # I love these gadgets.
            "2360559",  # I have to recharge the batteries.
        ],

        # ===========================================================
        # === Halloween cont. / casino / nightclub ===
        # ===========================================================
        [
            "4667045",  # I went to the casino.
            "2547920",  # I was in a nightclub.
            "325580",   # The tourists were ripped off at the nightclub.
            "2645549",  # Are you in a fraternity?
            {"text": "No, I'm not really into that.", "added_for": "into", "reason": "natural decline reply"},
        ],

        # ===========================================================
        # === Memo / pamphlet / encyclopedia ===
        # ===========================================================
        [
            "2549652",  # I wrote a memo.
            "2648776",  # Look at the memo.
            "5938597",  # I gave everyone a pamphlet.
            "4500896",  # This pamphlet tells you how you can lower the water bill.
            "325021",   # An up-to-date edition of the encyclopedia will come out next month.
            "1493327",  # It's outdated.
            "1522355",  # This data is outdated.
        ],

        # ===========================================================
        # === Telegram / disconnected / signals ===
        # ===========================================================
        [
            "69947",    # When did you receive the telegram?
            "2241483",  # We were disconnected.
            "2618638",  # I thought we got disconnected.
            {"text": "Bad reception out here.", "added_for": "reception", "reason": "natural follow-up to disconnected"},
        ],

        # ===========================================================
        # === Astronaut / dream careers ===
        # ===========================================================
        [
            "5193538",  # I want to become an astronaut.
            "953679",   # I used to dream about becoming an astronaut.
            "4087661",  # Who invented dynamite?
            "3733568",  # This stuff is dynamite.
            "3226644",  # Handling dynamite can be dangerous.
            "262961",   # We blew up a huge rock with dynamite.
            "3239008",  # Are you sure it's safe to move this dynamite?
        ],

        # ===========================================================
        # === Pickle / pact / placebo (idioms continued) ===
        # ===========================================================
        [
            "2549513",  # I'm in a pickle.
            "6459833",  # Where are the pickles?
            "1453226",  # It's just a placebo.
            "3636159",  # It looks like a cactus.
            "2898163",  # I bought a cactus.
        ],

        # ===========================================================
        # === Flirt / kidding / playful ===
        # ===========================================================
        [
            "2107351",  # We're kidding.
            "3575425",  # Hey, I'm only kidding.
            "2213931",  # I wasn't flirting.
            "4493990",  # We're flirting with disaster.
            "1895563",  # You're such a flirt.
            "2275848",  # I didn't flirt with Mary.
        ],

        # ===========================================================
        # === Adore / radiant / charisma ===
        # ===========================================================
        [
            "2243012",  # They adore you.
            "240555",   # Please rinse out your mouth.
            "4501852",  # Rinse with warm water.
        ],

        # ===========================================================
        # === Cane / wheelchair / aid ===
        # ===========================================================
        [
            "2254631",  # Where's my cane?
            "2387506",  # I need my cane.
            "5760898",  # I bought a backpack at the army surplus store.
            "4109719",  # This blue backpack is heavy.
        ],

        # ===========================================================
        # === Outskirts / orchard / patio ===
        # ===========================================================
        [
            "3024304",  # I live on the outskirts of Boston.
            "250528",   # My house is on the outskirts of town.
            "6555166",  # How many trees are in your orchard?
            "4134171",  # Let's have lunch on the patio.
            "502617",   # Do you have a table on the patio?
            {"text": "Right this way.", "added_for": "way", "reason": "natural host reply"},
        ],

        # ===========================================================
        # === Maze / shortcut / lost ===
        # ===========================================================
        [
            "3733647",  # I got lost in the maze.
            "538788",   # I know a shortcut.

            "278512",   # I'll take a shortcut across the garden.
            "307540",   # Do they have something like a compass?
        ],

        # ===========================================================
        # === Awesome / surreal / overheard ===
        # ===========================================================
        [
            "2389591",  # I overheard your conversation.
            "3168385",  # I overheard what you said.
            "2481342",  # We can talk here without being overheard.
        ],

        # ===========================================================
        # === Cosmic / mythology / prophecy ===
        # ===========================================================
        [
            "1792466",  # The prophecy came true.
            "3819104",  # It was like I was in a trance.
            "2187236",  # It's suicidal.
            "2248185",  # I'm not suicidal.
        ],

        # ===========================================================
        # === Profile / website / contemporary tech (light) ===
        # ===========================================================
        [
            "906879",   # What's your favorite slogan?
            {"text": "Less is more.", "added_for": "less", "reason": "natural slogan answer"},
            "1890695",  # It went viral.
            "909581",   # We should spend our time creating content for our website rather than wasting time worrying about minor cosmetic details.
        ],

        # ===========================================================
        # === Tedious / boring / chores ===
        # ===========================================================
        [
            "4495182",  # It can be tedious.
            "4494197",  # It was tedious and boring.
            "953819",   # I'm done with my chores.
            "909541",   # I'd love to be able to spend less time doing household chores.
            "909538",   # I would like to drastically decrease the amount of time it takes me to clean the house.
        ],

        # ===========================================================
        # === Drastically / things will change ===
        # ===========================================================
        [
            "2744159",  # The cost of living has increased drastically.
            "4501222",  # Things will be drastically different from now on.
            {"text": "What's the catch?", "added_for": "catch", "reason": "natural skeptical follow-up"},
        ],

        # ===========================================================
        # === Cancer / chemotherapy / treatment ===
        # ===========================================================
        [
            "4529279",  # The cause of death was cardiac arrest.
            "992043",   # Many cancer patients lose their hair because of chemotherapy.
            "2031972",  # Many inmates on death row say they want to die.
        ],

        # ===========================================================
        # === Edible / botany / orchids ===
        # ===========================================================
        [
            "2244908",  # Are these edible?
            "4800324",  # This plant is edible.
            "312105",   # She is proficient in French.
            "262844",   # We are looking for someone who is proficient in French.
            "256317",   # I grow orchids in my greenhouse.
        ],

        # ===========================================================
        # === Refrain / smoking / civility ===
        # ===========================================================
        [
            "19931",    # Please refrain from smoking.
            "61915",    # Please refrain from smoking cigarettes here.
            "3723903",  # Please refrain from talking.
            "3820257",  # I'll refrain from commenting on that.
        ],

        # ===========================================================
        # === Hassle / nap / sleepy ===
        # ===========================================================
        [
            "3735323",  # I suggest that you take a nap.
            "5909643",  # I usually take a short nap after lunch.
            "251813",   # My mother takes a nap every afternoon.
            "5673136",  # If you're sleepy, you should take a nap.
        ],

        # ===========================================================
        # === Pneumonia / itchy / rash (mild ailments) ===
        # ===========================================================
        [
            "2782538",  # Don't be rash.
            "266127",   # I have a rash on my neck.
            "280183",   # My scalp is very itchy.
            "2267435",  # It's a scalp disease.
            "5904811",  # I often wash my hair without using shampoo.
            "954507",   # What brand of shampoo do you use?
            "3059400",  # I got shampoo in my eyes and it hurts.
        ],

        # ===========================================================
        # === Cavity / dental / toothpaste ===
        # ===========================================================
        [
            "4976786",  # I've never had a cavity.
            "528637",   # I think I have a cavity.
            "953928",   # I've recently changed brands of toothpaste.
            "3071720",  # I want a large tube of toothpaste.
        ],

        # ===========================================================
        # === Evidence / looting / tyranny ===
        # ===========================================================
        [
            "4493823",  # There wasn't a single shred of evidence.
            "4494542",  # Tyranny is everywhere.
            "4495130",  # There was looting.
            "4502880",  # We won't tolerate any looting.
        ],

        # ===========================================================
        # === Cab / cashier / quick errand ===
        # ===========================================================
        [
            "5858238",  # I paid the cashier.
            "64722",    # Please pay the cashier.
            "2547424",  # Do you have a voucher?
        ],

        # ===========================================================
        # === Nicknames / labels / identity ===
        # ===========================================================
        [
            "2262899",  # What a terrible nickname!
            "3152300",  # Have they given you a nickname yet?
            {"text": "Yeah, but I won't tell you.", "added_for": "tell", "reason": "natural cagey answer"},
            "2253519",  # Is this a gag?
            "4647223",  # Don't peek.
            "2249538",  # Let's peek inside.
        ],

        # ===========================================================
        # === Sabotage / brawl / chaos (kept lightly) ===
        # ===========================================================
        [
            "4016849",  # It wasn't much of a brawl.
            "63772",    # Traffic was blocked by a landslide.
            "3826193",  # There will be a blizzard.
            "325504",   # The tornado destroyed the whole village.
            "5322370",  # The ozone layer helps protect us from ultraviolet radiation from the sun.
            "277738",   # Snow has been falling steadily since this morning.
        ],

        # ===========================================================
        # === Edible / harvest / agricultural ===
        # ===========================================================
        [
            "15911",    # Can you tell wheat from barley?
            "5682243",  # I need to shovel snow off of the roof.
            "3735967",  # That shovel cost thirty dollars.
            "2034486",  # Do you want me to fix your broken shovel or don't you?
            "2643714",  # Put the broom in the closet.
            "2396049",  # Grab a broom and help us clean.
        ],

        # ===========================================================
        # === Lantern / curb / pendant (objects) ===
        # ===========================================================
        [
            "3151433",  # Give the lantern to me.
            "17560",    # I'll give you this pendant.
            "2640794",  # I need something to open this crate with.
            "3822398",  # One crate is still missing.
            "3133021",  # Is there enough gravy?
            "62781",    # Would you like some more gravy?
        ],

        # ===========================================================
        # === Recharge / crank / heater (mechanical) ===
        # ===========================================================
        [
            "3731663",  # Can you crank up the heat?
            "4499290",  # Crank up the heater.
            "3118275",  # I'm rooting for you.
            "1730751",  # Who are you rooting for?
        ],

        # ===========================================================
        # === Hometown / siblings / family (rest) ===
        # ===========================================================
        [
            "312180",   # She had the hotel suite to herself.
            "290768",   # He adopted the orphan.
            "325656",   # A child whose parents are dead is called an orphan.
            "2242990",  # They're orphans.
        ],

        # ===========================================================
        # === Dresser / pebble / domestic ===
        # ===========================================================
        [
            "2007616",  # Let's move the dresser.
            "2007244",  # Let's put this in the top dresser drawer.
            "2258774",  # I have a pebble in my shoe.
            "4502000",  # It seems durable enough.
        ],

        # ===========================================================
        # === Overdue / subtitles / movies ===
        # ===========================================================
        [
            "5046403",  # This book is overdue.
            "3820497",  # I need subtitles.
            "5364213",  # This movie has French subtitles.
        ],

        # ===========================================================
        # === Trench coat / cowboy / outfit ===
        # ===========================================================
        [
            "5938719",  # I don't own a trench coat.
            "5853002",  # I often wear a black cowboy hat.
            "2306652",  # I bought it in a thrift store.
            "2473240",  # I bought it at a thrift shop.
        ],

        # ===========================================================
        # === Hardworking / standards ===
        # ===========================================================
        [
            "2202932",  # We're hardworking.
            "295408",   # Is he a hardworking student?
        ],

        # ===========================================================
        # === Autograph / puppets / fan culture ===
        # ===========================================================
        [
            "3328193",  # Can I get your autograph?
            "1292190",  # Everyone loves puppets.
            "2757588",  # There's a puppet in the box.
        ],

        # ===========================================================
        # === Auditorium / venues ===
        # ===========================================================
        [
            "3412974",  # The auditorium is packed.
            "4493981",  # Everybody's in the auditorium.
            "4639602",  # That auditorium holds two thousand people.
            "2239623",  # Can you meet me in the auditorium?
        ],

        # ===========================================================
        # === Whining / aggravated / mellow ===
        # ===========================================================
        [
            "2029950",  # Stop whining.
            "2249843",  # Quit your whining.
            "4499756",  # It really aggravated me.
            "2288982",  # Don't tell me to mellow out.
            "2033801",  # I don't want to hear another peep out of you.
        ],

        # ===========================================================
        # === Hog / cracking knuckles / habits ===
        # ===========================================================
        [
            "2250426",  # Don't handle the merchandise.
            "2815157",  # Stop cracking your knuckles.
            "2731712",  # Don't hog the road.
        ],

        # ===========================================================
        # === Rainforest / trees / environment ===
        # ===========================================================
        [
            "4540988",  # We must protect the rainforest.
            "3317907",  # Birch trees have white bark.
            "5853088",  # There was a birch tree in our garden, but it died.
            "6555161",  # My favorite tree is the weeping willow.
        ],

        # ===========================================================
        # === Ammunition / conserve ===
        # ===========================================================
        [
            "4012462",  # Don't mix ammonia and bleach together.
            "2953721",  # We need to conserve ammunition.
            "2240687",  # We're wasting ammunition.
        ],

        # ===========================================================
        # === Clover / luck ===
        # ===========================================================
        [
            "245517",   # Have you ever found a four-leaf clover?
        ],

        # ===========================================================
        # === Flea market / browsing ===
        # ===========================================================
        [
            "2225381",  # Let's go to the flea market tomorrow.
            "6026748",  # Do you like going to flea markets?
            "34129",    # Is there anywhere I can go to find a flea market?
        ],

        # ===========================================================
        # === Roles: physicist / umpire / blind jogger ===
        # ===========================================================
        [
            "303490",   # He is a physicist.
            "254396",   # I was asked to umpire the game.
            "304172",   # He made up his mind to jog in spite of his blindness.
        ],

        # ===========================================================
        # === Evicted ===
        # ===========================================================
        [
            "2978831",  # I've been evicted.
            "3331083",  # You got us evicted.
        ],

        # ===========================================================
        # === Closing: barbarians ===
        # ===========================================================
        [
            "2240748",  # We're not barbarians.
        ],
    ],
}

