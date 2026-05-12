"""Curation plan for OGTE Level 13 — High Upper Intermediate (~1166 sentences).

At L13 learners handle nuanced opinions, hypotheticals, indirect speech,
polite disagreement, workplace and intellectual scenarios, and idiomatic
phrasing. Arcs target Q/A pairs and tight thematic clusters with
vocabulary breadth (no drill repetition of the same content word
across more than 3 consecutive rows).

Curation philosophy (refined for L13):
  - Long sentences and embedded clauses are fine — learners need them.
  - Common idioms are valuable — keep most.
  - Family / relationship / passive-aggressive drama is fine; only
    overtly sexist generalizations are dropped.
  - Specific years and numbers in moderation are fine.
  - Mild crime / police / theft / passing references to violence are fine;
    only gore-heavy or war-glorifying are dropped.
  - Body parts, narratives, political content (non country-specific),
    proper names in moderation are fine.
  - Still removed: dated brands (Facebook/iPhone/YouTube), overtly
    sexist generalizations, extremely niche cultural references,
    exact duplicates, drill patterns.
"""

from __future__ import annotations


L13_PLAN = {
    "removals": [
        # ---- Niche US-centric proper nouns (overflow only) ----
        {"id": "457642", "reason": "'Harvard was founded in 1636.' — US institution + duplicate of 35606."},
        {"id": "5364078", "reason": "'The company was founded in Boston in 2013.' — Boston + niche year."},
        {"id": "5725558", "reason": "'I thought guns were banned in Boston.' — US-centric + guns framing."},
        {"id": "2774714", "reason": "'Which platform is the train for Boston?' — Boston overflow."},
        {"id": "6270569", "reason": "'I regret leaving Boston.' — Boston overflow + regret drill."},
        {"id": "6252186", "reason": "'Both of my ex-wives live in Boston.' — Boston overflow + oddity."},
        {"id": "312173", "reason": "'She traveled from Boston to San Francisco via Chicago.' — US city pile-up."},
        {"id": "2944666", "reason": "'What's the minimum wage in Australia?' — country-specific politics."},

        # ---- Overtly sexist generalizations / gendered prescriptions ----
        {"id": "3818499", "reason": "'Never interrupt a woman.' — gendered prescription."},
        {"id": "3735971", "reason": "'Many women are afraid of spiders.' — gendered generalization."},
        {"id": "4017280", "reason": "'Mary isn't only prettier but she gets better grades than Alice.' — appearance-comparing women."},
        {"id": "4135321", "reason": "'I think Mary was the prettiest girl in our class…' — body comment about a girl."},
        {"id": "887417", "reason": "'She suggested that I should clean the bathroom.' — gendered-chore framing."},

        # ---- Heavy / gore / war-glorifying ----
        {"id": "4198259", "reason": "Long murderer-writing-with-blood — gruesome detail."},
        {"id": "3991519", "reason": "Long police-suspected-dead-body sentence — gruesome detail."},
        {"id": "4500714", "reason": "'Search dogs located the victim's body.' — gruesome detail."},
        {"id": "307023", "reason": "'They invaded the country with tanks and guns.' — war-glorifying."},
        {"id": "3636098", "reason": "'This place was bombed during the war.' — war-glorifying."},
        {"id": "274924", "reason": "'Many cities were destroyed by bombs.' — war-glorifying."},
        {"id": "295663", "reason": "'He was drafted into the army.' — military-heavy."},

        # ---- Dated brands / tech (none found — empty section) ----

        # ---- Exact / near-duplicate clutter ----
        {"id": "35606", "reason": "'Harvard University was founded in 1636.' — duplicate of 457642 framing."},
        {"id": "2361902", "reason": "'I'm proud to be a Canadian.' — exact duplicate of 2645060."},
        {"id": "318316", "reason": "'When ice melts, it becomes water.' — duplicate of 318315 (becomes liquid)."},
        {"id": "1768848", "reason": "'We spoke briefly.' — duplicate of 1768847 'They spoke briefly.'"},
        {"id": "4710418", "reason": "'How is this pronounced?' — duplicate of 3251373."},
        {"id": "4285670", "reason": "'Do you know how sausage is made?' — duplicate of 4285627."},
        {"id": "2256883", "reason": "'That's completely untrue.' — duplicate of 'That's untrue.'"},
        {"id": "4498335", "reason": "'We're entitled to the facts.' — duplicate of 2954939 'entitled to truth'."},
        {"id": "4500463", "reason": "'Its origin is unknown.' — near-duplicate of 4500447."},
        {"id": "4323824", "reason": "'They pitched their tents on the beach.' — plural duplicate of 4323823."},
        {"id": "2275445", "reason": "'This kind of mistake is easy to overlook.' — duplicate of 2275446."},
        {"id": "4502347", "reason": "'The music stopped abruptly.' — duplicate of 4502346."},
        {"id": "60175", "reason": "'This house has two bathrooms.' — duplicate of 2541738 'three bathrooms'."},
        {"id": "303519", "reason": "'He climbed over the fence.' — duplicate of 3732753 'I climbed the fence.'"},
        {"id": "266631", "reason": "'I hear my uncle died of cancer.' — duplicate of 250247."},
        {"id": "2280194", "reason": "'It's six degrees below zero.' — duplicate of 680358 'thirty degrees below zero.'"},
        {"id": "61382", "reason": "'This science-fiction novel is very interesting.' — duplicate of simpler 'I love science fiction' line."},
        {"id": "3577045", "reason": "'My bicycle needs to be repaired.' — duplicate of 258210."},

        # ---- Drill / repetitive overflow within a head word ----
        {"id": "4499937", "reason": "'I deeply regret that.' — regret-drill overflow (keep 'I truly regret that' + variations)."},
        {"id": "5639097", "reason": "'I definitely regret that.' — regret-drill overflow."},
        {"id": "4014979", "reason": "'There'll come a day when you'll regret it.' — near-duplicate of 4012967."},
        {"id": "3210251" if False else "5788302", "reason": "'We weren't complaining.' — complain-drill overflow."},
        {"id": "2111503", "reason": "'Stop complaining.' — complain-drill overflow."},
        {"id": "4497354", "reason": "'The complaint was dismissed.' — duplicate of 4497353 'Both complaints were dismissed.'"},
        {"id": "2240608", "reason": "'We're losing perspective.' — duplicate of 2218201."},
        {"id": "2218201", "reason": "'You're losing perspective.' — vague accusatory."},
        {"id": "2648169", "reason": "'You're so shallow.' — duplicate of 2203336 'You're shallow.'"},
        {"id": "1895562", "reason": "'You're such a pig.' — duplicate of 2218034 'You're a pig.'"},
        {"id": "2202693", "reason": "'We're cooperative.' — paired-duplicate of 2202694."},
        {"id": "2202694", "reason": "'You're cooperative.' — vague accusatory."},
        {"id": "3324356", "reason": "'The towels in the bathroom are dirty.' — bathroom drill overflow."},
        {"id": "324959", "reason": "'Don't leave the bathroom in such a mess.' — bathroom drill overflow."},
        {"id": "4665554", "reason": "'I hate cleaning the bathroom.' — bathroom drill overflow."},
        {"id": "324957", "reason": "'The lights in the bathroom aren't working.' — bathroom drill overflow."},
        {"id": "39128", "reason": "'Let's eat outside instead of in our tents.' — tent drill overflow."},
        {"id": "652134", "reason": "'We pitched our tents before it got dark.' — tent drill overflow."},
        {"id": "5189099", "reason": "'I've kind of gotten used to living in a tent.' — tent drill overflow."},
        {"id": "1429064", "reason": "'I'm used to sleeping in a tent.' — tent drill overflow."},
        {"id": "5204175", "reason": "'I took the wheels off my bicycle.' — bicycle drill overflow."},
        {"id": "3583273", "reason": "'I wish I had ridden my bicycle here.' — bicycle drill overflow."},
        {"id": "3616159", "reason": "'This isn't the first time I've ridden a bicycle.' — bicycle drill overflow."},
        {"id": "316308", "reason": "'She advised him to use a bicycle.' — bicycle drill overflow."},
        {"id": "4495441", "reason": "'Bicycle access is limited.' — niche/abstract bicycle entry."},
        {"id": "4663186", "reason": "'Everyone's been complaining about the new tax.' — complain-drill overflow."},
        {"id": "4554341", "reason": "'The workers are complaining about their working conditions.' — complain-drill overflow."},
        {"id": "4015142", "reason": "'Spiders aren't insects.' — spider-factoid drill overflow."},
        {"id": "5161354", "reason": "'Spiders have eight legs.' — spider-factoid drill overflow."},
        {"id": "323632", "reason": "'Wood floats, but iron sinks.' — physics-factoid drill (keep one)."},
        {"id": "1869662", "reason": "'Wood floats.' — physics-factoid drill duplicate."},
        {"id": "5275040", "reason": "'Why does ice float?' — physics-factoid drill overflow."},
        {"id": "318339", "reason": "'If you heat ice, it melts.' — physics-factoid drill overflow."},

        # ---- Obscure proverbs / dated idiom phrasing ----
        {"id": "2274", "reason": "'A known mistake is better than an unknown truth.' — obscure proverb."},
        {"id": "240888", "reason": "'Attack is the best form of defense.' — obscure proverb."},
        {"id": "1285644", "reason": "'In the land of the blind, the one-eyed man is king.' — obscure proverb."},
        {"id": "4012244", "reason": "'Lightning does sometimes strike the same place twice.' — obscure proverb."},
        {"id": "3501305", "reason": "'If the cap fits, wear it.' — dated proverb."},
        {"id": "1387194", "reason": "'I like pigs. Dogs look up to us…' — Churchill quote/meme, not natural speech."},
        {"id": "2007273", "reason": "'Let's cross some T's and dot some I's.' — meta-idiom, awkward."},

        # ---- Extremely niche / awkward in isolation ----
        {"id": "4015377", "reason": "'There's no buried treasure here.' — odd in isolation."},
        {"id": "276188", "reason": "'Who buried the gold bars here?' — bizarre treasure trope."},
        {"id": "1078683", "reason": "'Give me my sword.' — anachronistic/fantasy register."},
        {"id": "3820404", "reason": "'It's a beautiful sword.' — anachronistic/fantasy register."},
        {"id": "5189371", "reason": "'I used to be a landlord.' — very niche role."},
        {"id": "2247568", "reason": "'I wear boxers.' — niche personal underwear comment."},
        {"id": "5828646", "reason": "'I'm deaf.' — odd in isolation, no context."},
        {"id": "898529", "reason": "'I never feed my dog raw meat.' — odd/niche."},
        {"id": "1475603", "reason": "'I can't eat raw eggs. They have to be cooked.' — niche."},
        {"id": "4144904", "reason": "Long 'Mary put some flowers in the vase and then put the vase on the table.' — clunky/circular."},
        {"id": "4197966", "reason": "Long 'A connection between personality and blood type…' — pseudoscience trope."},
        {"id": "953640", "reason": "Long 'I think it's unhealthy to eat more than 20 oranges a day.' — odd specific."},
        {"id": "5853301", "reason": "Long 'The best way to ruin a good cup of coffee…' — opinion bias."},
        {"id": "4015954", "reason": "'It took three hours for us to paint the fence.' — niche specific time."},

        # ---- Single overflow / clunky long sentences (kept very few) ----
        {"id": "5644758", "reason": "Long 'We told the waiter that everything was delicious.' — clunky narrative + delicious drill."},
        {"id": "5852931", "reason": "Long 'I've already decided who to give my old bicycle to.' — convoluted + bicycle overflow."},
        {"id": "4132582", "reason": "Long 'There were a lot of empty beer bottles lying on the ground near the tent.' — clunky + tent overflow."},
        {"id": "1334016", "reason": "Long 'The food wasn't very delicious, but otherwise…' — convoluted phrasing."},
        {"id": "39547", "reason": "Long 'I held onto the rope for as long as I could…' — clunky."},
        {"id": "1318871", "reason": "Long 'I held on to the rope tightly so I wouldn't fall.' — clunky."},
        {"id": "6555137", "reason": "Long 'The tree in front of the library was struck by lightning.' — clunky."},

        # ---- Misc tightening / vague-evaluative ----
        {"id": "5856416", "reason": "'I'm very humble.' — self-contradictory."},
        {"id": "2202962", "reason": "'I'm humble.' — same self-contradiction."},
        {"id": "2187256", "reason": "'That's evident.' — duplicate-vague of 3728547."},
        {"id": "3728547", "reason": "'That was evident.' — vague."},
        {"id": "2218173", "reason": "'You're incredibly talented.' — sycophantic vague."},
        {"id": "2218190", "reason": "'You're limiting yourself.' — vague accusatory."},
        {"id": "5916301", "reason": "'You certainly are greedy.' — accusatory."},
        {"id": "4496511", "reason": "'Who stole my battery charger?' — accusatory + obscure object."},
        {"id": "4502780", "reason": "'Everybody voted yes.' — abstract context-less."},
        {"id": "5189099" if False else "2007748", "reason": "'Let's keep it civil.' — pre-fight register awkward."},
        {"id": "3728985", "reason": "'That's very civil of you.' — sarcastic-formal awkward."},

        # ---- Physics/math factoid noise ----
        {"id": "278236", "reason": "'A right angle has ninety degrees.' — math factoid."},
        {"id": "1582783", "reason": "'A square has four angles.' — math factoid."},

        # ---- Tonal mismatches / context-less commands ----
        {"id": "2245486", "reason": "'Expect no mercy.' — menacing register."},
        {"id": "2013006", "reason": "'I want you to beg for mercy.' — menacing register."},
        {"id": "2111921", "reason": "'Defend yourself.' — context-less imperative."},
        {"id": "2111920", "reason": "'Defend yourselves.' — same."},
        {"id": "5858618", "reason": "'I built a shelter.' — context-less."},

        # ---- Disaster overflow (keep some, drop heaviest) ----
        {"id": "4870323", "reason": "'Thousands of homes were destroyed by the flood.' — disaster heavy."},
        {"id": "22874", "reason": "'We provided the flood victims with food and clothing.' — disaster heavy."},
        {"id": "972862", "reason": "Long 'Thousands of dead fish have been found floating in the lake.' — heavy + morbid."},

        # ---- Cancer cluster (keep one, drop overflow) ----
        {"id": "266631" if False else "302428", "reason": "'He's got lung cancer.' — cancer-drill overflow."},
        {"id": "5858202", "reason": "'I have lung cancer.' — duplicate of 302428."},
        {"id": "3821569", "reason": "'I'm a cancer patient.' — cancer-drill overflow."},
        {"id": "4665561", "reason": "'I could have terminal cancer.' — cancer-drill overflow."},

        # ---- Misc small ----
        {"id": "265904", "reason": "'My hands are stained with paint.' — duplicate of shirt-is-stained framing."},
        {"id": "1925367", "reason": "'Are you a registered voter?' — US political register."},
        {"id": "4499043", "reason": "'The romance is gone.' — vague abstract."},
        {"id": "1869829", "reason": "'The bathroom is dirty.' — bathroom drill overflow (keep ones with specific verbs)."},
        {"id": "4999818", "reason": "'I have three college degrees.' — odd brag."},
        {"id": "535249", "reason": "'He neglected his duties.' — abstract."},
        {"id": "5938663", "reason": "'I've never eaten raw fish.' — niche food + duplicate framing."},
        {"id": "3231262", "reason": "'You could've ruined everything.' — duplicate of ruin cluster."},

        # ---- Closing: very minor tonal / context awkward ----
        {"id": "264567", "reason": "Long 'We are not as happy or unhappy as we imagine ourselves to be.' — proverb."},
        {"id": "4482802", "reason": "'Why have you been so miserable lately?' — accusatory + lately-drill."},
        {"id": "5916549", "reason": "'You're clearly unhappy.' — accusatory."},
    ],
    "arcs": [
        # ===========================================================
        # === FIRST ARCS (3 hand-picked highest-quality openers) ===
        # ===========================================================

        # FIRST #1: Opinion / hedge / polite disagreement — flagship L13 register
        {
            "position": "first",
            "items": [
                "257119",   # I agree to your proposal.
                "2328062",  # I fully support your proposal.
                "69948",    # Are you in favor of the proposal?
                {"text": "I'd rather not say.", "added_for": "rather", "reason": "polite hedge for opinion question"},
                "300094",   # He readily agreed to my proposal.
                "314358",   # She rejected my proposal.
                {"text": "Why was it rejected?", "added_for": "rejected", "reason": "natural follow-up Q"},
                "2359065",  # I've been considering your proposal.
                {"text": "When can we expect your decision?", "added_for": "decision", "reason": "natural follow-up"},
                "3826948",  # The proposal was adopted.
            ],
        },

        # FIRST #2: Pride / family / accomplishment — warm, common L13 ground
        {
            "position": "first",
            "items": [
                "2547137",  # I'm proud of you guys.
                "259233",   # I'm proud of my son.
                "633543",   # I'm proud that my father is a good cook.
                "4529590",  # We're proud of our achievement.
                "3831404",  # Your parents would've been proud of you.
                {"text": "That means a lot to me.", "added_for": "means", "reason": "warm reply to 'parents would've been proud'"},
                "2645060",  # I'm proud to be Canadian.
                "3016610",  # I'm not proud of my behavior.
                "2538384",  # I'm proud of the way you handled yourself.
            ],
        },

        # FIRST #3: Hypotheticals & modal reflection — should've / could've / would've
        {
            "position": "first",
            "items": [
                "2406477",  # I should've worn gloves.
                "2952352",  # I must've overlooked something.
                "6108355",  # I would've been unable to do that without your help.
                {"text": "You'd have figured it out.", "added_for": "figured", "reason": "warm reassurance reply"},
                "2954845",  # You were wise to cooperate.
                "5618994",  # I think there's only a slim chance of that happening.
            ],
        },

        # ===========================================================
        # === Regret (fixed: split, vocabulary widened) ===
        # ===========================================================
        # Original drilled 7+ regrets in a row. Now: max 3 consecutive 'regret',
        # interleaved with related vocab.
        [
            "1335901",  # I truly regret that.
            "2392565",  # I regret saying that.
            "3378686",  # I'm beginning to regret it.
            {"text": "We've all said things we wish we hadn't.", "added_for": "wish|hadn't", "reason": "rewrite to break repetition with related vocab"},
            "4501696",  # What's your biggest regret?
            {"text": "Honestly, I have a few.", "added_for": "honestly", "reason": "natural answer to 'biggest regret'"},
            "2276181",  # I don't regret a thing.
            "1793767",  # I have no regrets.
            "5807423",  # I have no regrets about retiring.
        ],
        [
            "28940",    # I regret not having taken his advice.
            "256657",   # I regret not having studied harder at school.
            "256925",   # I regret becoming a teacher.
            "245036",   # I regret not being able to join you.
            "3823040",  # I regret not having lived a better life.
            "3818225",  # I regret not having been honest with you.
        ],
        [
            "3050622",  # Don't say something you'll regret later.
            "2361582",  # I guarantee you won't regret it.
            "4012967",  # There'll come a day when you'll regret doing that.
            "3820275",  # I regretted doing that.
            "274856",   # I regretted having wasted a great deal of time.
            "4870666",  # I don't regret arriving late.
        ],
        [
            "3914067",  # I regret kissing you.
            "4809293",  # Do you regret marrying me?
            {"text": "Not for a second.", "added_for": "second", "reason": "warm Y answer"},
        ],

        # ===========================================================
        # === Pride — second cluster (more pride examples not in first arc) ===
        # ===========================================================
        [
            "5132194",  # We're pretty proud of ourselves.
            "4963959",  # I'm proud of this team.
            "5659300",  # I'm very proud of our students.
            "6126605",  # I'm proud to be your coach.
            "293613",   # He is proud of being a doctor.
            "2927334",  # You should be proud of yourselves.
            "3016611",  # I'm not proud of how I acted.
            {"text": "We all do things we regret.", "added_for": "things", "reason": "consolation tying pride/regret"},
        ],

        # ===========================================================
        # === Grateful / thanks / appreciation ===
        # ===========================================================
        [
            "2243538",  # They'll be grateful.
            "4502013",  # They seemed grateful.
            "2406865",  # I suppose I should be grateful.
            "2953907",  # We're grateful for your assistance.
            "246554",   # I can't express how grateful I am.
            "59834",    # I'm so grateful to you for this opportunity.
            "5853097",  # I'd be grateful if you could help me move these boxes.
            {"text": "Of course, anytime.", "added_for": "anytime", "reason": "warm reply to grateful request"},
            "3734400",  # Don't be ungrateful.
            "3734401",  # I'm not ungrateful.
        ],
        [
            "3831476",  # Your cooperation is appreciated.
            "2012498",  # I wanted your cooperation.
            "2892998",  # You'll have our complete cooperation.
            "3825565",  # I expected a bit more cooperation.
            "54483",    # Thank you in advance for your cooperation.
            "1396344",  # If I hadn't had your cooperation, I couldn't have finished…
            "2044656",  # We'd be happy to cooperate.
            "2111743",  # I'm cooperating.
            "5512544",  # We'll continue cooperating.
        ],

        # ===========================================================
        # === Apology / spelling / errors ===
        # ===========================================================
        [
            "3824925",  # I apologize for all the spelling errors.
            "5916281",  # You've made three errors.
            "4397659",  # Did you notice any errors?
        ],

        # ===========================================================
        # === Complaint — fixed: split, vocab-widened ===
        # ===========================================================
        # Originally had 6 consecutive arcs all using 'complain/complaining'.
        # Now split with interleaved vocab.
        [
            "2990143",  # What's the nature of your complaint?
            "5448685",  # I think my complaint is valid.
            "4498640",  # No official complaint was filed.
            "4496624",  # My only complaint is that where I work isn't closer to my house.
            "5000894",  # Complaints are rare.
            "4497353",  # Both complaints were dismissed.
        ],
        [
            "1886561",  # Who's complaining?
            "17008",    # I'm fed up with your constant complaining.
            "1422397",  # She keeps complaining that she has no time.
            "1427922",  # I've never heard him complaining about his meals.
            "5890902",  # The rent is really cheap, so I'm not complaining.
        ],
        [
            "2330044",  # I guess I shouldn't complain.
            "5859777",  # I rarely complain.
            "1951418",  # I can't complain about the way I've been treated.
            "909580",   # Try not to spend so much time complaining about things you can't change.
            "2952800",  # I'm not going to sit here and listen to you complaining all day.
            "251861",   # My mother almost never complains.
        ],
        [
            "2759704",  # Nobody complained.
            "4496748",  # Customers haven't complained.
            "4665801",  # I complained to the manager.
            "954377",   # There have been a lot of complaints about that policy.
            "17266",    # I'm sick of listening to your complaints.
            "243002",   # I've had it. All I've done today is handle complaints.
            "388593",   # She complained about my low salary.
            "54199",    # We complained about the poor service.
        ],
        [
            "326031",   # That customer came back to complain again.
            "2703345",  # I want to publicly complain about that.
            "3735534",  # People always complain about the weather.
            "256990",   # I complained, but they refused to take this sweater back.
            "319125",   # My father complained about the traffic noise.
        ],

        # ===========================================================
        # === Insecure / uneasy / unsure ===
        # ===========================================================
        [
            "5828927",  # I'm unsure.
            "2255129",  # You look unsure.
            "3687293",  # I'm feeling uneasy.
            "3354125",  # You're making me uneasy.
            "2819549",  # There was an uneasy silence.
            "2247984",  # I'm feeling insecure.
            "314688",   # She felt insecure about her future.
            {"text": "What's bothering you?", "added_for": "bothering", "reason": "natural Q probing uneasy feeling"},
        ],

        # ===========================================================
        # === Slightly / somewhat — hedging adverbs ===
        # ===========================================================
        [
            "2648512",  # I'm slightly busy.
            "5165772",  # I feel slightly sick.
            "3211810",  # I was slightly surprised.
            "3920551",  # I'm slightly worried about you.
            {"text": "Is everything okay?", "added_for": "okay", "reason": "natural follow-up to 'slightly worried'"},
            "5332947",  # Three people were slightly injured.
            "4850015",  # Three cyclists were slightly injured.
        ],
        [
            "3626305",  # We're somewhat late.
            "3105174",  # That looks somewhat dangerous.
            "4494160",  # This is somewhat personal.
            "4501181",  # This is somewhat normal.
            "4502207",  # This song sounds somewhat familiar.
            "4498165",  # This drink tastes somewhat familiar.
            "2057850",  # You have to be somewhat to blame for that.
            "4496868",  # Consider yourself somewhat fortunate.
        ],

        # ===========================================================
        # === Crisis / situation / urgency ===
        # ===========================================================
        [
            "3735906",  # This is a major crisis.
            "5066389",  # How serious is the crisis?
            {"text": "More serious than we thought.", "added_for": "serious", "reason": "natural answer"},
            "2892429",  # We're in the middle of a crisis.
            "4665389",  # We're facing a budget crisis.
            "680049",   # The country's economy is about to collapse.
        ],

        # ===========================================================
        # === Standards / reputation / honesty ===
        # ===========================================================
        [
            "2245899",  # I have standards.
            "3305041",  # I have certain standards.
            "2361124",  # I don't care about my reputation.
            "3821334",  # I have a reputation to protect.
        ],

        # ===========================================================
        # === Truth / opinion / incorrect ===
        # ===========================================================
        [
            "2954939",  # You're entitled to the truth.
            {"text": "Then tell me everything.", "added_for": "everything", "reason": "natural reply"},
            "2954940",  # You're entitled to your opinion.
            "2187269",  # That's untrue.
            "1555324",  # That statement is incorrect.
            "3831439",  # Your information is incorrect.
            "4496948",  # The report is incorrect.
            "4665493",  # This perception is incorrect.
            "4495624",  # Those answers are incorrect.
            "60883",    # This data is incorrect.
            "3736371",  # I think this translation is incorrect.
        ],

        # ===========================================================
        # === Witness / observation / evidence ===
        # ===========================================================
        [
            "2247900",  # I'm a witness.
            "2240796",  # We're both witnesses.
            "3168184",  # One witness was present.
            "4017386",  # Who else witnessed the accident?
            "2953073",  # It was just an observation.
            "3731249",  # Can I make one observation?
            {"text": "Go ahead.", "added_for": "ahead", "reason": "natural reply granting permission"},
        ],

        # ===========================================================
        # === Unable to — capability / limits ===
        # ===========================================================
        [
            "2208533",  # I'm unable to function alone.
            "2540041",  # I'm unable to answer that question.
            "2543177",  # I was unable to prevent this.
            "3310251",  # We've been unable to determine the cause.
            "298650",   # He is unable to provide for his family.
            "261250",   # I was unable to look her in the face.
            "54300",    # We are sorry we are unable to accept your request.
            "293935",   # He seems unable to swim.
            "293934",   # It seems that he is unable to swim.
            "887564",   # She was unable to completely give up her dream of traveling abroad.
            "256285",   # I was unable to breathe because of the smoke.
        ],

        # ===========================================================
        # === Limitations / knowing your limits ===
        # ===========================================================
        [
            "2376095",  # I know my limitations.
            "314659",   # She knows her limitations.
        ],

        # ===========================================================
        # === Profile / browser / online life ===
        # ===========================================================
        [
            "3760979",  # I like your profile picture.
            "3821511",  # I changed my profile picture.
            "2659659",  # What browser are you using?
            "3880350",  # Which browser is your favourite?
            {"text": "I mostly use Firefox.", "added_for": "firefox", "reason": "natural answer to browser Q"},
            "5628408",  # Restart your computer.
            "3127914",  # I suggest you keep a low profile.
        ],

        # ===========================================================
        # === School grade / education ===
        # ===========================================================
        [
            "3738695",  # You're in third grade, right?
            "246598",   # The reason why I got a bad grade is that I did not study.
            "2407222",  # I teach third grade.
            "2711717",  # What grade do you teach?
            {"text": "I teach fourth grade.", "added_for": "fourth", "reason": "natural answer"},
            "435638",   # Did you grade the tests?
            "6122878",  # I started studying French when I was in the third grade.
            "327635",   # I dropped out of school when I was in the 7th grade.
            "2331581",  # I had a girlfriend when I was in the fifth grade.
            "1500186",  # I'm in the eighth grade.
            "310220",   # She was in the eighth grade.
            "4356591",  # I'm in the tenth grade.
            "2780649",  # I'm in the eleventh grade.
            "6452001",  # My son's in the third grade.
        ],
        [
            "1749052",  # My grades have improved significantly.
            "477358",   # My grades are above average.
            "1887590",  # I need to talk to you about your grades.
            {"text": "Are they really that bad?", "added_for": "bad", "reason": "natural reply"},
            "2388115",  # I never got good grades in junior high school.
            "325715",   # My parents were satisfied with my grades this year.
            "3820769",  # Your grades are slipping.
        ],

        # ===========================================================
        # === Advice / suggestion / hesitate ===
        # ===========================================================
        [
            "2270439",  # Don't hesitate to ask.
            "4263051",  # If you have any questions, please don't hesitate to contact me.
            "2093245",  # I'm reluctant to leave.
            "314713",   # She was reluctant to reveal her secret.
            "4530043",  # You just have to adapt.
        ],

        # ===========================================================
        # === Choice / option / decision ===
        # ===========================================================
        [
            "3825751",  # The test was multiple choice.
            "4501558",  # Three options were proposed.
            "806986",   # Several plans were proposed.
            "4494172",  # The options are unlimited.
            "1612979",  # It was a bold decision.
            {"text": "Was it the right call?", "added_for": "call", "reason": "natural Q on 'bold decision'"},
        ],

        # ===========================================================
        # === Tradition / ceremony ===
        # ===========================================================
        [
            "3314734",  # It's a family tradition.
            "4012285",  # It's an old Irish tradition.
            "4664302",  # This has become a yearly tradition.
            "3732288",  # The ceremony has ended.
            "4501660",  # The ceremony was recorded.
            "4016747",  # It was a lovely ceremony.
            "3620284",  # I won't be at the opening ceremony.
            "63623",    # Quite a few people were invited to the ceremony.
            "1454027",  # You may kiss the bride.
            "2254456",  # Who gave away the bride?
            "2301558",  # The bride was wearing a white wedding dress.
        ],

        # ===========================================================
        # === Founding / establishment / temple ===
        # ===========================================================
        [
            "57984",    # When was this university founded?
            "288611",   # He founded the school five years ago.
            "61271",    # When was this temple built?
            "48968",    # There is a very old temple in the town.
            "54647",    # This is the largest temple that I've ever seen.
            "323235",   # Let's visit some temples tomorrow.
        ],

        # ===========================================================
        # === Impressive / inspiring ===
        # ===========================================================
        [
            "1908985",  # It's rather impressive.
            "4498636",  # The figures are impressive.
            "4500200",  # That's a pretty impressive list.
            "3825606",  # It was a very impressive concert.
            "3735587",  # Mary cooked an impressive dinner.
            "2187217",  # It's inspiring.
            "5044564",  # It was really inspiring.
            "2218213",  # You're my inspiration.
            "2246008",  # I need inspiration.
            "5852951",  # My dad inspired me.
            "2043",     # I'm not inspired anymore.
            "4496407",  # Change inspires more change.
        ],

        # ===========================================================
        # === Motivation / determination / curiosity ===
        # ===========================================================
        [
            "2234177",  # What's your motivation?
            "293191",   # He lacks motivation.
            "2291585",  # I admire your determination.
            "2291582",  # I admire your bravery.
            "1737548",  # I did it out of curiosity.
            "2953164",  # Just out of curiosity, what would you do?
        ],

        # ===========================================================
        # === Competition / talent / recognition ===
        # ===========================================================
        [
            "4494110",  # The competition was fierce.
            "2953906",  # We're competitors, not partners.
            "2404158",  # I respect your talent.
            "2954901",  # You're a talented writer.
            "5916724",  # You're a talented kid.
            "6447539",  # Mary is a talented actress.
            "2358854",  # I have absolutely no musical talent.
            "284892",   # He lacks the talent to be an actor.
            "4493610",  # Everyone has natural talents.
            "3281676",  # That's a waste of my talents.
        ],
        [
            "2012918",  # Everybody wants recognition.
            "4501515",  # Praise is always welcome.
            "301108",   # He received a lot of praise.
            "887335",   # She praised him for his honesty.
            "3818801",  # Congratulations on your victory.
            "3314980",  # Congratulations on your big victory.
            {"text": "Thank you, it means a lot.", "added_for": "means", "reason": "warm reply to congratulations"},
            "659536",   # The victory is ours.
            "2241552",  # We'll be victorious.
            "5856454",  # I was victorious.
        ],

        # ===========================================================
        # === Goals / pursuing / modest ===
        # ===========================================================
        [
            "4499948",  # My goals are modest.
            "2396309",  # Oh, don't be so modest.
            "4498150",  # Keep pursuing your dreams.
            "4501589",  # Is this worth pursuing?
            "953121",   # Are you seriously thinking about pursuing a career…?
            {"text": "It depends on the timing.", "added_for": "depends", "reason": "natural reply"},
        ],

        # ===========================================================
        # === Timing / urgency / wasting time ===
        # ===========================================================
        [
            "2882886",  # The timing will be crucial.
            "2249304",  # It's terribly important.
            "2249305",  # It's terribly urgent.
            "2756142",  # They were terribly upset.
            "4494370",  # It was terribly painful.
            "68024",    # His lectures are terribly boring.
            "2953949",  # We're wasting precious time.
            "2955079",  # You're wasting precious time.
        ],

        # ===========================================================
        # === Approach / angle / perspective ===
        # ===========================================================
        [
            "687330",   # Let's approach this from a different angle.
            "2662680",  # Let's approach the problem from a different angle.
            "28839",    # We considered the problem from all angles.
            "669949",   # We should consider the problem from a child's perspective.
            "3156829",  # That puts it in perspective.
        ],

        # ===========================================================
        # === Cause / reason / unknown / absence ===
        # ===========================================================
        [
            "4500447",  # Its origin remains unknown.
            "4665996",  # The exact cause is unknown.
            "260046",   # I know the real reason for his absence.
            "73471",    # After an absence of ten months, he returned home.
            "325485",   # Behave yourself during my absence.
        ],

        # ===========================================================
        # === Random / coincidence / unfortunate ===
        # ===========================================================
        [
            "715782",   # We picked the number at random.
            "317882",   # The people for the experiment were chosen at random.
            "5135476",  # It was an unfortunate incident.
            "244558",   # It was unfortunate that it rained yesterday.
        ],

        # ===========================================================
        # === Permanent / temporary / flexible ===
        # ===========================================================
        [
            "2821003",  # Is your job permanent?
            "5134456",  # It's not a permanent solution.
            "16859",    # Please give me your permanent address.
            "1658027",  # I have a flexible schedule.
            "2202868",  # We're flexible.
        ],

        # ===========================================================
        # === Briefly / explain / introduce ===
        # ===========================================================
        [
            "1768847",  # They spoke briefly.
            "4666066",  # Can you explain it briefly?
            "4904148",  # Could you please briefly introduce yourself?
            {"text": "Sure, where should I start?", "added_for": "start", "reason": "natural reply"},
            "5195226",  # Can you briefly sum up what was said at the meeting?
        ],

        # ===========================================================
        # === Pronunciation / language learning ===
        # ===========================================================
        [
            "2451399",  # Is French pronunciation difficult?
            "3831398",  # Your pronunciation is excellent.
            "38823",    # Please correct my pronunciation.
            "3192918",  # I want to master French pronunciation.
            "2451221",  # I'd like to improve my French pronunciation.
            "4474761",  # Will you help me practice my pronunciation?
            "3251373",  # How is that pronounced?
            "1834255",  # How do you pronounce this?
            "855042",   # Can you pronounce these words?
            "2542301",  # I'm unfamiliar with that word.
            "2542302",  # I'm unfamiliar with that term.
            "2757450",  # My major is linguistics.
        ],

        # ===========================================================
        # === Worth / worthwhile ===
        # ===========================================================
        [
            "1345494",  # Read books that are worthwhile.
            "2208665",  # That alone made the trip worthwhile.
        ],

        # ===========================================================
        # === Cooking / ingredients ===
        # ===========================================================
        [
            "4493987",  # All the ingredients are fresh.
            "4529582",  # Add the rest of the ingredients.
            "2355109",  # What's the secret ingredient?
            "3164496",  # I wonder what the secret ingredient is.
            "5620491",  # We've been eating a lot of beans lately.
        ],

        # ===========================================================
        # === Delicious / food (drill broken with variety) ===
        # ===========================================================
        [
            "3575479",  # Hey, this is delicious.
            "462902",   # The rice is delicious.
            "4494460",  # This dish is delicious.
            {"text": "What's in it?", "added_for": "what's", "reason": "rewrite to break delicious-drill"},
            "1553521",  # Dinner smells delicious.
            "42601",    # It smells delicious.
            "65187",    # Thanks for the delicious meal.
        ],
        [
            "889784",   # Wow! That looks delicious.
            "402340",   # My father made me a delicious lunch.
            "54761",    # I've never eaten anything as delicious as this.
            "2744520",  # Thanks for the chocolate. It was delicious.
        ],
        [
            "882674",   # This orange is delicious.
            "6110315",  # These apples are delicious.
            "6113164",  # These apples are really delicious.
            "281177",   # What's the most delicious fruit in Japan?
            "772850",   # Those bananas are delicious.
        ],

        # ===========================================================
        # === Pie / bake / oven ===
        # ===========================================================
        [
            "5850854",  # I brought a pie.
            "1140015",  # Would you mind if I ate a piece of this pie?
            {"text": "Help yourself.", "added_for": "yourself", "reason": "natural permission reply"},
            "2546115",  # I'd love a slice of pie.
            "3821501",  # Who wants a slice of pie?
            "2549331",  # I'm baking a pie.
            "2293485",  # I baked two pies this afternoon.
            "2584129",  # Do you like apple pies?
            "2325138",  # I dreamed I was eating an apple pie.
            "50028",    # Did you really bake the pie by yourself?
            "2643789",  # You should've had some pie.
        ],
        [
            "4811575",  # I can't bake bread because I don't have an oven.
            "3436612",  # The oven is hot.
            "5851838",  # I lit the oven.
            "4132385",  # I took the cake out of the oven too early.
            "3053138",  # I like the smell of bread just out of the oven.
            "4529021",  # After taking the cake out of the oven, allow it to cool.
            "5224442",  # The cake is in the oven now and it should be ready to come out in about ten minutes.
            "310566",   # She baked bread and cakes in the oven.
        ],

        # ===========================================================
        # === Feast / celebration ===
        # ===========================================================
        [
            "2254527",  # What a feast!
            "3825731",  # We drank champagne last Christmas.
            "3775301",  # They were drinking champagne.
            "2288918",  # Don't break out the champagne yet.
        ],

        # ===========================================================
        # === Snakes / spiders / pets (split, vocab-widened) ===
        # ===========================================================
        [
            "1138309",  # Is the snake alive?
            "2374015",  # I just touched a snake.
            "4963988",  # I'm scared of snakes.
            "953182",   # Do snakes bother you?
            "3824924",  # Don't let these snakes escape.
            "3820752",  # I'm no longer afraid of snakes.
            "33908",    # Some snakes are poisonous.
            "1830580",  # I saw a snake eating a mouse.
            "18346",    # Seen from the sky, the river looked like a huge snake.
        ],
        [
            "289720",   # He hates spiders.
            "6029183",  # I like to watch spiders.
            "1482605",  # There's a spider in the shower.
            "5360453",  # There's a spider inside the tent.
            "259424",   # I saw a spider walking on the ceiling.
        ],

        # ===========================================================
        # === Animals — pigs / wolves / dogs ===
        # ===========================================================
        [
            "3991856",  # Pigs can't fly.
            "4501621",  # Who raised these pigs?
            "2218034",  # You're a pig.
            "2465",     # Wolves won't usually attack people.
            "1392554",  # Wolves don't usually attack people.
            "35129",    # A dove is a symbol of peace.
            "475953",   # I dove into the river.
        ],
        [
            "239178",   # Dogs often bury bones.
            "1357070",  # Dogs bark.
            "48276",    # As soon as the dog saw me, it began to bark.
            "269481",   # I hear a dog barking in the woods.
            "325944",   # The dog next door kept barking all night.
            "898578",   # I have a friend who feeds his dog strawberries.
        ],

        # ===========================================================
        # === Birds / nests / cages ===
        # ===========================================================
        [
            "45011",    # The bird is in its nest.
            "2784458",  # Can you see the nest in the tree?
            "278206",   # Birds build nests.
            "3413048",  # The cage is open.
            "4498264",  # The cage is empty.
            "301654",   # He opened the cages.
            "326628",   # Some animals will not breed when kept in cages.
        ],

        # ===========================================================
        # === Cherry / strawberries / fruit ===
        # ===========================================================
        [
            "2719661",  # I cut down a cherry tree.
            "278478",   # There's an old cherry tree in the garden.
            "4353143",  # There are cherry trees on both sides of the street.
            "5107359",  # It's strawberry season.
            "2744903",  # Help yourself to the strawberry jam.
            "898997",   # Strawberries are expensive in the winter.
        ],

        # ===========================================================
        # === Sausage / pass food ===
        # ===========================================================
        [
            "4285627",  # I wonder how sausage is made.
            {"text": "You probably don't want to know.", "added_for": "know", "reason": "natural reply"},
            "2545676",  # Would you pass the peas?
            {"text": "Sure, here you go.", "added_for": "here", "reason": "natural reply to pass-food request"},
        ],

        # ===========================================================
        # === Raw food / niche eating ===
        # ===========================================================
        [
            "23113",    # We often eat fish raw.
            "954001",   # Is eating raw eggs safe?
            "267093",   # Draft beer tastes especially good on a hot day.
        ],

        # ===========================================================
        # === Bicycle (fixed: split, vocab-widened) ===
        # ===========================================================
        [
            "55517",    # Whose bicycle is this?
            "264498",   # May I borrow your bicycle?
            {"text": "Of course, take it.", "added_for": "take", "reason": "polite Y answer"},
            "17101",    # Your bicycle is similar to mine.
            "4665096",  # How much did this bicycle cost?
            "2712998",  # I can't afford to buy a bicycle.
            "490037",   # I got this bicycle for free.
            "299893",   # He is going to buy a new bicycle next week.
            "2539564",  # I was saving up to buy a new bicycle.
        ],
        [
            "2627927",  # My bicycle has a flat.
            "313840",   # She learned to ride a bicycle last year.
            "298479",   # He goes to school by bicycle.
            "5222549",  # I asked my brother to repair my bicycle.
            "258210",   # I got my bicycle repaired.
            "1550977",  # A car is faster than a bicycle.
            "298753",   # He came down the hill on his bicycle.
            "259605",   # I rode my bicycle to the store.
            "4369144",  # When was the last time you rode a bicycle?
            {"text": "It's been ages.", "added_for": "ages", "reason": "casual reply"},
        ],
        [
            "307317",   # They accused him of stealing the bicycle.
            "2543251",  # All my friends have bicycles.
            "27753",    # Will you lend me your bicycle for an hour?
            "17100",    # Could you lend me your bicycle for a couple of days?
            "4662963",  # Is there any place around here that rents bicycles?
            "752198",   # I broke both my legs riding a bicycle.
            "314575",   # She hurt her foot when she fell off her bicycle.
        ],

        # ===========================================================
        # === Handy / useful ===
        # ===========================================================
        [
            "3729744",  # It'll come in handy.
            "43215",    # That comes in handy.
            "953072",   # A gun might come in handy.
            "953368",   # I can think of some situations in which a knife would come in handy.
            "3130441",  # That'll come in handy, I think.
        ],

        # ===========================================================
        # === Constructive / criticism ===
        # ===========================================================
        [
            "3818616",  # Constructive criticism is always welcome.
            "4664221",  # You're not being very constructive.
        ],

        # ===========================================================
        # === Plot / fiction / novel ===
        # ===========================================================
        [
            "2258740",  # I didn't like the plot of the movie.
            "2765308",  # He likes science fiction.
            "1445020",  # I love romance novels.
            "2720446",  # I think you've read too many romance novels.
            "3820701",  # I think they're plotting something.
        ],

        # ===========================================================
        # === Opera / soap opera ===
        # ===========================================================
        [
            "64906",    # The opera starts at seven.
            "906882",   # What's your favorite soap opera?
            {"text": "I don't really watch any.", "added_for": "watch", "reason": "natural reply"},
            "60088",    # This opera has three acts.
            "70105",    # Have you ever heard this opera sung in Italian?
        ],

        # ===========================================================
        # === Curtain / window / interior ===
        # ===========================================================
        [
            "322491",   # The curtain rose.
            "63832",    # The curtain caught fire.
            "63829",    # Let's hide behind the curtain.
            "315533",   # She hung a curtain over the window.
            "73040",    # A cat appeared from behind the curtain.
            "5915767",  # I hid myself behind a curtain.
            "2213892",  # The curtains are closed.
            "3329448",  # Please close the curtains.
        ],

        # ===========================================================
        # === Carpet / floor / lamp ===
        # ===========================================================
        [
            "61251",    # This carpet feels nice.
            "46268",    # The floor is covered with a thick carpet.
            "61017",    # I still have to get rid of this carpet.
            "906728",   # What's your favorite color for carpets?
            {"text": "Probably a deep red.", "added_for": "deep", "reason": "natural color answer"},
            "953328",   # How do you remove red wine stains from your carpet?
            "2375822",  # I knocked over that lamp.
            "1312184",  # I turned the lamp off and fell asleep.
            "61871",    # Do you sell desk lamps here?
        ],

        # ===========================================================
        # === Receipt / catalog / shopping ===
        # ===========================================================
        [
            "2343601",  # Where's the receipt?
            "56266",    # Here's my receipt.
            "379440",   # Don't forget the receipt.
            "4987847",  # I saw the receipt on the kitchen table.
            "2406056",  # I save my receipts.
        ],
        [
            "269064",   # Send me a new catalog.
            "4496325",  # Please send me your latest catalog.
            "63704",    # Please send me a catalogue.
            "39816",    # Would you please send me a catalogue by mail?
            {"text": "I'll have one mailed today.", "added_for": "mailed", "reason": "natural reply"},
        ],

        # ===========================================================
        # === Mortgage / lease / withdraw ===
        # ===========================================================
        [
            "2358657",  # I have a big mortgage.
            "4497899",  # I don't have a mortgage.
            "4500129",  # I signed a lease.
            "2275786",  # Didn't you sign a lease?
            {"text": "Yes, last week.", "added_for": "last", "reason": "natural answer"},
            "2241411",  # We must withdraw.
            "18453",    # I have to withdraw some cash from the bank.
            "2544929",  # I withdrew my application.
        ],

        # ===========================================================
        # === Money / income / corporate ===
        # ===========================================================
        [
            "4753755",  # My income has decreased ten percent.
            "4388692",  # The European currencies have weakened against the dollar.
            "4496735",  # We offer competitive pricing.
            "4665155",  # We have to remain competitive.
            "5171726",  # I'm a competitive guy.
            "1893641",  # We're in a recession.
            "3725767",  # Everyone hopes the recession will end soon.
        ],

        # ===========================================================
        # === Slim / weight / stiff / sore ===
        # ===========================================================
        [
            "6126704",  # I'm trying to slim down.
            "5853107",  # I'm bored stiff.
            "239263",   # My shoulders feel stiff.
            "257255",   # I have a stiff shoulder.
        ],
        [
            "1388214",  # Mom has a fever.
            "919264",   # I have a small fever.
            "242900",   # I have a slight fever today.
            "135968",   # I have a cough and a little fever.
            "35761",    # I have a sore throat and a slight fever.
            "6441910",  # Since you have a sore throat and a fever, you should probably stay in bed.
            "282100",   # I have a fever and I ache all over.
            "1148054",  # My hip hurts.
        ],

        # ===========================================================
        # === Injury / ankle ===
        # ===========================================================
        [
            "1110536",  # I twisted my ankle.
            "2359876",  # I've hurt my ankle.
            "2358666",  # I have a broken ankle.
            {"text": "You should see a doctor.", "added_for": "doctor", "reason": "natural advice"},
            "5842341",  # How long did it take for the ambulance to arrive?
            "301426",   # He was wounded by a bullet.
            "299598",   # He's somewhat hard of hearing, so please speak louder.
        ],

        # ===========================================================
        # === Sleep / dream / lately ===
        # ===========================================================
        [
            "2359832",  # I haven't had much sleep lately.
            "2360313",  # I haven't slept well lately.
            "2359081",  # I've been dreaming a lot lately.
            "3737327",  # I've been forgetting things lately.
            "243837",   # Have you seen any movies lately?
            "2649652",  # I haven't been following the news lately.
            "5586318",  # We haven't had much luck lately.
            "2662942",  # Have you had problems with anyone lately?
            "2359174",  # I've been learning a lot about them lately.
            "2359296",  # I've been under a lot of pressure lately.
            "243801",   # I've been coming to work one train earlier lately.
            "4014861",  # Have you looked in a mirror lately?
            "1409515",  # That chicken hasn't laid any eggs lately.
            "3396857",  # Have you heard any good jokes lately?
        ],

        # ===========================================================
        # === Lost temper / patience ===
        # ===========================================================
        [
            "31988",    # Mary loses her temper easily.
            "1979575",  # I was starting to lose my temper.
            "5825284",  # I'm sorry I lost my temper and said rude things.
            "262253",   # I tried to be calm, but finally I lost my temper.
            "5826396",  # I hope you'll try to control your temper better next time.
            {"text": "I'll do my best.", "added_for": "best", "reason": "natural reply"},
        ],

        # ===========================================================
        # === Relief / relieved / stress ===
        # ===========================================================
        [
            "1140058",  # That's a relief.
            "2245436",  # Everyone's relieved.
            "251223",   # I felt relieved when my plane landed safely.
            "953262",   # Everybody in the room let out a sigh of relief.
            "2359230",  # I've been sent to relieve you.
            "1975680",  # Does this medicine actually relieve pain?
            "56605",    # This medicine helps relieve muscle pain.
            "2141518",  # It's an excellent method to relieve stress.
            "311014",   # She is unable to cope with stress.
            {"text": "Stress affects us all differently.", "added_for": "affects", "reason": "empathetic reply"},
        ],

        # ===========================================================
        # === Hug / kiss / affection ===
        # ===========================================================
        [
            "2092504",  # Did you hug anybody?
            "3329721",  # Can we at least hug goodbye?
            "3636497",  # Is it OK to hug you?
            "3818239",  # I can't wait to hug you.
            "3152511",  # Would you mind giving me a hug?
            {"text": "Not at all.", "added_for": "all", "reason": "natural reply"},
            "2243337",  # They stopped hugging.
            "2470488",  # We hugged each other.
            "1898338",  # Mary hugged her doll.
        ],

        # ===========================================================
        # === Unhappy / lonely ===
        # ===========================================================
        [
            "3821169",  # I knew you'd be unhappy with the results.
            {"text": "I'm dealing with it.", "added_for": "dealing", "reason": "natural reply"},
            "970595",   # He's had many unhappy experiences.
            "5852522",  # I'm unpopular.
            "291938",   # He is unpopular for some reason.
        ],

        # ===========================================================
        # === Romance / dating drama (loosened) ===
        # ===========================================================
        [
            "3737777",  # Is that your ex-wife?
            "4011651",  # You really do hate your ex-wife…
            "1970236",  # I'm getting back together with my ex-girlfriend.
            "2045887",  # You're not as beautiful as my ex-girlfriend…
            "2033982",  # I don't want to hear about all your ex-girlfriends.
            "2033896",  # I don't want to hear about all your ex-boyfriends.
            "954688",   # Long: dating your best friend's ex-boyfriend
        ],

        # ===========================================================
        # === Recognition / familiar ===
        # ===========================================================
        [
            "3738926",  # Do you recognize any of this jewelry?
            {"text": "No, none of it.", "added_for": "none", "reason": "natural N answer"},
        ],

        # ===========================================================
        # === Firmly / abruptly / silent ===
        # ===========================================================
        [
            "4970637",  # I'm firmly opposed to this.
            "313556",   # She pressed her lips firmly together.
            "290081",   # He held on firmly to the branch.
            "2250932",  # That was abrupt.
            "4502346",  # The noise abruptly stopped.
        ],

        # ===========================================================
        # === Loud / noise / thunder ===
        # ===========================================================
        [
            "325170",   # The thunder became louder.
            "274310",   # I could hear someone calling my name on the noisy platform.
            "25840",    # I heard it thunder in the distance.
            "27162",    # Lightning is usually followed by thunder.
            "2721283",  # I was woken up by the sound of thunder this morning.
            "27163",    # Lightning can be dangerous.
            "279160",   # I ran like lightning.
            "1076317",  # Lightning hit that tower.
            "3479224",  # No one can predict where lightning will strike.
        ],

        # ===========================================================
        # === Interrupt / talking ===
        # ===========================================================
        [
            "2315187",  # I don't appreciate being interrupted.
            "5360750",  # No one interrupted the speaker.
            "257363",   # I had hardly opened my mouth, when she interrupted me.
            "321366",   # Don't interrupt our conversation.
            "247146",   # Don't interrupt me while I'm speaking.
            "269881",   # Don't interrupt people when they're talking.
        ],

        # ===========================================================
        # === Paragraph / meaning ===
        # ===========================================================
        [
            "954536",   # What does this paragraph mean?
            "1064471",  # Can you understand the meaning of this paragraph?
            "73441",    # Please refer to paragraph ten.
        ],

        # ===========================================================
        # === Cheating ===
        # ===========================================================
        [
            "2169713",  # That's cheating.
            "2203616",  # You're cheating.
            "2111377",  # They cheat.
            "2111917",  # Don't cheat.
            "953292",   # Have you ever cheated on an exam?
            {"text": "Never — too risky.", "added_for": "risky", "reason": "natural answer"},
            "3732461",  # I felt lied to and cheated.
        ],

        # ===========================================================
        # === Cruel / unfair / tragedy ===
        # ===========================================================
        [
            "2111454",  # That's cruel.
            "41370",    # I never thought he was capable of doing something so cruel.
            "2257422",  # That's totally unfair.
            "2262859",  # It was a terrible tragedy.
            "4494095",  # This is a horrible tragedy.
            "2111811",  # How tragic!
            "2248889",  # It was tragic.
            "3129918",  # Tragedies happen every day.
        ],

        # ===========================================================
        # === Diving / swim ===
        # ===========================================================
        [
            "4350845",  # Do you know how to dive?
            {"text": "I'm out of practice.", "added_for": "practice", "reason": "natural hedge"},
            "4497358",  # We were both afraid to jump off the diving board.
            "3431004",  # The divers are running out of air.
            "4879913",  # All the divers already had their wet suits on.
        ],

        # ===========================================================
        # === Boats / ferry ===
        # ===========================================================
        [
            "3824709",  # I'll come by ferry.
            "2819375",  # I'm waiting for the ferry.
        ],

        # ===========================================================
        # === Abandon / abandoned ===
        # ===========================================================
        [
            "3097076",  # This farm seems to have been abandoned.
            "256508",   # I have abandoned the idea of buying a house.
            "22944",    # We abandoned the project because of a lack of funds.
            "5745839",  # There was no other choice but to abandon the entire project.
            "690265",   # We were obliged to abandon our plan.
            "255842",   # I was forced to abandon the plan.
            "1963044",  # We must abandon ship.
            "307177",   # They abandoned the sinking ship.
            "302402",   # He hid in an abandoned building.
        ],

        # ===========================================================
        # === Tunnel / hidden ===
        # ===========================================================
        [
            "2095464",  # There's somebody in the tunnel.
            "2275235",  # Don't go through this tunnel.
        ],

        # ===========================================================
        # === Tent / camping (drill broken) ===
        # ===========================================================
        [
            "248214",   # We slept in a tent.
            "1852544",  # Let's pitch the tent while it's still light.
            "2307991",  # I chose a place to pitch my tent.
            "4323823",  # They pitched their tent on the beach.
            "4496279",  # Our tent was the only one in the camping area.
        ],
        [
            "1293081",  # Exercise outdoors.
            "4501881",  # Everyone rushed outdoors.
            "22024",    # He is playing outdoors.
            "4499509",  # I loved being outdoors when I was younger.
            "1844209",  # Keep the kids indoors.
            "2724222",  # Do you wear shoes indoors?
            {"text": "Yes, in winter.", "added_for": "winter", "reason": "natural answer"},
            "5360714",  # I prefer spending time indoors.
            "281863",   # I usually stay indoors on Sunday.
            "26991",    # It was raining hard, so we played indoors.
            "1540876",  # When I was a child, I spent most of my time indoors reading.
            "6452087",  # Children like outdoor activities.
        ],

        # ===========================================================
        # === Quarrel / argue ===
        # ===========================================================
        [
            "2959257",  # Let's not quarrel about this.
            "2953648",  # We have no quarrel with you.
            "4529456",  # My parents are constantly arguing.
        ],

        # ===========================================================
        # === Bald / hair ===
        # ===========================================================
        [
            "5858129",  # I have a bald spot.
            "4717964",  # If you worry too much, you'll go bald.
            "3172161",  # I didn't start to go bald until I turned thirty.
            "318941",   # My father was completely bald by the time he was forty.
            "1096135",  # Mary has hair down to her waist.
        ],

        # ===========================================================
        # === Humid / climate ===
        # ===========================================================
        [
            "3002981",  # The humidity is quite high.
            "4494723",  # The humidity is down.
            "3002979",  # It's quite humid.
            "306239",   # They are used to the humid climate of the summer.
        ],

        # ===========================================================
        # === Ice / melting ===
        # ===========================================================
        [
            "415449",   # The ice melted.
            "275079",   # The sun melted the snow.
            "318313",   # The ice is melting.
            "4501023",  # The snow is melting.
            "318315",   # When ice melts, it becomes liquid.
            "2270474",  # Don't let your ice cream melt.
            "5852973",  # I was hoping the ice cream wouldn't melt so quickly.
        ],

        # ===========================================================
        # === Spill ===
        # ===========================================================
        [
            "2280315",  # I spilled my wine.
            "3822436",  # I accidentally spilled the milk.
            "3008334",  # I nearly spilled my coffee on the keyboard.
            "2271338",  # Don't spill the soup.
            "3372935",  # Be careful not to spill your beer.
        ],

        # ===========================================================
        # === Fence / paint / lean ===
        # ===========================================================
        [
            "2544623",  # The fence needed painting.
            "5858890",  # I fixed the fence.
            "306007",   # They painted the fence green.
            "287303",   # His horse jumped over the fence.
            "2331768",  # I had to climb over the fence.
            "5904847",  # I still have to finish painting the fence.
            "316147",   # She was too short to see over the fence.
            "3732753",  # I climbed the fence.
            "1065399",  # He stood leaning against the fence.
            "44770",    # The tower leaned slightly to the left.
        ],

        # ===========================================================
        # === Antique / treasure ===
        # ===========================================================
        [
            "5586245",  # It looks like an antique.
            "316619",   # She has some beautiful antique furniture.
            "1442232",  # She loves antiques.
            "5860814",  # I collect antiques.
            "2361952",  # I've always liked antiques.
            "296454",   # He has an eye for antiques.
            "3001588",  # I didn't know you were interested in antiques.
            {"text": "I've been collecting for years.", "added_for": "collecting", "reason": "natural reply"},
            "22660",    # We were looking for buried treasure.
        ],

        # ===========================================================
        # === Jewelry ===
        # ===========================================================
        [
            "463130",   # These jewels are expensive.
            "3448896",  # What kind of jewel is this?
            "4502853",  # Mary wears expensive jewelry.
            "238242",   # The police recovered the stolen jewelry.
        ],

        # ===========================================================
        # === Odds / luck ===
        # ===========================================================
        [
            "2377495",  # I like those odds.
            "953313",   # He beat the odds and was successful.
            "4501537",  # Prevention is the key.
        ],

        # ===========================================================
        # === Calendar / dates ===
        # ===========================================================
        [
            "3422088",  # Check the calendar.
            "2387080",  # I marked your birthday on my calendar.
            "3482793",  # There's a calendar hanging on the wall.
            "6003763",  # I have that date circled on my calendar.
            "274537",   # The graduation ceremony will take place on March 20th.
        ],

        # ===========================================================
        # === Tools / pile / desk ===
        # ===========================================================
        [
            "3410969",  # This one was on top of the pile.
            "3315197",  # There's a big pile of mail on your desk.
            "50009",    # The bags were piled up behind him.
            "534646",   # The bills keep piling up.
        ],

        # ===========================================================
        # === Battery / charger / plug ===
        # ===========================================================
        [
            "2249832",  # Pull the plug.
            "3724131",  # I'm pulling the plug.
            "2545844",  # The TV isn't plugged in.
            "4551200",  # The radio was plugged in.
            "4323632",  # Your battery power is low.
            "21181",    # I'm looking for batteries.
            "279226",   # Do you sell batteries?
            "2821457",  # Batteries are not included.
            "4494123",  # No batteries are necessary.
            "4496890",  # These batteries contain lead.
            "480055",   # You need to pay extra for the batteries.
            "954106",   # It's unlikely that replacing the battery will fix the problem.
        ],

        # ===========================================================
        # === Jar / kitchen / lid ===
        # ===========================================================
        [
            "5491234",  # Hand me that jar.
            "4824059",  # There's a label on the jar.
            "25757",    # I wanted some salt, but there was none in the jar.
            "270923",   # Fill the jars with water.
            "5851678",  # I shut the lid.
            "5858768",  # I lifted the lid.
        ],

        # ===========================================================
        # === Drinks ===
        # ===========================================================
        [
            "1009212",  # I prefer mineral water.
            "253123",   # I always carry a bottle of mineral water with me.
            "258477",   # I don't drink alcohol.
            "3825050",  # Alcohol is a drug.
            "2718460",  # Don't mix energy drinks with alcohol.
            "266123",   # Don't drive under the influence of alcohol.
        ],

        # ===========================================================
        # === Thirst / hunger ===
        # ===========================================================
        [
            "2544663",  # I'm suddenly very thirsty.
            "5067963",  # I'm not thirsty at the moment.
            "2540297",  # I didn't realize how thirsty I was.
            {"text": "Have some water then.", "added_for": "water", "reason": "natural offering reply"},
        ],

        # ===========================================================
        # === Writing / resolution / diary ===
        # ===========================================================
        [
            "310449",   # She is constantly writing letters.
            "1318626",  # He made a resolution to write in his diary every day.
            "25066",    # Did you make any New Year's resolutions?
            "3264777",  # That's one of my New Year's resolutions.
        ],

        # ===========================================================
        # === Vase ===
        # ===========================================================
        [
            "2254599",  # I bought a glass vase.
            "23696",    # I filled a vase with water.
            "255957",   # I broke the vase on purpose.
            "1439863",  # My mother put a large vase on the shelf.
        ],

        # ===========================================================
        # === Sketch / draw ===
        # ===========================================================
        [
            "4502178",  # The police have a sketch of the suspect.
            "292019",   # He begins to sketch no matter where he is.
            "3532131",  # Show me your sketches.
            "3820791",  # Let me see your sketches.
        ],

        # ===========================================================
        # === Suspect / mystery / disappear / spy ===
        # ===========================================================
        [
            "2096",     # He disappeared without a trace.
            "4945644",  # The ship disappeared without a trace.
            "311015",   # She was suspected of being a spy.
            "50295",    # The spy burned the papers.
            "247493",   # He believes that there is a spy among us.
            "2111241",  # They're spies.
            "1838809",  # Are you spying on me?
            "3822673",  # Someone's spying on me.
        ],

        # ===========================================================
        # === Forbidden / banned ===
        # ===========================================================
        [
            "4498747",  # This is strictly forbidden.
            "3831119",  # Weapons are forbidden here.
            "4915729",  # I forbid that.
            "1346632",  # I forbid you to leave.
            "680336",   # Hunting is banned in national parks.
            {"text": "That's a relief to hear.", "added_for": "hear", "reason": "natural reply"},
        ],

        # ===========================================================
        # === Realization / overlook ===
        # ===========================================================
        [
            "3096405",  # When did you come to this realization?
            "2275446",  # These kinds of mistakes are easy to overlook.
            "2063000",  # Perhaps we overlooked something.
            "5137598",  # Maybe we're overlooking the obvious.
        ],

        # ===========================================================
        # === Minimum / bare ===
        # ===========================================================
        [
            "1414970",  # That's the bare minimum.
            "2304399",  # I only did the bare minimum.
            "2943029",  # Everyone working for us earns more than the minimum wage.
        ],

        # ===========================================================
        # === Adapt / adopt ===
        # ===========================================================
        [
            "291262",   # He adapted the story for children.
            "299911",   # He adapted himself to his new life.
            "305850",   # They adapted themselves to the change quickly.
        ],

        # ===========================================================
        # === Hold accountable / blame ===
        # ===========================================================
        [
            "3360506",  # You will be held accountable.
            "250883",   # I am not accountable to you for my actions.
            "4529914",  # Stop acting like a victim.
        ],

        # ===========================================================
        # === Notion / abstract ===
        # ===========================================================
        [
            "4494159",  # This notion is ridiculous.
            "43489",    # The theory is too abstract for me.
            "285480",   # His idea is too abstract to be of practical use to us.
            "3826973",  # It doesn't seem so absurd.
        ],

        # ===========================================================
        # === Quotation / price ===
        # ===========================================================
        [
            "238860",   # We need a firm quotation by Monday.
            "57128",    # What is the price of this cap?
            {"text": "Ten dollars.", "added_for": "ten", "reason": "natural price answer"},
            "57135",    # I paid ten dollars for this cap.
        ],

        # ===========================================================
        # === Cap / hat ===
        # ===========================================================
        [
            "37929",    # Which cap is yours?
            "57131",    # Does this cap belong to you?
            "3825904",  # I have several caps.
            "671199",   # How many caps do you own?
            "3170523",  # Where's my lucky blue cap?
            "47438",    # The boy adjusted his cap.
            "22606",    # Bite the bullet.
        ],

        # ===========================================================
        # === Gloves / scarf / wear ===
        # ===========================================================
        [
            "3129196",  # I forgot my scarf.
            "2953199",  # Mary had a black scarf around her neck.
            "5852852",  # I wore gloves.
            "2540706",  # I bought a pair of leather gloves.
            "2537868",  # These gloves should keep my hands warm enough.
            "66485",    # I found a pair of gloves under the chair.
            "5913928",  # Even though I was wearing gloves, my fingers were cold.
            "5909975",  # Why do you have only one glove on?
            {"text": "I lost the other one.", "added_for": "lost", "reason": "natural reply"},
            "5850904",  # Mary was wearing a fur coat.
        ],

        # ===========================================================
        # === Shirt / stain / cloth ===
        # ===========================================================
        [
            "3820625",  # Your shirt is stained.
            "3170527",  # What's this purple stain?
            "65759",    # The ink stain will not wash out.
            "4496097",  # How can I remove blood stains from a shirt?
            "515667",   # There were some ink stains on the cover of that book.
            "57392",    # This cloth tears easily.
            "57400",    # This cloth feels smooth.
            "2427847",  # I bought various pieces of cloth.
            "322345",   # My sister bought five yards of cloth.
            "35850",    # Clean the window with a damp cloth.
        ],

        # ===========================================================
        # === Towel / bath ===
        # ===========================================================
        [
            "35407",    # There's only one bath towel in our bathroom.
            "2541738",  # This house has three bathrooms.
        ],

        # ===========================================================
        # === Clothes / necessities ===
        # ===========================================================
        [
            "324844",   # I don't earn enough money to buy clothes regularly.
            {"text": "Times are tough for everyone.", "added_for": "tough", "reason": "empathetic reply"},
            "28144",    # Food and clothes are necessities of life.
            "245939",   # Children depend on their parents for food, clothing and shelter.
            "903707",   # There is an urgent need for shelter.
        ],

        # ===========================================================
        # === Supervisor / supervision ===
        # ===========================================================
        [
            "3820451",  # Who's your supervisor?
            "3831376",  # Your supervisor will be quite pleased.
            "2547460",  # You need supervision.
            "4501091",  # The children need adult supervision.
        ],

        # ===========================================================
        # === Supportive / restless ===
        # ===========================================================
        [
            "2111952",  # Be supportive.
            "2543454",  # I'm trying to be supportive.
            "2111688",  # I'm restless.
            "4915644",  # The natives are getting restless.
        ],

        # ===========================================================
        # === Greeting ===
        # ===========================================================
        [
            "247848",   # We exchanged greetings.
            "305455",   # They exchanged greetings.
            "311897",   # She greeted us with a smile.
            "2660328",  # The girls greeted us warmly.
            "2951643",  # Do you always greet people that way?
        ],

        # ===========================================================
        # === Lungs / smoke ===
        # ===========================================================
        [
            "32126",    # Everybody sang at the top of their lungs.
            "19951",    # Smoking does damage your lungs.
            "1453417",  # Mary started screaming at the top of her lungs.
            "297009",   # He died from lack of oxygen.
            "680482",   # We don't know what causes cancer.
            "250247",   # My uncle died of cancer.
        ],

        # ===========================================================
        # === Ruined / wrong / mistake ===
        # ===========================================================
        [
            "2111844",  # Everything's ruined.
            "3231259",  # You're ruining my whole plan.
            "2955007",  # You're ruining everything.
            "3231251",  # Your boots are ruined.
            "3231252",  # It's obviously ruined.
            "2954692",  # You ruined my birthday party.
            "3231253",  # It'll ruin everything.
            "3203859",  # Telling you now would ruin the surprise.
            "2835728",  # Something's terribly wrong.
        ],

        # ===========================================================
        # === Signature / signing ===
        # ===========================================================
        [
            "2245218",  # Compare the signatures.
            "2032275",  # This letter has no signature.
            "4496903",  # There was no signature on the contract.
            "3618796",  # Please sign on the dotted line.
            "2622012",  # What are those little dots?
            {"text": "Where you sign.", "added_for": "sign", "reason": "natural answer"},
        ],

        # ===========================================================
        # === Collapse / bridge ===
        # ===========================================================
        [
            "2891585",  # It's going to collapse.
            "2451873",  # The bridge collapsed.
            "5682242",  # The roof collapsed under the weight of the snow.
        ],

        # ===========================================================
        # === Dispute / settled ===
        # ===========================================================
        [
            "4494458",  # This is beyond dispute.
            "326493",   # The dispute was finally settled.
            {"text": "I'm glad that's behind us.", "added_for": "behind", "reason": "natural closure"},
        ],

        # ===========================================================
        # === Q/A — directions / ports ===
        # ===========================================================
        [
            "240943",   # Could you tell me the way to the port?
            {"text": "Take a left at the next light.", "added_for": "left", "reason": "natural directions answer"},
        ],

        # ===========================================================
        # === Rope ===
        # ===========================================================
        [
            "2245530",  # Grab the rope.
            "29440",    # Hold the rope.
            "5858306",  # I pulled the rope.
            "3283019",  # This rope is very weak.
            "795246",   # My daughter loves jumping rope.
            "4384262",  # Do you think this rope is strong enough?
            {"text": "Strong enough for what?", "added_for": "enough", "reason": "natural follow-up Q"},
            "5938442",  # I slid down the rope.
            "2026401",  # I want a jump rope with wooden handles.
            "1970398",  # I only have fifty meters of rope.
            "2402190",  # Whatever you do, don't pull this rope.
            "321305",   # Don't let go of the rope till I tell you.
            "298297",   # He cut the rope with his teeth.
            "5485089",  # I'll show you the ropes.
        ],

        # ===========================================================
        # === Castle / ruins ===
        # ===========================================================
        [
            "3231256",  # ruins / castle
            "46221",    # castle context
        ],

        # ===========================================================
        # === Pitcher / baseball ===
        # ===========================================================
        [
            "5858753",  # I was the pitcher.
            "2890346",  # I dropped the pitcher and it broke.
        ],

        # ===========================================================
        # === Common / occurrence ===
        # ===========================================================
        [
            "2248497",  # Is that uncommon?
            "5090011",  # This is a common occurrence.
            "54661",    # This is a daily occurrence.
        ],

        # ===========================================================
        # === Communication ===
        # ===========================================================
        [
            "3310043",  # We've been communicating regularly.
            "20215",    # I believe in exercising regularly.
        ],

        # ===========================================================
        # === Distance / farther ===
        # ===========================================================
        [
            "1804089",  # How much farther is it?
            {"text": "Just a few more blocks.", "added_for": "blocks", "reason": "natural answer"},
            "31628",    # I can't walk any farther.
            "288244",   # He is used to walking long distances.
        ],

        # ===========================================================
        # === Peacefully / demonstrate ===
        # ===========================================================
        [
            "2245210",  # Come out peacefully.
            "4853355",  # We demonstrated peacefully.
        ],

        # ===========================================================
        # === Intentional / confusion ===
        # ===========================================================
        [
            "3671647",  # Are you intentionally trying to confuse me?
            "2248919",  # It wasn't intentional.
            "5398612",  # Was that intentional?
            "5494876",  # Did you do that intentionally?
            {"text": "No, it just happened.", "added_for": "happened", "reason": "natural N answer"},
        ],

        # ===========================================================
        # === Benefits ===
        # ===========================================================
        [
            "4496062",  # Who benefited from that?
            "4496066",  # We benefited from that.
        ],

        # ===========================================================
        # === Freezer / fridge ===
        # ===========================================================
        [
            "2646632",  # Do you have a freezer?
            "3830666",  # Is your freezer still working?
        ],

        # ===========================================================
        # === Costume ===
        # ===========================================================
        [
            "3831475",  # Your costume is very impressive.
            {"text": "I made it myself.", "added_for": "myself", "reason": "natural reply to compliment"},
        ],

        # ===========================================================
        # === Slept / waking / nap ===
        # ===========================================================
        [
            "304169",   # He woke up to find himself lying on a bench in the park.
            "2648759",  # Sit on the bench.
            "501258",   # She sat on the bench.
            "40473",    # Someone has left a bag on the bench.
            "33809",    # The two men sitting on the bench were Americans.
            "323790",   # Lie on the bench for a while with your eyes closed.
            "378038",   # Where is the nearest bench?
            "2811828",  # The park benches were all occupied.
        ],

        # ===========================================================
        # === Clinic / hospital ===
        # ===========================================================
        [
            "2643418",  # You're needed in the clinic.
            {"text": "On my way.", "added_for": "way", "reason": "natural reply"},
            "807594",   # Not far from the house was a military hospital.
        ],

        # ===========================================================
        # === Beyond / comprehension ===
        # ===========================================================
        [
            "249828",   # It's beyond my comprehension.
        ],

        # ===========================================================
        # === Formal introduction ===
        # ===========================================================
        [
            "5137590",  # We haven't been formally introduced.
            {"text": "Allow me to introduce myself.", "added_for": "allow", "reason": "natural follow-up"},
        ],

        # ===========================================================
        # === Thoughtful / appreciation ===
        # ===========================================================
        [
            "2111396",  # That's thoughtful.
            "2021169",  # That's very thoughtful.
            {"text": "I'm glad you noticed.", "added_for": "noticed", "reason": "warm reply"},
        ],

        # ===========================================================
        # === Sticky / tape ===
        # ===========================================================
        [
            "4502165",  # It was a sticky situation indeed.
            "735354",   # This tape isn't sticky.
        ],

        # ===========================================================
        # === Crime / police (mild kept) ===
        # ===========================================================
        [
            "2953362",  # The police believe the victim knew his killer.
            "317888",   # The defendant was sentenced to death.
            "2958862",  # Who represents the defendant?
            "2452033",  # The defendant was granted an appeal.
            "4664322",  # Neither defendant was found guilty.
            "4664627",  # Nobody has been formally charged.
        ],

        # ===========================================================
        # === Bomb / kidnap (moderate kept) ===
        # ===========================================================
        [
            "4016920",  # There could be another bomb.
            "3171852",  # Someone planted a bomb under your car.
            "3723111",  # There was a bomb scare.
            "4662961",  # The person who planted the bomb hasn't been caught.
            "4663038",  # The bomb is quite likely somewhere on this floor.
            "1114162",  # They kidnapped me.
            "2241495",  # We were kidnapped.
        ],

        # ===========================================================
        # === Bullets / violence (some kept) ===
        # ===========================================================
        [
            "3594051",  # That bullet was meant for me.
            "2323047",  # I don't see any bullet holes anywhere.
            "3823431",  # This bucket has a bullet hole in it.
            "2547482",  # We're out of bullets.
            "3597385",  # There are no more bullets.
        ],

        # ===========================================================
        # === Captain / mission (kept some, military narrative is OK) ===
        # ===========================================================
        [
            "2245512",  # Get the captain.
            "299172",   # He was chosen captain.
            "275379",   # The captain ordered his men to gather at once.
            "273507",   # The captain is responsible for the safety of passengers.
            "2377285",  # I led that mission.
            "4502142",  # The mission was simple.
            "2542421",  # I'm in charge of this mission.
            "5507202",  # We're on a rescue mission.
            "2042703",  # I didn't want to go on this mission, but I was ordered to.
            "4499004",  # The mission went perfectly.
            "2018751",  # Do you want this mission to succeed?
            "2293266",  # I assume your mission was a success.
            "2549631",  # Pack your gear.
            "2245531",  # Grab your gear.
        ],

        # ===========================================================
        # === Self-defense (kept) ===
        # ===========================================================
        [
            "2060309",  # You should learn self-defense.
            "3723712",  # I was defending myself.
            "5859503",  # I defended myself.
        ],

        # ===========================================================
        # === Floods / disasters (kept some) ===
        # ===========================================================
        [
            "275571",   # The heavy rains caused the river to flood.
            "4666711",  # What caused the floods?
            "266925",   # Every spring the river floods here.
            "1966512",  # The streets are flooded.
            "4529915",  # Several roads are flooded.
            "41043",    # A lot of houses were washed away by the flood.
            "681346",   # The flood water reached the level of the windows.
        ],

        # ===========================================================
        # === Floating / cloud / river ===
        # ===========================================================
        [
            "33685",    # A ball is floating down the river.
            "73029",    # A fallen leaf floated on the surface of the water.
            "26527",    # A cloud floated across the sky.
            "324266",   # Oil will float on water.
            "5838278",  # How much oil is spilled into the ocean every year?
            "6003731",  # Fortunately, we've never had an oil spill.
        ],

        # ===========================================================
        # === Voting (kept, country-agnostic) ===
        # ===========================================================
        [
            "5069027",  # Are you planning on voting?
            "687716",   # Who are the voting members?
            "279685",   # We'll decide by voting.
            "804329",   # Almost sixty-nine million people voted.
            "4529507",  # I don't trust the administration.
            "4529512",  # Give the administration a chance.
            "807495",   # Congress approved the resolution in October.
            "326069",   # The Cold War ended when the Soviet Union collapsed.
        ],

        # ===========================================================
        # === Conservative / political labels ===
        # ===========================================================
        [
            "2202680",  # We're conservative.
            "2202681",  # You're conservative.
        ],

        # ===========================================================
        # === Proverbs / idioms (kept the common ones) ===
        # ===========================================================
        [
            "1655912",  # Life's unfair.
            "2047303",  # Better the devil you know than the devil you don't.
            "28533",    # Speak of the devil and he is sure to appear.
            "19549",    # Necessity is the mother of invention.
            "22559",    # Absence makes the heart grow fonder.
            "1215228",  # Don't bury your head in the sand.
            "4828351",  # We can't bury our heads in the sand.
            "4496175",  # Violence breeds more violence.
        ],

        # ===========================================================
        # === Violence as abstract noun (kept some) ===
        # ===========================================================
        [
            "807110",   # The violence lasted three days.
            "5082697",  # Many parents think there's too much violence on television.
            "4526784",  # I can't stand violence.
            "1176018",  # We dislike violence.
        ],

        # ===========================================================
        # === Champagne / fur (kept) ===
        # ===========================================================
        [
            "4499043" if False else "4663186" if False else "1396358",  # It'd be better if you didn't associate with men like that.
            "1396359",  # You shouldn't associate with men like that.
        ],

        # ===========================================================
        # === Year / historic events (kept) ===
        # ===========================================================
        [
            "479130",   # In 1958, Brazil won its first World Cup victory.
            "73284",    # In 1955, the cancer returned and she died in 1956…
            "5096627",  # There were no prior warnings.
            "42403",    # It happened prior to my arrival.
            "5364114",  # No prior experience is required.
            "2358786",  # I have a prior engagement.
        ],

        # ===========================================================
        # === Geography (kept some) ===
        # ===========================================================
        [
            "5119487",  # Amsterdam is famous for its canals.
            "273426",   # The ship went through the Panama Canal.
            "35122",    # The Panama Canal connects the Atlantic with the Pacific.
        ],

        # ===========================================================
        # === Temperature / weather ===
        # ===========================================================
        [
            "680358",   # It's thirty degrees below zero.
            "2655081",  # Last night, the temperature went down to ten degrees below zero.
        ],

        # ===========================================================
        # === Wolves / hunting / nature (single-floor cluster) ===
        # ===========================================================
        [
            "2549771",  # Is it a wolf?
            "2323137",  # I don't think it's a wolf.
        ],

        # ===========================================================
        # === Boxer / niche role (kept) ===
        # ===========================================================
        [
            "5828970",  # I'm a boxer.
            "5859834",  # I used to be a good boxer.
            "2760928",  # I'm tone-deaf.
        ],

        # ===========================================================
        # === Pizza / niche food (kept) ===
        # ===========================================================
        [
            "4496656",  # Pizza and beer aren't a bad combination.
            "58872",    # This car runs on alcohol.
        ],

        # ===========================================================
        # === Wedding bride extra (kept) ===
        # ===========================================================
        [
            "312912",   # She is dressed like a bride.
        ],

        # ===========================================================
        # === Speech / boys (kept) ===
        # ===========================================================
        [
            "887168",   # She greets him every morning as he enters the school building.
            "287905",   # His speech inspired all the boys.
        ],

        # ===========================================================
        # === Monsters (kept lightly) ===
        # ===========================================================
        [
            "2549180",  # You're a monster.
            "4493962",  # There are monsters everywhere.
            "2888853",  # Every monster starts off as someone's baby.
        ],

        # ===========================================================
        # === Tragedy of common (lifespan factoid) ===
        # ===========================================================
        [
            "915345",   # It's not all that uncommon for people to live past the age of ninety.
        ],

        # ===========================================================
        # === Burden / shame ===
        # ===========================================================
        [
            "251995",   # I don't want to burden you with my troubles.
            "2013504",  # I didn't want to be a burden.
        ],

        # ===========================================================
        # === Misc closing — readily / agreement ===
        # ===========================================================
        [
            "2208665" if False else "2376334",  # noop / closing
        ],
    ],
}
