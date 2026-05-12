"""Curation plan for OGTE Level 11 — Early Upper Intermediate (~1643 sentences).

L11 builds on L1-L10. At this stage the learner can handle:
  - nuanced opinion / polite disagreement / hedging ("apparently", "I assume",
    "I suppose", "I bet", "I doubt", "I sincerely hope")
  - hypotheticals + abstract reasoning ("would've", "should've", "could've",
    "I'd be crazy to…")
  - workplace and money topics (salary, hire, fees, deposit, retirement)
  - narratives, drama, polite/casual register shifts
  - high-frequency idioms ("tough call", "fair enough", "valid point",
    "fancy meeting you here", "wing it")
  - softer modal nuance ("ought to", "should've", "would've")
  - common collocations: "tough choice / call / spot / fight",
    "definitely + adj", "incredible + noun", "none of (this / your concern)"

Curation philosophy (loosened):
  - Long sentences are fine.
  - Common idioms are valuable — keep most.
  - Drama (relationship/family/passive-aggressive) is fine. Drop only sexist
    or demeaning generalisations.
  - Specific years / numbers are fine in moderation.
  - Some crime / violence is fine (police, theft, fight, mild murder
    narratives). Drop only gore-heavy or war-glorifying.
  - Body parts are fine. Narratives are fine.
  - Political content is fine if not country-specific.
  - Proper names ("Mary", "Tom", "Bob") are fine in moderation.

Still removed:
  - Dated brand names (Facebook, iPhone, YouTube — Christmas is fine).
  - Overtly sexist generalisations.
  - Extremely niche cultural references / trivia.
  - Exact duplicates.
  - Drill patterns / near-duplicates (collapse to 2-3 best).

Drill / duplicate-pattern arcs are explicitly broken up — no more than ~3
consecutive items with the same content word; vocab variation preferred.

The first three arcs are hand-picked highest-quality openers and are tagged
`"position": "first"`.
"""

from __future__ import annotations


L11_PLAN = {
    "removals": [
        # ============================================================
        # Exact duplicates / near-duplicates
        # ============================================================
        {"id": "4917412", "reason": "Duplicates 239535 ('10% discount for cash')."},
        {"id": "63560", "reason": "Duplicates 6099772 ('Aren't you bringing your camera?')."},
        {"id": "490182", "reason": "Duplicate of 38102 with 'with me' tacked on."},
        {"id": "31563", "reason": "Duplicates 953245 ('Don't add too much salt')."},
        {"id": "2212235", "reason": "Long duplicate of 953245."},
        {"id": "33770", "reason": "Duplicates 60527 ('Please lend me your pen')."},
        {"id": "1542230", "reason": "Duplicates 619725 ('chain... weakest link')."},
        {"id": "71047", "reason": "Duplicates 1040741 ('Don't bite the hand that feeds you')."},
        {"id": "402789", "reason": "Duplicate of 402791 with 'persuade' swap."},
        {"id": "402790", "reason": "Duplicate of 402791."},
        {"id": "4999698", "reason": "Duplicates 3466173 ('make tough choices')."},
        {"id": "2955090", "reason": "Duplicates 2955091."},
        {"id": "5057538", "reason": "Duplicates 326200 ('trains running on schedule')."},
        {"id": "314414", "reason": "Duplicates 298072 ('accused me of being a liar')."},
        {"id": "2218067", "reason": "Duplicate of 2202877 ('forgiven')."},
        {"id": "2218375", "reason": "Duplicate of 2202902 ('You're so generous')."},
        {"id": "4404044", "reason": "Duplicate of 4220046 ('demanded higher salary')."},
        {"id": "4497167", "reason": "Longer duplicate of 5276195 ('street narrow for trucks')."},
        {"id": "312017", "reason": "Duplicate of 19356 ('stuck in throat')."},
        {"id": "2335891", "reason": "Duplicates simpler 'I have to hurry' form."},
        {"id": "502705", "reason": "Duplicate of 502703 ('I don't like swimming in pools')."},

        # ============================================================
        # Dated brand names / extremely niche cultural references
        # ============================================================
        {"id": "3738136", "reason": "'Who won the Super Bowl?' — niche US sports brand."},
        {"id": "4500083", "reason": "'I love the Giants.' — niche US team."},
        {"id": "4500111", "reason": "'I'm a Giants fan.' — niche US team."},
        {"id": "321575", "reason": "'I took Highway 58.' — US highway numbering trivia."},
        {"id": "1347383", "reason": "'Benjamin Franklin was an American politician...' — quiz fact."},
        {"id": "5006828", "reason": "'The French Revolution took place in 1789.' — history quiz."},
        {"id": "44009", "reason": "'The bill passed the Diet.' — confusing 'Diet'=parliament."},
        {"id": "23782", "reason": "'The Diet will meet on Tuesday.' — same."},
        {"id": "275025", "reason": "'The Pacific Ocean is one of the five oceans.' — geography quiz."},
        {"id": "1990393", "reason": "'Japan is a country completely surrounded by oceans.' — quiz."},
        {"id": "5358576", "reason": "'The Eiffel Tower is in Paris.' — bare geography fact."},
        {"id": "44780", "reason": "'The tower is 321 meters high.' — trivia number."},
        {"id": "1891107", "reason": "'I'm pretty sure that tower is 330 meters tall.' — trivia."},
        {"id": "73642", "reason": "'There was a sign saying \"Keep off the grass.\"' — niche US lawn sign."},
        {"id": "51338", "reason": "'Do you have cough drops?' — niche US pharmacy."},
        {"id": "595865", "reason": "'I injured myself during PE class.' — abbreviation 'PE' opaque."},
        {"id": "239497", "reason": "'Strictly speaking, a tomato is a fruit.' — trivia."},

        # ============================================================
        # Overtly sexist generalisations
        # ============================================================
        {"id": "4517684", "reason": "'Even though many women shave their legs, Mary doesn't.' — gendered."},
        {"id": "238741", "reason": "'Keep your eyes wide open before marriage, half shut afterwards.' — sexist proverb."},
        {"id": "33328", "reason": "'Almost every tourist carries a camera with him.' — gendered + dated."},
        {"id": "5643095", "reason": "'I've never been a betting man.' — gendered."},
        {"id": "4836686", "reason": "'Not all Germans like to drink beer.' — national stereotype."},
        {"id": "719230", "reason": "'It's always sunny in Italy.' — national generalisation."},
        {"id": "2218038", "reason": "'You're a sexist.' — accusatory label out of context."},
        {"id": "3738764", "reason": "'Why would that be considered sexist?' — same."},

        # ============================================================
        # Old / obscure proverbs (most idioms kept under loosened policy)
        # ============================================================
        {"id": "274070", "reason": "'Early to bed and early to rise, makes a man healthy, wealthy and wise.' — archaic."},
        {"id": "677144", "reason": "'When candles are out, all cats are grey.' — old proverb."},
        {"id": "3387124", "reason": "'A man's home is his castle.' — old proverb."},
        {"id": "24978", "reason": "'A jack of all trades is a master of none.' — old proverb."},
        {"id": "3501292", "reason": "'Speak softly and carry a big stick.' — culturally specific aphorism."},
        {"id": "1058976", "reason": "'Revolutions that don't succeed are soon forgotten.' — abstract proverb."},
        {"id": "1446022", "reason": "'Today's friends are tomorrow's enemies.' — cynical aphorism."},
        {"id": "1367722", "reason": "'He wondered how many times the sun would rise before his salary would.' — opaque wordplay."},
        {"id": "3731395", "reason": "'Those are old wives' tales.' — apostrophe-plural confusing."},
        {"id": "303990", "reason": "'I bet my bottom dollar he is innocent.' — opaque idiom."},

        # ============================================================
        # Drill / overflow trimming (collapse arcs to 2-3 best)
        # ============================================================
        # "My uncle ..." appears ~13 times — keep ~6.
        {"id": "250252", "reason": "Uncle drill — 'My uncle lives in an apartment.'"},
        {"id": "253234", "reason": "Uncle drill — 'I was named after my uncle.'"},
        {"id": "250245", "reason": "Uncle drill — 'My uncle calls on me every three days.'"},
        {"id": "251169", "reason": "Uncle drill — duplicates 'My uncle runs a hotel.'"},
        {"id": "251181", "reason": "Uncle drill — 'My uncle never writes letters.'"},
        {"id": "63263", "reason": "Uncle drill — 'Your uncle and I have known each other for many years.'"},
        {"id": "250241", "reason": "Uncle drill — 'My uncle lived to be ninety.'"},

        # "There is an urgent need for ..." — keep 1.
        {"id": "903687", "reason": "Urgent-need drill — affordable housing."},
        {"id": "903691", "reason": "Urgent-need drill — clean energy."},
        {"id": "903699", "reason": "Urgent-need drill — more doctors."},
        {"id": "903703", "reason": "Urgent-need drill — peace talks."},
        {"id": "903705", "reason": "Urgent-need drill — qualified teachers."},
        {"id": "903696", "reason": "Urgent-need drill — improved living conditions."},
        {"id": "903709", "reason": "Urgent-need drill — good legal advice."},
        {"id": "903704", "reason": "Urgent-need drill — help clean environment."},
        {"id": "903712", "reason": "Urgent-need drill — local government homeless."},

        # "Beach" appears ~25 times — trim heavy duplicates.
        {"id": "256097", "reason": "Beach overflow — 'I spent the entire day on the beach.'"},
        {"id": "248498", "reason": "Beach overflow — 'We walked along the beach.'"},
        {"id": "1229074", "reason": "Beach overflow — 'I'm spending my holiday on the beach.'"},
        {"id": "2516444", "reason": "Beach overflow — 'I love sitting on the beach.'"},
        {"id": "5613114", "reason": "Beach overflow — 'I'm going to the beach this afternoon.'"},
        {"id": "2486693", "reason": "Beach overflow — 'I just want to sit on the beach...'"},
        {"id": "2486694", "reason": "Beach overflow — 'I just lay on the beach...'"},
        {"id": "256583", "reason": "Beach overflow — 'I spent my vacation at the beach.'"},
        {"id": "2486692", "reason": "Beach overflow — 'I saw many tourists on the beach.'"},
        {"id": "5767040", "reason": "Beach overflow — duplicates 'The beach was crowded.'"},
        {"id": "1396376", "reason": "Beach overflow — 'The beach is an ideal place for children to play.'"},

        # Camera overflow.
        {"id": "319293", "reason": "Camera drill — 'My father bought me a camera for my birthday.'"},
        {"id": "252143", "reason": "Camera drill — dated $30 price."},
        {"id": "986470", "reason": "Camera drill — 'film in this camera' (dated)."},
        {"id": "250290", "reason": "Camera drill — 'My camera is different from yours.'"},
        {"id": "61223", "reason": "Camera drill — 'This camera is less expensive than that one.'"},
        {"id": "38102", "reason": "Camera drill — 'I take my camera wherever I go.'"},
        {"id": "61215", "reason": "Camera drill — 'Is this camera for sale?'"},
        {"id": "261188", "reason": "Camera drill — 'I lent her my camera.'"},

        # Definitely — drill trimming.
        {"id": "5257503", "reason": "'I'll definitely buy ticket.' — ungrammatical."},
        {"id": "4499693", "reason": "Definitely drill — 'I was definitely surprised.'"},
        {"id": "4502434", "reason": "Definitely drill — 'We definitely surprised them.'"},
        {"id": "4499713", "reason": "Definitely drill — 'I definitely recommend it.'"},
        {"id": "4499748", "reason": "Definitely drill — 'I definitely was shocked.'"},
        {"id": "4502076", "reason": "Definitely drill — 'It was definitely shocking.'"},
        {"id": "4664209", "reason": "Definitely drill — 'Doing that definitely couldn't hurt.'"},

        # Bet — overflow trimming.
        {"id": "5813326", "reason": "Bet drill — 'Which horse did you bet on?'"},
        {"id": "5850875", "reason": "Bet drill — 'I bet on horses.'"},
        {"id": "2388042", "reason": "Bet drill — 'I never bet on baseball.'"},
        {"id": "2388043", "reason": "Bet drill — 'I never bet on horse races.'"},
        {"id": "2645475", "reason": "Bet drill — 'Place your bets, please.'"},
        {"id": "2294106", "reason": "Bet drill — 'I bet we've all asked ourselves that same question.'"},
        {"id": "2775442", "reason": "Bet drill — 'I bet she is younger than me.'"},
        {"id": "2712899", "reason": "Bet drill — 'I bet you've never climbed a tree.'"},

        # Tough — overflow trimming.
        {"id": "5469745", "reason": "Tough drill — 'They're tough guys.'"},
        {"id": "5469761", "reason": "Tough drill — 'They're tough kids.'"},
        {"id": "4665311", "reason": "Tough drill — 'It's a really tough challenge.'"},
        {"id": "4500617", "reason": "Tough drill — 'Tough decisions lie ahead.'"},
        {"id": "4500910", "reason": "Tough drill — 'Tough decisions need to be made.'"},
        {"id": "4666431", "reason": "Tough drill — 'Things could get tougher.'"},
        {"id": "4665526", "reason": "Tough drill — 'It's really tough to compare.'"},

        # Pen overflow.
        {"id": "60535", "reason": "Pen drill — 'This pen belongs to me.'"},
        {"id": "299192", "reason": "Pen drill — 'He was holding a pen in his hand.'"},
        {"id": "258656", "reason": "Pen drill — 'I have some pens.'"},
        {"id": "370732", "reason": "Pen drill — 'I have ten pens.'"},
        {"id": "1148932", "reason": "Pen drill — 'I need to search for my pen.'"},
        {"id": "25773", "reason": "Pen drill — 'Write with a pen, not with a pencil.'"},
        {"id": "33823", "reason": "Pen drill — 'Do you have a pen or pencil?'"},

        # Moon overflow (most are bare trivia).
        {"id": "238821", "reason": "Moon overflow — 'The moon is behind the clouds.'"},
        {"id": "238778", "reason": "Moon overflow — 'The moon emerged from behind the cloud.'"},
        {"id": "1779858", "reason": "Moon overflow — bare 'The moon is bright.'"},
        {"id": "5576351", "reason": "Moon overflow — 'How many full moons are there in a year?'"},
        {"id": "2263290", "reason": "Moon overflow — 'The moon is brighter than usual tonight.'"},

        # Tower overflow (trivia).
        {"id": "67894", "reason": "Tower trivia — 'The clock on that tower is accurate.'"},
        {"id": "1246970", "reason": "Tower trivia — 'How tall is that tower?'"},

        # Castle overflow.
        {"id": "46225", "reason": "Castle drill — 'When was the castle built?'"},
        {"id": "49018", "reason": "Castle drill — 'There is a castle in the background of the picture.'"},
        {"id": "2301316", "reason": "Castle drill — 'I can see the castle from my bedroom window.'"},
        {"id": "252280", "reason": "Castle drill — bare 'I like castles.'"},

        # Pink overflow.
        {"id": "5852080", "reason": "Pink drill — 'I never wear pink.'"},
        {"id": "34441", "reason": "Pink drill — 'We ordered pink, but we received blue.'"},
        {"id": "316895", "reason": "Pink drill — 'She painted the wall pink.'"},
        {"id": "3121857", "reason": "Pink drill — 'My sister's car is pink.'"},

        # Ceiling overflow.
        {"id": "5852977", "reason": "Ceiling drill — 'What color are you going to paint the ceiling?'"},
        {"id": "848767", "reason": "Ceiling drill — 'I've painted the ceiling.'"},
        {"id": "259593", "reason": "Ceiling drill — 'I can't reach the ceiling.'"},
        {"id": "278781", "reason": "Ceiling drill — 'I saw a fly on the ceiling.'"},

        # Shave overflow.
        {"id": "5828638", "reason": "Shave drill — bare 'I shaved.'"},
        {"id": "3736404", "reason": "Shave drill — 'I haven't shaved yet.'"},
        {"id": "5828979", "reason": "Shave drill — 'I'm shaving.'"},
        {"id": "2548646", "reason": "Shave drill — 'Shaving takes time.'"},
        {"id": "266768", "reason": "Shave drill — 'I've got to shave before leaving.'"},

        # Sleeve overflow.
        {"id": "260526", "reason": "Sleeve drill — 'I held his sleeve.'"},
        {"id": "274540", "reason": "Sleeve drill — 'Don't pull my sleeve.'"},
        {"id": "4740215", "reason": "Sleeve drill — 'I wear short-sleeve shirts in the summer.'"},
        {"id": "3329505", "reason": "Sleeve drill — 'I should've worn short sleeves.'"},

        # Truck overflow (mostly bare).
        {"id": "5398373", "reason": "Truck drill — bare 'The truck drove away.'"},
        {"id": "1525642", "reason": "Truck drill — bare 'He drives a truck.'"},
        {"id": "3619117", "reason": "Truck drill — 'I've never driven a truck.'"},
        {"id": "2325145", "reason": "Truck drill — 'I drive a delivery truck.'"},
        {"id": "2259587", "reason": "Truck drill — 'They loaded the truck.'"},
        {"id": "3392674", "reason": "Truck drill — 'Let's get those supplies loaded on the truck.'"},
        {"id": "2640934", "reason": "Truck drill — 'We're ready to begin loading the truck.'"},
        {"id": "1553309", "reason": "Truck drill — 'Who owns this truck?'"},

        # Bike overflow.
        {"id": "257723", "reason": "Bike drill — 'I fixed the bike yesterday.'"},
        {"id": "71799", "reason": "Bike drill — 'Let's rent a bike there.'"},
        {"id": "250678", "reason": "Bike drill — 'My brother uses this bike.'"},

        # Cancel overflow.
        {"id": "3873871", "reason": "Cancel drill — 'School was cancelled because of the snow.'"},
        {"id": "4662703", "reason": "Cancel drill — 'They're likely to cancel school tomorrow...'"},
        {"id": "4495364", "reason": "Cancel drill — 'They canceled the festival.'"},
        {"id": "4662904", "reason": "Cancel drill — 'Many flights have been canceled because of the storm.'"},
        {"id": "402791", "reason": "Cancel drill — 'It was difficult to convince him to cancel the trip.'"},

        # Delay overflow.
        {"id": "279175", "reason": "Delay drill — 'It makes no difference whether the train is delayed or not.'"},
        {"id": "279171", "reason": "Delay drill — 'The train was delayed for an hour.'"},
        {"id": "240354", "reason": "Delay drill — 'We were delayed by the heavy traffic.'"},
        {"id": "4497162", "reason": "Delay drill — 'My flight was delayed.'"},
        {"id": "3313101", "reason": "Delay drill — 'We had a slight delay.'"},
        {"id": "2640582", "reason": "Delay drill — 'We're only thirty minutes behind schedule.'"},

        # Salary overflow.
        {"id": "264679", "reason": "Salary drill — 'I'm content with my salary.'"},
        {"id": "1273363", "reason": "Salary drill — 'He receives a high salary.'"},
        {"id": "4220046", "reason": "Salary drill — 'They demanded a salary increase.'"},
        {"id": "295252", "reason": "Salary drill — 'He demanded that his salary be increased.'"},

        # Translate overflow.
        {"id": "6344975", "reason": "Translate drill — 'I translated the document into French.'"},
        {"id": "4195852", "reason": "Translate drill — 'This book hasn't yet been translated into French.'"},
        {"id": "4662903", "reason": "Translate drill — 'Someone needs to translate this contract into French.'"},
        {"id": "3357913", "reason": "Translate drill — 'Thank you for helping me translate the report into French.'"},

        # Bell overflow.
        {"id": "71720", "reason": "Bell drill — 'There goes the bell.'"},
        {"id": "385375", "reason": "Bell drill — bare 'The bell rang.'"},

        # Beer overflow.
        {"id": "2541013", "reason": "Beer drill — 'I'll be in the bar drinking beer.'"},
        {"id": "5907623", "reason": "Beer drill — 'I'll pick up some beer on my way back.'"},
        {"id": "34849", "reason": "Beer drill — 'Beer bottles are made of glass.'"},
        {"id": "1173209", "reason": "Beer drill — 'I ate fried rice and drank some beer.'"},
        {"id": "1358326", "reason": "Beer drill — bare 'He drank beer.'"},
        {"id": "3419889", "reason": "Beer drill — 'Who brought the beer?'"},
        {"id": "3150808", "reason": "Beer drill — 'Go buy a case of beer.'"},
        {"id": "4134972", "reason": "Beer drill — 'I never drink beer before lunch.'"},
        {"id": "2012099", "reason": "Beer drill — 'Does anybody want a beer?'"},
        {"id": "3738094", "reason": "Beer drill — 'How many beers did you drink?'"},
        {"id": "34846", "reason": "Beer drill — 'Two beers, please.'"},

        # Ski overflow (niche sport).
        {"id": "1894518", "reason": "Ski drill — 'I'm looking forward to our ski trip.'"},
        {"id": "1005355", "reason": "Ski drill — 'I want to buy ski boots.'"},
        {"id": "5240985", "reason": "Ski drill — 'I dreamed I was water skiing.'"},
        {"id": "2716051", "reason": "Ski drill — 'I've been a ski instructor for three years.'"},
        {"id": "2715997", "reason": "Ski drill — 'It's a lot of fun skiing in fresh snow.'"},

        # Crazy overflow.
        {"id": "70839", "reason": "Crazy drill — vague 'Your ideas sound crazy.'"},
        {"id": "3735719", "reason": "Crazy drill — 'These are just crazy ideas.'"},
        {"id": "2406859", "reason": "Crazy drill — duplicates 2835617."},
        {"id": "2323090", "reason": "Crazy drill — awkward long version."},
        {"id": "2892112", "reason": "Crazy drill — bare 'The world's gone crazy.'"},
        {"id": "3737635", "reason": "Crazy drill — bare 'They've all gone crazy.'"},
        {"id": "4012986", "reason": "Crazy drill — 'Who's crazy enough to do that?'"},
        {"id": "32534", "reason": "Crazy drill — vague 'Everything's a little crazy right now.'"},

        # Accused overflow.
        {"id": "302573", "reason": "Accused drill — 'He accused her of having lied to him.'"},
        {"id": "886844", "reason": "Accused drill — 'She accused him of having lied to her.'"},
        {"id": "305523", "reason": "Accused drill — 'They accused him of telling a lie.'"},
        {"id": "307626", "reason": "Accused drill — 'They accused me of having broken my promise.'"},
        {"id": "291128", "reason": "Accused drill — 'He accused the man of stealing.'"},

        # Till + niche.
        {"id": "246491", "reason": "'Hang on till I get to you.' — niche dramatic."},
        {"id": "72353", "reason": "'Can I hang out here till seven?' — niche."},
        {"id": "5480894", "reason": "'We waited till 2:30.' — specific time niche."},
        {"id": "3817956", "reason": "'We shouldn't have stayed up till 2:30.' — niche."},
        {"id": "246401", "reason": "'Wait till I count to ten.' — niche threat-to-children."},
        {"id": "72418", "reason": "Bare 'Wait till six.'"},
        {"id": "247110", "reason": "'Wait here till I return.' — niche."},

        # Candles overflow.
        {"id": "2245069", "reason": "Candles drill — 'Candles were everywhere.'"},
        {"id": "4496205", "reason": "Candles drill — 'Several candles were burning.'"},
        {"id": "29466", "reason": "Candles drill — 'The candle went out by itself.'"},
        {"id": "2840930", "reason": "Candles drill — 'The room was lit by a single candle.'"},
        {"id": "29456", "reason": "Candles drill — 'The candle was blown out by the wind.'"},

        # Bare adjective bodies.
        {"id": "2202626", "reason": "Bare adjective — 'I'm brave.'"},
        {"id": "2202628", "reason": "Bare adjective — 'You're brave.'"},
        {"id": "2203071", "reason": "Bare adjective — 'We're mature.'"},
        {"id": "2203072", "reason": "Bare adjective — 'You're mature.'"},
        {"id": "2203352", "reason": "Bare adjective — 'You're sincere.'"},
        {"id": "2203428", "reason": "Bare adjective — 'We're sympathetic.'"},
        {"id": "2203430", "reason": "Bare adjective — 'I'm sympathetic.'"},
        {"id": "2202872", "reason": "Bare insult — 'You're foolish.'"},
        {"id": "2202777", "reason": "Niche register — 'You're dismissed.'"},

        # Poison overflow (drill).
        {"id": "40481", "reason": "Poison drill — 'Someone tried to poison our dog's food.'"},
        {"id": "4494490", "reason": "Poison drill — 'Our dogs were poisoned.'"},
        {"id": "5424320", "reason": "Poison drill — 'It was poison gas.'"},
        {"id": "5201662", "reason": "Poison drill — odd 'Is sugar a poison?'"},
        {"id": "2244920", "reason": "Poison drill — ambiguous 'Are they poisonous?'"},

        # ============================================================
        # Misc still-unsuitable singletons
        # ============================================================
        {"id": "278974", "reason": "'It's a shame the way natural resources are wasted.' — abstract soapbox."},
        {"id": "5715092", "reason": "'We have to sing at an old folks home today.' — odd."},
        {"id": "5092315", "reason": "'There's no installation fee.' — niche register."},
        {"id": "4496764", "reason": "'The installation is now complete.' — niche tech."},
        {"id": "5485589", "reason": "'Your idea is not entirely crazy.' — awkward."},
        {"id": "2734301", "reason": "'Your salary is commission-based.' — niche register."},
        {"id": "27341", "reason": "'In general, consumers prefer quantity to quality.' — academic register."},
        {"id": "281422", "reason": "'This is a Japanese doll.' — niche cultural artifact."},
    ],
    "arcs": [
        # ===========================================================
        # === Three best opening arcs (position: first) ===
        # ===========================================================
        {
            "position": "first",
            "items": [
                {"text": "What do you think?", "added_for": "think", "reason": "essential opinion-prompt at L11"},
                {"text": "It's complicated.", "added_for": "complicated", "reason": "natural hedging answer"},
                {"text": "Let me think about it.", "added_for": "let|think", "reason": "high-frequency stalling phrase"},
                {"text": "Fair enough.", "added_for": "fair|enough", "reason": "common agreement at upper-int"},
            ],
        },
        {
            "position": "first",
            "items": [
                "5020130",  # You have a valid point.
                "3109565",  # You make many valid points.
                {"text": "I suppose you're right.", "added_for": "suppose|right", "reason": "natural hedging agreement"},
                {"text": "Honestly, I'm not so sure.", "added_for": "honestly|sure", "reason": "polite disagreement at L11"},
            ],
        },
        {
            "position": "first",
            "items": [
                "3618618",  # It's a tough choice.
                "3466173",  # We'll have to make some tough choices.
                "2548243",  # I'm in a tough spot.
                {"text": "Tell me about it.", "added_for": "tell|about", "reason": "high-frequency sympathetic idiom"},
            ],
        },

        # === Definitely (kept core, split to avoid drill) ===
        [
            "2542143",  # We're definitely not a couple.
            "2954935",  # You're definitely not on the list.
            "4494196",  # It's definitely good news.
            "1515428",  # That's definitely the goal.
        ],
        [
            "3542214",  # This is definitely the best method.
            "3311023",  # We're definitely making progress.
            "5137564",  # There's definitely room for improvement.
            "3150521",  # We're definitely buying that house.
        ],
        [
            "2955091",  # You've definitely gotten stronger.
            "3823580",  # You've definitely improved.
            "1358196",  # I'm definitely impressed.
            "4664324",  # It's definitely worth checking out.
        ],
        [
            "5821079",  # I'll definitely sing that song sometime tonight.
            "4529293",  # We'll definitely achieve these goals.
            "4529260",  # I definitely appreciate receiving this.
        ],

        # === Crazy cluster (broken up) ===
        [
            "512224",   # I'm crazy about football.
            "451744",   # He's crazy about soccer.
            "2987675",  # My daughter's driving me crazy.
            "2046",     # It's driving me crazy.
        ],
        [
            "2218128",  # You're completely crazy.
            "2248796",  # It sounds crazy.
            "2255209",  # You seemed crazy.
            "2835617",  # Everybody probably thinks I'm crazy.
        ],
        [
            "4499019",  # The audience went crazy.
            "2713508",  # You'd be crazy to stay.
            "5090020",  # This last week's been crazy.
            "899000",   # It would be crazy to climb that mountain in the winter.
            "953582",   # I realize that this may sound crazy, but I think I've fallen in love with your younger sister.
            "5541977",  # We'd be crazy not to advertise.
        ],

        # === Apparently (hedging / reported) ===
        [
            "2244904",  # Apparently it worked.
            "2736042",  # Apparently, that's not correct.
            "5134834",  # Apparently no one noticed.
            "4895476",  # This should be obvious, but apparently it's not.
        ],
        [
            "953094",   # Apparently, we'll be getting a raise within two months.
            {"text": "That's great news!", "added_for": "news", "reason": "natural reaction to a raise"},
            "3226528",  # The danger is apparently over.
            "3825436",  # Apparently, they're dead.
            "2452015",  # It's quite apparent that you don't want to do this for me.
            "4493947",  # Was that immediately apparent?
        ],

        # === Tough collocations cluster (rest after first arc) ===
        [
            "4850029",  # That's a very tough deal.
            "4902858",  # I expect a tough fight.
            "2953713",  # We need a really tough guy.
            "5845885",  # How tough is that to handle?
            {"text": "Honestly, pretty tough.", "added_for": "honestly", "reason": "natural hedged answer"},
        ],
        [
            "57553",    # The meat is tough.
            "3820324",  # It was a tough test.
            "2952908",  # I've had a tough afternoon.
            "4502639",  # Times are tough everywhere.
            "2251024",  # That'll be tough.
            "5135822",  # There will be tough competition.
        ],

        # === None of (broken up) ===
        [
            "3532129",  # None of this makes sense.
            "3131510",  # None of this is really happening.
            "1745592",  # None of these things surprise me.
        ],
        [
            "2647108",  # None of this matters.
            "2647111",  # None of that matters.
            "4494190",  # None of that is necessary.
            "3518556",  # It's a reasonable conclusion.
        ],
        # Rewrite to break drill (replaces 4502436 from old plan).
        [
            {"text": "I don't think any of that affects us.", "added_for": "any|affect", "reason": "rewrite to break 'None of' drill"},
            "3518557",  # It's none of your concern.
            "4665733",  # That's none of your concern.
            "2644085",  # None of this is your fault.
            "4530019",  # None of this affects us.
        ],
        [
            "3821588",  # None of you are invited to my party.
            "3824679",  # None of you are going to be fired.
            "5006720",  # None of us are planning to go.
            "3258119",  # None of the rooms is ready.
            "4502436",  # None of this was a surprise.
        ],

        # === Beach (kept core cluster, broken up) ===
        [
            "2546452",  # This is a public beach.
            "5074827",  # This isn't a private beach.
            "2486687",  # The beach isn't far from here.
            "1410420",  # Let's go straight to the beach.
        ],
        [
            "2486700",  # Do you enjoy walking on the beach?
            {"text": "Yes, especially in the morning.", "added_for": "especially|morning", "reason": "natural Q/A pair"},
            "268704",   # Let's walk on the beach after dinner.
            "3773373",  # I enjoy long walks on the beach.
        ],
        [
            "2486701",  # Did you grow up near a beach?
            "5379492",  # I loved going to the beach.
            "3567588",  # I live near the sea, so I often go to the beach.
            "288170",   # He likes to go to the beach now and then.
        ],
        [
            "2486671",  # We're heading for the beach. Would you like to come with us?
            "249324",   # We went swimming at the beach.
            "2953810",  # We went to the beach and swam all day.
            "2486669",  # Would you like to come to my beach party this evening?
        ],
        [
            "3258613",  # This beach is dangerous at night.
            "2547066",  # The beach was crowded.
            "3442105",  # The beach is empty.
            "4496573",  # Let's keep our beaches clean.
            "2486684",  # The police found a body washed up on the beach near here.
        ],
        [
            "2486682",  # There is a really good restaurant just off the beach...
            "4134975",  # Everyone laughed at me on the beach.
            "2380201",  # I love beach parties.
            "5090000",  # The beaches are better here.
        ],

        # === Camera (kept smaller cluster) ===
        [
            "4496187",  # Bring a camera.
            "6099772",  # Aren't you bringing your camera?
            "63563",    # Smile at the camera, please!
        ],
        [
            "2432335",  # I want to learn how to use my new digital camera right away.
            "1140132",  # I was thinking about buying a new camera.
            "463260",   # This camera is cheap.
            "250287",   # My camera was stolen.
        ],
        [
            "253340",   # I have two cameras.
            "3422106",  # We've installed several security cameras.
            "64933",    # My aunt gave me a camera.
            "887009",   # She bought him a camera that was too big to fit in his shirt pocket.
        ],

        # === Coast / East/West Coast ===
        [
            "1912019",  # I'm from the East Coast.
            "1912020",  # I'm from the West Coast.
            "2002708",  # The coast is clear.
            "3393302",  # Is the coast clear?
        ],

        # === Solution / solve / problem ===
        [
            "4979567",  # I have a simple solution.
            "5891324",  # This is a short term solution.
            "1773429",  # It's an excellent solution.
            "3127919",  # Can you suggest another solution?
            "3680894",  # May I suggest another solution?
        ],
        [
            "4498659",  # We're hoping to find a solution to the problem soon.
            "2662521",  # Let's discuss the problem and see if we can come up with a solution.
            "4828593",  # I figured out how to solve the problem.
            "254707",   # I attempted to solve the problem.
        ],
        [
            "2699821",  # Don't cry. Crying doesn't solve anything.
            "4494335",  # There were no solutions.
            "289370",   # He succeeded in solving the problem.
            "290992",   # He is an expert at solving such problems.
            "5487172",  # I like solving mysteries.
        ],
        [
            "4289992",  # The simplest solutions are always the best.
            "4872167",  # The simplest way is often the best way to solve a problem.
            "18758",    # These problems will be solved in the near future.
            "2406531",  # I solved the mystery.
            "2663081",  # I hope this solves all your problems.
        ],

        # === Bet (kept core idioms, drill broken up) ===
        [
            "2245407",  # Double your bet.
            "2271821",  # I don't bet anymore.
            "3826239",  # Did you just lose a bet?
            {"text": "Yeah, I lost ten bucks.", "added_for": "bucks", "reason": "natural Q/A — introduces 'bucks' informal money"},
        ],
        [
            "4013625",  # I bet you've got a few questions.
            "2294116",  # I bet you're wondering how this works.
            "3004920",  # I bet you think I'm just writing that to impress you.
        ],
        # Rewrite breaks "I bet..." drill chain.
        [
            "3342758",  # You bet I'm worried.
            "3728311",  # I bet I can prove it.
            "2045873",  # I'll bet you looked beautiful when you were young.
            {"text": "I'd put money on it.", "added_for": "money|put", "reason": "rewrite — variant idiom breaks 'I bet' drill"},
            "5641843",  # I would've bet my life on it.
        ],

        # === Sympathy ===
        [
            "2011373",  # I wanted sympathy.
            "1565751",  # You have my sympathy.
        ],

        # === Negative / false / charges ===
        [
            "2218386",  # You're so negative.
            "4501818",  # The results are negative.
            "1397981",  # Both claims are false.
            "3723392",  # The charges were false.
            "2249011",  # It's absolutely false.
            "2257420",  # That's totally false.
        ],

        # === Till / waiting ===
        [
            "70983",    # I can hardly wait till I see you.
            "3735138",  # I slept till dawn.
            "3824854",  # Wait till I finish exams.
            "26981",    # Wait till the rain stops.
            "257824",   # I stayed up till very late last night.
            "279173",   # Don't get off the train till it stops.
            "3241647",  # Save it till later.
            "1893834",  # We have till tomorrow night to decide.
        ],

        # === Christmas / holidays / gifts (loosened) ===
        [
            "5679126",  # Do you get your boss a Christmas gift?
            "5679158",  # Our family opens gifts on Christmas Eve.
            "5679121",  # What gift would you like to receive for Christmas?
            "5679087",  # I couldn't have wished for a better gift this Christmas.
            "23580",    # We decorated the Christmas tree with lights.
        ],
        [
            "4525582",  # If you don't behave, Santa won't come.
            "4079990",  # This is the perfect Mother's Day gift.
            "4079991",  # This is the perfect Father's Day gift.
            "2007313",  # Let's decorate the Christmas tree.
            "5679055",  # When was the last time you celebrated Christmas with your whole family?
        ],

        # === Gift exchanges ===
        [
            "51846",    # Thank you for the wonderful gift.
            "3732993",  # I really liked the gift you gave me.
            {"text": "I'm so glad you liked it.", "added_for": "glad|liked", "reason": "natural reaction"},
            "302582",   # He accepted her gift.
            "316428",   # She accepted his gift.
        ],
        [
            "2243112",  # They exchanged gifts.
            "5428767",  # I forgot to buy a gift for you.
            {"text": "Don't worry about it.", "added_for": "worry|about", "reason": "natural forgiveness reply"},
            "681031",   # Mary is going to open a gift from her boyfriend.
        ],

        # === Apology / forgive (broken up — was a "Please forgive me for..." drill) ===
        [
            "4498762",  # Please forgive my son.
            "3818251",  # Of course, I forgive you.
            "1317116",  # It doesn't matter what excuse he gives me, I can't forgive him.
            "2291888",  # I ask your forgiveness.
            "1879698",  # Please accept my apologies.
        ],
        [
            "30413",    # Please forgive me for not having written sooner.
            "2293998",  # I beg you to forgive me.
            "260508",   # I can't forgive him for behaving like that.
            "3726935",  # I offer my apologies.
        ],
        # Rewrite breaks "Please forgive me for..." chain (removes 70404 / 279271 drill).
        [
            {"text": "I'm sorry I didn't reply right away.", "added_for": "sorry|reply", "reason": "rewrite — replaces 70404/279271 drill"},
            "2011363",  # I want an apology.
            "2011810",  # They wanted an apology.
            "4498761",  # People are pretty forgiving.
            "70404",    # Please forgive me for not answering your letter.
        ],

        # === Deserve ===
        [
            "5858579",  # I deserve to win.
            "4665128",  # You certainly deserve a break.
            "4850165",  # You deserve a long rest.
            "3209908",  # You deserve a vacation.
        ],
        [
            "2313728",  # I deserve to be treated with respect.
            "2313726",  # I deserve an explanation.
            "3824180",  # I deserve happiness.
            "2044927",  # You deserve a chance for a happier life.
        ],
        [
            "1690605",  # You deserved it.
            "1690606",  # I deserved it.
            "2931071",  # Thanks for giving this issue the attention it deserves.
            "2198",     # Everyone deserves a second chance.
            "4850139",  # I think everybody deserves credit.
            "3818778",  # No one deserves my vote.
            "4850148",  # They deserve to be remembered.
            "3722398",  # Nobody deserves to die.
            "291230",   # He deserves the punishment.
        ],

        # === Valid points / arguing ===
        [
            "3821242",  # Is that a valid reason?
            "4665280",  # That's not a valid comparison.
            "388581",   # She argues just for the sake of arguing.
            "3060722",  # Let's suppose, for the sake of argument, that you're right.
        ],

        # === Conclusions ===
        [
            "2542118",  # You're jumping to conclusions.
            "2007284",  # Let's not jump to conclusions, okay?
            "2539318",  # We're sorry we jumped to conclusions.
            "4496834",  # Draw your own conclusions.
        ],
        [
            "2360219",  # I haven't reached any conclusions.
            "1528876",  # I don't agree with your conclusions.
            "38764",    # What led you to this conclusion?
            "3620420",  # How did you arrive at that conclusion?
            "4016594",  # It seems like the only possible conclusion.
            "2645196",  # What have you concluded?
            "307321",   # They concluded that he had told a lie.
        ],

        # === Hedging / doubt / sincerity ===
        [
            "2362013",  # It takes time to develop political awareness.
            "4498139",  # I sincerely doubt that.
            "4499409",  # I sincerely hope not.
        ],

        # === Curious / wonder ===
        [
            "3736139",  # I'm rather curious.
            "2543035",  # I'm beginning to get curious.
            "2360429",  # I have to admit I'm curious.
            {"text": "About what, exactly?", "added_for": "exactly", "reason": "natural follow-up — introduces 'exactly'"},
            "430169",   # I was curious to know why people had been staring at me.
        ],
        [
            "953317",   # He was curious about how it would taste, so he took a small bite.
            "2308265",  # I couldn't possibly eat another bite.
            "19723",    # Let's catch a quick bite.
        ],

        # === Schedule / appointment ===
        [
            "324713",   # I'll check my schedule.
            "2544245",  # I'll send you the schedule.
            "3264776",  # Do you have a copy of the new schedule?
            {"text": "I'll forward it to you.", "added_for": "forward", "reason": "natural answer"},
        ],
        [
            "3853879",  # I'd like to schedule an appointment.
            "5835906",  # Do I have to schedule an appointment to see you?
            {"text": "Yes, please call ahead.", "added_for": "ahead", "reason": "natural answer — introduces 'call ahead'"},
            "1444788",  # We have a tight schedule.
            "1837861",  # I have a tight schedule.
        ],
        [
            "307636",   # They finished the project on schedule.
            "326200",   # Trains are running on schedule.
            "273416",   # I believe the ship will arrive on schedule.
            "2953936",  # We're proceeding on schedule.
            "2951946",  # I believe we have a staff meeting scheduled for 2:30.
            "2953182",  # Let's schedule a meeting sometime early next week.
        ],
        [
            "1409659",  # She changed her schedule to match his.
            "3181954",  # Let's talk about tomorrow's schedule.
            {"text": "Sounds like a plan.", "added_for": "sounds", "reason": "high-frequency casual agreement idiom"},
        ],

        # === Delay / pressure ===
        [
            "4497160",  # Delays should be expected.
            "4497161",  # Be prepared for delays.
            "1886705",  # What's causing the delay?
            "274958",   # We must allow for some delay.
            "64009",    # I'm sorry for the delay in my reply.
            "1951466",  # I can't delay my decision any longer.
        ],
        [
            "4494250",  # The pressure is enormous.
            "4496368",  # The challenges are enormous.
            "4501855",  # There are enormous risks.
        ],

        # === Hire / professionals ===
        [
            "1820275",  # Are you hiring?
            {"text": "We might be, actually.", "added_for": "actually", "reason": "natural hedged answer"},
            "4499376",  # Thanks for hiring me.
            "5698254",  # I think we ought to hire more people.
            "1831485",  # The company decided to hire two new secretaries.
        ],
        [
            "2387647",  # I need to hire an accountant.
            "2376570",  # I know you hired an accountant.
            "1354463",  # I wanted to hire a coach.
            "4665815",  # Do you think they'd hire me?
            "4935557",  # I hired a guide.
            "680566",   # Can you confirm that he was hired?
        ],
        [
            "2628724",  # I'm a professional photographer.
            "2541141",  # You're a brilliant photographer.
            {"text": "Thanks, I appreciate that.", "added_for": "appreciate", "reason": "natural reply"},
            "2952534",  # I used to be a professional musician.
            "2291858",  # I always wanted to be a professional singer.
            "953871",   # I've always wanted to be a professional basketball player.
        ],
        [
            "2240799",  # We're both professionals.
            "5578779",  # We're all professionals.
            "2953892",  # We're all pros here.
            "2647127",  # Leave it to the pros.
            "4664637",  # I've never cooked professionally.
            "4663768",  # I've never played music professionally.
        ],
        [
            "4853351",  # It's a very demanding profession.
            "2218435",  # You're the pro.
            "2247895",  # I'm a pro.
        ],
        [
            "2093051",  # Nobody's going to hire you.
            {"text": "I'll prove you wrong.", "added_for": "prove", "reason": "natural defiant reply"},
        ],

        # === Money / owe / debts ===
        [
            "2389593",  # I owe somebody something.
            "2729548",  # I owe you a breakfast.
            "3826003",  # You owe me thirty bucks.
            {"text": "I'll pay you back tomorrow.", "added_for": "pay|back", "reason": "natural promise"},
            "70999",    # I owe my success to you.
        ],
        [
            "2953745",  # We owe three years worth of taxes.
            "6113657",  # We owe it to our customers to do that.
            "3822317",  # Someone owes me money.
            "3826642",  # No one owes me anything.
            "1279123",  # I forgot I owed you money.
            "2265741",  # Did you collect the money they owed you?
        ],
        [
            "3185816",  # Who pays your salary?
            {"text": "My company does.", "added_for": "company", "reason": "natural answer"},
            "4498135",  # I was happy when they doubled my salary.
            "953439",   # I don't think many people can say they are satisfied with their salary.
            "4077202",  # You don't deserve the salary they're paying you.
        ],
        [
            "4530032",  # I can't afford the fees.
            "4962870",  # Are there any hidden fees?
            "5239508",  # I know there are hidden fees.
            "456055",   # Is there a fee?
        ],
        [
            "2959465",  # Do you require a deposit?
            "275351",   # Do you have safety deposit boxes?
            "259677",   # I have a deposit of a thousand dollars here.
            "4501085",  # You need to start saving for retirement now.
            "2539415",  # I'm three weeks away from retirement.
        ],

        # === Discount ===
        [
            "21734",    # Let's get discount tickets.
            "239535",   # We give a 10% discount for cash.
            "5298774",  # I take advantage of discounts.
            {"text": "Unfortunately, no discount today.", "added_for": "unfortunately", "reason": "natural negative answer"},
            "5092316",  # There's no student discount.
            "4497684",  # Don't discount that possibility.
            "262238",   # I prefer quality to quantity.
        ],

        # === Suggest / recommend ===
        [
            "4664677",  # Any suggestions would be helpful.
            "66679",    # What medicine do you recommend?
            "3115738",  # Try pushing the other button.
        ],

        # === Borrow / lend ===
        [
            "60527",    # Please lend me this pen.
            "2079250",  # Can I borrow this pen?
            "264499",   # May I borrow your bike?
        ],

        # === Imply / suggest implicit ===
        [
            "25197",    # Are you implying something?
            "3050642",  # I wasn't implying anything.
            "5647120",  # What are you trying to imply?
            "2290415",  # I didn't mean to imply otherwise.
            "2954563",  # You implied that you were a doctor.
            "312920",   # She implied that she would like to come with us.
        ],

        # === Anger / understanding ===
        [
            "2644727",  # We understand your anger.
            "3826753",  # I understand your anger.
            "259649",   # I couldn't control my anger.
            "4665368",  # Your anger is understandable.
            "2243041",  # They angered me.
        ],

        # === Faint / desperate / urgent ===
        [
            "2245742",  # I feel faint.
            "5840401",  # I might faint.
        ],
        [
            "3166577",  # The situation is desperate.
            "1655494",  # I'm starting to feel desperate.
            "2667132",  # I desperately need a car.
            "3818283",  # I urgently need you.
            "4666239",  # I urgently need your help.
        ],
        [
            "3723422",  # The mood is tense.
            "4904920",  # Can you feel the tension?
            "4687269",  # You could feel the tension in the air.
            "5640487",  # I'm pretty short-tempered.
        ],

        # === Polite ===
        [
            "280433",   # Try to be as polite as you can when asking directions.
            "1981306",  # It's not polite to stare at others.
            "4491085",  # It's not polite to stare.
        ],

        # === Accusations ===
        [
            "307834",   # What's the accusation against him?
            "3826961",  # That's a very serious accusation.
            "4495460",  # Those are serious accusations.
            "1951609",  # I can't find any evidence to support your accusation.
            "4495461",  # The accusations were shocking.
            "4529321",  # Church leaders denied the accusation.
        ],
        [
            "298072",   # He accused me of being a liar.
            "281991",   # I was falsely accused.
            "5094280",  # Please don't accuse me of something I didn't do.
            "3101533",  # Are you accusing me of planting evidence?
            "5294671",  # Are you calling me a thief?
        ],

        # === Punish ===
        [
            "2258198",  # Don't punish the children.
            "2012722",  # They'll want to punish him.
            "2163124",  # Criminals should be punished.
            "2276434",  # Every crime must be punished.
        ],

        # === Shame / regret ===
        [
            "3573716",  # Oh, that's a shame.
            "2233732",  # This is shameful.
            "4870721",  # Your behavior was shameful.
            "25702",    # It's an awful shame your wife couldn't come.
            "3281720",  # It'd be a shame for this food to go to waste.
            "2006516",  # It's a shame we're not out fishing.
        ],

        # === Incredible / amazing ===
        [
            "2111458",  # That's brilliant.
            "42571",    # That's an incredible story.
            "5096617",  # This is an incredible result.
            "3722493",  # That meal was incredible.
            "6489607",  # The concert was incredible.
        ],
        [
            "6029177",  # It was an incredible sight.
            "2149113",  # It was one of the most incredible experiences of my life.
            "4498635",  # The figures are incredible.
            "2763575",  # That guy's incredible.
            "4908417",  # Don't miss this incredible opportunity.
        ],

        # === Sleep / awake / coffee ===
        [
            "62195",    # Coffee keeps me awake.
            "45593",    # The noise kept me awake all night.
            "4665140",  # What's been keeping you awake?
            "939950",   # For some reason, I'm wide awake and can't fall asleep.
            "3820771",  # I bet nobody's sleepy.
        ],

        # === Fan / favorite / album / song ===
        [
            "3315097",  # They're not big fans of mine.
            "3315186",  # I'm your biggest fan.
            "3727517",  # I'm a huge fan of yours.
            "3826829",  # They released a new album.
            "906887",   # What's your favorite song on this album?
        ],
        [
            "3727350",  # I have all your albums.
            "70494",    # Please show me your stamp album.
            "46879",    # You should stick those pictures in your album.
            "253039",   # I tore the picture out of the album.
        ],
        [
            "908752",   # Who's your favorite talk show host?
            "906877",   # What's your favorite ski area?
            "906700",   # What's your favorite bottled beer?
        ],

        # === Trap / suspicion ===
        [
            "3115533",  # It smells like a trap.
            "3390648",  # Be careful. It might be a trap.
        ],

        # === Folk / pop ===
        [
            "2258790",  # I like folk songs.
            "2544974",  # I used to like folk music.
            {"text": "I prefer pop music now.", "added_for": "pop", "reason": "natural answer"},
        ],

        # === Topic / discussion ===
        [
            "5358184",  # That's an interesting topic.
            "934939",   # Have you chosen a topic?
            "2944128",  # Let's change the topic.
            "42207",    # It's not a suitable topic for discussion.
        ],
        [
            "4755064",  # We discussed many topics.
            "326564",   # We talked about various topics.
            "263015",   # We discussed a wide range of topics.
            "326579",   # We talked about a variety of topics.
            "3168178",  # Sports is one of my favorite topics.
            "4497345",  # Neither group spent much time discussing the topic.
        ],

        # === Beauty / view / scenery ===
        [
            "388449",   # She has an eye for beauty.
            "305843",   # They admired the lovely scenery.
            "2007180",  # Japan is famous for its scenic beauty.
            "2264288",  # I was admiring the view.
            "318157",   # Beauty is but skin deep.
            "52438",    # Switzerland is famous for its scenic beauty.
        ],

        # === Music passion ===
        [
            "4499951",  # Music is my passion.
            "5639907",  # I'm following my passion.
            "460276",   # Music is the universal language.
        ],

        # === Admire ===
        [
            "68937",    # I admire you.
            "886845",   # She admired him.
            "260889",   # I couldn't help admiring him.
            "310939",   # She admires John for his courage.
            "262189",   # I admire a person who expresses a frank opinion.
        ],

        # === Religion ===
        [
            "5166602",  # I have no religion.
            "4502528",  # We never talked about religion.
        ],

        # === Description / explanation / incident ===
        [
            "4497213",  # I like that description.
            "4665808",  # Here is a brief description.
            "1318704",  # I'll explain the incident.
            "3735767",  # I'll explain afterwards.
        ],
        [
            "3823563",  # I reported the incident.
            "2360852",  # I hold you responsible for this incident.
            "41343",    # Such incidents are quite common.
        ],

        # === Morally / right and wrong ===
        [
            "2675025",  # This is morally wrong.
        ],

        # === Hoping / planning ===
        [
            "2486690",  # I was hoping I could go back to the beach next weekend.
        ],

        # === Accept / decline ===
        [
            "2571748",  # We don't accept tips.
            "3405451",  # Do you accept tips?
            "20660",    # We gladly accept your offer.
        ],
        [
            "2245986",  # I must decline.
            "311304",   # She declined the invitation.
            "306140",   # They declined our invitation.
            "1169214",  # I declined for personal reasons.
            "2313715",  # I declined the job that they offered me.
            "3721616",  # I should've declined.
        ],
        [
            "4663919",  # Home prices have continued to decline.
            "5637372",  # Our profits have declined over the past few years.
            "4013564",  # That's a tough offer to refuse.
        ],

        # === Imagine / pretend ===
        [
            "327254",   # I imagined my first kiss would be more romantic.
            "953541",   # I never for a moment imagined that I'd be homeless.
            "953554",   # I never imagined we'd be talking about this topic today.
            "238818",   # Can you imagine walking on the moon?
            "2218167",  # You're imagining it.
            "2240590",  # We're imagining things.
        ],
        [
            "3303610",  # Don't try to pretend you're innocent.
            "3131636",  # Let's pretend none of this ever happened.
        ],

        # === Tricks / magic ===
        [
            "2060037",  # I learned a new trick.
            "887430",   # She taught him the tricks of the trade.
            "2248862",  # It was magical.
            "4494376",  # It was a magical moment.
            "2248978",  # It'll be tricky.
            "4397546",  # This is tricky.
        ],
        [
            "1891172",  # I've been tricked.
            "2241663",  # We've been tricked.
            "3131051",  # This is where the magic happens.
            "2952802",  # I'm not impressed by your magic tricks.
        ],

        # === Shy ===
        [
            "2250726",  # That child is a bit shy.
            "315249",   # She is shy of strangers.
            "1355261",  # My kid is shy around strangers and always hides behind me.
        ],

        # === Dare ===
        [
            "2275368",  # Don't you dare answer that.
            "29968",    # How dare you laugh at me!
            "6454858",  # I dare you to cross this line.
            "5800848",  # How dare you call me a fool!
        ],

        # === Custom / tradition ===
        [
            "24199",    # It is our custom to take off our shoes when we enter the house.
            "22815",    # We have to respect local customs.
            "265341",   # Social customs vary from country to country.
            "55227",    # These old customs have been handed down from generation to generation.
            "20816",    # A customs declaration is required.
        ],
        [
            "2331751",  # I had this suit custom made for me.
            "1929642",  # That's an annoying habit.
            "65618",    # Telling lies is a very bad habit.
            "20827",    # Eating between meals is a bad habit.
            "278132",   # Old habits die hard.
            "25885",    # Smoking is a bad habit.
        ],

        # === Celebrate ===
        [
            "4496000",  # Let the celebrations begin.
            "4496363",  # Let the celebration start.
            "2007472",  # Let's join the celebration.
            "263218",   # We celebrated his birthday.
            "4664479",  # No special celebration is planned.
        ],

        # === Translate / language ===
        [
            "5852453",  # Here's the translation.
            "1151453",  # Is this translation correct?
            "322267",   # Let's compare the translation with the original.
            "490799",   # I'm a translator.
            "1389785",  # I need a translator.
        ],
        [
            "3209833",  # Translate this text.
            "4663150",  # Translate the following sentences into French.
            "1617",     # It took me more than two hours to translate a few pages of English.
            "6102194",  # I love translating.
            "6102196",  # I hate translating.
            {"text": "It's exhausting work.", "added_for": "exhausting", "reason": "natural answer"},
        ],
        [
            "2424281",  # French is definitely not the easiest language to learn.
            "519708",   # Do you like French literature?
            "253022",   # I am interested in American literature.
            "311472",   # She translated it word for word.
            "2451099",  # Could you teach me some French phrases that I might need?
            "2451115",  # None of my children are able to communicate in French.
            "3705760",  # None of us speaks French.
        ],

        # === Spelling / words ===
        [
            "4710334",  # How is that spelled?
            "879658",   # How is it spelled?
            "914376",   # What's the spelling of your family name?
            "2980164",  # Spelling mistakes really annoy me.
            "4500554",  # Please learn to spell your teachers' names.
            "5168331",  # I wish they would spell my name correctly.
        ],

        # === Symbol / sign / meaning ===
        [
            "3203809",  # Can you tell me what this symbol means?
            "59741",    # I don't know what this symbol stands for.
            "4014559",  # What do these symbols mean?
        ],

        # === Communicate / gesture ===
        [
            "23256",    # We use gestures as well as words to communicate with others.
            "2291880",  # I appreciate the gesture.
            "5666380",  # I just wanted to make a gesture.
        ],

        # === Adjust / mature ===
        [
            "23337",    # Our eyes take time to adjust to the darkness.
            "4529028",  # If you wait a while, your eyes will adjust to the dark.
            "269120",   # I found it pretty hard to adjust to my new surroundings.
            "4495488",  # It can be adjusted.
            "4529927",  # I guess I'm well adjusted.
            "2255449",  # You've obviously matured.
        ],

        # === Hide / cave ===
        [
            "3738097",  # Where did you hide my notebook?
            "2770612",  # We hid in the cave together.
        ],
        [
            "241504",   # I sat down and opened my notebook.
            {"text": "What were you writing?", "added_for": "writing", "reason": "natural follow-up Q"},
            {"text": "Just some notes.", "added_for": "notes", "reason": "natural answer"},
        ],
        [
            "2359177",  # I've been living in a cave.
            "3170716",  # It's pitch black inside the cave.
            "4016753",  # Maybe there's someone else in the cave.
            "3536229",  # This cave is full of bats.
            "3422211",  # They live in caves.
            "4905023",  # Three bodies were found in the cave.
        ],

        # === Bats / baseball bat ===
        [
            "67124",    # Is that a bat?
            "4017055",  # That's not my baseball bat.
            "2459479",  # I'm afraid of bats.
        ],

        # === Concert ===
        [
            "4016597",  # Did you stay till the end of the concert?
            {"text": "Yes, it was amazing.", "added_for": "amazing", "reason": "natural answer"},
        ],

        # === Ocean / sea ===
        [
            "6094443",  # I grew up near the ocean.
            "1792439",  # I can smell the ocean.
            "2954430",  # You can smell the ocean from here.
            "1126046",  # The ocean is dirty.
            "3073621",  # This river flows into the Pacific Ocean.
        ],

        # === Sailing / pool / swim ===
        [
            "502703",   # I don't like swimming in pools.
            "2241476",  # We went sailing.
            "2241507",  # We were sailing.
            "4500182",  # I like to sail.
            "2985729",  # Can you sail a boat?
        ],

        # === Camp / camping ===
        [
            "1553335",  # We met at summer camp.
            "4600579",  # The food at this camp is terrible.
            "2007857",  # Let's go camping.
            "2245961",  # I love camping.
        ],

        # === Alive / glad / rescue ===
        [
            "3733625",  # I'm glad I'm alive.
            "4529765",  # It's amazing I'm still alive.
            "2293493",  # I barely got out of there alive.
            "3168123",  # This one's still alive.
            "4500293",  # No one's injured.
        ],
        [
            "2570960",  # No one escaped alive.
            "2484614",  # We won't get off this island alive.
            "3185484",  # Let's hope we can stay alive until the rescue team finds us.
            "3732999",  # Thanks for rescuing me.
            "2953897",  # We're attempting a rescue operation.
            "29516",    # The rescue party searched for the missing passengers.
            "1779792",  # I rescued the cat.
            "2092519",  # I didn't rescue anybody.
        ],

        # === Reservation / book ===
        [
            "2546063",  # I'll make a reservation.
            "72791",    # I have a reservation for two nights.
            "4501778",  # Reservations are suggested.
            "4501780",  # Reservations are essential.
            "23206",    # We confirmed the hotel reservations by telephone.
            "246261",   # Are there reserved seats?
            "257865",   # I reserved my hotel room three weeks in advance.
        ],

        # === Transport / cab / taxi ===
        [
            "40961",    # Shall we take a taxi?
            "1640802",  # I called a cab, because it was raining.
            "2280251",  # A cab is waiting.
            "3825952",  # Let's share a cab.
            "1450707",  # Since there were no taxis, I had to walk.
            "2057176",  # The taxi arrived late.
        ],
        [
            "4498180",  # The taxi driver refused to take us to that part of town.
            "4071197",  # Taxis are expensive.
            "388676",   # She went to the museum by taxi.
        ],

        # === Weather / rain / sunny ===
        [
            "2394",     # It was raining when we left, but by the time we arrived, it was sunny.
            "271553",   # It was sunny and warm.
            "275160",   # The sun was shining brightly.
            "372414",   # The sun is shining.
            "3170676",  # The light is green.
        ],

        # === Generous ===
        [
            "2202902",  # You're generous.
        ],

        # === Patient / urge ===
        [
            "5464268",  # We urge you to be patient.
            "3730012",  # I'll wait patiently.
            "3821568",  # We'll wait patiently.
            "5652379",  # I urge everyone to do the same.
            "887482",   # She urged him to drive carefully.
            "887483",   # She urged him to study harder.
            "887481",   # She urged him to consider the request.
        ],

        # === Inspect ===
        [
            "3728436",  # Let me inspect it.
            "566100",   # I've been given permission to inspect this equipment.
        ],

        # === Breathe ===
        [
            "4664529",  # Try breathing through your mouth.
            "5607349",  # Are you having any difficulty breathing through your nose?
        ],

        # === Push button (broken up from 10-item drill, includes rewrite) ===
        [
            "4496213",  # Press the button.
            "4496212",  # Click the OK button.
            "2402191",  # Whatever you do, don't push that button.
            "2770016",  # If you push the button, the engine will stop.
        ],
        [
            "1424468",  # Push the green button and the light will go on.
            "5916219",  # I pushed the wrong button.
            "3115808",  # What would happen if I pushed this button?
        ],
        [
            "292741",   # He pressed the button and waited.
            "255591",   # I pressed the button to turn the radio on.
            "4496210",  # There are three buttons.
            {"text": "Just hit the green one.", "added_for": "hit|green", "reason": "rewrite — adds 'hit' as casual variant of press/push"},
        ],

        # === Wire / electrical ===
        [
            "3818511",  # Cut the red wire.
            "4850070",  # Don't cut that wire.
            "67896",    # If you touch that wire, you'll get a shock.
            "45273",    # The man connected two wires.
        ],

        # === Alarm / fire / smoke ===
        [
            "3417524",  # There's no cause for alarm.
            "1950647",  # I can't afford an alarm system.
            "455287",   # The smoke alarm has never been maintained.
            "23848",    # The fire alarm sounded.
            "662772",   # The alarm sounded.
        ],
        [
            "2358838",  # I have a travel alarm clock.
            "2334079",  # I hate alarm clocks.
            "2264186",  # Do you sell alarm clocks?
            "2281752",  # We didn't hear any alarms.
            "1841190",  # Don't be alarmed.
            "2248119",  # I'm not alarmed.
            "3733820",  # It's very alarming.
            "3723951",  # That's what I find alarming.
        ],
        [
            "4496226",  # I want to buy a really good smoke detector.
            "4502835",  # Are you worried about global warming?
            "4135017",  # What do you think about global warming?
            {"text": "I'm very concerned about it.", "added_for": "concerned", "reason": "natural opinion"},
        ],

        # === Fire / vehicles ===
        [
            "4496333",  # Both vehicles caught fire.
            {"text": "Thankfully, no one was hurt.", "added_for": "thankfully", "reason": "natural reassurance"},
            "4753818",  # The house burned to the ground before the fire truck arrived.
        ],

        # === Repair ===
        [
            "4537997",  # Perhaps it can be repaired.
            "2046838",  # I've been busy repairing things.
            "2046839",  # They're busy repairing that now.
            "2721610",  # I know how to repair computers.
            "5821689",  # How confident are you that they'll get these repairs completed by Monday?
            "60286",    # What would it cost to have this chair repaired?
            "298575",   # He repaired his watch by himself.
            "23569",    # My house needs major repairs.
            "2953709",  # We must repair the damage.
        ],

        # === Functional / mechanical ===
        [
            "2407725",  # I think everything is functional.
            "2663181",  # No mechanical problems were found.
            "2663309",  # It's just a mechanical problem.
        ],

        # === Invent / discovery ===
        [
            "2376391",  # I know what you should call your new invention.
            "1411867",  # Who invented the piano?
            "59781",    # Who invented this machine?
            "2254854",  # Who invented glasses?
        ],

        # === Knife / fry pan / kitchen ===
        [
            "1487659",  # The knife is dull.
            "2627966",  # This knife is dull.
            "4679193",  # I need a bigger frying pan.
            "3315054",  # Do you have a bigger frying pan?
            {"text": "Yes, I'll grab it.", "added_for": "grab", "reason": "natural helpful answer"},
        ],

        # === Fry / fries ===
        [
            "2766914",  # Fry me an egg.
            "2766916",  # Fry me some eggs.
            "2389580",  # I ordered fries, too.
            "681906",   # I requested extra salt on my french fries.
            "3067000",  # I didn't eat all the fries because they were too oily.
        ],

        # === Restaurant / folks / waiter ===
        [
            "4781200",  # It was a pleasure working with you folks.
            "4902746",  # Get these folks some drinks.
            "2210625",  # Why don't you folks make yourselves comfortable?
            "4499799",  # I'm a sailor, you know.
            "2248329",  # I'm your waiter.
            "5839980",  # I'm a waiter.
        ],
        [
            "2715434",  # Thanks for the tip.
            "1526043",  # How much should I tip?
            "3733311",  # Tipping isn't usually done here.
            "3730682",  # What tipped you off?
        ],

        # === Diet ===
        [
            "1816735",  # I'm on a diet right now.
            "2543199",  # I try to eat a balanced diet.
            "268754",   # It's important to follow a strict diet.
            "680105",   # I bought new clothes after my diet.
            "4904147",  # Wow! You've lost weight. Are you on a diet?
            "1830536",  # Most of us don't eat a balanced diet.
            "2673850",  # My mother is on a banana diet.
        ],

        # === Apples / dozen / bananas ===
        [
            "3826562",  # I bought a dozen apples.
            "29621",    # Apples are sold by the dozen.
            "1113266",  # We have a half-dozen eggs.
            "2358697",  # I have a dozen reports to read.
            "2258226",  # Give me a dozen oranges.
        ],
        [
            "4062887",  # I love fried bananas.
            "2027940",  # I want to buy a dozen bananas.
            "1409166",  # It's cheaper to order things by the dozen.
            "1409167",  # It's cheaper if you order these by the dozen.
        ],

        # === Salt ===
        [
            "953245",   # Don't add too much salt.
            "2249757",  # Pass the salt.
            "995263",   # Is it too salty?
            "3737577",  # This soup is too salty.
            "320649",   # My mother tasted the soup and added a little more salt.
        ],

        # === Steak / meat ===
        [
            "51909",    # I like my steak medium.
            "2771507",  # I like my steak medium rare.
            {"text": "I prefer mine well done.", "added_for": "prefer|done", "reason": "natural contrast"},
        ],

        # === Coffee / tea / pour ===
        [
            "2816622",  # I poured myself a cup of coffee.
            "252024",   # None of my friends drink coffee.
            "23557",    # We import coffee from Brazil.
            "29179",    # We import tea from India.
            "3334025",  # Pour me a drink.
            "2867344",  # It's pouring down rain.
            "2247862",  # She poured tea for me.
            "61446",    # Don't pour hot water into the glass or it will crack.
            "3170750",  # Black smoke was pouring out the windows.
        ],

        # === Spoon / fork ===
        [
            "3447154",  # I'd like to buy a wooden spoon.
            "2730948",  # The spoon is dirty.
            "5177480",  # It's impossible to eat soup with a fork.
            "3295865",  # There were no forks.
            "2315164",  # One fork is missing.
        ],

        # === Guard / prisoner ===
        [
            "3061073",  # I'll stand guard now. Go get some sleep.
            "1787896",  # Where are the guards?
            "5358564",  # The guards are watching you.
            "4499091",  # Guard duty is boring.
            "2546070",  # I'll guard the prisoner.
        ],

        # === Step aside ===
        [
            "1935050",  # Stand aside.
            "40051",    # Step aside.
        ],

        # === Bell / ring ===
        [
            "2249851",  # Ring the bell.
            "49933",    # The bell rings at eight.
            "33885",    # The bell is ringing.
            "4501849",  # The bells were ringing.
            "2259771",  # We heard the church bells.
            "1097561",  # When the bell rang, the teacher ended the class.
            "1669988",  # We were saved by the bell.
            "2944340",  # Nobody is allowed to leave the classroom until the bell rings.
        ],

        # === Scream / shout ===
        [
            "2111774",  # I'll scream.
            "5684652",  # Scream as loud as you can.
            "276540",   # Everybody shouted for joy.
        ],

        # === Joy / cheerful ===
        [
            "5916726",  # You're a joy to teach.
            "20688",    # His joy showed on his face.
            "4496543",  # They were cheerful.
            "304070",   # He is a cheerful boy.
        ],

        # === Lucky / unlucky ===
        [
            "2648070",  # Luckily, it worked.
            "4499811",  # I was incredibly lucky.
            "4499729",  # I was incredibly unlucky.
            "4902759",  # Luckily, both of the drivers were wearing seat belts.
            "3327625",  # Luckily nobody got shot.
        ],

        # === Tons / weighs ===
        [
            "5298728",  # We have tons of money.
            "5331430",  # I know tons of jokes.
            "2359622",  # I've got a ton of work to do.
            "3819202",  # This box weighs a ton.
        ],

        # === Treasure ===
        [
            "4495412",  # What a treasure!
            "4665036",  # The treasure could be anywhere.
        ],

        # === Convenient / convenience ===
        [
            "4502212",  # That sounds awfully convenient.
            "3728553",  # That's real convenient.
            "16965",    # You can come and see me whenever it's convenient for you.
            "3363746",  # I'm going to the convenience store.
            "4501353",  # You pay for convenience.
        ],

        # === Confusing / explain ===
        [
            "4665070",  # It's definitely very confusing.
            {"text": "Let me explain.", "added_for": "explain", "reason": "natural offer to help"},
        ],

        # === Additional details ===
        [
            "4529229",  # No additional information was available.
            "4529089",  # Additional details weren't immediately available.
            "4529126",  # Visit our website for additional information.
        ],

        # === Predictions / expecting ===
        [
            "4831737",  # Many predictions were made, but none of those predictions came true.
            "5657439",  # I was expecting a tougher game.
        ],

        # === Heaven / proverbs (kept many under loosened policy) ===
        [
            "38602",    # How can I get to heaven?
            "18570",    # Health is better than wealth.
            "30131",    # Slow and steady wins the race.
            "318965",   # My father always said that heaven helps those who help themselves.
            "619725",   # A chain is no stronger than its weakest link.
            "280347",   # Never confuse pity with love.
            "1040741",  # Never bite the hand that feeds you.
            "4546397",  # It's hard to steal from a thief.
        ],

        # === Reward / rewarding ===
        [
            "2549520",  # I'll reward you.
            "2547458",  # You will be rewarded.
            "5000865",  # It's very rewarding.
            "4530696",  # It was a very rewarding experience.
            "2218105",  # You're being rewarded.
            "320973",   # Let's split the reward fifty-fifty.
        ],

        # === Liquid / water / cold ===
        [
            "270793",   # Water is a liquid.
            "681372",   # When you have a cold, you should drink plenty of liquids.
        ],

        # === Fold / wrap ===
        [
            "47336",    # Fold the paper in the middle.
            "326455",   # The old man was sitting with his arms folded.
            "2326539",  # I folded the towels.
            "2492864",  # Have you counted the towels?
            "3347181",  # Mary wrapped herself in a towel.
            "452274",   # Don't put the wet towel in the bag.
            "274349",   # Would you mind wrapping it up as a gift?
            "2012900",  # Do you want it gift wrapped?
            "34095",    # Could you gift wrap it?
            "34093",    # Can you gift-wrap this, please?
        ],

        # === Blanket / candle ===
        [
            "3622973",  # I want a blanket.
            "4016928",  # What's under the blanket?
            "5791082",  # Get some blankets.
            "323544",   # Do you have blankets?
            {"text": "Yes, in the closet.", "added_for": "closet", "reason": "natural answer"},
        ],
        [
            "2245583",  # Hold the candle.
            "2259050",  # Light the candle.
            "2886570",  # Blow out the candles.
            "255933",   # I blew the candle out.
        ],

        # === Decorate ===
        [
            "4574686",  # Mary decorated the cake.
            "3825412",  # Have you already started to decorate?
            "2645624",  # Who did the decorating?
            "3730744",  # Who does your decorating?
        ],

        # === Dressed ===
        [
            "68628",    # Who is the woman dressed in pink?
            "310876",   # She is neatly dressed.
            "310388",   # She is always neatly dressed.
        ],

        # === Hair / beard / blonde ===
        [
            "452278",   # He has blond hair.
            "3377176",  # Are you a natural blonde?
            "3820806",  # The police found a blonde hair in the sink.
            "250387",   # My beard grows quickly.
            "2544755",  # I'm growing a beard again.
        ],

        # === Cycle / bike ===
        [
            "1211488",  # I cycle to work.
            "5822629",  # I like riding my bike.
            "4799212",  # I really like riding my bike to school.
            "1039509",  # We all like to ride bikes.
            "32105",    # We all like cycling.
        ],
        [
            "253852",   # I'd like to go cycling.
            "1123575",  # I prefer biking.
            "4368493",  # When was the last time you rode a bike?
            "4663002",  # I think it'd be fun to cycle around Australia.
            "1034905",  # I don't know how much those two bikes cost.
        ],

        # === Speak softly ===
        [
            "2800093",  # Speak softly.
            "2243324",  # They spoke softly.
            "483780",   # Would you mind speaking a little softer please?
        ],

        # === Injured / medical ===
        [
            "2954949",  # You're injured and need medical attention.
            "324332",   # My friend is seriously injured.
            "1961765",  # I thought you were injured.
            "68172",    # I hope neither of them was injured in the crash.
            "3272401",  # The boys were injured.
            "4497293",  # Both men died instantly.
        ],

        # === Medicine ===
        [
            "267665",   # The brain needs a continuous supply of blood.
            "3636050",  # This medicine will reduce the pain.
            "43556",    # The medicine had an immediate effect.
            "56623",    # This medicine has no side effects.
            "5436764",  # That medicine helped a lot.
        ],
        [
            "3238919",  # They claim this medicine is safe.
            "886925",   # She advised him to take the medicine.
            "886917",   # She advised him to stop taking that medicine.
            "2406808",  # I strongly advise you to take this medicine right away.
            "2256963",  # Good medicine tastes bitter.
            "56604",    # This medicine tastes bitter.
            "3636051",  # This medicine will ease the pain.
            "255840",   # I was forced to take medicine.
        ],

        # === Injuries / accidents ===
        [
            "4500286",  # Injuries are frequent.
            "4500274",  # All three suffered injuries.
            "4495865",  # Both of the passengers in the back seat had neck injuries.
            "304813",   # He was injured in a railway accident.
            "5296948",  # Three workers were injured.
            "4493874",  # Three passengers were hospitalized.
            "4493839",  # Thirteen passengers were hospitalized.
        ],

        # === Sharp / turn / truck danger ===
        [
            "5136188",  # The truck made a sharp right turn.
            "47514",    # That kid was almost run over when the truck backed up.
            "2840154",  # The truck nearly ran me over.
            "31304",    # I barely escaped being hit by the truck.
            "3010936",  # A lot of truck drivers eat here.
        ],

        # === Messy / process ===
        [
            "4498907",  # Things got messy.
            "5079343",  # The process will be messy.
        ],

        # === Strict / behave ===
        [
            "4269258",  # My dad is very strict.
            "251837",   # My mother is strict about manners.
            "4300660",  # My mom was very strict, too.
            "297156",   # He was severe with his children.
        ],
        [
            "64491",    # Behave yourself.
            "5268541",  # Behave yourselves.
            "2325785",  # I expect you to behave like an adult.
            "296355",   # He behaved badly.
            "5850882",  # I behaved badly.
            "2218091",  # You're behaving oddly.
        ],

        # === Truth / twist ===
        [
            "388366",   # She successfully got him to tell the truth.
            "4497862",  # They did it successfully.
            "2955073",  # You're twisting my words.
            "2955074",  # You're twisting the truth.
            "2251239",  # That's really twisted.
        ],

        # === Laugh / burst ===
        [
            "2260497",  # I burst out laughing.
            "295225",   # He burst into laughter.
            "32173",    # Everyone burst into laughter.
            "295219",   # He burst into tears.
        ],

        # === Tap / shoulder ===
        [
            "276154",   # Someone tapped me on the shoulder.
            "40478",    # Someone is tapping at the door.
            "1951420",  # I can't concentrate if you keep tapping me on the shoulder.
            "1165794",  # The main tap is turned off.
            "2952873",  # I'm teaching myself to tap dance.
        ],

        # === Quick / quicker / shorter ===
        [
            "40932",    # It'll be quicker to walk than to take a taxi.
            "3312831",  # We took the quickest route.
            "2375836",  # I know a shorter route.
        ],

        # === Route / map ===
        [
            "326322",   # Can I change the route?
            "35333",    # May I have a bus route map?
        ],

        # === Guarantee / similarity / urgency ===
        [
            "2539223",  # I'll personally guarantee your safety.
            "2245805",  # I guarantee it.
            "283829",   # He guaranteed my debt.
            "2252664",  # There's no urgency.
            "2234131",  # What's the urgency?
            "2252612",  # There are similarities.
            "6104188",  # Instead of focusing on our differences, let's focus on our similarities.
        ],

        # === Chain reaction ===
        [
            "1737381",  # It started a chain reaction.
        ],

        # === Trial / guilt / innocence ===
        [
            "4665035",  # The trial will continue Monday.
            "4495005",  # The trial was fair.
            "260157",   # I was convinced that he was guilty.
            "283570",   # I am convinced that he is innocent.
            "298562",   # He admitted that he was guilty.
            "284209",   # No one believes that he is innocent.
            "304437",   # He was declared guilty.
        ],

        # === Genuine ===
        [
            "3171870",  # It's genuine.
            "2248458",  # Is it genuine?
        ],

        # === Shelves / books ===
        [
            "4500950",  # Who made these pots?
            "4498259",  # Our shelves were empty.
            "2712886",  # There's a dictionary on the shelf.
            "3155607",  # Put those books back on the shelf.
            "376350",   # He placed the book on the shelf.
            "254149",   # I like the red ones on the shelf.
        ],

        # === Dolls / kids ===
        [
            "42293",    # That's a doll.
            "2396280",  # Mary loves playing with dolls.
            "5850918",  # Mary still plays with dolls.
            "911171",   # My daughter likes to play with dolls.
            "911801",   # She spends her free time making dolls.
        ],

        # === Swings / park ===
        [
            "4289395",  # I didn't see any children playing on the swings.
            "5275111",  # My children like to play on the swings in the park near my house.
        ],

        # === Bites / bitten ===
        [
            "5858496",  # I've been bitten.
            "2362202",  # I just got bitten.
            "242831",   # The fish aren't biting today.
        ],

        # === Cousin / extended family ===
        [
            "297739",   # He married my cousin.
            "297740",   # He got engaged to my cousin.
            "65946",    # My cousin is having a baby next month.
            "541060",   # My cousin is a little older than I am.
            "286676",   # His cousin, whose name I forget, was a nurse.
        ],
        [
            "2107337",  # We're cousins.
            "2111317",  # They're cousins.
            "2280386",  # Mary is my niece.
            "2361186",  # I don't have a niece.
            "5858441",  # I have three uncles.
        ],

        # === Uncle (kept core ~6, broken up + rewrite) ===
        [
            "1388690",  # My uncle is rich.
            "65072",    # My uncle runs a hotel.
            "250248",   # My uncle works in this office.
            "250251",   # My uncle has a good knowledge of French.
        ],
        [
            "65070",    # My uncle has a flower shop near the station.
            "253225",   # I spoke to my uncle on the telephone.
            "3024316",  # I intend to stay in Boston with my uncle.
            {"text": "I haven't seen him in years.", "added_for": "seen|years", "reason": "rewrite — varies away from 'My uncle...' opener"},
            "1192343",  # He sent a letter addressed to his uncle.
        ],
        [
            "61641",    # This is the TV station where my uncle works as an announcer.
            "250262",   # My uncle teaches English in a college.
            "3378610",  # My uncle collects Chinese fans.
            "2674227",  # He intends to visit his uncle.
            "2674226",  # He's considering visiting his uncle.
            "1409039",  # My father visited my uncle in the hospital.
            "1426578",  # My uncle went to Mexico in 1983 and never came back.
            "251182",   # My uncle was involved in the traffic accident.
            "2358976",  # I have an aunt and uncle in Boston.
        ],

        # === Brother / family ===
        [
            "278532",   # My brother has a gift for painting.
            {"text": "He's very talented.", "added_for": "talented", "reason": "natural compliment"},
            "48588",    # Both brothers are still alive.
        ],

        # === Photo session / smartphone ===
        [
            "3568462",  # How did the photo session go?
            "5834839",  # How often do you use the camera on your smartphone?
            "483621",   # You need to attach your photo to the application form.
        ],

        # === Wife on phone / urgent ===
        [
            "3439865",  # Your wife's on the phone. She says it's urgent.
            "19614",    # Please hurry, it's urgent.
            "4012199",  # My secretary said it was urgent.
            "4495479",  # Urgent action is needed.
        ],

        # === Steady drive ===
        [
            "5464871",  # Drive at a steady speed.
            "60870",    # This table isn't steady.
        ],

        # === Equipment / install ===
        [
            "954556",   # What kind of equipment is installed in the classrooms?
            "4500306",  # Is it easy to install?
            "4500305",  # This should be easy to install.
            "953735",   # I wish I could figure out how to install this software.
            "40263",    # Team members are provided with equipment and uniforms.
        ],
        [
            "2334134",  # I hate this uniform.
            "1886588",  # Where's your uniform?
            "4870316",  # Who designed these uniforms?
        ],

        # === Replacement ===
        [
            "3312075",  # We'll get you a replacement.
            "3831395",  # Your replacement has already been picked.
        ],

        # === Tense / sentence ===
        [
            "2242959",  # This sentence is in the present tense.
        ],

        # === Affordable ===
        [
            "5534529",  # We want to make it affordable.
        ],

        # === Realistic / expectations ===
        [
            "4817053",  # People should have realistic expectations.
            "5301592",  # I think it's a realistic fear.
        ],

        # === Accidents on highways ===
        [
            "5839826",  # How can we reduce the number of highway accidents?
        ],

        # === Bitter / winters ===
        [
            "4502012",  # You both seem bitter.
            "2953963",  # We've had some bitter winters.
        ],

        # === Detectives / crime fiction (loosened — police narratives are fine) ===
        [
            "237820",   # The detective promised to look into the matter right away.
            "280887",   # Two detectives followed the suspect.
            "276884",   # The man aimed a gun at the detectives.
            "237824",   # The detective found absolute proof of the man's guilt.
            "4663461",  # The police detective found a bloody knife.
            "3732775",  # The police detective said that all of the doors and windows were locked from the inside.
        ],
        [
            "238215",   # The police arrested a suspect in connection with the robbery.
            "238265",   # The police are looking for the robber.
            "3732842",  # The bank robbers are still at large.
            "4746859",  # It appears that the bank robbery was planned right down to the last detail.
            "319109",   # My father struggled with the robber.
        ],

        # === Pity ===
        [
            "24885",    # What a pity!
            {"text": "Yeah, that's too bad.", "added_for": "yeah", "reason": "natural sympathetic reply"},
        ],

        # === Astonishing ===
        [
            "2233655",  # This is astonishing.
        ],

        # === Casual ===
        [
            "5938388",  # I tried to be casual.
            "256423",   # I took a casual look at the magazine.
        ],

        # === Romantic / kiss ===
        [
            "4693250",  # That wasn't exactly romantic.
            "3635808",  # This place is sort of romantic.
            "2243206",  # They kissed passionately.
            "4016530",  # My parents met on a blind date.
            "2361177",  # I don't go on blind dates.
        ],

        # === Quarter / hurry ===
        [
            "1519198",  # It's a quarter till two.
        ],

        # === Wing it ===
        [
            "2547827",  # I'll have to wing it.
            {"text": "Good luck with that.", "added_for": "luck", "reason": "natural sympathetic reply"},
        ],

        # === Thieves / robbery (light) ===
        [
            "291179",   # He chased the thief.
            "2241005",  # We're thieves.
            "3819934",  # They're all thieves.
            "2255410",  # You've been robbed.
            "2821489",  # We're planning a robbery.
            "297257",   # He robbed me of every cent I had.
            "2616221",  # Someone broke the lock and stole my bike.
        ],
        [
            "5835854",  # I know who stole your truck.
            "260081",   # I caught him stealing the camera.
            "250122",   # My bike was stolen yesterday.
            "1361942",  # They tied the thief to the tree.
        ],

        # === Trapped ===
        [
            "2107365",  # We're trapped.
            "2111233",  # They're trapped.
            {"text": "Stay calm.", "added_for": "calm", "reason": "natural reassurance"},
        ],

        # === Champions ===
        [
            "248195",   # We are the champions.
            "2548018",  # We're the champions.
            "5640582",  # I'm the world champion now.
            "291868",   # He is a tennis champion.
        ],

        # === Fans cheered ===
        [
            "4496544",  # The fans cheered.
        ],

        # === Sunlight / plants ===
        [
            "4921458",  # Plants need sunlight to grow.
            "944543",   # This room doesn't get much sunlight.
        ],

        # === Dust / blow ===
        [
            "319687",   # Dust was blowing in the wind.
            "1493095",  # Everything here is covered in dust.
            "312172",   # She brushed away the dust.
            "2249249",  # It's so dusty.
            "4015437",  # It's very dusty in here.
        ],

        # === Solid / proof ===
        [
            "3635997",  # It's solid as a rock.
            "3723730",  # I need solid proof.
        ],

        # === Could've / would've ===
        [
            "5859431",  # I could've been injured.
            {"text": "Thank goodness you weren't.", "added_for": "goodness", "reason": "natural relief reply"},
            "5163847",  # I could've gone to the seaside, but I went to the mountains instead.
        ],

        # === Neat / tidy ===
        [
            "3575411",  # Hey, that's really neat.
            "264784",   # Keep your room neat and tidy.
            "315338",   # She is always neat and tidy.
        ],

        # === Fool / trick ===
        [
            "41338",    # You can't fool me with a trick like that.
        ],

        # === Embarrassing ===
        [
            "4498242",  # It was definitely embarrassing.
            {"text": "I'd be embarrassed too.", "added_for": "embarrassed", "reason": "natural empathy"},
        ],

        # === Tempt / temptation ===
        [
            "2228228",  # He couldn't resist the temptation.
            "324511",   # It's hard to resist temptation.
            "887433",   # She tempted him.
            "2542604",  # I was tempted to call in sick.
            "4502569",  # It was tempting.
            "4999971",  # It's very tempting.
        ],

        # === Stronger / mental ===
        [
            "3777881",  # I want to become both physically and mentally stronger.
            "6481242",  # I'm not mentally prepared for that.
        ],

        # === Flag / wave ===
        [
            "5852346",  # I waved the flag.
            "1893543",  # Please lower the flag.
            "37521",    # Every country has its national flag.
            "5916029",  # Why were you waving a flag?
            "3170729",  # I see someone waving a white flag.
        ],

        # === Biscuits / bowl / kitchen ===
        [
            "4498765",  # Biscuits can be frozen.
            "4482901",  # The kitchen table was bare except for a bowl of fruit.
        ],

        # === Puzzle ===
        [
            "60672",    # This puzzle has 500 pieces.
            "887104",   # She explained to him how to solve the puzzle.
            "2241153",  # We love puzzles.
            "2245938",  # I like puzzles.
        ],

        # === Wings / hospitals ===
        [
            "1476885",  # Birds have wings.
            "5826463",  # The hospital has three wings.
        ],

        # === Entertain / enjoyable ===
        [
            "3733838",  # It's very entertaining.
            "3729106",  # Let me entertain you.
            "4902824",  # It was definitely very enjoyable.
            "1316482",  # He thanked the host for the very enjoyable party.
            "4664807",  # That would've been entertaining.
        ],

        # === Harmless / no harm ===
        [
            "2249157",  # It's perfectly harmless.
            "2111281",  # They're harmless.
            "2274038",  # You won't be harmed.
            "28586",    # I meant no harm.
            "325304",   # The storm did a lot of harm to the crops.
        ],

        # === TV show canceled ===
        [
            "2641532",  # My favorite TV show's been canceled.
            {"text": "Oh no, that's disappointing.", "added_for": "disappointing", "reason": "natural reaction"},
            "3737994",  # How can I cancel my wedding?
        ],

        # === Arrested / dozens missing / sentencing ===
        [
            "4495723",  # Dozens were arrested last night.
            "4501036",  # Dozens are still missing.
            "295667",   # He was sentenced to death.
            "807375",   # Three were sentenced to life in prison.
        ],

        # === Trend / fashion ===
        [
            "4495240",  # That's the trend.
            "2545921",  # I'm seeing a trend here.
            "4496898",  # Will those trends continue?
            "4237800",  # Mary knows everything about the latest fashion trends.
        ],

        # === Valley / kilometers ===
        [
            "682303",   # The valley was twenty miles wide.
            "4565764",  # From here, it's about three kilometers to the coast.
            "4565765",  # It's about three kilometers from here to the coast.
        ],

        # === Occupied ===
        [
            "2546536",  # I'm occupied right now.
            "3821850",  # They're already occupied.
        ],

        # === Swing / suddenly ===
        [
            "4501286",  # The door suddenly swung open.
            "3596836",  # The party is in full swing.
        ],

        # === Fancy meeting / coincidence ===
        [
            "1898381",  # Fancy seeing you here.
            "54768",    # Fancy meeting you here.
            {"text": "What a coincidence!", "added_for": "coincidence", "reason": "natural exclamation"},
        ],

        # === Let's split ===
        [
            "2007735",  # Let's split a salad.
            "1894529",  # Let's split up into teams.
            "2007456",  # Let's split up into groups.
            "1894530",  # Let's split the bill four ways.
            "3045735",  # Let's split the profits.
            "50589",    # The money will probably be split evenly between those two.
            "2218404",  # You're splitting hairs.
            "5087397",  # Let's not split hairs.
            "5474999",  # Let's split a bottle of wine.
        ],

        # === Passengers / life jackets ===
        [
            "5137544",  # Most of the passengers weren't wearing life jackets.
            {"text": "That's incredibly risky.", "added_for": "risky", "reason": "natural concerned reaction"},
            "2549146",  # I was a passenger.
            "4501714",  # The passengers remained calm.
            "268412",   # Are all passengers on board?
            "4663892",  # Most of the passengers were Canadians.
            "4500277",  # No Canadians were injured.
            "44365",    # There were fifty passengers on the plane.
        ],

        # === Declare / customs / war ===
        [
            "23665",    # Do you have anything to declare?
            "436683",   # I have nothing to declare.
            {"text": "Go ahead through.", "added_for": "ahead|through", "reason": "natural customs reply"},
            "2241066",  # We declared war.
        ],

        # === Helpless / vulnerable ===
        [
            "2107348",  # We're helpless.
            "2006374",  # I feel helpless.
            {"text": "Don't say that.", "added_for": "say|don't", "reason": "natural support"},
            "2203210",  # We're powerless.
            "2203209",  # I'm powerless.
        ],

        # === Miserable / better ===
        [
            "2111710",  # I'm miserable.
            "2241498",  # We were miserable.
            {"text": "Things will get better.", "added_for": "better|things", "reason": "natural encouragement"},
        ],

        # === Reformed / forgiven ===
        [
            "2111696",  # I'm reformed.
            {"text": "I'll have to take your word for it.", "added_for": "word|take", "reason": "natural skeptical reply"},
            "2202877",  # You're forgiven.
        ],

        # === Bored ===
        [
            "2752910",  # I was incredibly bored.
            {"text": "I'm sorry to hear that.", "added_for": "hear|sorry", "reason": "natural sympathy"},
        ],

        # === Optional ===
        [
            "5313538",  # It's optional.
            "2248744",  # It isn't optional.
        ],

        # === Hot / hotter ===
        [
            "4015263",  # It's definitely getting hotter.
            {"text": "I know, it's unbearable.", "added_for": "know|unbearable", "reason": "natural agreement"},
        ],

        # === Stronger language / true gentleman ===
        [
            "2713449",  # You're a true gentleman.
            "269707",   # A gentleman wouldn't do such a thing.
            "1109178",  # I'd like to introduce to you the gentleman I told you about the other day.
        ],

        # === Holiday / countries (loosened — these were over-removed before) ===
        [
            "2486672",  # We spent our holiday on a beach in Hawaii.
            "55888",    # This is a car imported from Germany.
            "29422",    # Rome has a lot of ancient buildings.
            "1430132",  # The French president is scheduled to visit Japan next month.
            "4806097",  # These diamonds come from South Africa.
        ],

        # === Divorce / relationship drama (loosened — kept) ===
        [
            "316753",   # She divorced her husband.
            "325389",   # The divorce rate is expected to rise.
            "325387",   # Divorce is becoming more common nowadays.
            "3821632",  # Divorce is always painful.
            "2107342",  # We're divorced.
            "887432",   # She tells him to give her all of his salary and he does.
        ],

        # === Appearance / beauty comparisons (loosened — drama OK) ===
        [
            "1096130",  # Mary was definitely the prettiest girl at the party.
            "2954936",  # You're definitely prettier than Mary.
            "1096131",  # Mary wanted to marry a man with ambition.
            "1534319",  # Mary wore a pale blue dress.
        ],

        # === Injuries / blindness / personal heavy (loosened — fine at L11) ===
        [
            "5856450",  # I was born blind.
            "5858945",  # I'm legally blind.
            "3826195",  # I'm not legally blind.
            "5860529",  # I accidentally poisoned myself.
            "2241458",  # We suspect poisoning.
            "2218329",  # You're poisoning me.
            "4265105",  # People used to think that tomatoes were poisonous.
        ],

        # === Bleeding / chest pain (loosened — body/medical fine) ===
        [
            "481815",   # My knee is bleeding.
            "4664236",  # We've finally stopped the bleeding.
            "2359951",  # I've managed to stop the bleeding.
            "28205",    # I lost consciousness.
            "297563",   # He twisted my arm.
            "2402239",  # You won't bleed to death.
            "18953",    # I have a sharp pain in my chest.
            "5774441",  # My chest hurts.
            "278306",   # The pain was more than he could bear, so he took some medicine.
        ],

        # === Aches / cough (loosened) ===
        [
            "275268",   # She was aching from head to foot.
            "63521",    # I ache all over.
            "5852895",  # Does your head ache?
            "250602",   # My cough is getting worse.
            "5852885",  # I began coughing.
            "2245908",  # I heard coughing.
        ],

        # === Throat (loosened — kept as small cluster) ===
        [
            "19356",    # I got a fish bone stuck in my throat.
            "294760",   # He cleared his throat.
            "241156",   # The speaker cleared his throat.
        ],

        # === Homeless ===
        [
            "2540029",  # Many homeless people live in parks.
        ],

        # === War / enemies / battles (loosened — kept) ===
        [
            "44802",    # The city fell to the enemy.
            "4663228",  # The enemy is becoming more and more powerful.
            "690919",   # We need to band together to beat the enemy.
            "307209",   # They attacked the enemy.
            "291097",   # He was wounded in the battle.
            "807556",   # Many thousands on both sides had been wounded.
            "5094816",  # You're your own worst enemy.
            "2242976",  # They're enemies.
        ],

        # === Soul / protest (loosened) ===
        [
            "5368859",  # Don't tell a soul.
            "34679",    # There wasn't a soul in sight.
            "2245991",  # I must protest.
            "5828955",  # I protested.
            "4501567",  # Why are they protesting?
            "5558243",  # We should all be protesting this.
            "4879945",  # The protests have died down.
        ],

        # === Authority / register (loosened — workplace useful) ===
        [
            "3142959",  # Are you questioning my authority?
            "2951514",  # Are you challenging my authority?
            "924161",   # I don't have the authority to give you permission.
            "295669",   # He is an authority on criminal law.
        ],

        # === Poems / school (loosened — kept) ===
        [
            "298214",   # He was learning a poem.
            "272982",   # The teacher compared my poem with one of his.
            "59042",    # This poem was originally written in French.
            "2540603",  # I wrote another poem this morning.
            "578279",   # Everyone should choose at least one poem and learn it by heart.
            "2835507",  # You're supposed to have this poem memorized before our next class.
        ],

        # === Vintage / CDs / air conditioning (loosened — kept) ===
        [
            "61387",    # This CD belongs to her.
            "69842",    # Which CD do you want to listen to?
            "260265",   # I lent him a CD.
            "5092314",  # There's no air conditioning.
            "256461",   # I can't survive without air conditioning in the summer.
            "57295",    # This room is air-conditioned.
            "909504",   # It's so hot outside that I want to spend all day in my air conditioned house.
        ],

        # === Clothes / pressing / etc. (loosened — kept) ===
        [
            "33429",    # A button came off my coat.
            "33428",    # There are buttons on the coat.
            "3831371",  # Your top button is undone.
            "60959",    # These trousers need pressing.
            "254040",   # I bought two pairs of trousers.
            "705102",   # I have a brand new pair of socks.
            "2258864",  # I'm going to buy a leather belt.
            "1541492",  # It's made of leather.
            "2547251",  # I'll shine your shoes.
            "273352",   # If you wash it, your car will shine in the sun.
        ],

        # === Engineers / professions (loosened) ===
        [
            "33158",    # Bob became an engineer.
            "3824941",  # I'm the chief engineer.
            "319197",   # My father wants me to be an engineer.
            "5828913",  # I'm a poet.
            "298215",   # He is a poet.
            "5839972",  # I'm a senior.
            "1132368",  # I study psychology.
            "56912",    # This book deals with psychology.
        ],

        # === Tennis / ski / mountain (loosened) ===
        [
            "680323",   # Mary injured her back playing tennis.
            "247932",   # We went skiing in Canada.
            "250850",   # My favorite sport is skiing.
            "290185",   # He broke his leg skiing.
            "3037503",  # Ski jumping looks scary.
            "4496600",  # We can either go to the beach or go mountain climbing. We can't do both.
        ],

        # === Recycle / wishes (loosened) ===
        [
            "5172846",  # I wish that more people would take time to properly recycle.
            "5172850",  # I wish I was smart enough to invent something that sold well enough for me to get rich.
            "4731108",  # We have started to recycle our newspapers.
            "1127427",  # These documents were printed on recycled paper.
        ],

        # === Animals (loosened) ===
        [
            "898521",   # What brand of dog food do you feed your dog?
            "4318333",  # This dog bites.
            "954186",   # My dog sometimes eats grass.
            "1830623",  # Horses eat grass.
            "265285",   # The grass looks nice.
            "46890",    # The grass needs cutting.
            "35814",    # Cats catch mice.
            "3011192",  # This cat doesn't chase mice.
            "2406065",  # I saw a mouse!
            "35797",    # It was a mouse.
        ],

        # === Hardware / shopping niche (loosened) ===
        [
            "295537",   # He deals in hardware.
            "2023491",  # That is sold at hardware stores.
            "5852136",  # I have split ends.
            "2644143",  # Do you have a bowling ball?
            "2891823",  # Roll up your sleeves.
            "34806",    # Do you also want a shave?
            "4495201",  # Beer sales are up.
            "5137541",  # Some of the people in the crowd were throwing beer bottles.
            "2293236",  # I assume you still enjoy drinking beer.
        ],

        # === Sensible / register (some kept; bare ones still removed above) ===
        [
            "2111404",  # That's sensible.
            "2111955",  # Be sensible.
            "2187257",  # That's foolish.
            "2203576",  # We're wealthy.
        ],

        # === Astronomy (loosened — kept) ===
        [
            "1481",     # Tomorrow, he will land on the moon.
            "295907",   # He stood on the surface of the moon.
            "477352",   # Nobody owns the moon.
            "43103",    # That was the first time that a man walked on the moon.
            "324580",   # The moon was bright last night.
            "27042",    # There are millions of stars in the universe.
            "682265",   # There are billions of stars in the universe.
            "1636143",  # I wonder if we're alone in the universe.
        ],

        # === Castle (loosened — kept) ===
        [
            "272165",   # There used to be a small castle on this hill.
            "25852",    # Seen from a distance, the big rock looks like an old castle.
            "288710",   # He pointed to the tower over there.
            "279667",   # There's a large clock near the top of the tower.
        ],

        # === Habit (loosened — kept) ===
        [
            "1316912",  # He has the habit of reading the newspaper during meals.
            "280616",   # Reading is the kind of habit that once acquired is never lost.
            "1392882",  # Once you've formed a bad habit, you can't get rid of it easily.
            "1318631",  # She is in the habit of writing in her diary every day.
        ],

        # === Idioms (loosened — kept) ===
        [
            "5216744",  # I was shaking like a leaf.
            "3264721",  # I've turned over a new leaf.
            "1831129",  # That ship has sailed.
            "241202",   # Don't throw in the towel.
            "25545",    # I have a card up my sleeve.
        ],

        # === Misc kept ===
        [
            "1334065",  # I know you're upset about your car being totaled, but you weren't injured.
            "3821670",  # The revolution is over.
        ],

        # === Mr. Jackson (loosened — recurring teacher character kept) ===
        [
            "4529761",  # Mr. Jackson is our principal.
            "6040065",  # Mr. Jackson doesn't accept gifts from students.
            "4749568",  # Mr. Jackson teacher echo from L4.
        ],

        # === Wrap up — closing arc ===
        [
            "2107336",  # We're celebrating.
            "2111750",  # I'm celebrating.
            {"text": "What's the occasion?", "added_for": "occasion", "reason": "natural Q"},
            {"text": "I got the job!", "added_for": "got|job", "reason": "natural climactic answer"},
        ],
    ],
}
