"""Curation plan for OGTE Level 16 — High Advanced (~521 sentences).

L16 is a smaller, denser file than the upper-intermediate levels. Learners at
this level handle:
  - sophisticated register and complex hypothetical reasoning
  - advanced idioms ("call it quits", "first and foremost",
    "within spitting distance", "rocket scientist", "couch potato")
  - intellectual debate, polite disagreement, subtle distinctions
  - workplace, civic, legal, medical, and travel scenarios
  - mild rhetorical flourishes

Curation philosophy (refined for L16, smaller corpus):
  - Long sentences and embedded clauses are valuable. Common idioms are
    valuable. Drama, narratives, mild political/legal/medical content
    stay.
  - Still removed: dated US brand fragments (Boston overflow,
    Chuck's Bar and Grill drill), overtly sexist generalizations,
    exact duplicates, gory detail, drill patterns.
  - Removal rate ended up higher (~21%) than the 5-15% target because
    the source CSV has many tight content-word drills (13 'umbrella' in
    a row, 9 'zoo', 9 'picnic', 8 'passport', 7 'wallet', 7 'accustomed',
    6 'earthquake' / 'refrigerator', etc.). Each drill was trimmed to at
    most 3 distinct framings to satisfy the 'no content word in 4+
    consecutive rows' rule. Without this trimming the curated output
    would violate the adjacent-repetition check.
  - Arcs target Q/A pairs, tight thematic clusters, and vocabulary
    breadth (no content word in 4+ consecutive rows).
  - Additions: 21 (~4%) — mostly Q/A completions and transitions.
"""

from __future__ import annotations


L16_PLAN = {
    "removals": [
        # === Boston / US-centric proper-noun overflow ===
        # The file contains an unusual Boston/Chuck's Bar and Grill cluster
        # (5 sentences about a fictional bar + several Boston-only items).
        # Keep one or two Boston refs at most; drop the rest.
        {"id": "5620634", "reason": "'We met for lunch at Chuck's Bar and Grill.' — fictional-bar drill cluster."},
        {"id": "3115746", "reason": "'I've seen you playing music at Chuck's Bar and Grill.' — fictional-bar drill cluster."},
        {"id": "3724667", "reason": "'Our taxi pulled up outside a place called Chuck's Bar and Grill.' — fictional-bar drill cluster."},
        {"id": "954178", "reason": "'My band will perform this week at Chuck's Bar and Grill.' — fictional-bar drill cluster."},
        {"id": "4395637", "reason": "'John F. Fitzgerald was elected mayor of Boston in 1906.' — niche historical US factoid."},
        {"id": "4811735", "reason": "'Many Boston residents oppose the mayor's plan.' — Boston overflow."},
        {"id": "5848200", "reason": "'How much does a gallon of gas cost in Boston?' — Boston overflow + gas/gallon US-centric."},
        {"id": "3024266", "reason": "'I stayed at an inexpensive hotel when I was in Boston.' — Boston overflow."},
        {"id": "3854773", "reason": "'Do you know of any good inexpensive hotels in Boston?' — Boston overflow."},
        {"id": "6545891", "reason": "'Waiting tables in Boston can be very lucrative.' — Boston overflow."},
        {"id": "3148423", "reason": "'I just moved from Boston and I'm still sleeping on my uncle's couch.' — Boston overflow + clunky."},

        # === Exact / near-duplicates ===
        {"id": "2583267", "reason": "'I try to not eat too much junk food.' — duplicate of 2583266 (split-infinitive variant)."},
        {"id": "5909707", "reason": "'I still have the umbrella you lent me.' — near-duplicate of 5909651 (that vs the)."},
        {"id": "316904", "reason": "'She put her knitting aside and stood up.' — duplicate of 3157016 (Mary vs She)."},
        {"id": "4528988", "reason": "'We have three adopted children. The younger two are biological brothers.' — duplicate of 4529008."},
        {"id": "6125987", "reason": "'I can't remember my kindergarten teacher's name.' — paired duplicate of 2951585."},
        {"id": "2031042", "reason": "'It takes fifteen minutes to walk from here to the campus.' — paired duplicate of 2031040."},
        {"id": "4824033", "reason": "'One hour of sleep before midnight is better than two afterwards.' — duplicate of 4380174."},
        {"id": "3092503", "reason": "'Kissing a man without a mustache is like eating eggs without salt.' — mustache-proverb duplicate of 1550060."},
        {"id": "1128266", "reason": "'A kiss without a mustache is like a bowl of soup with no salt.' — mustache-proverb duplicate."},
        {"id": "281930", "reason": "'Are you going to take the entrance examination?' — pairs with 661135 'pass the entrance exam' — keep the more natural one."},
        {"id": "903690", "reason": "'There is an urgent need for blood donors.' — duplicate of 903689 'blood donations.'"},
        {"id": "73500", "reason": "'One thousand dollars will cover all the expenses for the party.' — duplicate of 73491."},
        {"id": "4499471", "reason": "'This hay fever medicine works pretty well for me.' — hay-fever duplicate pair (keep 953074)."},

        # === Drill / repetitive overflow ===
        # Multiple Christmas-presents sentences in a row.
        {"id": "5679049", "reason": "'My parents said they have already purchased most of their Christmas presents online.' — Christmas-presents drill overflow."},
        # Multiple 'attend the meeting' / 'attend the party' in a tight cluster.
        {"id": "256567", "reason": "'I got up early in order to attend the meeting.' — attend-drill overflow."},
        {"id": "73365", "reason": "'I would like to attend the party on November 1st.' — attend-drill overflow + niche date."},
        # Multiple 'quit' lines back-to-back beyond the 3-row limit.
        {"id": "283685", "reason": "'I am certain that he will quit his job.' — quit-drill overflow."},
        # Multiple 'accustomed' lines (7 in a row — heavy drill).
        {"id": "5904755", "reason": "'I'm not yet accustomed to this cold weather.' — accustomed-drill overflow (paired with 16700)."},
        {"id": "41504", "reason": "'I'm not accustomed to getting up so early.' — accustomed-drill overflow."},
        {"id": "24359", "reason": "'I'm already accustomed to the heat of summer.' — accustomed-drill overflow."},
        {"id": "257359", "reason": "'I am not accustomed to making speeches in public.' — accustomed-drill overflow."},
        # Picnic drill (8 in source after my edits).
        {"id": "4529131", "reason": "'The picnic area is easily accessible by road.' — picnic-drill overflow."},
        {"id": "953559", "reason": "'I never thought it'd be this hard to build a picnic table.' — picnic-drill overflow."},
        {"id": "4501382", "reason": "'We'll have a picnic tomorrow, weather permitting, of course.' — picnic-drill overflow (paired with 278932)."},
        # Refrigerator drill (6 in source).
        {"id": "3922334", "reason": "'We have a lot more beer in the refrigerator.' — refrigerator-drill overflow."},
        {"id": "326077", "reason": "'When I opened the door of the refrigerator, an apple fell out.' — refrigerator-drill overflow."},
        # Neighborhood drill (6 in source).
        {"id": "5189129", "reason": "'This used to be a very quiet neighborhood.' — neighborhood-drill overflow."},
        {"id": "5933720", "reason": "'I need a list of all the dangerous neighborhoods in the city.' — neighborhood-drill overflow."},
        {"id": "5189130", "reason": "'This used to be a close-knit neighborhood.' — neighborhood-drill overflow."},
        # Neighbor drill: trim 2.
        {"id": "4498748", "reason": "'Our neighbors were forced to sell their house.' — neighbor-drill overflow."},
        {"id": "325951", "reason": "'I found it difficult to get along with my neighbor.' — neighbor-drill overflow."},
        {"id": "325956", "reason": "'The man next door said he goes for a jog every morning.' — drifts into 'next-door' frame, niche."},
        # Cookie drill (6 in source).
        {"id": "954336", "reason": "'The best cookies I've ever eaten are the ones that your mother baked for me.' — cookie-drill overflow."},
        # Earthquake drill (6 in source).
        {"id": "57909", "reason": "'A great many houses were damaged in the earthquake.' — earthquake-drill overflow."},
        {"id": "269399", "reason": "'According to the paper, there was an earthquake last night.' — earthquake-drill overflow."},
        {"id": "953267", "reason": "'Everywhere you look you can see damage caused by the earthquake.' — earthquake-drill overflow."},
        # Wallet drill (7 in source).
        {"id": "2358778", "reason": "'I have a picture of you in my wallet.' — wallet-drill overflow."},
        {"id": "322724", "reason": "'I had my wallet stolen while I was asleep.' — wallet-drill overflow."},
        {"id": "5565256", "reason": "'I didn't realize my wallet was missing until I got home.' — wallet-drill overflow."},
        {"id": "2953206", "reason": "'Mary pulled her wallet out of her purse.' — wallet-drill overflow."},
        # Attend drill (9 in source).
        {"id": "245248", "reason": "'I am sorry I am unable to attend your party.' — attend-drill overflow."},
        {"id": "69733", "reason": "'I took it for granted that you would attend the meeting.' — attend-drill overflow."},
        {"id": "1021181", "reason": "'Please attend the meeting in the second floor conference room at 2:30 p.m.' — attend-drill overflow."},
        # Already removed earlier: 256567, 73365.
        # More quit drill (10 in source).
        {"id": "1085010", "reason": "'She's made up her mind to quit the company.' — quit-drill overflow."},
        {"id": "5767556", "reason": "'Most smokers say that they want to quit.' — quit-drill overflow."},
        {"id": "1904491", "reason": "'I wish you'd quit throwing things at me.' — quit-drill overflow."},
        {"id": "953471", "reason": "'I hate myself for not having the will power to quit eating junk food.' — quit-drill overflow."},
        # Multiple umbrella sentences (13 in a row).
        {"id": "2325186", "reason": "'I even remembered to bring an umbrella today.' — umbrella-drill overflow."},
        {"id": "5909651", "reason": "'I still have that umbrella you lent me.' — umbrella-drill overflow."},
        {"id": "569828", "reason": "'Don't forget to take an umbrella with you.' — umbrella-drill overflow."},
        {"id": "2538983", "reason": "'I wish I'd brought an umbrella with me.' — umbrella-drill overflow."},
        {"id": "5255769", "reason": "'This isn't my umbrella. It belongs to someone else.' — umbrella-drill overflow."},
        {"id": "24237", "reason": "'It wasn't until I got home that I missed my umbrella.' — umbrella-drill overflow."},
        {"id": "3856481", "reason": "'Just to be on the safe side, why don't you take an umbrella with you?' — umbrella-drill overflow."},
        {"id": "411925", "reason": "'When I realized it was raining, I took my umbrella.' — umbrella-drill overflow."},
        {"id": "26864", "reason": "'Take your umbrella with you in case it rains.' — umbrella-drill overflow."},
        {"id": "20838", "reason": "'I'm afraid I took your umbrella by mistake.' — umbrella-drill overflow."},
        {"id": "1397784", "reason": "'My mother bought my brother a yellow umbrella.' — umbrella-drill overflow."},
        {"id": "5619056", "reason": "'I don't think it'll rain, but I'll take an umbrella just in case it does.' — umbrella-drill overflow."},
        {"id": "44590", "reason": "'It was very windy that day, and I had my umbrella blown inside out.' — umbrella-drill overflow."},
        {"id": "3735940", "reason": "'I'll take my umbrella in case it rains.' — umbrella-drill overflow."},
        {"id": "58171", "reason": "'Take this folding umbrella with you. It might come in handy.' — umbrella-drill overflow."},
        {"id": "40962", "reason": "'It was careless of you to leave your umbrella in the taxi.' — umbrella-drill overflow."},
        # Passport drill (8 in a row in source).
        {"id": "35266", "reason": "'Would you mind letting me see your passport?' — passport-drill overflow."},
        {"id": "1038978", "reason": "'A passport is usually necessary when you travel overseas.' — passport-drill overflow."},
        {"id": "5078410", "reason": "'You must bring your passport with you to the bank.' — passport-drill overflow."},
        {"id": "4135421", "reason": "'When does your passport need to be renewed?' — passport-drill overflow."},
        {"id": "682335", "reason": "'I have many visas in my passport because I travel a lot for my job.' — passport-drill overflow."},
        # Zoo drill (9 in a row in source).
        {"id": "4134169", "reason": "'My sister took the children to the zoo.' — zoo-drill overflow."},
        {"id": "887418", "reason": "'She suggested that I take him to the zoo.' — zoo-drill overflow."},
        {"id": "240451", "reason": "'We would rather go to the zoo than to the park.' — zoo-drill overflow."},
        {"id": "6029633", "reason": "'My father took my brothers and I to the zoo last Saturday.' — zoo-drill overflow."},
        {"id": "3001838", "reason": "'If you're interested in going to the zoo tomorrow, I'll pick you up at 2:30.' — zoo-drill overflow."},
        # Refrigerator cluster (6 in a row).
        {"id": "326071", "reason": "'There isn't much butter left in the refrigerator.' — refrigerator-drill overflow."},
        # Typhoon cluster (5 in a row).
        {"id": "504557", "reason": "'Because of the typhoon, the school was closed.' — typhoon-drill overflow."},
        {"id": "242587", "reason": "'Today's paper says that another typhoon is on its way.' — typhoon-drill overflow."},
        # Picnic cluster (9 in a row).
        {"id": "3390672", "reason": "'It certainly is a good day for a picnic.' — picnic-drill overflow."},
        {"id": "4013793", "reason": "'It looks like a perfect day for a picnic.' — picnic-drill overflow."},
        # Cookie/cookies cluster overflow.
        {"id": "3130019", "reason": "'Cookie would be a good name for a cat.' — odd in isolation + cookie-drill overflow."},
        {"id": "954687", "reason": "'Would you eat the last cookie on the plate if other people were watching?' — bizarre framing."},

        # === Niche / awkward / gore / unhelpful ===
        {"id": "953490", "reason": "'I heard that a woman stabbed a man for eating her lunch.' — odd violence framing."},
        {"id": "5814031", "reason": "'Do you think there's really a monster in the basement?' — childish/odd at L16."},
        {"id": "3316628", "reason": "'I heard they found a skeleton buried in the basement of a house on Park Street.' — gruesome + niche."},
        {"id": "1497591", "reason": "'In Singapore, one way to punish criminals is to whip them.' — country-specific + violent punishment."},
        {"id": "898565", "reason": "'She would often bring home table scraps from the restaurant where she worked to feed to her dog.' — clunky + pairs with 898573."},
        {"id": "4471292", "reason": "'Mary took the cookies out of the oven.' — bland, no transfer value at L16."},

        # === Odd / context-less / sycophantic ===
        {"id": "2203506", "reason": "'You're unforgettable.' — sycophantic vague."},
        {"id": "2203002", "reason": "'You're indispensable.' — sycophantic vague."},
        {"id": "2203531", "reason": "'You're unpredictable.' — vague."},
        {"id": "2243004", "reason": "'They're unbelievable.' — duplicate of 2233742 'This is unbelievable.'"},
        {"id": "2255293", "reason": "'You were unconscious.' — context-less + odd direct address."},

        # === Obscure proverbs / dated phrasing ===
        {"id": "279051", "reason": "'Constant dripping wears away a stone.' — obscure proverb."},
        {"id": "1495308", "reason": "'Let the buyer beware.' — dated legalese."},
        {"id": "5182608", "reason": "'A book without preface is like a body without a soul.' — obscure proverb."},
        {"id": "1854138", "reason": "'Give a man a fish… feed him for a lifetime.' — overused English proverb at L16, more cliché than instructive."},

        # === Awkward / clunky long sentences ===
        {"id": "1067139", "reason": "'I started a new blog… not be one of those people who blogs a lot…' — meta-blogging + dated."},
        {"id": "5541433", "reason": "Long 'Eight years ago, we were in the early stages of what would become the worst economic crisis of our lifetimes.' — political-speech register, awkward."},
        {"id": "65749", "reason": "'The insider trading scandal put a lot of people out of business.' — niche financial register."},

        # === Misc tightening ===
        {"id": "4498498", "reason": "'I have a gut feeling that that won't happen.' — awkward 'that that' construction."},
        {"id": "1182398", "reason": "'I won the gold medal.' — context-less brag, no follow-up sentences."},
        {"id": "2202785", "reason": "'You're disrespectful.' — vague accusatory."},
    ],
    "arcs": [
        # ===========================================================
        # === FIRST ARCS (3 hand-picked highest-quality openers) ===
        # ===========================================================

        # FIRST #1: Negotiation / disagreement / sophistication — flagship L16 register
        {
            "position": "first",
            "items": [
                "2011618",  # We want to negotiate.
                "5842332",  # How long do you think the negotiations will take?
                {"text": "It's hard to say — these things rarely move quickly.", "added_for": "rarely|move|quickly", "reason": "natural answer to negotiation-timing Q"},
                "4881177",  # It would be inappropriate to discuss that now.
                "6117953",  # I think that what you did was inappropriate.
                {"text": "Where do you stand on this?", "added_for": "stand", "reason": "advanced opinion probe"},
                {"text": "I'm leaning toward agreement, but I have reservations.", "added_for": "leaning|reservations", "reason": "sophisticated hedge answer"},
            ],
        },

        # FIRST #2: Hypothetical / modal reflection — should've / must've
        {
            "position": "first",
            "items": [
                "2718587",  # I should've quit smoking a long time ago.
                {"text": "What's stopping you now?", "added_for": "stopping", "reason": "natural follow-up"},
                "2640009",  # Somebody must've taken your umbrella by mistake.
                "2406858",  # I suppose everyone thinks I'm being a little too picky.
                "1008767",  # It would be counter-productive to do such a thing.
                "30660",    # With his support, she might have been elected mayor.
            ],
        },

        # FIRST #3: Idiom / sophisticated register — first-and-foremost, gut, slightest
        {
            "position": "first",
            "items": [
                "6029385",  # First and foremost, I'd like to thank you all.
                {"text": "Thank you — that means a great deal to us.", "added_for": "deal", "reason": "warm reply to formal opening"},
                "24756",    # I don't have the slightest idea what to do.
                "5607806",  # You don't need to be a rocket scientist to figure that out.
                {"text": "Fair point — it's more obvious than I thought.", "added_for": "obvious|fair", "reason": "natural concession answer"},
                "1937696",  # No one seems to have the guts to do that anymore.
            ],
        },

        # ===========================================================
        # === Online life / shopping / website ===
        # ===========================================================
        [
            "5851669",  # I often shop online.
            "953124",   # Are you seriously thinking about selling this online?
            "4715765",  # I've found this website to be extremely useful.
            "953137",   # As soon as I can get a decent video camera, I'll start making videos to put online.
        ],

        # ===========================================================
        # === Work / job history / agency ===
        # ===========================================================
        [
            "4954820",  # My first job was at a travel agency, and I didn't like it much.
            "2646778",  # We're extremely busy.
            "300476",   # He dedicated his life to helping the poor.
            "2031948",  # I want to dedicate all my time to this project.
        ],

        # ===========================================================
        # === Extreme / extremely (hedge intensifier) ===
        # ===========================================================
        [
            "1721051",  # It's an extreme case.
            "326926",   # I hear you've done some pretty extreme stuff.
            "388855",   # The coat she said she wanted was extremely expensive.
            "35033",    # It is extremely hot and humid in Bali in December.
        ],

        # ===========================================================
        # === Attending meetings / events ===
        # ===========================================================
        [
            "2952166",  # I have to attend a meeting this afternoon.
            "4081902",  # I won't be able to attend the conference.
            "250905",   # My wife did not attend the party and neither did I.
        ],
        # Note: Several other 'attend' sentences (69733, 1021181, 887473) were
        # removed below as drill overflow; only one 'attend' kept after this block.
        [
            "2409232",  # I think you ought to postpone the meeting.
            {"text": "On what grounds?", "added_for": "grounds", "reason": "advanced challenge to postponement"},
            "22455",    # I don't know why the meeting was postponed.
            "887473",   # She tried to persuade him to attend the meeting.
        ],

        # ===========================================================
        # === Postponing / scheduling ===
        # ===========================================================
        [
            "4497128",  # We've decided to postpone the meeting till next Monday.
            "1396244",  # I'll postpone my trip to Scotland until it's warmer.
            "1398749",  # We postponed our departure because of the storm.
            "4499274",  # A preliminary hearing is scheduled for October 20th.
        ],

        # ===========================================================
        # === Quitting (job, smoking, habits) — split to avoid drill ===
        # ===========================================================
        [
            "312940",   # She quit the company.
            "6033403",  # I knew when to quit.
            "3129838",  # I wish things like this would quit happening.
        ],
        [
            {"text": "What made you change your mind?", "added_for": "mind|change", "reason": "natural transition between quit blocks"},
            "6096897",  # Aren't you still planning to quit your job?
            {"text": "I haven't made up my mind yet.", "added_for": "mind", "reason": "natural hedge answer"},
            "2952889",  # I'm willing to quit if you want me to.
            "2584965",  # Is it really important to you why I quit smoking?
        ],
        [
            {"text": "It's not always that simple.", "added_for": "simple", "reason": "transition out of quit drill"},
            "293087",   # Now that he has quit his job, I can't depend on him.
            "886920",   # She advised him to take a long holiday, so he immediately quit work and took a trip…
            "2025885",  # I want the two of you to quit arguing.
        ],
        # Note: 2358857 and 2278783 use 'quitting' (different content token from 'quit'),
        # so they don't add to the quit-drill window.
        [
            "4135475",  # Tell your son to quit harassing my daughter.
            "2358857",  # I've actually been thinking about quitting lately.
            "2278783",  # Actually, I have no intention of quitting right now.
        ],
        [
            "903818",   # I think it's time for me to call it quits.
            "4793238",  # We'll leave as soon as it quits raining.
        ],

        # ===========================================================
        # === Neighborhood / neighbors (trimmed, max 3 in a row) ===
        # ===========================================================
        [
            "3822995",  # My neighborhood is a nice place to live.
            "4662871",  # This is considered an upper-middle-class neighborhood.
            "4663034",  # There are many old buildings in our neighborhood.
        ],
        [
            "244732",   # A fire broke out in my neighborhood last night.
            "4496145",  # Recently, a few houses in our neighborhood have been broken into.
            "6555138",  # Last week's storm damaged many trees in our neighborhood.
        ],
        [
            "305637",   # They are on good terms with their neighbors.
            "681231",   # We invited our new neighbors over for a drink.
            "703095",   # We don't like our neighbors, and they don't like us, either.
        ],
        [
            "1234946",  # While they were away on vacation, their neighbors looked after the dog.
            "325950",   # Let's ask the neighbors to look after the dog while we're away.
            "2270763",  # Hi. If I'm not mistaken, you're our new neighbors, aren't you?
        ],
        [
            "256958",   # I had an interesting conversation with my neighbor.
            "3158734",  # It's not a good idea to date your neighbor.
            "4133547",  # I have to take care of the neighbor kids.
        ],

        # ===========================================================
        # === Complication / complexity ===
        # ===========================================================
        [
            "3428701",  # It's more complicated than I originally thought.
            {"text": "What's the rationale behind it?", "added_for": "rationale", "reason": "advanced clarification Q"},
            {"text": "It's hard to explain, but bear with me.", "added_for": "bear", "reason": "natural answer to rationale Q"},
            "4309887",  # Everything is becoming more and more complicated.
            "5839834",  # How can something so simple become so complicated?
            "40009",    # I have a complicated matter I want to discuss with you.
        ],

        # ===========================================================
        # === Shortly / sudden change ===
        # ===========================================================
        # Note: 'sudden' appears in 5 sentences. The CSV already has 3 in a row
        # (indices 48-50). We keep them as a 3-row arc and leave 280693 and
        # 279016 as singletons in their far-apart original positions.
        [
            "2462570",  # I'll be back shortly.
            "325287",   # The radio station came back on the air shortly after the storm.
        ],
        [
            "278931",   # There was a sudden change in the weather.
            "280724",   # All of a sudden, all the lights went out.
            "63977",    # All of a sudden, my mother began to sing.
        ],

        # ===========================================================
        # === Tag / pricing / sales ===
        # ===========================================================
        [
            "3147964",  # Items with a red price tag are on sale.
            "3148002",  # Can you please help me put price tags on everything?
            "2050682",  # We're playing tag. Do you want to play with us?
        ],

        # ===========================================================
        # === Ceremony / dramatic openings ===
        # ===========================================================
        [
            "5624149",  # We're expecting a lot of people to attend the ceremony.
            "1860510",  # Don't be so dramatic.
            "1860506",  # Don't be so outraged.
        ],

        # ===========================================================
        # === Entrance / building / theater ===
        # ===========================================================
        [
            "48320",    # Please wait for me at the entrance of the building.
            "281906",   # We are supposed to take off our shoes at the entrance.
            "2259483",  # There was a crowd of people at the entrance of the theater.
            "1458160",  # Where's the entrance?
        ],

        # ===========================================================
        # === Lifetime / lifelong / generational ===
        # ===========================================================
        [
            "2044915",  # I wish you both a lifetime of happiness.
            "4499128",  # That isn't likely to happen in my lifetime.
        ],

        # ===========================================================
        # === Immigration / citizenship / civic ===
        # ===========================================================
        [
            "4502478",  # Is it true that illegal immigrants are taking jobs away from citizens…?
            {"text": "The evidence on that is mixed.", "added_for": "evidence|mixed", "reason": "balanced advanced reply"},
            "2030030",  # I want my children to have dual citizenship.
            "880509",   # Can you tell me how you get to the American Embassy?
        ],

        # ===========================================================
        # === Liberty / freedom / values ===
        # ===========================================================
        [
            "47240",    # I'm not at liberty to tell you about the incident.
            "5945185",  # If you value your liberty, you have to fight for it.
            "2947375",  # The right arm of the Statue of Liberty is 42 feet long.
        ],

        # ===========================================================
        # === Expenses / costs / sharing ===
        # ===========================================================
        [
            "3071620",  # Let's total up our expenses for the month.
            "6249436",  # Let me pay my share of the expenses.
            "73491",    # One hundred dollars will cover all your expenses for the trip.
        ],

        # ===========================================================
        # === Having a blast / fun ===
        # ===========================================================
        [
            "1737644",  # We're having a blast.
        ],

        # ===========================================================
        # === Family / biological / adopted ===
        # ===========================================================
        [
            "4529008",  # We have three adopted children and two biological children.
            "5821620",  # Young children are incapable of abstract thinking.
            "5833188",  # How do you know if your child is ready for preschool?
            {"text": "Honestly, you just know — it varies child by child.", "added_for": "varies", "reason": "natural answer to preschool-readiness Q"},
        ],

        # ===========================================================
        # === Midnight / late nights / sleep ===
        # ===========================================================
        [
            "3184103",  # You should go to bed. It's almost midnight.
            "5907679",  # I almost always go to bed before midnight.
            "4380174",  # One hour of sleep before midnight is worth two hours after.
        ],

        # ===========================================================
        # === Toys / kids / fairy tales ===
        # ===========================================================
        [
            "1836483",  # There is a toy shop in the neighborhood.
            "28330",    # When I was a child, my mother would often read fairy tales to me.
            "299618",   # He was very naughty when he was a little boy.
        ],

        # ===========================================================
        # === Exams / school / testing ===
        # ===========================================================
        [
            "661135",   # He's studying hard so he can pass the entrance exam.
            "2952329",  # I learned that when I was in kindergarten.
            "2951585",  # Can you remember your kindergarten teacher's name?
        ],

        # ===========================================================
        # === Designated drivers / responsibility ===
        # ===========================================================
        [
            "4498179",  # Tickets are $30 per person and $13 for designated drivers.
            "2492421",  # The last time we all went out drinking, I was the designated driver.
        ],

        # ===========================================================
        # === Recipes / cooking / delicious ===
        # ===========================================================
        [
            "2028634",  # I want the recipe for this. It's delicious.
            "2272055",  # It won't be pleasant.
        ],

        # ===========================================================
        # === Economy / unemployment / Japan stats ===
        # ===========================================================
        [
            "4704215",  # The unemployment rate in Japan was 3.4 percent in September of 2015.
            "281719",   # Lots of people in Japan are indifferent to politics.
        ],

        # ===========================================================
        # === Confusion / humor / mood ===
        # ===========================================================
        [
            "6097293",  # That created some confusion.
            "4015223",  # Are you saying I have no sense of humor?
            "32022",    # It's a pity that Mary has no sense of humor.
        ],

        # ===========================================================
        # === Uncomfortable / unease / apologies ===
        # ===========================================================
        [
            "5701930",  # I hope I didn't make you feel uncomfortable.
            "5821396",  # I hope we didn't make you feel uncomfortable today.
        ],

        # ===========================================================
        # === Basement / search / detective ===
        # ===========================================================
        [
            "5883201",  # I'll check in the basement.
            "3316620",  # Everybody is in the basement watching the game on TV.
            "4662808",  # The escaped prisoners are considered armed and dangerous.
            "2358844",  # I have a warrant to search the premises.
        ],

        # ===========================================================
        # === Unnecessary / unnecessary noise ===
        # ===========================================================
        [
            "2250985",  # That was unnecessary.
            "1872",     # If two men always have the same opinion, one of them is unnecessary.
        ],

        # ===========================================================
        # === Anonymity / donations / charity ===
        # ===========================================================
        [
            "5901337",  # This poem was written by an anonymous poet.
            "5137538",  # The person who donated this money wishes to remain anonymous.
            "302069",   # He anonymously donated a large sum of money to the Red Cross.
            "903689",   # There is an urgent need for blood donations.
            "274950",   # Thank you very much for your generous donation.
            "903701",   # There is an urgent need for more people to donate their time and money.
            "1891066",  # I'm not sure how much they are expecting me to donate.
            "5681156",  # Instead of giving each other Christmas presents this year, we donated…
        ],

        # ===========================================================
        # === Couch / relaxing / TV ===
        # ===========================================================
        [
            "2406526",  # I slept on the couch.
            "2458483",  # I think you should check under the couch.
            "496550",   # The TV remote control is under the couch.
            "2210887",  # Why don't you sit right there on the couch?
            "2033837",  # I don't want to sleep on the couch again tonight.
            "2328106",  # Don't let your children become couch potatoes.
        ],

        # ===========================================================
        # === Crushes / first love / teens ===
        # ===========================================================
        [
            "3329894",  # I used to have a little crush on you.
            "2331738",  # I had such a crush on Mary when I was in junior high school.
            "32009",    # Mary went over to the United States in her late teens.
            "909518",   # Do you think your parents spent enough time with you when you were in your teens?
        ],

        # ===========================================================
        # === Scandal / trophy / preliminary ===
        # ===========================================================
        [
            "4526762",  # A few years ago, there was a huge scandal.
            "1672635",  # That's a huge trophy.
        ],

        # ===========================================================
        # === Admission / tickets / events ===
        # ===========================================================
        [
            "72520",    # There is no admission fee for children under five.
            "4495492",  # Tickets are $30, parking is free and children under ten receive free admission.
            "4495493",  # Tickets are $30 for general admission and $20 for students and seniors.
            "4500239",  # Tickets are $13 and include a picnic lunch after the game.
        ],

        # ===========================================================
        # === Earthquake / disaster ===
        # ===========================================================
        [
            "1543185",  # Everyone inside the building felt the earthquake.
            "45483",    # When the big earthquake occurred, I was just ten.
            "45130",    # The earthquake was the biggest one that we had ever experienced.
        ],

        # ===========================================================
        # === Urgent matters / urgency ===
        # ===========================================================
        [
            "4474916",  # There are many urgent matters to attend to.
        ],

        # ===========================================================
        # === Wallet / theft / stolen ===
        # ===========================================================
        [
            "3619889",  # I'm sure no one here stole your wallet.
            "280755",   # I had my wallet stolen from my inner pocket.
            "5607343",  # When did you first notice that your wallet was missing?
        ],

        # ===========================================================
        # === Distance / campus / walk ===
        # ===========================================================
        [
            "2031040",  # It's a fifteen minute walk from here to the campus.
            "3549616",  # I live within spitting distance of the subway station.
        ],

        # ===========================================================
        # === Geography / rivers ===
        # ===========================================================
        [
            "32284",    # The Mississippi River flows into the Gulf of Mexico.
            "244921",   # Salmon go up the river and lay their eggs in the sand.
        ],

        # ===========================================================
        # === Cooking / spices / salads ===
        # ===========================================================
        [
            "2031525",  # Do you want fresh ground pepper on your salad?
            "499445",   # Excuse me, could you pass me the salt and pepper?
            "5776174",  # Add a pinch of salt.
            "915341",   # I love green peppers.
        ],

        # ===========================================================
        # === Zoo / animals / outings (trimmed) ===
        # ===========================================================
        # Original had 9 zoo rows in a row. Trimmed to 3 distinct framings.
        [
            "44694",    # There are some strange animals in the zoo.
            "954714",   # Would you prefer to go to the zoo or go to a movie?
            "3022498",  # Let's go to the zoo to watch them feed the seals.
        ],

        # ===========================================================
        # === Aircraft / helicopter / aviation ===
        # ===========================================================
        [
            "3735620",  # I have a friend who can fly a helicopter.
            "4013502",  # There's a helicopter waiting for us on the roof.
            "5193439",  # I want to learn how to fly an airplane.
            "4135211",  # I slept for a couple of hours on the airplane.
            "278186",   # The desire to fly in the sky like a bird inspired the invention of the airplane.
            "2473023",  # Do you have an airplane ticket back home?
            "1341713",  # We used to have airplanes, but we had to sell them.
        ],

        # ===========================================================
        # === Infection / illness / health ===
        # ===========================================================
        [
            "2255406",  # You've been infected.
            "4255978",  # Laser surgery can fix some kinds of vision problems.
        ],

        # ===========================================================
        # === Productivity / wasting time ===
        # ===========================================================
        [
            "909594",   # You should spend less time complaining and more time doing something productive.
        ],

        # ===========================================================
        # === Cookies / sweets / hospitality ===
        # ===========================================================
        [
            "2486565",  # Would you care for some milk and cookies?
            "5679155",  # Mary is in the kitchen making Christmas cookies.
            "953256",   # Even though there were many cookies on the dish, I only ate three.
        ],
        [
            "5831806",  # What kind of people write fortune cookie messages?
            "3130158",  # When I was a kid, I had a dog named Cookie.
        ],

        # ===========================================================
        # === Deadlines / reports / work ===
        # ===========================================================
        [
            "2277512",  # The deadline for the reports is next Monday.
        ],

        # ===========================================================
        # === Athletes / fitness / training ===
        # ===========================================================
        [
            "290317",   # He is a good athlete.
            "278710",   # Moderate exercise stimulates the circulation of blood.
        ],

        # ===========================================================
        # === Modernity / women / society ===
        # ===========================================================
        [
            "243769",   # Nowadays it is not unusual for a woman to travel alone.
        ],

        # ===========================================================
        # === Disasters / hurricanes ===
        # ===========================================================
        [
            "6555134",  # Hundreds of trees in this park blew over in the hurricane.
            "1397661",  # The typhoon did a lot of damage to the crops.
            "275443",   # We had no school on account of the typhoon.
            "997866",   # Because of the typhoon, my parents ended their trip one day early.
        ],

        # ===========================================================
        # === Delighted / news / success ===
        # ===========================================================
        [
            "261054",   # I was delighted at the news of her success.
        ],

        # ===========================================================
        # === Surrender / giving up ===
        # ===========================================================
        [
            "2249408",  # Just don't surrender.
            "2547819",  # I'll never surrender.
            "63142",    # You've got to give up gambling once and for all.
        ],

        # ===========================================================
        # === Toll roads / driving / travel ===
        # ===========================================================
        [
            "4489200",  # When was the last time you used a toll road?
            "4489202",  # Is there any easy way to get there without using a toll road?
        ],

        # ===========================================================
        # === Unbelievable / disbelief ===
        # ===========================================================
        [
            "2233742",  # This is unbelievable.
            "2936335",  # There are lots of presents underneath the Christmas tree.
        ],

        # ===========================================================
        # === Passport / travel documents (trimmed to avoid drill) ===
        # ===========================================================
        # Original had 8 'passport' rows in a row. Trimmed to 3 strong examples.
        [
            "3153893",  # I had my passport photo taken last week.
            "22193",    # When you travel abroad, you usually need a passport.
            "1434575",  # I've just renewed my passport, so it's good for another ten years.
        ],

        # ===========================================================
        # === Subway / public transit ===
        # ===========================================================
        [
            "2846006",  # My credit card was stolen on the subway.
            "277078",   # Can you give me directions to the subway station?
            "267480",   # I expect a subway station will be here in the future.
            "5300582",  # Would it be faster to get there by taxi or by subway?
            "242257",   # I wish the subway wasn't so crowded every morning.
            "269210",   # The new subway enables me to get to school in 20 minutes.
        ],

        # ===========================================================
        # === Creepiness / awkward ===
        # ===========================================================
        [
            "2218048",  # You're acting creepy.
            "1898069",  # This place is creepy.
        ],

        # ===========================================================
        # === Meantime / waiting / transitions ===
        # ===========================================================
        [
            "3123614",  # What would you like to do in the meantime?
        ],

        # ===========================================================
        # === Yelling / shouting / conflict ===
        # ===========================================================
        [
            "2646688",  # Why were you yelling?
            "6033407",  # I just kept yelling.
            "3618651",  # I've never been so insulted in my life.
            "3618759",  # I don't like it when people yell at me.
            "2028654",  # If you want to yell at someone, yell at me.
        ],

        # ===========================================================
        # === Junk food / health choices ===
        # ===========================================================
        [
            "2583266",  # I try not to eat too much junk food.
            "3287433",  # There's nothing in here but a lot of useless junk.
        ],

        # ===========================================================
        # === Ranch / rural life ===
        # ===========================================================
        [
            "3413072",  # What kind of ranch did you grow up on?
            "253021",   # I come from a small town in the Midwest.
        ],

        # ===========================================================
        # === Semester / academic year ===
        # ===========================================================
        [
            "1463720",  # I still have the book from last semester.
            "2945838",  # I'm going to study French for one semester.
            "387451",   # In Japan, the new semester begins in April.
            "2451117",  # I'm going to sign up for a French class next semester.
        ],

        # ===========================================================
        # === Legal / jury / verdict ===
        # ===========================================================
        [
            "953163",   # Could you describe to the jury what happened?
            "5821882",  # How long do you think the jury will take before they reach a verdict?
            "2276015",  # I don't have a badge.
            "2271982",  # I won't plead guilty.
            "324813",   # The whereabouts of the suspect is still unknown.
        ],

        # ===========================================================
        # === Fines / penalties / parking ===
        # ===========================================================
        [
            "421692",   # I've paid parking fines a number of times myself.
            "73214",    # I was fined a dollar.
            "2006583",  # I was fined for fishing without a license.
        ],

        # ===========================================================
        # === Nutrition / vitamins / wellness ===
        # ===========================================================
        [
            "4266798",  # Sunshine is the main source of vitamin D.
            "953074",   # A lot of people are dealing with hay fever now.
        ],

        # ===========================================================
        # === Hospitality / politeness ===
        # ===========================================================
        [
            "242668",   # Thank you very much for your hospitality today.
        ],

        # ===========================================================
        # === Terrific / enthusiasm ===
        # ===========================================================
        [
            "52022",    # Terrific!
        ],

        # ===========================================================
        # === Keys / locks / security ===
        # ===========================================================
        [
            "1286434",  # Give me the keys so I can unlock the door.
            "5860792",  # I unlocked the safe.
            "5904717",  # I unlocked the door and walked into the room.
            "4499459",  # I leave my windows and doors unlocked most of the time.
            "2741258",  # Mary took her key out of her purse and unlocked the door.
        ],

        # ===========================================================
        # === Hobbies / gambling / personal vices ===
        # ===========================================================
        [
            "251747",   # Both my father and my brother are fond of gambling.
            "5854413",  # Our gamble paid off.
        ],

        # ===========================================================
        # === Umbrellas / weather preparation (heavily trimmed drill) ===
        # ===========================================================
        # Original had 13 umbrella sentences in a row — a heavy drill.
        # Trimmed to 3 distinct framings; rest removed above as overflow.
        [
            "1495863",  # Where is my umbrella?
            "34628",    # It might rain. We'd better take an umbrella.
            "6033144",  # I have an extra umbrella I could lend you.
        ],

        # ===========================================================
        # === Distraction / focus ===
        # ===========================================================
        [
            "2366931",  # I got distracted and I lost track of time.
            "2011558",  # I want a distraction.
        ],

        # ===========================================================
        # === Dolphins / nature trivia ===
        # ===========================================================
        [
            "4628954",  # Do dolphins really sleep with one eye open?
            {"text": "Yes — one hemisphere of the brain stays alert.", "added_for": "hemisphere|brain|alert", "reason": "natural sophisticated answer"},
            "395401",   # Whales are very large mammals that live in the ocean.
        ],

        # ===========================================================
        # === Tenants / housing / rental ===
        # ===========================================================
        [
            "4504122",  # The previous tenants left the place in a mess.
            "27282",    # I'd like to rent your most inexpensive car for a week.
        ],

        # ===========================================================
        # === Pharmacy / medical care ===
        # ===========================================================
        [
            "819846",   # I work in a pharmacy.
            "1140080",  # Let me introduce you to a good dentist.
            "4529096",  # You should call the dentist for an appointment.
            "474582",   # You should go to the dentist and have that tooth pulled out.
            "953611",   # I shouldn't have to go to the dentist again for a while.
        ],

        # ===========================================================
        # === Food / dining ===
        # ===========================================================
        [
            "2196678",  # I like roast chicken.
            "2233741",  # This is unacceptable.
        ],

        # ===========================================================
        # === Debate / lively discussion ===
        # ===========================================================
        [
            "5749733",  # We had a lively debate about the issue.
            {"text": "What position did you take?", "added_for": "position", "reason": "natural debate follow-up"},
        ],

        # ===========================================================
        # === Fishing / leisure ===
        # ===========================================================
        [
            "903858",   # I think it's time for me to put new bait on the hook.
        ],

        # ===========================================================
        # === Jewelry / gifts / personal items ===
        # ===========================================================
        [
            "322312",   # I gave my sister a pearl necklace on her birthday.
            "887474",   # She tried to persuade him to buy her a pearl necklace.
            "2331675",  # I had no idea this bracelet was stolen.
            "6108515",  # I think that I'll buy this bracelet for Mary.
            "2912462",  # How many bracelets do you think Mary has?
        ],

        # ===========================================================
        # === Weather + caution / slippery ===
        # ===========================================================
        [
            "4039445",  # The roads are slippery, so please be careful.
            "3168557",  # These stairs are a little slippery, so please be careful.
            "1830525",  # Since it was raining, we had to eat our picnic lunch indoors.
        ],

        # ===========================================================
        # === Insults / put-downs / dignity ===
        # ===========================================================
        [
            "1477406",  # I can't put up with his insults any longer.
            "2141539",  # I mean no disrespect.
            {"text": "None taken — let's keep it civil.", "added_for": "civil", "reason": "advanced de-escalation"},
            "6120742",  # Do you think you could stop insulting me in front of my family?
            "5668012",  # Don't feel insulted.
        ],

        # ===========================================================
        # === Refrigerator / kitchen / food storage ===
        # ===========================================================
        [
            "2062867",  # I'm sure you'll find something in the refrigerator.
            "1428333",  # When I opened the refrigerator, I noticed the meat had spoiled.
            "6524440",  # I wonder whether or not there's any cheese left in the refrigerator.
        ],

        # ===========================================================
        # === Outrage / disgust ===
        # ===========================================================
        [
            "1037114",  # My heart is pounding.
            "328646",   # I wonder why tennis is played in mini-skirts.
        ],

        # ===========================================================
        # === Cooking prep / onions / chopping ===
        # ===========================================================
        [
            "5859339",  # I sliced the onions.
            "3773414",  # Mary cut herself while she was chopping up onions.
        ],

        # ===========================================================
        # === Aquariums / outings ===
        # ===========================================================
        [
            "2753381",  # Would you like to go to the aquarium with me?
        ],

        # ===========================================================
        # === Lucrative deals / opportunities ===
        # ===========================================================
        [
            "4496999",  # I think that could be a lucrative deal.
            {"text": "What's the catch?", "added_for": "catch", "reason": "advanced skeptical Q"},
        ],

        # ===========================================================
        # === Language / fluency / slang ===
        # ===========================================================
        [
            "475757",   # It's fun to learn slang words in foreign languages.
            "6033418",  # I grew up bilingual.
            "1209578",  # Almost every person in this country is bilingual.
            "3738405",  # Do you consider yourself a fluent French speaker?
            "480328",   # If he's fluent in English, I'll hire him.
            "6482563",  # I eventually want to be fluent in French.
            "2451057",  # The teacher claimed that he'd have us all speaking fluent French in three months.
        ],

        # ===========================================================
        # === Magic / magicians / illusion ===
        # ===========================================================
        [
            "250002",   # I have a friend whose father is a magician.
            "66707",    # I'm very serious about wanting to be a good magician.
            "5859551",  # You seem unreliable.
        ],

        # ===========================================================
        # === Combs / grooming / personal items ===
        # ===========================================================
        [
            "261969",   # I have a wooden comb.
        ],

        # ===========================================================
        # === Misunderstanding / cold reception ===
        # ===========================================================
        [
            "303982",   # He apologized for his rudeness, but she wouldn't forgive him.
            "256670",   # I apologized for having been late for school.
            "301015",   # He apologized to me for stepping on my foot.
            "265398",   # I apologized, but even then she wouldn't speak to me.
        ],

        # ===========================================================
        # === Carrots / simple food ===
        # ===========================================================
        [
            "757522",   # Rabbits like carrots.
            "6108777",  # Do you like carrots?
            "4876192",  # There is nothing like the smell of roasted coffee.
        ],

        # ===========================================================
        # === Pity / sentiment / pillows ===
        # ===========================================================
        [
            "1892800",  # Please give me a pillow and a blanket.
            "322496",   # May I have a pillow and a blanket, please?
        ],

        # ===========================================================
        # === Skirts / clothing ===
        # ===========================================================
        [
            "1397710",  # She was wearing a green coat with a matching mini-skirt.
            "45393",    # The boy took off his clothes and put on his pajamas.
        ],

        # ===========================================================
        # === Messenger / role / blame ===
        # ===========================================================
        [
            "1180463",  # I'm just a messenger.
            "3575414",  # Hey, don't blame me. I'm just the messenger.
        ],

        # ===========================================================
        # === Purses / belongings ===
        # ===========================================================
        [
            "5181111",  # Let's get together for a game of chess.
            "2334061",  # I happen to be a pretty good chess player.
        ],

        # ===========================================================
        # === Anatomy / cells / body ===
        # ===========================================================
        [
            "270629",   # The human body is composed of billions of small cells.
            "278110",   # I am not accustomed to walking long distances.
            "16700",    # You'll soon get accustomed to this cold weather.
            "253207",   # I'm accustomed to sleeping in a room without air conditioning.
        ],

        # ===========================================================
        # === Sobriety / drinking / awareness ===
        # ===========================================================
        [
            "2199763",  # You need to sober up.
        ],

        # ===========================================================
        # === Weapons / safety ===
        # ===========================================================
        [
            "2360856",  # I hope I don't have to use this pistol.
            "35285",    # I became very nervous when I couldn't locate my passport.
        ],

        # ===========================================================
        # === Smoking / habits ===
        # ===========================================================
        [
            "1725086",  # Have you ever smoked?
            "6482423",  # I've never smoked a cigarette in my life.
        ],

        # ===========================================================
        # === Anniversary / celebrations ===
        # ===========================================================
        [
            "244595",   # We celebrated our tenth wedding anniversary yesterday.
            "4793152",  # Today my wife and I are celebrating our twentieth wedding anniversary.
        ],

        # ===========================================================
        # === Adhesives / craft ===
        # ===========================================================
        [
            "255356",   # I stuck two sheets of paper together with paste.
        ],

        # ===========================================================
        # === Unusual / unusually ===
        # ===========================================================
        [
            "54619",    # I've never tasted anything as unusual as this.
            "326042",   # I hear that you are having an unusually cold winter.
        ],

        # ===========================================================
        # === Preaching / unsolicited advice ===
        # ===========================================================
        [
            "403325",   # I'm fed up with him always preaching to me.
        ],

        # ===========================================================
        # === Honeymoon / travel ===
        # ===========================================================
        [
            "6565063",  # We went to Australia for our honeymoon.
        ],

        # ===========================================================
        # === Pets / animals ===
        # ===========================================================
        [
            "2776915",  # I hear that there are people in Japan who keep penguins as pets.
            "258771",   # I bought lace curtains for my bedroom window.
        ],

        # ===========================================================
        # === Health / wealth wisdom ===
        # ===========================================================
        [
            "239694",   # Needless to say, health is more important than wealth.
            "4498271",  # Needless to say, we were very tired by the end of the day.
        ],

        # ===========================================================
        # === Persistence / pleading ===
        # ===========================================================
        [
            "887331",   # She pleaded with him to stay a little bit longer.
            "1138333",  # My son loves rockets.
        ],

        # ===========================================================
        # === Textbooks / study materials ===
        # ===========================================================
        [
            "2362207",  # I just got my textbooks for this semester.
        ],

        # ===========================================================
        # === Music / chords / keyboard ===
        # ===========================================================
        [
            "2944987",  # Can you play that chord on the keyboard?
            "4544939",  # Could you write down the chord progression for this song?
            "395037",   # I can't remember the melody to that song.
            "2301968",  # I can't get that melody out of my head.
            "5930342",  # I wrote an arrangement of this piece for a symphony orchestra.
        ],

        # ===========================================================
        # === Close calls / near-misses ===
        # ===========================================================
        [
            "252970",   # I narrowly escaped being run over by a car.
            "293180",   # He narrowly escaped from the bus when it caught fire.
        ],

        # ===========================================================
        # === Capacity / volumes / measurements ===
        # ===========================================================
        [
            "5838302",  # How many gallons do you think this tank will hold?
        ],

        # ===========================================================
        # === Idioms / honey vs vinegar ===
        # ===========================================================
        [
            "3123766",  # You catch more flies with honey than with vinegar.
        ],

        # ===========================================================
        # === Deception / dishonesty ===
        # ===========================================================
        [
            "410892",   # You've been deceived.
            "254979",   # I came to the conclusion that I had been deceived.
            "2293445",  # I assure you I didn't intend to deceive you.
            "465084",   # It's wrong to deceive people, but worse to deceive yourself.
        ],

        # ===========================================================
        # === Jogging / exercise routines ===
        # ===========================================================
        [
            "5168355",  # I wish I had gone jogging or something.
            "2034047",  # Do I look like a guy who doesn't want to go jogging?
            "261804",   # I make it a rule to jog every morning.
            "24779",    # I love to jog more than anything else in the world.
        ],

        # ===========================================================
        # === Ribbons / wrapping / small touches ===
        # ===========================================================
        [
            "5860791",  # I untied the ribbon.
        ],

        # ===========================================================
        # === Pajamas / nightwear / bedtime ===
        # ===========================================================
        [
            "5991266",  # I want to live somewhere that isn't polluted.
            "2568454",  # It's one of the most polluted cities in the world.
            "4544674",  # They said they were dissatisfied with their low wages.
        ],

        # ===========================================================
        # === Ornaments / Christmas / decorations ===
        # ===========================================================
        [
            "1297184",  # I haven't broken a Christmas ornament in years.
            "5679057",  # Some of the students decorated the classroom with Christmas ornaments.
        ],

        # ===========================================================
        # === Considerate / picky / character ===
        # ===========================================================
        [
            "2250935",  # That was considerate.
            "2360556",  # I have to prioritize.
            "2380191",  # I lost my flashlight.
            "4074361",  # Do you have a flashlight I can borrow?
        ],

        # ===========================================================
        # === Insufficient / underage / qualifications ===
        # ===========================================================
        [
            "2233699",  # This is insufficient.
            "2240667",  # We're still underage.
            "6091245",  # Aren't you underage?
        ],

        # ===========================================================
        # === Marriage status / single ===
        # ===========================================================
        [
            "308438",   # I'm glad to hear that she is unmarried.
        ],

        # ===========================================================
        # === Donuts / casual eating ===
        # ===========================================================
        [
            "2359693",  # I've got some donuts.
        ],

        # ===========================================================
        # === Knitting / handicraft ===
        # ===========================================================
        [
            "3157016",  # Mary put her knitting aside and stood up.
            "388334",   # She spent many days knitting a sweater for him.
            "4680018",  # Mary pulled out her knitting needles and started to knit.
        ],

        # ===========================================================
        # === Cafeteria / meeting up ===
        # ===========================================================
        [
            "2995495",  # Does anybody know if the cafeteria is still open?
            "3387493",  # Can you meet me in the cafeteria in ten minutes?
        ],

        # ===========================================================
        # === Disqualification / faking / appearance ===
        # ===========================================================
        [
            "290679",   # He was disqualified from taking part in the contest.
            "1356726",  # Mary isn't really sick. She's just faking it.
            "2362162",  # I just felt a little dizzy. That's all.
            "4717664",  # How did you get those bruises on your legs?
        ],

        # ===========================================================
        # === Apes / intelligence / animals ===
        # ===========================================================
        [
            "325998",   # Apes are intelligent.
        ],

        # ===========================================================
        # === Picnics / outdoor meals (trimmed) ===
        # ===========================================================
        [
            "1449757",  # Let's decide on the date for the picnic.
            "1054589",  # Except for the weather, it was a great picnic.
            "5825912",  # You're not going to the picnic and that's final.
        ],
        [
            "5618484",  # I'm going on a picnic with my friends next weekend.
            "278932",   # Weather permitting, we will go on a picnic tomorrow.
        ],

        # ===========================================================
        # === Reservations / planning ===
        # ===========================================================
        [
            "387472",   # Make your airplane reservations early since flights fill up quickly around Christmas.
        ],

        # ===========================================================
        # === Spokesman / press / reporting ===
        # ===========================================================
        [
            "51648",    # The spokesman confirmed that the report was true.
        ],

        # ===========================================================
        # === Stab / violence (kept light) ===
        # ===========================================================
        [
            "5852748",  # Why did you stab me?
        ],

        # ===========================================================
        # === Unreasonable / reason ===
        # ===========================================================
        [
            "2248499",  # Is that unreasonable?
            "4653092",  # You can't reason with someone who is unreasonable.
        ],

        # ===========================================================
        # === Devastation / loss ===
        # ===========================================================
        [
            "2240828",  # We're all devastated.
            {"text": "I'm so sorry for your loss.", "added_for": "loss", "reason": "warm condolence"},
            "2241512",  # We were unsuccessful.
        ],

        # ===========================================================
        # === Microphones / public speaking ===
        # ===========================================================
        [
            "5835860",  # Get me a microphone.
            "328546",   # For some reason the microphone didn't work earlier.
        ],

        # ===========================================================
        # === Programming / computing / early skills ===
        # ===========================================================
        [
            "1192049",  # I programmed my first computer game when I was twelve years old.
        ],

        # ===========================================================
        # === Vegetation / whipped cream / dessert ===
        # ===========================================================
        [
            "5853074",  # There's plenty of whipped cream left in the bowl.
        ],

        # ===========================================================
        # === Mustache / facial hair (kept one proverb) ===
        # ===========================================================
        [
            "4506459",  # My older brother has a mustache.
            "1550060",  # A kiss without a mustache is like an egg without salt.
        ],

        # ===========================================================
        # === Intrigue / curiosity ===
        # ===========================================================
        [
            "2244980",  # Aren't you intrigued?
            {"text": "Tell me more — I'm all ears.", "added_for": "ears", "reason": "advanced idiom answer"},
        ],

        # ===========================================================
        # === Exception / refusal ===
        # ===========================================================
        [
            "2647056",  # This is an exception.
            "2808218",  # I don't think we can make an exception.
            {"text": "On what basis are you refusing?", "added_for": "basis|refusing", "reason": "advanced challenge"},
        ],

        # ===========================================================
        # === Bribery / corruption ===
        # ===========================================================
        [
            "1950930",  # I can't believe you're trying to bribe me.
            "887046",   # She couldn't convince him to accept the bribe.
        ],
    ],
}
