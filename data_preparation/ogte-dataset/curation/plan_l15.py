"""Curation plan for OGTE Level 15 — Mid Advanced (~1176 sentences).

At L15 the learner is comfortably mid-advanced: nuanced opinions, conditional
reasoning, abstract concepts (ignorance, conscience, integrity, anticipation,
contradiction), refined register shifts (formal/informal, polite hedge vs.
direct disagreement), mild humor and irony, and a rich idiom layer
(devil's advocate, shooting fish in a barrel, blink of an eye, busy as a bee,
green thumb, comes in handy).

Curation philosophy (refined for L15, in line with L12/L13):
  - Long sentences and embedded clauses are FINE — learners need them.
  - Common idioms are valuable — keep most.
  - Specific years, numbers, body parts, narratives, mild crime/police,
    proper names (in moderation), political content (not country-specific)
    are FINE.
  - Still removed: dated brand mentions in odd contexts (Twitter/YouTube),
    overtly sexist generalizations, extremely niche cultural references,
    exact / near-duplicates, drill-pattern overflow (same content word
    4+ in a row), and gore-heavy material.

  Arcs are pedagogical: most questions are answered, vocabulary varies
  across consecutive rows, and three highest-quality openers are pinned
  at "position": "first".
"""

from __future__ import annotations


L15_PLAN = {
    "removals": [
        # ============================================================
        # === Yen drill — huge cluster of ~19 yen sentences ===
        # ============================================================
        # Source has 813..831 all saying "X yen" — classic drill. Keep
        # ~4 of the most natural ones; drop the rest.
        {"id": "294102", "reason": "'He exchanged yen for dollars.' — yen-drill overflow."},
        {"id": "253171", "reason": "'I borrowed 1,000 yen from my cousin.' — yen-drill overflow."},
        {"id": "253498", "reason": "'I bought this camera for 25,000 yen.' — yen-drill overflow."},
        {"id": "254270", "reason": "'I sold the picture for 20,000 yen.' — yen-drill overflow."},
        {"id": "266014", "reason": "'I converted my yen into dollars.' — yen-drill overflow + duplicate of 294102 framing."},
        {"id": "289963", "reason": "'He paid 1,000 yen for this book.' — yen-drill overflow."},
        {"id": "2922472", "reason": "'Please give me one 80-yen stamp.' — yen-drill overflow."},
        {"id": "3017163", "reason": "'I get paid 300,000 yen per month.' — yen-drill overflow."},
        {"id": "305251", "reason": "'Their losses reached one million yen.' — yen-drill overflow."},
        {"id": "73453", "reason": "'I bought five ten-yen stamps.' — yen-drill overflow."},
        {"id": "1397632", "reason": "'It'll cost about 2,000 yen to repair it.' — yen-drill overflow."},
        {"id": "56433", "reason": "'This watch costs around fifty thousand yen.' — yen-drill overflow."},
        {"id": "1500324", "reason": "'It'll cost at least 2,000 yen to take a taxi.' — yen-drill overflow."},
        {"id": "68694", "reason": "'A cup of coffee cost 200 yen in those days.' — yen-drill overflow."},
        {"id": "327978", "reason": "'It wasn't a 100 yen coin, it was a bottle cap.' — yen-drill overflow."},
        {"id": "46956", "reason": "'It cost me one thousand yen to get the bicycle fixed.' — yen-drill overflow."},
        {"id": "295903", "reason": "'He earns 300,000 yen a month.' — yen-drill overflow."},

        # ============================================================
        # === Noon drill — 11 consecutive 'noon' sentences ===
        # ============================================================
        {"id": "271628", "reason": "'Please wait till noon.' — noon-drill overflow."},
        {"id": "271616", "reason": "'I'll call you at noon.' — noon-drill overflow."},
        {"id": "33870", "reason": "'The bell rings at noon.' — noon-drill overflow."},
        {"id": "64165", "reason": "'It may rain around noon.' — noon-drill overflow."},
        {"id": "326238", "reason": "'The train is due at noon.' — noon-drill overflow."},
        {"id": "5915995", "reason": "'I didn't wake up until noon.' — noon-drill overflow (kept Sundays variant)."},
        {"id": "2028633", "reason": "'I want it delivered to me by noon tomorrow.' — noon-drill overflow."},
        {"id": "43424", "reason": "'The train will arrive at the station before noon.' — noon-drill overflow."},

        # ============================================================
        # === Disappointed drill — 14 consecutive variants ===
        # ============================================================
        {"id": "3825333", "reason": "'Hopefully, no one will be disappointed.' — disappointed-drill overflow."},
        {"id": "251841", "reason": "'My mother was disappointed by my failure.' — disappointed-drill overflow."},
        {"id": "269312", "reason": "'I was disappointed with the new product.' — disappointed-drill overflow."},
        {"id": "292920", "reason": "'He was disappointed at not being invited.' — disappointed-drill overflow."},
        {"id": "311191", "reason": "'She seemed disappointed at the result.' — disappointed-drill overflow."},
        {"id": "295077", "reason": "'He was disappointed that things didn't turn out as he'd hoped.' — disappointed-drill overflow."},
        {"id": "638891", "reason": "'Don't disappoint me.' — duplicate of 284416 'Don't disappoint him.'"},

        # ============================================================
        # === Airport drill — too many airport sentences ===
        # ============================================================
        {"id": "18193", "reason": "'Where does the airport bus leave from?' — duplicate of 5282543."},
        {"id": "241553", "reason": "'I've just arrived at the airport.' — airport-drill overflow."},
        {"id": "680145", "reason": "'We arrived at the airport three hours before our flight.' — airport-drill overflow."},
        {"id": "264299", "reason": "'Get off at the next stop and take a bus headed to the airport.' — clunky + airport-drill overflow."},
        {"id": "241034", "reason": "'Can I pick my ticket up at the airport?' — airport-drill overflow."},
        {"id": "2046920", "reason": "'Hong Kong International Airport is a busy airport.' — clunky + airport-drill overflow."},
        {"id": "240074", "reason": "'I want to arrive at Kennedy Airport early in the afternoon.' — niche proper noun + airport-drill overflow."},
        {"id": "18197", "reason": "'I could've met you at the airport.' — airport-drill overflow."},
        {"id": "3826835", "reason": "'This is a photograph of the airport.' — airport-drill overflow + odd."},
        {"id": "18198", "reason": "'The airport was closed because of the fog.' — airport-drill overflow."},
        {"id": "5300781", "reason": "'What's the fastest way to get to the airport?' — airport-drill overflow."},
        {"id": "18219", "reason": "'They shook hands when they met at the airport.' — airport-drill overflow."},

        # ============================================================
        # === Forever drill — ~15 'forever' sentences ===
        # ============================================================
        {"id": "1954702", "reason": "'They can't protect us forever.' — forever-drill overflow."},
        {"id": "66143", "reason": "'That secret can't be kept forever.' — forever-drill overflow."},
        {"id": "1952042", "reason": "'Your parents can't keep us apart forever.' — forever-drill overflow."},
        {"id": "1954919", "reason": "'You can't stay mad at me forever.' — forever-drill overflow."},
        {"id": "1951866", "reason": "'I can't hide forever.' — duplicate of 2273980 'You can't hide forever.'"},
        {"id": "2276674", "reason": "'Our supplies won't last forever.' — forever-drill overflow."},
        {"id": "4884636", "reason": "'Babies don't stay babies forever.' — forever-drill overflow."},
        {"id": "1466119", "reason": "'Nothing lasts forever.' — duplicate of 4867405."},
        {"id": "2487176", "reason": "'True friendships last forever.' — duplicate of 2487177 (singular)."},
        {"id": "887615", "reason": "'She'll love him forever.' — forever-drill overflow."},

        # ============================================================
        # === Weird drill — 10+ 'weird' sentences ===
        # ============================================================
        {"id": "3721820", "reason": "'You're a weird kid.' — weird-drill overflow + accusatory."},
        {"id": "3818620", "reason": "'Your ideas are weird.' — weird-drill overflow + accusatory."},
        {"id": "3732689", "reason": "'Everyone thinks I'm weird.' — weird-drill overflow."},
        {"id": "5087189", "reason": "'It's very strange and weird.' — redundant phrasing + weird-drill overflow."},
        {"id": "2345158", "reason": "'I got a weird email.' — weird-drill overflow."},
        {"id": "3129857", "reason": "'Weird things are happening.' — weird-drill overflow."},
        {"id": "2250909", "reason": "'That sounded weird.' — weird-drill overflow."},

        # ============================================================
        # === Chairman drill — niche workplace term overused ===
        # ============================================================
        {"id": "283534", "reason": "'He was elected chairman.' — chairman-drill overflow."},
        {"id": "307403", "reason": "'They elected him chairman.' — chairman-drill overflow + duplicate of 283534."},
        {"id": "1315812", "reason": "'He talked to the chairman.' — chairman-drill overflow."},
        {"id": "295164", "reason": "'He was appointed chairman.' — duplicate of 3825823."},
        {"id": "295167", "reason": "'He accepted his appointment as chairman.' — chairman-drill overflow."},
        {"id": "295168", "reason": "'He acted as chairman.' — chairman-drill overflow."},

        # ============================================================
        # === Forehead / kissed — paired duplicate ===
        # ============================================================
        {"id": "887259", "reason": "'She kissed him on the forehead.' — duplicate of 297798 (gender-swap)."},

        # ============================================================
        # === Surgery / participate moderate trim ===
        # ============================================================
        {"id": "4502395", "reason": "'The surgery was successful.' — surgery-drill overflow."},
        {"id": "5132171", "reason": "'Everyone is welcome to participate.' — participate-drill overflow."},
        {"id": "4498266", "reason": "'Encourage everyone to participate.' — participate-drill overflow."},

        # ============================================================
        # === Anticipate / anticipated drill ===
        # ============================================================
        {"id": "245051", "reason": "'I anticipated a quiet vacation in the mountains.' — anticipated-drill overflow."},
        {"id": "2452041", "reason": "'There was a larger crowd at the concert than we had anticipated.' — anticipated-drill overflow."},
        {"id": "3315285", "reason": "'The job was bigger than I anticipated.' — anticipated-drill overflow."},
        {"id": "1174303", "reason": "'I've been anticipating his arrival.' — anticipating-drill overflow."},

        # ============================================================
        # === Rumor drill (moderate) ===
        # ============================================================
        {"id": "3408265", "reason": "'The rumors were false.' — rumor-drill overflow."},
        {"id": "3329977", "reason": "'I'm glad the rumors weren't true.' — rumor-drill overflow."},

        # ============================================================
        # === Hockey drill ===
        # ============================================================
        {"id": "4502288", "reason": "'Hockey starts this weekend.' — hockey-drill overflow."},
        {"id": "455903", "reason": "'I'm on a hockey team.' — hockey-drill overflow."},

        # ============================================================
        # === Compromise drill ===
        # ============================================================
        {"id": "5170093", "reason": "'I'm not prepared to compromise.' — compromise-drill overflow."},
        {"id": "4970631", "reason": "'I'm strongly opposed to a compromise.' — compromise-drill overflow."},

        # ============================================================
        # === Sophisticated drill ===
        # ============================================================
        {"id": "3137186", "reason": "'This is a sophisticated instrument.' — sophisticated-drill overflow."},
        {"id": "3137189", "reason": "'Mary is a sophisticated lady.' — sophisticated-drill overflow."},

        # ============================================================
        # === Pulse drill (moderate trim) ===
        # ============================================================
        {"id": "322673", "reason": "'My pulse is slow.' — duplicate-pair of 322672 'My pulse is fast.'"},
        {"id": "5167606", "reason": "'The doctor thought the patient's pulse was a little fast.' — pulse-drill overflow + clunky."},

        # ============================================================
        # === Wheat factoid trim ===
        # ============================================================
        {"id": "527167", "reason": "'Bread is made from wheat.' — factoid trivial."},

        # ============================================================
        # === Jail / prison drill (moderate) ===
        # ============================================================
        {"id": "3724611", "reason": "'You'll die in jail.' — jail-drill overflow + menacing."},
        {"id": "3724614", "reason": "'I'll visit you in jail.' — jail-drill overflow."},
        {"id": "5859302", "reason": "'I ended up in jail.' — jail-drill overflow."},

        # ============================================================
        # === Cardboard drill ===
        # ============================================================
        {"id": "2047765", "reason": "Long 'three hundred cardboard boxes filled with old clothes…' — cardboard-drill overflow + clunky."},

        # ============================================================
        # === Documentary drill ===
        # ============================================================
        {"id": "2628701", "reason": "'I watched a documentary.' — documentary-drill overflow (duplicate of 2628699)."},
        {"id": "2628692", "reason": "'I have a collection of documentaries.' — documentary-drill overflow."},

        # ============================================================
        # === Sip drill ===
        # ============================================================
        {"id": "1956036", "reason": "'I only had one sip of beer.' — sip-drill overflow."},

        # ============================================================
        # === Paired "We're X / You're X" duplicate pairs ===
        # ============================================================
        {"id": "2202762", "reason": "'You're diplomatic.' — paired-duplicate of 2202761 'We're diplomatic.'"},
        {"id": "2203394", "reason": "'You're spontaneous.' — paired-duplicate of 2203393."},
        {"id": "2243233", "reason": "'They look smashing.' — paired-duplicate of 2255051 'You look smashing.'"},
        {"id": "2203488", "reason": "'You're unbiased.' — paired-duplicate of 2203487."},
        {"id": "2549264", "reason": "'They're immature.' — paired-duplicate of 2202970 'You're immature.'"},
        {"id": "2202814", "reason": "'I'm enthusiastic.' — paired-duplicate of 2202812 'We're enthusiastic.'"},
        {"id": "2240672", "reason": "'We're tempting fate.' — paired-duplicate of 2218421 'You're tempting fate.'"},

        # ============================================================
        # === Dyed-hair drill ===
        # ============================================================
        {"id": "3469937", "reason": "'Mary dyed her hair blue.' — dye-drill overflow."},
        {"id": "2688075", "reason": "'I got my hair dyed black.' — dye-drill overflow."},

        # ============================================================
        # === Misc paired duplicates ===
        # ============================================================
        {"id": "4665041", "reason": "'The modifications are complete.' — paired-duplicate of 2380421."},
        {"id": "4665506", "reason": "'That would violate our rules.' — duplicate of 4665282 'That would violate our policy.'"},
        {"id": "4494001", "reason": "'This is fundamentally unfair.' — duplicate of 5088457 'That's fundamentally unfair.'"},
        {"id": "2891947", "reason": "'That would be disastrous.' — paired-duplicate of 4495177."},
        {"id": "2233672", "reason": "'This is dreadful.' — paired-duplicate of 2123539 'They're dreadful.'"},
        {"id": "3735465", "reason": "'It's peculiar.' — paired-duplicate of 3636097."},
        {"id": "2233718", "reason": "'This is outstanding.' — paired-duplicate of 2111416."},
        {"id": "2111722", "reason": "'I'm immune.' — paired-duplicate of 2111274 'They're immune.'"},
        {"id": "313128", "reason": "'She is aggressive.' — paired-duplicate of 2202555 'You're aggressive.'"},
        {"id": "2173239", "reason": "'I'm not a saint.' — paired-duplicate of 2218225 'You're no saint.'"},
        {"id": "5828975", "reason": "'I'm a rebel.' — paired-duplicate of 2248118 'I'm no rebel.'"},
        {"id": "3822140", "reason": "'It's a myth.' — paired-duplicate of 1897778 'That's a myth.'"},

        # ============================================================
        # === Twitter / YouTube — dated brand mentions ===
        # ============================================================
        {"id": "1279106", "reason": "'I use Twitter.' — dated brand."},
        {"id": "953191", "reason": "'Do you have a Twitter account?' — dated brand."},
        {"id": "4228328", "reason": "'How often do you upload videos to YouTube?' — dated brand."},
        {"id": "4228324", "reason": "'Have you ever uploaded a video to YouTube?' — dated brand."},

        # ============================================================
        # === Abusive vague accusations ===
        # ============================================================
        {"id": "5271060", "reason": "'You're an ignorant fool.' — abusive vague."},
        {"id": "4499721", "reason": "'That sounds racist to me.' — abstract accusation."},

        # ============================================================
        # === Gross / creep duplicates ===
        # ============================================================
        {"id": "2248836", "reason": "'It was gross.' — duplicate-pair of 2202916 'You're gross.'"},
        {"id": "3178306", "reason": "'You probably think I'm a creep.' — duplicate of 3178305."},

        # ============================================================
        # === Whale factoid overflow ===
        # ============================================================
        {"id": "238459", "reason": "Long 'Unless whales are protected they will become extinct.' — whale-drill overflow."},
        {"id": "2152770", "reason": "'Whales are similar to fish in shape.' — whale-factoid drill overflow."},

        # ============================================================
        # === Skating drill ===
        # ============================================================
        {"id": "5806987", "reason": "Long 'My mother doesn't want me to go skating on the pond.' — skating-drill overflow."},
        {"id": "45779", "reason": "'Have you ever tried skating on the river?' — skating-drill overflow."},

        # ============================================================
        # === Microwave / microscope niche ===
        # ============================================================
        {"id": "2260377", "reason": "'I never learned how to use a microwave oven.' — niche."},
        {"id": "276319", "reason": "'Do you know who invented the microscope?' — factoid trivia."},

        # ============================================================
        # === Neptune duplicate factoid ===
        # ============================================================
        {"id": "681653", "reason": "'It takes 165 years for Neptune to orbit around the sun.' — niche factoid (keep 22212)."},

        # ============================================================
        # === Ancient Greek factoid ===
        # ============================================================
        {"id": "239872", "reason": "Long 'The ancient Greeks knew as much about the solar system as we do.' — niche/historical assertion."},

        # ============================================================
        # === Gross + waiter ===
        # ============================================================
        {"id": "4904704", "reason": "'The waiter spit in the soup.' — gross + niche."},

        # ============================================================
        # === Boston overflow ===
        # ============================================================
        {"id": "4635421", "reason": "'I've been to Boston numerous times.' — Boston-drill overflow."},
        {"id": "6355124", "reason": "'I'm a resident of Boston.' — Boston-drill overflow."},
        {"id": "5774840", "reason": "'We stayed overnight in Boston.' — Boston-drill overflow."},
        {"id": "1023690", "reason": "Long 'It was tremendously exciting to be in Boston at that time.' — Boston-drill overflow."},

        # ============================================================
        # === Quiz drill ===
        # ============================================================
        {"id": "242232", "reason": "'We had a history quiz this morning.' — quiz-drill overflow."},
        {"id": "323426", "reason": "'We will have a math quiz tomorrow.' — quiz-drill overflow."},

        # ============================================================
        # === Starve duplicate ===
        # ============================================================
        {"id": "6481975", "reason": "'I would rather starve than start stealing.' — duplicate of 279851 framing."},

        # ============================================================
        # === Obscure proverbs ===
        # ============================================================
        {"id": "278651", "reason": "'It's too late to shut the barn door after the horse is stolen.' — obscure proverb."},
        {"id": "423247", "reason": "'Stuff today and starve tomorrow.' — obscure proverb."},

        # ============================================================
        # === Country-specific politics ===
        # ============================================================
        {"id": "4497418", "reason": "'Why doesn't the U.S. switch to the metric system?' — country-specific politics + dated."},

        # ============================================================
        # === Surplus paired duplicate ===
        # ============================================================
        {"id": "4493625", "reason": "'We have a surplus of food.' — duplicate of 4493733 'We have a surplus.'"},

        # ============================================================
        # === Misc accusatory / vague ===
        # ============================================================
        {"id": "2218415", "reason": "'You're still vulnerable.' — accusatory + duplicate-pair of 5850973."},
        {"id": "2218462", "reason": "'You're totally ignorant.' — vague accusatory."},
        {"id": "2954914", "reason": "'You're all a bunch of losers.' — duplicate of 2544618 'They're a bunch of losers.'"},
        {"id": "2255304", "reason": "'You will conform.' — menacing imperative."},

        # ============================================================
        # === Heavy historical assertion ===
        # ============================================================
        {"id": "807126", "reason": "'Slaves were considered property.' — heavy historical assertion."},

        # ============================================================
        # === Bible / religion in isolation ===
        # ============================================================
        {"id": "2647657", "reason": "'It's from the Bible.' — context-less religious reference."},

        # ============================================================
        # === Welfare niche personal ===
        # ============================================================
        {"id": "258991", "reason": "'I'll live on welfare.' — odd in isolation + niche."},

        # ============================================================
        # === DJ paired ===
        # ============================================================
        {"id": "5828645", "reason": "'I'm a DJ.' — paired-duplicate of 1383444 'He's a DJ.'"},

        # ============================================================
        # === Stocks paired ===
        # ============================================================
        {"id": "4501054", "reason": "'Asian stocks were mixed.' — duplicate-pair of 4501053 'Energy stocks were mixed.'"},

        # ============================================================
        # === Casualties paired ===
        # ============================================================
        {"id": "4501749", "reason": "'Casualties were reported.' — paired-duplicate of 2245071."},

        # ============================================================
        # === Smoky restaurants dated ===
        # ============================================================
        {"id": "954011", "reason": "Long 'Is it safe for children to eat in smoky restaurants?' — dated/niche."},
    ],
    "arcs": [
        # ===========================================================
        # === FIRST ARCS (3 hand-picked highest-quality openers) ===
        # ===========================================================

        # FIRST #1: Diplomatic disagreement / nuanced opinion — flagship L15 register
        {
            "position": "first",
            "items": [
                "2245053",  # Can you elaborate?
                {"text": "Of course. What part would you like me to expand on?",
                 "added_for": "expand|part", "reason": "natural reply offering elaboration"},
                "2547184",  # I'm inclined to agree.
                "3919427",  # I'm inclined to believe you.
                "5938683",  # I'm willing to compromise.
                "4016604",  # It seemed like a reasonable compromise.
                {"text": "I have my reservations, honestly.",
                 "added_for": "reservations|honestly", "reason": "polite hedge — flagship L15 pattern"},
                "1500159",  # It's harsh, but fair.
                "3826840",  # I reluctantly agreed.
            ],
        },

        # FIRST #2: Anticipation / things didn't go to plan — modal reflection
        {
            "position": "first",
            "items": [
                "261958",   # I anticipated trouble.
                "2062716",  # Something I hadn't anticipated happened.
                "4012707",  # We should've anticipated this.
                {"text": "Could you have prevented it?",
                 "added_for": "prevented", "reason": "natural follow-up Q"},
                "4529027",  # It's impossible to anticipate every possible situation.
                "4529521",  # What exactly did you anticipate?
                {"text": "Not this, that's for sure.",
                 "added_for": "sure", "reason": "natural answer with hedge"},
            ],
        },

        # FIRST #3: Integrity / conscience / questioning honesty — abstract & adult
        {
            "position": "first",
            "items": [
                "3142795",  # It's a question of integrity.
                "3142957",  # Are you questioning my integrity?
                {"text": "Not at all — I'm just trying to understand.",
                 "added_for": "trying|understand", "reason": "de-escalating reply"},
                "252097",   # My conscience is clear.
                "2711697",  # I have a guilty conscience.
                "4870562",  # My conscience is bothering me.
                "3830667",  # Is your conscience bothering you?
                {"text": "More than I'd like to admit.",
                 "added_for": "admit", "reason": "honest hedge reply"},
                "271659",   # Honesty is a virtue.
            ],
        },

        # ===========================================================
        # === Justify / justified ===
        # ===========================================================
        [
            "2480001",  # Can you justify your claim?
            "5068885",  # I don't need to justify my actions to you.
            "2233704",  # This is justified.
            "4664219",  # Your anger is completely justified.
            {"text": "Thank you for understanding.",
             "added_for": "understanding", "reason": "warm reply to validation"},
        ],

        # ===========================================================
        # === Stocks / market / finance ===
        # ===========================================================
        [
            "5013006",  # The stock market is up.
            "4497046",  # Stock prices could fall.
            "3147958",  # Our stock prices have gone down 30%.
            "4501053",  # Energy stocks were mixed.
            "807252",   # Everyone tried to sell their stocks.
            "295466",   # He invested his money in stocks.
            "5168299",  # I wish I had bought stock in that company last year.
            "4501854",  # Both stocks rose sharply.
        ],

        # ===========================================================
        # === Election / chairman (slimmed) ===
        # ===========================================================
        [
            "300704",   # He won the election by a large majority.
            "293567",   # He's the chairman of the committee.
            "288146",   # He served as chairman for three years.
            "3825823",  # I was appointed chairman.
            "259527",   # I've spent so many years as chairman that I feel it's time I stepped down.
            {"text": "Are you sure that's the right decision?",
             "added_for": "decision|right", "reason": "natural follow-up"},
        ],

        # ===========================================================
        # === Religion / priest ===
        # ===========================================================
        [
            "2133244",  # Are you religious?
            "5166524",  # I'm not religious.
            {"text": "Did you grow up that way?",
             "added_for": "grow", "reason": "natural follow-up Q"},
            "5829205",  # I'm a priest.
            "2648867",  # Are you a priest?
        ],

        # ===========================================================
        # === Airport — slimmed, varied ===
        # ===========================================================
        [
            "1356130",  # The airport is closed.
            "923938",   # I can drop you off at the airport tonight.
            {"text": "That would be a huge help.",
             "added_for": "huge|help", "reason": "warm reply accepting offer"},
            "2153284",  # You should allow an hour to get to the airport.
            "5282543",  # Which bus goes to the airport?
            "3854772",  # Can you recommend a hotel near the airport?
            "403053",   # Where's the airport?
            "264267",   # The next train to the airport departs from platform 2.
        ],
        [
            "253173",   # I have to go to the airport to meet my cousin.
            "18195",    # I went to the airport by taxi.
            "251161",   # Long: When my uncle left for America, many people came to see him off at the airport.
        ],

        # ===========================================================
        # === Weird — slimmed ===
        # ===========================================================
        [
            "2218050",  # You're acting weird.
            "1341215",  # He's a weird guy.
            "47238",    # There was something weird about the incident.
            {"text": "What exactly happened?",
             "added_for": "exactly|happened", "reason": "natural follow-up Q"},
            "3132836",  # There's something weird happening.
            "5135010",  # Something's really weird here.
        ],

        # ===========================================================
        # === Forever — slimmed, vocab varied ===
        # ===========================================================
        [
            "1134317",  # Nobody lives forever.
            "1376",     # Humans were never meant to live forever.
            "2093222",  # I intend to live forever.
            {"text": "That's an ambitious plan.",
             "added_for": "ambitious|plan", "reason": "wry reply"},
            "2487177",  # A true friendship will last forever.
            "4867405",  # I know that nothing lasts forever.
            "4133572",  # I thought that we'd be together forever.
            "1954902",  # I can't stand the thought of losing you forever.
            "2273980",  # You can't hide forever.
        ],
        [
            "2253150",  # I'm afraid I'll be stuck in this place forever.
            "4499726",  # I'll be forever grateful.
        ],

        # ===========================================================
        # === War zone / time zones / location ===
        # ===========================================================
        [
            "3635926",  # It's like a war zone there.
            "6477778",  # We're in the same time zone.
            "4657585",  # We talked about time zones.
            "4014713",  # What is your present location?
            "4500715",  # Prices vary by location.
            "3238886",  # We should move to a safer location.
            "3127851",  # I suggest we move to a safer location.
        ],

        # ===========================================================
        # === Suspect / identify ===
        # ===========================================================
        [
            "5364118",  # One suspect has been identified.
            "2111658",  # Identify yourself.
            "2249795",  # Please identify yourself.
            "2249796",  # Please identify yourselves.
            "681182",   # Can you identify which coat is yours?
            "5806510",  # Deer tracks are easy to identify.
            "978006",   # Long: The boy who had been missing was identified by his clothes.
        ],
        [
            "3726067",  # I'm under suspicion, too.
            "3731239",  # Am I under suspicion?
            {"text": "Not at this point.",
             "added_for": "point", "reason": "natural reassuring reply"},
            "3727367",  # I've had my suspicions.
            "3820422",  # I had my suspicions.
            "2149282",  # Have you noticed anything suspicious?
            "2291182",  # I didn't notice anything suspicious.
            "2057844",  # You can't blame me for being suspicious.
            "5204545",  # Did they find anything odd or suspicious?
        ],

        # ===========================================================
        # === Officers / arrested ===
        # ===========================================================
        [
            "4499436",  # No officers were hurt.
            "4500263",  # No police officers were injured.
            "5298768",  # Three officers were wounded.
            "4495728",  # Officers arrested one person.
            "4495715",  # The officers arrested three of the protesters.
            "4493770",  # There were three uniformed police officers at the crime scene.
        ],

        # ===========================================================
        # === Surgery / operation / specialist ===
        # ===========================================================
        [
            "4501770",  # Surgery was required.
            "2391517",  # I recently had surgery.
            "858855",   # She decided to have surgery.
            "2331648",  # I had back surgery a couple of months ago.
            "2954983",  # You're not scheduled for surgery.
            "309751",   # Long: Her mother is going to undergo a major operation next week.
            "295015",   # He underwent a risky operation.
            "3024060",  # My doctor suggested that I see a specialist in Boston.
            "4017112",  # Long: Dr. Jackson is one of the best heart specialist in Australia.
        ],

        # ===========================================================
        # === Jail / prison / innocent ===
        # ===========================================================
        [
            "73416",    # Ten prisoners broke out of jail.
            "4014952",  # There are many innocent men in jail.
            "2308055",  # I could actually go to jail for doing this.
            "5811781",  # Do you want to spend the rest of your life in jail?
            {"text": "Of course not.",
             "added_for": "course", "reason": "natural emphatic N reply"},
            "2891771",  # Nobody's going to jail.
            "4500369",  # Dozens were jailed.
            "4500367",  # Both of the Jackson brothers have been jailed.
            "954603",   # Long: When I got out of jail, I had no intention of committing another crime.
        ],

        # ===========================================================
        # === Disappointed — slimmed ===
        # ===========================================================
        [
            "5254971",  # I'm obviously disappointed.
            "5257337",  # I'm disappointed and angry.
            "5659270",  # I'm surprised and disappointed.
            {"text": "I can understand why.",
             "added_for": "why", "reason": "empathic reply"},
            "4879979",  # I'm disappointed with your performance.
            "4880001",  # It's OK to be disappointed.
            "3188105",  # I disappointed my teachers.
            "2954866",  # You'd probably be disappointed.
            "255075",   # I was disappointed to hear the test results.
            "263073",   # Long: We were disappointed with the results of the experiment.
            "33716",    # Long: I was disappointed to see that my bonus was a bit less than I was expecting.
        ],
        [
            "284416",   # Don't disappoint him.
            "4879994",  # It was disappointing to lose.
            "4879999",  # It was a disappointing loss.
            "4664015",  # That would be terribly disappointing.
            "1310677",  # I was bitterly disappointed.
        ],

        # ===========================================================
        # === Hockey / cartoons ===
        # ===========================================================
        [
            "4500110",  # I'm a hockey fan.
            "908715",   # Who's your favorite hockey player?
            {"text": "I don't follow it closely.",
             "added_for": "follow|closely", "reason": "natural reply hedging knowledge"},
            "4495988",  # Long: Things will be pretty quiet around here until hockey season begins.
            "1964118",  # I like cartoons.
            "906710",   # What's your favorite cartoon?
            "2954193",  # Who's your favorite cartoon character?
        ],

        # ===========================================================
        # === Lab / experiment / hypothesis ===
        # ===========================================================
        [
            "3431322",  # The lab is empty.
            "3568439",  # I'm not your lab assistant.
            "2540430",  # There was an explosion in the lab.
            "953067",   # A bunch of people died in the explosion.
            "3735905",  # That's an interesting hypothesis.
            "55284",    # This data supports the hypothesis.
            "39648",    # The data hasn't been compiled yet.
            "4496955",  # No correlation was found.
            "4665316",  # Is there a direct correlation?
            "4502384",  # The study is biased.
            "5057505",  # This is a biased article.
            "5646231",  # I know I have a biased opinion.
        ],

        # ===========================================================
        # === Participate / participants ===
        # ===========================================================
        [
            "4501345",  # Anyone can participate.
            "3821606",  # I wanted to participate.
            "5677554",  # I'm excited about participating.
            "5222594",  # I persuaded my brother to participate.
            "291193",   # He participated in the debate.
            "816083",   # I didn't participate in the conversation.
            "64815",    # Long: The most important thing in the Olympics is not to win but to participate.
            "4662711",  # Long: I probably would've participated if I'd known about it in advance.
        ],
        [
            "5137600",  # All participants must be registered.
            "4495524",  # All the participants seemed to agree.
            "5137569",  # All participants will receive a T-shirt.
        ],

        # ===========================================================
        # === Solar / Mars / planets ===
        # ===========================================================
        [
            "275029",   # Let's talk about solar energy.
            "4241443",  # Solar power is a clean source of energy.
            "5322727",  # The sun is at the center of our solar system.
            "22212",    # Neptune is the eighth planet of the solar system.
            "49345",    # The house is heated by solar energy.
            "1042257",  # I wish I had solar-powered car.
            "2079905",  # Mars has two moons.
            "2912262",  # How many moons does Mars have?
            {"text": "Two — Phobos and Deimos.",
             "added_for": "two", "reason": "natural informative answer"},
            "5322691",  # Mars is half the size of Earth.
            "4575991",  # Scientists have found water on Mars.
            "23787",    # It won't be long before we can travel to Mars.
        ],

        # ===========================================================
        # === Robots ===
        # ===========================================================
        [
            "293377",   # He made a robot.
            "4567809",  # I'm not a robot.
            "1886079",  # Do you like robots?
            "4502751",  # Why not use robots?
            {"text": "They lack judgment.",
             "added_for": "judgment", "reason": "thoughtful N reply"},
        ],

        # ===========================================================
        # === Aliens / sci-fi ===
        # ===========================================================
        [
            "4297008",  # Let's pretend we're aliens.
            "953642",   # Long: I think it's unlikely that aliens similar to what we see in the movies have ever visited our planet.
        ],

        # ===========================================================
        # === Statistics / data ===
        # ===========================================================
        [
            "4890804",  # What do these statistics mean?
            "5162820",  # According to statistics, world population is on the rise.
            "4487310",  # The statistics are in our favor.
            "4502075",  # The statistics are shocking.
            "2196900",  # How many categories are there?
            {"text": "There are four major ones.",
             "added_for": "four|major", "reason": "natural number answer"},
        ],

        # ===========================================================
        # === Outstanding / offensive / offended ===
        # ===========================================================
        [
            "2111416",  # That's outstanding.
            "2111419",  # That's offensive.
            "4494183",  # That gesture is offensive.
            "1582097",  # Does it offend you?
            "4498030",  # Who did you offend?
            "2542353",  # I'm sorry, I meant no offence.
            "4303541",  # I was terribly offended.
            "4999839",  # I'm deeply offended by this.
            "2291876",  # I apologize if I offended you.
            "3382875",  # I'm not easily offended.
        ],

        # ===========================================================
        # === Cabinet / filter ===
        # ===========================================================
        [
            "5939625",  # I opened the cabinet.
            "2643808",  # Why is this cabinet locked?
            {"text": "I have no idea.",
             "added_for": "idea", "reason": "natural reply"},
            "5850981",  # Have you changed the filter?
            "5851679",  # Did you change the filter?
            "5834515",  # When was the last time you replaced the filter?
        ],

        # ===========================================================
        # === Gang / crime / racist ===
        # ===========================================================
        [
            "2549709",  # I'm in a gang.
            "72657",    # Long: A gang of three robbed the bank in broad daylight.
            "1061427",  # You're a racist.
            "317854",   # The secret leaked out.
            "276175",   # Someone leaked the secret to the enemy.
        ],

        # ===========================================================
        # === Rural / countryside ===
        # ===========================================================
        [
            "681978",   # Have you ever lived in a rural area?
            {"text": "Yes, for several years.",
             "added_for": "several|years", "reason": "natural Y answer"},
            "4501786",  # This is residential property.
            "4501335",  # This part of town is mainly residential.
            "2305204",  # The countryside is beautiful.
            "3825543",  # I want to move to the countryside.
        ],

        # ===========================================================
        # === Bunch ===
        # ===========================================================
        [
            "953069",   # A bunch of people were standing outside waiting.
            "953068",   # A bunch of people told me not to eat there.
            "3013398",  # I lost a bunch of keys.
            "2544618",  # They're a bunch of losers.
        ],

        # ===========================================================
        # === Navy / military / patrol / enemy ===
        # ===========================================================
        [
            "1610534",  # I joined the navy.
            "2033604",  # Why do you want to join the navy?
            {"text": "It runs in the family.",
             "added_for": "runs|family", "reason": "natural reply"},
            "2179919",  # I'm an ex-marine.
            "2549548",  # I was on patrol.
            "4529495",  # The enemy is approaching rapidly.
        ],

        # ===========================================================
        # === Transportation / transit ===
        # ===========================================================
        [
            "2641587",  # We have no means of transportation.
            "4502674",  # There is no public transportation around here.
            "2642036",  # Transportation has been arranged.
            "2359013",  # I've arranged transportation for us back to Boston.
            "2248042",  # I'm in transit.
        ],

        # ===========================================================
        # === Ultimately / mutual decision ===
        # ===========================================================
        [
            "4497141",  # Who will ultimately decide?
            "4016476",  # It was a mutual decision.
            "1806265",  # The feeling is mutual.
            "2953629",  # We have a mutual friend.
            "5838575",  # The attraction was mutual.
        ],

        # ===========================================================
        # === Carbon copy / family resemblance ===
        # ===========================================================
        [
            "289441",   # He's a carbon copy of his father.
            "310595",   # She resembles her aunt.
            "303329",   # He closely resembles his father.
            "322348",   # My sister resembles my mother.
            "46625",    # That girl resembles her mother.
            "1356728",  # Long: Mary resembles her mother in looks, but not in personality.
            "4889786",  # Do you see a resemblance?
            "5640431",  # I don't see any resemblance.
        ],

        # ===========================================================
        # === Empire / Ten Commandments ===
        # ===========================================================
        [
            "1476552",  # You can see the Empire State Building from here.
            "909555",   # Long: She spends a little time each day reading the Bible.
            "2288891",  # Don't you remember the Ten Commandments?
            {"text": "Vaguely.",
             "added_for": "vaguely", "reason": "natural hedged reply"},
        ],

        # ===========================================================
        # === Contest / competition / casualty ===
        # ===========================================================
        [
            "3738759",  # Who won the contest?
            "2325177",  # I entered a singing contest.
            "4016583",  # It was a friendly contest.
            "4567880",  # It's not a beauty contest.
            "680826",   # Did you enter the singing contest?
            "4500431",  # The number of casualties is still unknown.
            "4501745",  # There have been no reports of casualties.
            "3168082",  # We've got one casualty.
            "1950649",  # We can't afford any more casualties.
            "2245071",  # Casualties were inevitable.
        ],

        # ===========================================================
        # === Sources / nutrition ===
        # ===========================================================
        [
            "4744174",  # What are some good sources of protein?
            "4744158",  # Are eggs a good source of protein?
            {"text": "Yes, eggs are an excellent source.",
             "added_for": "excellent", "reason": "natural Y answer"},
            "566121",   # Long: A liter of milk contains about thirty grams of protein.
            "2693486",  # Cook 300 grams of rice.
        ],

        # ===========================================================
        # === Boost / restraint / solo ===
        # ===========================================================
        [
            "3151560",  # Give me a boost.
            "1933572",  # I appreciate your restraint.
            "4530034",  # I admire your restraint.
            "2078122",  # I hope you practiced your solo.
            "25909",    # The concert began with a piano solo.
        ],

        # ===========================================================
        # === Decent / decent meal / decent wage ===
        # ===========================================================
        [
            "3150733",  # I want to buy a decent guitar.
            "2033882",  # What we want is a chance to earn a decent living.
            "1144626",  # Long: If you want your workers to be happy, you need to pay them a decent wage.
            "301622",   # Long: He has not eaten a decent meal in a long time.
        ],

        # ===========================================================
        # === Defensive / aggressive / immune ===
        # ===========================================================
        [
            "2270304",  # Don't be so defensive.
            "2892904",  # Why are you so defensive?
            {"text": "I'm not — you're imagining it.",
             "added_for": "imagining", "reason": "natural deflective reply"},
            "2202555",  # You're aggressive.
            "4494776",  # Dogs are territorial.
            "2111274",  # They're immune.
        ],

        # ===========================================================
        # === Rapid progress / gradually ===
        # ===========================================================
        [
            "293996",   # He has made rapid progress in English.
            "285555",   # I'm amazed at his rapid progress in English.
            "3045693",  # The fire spread rapidly.
            "4496404",  # Things are changing rapidly.
            "44807",    # Boston has grown rapidly in the last ten years.
            "326234",   # The train gained speed gradually.
            "5057963",  # The sound gradually died away.
            "1337337",  # It's gradually getting colder.
            "4664473",  # The noise gradually became louder.
        ],

        # ===========================================================
        # === Funeral / grief ===
        # ===========================================================
        [
            "2045861",  # I thought it was a beautiful funeral service.
            "2359761",  # I've got to make funeral arrangements.
            "3573703",  # I hate funerals.
            "4483717",  # People don't usually tell jokes at funerals.
            "4850069",  # Everybody deals with grief differently.
            {"text": "There's no right way to mourn.",
             "added_for": "mourn|right", "reason": "thoughtful reply"},
        ],

        # ===========================================================
        # === Resort to violence / attribute / violate ===
        # ===========================================================
        [
            "321217",   # Don't resort to violence.
            "305034",   # Long: I hope they don't resort to violence to accomplish their goals.
            "298541",   # He attributed his success to hard work.
            "298794",   # He attributes his success to good luck.
            "4665282",  # That would violate our policy.
            "20231",    # You must not violate the regulations.
            "20218",    # Those who violate the rules will be punished.
            "2955106",  # You've violated our trust.
            "2955077",  # You're violating my civil rights.
            "4494406",  # What was the violation?
        ],

        # ===========================================================
        # === Collar / stain ===
        # ===========================================================
        [
            "17397",    # Your collar has a stain on it.
            "3825671",  # I grabbed the dog by its collar.
            "3121794",  # The dog's collar is red.
        ],

        # ===========================================================
        # === Summary / thesis ===
        # ===========================================================
        [
            "324917",   # Please send in your summary by Tuesday.
            "326502",   # Have you finished writing your thesis?
            "4198387",  # I have a thesis to write.
            {"text": "How many pages so far?",
             "added_for": "pages", "reason": "natural follow-up"},
            "2248448",  # Is it comprehensive?
        ],

        # ===========================================================
        # === Explicit / unclear ===
        # ===========================================================
        [
            "3328176",  # Can you be more explicit?
            "252750",   # Long: I gave you explicit instructions not to touch anything.
            "4496352",  # The cause was unclear.
            "4496589",  # The reasons are unclear.
            "4496595",  # Its origin is unclear.
        ],

        # ===========================================================
        # === Fate / destiny ===
        # ===========================================================
        [
            "3723471",  # I will accept my fate.
            "4501958",  # Our fate was sealed.
            "4665513",  # Take control of your destiny.
            "2030469",  # Everyone ought to be the master of his own destiny.
            "5897268",  # You can't cheat fate.
            "2218421",  # You're tempting fate.
        ],

        # ===========================================================
        # === Profit / fame / fortune ===
        # ===========================================================
        [
            "322897",   # Profit is better than fame.
            "915886",   # It's worth a fortune.
            "289648",   # He is bound to make a fortune.
            "5138174",  # This must've cost a small fortune.
            "265610",   # Long: It cost me a fortune to get my car repaired.
            "52528",    # John inherited a large fortune.
            "250191",   # Long: My sixty-year-old aunt inherited the huge estate.
            "3819013",  # How much did you inherit from your uncle?
            "292379",   # He accumulated a large fortune.
            "3313068",  # We could've made a fortune.
        ],

        # ===========================================================
        # === Alert / mindful ===
        # ===========================================================
        [
            "2111518",  # Stay alert.
            "3185401",  # Drinking coffee may help you stay alert.
            "4980983",  # I'm very mindful of that.
        ],

        # ===========================================================
        # === Diversity / overnight ===
        # ===========================================================
        [
            "4495198",  # Diversity is good.
            "4499929",  # I like the diversity.
            "4499167",  # Nothing happens overnight.
            "5850840",  # That won't happen overnight.
            "63033",    # Long: The delay forced us to stay overnight in an expensive hotel.
            "4662696",  # Long: If you create a popular app, you could become a millionaire overnight.
        ],
        [
            "3137184",  # This isn't very sophisticated technology.
            "3137185",  # This is a very sophisticated device.
        ],

        # ===========================================================
        # === Underground / disguise / captivity ===
        # ===========================================================
        [
            "2243222",  # They live underground.
            "303607",   # He was held in captivity.
            "1316537",  # Long: He entered the bank disguised as a guard.
            "28035",    # Long: I'm planning to disguise myself as a doctor.
            "887087",   # She disguised herself as him.
            "299469",   # He disguised himself as a woman.
        ],

        # ===========================================================
        # === First aid / wounded / injured ===
        # ===========================================================
        [
            "4014896",  # Bring me the first aid kit.
            "3619264",  # I have a first aid kit in the bathroom.
            "5137602",  # About thirty villagers were injured.
            "4708898",  # Put some ice on your ankle to keep the swelling down.
            "4502731",  # It's a massive undertaking.
            "4502730",  # This is a huge undertaking.
        ],

        # ===========================================================
        # === Manual / drive ===
        # ===========================================================
        [
            "601741",   # Can you drive a manual transmission?
            {"text": "Yes, I learned on one.",
             "added_for": "learned", "reason": "natural Y answer"},
            "3155633",  # Put both hands on the steering wheel.
            "5850165",  # I shifted gears.
        ],

        # ===========================================================
        # === Documentaries ===
        # ===========================================================
        [
            "2628699",  # I'm watching a documentary.
            "2628696",  # I sometimes watch documentaries.
            "5325017",  # I rarely watch documentaries.
            "6096317",  # This is the funniest movie I've seen in a long time.
        ],

        # ===========================================================
        # === Domain / scan / upload / hack ===
        # ===========================================================
        [
            "953389",   # Long: I can't figure out how to register a new domain name.
            "2396055",  # How do we upload photos to your website?
            "2396053",  # How can I upload a photo to your website?
            "953138",   # Long: As soon as I can get my son to scan our family photos, I'll upload some of them to our website.
            "1293172",  # My father quickly scanned the newspaper.
            "3731487",  # Did you fix the scanner?
            "2020446",  # I have to buy a new scanner.
            "953558",   # Long: I never thought it'd be this easy to hack into your website.
            "269484",   # We hacked a path through the forest.
            "5834808",  # How can I keep my email account from getting hacked?
            "2290309",  # I didn't hack into anybody's computer.
        ],

        # ===========================================================
        # === Agenda / item / proceed ===
        # ===========================================================
        [
            "4017304",  # What else is on today's agenda?
            "3392626",  # Let's move on to the next item on the agenda.
            "20015",    # Let's proceed with the items on the agenda.
            "4497235",  # Details will be forthcoming.
        ],

        # ===========================================================
        # === Summit / mountain ===
        # ===========================================================
        [
            "3107382",  # We didn't reach the summit.
            "248220",   # We finally got to the summit.
            "245097",   # The view from the mountain top was spectacular.
            "2255287",  # You were spectacular.
            "2837921",  # May I see your birth certificate?
        ],

        # ===========================================================
        # === Allies / enemies / mission ===
        # ===========================================================
        [
            "3826800",  # They're allies.
            "3010103",  # Enemies of enemies aren't always allies.
            "3010102",  # An enemy of an enemy is not necessarily an ally.
            "2026403",  # I want to be your ally, not your enemy.
        ],

        # ===========================================================
        # === Auction / executed / condemned ===
        # ===========================================================
        [
            "4494878",  # The auction is over.
            "4498281",  # The auction ends Monday.
            "25637",    # The king was executed.
            "5852495",  # Both men were executed.
            "297237",   # He was condemned to death.
            "2492892",  # This building has been condemned.
        ],

        # ===========================================================
        # === Encounter / problems ===
        # ===========================================================
        [
            "2663321",  # Did you encounter any problems?
            "2662959",  # We haven't encountered any new problems.
            "953273",   # Long: From personal experience, I know that any encounter with him will leave a bad taste in your mouth.
            "4499869",  # I made some inquiries.
        ],

        # ===========================================================
        # === Guardian angels / saint ===
        # ===========================================================
        [
            "3533901",  # Do you believe in guardian angels?
            "2218225",  # You're no saint.
        ],

        # ===========================================================
        # === Offense / defense ===
        # ===========================================================
        [
            "4499831",  # I like playing offense.
            "3501296",  # The best defense is a good offense.
        ],

        # ===========================================================
        # === Guidelines / strict ===
        # ===========================================================
        [
            "5656503",  # I'm following the guidelines.
            "2953675",  # We have very strict guidelines here.
            "271365",   # My interest in politics is strictly academic.
        ],

        # ===========================================================
        # === Trigger / pull / squeeze ===
        # ===========================================================
        [
            "2249833",  # Pull the trigger.
            "2270521",  # Don't pull the trigger.
            "3819092",  # I pulled the trigger.
            "4499820",  # I squeezed the trigger.
            "2250000",  # Squeeze the trigger.
        ],

        # ===========================================================
        # === Artificial ===
        # ===========================================================
        [
            "42254",    # It's an artificial flower.
            "248924",   # We skied on artificial snow.
        ],

        # ===========================================================
        # === Neutral / Switzerland / diplomat ===
        # ===========================================================
        [
            "2111707",  # I'm neutral.
            "52442",    # Switzerland is a neutral country.
            "2202761",  # We're diplomatic.
            "4834914",  # You should be a diplomat.
            "2361768",  # I want to become a diplomat.
        ],

        # ===========================================================
        # === Controversial ===
        # ===========================================================
        [
            "3562568",  # This idea is controversial.
            "5360706",  # That's a controversial theory.
            "1446472",  # This movie is highly controversial.
        ],

        # ===========================================================
        # === Implement / opponents ===
        # ===========================================================
        [
            "5363910",  # The plan was never implemented.
            "1578759",  # I have no opponents.
            "4494238",  # They were good opponents.
        ],

        # ===========================================================
        # === Palm / portrait ===
        # ===========================================================
        [
            "5774427",  # Let me read your palm.
            "1936436",  # Long: I'd like to hire you to paint a portrait of me.
            "326424",   # Long: A portrait of an old man was hanging on the wall.
        ],

        # ===========================================================
        # === Vulnerable / privilege ===
        # ===========================================================
        [
            "5850973",  # I'm vulnerable.
            "2713170",  # It's a privilege to meet you.
            "4873484",  # Rank has its privileges.
        ],

        # ===========================================================
        # === Communicate ===
        # ===========================================================
        [
            "909573",   # Long: Studying how to communicate effectively is time well spent.
            "909549",   # Long: Last year I spent so much time by myself that I almost forgot how to communicate effectively with others.
            "3310043",  # We've been communicating regularly.
        ],

        # ===========================================================
        # === Patch / fabric ===
        # ===========================================================
        [
            "2820937",  # My mother had to patch my pants.
            "3825957",  # How much fabric did you buy?
            {"text": "Enough for a dress.",
             "added_for": "dress", "reason": "natural answer"},
        ],

        # ===========================================================
        # === Bulk / save ===
        # ===========================================================
        [
            "4496228",  # You could save money by buying in bulk.
            "3150782",  # I buy canned goods in bulk.
            "3150781",  # I buy stationery in bulk.
        ],

        # ===========================================================
        # === Sheep / cattle / cows ===
        # ===========================================================
        [
            "5251744",  # Sheep eat grass.
            "4826303",  # Most wool comes from sheep.
            "19486",    # I raise cattle.
            "1970391",  # We have ten head of cattle.
            "275534",   # Long: On large farms, cattle are usually marked with brands.
            "3473766",  # Cows are considered sacred animals in India.
        ],

        # ===========================================================
        # === Clue / barrel ===
        # ===========================================================
        [
            "2563243",  # I have no clue.
            "2134093",  # I have no clue what you're talking about.
            "2249553",  # Look for clues.
            "2783438",  # Did you find any clues?
            "2006409",  # It's like shooting fish in a barrel.
            "4828321",  # Long: The price of oil has dipped below $30 a barrel.
        ],

        # ===========================================================
        # === Lap ===
        # ===========================================================
        [
            "3222950",  # Come, sit on my lap.
            "322607",   # Everything fell into my lap.
            "2951905",  # How many laps do you usually swim?
        ],

        # ===========================================================
        # === Dam / lake ===
        # ===========================================================
        [
            "2353392",  # I live near a dam.
            "60907",    # Long: This dam supplies us with water and electricity.
            "253989",   # I went skating on the lake.
        ],

        # ===========================================================
        # === Tropical / migrate ===
        # ===========================================================
        [
            "58601",    # Long: This kind of plant grows only in the tropical regions.
            "3360144",  # I wonder why birds migrate.
        ],

        # ===========================================================
        # === Parade / clapping / applause ===
        # ===========================================================
        [
            "6040165",  # The parade will start at 2:30.
            "262835",   # We saw the parade move down the street.
            "2258082",  # A crowd of people gathered to see the parade.
            "324703",   # There were more spectators than I had expected.
            "4665997",  # The crowd began to applaud.
            "1172529",  # I couldn't resist the urge to applaud.
            "2245452",  # Everyone started clapping.
            "5414447",  # Everybody was clapping.
            "4495002",  # There was applause.
        ],

        # ===========================================================
        # === Satisfaction / satisfactory ===
        # ===========================================================
        [
            "2245670",  # I demand satisfaction.
            "2329564",  # I get a lot of satisfaction out of my work.
            "70321",    # Your speech was far from satisfactory.
            "1299727",  # Long: It was impossible to come up with a really satisfactory solution.
            "2245483",  # Everything's quite satisfactory.
            "3734290",  # Everything's quite informal.
        ],
        [
            "2313720",  # I demand a refund.
            "3109106",  # I asked for a refund.
            "5659973",  # I certainly would like a refund.
            "5671896",  # You should ask for a refund.
            "5671900",  # May I return this for a refund?
            {"text": "Of course, do you have the receipt?",
             "added_for": "receipt", "reason": "natural follow-up Q"},
        ],

        # ===========================================================
        # === Bubble / bounce ===
        # ===========================================================
        [
            "1860502",  # Don't burst my bubble.
            "2255348",  # You'll bounce back.
            "5859397",  # I bounced the ball.
        ],

        # ===========================================================
        # === Tackle ===
        # ===========================================================
        [
            "1272891",  # Could you tackle this?
            "2006392",  # Long: That tackle box looks a lot like mine.
        ],

        # ===========================================================
        # === Pregnant / nephew ===
        # ===========================================================
        [
            "5819682",  # Mary is pregnant with twins.
            "3568157",  # My wife's pregnant.
            "4132508",  # My nephew is getting married tomorrow.
            {"text": "Congratulations to the family!",
             "added_for": "congratulations|family", "reason": "warm reply"},
        ],

        # ===========================================================
        # === Harsh ===
        # ===========================================================
        [
            "273584",   # Long: I hope my last mail didn't sound too harsh.
        ],

        # ===========================================================
        # === Miracle ===
        # ===========================================================
        [
            "488978",   # It was truly a miracle.
            "1140091",  # It's a miracle that you were able to survive.
            "2567705",  # Don't expect miracles.
            "3129829",  # Miracles do happen.
        ],

        # ===========================================================
        # === Valve / leak ===
        # ===========================================================
        [
            "1165797",  # The main valve is turned off.
            "2245564",  # Here's the leak.
            "3189143",  # There's a gas leak.
            "2301304",  # I can seal the leak.
            "3350121",  # I helped fix the leak.
            "326380",   # The leak needs to be stopped immediately.
            "3724312",  # That'll stop the leak.
            "2259691",  # This bucket leaks.
            "843957",   # The roof leaks.
            "41125",    # The tire leaks air.
            "1662646",  # This can is leaking.
            "1829527",  # The roof is leaking.
        ],

        # ===========================================================
        # === Ham / sandwich ===
        # ===========================================================
        [
            "292421",   # He likes ham and eggs.
            "2380442",  # I made you a ham sandwich.
            "2711599",  # Would you like some ham for breakfast?
            {"text": "That would be lovely, thanks.",
             "added_for": "lovely", "reason": "warm reply accepting"},
            "35093",    # Would you slice me a piece of ham, please?
            "5852436",  # I sliced the ham.
            "5137597",  # The ham sandwiches were really good.
        ],

        # ===========================================================
        # === Rap / DJ ===
        # ===========================================================
        [
            "2310",     # Do you like rap?
            "1383444",  # He's a DJ.
            "5859508",  # I'm a disc jockey.
        ],

        # ===========================================================
        # === Order / brutal / furious ===
        # ===========================================================
        [
            "2645477",  # Order has been restored.
            "5777161",  # We restore antique furniture.
            "2891571",  # It's going to be brutal.
            "3158684",  # Right now, I'm furious.
            "3158685",  # It was a furious battle.
        ],

        # ===========================================================
        # === Minimal ===
        # ===========================================================
        [
            "3226490",  # The danger is minimal.
            "4497105",  # The damage was minimal.
        ],

        # ===========================================================
        # === Drill / familiar ===
        # ===========================================================
        [
            "1682671",  # You know the drill.
            "2194324",  # I know the drill.
        ],

        # ===========================================================
        # === Pine ===
        # ===========================================================
        [
            "4141385",  # Where do pine nuts come from?
            "272192",   # Long: There used to be a big pine tree in front of my house.
        ],

        # ===========================================================
        # === Bee / sting ===
        # ===========================================================
        [
            "275959",   # I'm busy as a bee.
            "2160726",  # A bee sting can be very painful.
            "4496124",  # Long: If you don't bother the bees, they're unlikely to sting you.
            "23754",    # Flowers attract bees.
            "32263",    # Bees make honey.
        ],

        # ===========================================================
        # === Vacuum / cleaner ===
        # ===========================================================
        [
            "3329802",  # Can't you vacuum later?
            "2953157",  # It's your turn to vacuum the house.
            "3825714",  # How old is this vacuum cleaner?
            "58038",    # This vacuum cleaner makes a lot of noise.
            "870412",   # Cats hate vacuum cleaners.
        ],

        # ===========================================================
        # === Architect ===
        # ===========================================================
        [
            "324465",   # A famous architect built this house.
            "55378",    # Long: This is the house which was designed by a famous architect.
        ],

        # ===========================================================
        # === Frustration / frustrated ===
        # ===========================================================
        [
            "723668",   # They grew frustrated.
            "4496637",  # Is the coach frustrated?
            "4915757",  # I've been getting frustrated lately.
            "2952400",  # I realize how frustrated you must be.
            "1839513",  # I understand your frustration.
            "4498774",  # There has been frustration.
            "4915748",  # It's incredibly frustrating.
            "4498773",  # This is beyond frustrating.
            "4915752",  # That must've been frustrating.
        ],

        # ===========================================================
        # === Myth / rebel ===
        # ===========================================================
        [
            "1897778",  # That's a myth.
            "2248118",  # I'm no rebel.
            "2241505",  # We were rebels.
        ],

        # ===========================================================
        # === Subtle ===
        # ===========================================================
        [
            "5135009",  # There were subtle differences.
            "3409083",  # Am I being too subtle?
            "50742",    # Long: There are subtle differences between the two pictures.
        ],

        # ===========================================================
        # === Widow ===
        # ===========================================================
        [
            "2280383",  # Mary is a widow.
            "318701",   # Long: A woman whose husband is dead is called a widow.
        ],

        # ===========================================================
        # === Horizon / sunrise ===
        # ===========================================================
        [
            "277247",   # The sun appeared on the horizon.
            "277248",   # I saw the moon above the horizon.
            "1356395",  # I can see a ship on the horizon.
            "275075",   # The sun sank below the horizon.
            "6480731",  # We'll attack at sunrise.
            "2267146",  # I woke up at sunrise.
            "4203528",  # Long: Did you see the sunrise earlier? It was really beautiful.
        ],

        # ===========================================================
        # === Attention span ===
        # ===========================================================
        [
            "6102141",  # I have a short attention span.
            "4663394",  # Young children have short attention spans.
            "5596935",  # Long: Young children usually have short attention spans.
        ],

        # ===========================================================
        # === Tremendous ===
        # ===========================================================
        [
            "1797171",  # It's a tremendous deal.
            "4494048",  # The pressure was tremendous.
        ],

        # ===========================================================
        # === High heels ===
        # ===========================================================
        [
            "5070077",  # Mary often wears high heels.
            "3469757",  # Mary loves shoes with high heels.
        ],

        # ===========================================================
        # === Pulse / heart ===
        # ===========================================================
        [
            "322672",   # My pulse is fast.
            "70377",    # Your pulse is normal.
            "3319244",  # Let me check your pulse.
            "3319241",  # The patient doesn't have a pulse anymore.
            "318640",   # I have an irregular pulse.
            "3319239",  # Long: The police officer checked to see if the body lying on the ground had a pulse.
        ],

        # ===========================================================
        # === Subscription / magazine ===
        # ===========================================================
        [
            "72178",    # I have a subscription to Time.
            "3820498",  # I haven't renewed my subscription.
            "1292939",  # What newspaper do you subscribe to?
            "25104",    # Do you subscribe to any magazines?
            {"text": "Just one or two.",
             "added_for": "one|two", "reason": "natural hedged answer"},
        ],

        # ===========================================================
        # === Ego / unhappy / wealth / enthusiasm ===
        # ===========================================================
        [
            "2254542",  # What an ego!
            "413025",   # Long: Even with all his wealth and fame, he's unhappy.
            "1933581",  # I appreciate your enthusiasm.
            "509645",   # Long: I can't say I share your enthusiasm for the idea.
        ],

        # ===========================================================
        # === Stakes ===
        # ===========================================================
        [
            "1598344",  # The stakes are high.
            "4502269",  # The stakes were enormous.
        ],

        # ===========================================================
        # === Delicate / nonsense / sheer ===
        # ===========================================================
        [
            "2173701",  # It's a delicate situation.
            "2663481",  # That's a delicate problem.
            "5200631",  # It's a very delicate subject.
            "2953333",  # That's utter nonsense.
            "3281682",  # That's an utter waste of time.
            "5948227",  # This is sheer nonsense.
        ],

        # ===========================================================
        # === Rumors ===
        # ===========================================================
        [
            "2248399",  # I've heard rumors.
            "269936",   # You can't trust rumors.
            "4499280",  # Have you heard the latest rumors?
            "558332",   # Long: I can neither confirm nor deny the rumors.
            "4493606",  # Rumors have been circulating.
        ],

        # ===========================================================
        # === Voluntary / wheat / flour ===
        # ===========================================================
        [
            "2249138",  # It's not voluntary.
            "527160",   # We grow wheat here.
            "65993",    # When will you harvest your wheat?
            "247874",   # We import flour from America.
            "1312793",  # Put the flour on the shelf.
        ],

        # ===========================================================
        # === Kindness ===
        # ===========================================================
        [
            "65804",    # Thank you very much for all your kindness.
            "286861",   # She thanked him for his kindness.
            "2539844",  # I wish we could repay your kindness.
            "2250080",  # Thanks a heap.
        ],

        # ===========================================================
        # === Thumb / hammer / forehead ===
        # ===========================================================
        [
            "294514",   # Long: He accidentally hit his thumb with the hammer.
            "3170742",  # Fortunately, I have a green thumb.
            "297798",   # He kissed me on the forehead.
        ],

        # ===========================================================
        # === Puppy ===
        # ===========================================================
        [
            "4977043",  # Please adopt this puppy.
            "3825736",  # Which puppy would you choose?
            "1566336",  # Mom bought a puppy for us.
            "5194623",  # I want a puppy for Christmas.
            "64057",    # Long: My father gave me a puppy for my birthday.
            "898520",   # When should I stop feeding my dog puppy food?
            "2208664",  # Puppies don't like to be left alone.
            "3824891",  # Puppies love to chew on everything.
            "762128",   # Long: The boy hugged the puppy to his chest.
        ],

        # ===========================================================
        # === Barn ===
        # ===========================================================
        [
            "3737581",  # The barn was empty.
            "4497231",  # The barn was destroyed.
            "2359148",  # I've been hiding behind the barn.
            "247319",   # We'll carry it to the barn.
            "5909327",  # I've finally finished painting the barn.
            "4144887",  # The old barn collapsed.
        ],

        # ===========================================================
        # === Facilitate / collaborate ===
        # ===========================================================
        [
            "5301580",  # I think I can facilitate that.
            "3096862",  # Maybe we could collaborate.
            "4497716",  # Why don't we collaborate more?
            {"text": "I'd be open to that.",
             "added_for": "open", "reason": "natural agreement reply"},
            "4493974",  # It was a collaborative effort.
            "4665392",  # We need a coordinated effort.
            "4663890",  # Schedules are difficult to coordinate.
            "4496756",  # We complement each other.
        ],

        # ===========================================================
        # === Pen pal ===
        # ===========================================================
        [
            "1264323",  # I want a pen pal.
            "5193190",  # I have a pen pal in Australia.
        ],

        # ===========================================================
        # === Poster ===
        # ===========================================================
        [
            "5085540",  # I saw an interesting poster yesterday.
            "5094808",  # Where are those posters now?
        ],

        # ===========================================================
        # === Prohibited ===
        # ===========================================================
        [
            "2717915",  # Smoking is prohibited.
            "2454569",  # Fishing is prohibited here.
            "1522174",  # It's prohibited in most countries.
            "2944652",  # The export of arms was prohibited.
            "319449",   # The export of weapons was prohibited.
            "913532",   # Hunting is prohibited in national parks.
            "6098514",  # Logging is prohibited.
        ],

        # ===========================================================
        # === Sneak / stalker ===
        # ===========================================================
        [
            "3728860",  # I didn't sneak out.
            "2275300",  # Don't sneak up on people.
            "3573723",  # Are you stalking me?
            "3726540",  # I'm not a stalker.
        ],

        # ===========================================================
        # === Atomic / bomb / explode ===
        # ===========================================================
        [
            "244024",   # The first atomic bomb was dropped on Japan.
            "2248785",  # It might explode.
            "4190406",  # The bomb will explode in 10 seconds.
            "3824805",  # How could it have exploded?
            "282614",   # When the bomb exploded, I happened to be there.
            "1124833",  # My head is exploding.
        ],

        # ===========================================================
        # === Circus ===
        # ===========================================================
        [
            "2672075",  # Life is one big circus.
            "3725911",  # The circus is in town.
        ],

        # ===========================================================
        # === Compelling story / novelist ===
        # ===========================================================
        [
            "5132654",  # That's a very compelling story.
            "295350",   # He is a teacher and novelist.
            "1048452",  # My friend's father is a famous novelist.
            "314485",   # She is not a poet but a novelist.
            "1427961",  # Long: In addition to being a doctor, he was a very famous novelist.
            "1427962",  # Long: Not only was he a doctor, he was also a very famous novelist.
        ],

        # ===========================================================
        # === Extension cord ===
        # ===========================================================
        [
            "2635008",  # I need an extension cord.
            "3962671",  # This extension cord is too short.
        ],

        # ===========================================================
        # === Jaw / sore / pain / endure ===
        # ===========================================================
        [
            "1405944",  # My jaw hurts.
            "3507572",  # My jaw is sore.
            "275228",   # My joints ache.
            "20353",    # My joints ache when it gets cold.
            "5859404",  # I endured the pain.
            "4902807",  # We've endured for long enough.
            "254580",   # Long: I could hardly endure the pain.
        ],

        # ===========================================================
        # === Portion / tub ===
        # ===========================================================
        [
            "5899630",  # The portions at this restaurant are generous.
            "5852731",  # I have a hot tub.
            "4012250",  # There's no water in the tub.
        ],

        # ===========================================================
        # === Whale ===
        # ===========================================================
        [
            "954007",   # Is eating whale meat wrong?
            "975342",   # I've never seen such a large whale.
            "238458",   # The whale is the largest animal on the earth.
        ],

        # ===========================================================
        # === Clash colors ===
        # ===========================================================
        [
            "2268992",  # Those colors clash.
        ],

        # ===========================================================
        # === Superb ===
        # ===========================================================
        [
            "1841611",  # It was superb.
            "3354515",  # You've done a superb job.
            {"text": "I had a lot of help.",
             "added_for": "help", "reason": "modest reply"},
        ],

        # ===========================================================
        # === Wit / scholar ===
        # ===========================================================
        [
            "2264262",  # I admire his wit.
            "2276063",  # I don't have your wit.
            "2540724",  # You're a gentleman and a scholar.
        ],

        # ===========================================================
        # === Blend / mix ===
        # ===========================================================
        [
            "3765159",  # I tried to blend in.
            "4496089",  # Blend the mixture together until it is smooth.
            "953980",   # Long: Instead of eating vegetables, he puts them in a blender and drinks them.
        ],

        # ===========================================================
        # === Hike / hiking ===
        # ===========================================================
        [
            "1415863",  # We'd better cancel the hike.
            "4496760",  # I was completely exhausted after the hike.
            "4498395",  # Long: The hike was exhausting, but we had a lot of fun.
            "273958",   # Long: The union is pressing for a ten-percent pay hike.
            "242333",   # Can I go hiking next Sunday?
            "255379",   # I went hiking with the group.
            "30928",    # Long: If it's raining, we don't plan to go hiking.
            "35540",    # Long: Autumn is the best season for going on hikes.
        ],

        # ===========================================================
        # === Hollow / spice / variety ===
        # ===========================================================
        [
            "2111279",  # They're hollow.
            "1040743",  # Variety is the spice of life.
            "5825575",  # What spices did you use?
            {"text": "Just salt and pepper.",
             "added_for": "salt|pepper", "reason": "natural answer"},
        ],

        # ===========================================================
        # === Sunday / week ===
        # ===========================================================
        [
            "909557",   # Long: She spends a majority of her time taking care of her children.
            "5904715",  # I usually don't get up until noon on Sundays.
        ],

        # ===========================================================
        # === Cardboard ===
        # ===========================================================
        [
            "4701370",  # Cardboard is stronger than paper.
            "2047764",  # This box is made of cardboard.
        ],

        # ===========================================================
        # === Bundle / dreadful ===
        # ===========================================================
        [
            "3313142",  # We lost a bundle.
            "2123539",  # They're dreadful.
        ],

        # ===========================================================
        # === Costly / mistake ===
        # ===========================================================
        [
            "4496966",  # It can be costly.
            "1522522",  # That was a costly mistake.
        ],

        # ===========================================================
        # === Dodge ===
        # ===========================================================
        [
            "1140071",  # Let's play dodge ball.
            "1860495",  # Don't dodge the question.
        ],

        # ===========================================================
        # === Norm / inherently ===
        # ===========================================================
        [
            "3822011",  # This is the norm.
            "4494122",  # People are inherently good.
        ],

        # ===========================================================
        # === Refined / refreshing ===
        # ===========================================================
        [
            "4977090",  # Refined sugar is bad for your health.
            "2187232",  # It's refreshing.
            "4496392",  # This is a refreshing change of pace.
        ],

        # ===========================================================
        # === Straightforward ===
        # ===========================================================
        [
            "4502369",  # Be honest and straightforward.
            "5131327",  # That's a pretty straightforward question.
        ],

        # ===========================================================
        # === Despair ===
        # ===========================================================
        [
            "2187189",  # Don't despair.
            {"text": "There's always a way forward.",
             "added_for": "forward", "reason": "encouraging reply"},
        ],

        # ===========================================================
        # === Dye / dyed hair ===
        # ===========================================================
        [
            "2209687",  # Do you dye your hair?
            "3170518",  # Why would anyone dye their hair pink?
            {"text": "Just for fun, I suppose.",
             "added_for": "fun|suppose", "reason": "natural hypothetical answer"},
            "1413017",  # I dyed my hair blonde.
            "318795",   # The cloth was dyed bright red.
        ],

        # ===========================================================
        # === Hatch ===
        # ===========================================================
        [
            "2245186",  # Close the hatch.
            "2249748",  # Open the hatch.
        ],

        # ===========================================================
        # === Disposable ===
        # ===========================================================
        [
            "2111309",  # They're disposable.
            "4662792",  # Long: I think people should stop using disposable shopping bags.
        ],

        # ===========================================================
        # === Modifications / remedy ===
        # ===========================================================
        [
            "2380421",  # I made some modifications.
            "4495081",  # What's the remedy?
            "2663240",  # I'm trying to remedy the problem.
        ],

        # ===========================================================
        # === Scent / fox ===
        # ===========================================================
        [
            "325809",   # Long: The hunting dogs followed the scent of the fox.
        ],

        # ===========================================================
        # === Unprecedented / glimpse ===
        # ===========================================================
        [
            "4501519",  # This is totally unprecedented.
            "261249",   # I caught a glimpse of her face.
            "256644",   # Long: I caught a glimpse of him as he turned the corner.
        ],

        # ===========================================================
        # === Microwave / appetite ===
        # ===========================================================
        [
            "632466",   # Long: Please put this in the microwave oven.
            "258758",   # I have a poor appetite.
            "3826565",  # I've suddenly lost my appetite.
            "2360970",  # I hope you have a healthy appetite.
            "26564",    # Long: Let's do some exercise to work up an appetite.
            "881185",   # Don't spoil your appetite.
        ],

        # ===========================================================
        # === Skeleton / thin ===
        # ===========================================================
        [
            "294772",   # He looks just like a skeleton.
            "1090271",  # Long: He's so thin that he looks like a skeleton.
        ],

        # ===========================================================
        # === Spicy ===
        # ===========================================================
        [
            "2488102",  # I like spicy Mexican food.
            "269840",   # You shouldn't eat anything spicy.
            "3777895",  # I want to eat some Korean food that isn't spicy.
            "38265",    # Long: Every now and then I like to have hot and spicy food.
        ],

        # ===========================================================
        # === Vacant ===
        # ===========================================================
        [
            "28187",    # Two seats were vacant.
            "313346",   # She parked her car in a vacant lot.
        ],

        # ===========================================================
        # === Starving / starve ===
        # ===========================================================
        [
            "2131438",  # I'm already starving.
            "4929385",  # I'm no longer starving.
            "2111344",  # They'll starve.
            "279851",   # I would rather starve than steal.
            "1908977",  # We nearly starved.
            "682064",   # Long: It was a dry year, and many animals starved.
        ],

        # ===========================================================
        # === Strap ===
        # ===========================================================
        [
            "2647614",  # Strap yourselves in.
        ],

        # ===========================================================
        # === Chop wood / ax ===
        # ===========================================================
        [
            "261971",   # I chopped a tree down.
            "1762362",  # I like to chop wood.
            "2719840",  # I chop wood every day.
            "5850356",  # I don't like chopping wood.
            "3097128",  # I spent all morning chopping wood.
            "5829165",  # I got the ax.
            "64947",    # Long: The Canadian chopped down the tree with an ax.
            "5913914",  # Long: I chained myself to one of the trees they were planning to cut down.
        ],

        # ===========================================================
        # === Compact / lightweight ===
        # ===========================================================
        [
            "4014753",  # It's compact and lightweight.
        ],

        # ===========================================================
        # === Crawl / ants ===
        # ===========================================================
        [
            "45867",    # The baby began to crawl.
            "1609680",  # Don't try to walk before you can crawl.
            "4497084",  # Our daughter has started crawling.
            "3009037",  # The cake was crawling with ants.
            "1848295",  # Do ants have ears?
            "1293147",  # Ants work hard all summer.
        ],

        # ===========================================================
        # === Fundamentally unfair / unjust ===
        # ===========================================================
        [
            "5088457",  # That's fundamentally unfair.
            "4494455",  # This is grossly unfair.
            "2248894",  # It was unjust.
        ],

        # ===========================================================
        # === Contact lenses ===
        # ===========================================================
        [
            "3162166",  # Help me find my contact lens.
            "54811",    # I'm looking for my contact lens.
            "253826",   # I wear contact lenses.
            "1477107",  # Did you find your contact lenses?
        ],

        # ===========================================================
        # === Betray ===
        # ===========================================================
        [
            "1112486",  # They betrayed you.
            "1112487",  # I betrayed you.
            "2271699",  # I didn't betray you.
            "2271953",  # I won't betray you.
        ],

        # ===========================================================
        # === Brewing / booming ===
        # ===========================================================
        [
            "325252",   # A storm is brewing.
            "2548430",  # Business is booming.
            "4496123",  # Business was booming.
        ],

        # ===========================================================
        # === Discharged ===
        # ===========================================================
        [
            "2218098",  # You're being discharged.
        ],

        # ===========================================================
        # === Ignorance ===
        # ===========================================================
        [
            "274822",   # Long: Many economists are ignorant of that fact.
            "4498383",  # Ignorance is no excuse.
            "5650933",  # Please excuse my ignorance.
            "4915742",  # Forgive me for my ignorance.
            "887319",   # Long: She often takes advantage of his ignorance.
            "3831440",  # Your ignorance is astonishing.
        ],

        # ===========================================================
        # === Embraced ===
        # ===========================================================
        [
            "2111373",  # They embraced.
            "3821723",  # They embraced each other.
        ],

        # ===========================================================
        # === Perfume ===
        # ===========================================================
        [
            "3022422",  # That perfume smells good.
            "2333750",  # Mary doesn't wear cheap perfume.
            "2333751",  # Long: I don't like the smell of the perfume Mary is wearing today.
        ],

        # ===========================================================
        # === Pyramid scheme ===
        # ===========================================================
        [
            "2179072",  # It's not a pyramid scheme.
        ],

        # ===========================================================
        # === Toss / coin ===
        # ===========================================================
        [
            "1910149",  # Let's toss a coin.
            "3312182",  # We'll toss for it.
            "293822",   # He tossed and turned all night.
            "682254",   # I tossed and turned in bed all night.
        ],

        # ===========================================================
        # === Turtle ===
        # ===========================================================
        [
            "1934865",  # We ate some turtle soup.
            "376630",   # We found a turtle in the garden.
            "1356594",  # Do turtles have teeth?
            "249325",   # We went to see turtles on the beach.
        ],

        # ===========================================================
        # === Ditch / dare ===
        # ===========================================================
        [
            "3825311",  # I can't jump over that ditch.
            "1868746",  # I dare you to jump over this ditch.
        ],

        # ===========================================================
        # === Plague / avoiding ===
        # ===========================================================
        [
            "953270",   # Long: For some reason, people have been avoiding me like the plague ever since I got back from India.
        ],

        # ===========================================================
        # === Incentives ===
        # ===========================================================
        [
            "1293256",  # Incentives always help.
        ],

        # ===========================================================
        # === Stack / cards ===
        # ===========================================================
        [
            "325451",   # Long: If you stack the dishes up by the sink, I'll do them later.
            "4813039",  # The cards are stacked against us.
        ],

        # ===========================================================
        # === Sip ===
        # ===========================================================
        [
            "5902948",  # I took another sip.
        ],

        # ===========================================================
        # === Cereal ===
        # ===========================================================
        [
            "5251742",  # I'm eating cereal.
            "1602412",  # I have a bowl of cereal every morning.
        ],

        # ===========================================================
        # === Mushroom ===
        # ===========================================================
        [
            "4133491",  # I'd like some more mushrooms.
            "4012758",  # What kind of mushrooms are they?
            "2924304",  # You can eat any mushroom once.
            "4135013",  # What are the symptoms of mushroom poisoning?
        ],

        # ===========================================================
        # === Quiz / riddle ===
        # ===========================================================
        [
            "2406814",  # I studied all week for that quiz.
            "60750",    # Can you answer this riddle?
            "44652",    # Let's try to solve the riddle.
        ],

        # ===========================================================
        # === Tighten / knot / bolts ===
        # ===========================================================
        [
            "3823218",  # You must tighten the knot.
            "1745128",  # I have to tighten these bolts.
            "5916836",  # I tightened the bolts.
            "5938412",  # I tightened the knot.
            "54676",    # This knot will not hold.
            "257198",   # I can't tie a very good knot.
        ],

        # ===========================================================
        # === Disclose / financial ===
        # ===========================================================
        [
            "1951480",  # I can't disclose that information yet.
            "4870455",  # No financial details were disclosed.
        ],

        # ===========================================================
        # === Mortal ===
        # ===========================================================
        [
            "269999",   # We know that all men are mortal.
        ],

        # ===========================================================
        # === Newspapers scattered ===
        # ===========================================================
        [
            "268100",   # Long: Newspapers lay scattered all over the floor.
            "27234",    # Some newspapers distorted the news.
        ],

        # ===========================================================
        # === Rusty / dust ===
        # ===========================================================
        [
            "2248213",  # I'm pretty rusty.
            "1183835",  # I'm a little rusty.
            "50024",    # Long: The ladder was covered with dust and rust.
            "20576",    # Dust had accumulated on the desk.
        ],

        # ===========================================================
        # === Stove ===
        # ===========================================================
        [
            "2270540",  # Don't touch the stove.
            "5850359",  # I lit the stove.
            "5915891",  # I burned myself on the stove.
        ],

        # ===========================================================
        # === Alphabet ===
        # ===========================================================
        [
            "26340",    # The English alphabet has 26 letters.
            "4450347",  # Please say the alphabet backwards.
            "930292",   # Please say the alphabet in reverse.
            "252365",   # Long: I remember my mother teaching me the alphabet.
        ],

        # ===========================================================
        # === Apprentice ===
        # ===========================================================
        [
            "2247921",  # I'm an apprentice.
            "2016991",  # Would you like to be my apprentice?
            {"text": "I'd be honored.",
             "added_for": "honored", "reason": "warm formal reply"},
        ],

        # ===========================================================
        # === Drown / bathing suit ===
        # ===========================================================
        [
            "680743",   # You won't drown if you learn how to swim.
            "4013182",  # Did you pack your bathing suit?
            "5168388",  # I wish I'd brought my bathing suit.
        ],

        # ===========================================================
        # === Stirring / stirred ===
        # ===========================================================
        [
            "28419",    # Something was stirring in the dark.
            "5858292",  # I stirred the soup.
            "1725439",  # Long: Have you ever stirred your coffee with a fork?
        ],

        # ===========================================================
        # === Swelling / swollen ===
        # ===========================================================
        [
            "4502471",  # There was no swelling.
            "3831742",  # My feet are swollen.
            "267600",   # My little finger is swollen.
            "266034",   # My hands and legs are swollen.
            "4665064",  # My ankles often become swollen.
        ],

        # ===========================================================
        # === Grim / gloomy ===
        # ===========================================================
        [
            "2270483",  # Don't look so grim.
            "239487",   # It's a grim world.
            "2268150",  # The future looked very gloomy.
        ],

        # ===========================================================
        # === Injected poison ===
        # ===========================================================
        [
            "4499508",  # Long: I think they've injected me with poison.
        ],

        # ===========================================================
        # === Disastrous ===
        # ===========================================================
        [
            "4495177",  # It was disastrous.
        ],

        # ===========================================================
        # === Peculiar ===
        # ===========================================================
        [
            "3636097",  # That's peculiar.
        ],

        # ===========================================================
        # === Ripe ===
        # ===========================================================
        [
            "29634",    # The apples are ripe.
            "60649",    # Are these bananas ripe?
            "278970",   # He lived to a ripe old age.
        ],

        # ===========================================================
        # === Cozy ===
        # ===========================================================
        [
            "1079442",  # It's warm and cozy here.
            "59717",    # This coffee shop is cozy.
        ],

        # ===========================================================
        # === Compartment ===
        # ===========================================================
        [
            "64339",    # It's in the overhead compartment.
            "2978062",  # Have you looked in the glove compartment?
            "60656",    # Long: Should I put this bag in the overhead compartment?
        ],

        # ===========================================================
        # === Kitten ===
        # ===========================================================
        [
            "1341396",  # Long: I'll take care of your kitten while you're gone.
            "5534998",  # Long: My cat is going to have kittens next month.
        ],

        # ===========================================================
        # === Advocating ===
        # ===========================================================
        [
            "4530025",  # I'm not advocating that.
            "2050654",  # I'm just playing the devil's advocate.
        ],

        # ===========================================================
        # === Swell / tease ===
        # ===========================================================
        [
            "2458601",  # I think you're swell.
            "2021204",  # Don't tease me.
            "2218044",  # You're a tease.
            "2111681",  # I'm teasing.
            "3408976",  # You said that you were just teasing.
            "306911",   # They teased the new student.
            "4945428",  # Long: Mary came home from school in tears because her friends had teased her.
        ],

        # ===========================================================
        # === Smashing / smashed ===
        # ===========================================================
        [
            "2255051",  # You look smashing.
            "2203372",  # We're smashed.
            "318575",   # The bottle smashed to pieces.
        ],

        # ===========================================================
        # === Furnished / obsolete ===
        # ===========================================================
        [
            "57326",    # This room is well furnished.
            "2187226",  # It's obsolete.
        ],

        # ===========================================================
        # === Amazingly ===
        # ===========================================================
        [
            "3732959",  # It's amazingly simple.
            "4530096",  # It was amazingly easy.
        ],

        # ===========================================================
        # === Fuss ===
        # ===========================================================
        [
            "63197",    # Stop making a fuss.
            "5171701",  # I'm sick of all this fuss.
        ],

        # ===========================================================
        # === Undefeated ===
        # ===========================================================
        [
            "2241511",  # We were undefeated.
            "4850056",  # I'm still undefeated.
        ],

        # ===========================================================
        # === Skating ===
        # ===========================================================
        [
            "248027",   # We enjoyed skating.
            "953526",   # I love roller skating.
            "274905",   # Long: A winter sport that many people enjoy is ice skating.
            "250302",   # Long: Everybody in my class prefers skiing to skating.
            "953657",   # Long: I thought a bunch of people would go water skiing with us, but absolutely no one else showed up.
        ],

        # ===========================================================
        # === Reluctantly ===
        # ===========================================================
        [
            "5859252",  # I reluctantly did that.
        ],

        # ===========================================================
        # === Stalled / allowance ===
        # ===========================================================
        [
            "2107362",  # We're stalled.
            "3310012",  # We've made allowances for that.
            "699971",   # Long: My dad gives me an allowance of $10 a week.
            "2042873",  # Long: If you want one, you'll have to pay for it out of your own allowance.
        ],

        # ===========================================================
        # === Clinging / glare ===
        # ===========================================================
        [
            "316810",   # She was clinging to her father.
            "275104",   # There's a lot of glare.
        ],

        # ===========================================================
        # === Herbal tea ===
        # ===========================================================
        [
            "5859772",  # I like herbal tea.
            "4013114",  # Would you like some herbal tea?
            {"text": "I'd love some.",
             "added_for": "love", "reason": "natural warm accept"},
        ],

        # ===========================================================
        # === Diagram / analogy ===
        # ===========================================================
        [
            "1671746",  # Would you explain that diagram to me?
            "270673",   # Let me explain it with a diagram.
            "1818237",  # Would you mind explaining that diagram to me?
            "2026631",  # Would you like me to draw you a diagram?
            "4665832",  # Your analogy isn't correct.
            "2361525",  # I don't understand the analogy.
        ],

        # ===========================================================
        # === Proposition ===
        # ===========================================================
        [
            "1807344",  # I like your proposition.
            "4498348",  # It's an exciting proposition.
        ],

        # ===========================================================
        # === Splash ===
        # ===========================================================
        [
            "2291164",  # I didn't hear a splash.
        ],

        # ===========================================================
        # === Sweaty palms / slid ===
        # ===========================================================
        [
            "4499891",  # My palms were sweaty.
            "2097",     # Long: I can place the palms of my hands on the floor without bending my knees.
            "5938444",  # I slid down the pole.
        ],

        # ===========================================================
        # === Impatient / restless ===
        # ===========================================================
        [
            "2111721",  # I'm impatient.
            "2427883",  # Children are often impatient and restless.
        ],

        # ===========================================================
        # === Creep / creeping ===
        # ===========================================================
        [
            "3178305",  # You must think I'm a creep.
            "3728843",  # This is really creeping me out.
            "20309",    # He gives me the creeps.
            "3151090",  # You're giving me the creeps.
        ],

        # ===========================================================
        # === Blink / wink ===
        # ===========================================================
        [
            "2402189",  # Whatever you do, don't blink.
            "3131524",  # It happened in the blink of an eye.
            "3723913",  # The light was blinking.
            "4079234",  # Why is this light blinking?
            "2315010",  # I didn't sleep a wink.
            "3177975",  # I barely slept a wink.
        ],

        # ===========================================================
        # === Bulky ===
        # ===========================================================
        [
            "1438333",  # It's bulky.
            "2248808",  # It was bulky.
        ],

        # ===========================================================
        # === Beards ===
        # ===========================================================
        [
            "3162953",  # How many of your friends have beards?
            "4500724",  # Long: All the old men in our village have long beards.
        ],

        # ===========================================================
        # === Conserve ===
        # ===========================================================
        [
            "2953722",  # We need to conserve our strength.
            "2991810",  # Let's conserve our limited water supply.
            "22804",    # Long: We must try to conserve our natural resources.
            "3436773",  # I don't have the time or the inclination.
        ],

        # ===========================================================
        # === Heartless / senseless ===
        # ===========================================================
        [
            "2276235",  # I don't think you're heartless.
            "2891266",  # How can you be so heartless?
            {"text": "I'm not — you don't understand.",
             "added_for": "understand", "reason": "natural deflective reply"},
            "2891554",  # It's all so senseless.
        ],

        # ===========================================================
        # === Smoky ===
        # ===========================================================
        [
            "3733333",  # It's very smoky in here.
        ],

        # ===========================================================
        # === Lighten / olives / rattle ===
        # ===========================================================
        [
            "1860610",  # Lighten up.
            "4500632",  # Lighten up, guys.
            "2402229",  # You like olives, don't you?
            "2540027",  # The baby was playing with a rattle.
        ],

        # ===========================================================
        # === Sweetest ===
        # ===========================================================
        [
            "2218438",  # You're the sweetest.
            {"text": "You're too kind.",
             "added_for": "kind", "reason": "warm modest reply"},
        ],

        # ===========================================================
        # === Resent ===
        # ===========================================================
        [
            "2247390",  # I resent that.
            "3822513",  # Why do you resent me?
            "5292379",  # Do you feel resentment towards your parents?
            {"text": "Not anymore.",
             "added_for": "anymore", "reason": "concise honest reply"},
        ],

        # ===========================================================
        # === Superiors / obey ===
        # ===========================================================
        [
            "5250546",  # I have to obey my superiors.
            "2014317",  # I want to talk to your superior.
            "3734117",  # Obedience is not enough.
        ],

        # ===========================================================
        # === Inhabited islands ===
        # ===========================================================
        [
            "3280276",  # Long: Most of the islands in this area are inhabited.
        ],

        # ===========================================================
        # === Accomplishment / goal ===
        # ===========================================================
        [
            "4495447",  # What a great accomplishment!
            "4529368",  # That was our biggest accomplishment.
            "389159",   # He attained his goal.
        ],

        # ===========================================================
        # === Dwell / past mistakes ===
        # ===========================================================
        [
            "23623",    # Don't dwell on your past mistakes!
        ],

        # ===========================================================
        # === Chilly / bland ===
        # ===========================================================
        [
            "282666",   # It's chilly.
            "2249081",  # It's getting chilly.
            "4498413",  # Milder temperatures are expected next week.
            "2953279",  # Some food is pretty bland without salt.
        ],

        # ===========================================================
        # === Microscope ===
        # ===========================================================
        [
            "3820591",  # My microscope was stolen.
            "296042",   # Long: He was looking through a microscope.
        ],

        # ===========================================================
        # === Specimen ===
        # ===========================================================
        [
            "55495",    # This is a very rare specimen.
        ],

        # ===========================================================
        # === Abnormal ===
        # ===========================================================
        [
            "54640",    # Long: This warm weather is abnormal for February.
            "245998",   # Long: I don't want to have children. Is that abnormal?
        ],

        # ===========================================================
        # === Irritating ===
        # ===========================================================
        [
            "2547653",  # Irritating, isn't it?
            "3994492",  # Isn't that irritating?
            "319851",   # He became irritated.
            "323696",   # My eyes feel irritated.
        ],

        # ===========================================================
        # === Visas ===
        # ===========================================================
        [
            "3202257",  # Long: Nobody told us that we needed visas.
        ],

        # ===========================================================
        # === Obstacle course ===
        # ===========================================================
        [
            "4663365",  # Long: This is a very challenging obstacle course.
        ],

        # ===========================================================
        # === Helmet ===
        # ===========================================================
        [
            "3331061",  # You've got my helmet.
            "2869911",  # Go get your helmet.
            "2712859",  # Were both of them wearing helmets?
            "2954505",  # You guys should really be wearing helmets.
        ],

        # ===========================================================
        # === Slavery / slaves ===
        # ===========================================================
        [
            "1961406",  # I thought that system was abolished last year.
            "279561",   # Long: Slavery has been abolished in most parts of the world.
            "2014621",  # Do you want to live like slaves?
        ],

        # ===========================================================
        # === Misc closing ===
        # ===========================================================
        [
            "3729428",  # I don't rightly know.
        ],
        [
            "2247920",  # I'm an alcoholic.
            "67310",    # Do you have anything non-alcoholic?
        ],
        [
            "5684352",  # I like exotic foods.
        ],
        [
            "64139",    # Long: I wish you both happiness and prosperity.
        ],
        [
            "275719",   # Long: The majority of big banks are introducing this system.
        ],
        [
            "246971",   # Long: I acted as a simultaneous interpreter.
        ],
        [
            "953473",   # Long: I have eaten at Chuck's Diner on several occasions.
        ],
    ],
}
