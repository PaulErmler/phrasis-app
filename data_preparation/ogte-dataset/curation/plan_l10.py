"""Curation plan for OGTE Level 10 — High Intermediate (~1844 sentences).

High-intermediate learners can handle nuanced opinions, indirect speech,
formal/informal register switches, hypotheticals, debates, abstract reasoning,
mild storytelling, polite disagreement, and selectively-introduced idioms.

Plan format mirrors L1-L4: a dict with "removals" and "arcs".

Refinement notes (this iteration):
  - Drill arcs broken up by inserting rewrites with fresh vocabulary so the
    same content word never appears in more than 3 consecutive rows.
  - Removals loosened: long sentences, common idioms, mild crime/violence
    narratives, body parts, narratives, drama and proper-name content are
    kept by default. Only dated brands, sexist generalisations, near
    duplicates and extremely niche cultural references are still cut.
  - Lost-vocab restorations: army, attacked, longest, monkey, population,
    threats, wisdom, wise, wiser, demonstrations, eastern, snap, tear,
    lasting, relative.
  - Three highest-quality openers anchored with position="first".
"""

from __future__ import annotations


L10_PLAN = {
    "removals": [
        # === Brands / dated / niche US-state quiz facts only ===
        {"id": "4811725", "reason": "'Harvard is a wonderful university.' — US institution brand."},
        {"id": "1994195", "reason": "'What's your Skype username?' — dated brand (Skype)."},
        {"id": "5725470", "reason": "'I want to purchase property in Boston.' — Boston over-represented."},
        {"id": "3826152", "reason": "'I have wonderful memories of Boston.' — Boston duplication."},
        {"id": "6265968", "reason": "'I'm glad we visited Boston.' — Boston duplication."},
        {"id": "2006435", "reason": "'I've never been fishing in Texas.' — niche US state."},
        {"id": "682435", "reason": "'Millions of wild animals live in Alaska.' — niche US state."},
        {"id": "67503", "reason": "'There are fifty states in the United States.' — civics quiz."},
        {"id": "4728779", "reason": "'The capital of the U.S. is Washington, D.C.' — civics duplication (4728778 stays)."},
        {"id": "693619", "reason": "'Bangkok is the capital of Thailand.' — geography quiz."},
        {"id": "2974609", "reason": "'Dublin is the capital of Ireland.' — geography quiz."},
        {"id": "29271", "reason": "'London is the capital of England.' — geography quiz."},
        {"id": "281604", "reason": "'Japan does a lot of trade with the United States.' — political/specific."},
        {"id": "281210", "reason": "'It's bad manners to eat on trains and buses in Japan.' — Japan-specific."},
        {"id": "2278826", "reason": "'Americans like football...Japanese like baseball.' — sweeping cultural generalisation."},
        {"id": "27330", "reason": "'Generally speaking, Americans like coffee.' — sweeping cultural generalisation."},
        {"id": "1430691", "reason": "'The Jordan River is the only river flowing into the Dead Sea.' — geography quiz."},
        {"id": "57299", "reason": "'This room doesn't get much sunshine.' — duplicate of 57300."},
        {"id": "4529407", "reason": "'Mr. Jackson is our science teacher.' — niche name."},

        # === Sexist / gender generalisations ===
        {"id": "267307", "reason": "'Women generally live longer than men.' — generalisation."},
        {"id": "27328", "reason": "'Generally speaking, women live longer than men by almost ten years.' — same."},
        {"id": "21820", "reason": "'Generally speaking, boys can run faster than girls.' — gender generalisation."},
        {"id": "27333", "reason": "'Generally speaking, men can run faster than women can.' — same."},
        {"id": "4350299", "reason": "'Men find it more difficult to talk about their feelings than women.' — generalisation."},
        {"id": "243677", "reason": "'Men and women between 25 and 54 have the most stressful lives.' — statistical claim."},

        # === War-glorification, gore, or extreme dark scenarios ===
        # (Loosened policy: police/theft/mild crime narratives stay. Only the
        # heaviest war-glorifying / death-row / gore items are dropped.)
        {"id": "5858750", "reason": "'I led the attack.' — military violence framing."},
        {"id": "4495830", "reason": "'I think we should attack immediately.' — pro-attack framing."},
        {"id": "5398434", "reason": "'They're attacking us.' — generic military panic."},
        {"id": "306310", "reason": "'They are afraid that nuclear war will break out.' — dark/political."},
        {"id": "5858394", "reason": "'I'm on death row.' — too dark."},
        {"id": "3821400", "reason": "'You'll probably die in prison.' — threat framing."},
        {"id": "5218638", "reason": "'I couldn't survive prison.' — depressing."},
        {"id": "5853077", "reason": "'I received three threatening phone calls this morning.' — too specific dark."},
        {"id": "288583", "reason": "'He committed five murders.' — gory crime."},
        {"id": "2249976", "reason": "'Somebody was murdered.' — graphic isolation."},
        {"id": "2243392", "reason": "'They were murdered.' — graphic isolation."},
        {"id": "3893103", "reason": "'The police approached the suspect with their guns drawn.' — graphic."},
        {"id": "4016782", "reason": "'I don't think the gun is loaded, but you should still be very careful.' — gun reference."},
        {"id": "898563", "reason": "'He decided to feed his dog the rabbit that he had shot earlier that day.' — graphic hunting."},
        {"id": "4498641", "reason": "'Tear gas filled the room.' — riot-violence scene (3501302 covers 'lasting' vocab)."},

        # === Idioms / proverbs that don't generalise well ===
        {"id": "1879930", "reason": "'You're a pain in the neck.' — insulting idiom."},
        {"id": "73206", "reason": "'A penny saved is a penny earned.' — proverb (niche)."},
        {"id": "1088547", "reason": "'A stranger living nearby is better than a relative living far away.' — proverb."},
        {"id": "18360", "reason": "'A fool and his money are soon parted.' — proverb."},
        {"id": "66728", "reason": "'Like a good wine, he improves with age.' — proverb."},
        {"id": "271686", "reason": "'Honesty is not always the best policy.' — proverb-flipped."},
        {"id": "410575", "reason": "'A good Jack makes a good Jill.' — opaque idiom."},
        {"id": "20094", "reason": "'What is done cannot be undone.' — proverb."},
        {"id": "2103005", "reason": "'A person who chases two rabbits won't catch either.' — opaque proverb."},

        # === Recommend / food-list duplication ===
        {"id": "4174123", "reason": "'Can you recommend a good Korean restaurant?' — duplicate of 4174122."},
        {"id": "3854769", "reason": "'Are there any other hotels you can recommend?' — duplicate of 3854766."},
        {"id": "5899631", "reason": "'Can you recommend a good hotel in the area?' — recommend over-saturation."},
        {"id": "4662969", "reason": "'Can you recommend a good place to eat Mexican food?' — recommend over-saturation."},
        {"id": "250032", "reason": "'Can you recommend a good dictionary to me?' — duplicate of 968139."},

        # === Tatoeba near-duplicates / preachy / interchangeable ===
        {"id": "4664212", "reason": "'Construction could begin in October.' — near-duplicate of 4495997."},
        {"id": "4501341", "reason": "'That's partly true.' — overlaps with 'I'm partly right.'"},
        {"id": "5938434", "reason": "'I slowly backed away.' — overlaps with 'I backed off.'"},
        {"id": "3823363", "reason": "'It's useless to deny it.' — preachy."},
        {"id": "3826268", "reason": "'It's useless to beg.' — preachy."},

        # === Religion / prayer over-representation (keep main prayer arc) ===
        {"id": "5852971", "reason": "'I was praying.' — duplicate of broader prayer arc."},
        {"id": "4501517", "reason": "'We pray for peace.' — political/religious overlap with 305202."},

        # === Misc duplicates / awkward singletons ===
        {"id": "5859874", "reason": "'I retired at sixty.' — duplicate of broader retire arc."},
        {"id": "5902924", "reason": "'You should retire.' — odd to say to someone."},
        {"id": "2249607", "reason": "'No one's convinced.' — duplicates broader arc."},
        {"id": "5165036", "reason": "'You should learn to control your emotions.' — preachy duplicate."},
        {"id": "5360504", "reason": "'Children like to explore.' — generic statement."},
        {"id": "5439705", "reason": "'That's physically impossible.' — overlaps with 3732920."},
        {"id": "1771487", "reason": "'It's too risky.' — overlaps with 'This seems risky.'"},
        {"id": "1875233", "reason": "'My shoulders hurt.' — duplicates 'My neck hurts.'"},
        {"id": "5588689", "reason": "'My stomach has been hurting.' — duplicate of next id."},
        {"id": "1117904", "reason": "'It's monkey meat.' — odd standalone (1117893 keeps monkey vocab)."},
        {"id": "5070039", "reason": "'I don't play any instrument.' — duplicates broader arc."},
        {"id": "5131972", "reason": "'Can long distance relationships work?' — duplicate of 5131322."},
        {"id": "4501232", "reason": "'Traveling on business is stressful.' — stressful-list duplicate."},
        {"id": "4500340", "reason": "'Investing can be stressful.' — stressful-list duplicate."},
        {"id": "5679066", "reason": "'Christmas shopping is stressful.' — stressful-list duplicate."},
        {"id": "4562085", "reason": "'Dating can be very stressful.' — stressful-list duplicate."},
        {"id": "765145", "reason": "'Cities are exciting places, but also stressful.' — keep one framing."},
        {"id": "3826385", "reason": "'I rarely use plastic bags.' — niche eco-statement."},
        {"id": "5158166", "reason": "'Why do you always butt in?' — confrontational."},
        {"id": "5205188", "reason": "'I never tried to butt in.' — confrontational."},
        {"id": "2631943", "reason": "'I forgot the PIN number.' — niche tech."},
        {"id": "4321378", "reason": "'I have nowhere to sleep. Can I crash on your sofa?' — niche."},
        {"id": "954389", "reason": "'There was a half-eaten apple near the kitchen sink.' — odd descriptive."},
    ],

    "arcs": [
        # ============================================================
        # === THREE HIGHEST-QUALITY OPENING ARCS (position: first) ===
        # ============================================================

        # --- Opener 1: small-talk warm-up, idiomatic and natural ---
        {
            "position": "first",
            "items": [
                "32727",    # I still haven't thanked you for the other day. I really appreciate it.
                {"text": "Don't mention it.", "added_for": "mention|don't", "reason": "polite-deflection idiom"},
                {"text": "How have you been?", "added_for": "been|how", "reason": "natural small-talk follow-up"},
                "2541910",  # I'm glad we made some progress.
            ],
        },

        # --- Opener 2: opinion / nuanced reasoning ---
        {
            "position": "first",
            "items": [
                {"text": "What do you think about it?", "added_for": "think|about", "reason": "essential opinion Q"},
                "4498554",  # I had mixed feelings.
                {"text": "Could you elaborate on that?", "added_for": "elaborate", "reason": "polite request for expansion"},
                {"text": "Sure, let me explain.", "added_for": "explain|sure", "reason": "natural follow-up"},
            ],
        },

        # --- Opener 3: based on fact / official statements ---
        {
            "position": "first",
            "items": [
                "55600",    # This is based on fact.
                "57257",    # This story is based on actual events.
                "879812",   # Her argument was not based on facts.
                "55192",    # There is no scientific basis for these claims.
                "3821816",  # It's official.
                "5011392",  # There's no set policy.
            ],
        },

        # ============================================================
        # === Topic: Doctor / medical training ===
        # ============================================================
        [
            "2276040",  # I don't have medical training.
            "4268526",  # My doctor told me that I needed to lose some weight.
            {"text": "Did you follow the advice?", "added_for": "follow|advice", "reason": "natural Q-follow-up"},
            "4135327",  # I'm glad you asked me for advice.
        ],
        [
            "2954690",  # You require medical attention.
            "2954620",  # You need immediate medical attention.
            "2360203",  # I have patients waiting.
            "4502404",  # Some of the patients are suffering.
        ],
        [
            "4493970",  # Medical schools are expensive.
            "5859418",  # I have a law degree.
            "250729",   # My brother went to the United States to study law.
            "312525",   # She was a medical student.
        ],
        [
            "4133460",  # Doctors are the worst patients.
            "4133461",  # Doctors make the worst patients.
            {"text": "Why do you say that?", "added_for": "why|say", "reason": "indirect-question follow-up"},
        ],

        # === Topic: Role models / careers ===
        [
            "2359200",  # I haven't been much of a role model.
            "908704",   # Who's your favorite fashion model?
            "2240997",  # We're models.
            "2916983",  # Mary is a plus-sized model.
        ],
        [
            "5851349",  # I'm a believer.
            "70284",    # Are you a believer?
            "5839952",  # I'm a banker.
            "2647727",  # Aren't you a banker?
            "2247916",  # I'm an accountant.
            "2275385",  # Don't you have an accountant?
        ],
        [
            "5858251",  # I'm a politician.
            "3374710",  # I'm not a politician.
            "4496010",  # Most people don't really believe everything politicians say.
            "275867",   # The President is capable of handling the difficulties.
            {"text": "I have mixed feelings about that.", "added_for": "feelings|that", "reason": "nuanced-opinion answer"},
        ],
        [
            "1795439",  # I'm not a scientist.
            "294473",   # He is a scientist.
            "4502603",  # Some economists think so.
            "238003",   # I major in economics.
            "1112796",  # My son is studying economics.
        ],

        # === Topic: Currently / writing / progress ===
        [
            "2662956",  # We're currently working on that problem.
            "5109221",  # I know that you're currently writing a book.
            {"text": "How is it going so far?", "added_for": "going|far", "reason": "natural follow-up"},
            "316892",   # She was educated in the United States.
        ],

        # === Topic: Voting / civic ===
        [
            "2270379",  # Don't forget to vote.
            "2168727",  # It's your duty to vote.
            "4500999",  # Your vote matters.
            "2912550",  # How many votes did I get?
            "3732495",  # The votes are being counted.
            "4501297",  # Thirteen percent were opposed.
            "4501918",  # Thirteen percent said no.
            "3723513",  # I'm not changing my vote.
        ],

        # === Topic: Huge — broken up so 'huge' never repeats more than 3 in a row ===
        [
            "4495253",  # It's a huge loss.
            "4497250",  # This is a huge development.
            "4500246",  # It was a huge increase.
            {"text": "The results surprised everyone.", "added_for": "results|surprised", "reason": "break 'huge' drill"},
            "4501550",  # It was a huge project.
            "3820487",  # The party was a huge success.
            {"text": "Congratulations on the win.", "added_for": "congratulations|win", "reason": "break 'huge' drill"},
        ],
        [
            "1526299",  # The demand is huge.
            "2772974",  # We have a huge job ahead of us.
            "4494367",  # It's a huge opportunity.
            "4497027",  # It could be a huge opportunity.
            "4496374",  # That's a huge challenge.
        ],
        [
            "5088452",  # That made a huge difference.
            "3511227",  # It's a huge mistake.
            "4495030",  # It's a huge secret.
            {"text": "Please don't tell anyone.", "added_for": "anyone|tell", "reason": "break 'huge' drill, ties to secret"},
            "4500784",  # The hole looked huge.
            "911205",   # There's a huge hole in the wall.
        ],
        [
            "4496827",  # It's a huge concern.
            "4496729",  # It's a huge commitment.
            "4495252",  # It's a huge task.
            {"text": "We'll need extra help.", "added_for": "extra|help", "reason": "break 'huge' drill"},
            "3820383",  # It was an impossible task.
            "5008904",  # That would be a huge waste of money.
            "5069434",  # It's a waste of resources.
        ],
        [
            "2772971",  # We had a huge dinner.
            "2772937",  # I ate a huge breakfast.
            {"text": "I couldn't eat another bite.", "added_for": "bite|couldn't", "reason": "natural follow-up to 'huge dinner'"},
        ],

        # === Topic: Build / construction ===
        [
            "23640",    # Our policy is to build for the future, not the past.
            "4495997",  # Construction began in October.
            "4664312",  # The construction could take months.
            "269110",   # The new station building is under construction and will be completed soon.
            "66296",    # I wonder when this building was constructed.
            "241464",   # The United Nations Building was built in 1952.
        ],

        # === Topic: Visit / travel / holiday ===
        [
            "70225",    # Would you like to visit the United States?
            "696403",   # Would you like to travel to the United States?
            "2174962",  # I often visit my relatives.
            {"text": "Where would you like to go first?", "added_for": "where|first", "reason": "natural Q after 'would you like to visit'"},
        ],
        [
            "256068",   # There is absolutely no way that I would go on a trip alone.
            "51858",    # We had a wonderful holiday.
            "3694196",  # I extended my holiday.
            "248032",   # We had a wonderful weekend.
        ],

        # === Topic: Weight / losing / gaining ===
        [
            "243745",   # I've lost weight recently.
            "275253",   # I'm losing weight.
            "19630",    # I've suddenly lost weight.
            {"text": "Have you been eating well?", "added_for": "eating|well", "reason": "break 'weight' repetition with concerned-Q"},
            "19620",    # I've suddenly started to gain weight.
            "275254",   # I'm gaining weight.
        ],
        [
            "315643",   # She began to gain weight.
            "4498787",  # Nobody gained weight.
            "301162",   # He is putting on weight.
            {"text": "Maybe it's the holidays.", "added_for": "maybe|holidays", "reason": "break 'weight' repetition"},
            "243744",   # I am putting on weight these days.
            "62791",    # I've put on a lot of weight since Christmas.
        ],
        [
            "886907",   # She advised him to lose weight.
            "4969955",  # The best way to lose weight is to eat less and exercise more.
            "953149",   # Can eating just vegetables help you lose weight?
            "1317087",  # No matter how much she eats, she never gains weight.
        ],
        [
            "2548829",  # I weigh 130 pounds.
            "2997955",  # How much does your daughter weigh?
            "315645",   # She weighs 120 pounds.
            {"text": "That's about average.", "added_for": "average|about", "reason": "break 'weigh' repetition"},
            "2961188",  # My cat weighs about ten pounds.
            "245579",   # My sister is always weighing herself.
            "5858142",  # I weighed myself.
            "4502860",  # It weighed perhaps 300 kilograms.
        ],
        [
            "56080",    # It's like a weight has been lifted from my shoulders.
            "5189155",  # I can't lift as much weight as I used to.
            {"text": "Tell me more about that.", "added_for": "tell|more", "reason": "natural conversational nudge"},
        ],
        [
            "503830",   # Lack of sleep is bad for your health.
            "2948431",  # Exercise is the best way to get rid of stress.
            {"text": "I should take that advice.", "added_for": "should|advice", "reason": "natural acknowledgement"},
        ],

        # === Topic: Marriage ===
        [
            "3346020",  # Marriage changes people.
            {"text": "Do you really think so?", "added_for": "really|think", "reason": "polite-disagreement Q"},
            "1281086",  # My parents had an arranged marriage.
            "3107521",  # You need to work on saving your marriage.
        ],

        # === Topic: Wedding ===
        [
            "238736",   # The wedding will take place on Saturday.
            "306443",   # They announced the date of their wedding in the newspaper.
            "4665060",  # Our wedding plans have changed.
            {"text": "What happened?", "added_for": "happened|what", "reason": "break 'wedding' run with natural Q"},
            "4463136",  # Where was the wedding held?
        ],
        [
            "1140113",  # I'm looking forward to seeing you in a wedding dress.
            "5767527",  # I lost my wedding ring.
            "3821124",  # Why aren't you wearing your wedding ring?
            {"text": "I forgot it at home.", "added_for": "forgot|home", "reason": "break 'wedding' repetition with answer"},
            "2738975",  # Did you see the item in the paper about their wedding?
        ],
        [
            "5837529",  # How would you like to be our wedding photographer?
            "3333870",  # Would you sing at our wedding?
            {"text": "I'd be honored.", "added_for": "honored", "reason": "polite formal acceptance"},
            "5559087",  # We went to each other's weddings.
        ],
        [
            "2359086",  # I've been engaged twice.
            "5973359",  # Mary and her boyfriend got engaged.
            "251375",   # My son is engaged to his secretary.
            "287789",   # His parents approve of the engagement.
            "2359612",  # I've got a previous engagement.
        ],
        [
            "319176",   # My father objected to our marriage.
            "252084",   # My parents are opposed to my sister marrying a foreigner.
            "284103",   # It was uncertain whether he would marry her.
        ],

        # === Topic: Absolutely / emphasizers ===
        [
            "2045777",  # It's absolutely beautiful.
            "2252735",  # They're absolutely certain.
            "2713245",  # Are you absolutely positive?
            {"text": "Yes, without a doubt.", "added_for": "doubt|yes", "reason": "break 'absolutely' drill"},
            "3734282",  # There's absolutely no risk.
            "619727",   # You have absolutely nothing to fear.
        ],
        [
            "2713171",  # Is this absolutely necessary?
            "3738923",  # Is that absolutely necessary?
            "2713125",  # You must be absolutely quiet.
            "2713319",  # You're absolutely correct.
            "3255548",  # That's absolutely correct.
            "4664519",  # Absolutely nobody saw this coming.
        ],
        [
            "4937814",  # There's just absolutely nothing happening.
            "252219",   # I ate absolutely nothing the whole day.
            "292912",   # He has absolutely no respect for other people's feelings.
            "2358850",  # I have absolutely no artistic skills.
        ],
        [
            "4495531",  # I agree one hundred percent.
            "6459938",  # You're a hundred percent right.
            "67927",    # Everything at that store is 10 percent off the regular price.
            "3988471",  # The U.S. has almost a fourth of the world's prison population.
        ],

        # === Topic: Glad — broken across many arcs with rewrites to vary
        # the lead, so no single template repeats more than 3 in a row. ===
        [
            "1989708",  # I'm glad you're okay.
            "2548256",  # I'm glad you called.
            "2546614",  # I'm glad you showed up.
            {"text": "It's good to see you.", "added_for": "good|see", "reason": "break 'I'm glad' drill"},
            "2546005",  # I'm glad you're staying.
            "2546012",  # I'm glad you dropped by.
        ],
        [
            "2546010",  # I'm glad you stopped by.
            "2547764",  # I'm glad you noticed.
            "2544796",  # I'm glad you realize that.
            {"text": "It took me a while to see it.", "added_for": "while|see", "reason": "break 'glad' drill"},
            "2540537",  # I'm glad you're enjoying yourself.
            "2542454",  # I'm glad you're enjoying this.
        ],
        [
            "17999",    # I'm glad you liked it.
            "20675",    # I'm glad you enjoyed it.
            "2543597",  # I'm glad you suggested this.
            {"text": "It was a great idea.", "added_for": "idea|great", "reason": "break 'glad' drill"},
            "2541806",  # I'm so glad you suggested this.
            "2541909",  # I'm glad you accepted my offer.
        ],
        [
            "2544497",  # We haven't officially met.
            "2543599",  # I'm glad we're in agreement.
            "2952777",  # I'm glad we reached an agreement.
            "2994700",  # I'm glad we talked.
            "2548727",  # I'm glad we waited.
        ],
        [
            "2544795",  # I'm glad you weren't here.
            "4499430",  # I'm glad you weren't hurt.
            "2547219",  # I'm glad I was nearby.
            {"text": "That could have ended badly.", "added_for": "ended|badly", "reason": "break 'glad' drill"},
            "2546621",  # I'm glad I invited you.
            "5244740",  # I'm glad I managed to do it.
            "5244738",  # I'm glad I watched the game.
        ],
        [
            "4569269",  # I'm glad you've gotten over your cold.
            "4097126",  # I'm glad that the rain has stopped.
            "2546015",  # I'm glad that's settled.
        ],
        [
            "920422",   # I'm glad he stuck around.
            "1832119",  # I'm glad someone agrees with me for once.
            "3007632",  # I'm glad you approve.
            {"text": "That means a lot to me.", "added_for": "means|lot", "reason": "break 'glad' drill"},
            "5306645",  # I'm glad I listened to you.
            "3199768",  # I'm glad you're letting me do this.
        ],
        [
            "3729201",  # I'm glad to be the one who tells you.
            "2644542",  # I'm glad to be of service.
            "295626",   # He'll be glad to see you.
            "17801",    # I am glad that you have succeeded.
        ],
        [
            "4937898",  # I'm glad it's happening now.
            "247077",   # I'm glad it's not coming out of my pocket.
            "5171712",  # I'm glad you survived.
        ],
        [
            "2543021",  # I'm glad someone understands.
            "2539211",  # I'm glad you finally figured that out.
            "3732971",  # I'm glad you reminded me.
            "4963994",  # I'm glad you replied.
            "1933567",  # I appreciate your telling me.
        ],
        [
            "4499495",  # I'm glad you're not in my circle of friends.
            "4098158",  # I'm glad you got home safely.
            "3428617",  # I'm glad you talked me into going.
            "6267614",  # I'm glad I studied French.
        ],

        # === Topic: Appreciate — broken up with variety lines ===
        [
            "1112236",  # We appreciate your understanding.
            "1933574",  # I appreciate your position.
            "3619764",  # I appreciate your efforts.
            {"text": "Thank you for everything.", "added_for": "thank|everything", "reason": "break 'appreciate' drill"},
            "5215577",  # I appreciate your comments.
            "5218660",  # I appreciate your comment.
        ],
        [
            "1933602",  # I appreciate you calling me.
            "2390783",  # I really appreciate you helping me.
            "1933596",  # I appreciate you stopping by.
            {"text": "You didn't have to do that.", "added_for": "didn't|that", "reason": "break 'appreciate' drill"},
            "2390785",  # I really appreciate you picking me up.
            "1933604",  # I appreciate you agreeing to meet with me.
        ],
        [
            "1933564",  # I appreciate your trying to protect me.
            "1933621",  # I appreciate the faith you've shown in me.
            "20400",    # I appreciate your concern.
            {"text": "It means a lot.", "added_for": "means|lot", "reason": "break 'appreciate' drill"},
            "1933570",  # I appreciate your suggestion.
            "1933617",  # I appreciate the invitation.
        ],
        [
            "2275956",  # I don't appreciate your attitude.
            "2315188",  # I don't appreciate being lied to.
            "2291884",  # I appreciate your honesty.
            "5683732",  # I appreciate everybody's support.
        ],
        [
            "52253",    # I would appreciate hearing from you soon.
            "1312866",  # I would appreciate a reply.
            "1312864",  # We'd appreciate a reply.
            "2953831",  # We'd both really appreciate it.
            "1392643",  # I'd appreciate it if you'd turn off the lights.
            "279152",   # I'd appreciate it if you would turn out the lights.
        ],
        [
            "2542551",  # I'd appreciate an explanation.
            "4665807",  # Here is a brief explanation.
            "290516",   # He had no difficulty explaining the mystery.
            "4904855",  # Experts have offered three possible explanations.
        ],
        [
            "1933592",  # I appreciate your attention to detail.
            "2835575",  # You have such a wonderful eye for detail.
            "4529196",  # We surely do appreciate what you've done.
            "2313688",  # I appreciate the value of what you're offering.
        ],

        # === Topic: Wonderful ===
        [
            "2250110",  # That feels wonderful.
            "1864482",  # It's a wonderful world.
            "3818494",  # This picture is wonderful.
            "5463188",  # What a wonderful town!
            "3737335",  # You've got a wonderful family.
        ],
        [
            "42739",    # It's a wonderful work of art.
            "5085930",  # It was a wonderful surprise.
            "4394782",  # You're a wonderful cook.
            "3819500",  # We had a wonderful meal together.
            "51851",    # Thank you for the wonderful meal.
        ],

        # === Topic: Bottom / sign ===
        [
            "3730568",  # What's the bottom line?
            "25379",    # Sign at the bottom, please.
            "256107",   # I live on the bottom floor.
            "3382716",  # I touched the bottom.
        ],

        # === Topic: Truly / amazingly ===
        [
            "2249345",  # It's truly amazing.
            "3840003",  # I truly doubt it.
            "4500072",  # I truly mean that.
            {"text": "Words can't describe it.", "added_for": "words|describe", "reason": "break 'truly' drill"},
            "5491733",  # We're truly worried.
            "4505527",  # We were truly surprised.
            "4731171",  # We are truly pleased.
            "2248287",  # I'm truly touched.
        ],

        # === Topic: Distance / mountain / smoke ===
        [
            "19377",    # I can't judge distance.
            "73456",    # Ten miles is not a short distance.
            "2912583",  # How much distance have we covered?
            "25833",    # We saw a mountain in the distance.
            "25842",    # We heard shots in the distance.
        ],
        [
            "262910",   # We saw smoke in the distance.
            "5131322",  # Can long distance relationships really work?
            {"text": "It depends on the couple.", "added_for": "depends|couple", "reason": "nuanced opinion answer"},
            "2059865",  # There are three health food stores within walking distance of my house.
        ],

        # === Topic: Longest / largest / most (vocab restoration) ===
        [
            "452792",   # The Mississippi is the longest river in the United States.
            {"text": "That's longer than I thought.", "added_for": "longer|thought", "reason": "natural reaction; reinforces 'longest'"},
        ],

        # === Topic: Exchange / rate ===
        [
            "2412268",  # Are you an exchange student?
            "2713011",  # What's the exchange rate today?
            "242501",   # What's today's exchange rate?
            "30400",    # If it's possible, I'd like to exchange this for a larger size.
            "71200",    # Let me exchange seats with you.
        ],
        [
            "2243114",  # They exchanged smiles.
            "246046",   # The children exchanged presents at the Christmas party.
            "289779",   # He gave me an orange in exchange for a piece of cake.
        ],

        # === Topic: Sky / clouds / stars ===
        [
            "271541",   # The sky is likely to clear up.
            "1778770",  # The sky cleared up.
            "325288",   # The sky cleared up soon after the storm.
            {"text": "The weather changed quickly.", "added_for": "weather|quickly", "reason": "break 'sky' run"},
            "18309",    # There wasn't a cloud in the sky.
            "425820",   # There are no clouds in the sky.
            "5690290",  # There are lots of clouds in the sky today.
            "3071532",  # The sky is cloudy today.
        ],
        [
            "18307",    # We can see thousands of stars in the sky.
            "453420",   # Not a single star could be seen in the sky.
            "18320",    # There are billions of stars in the sky.
            {"text": "I love stargazing.", "added_for": "stargazing|love", "reason": "break 'sky' run"},
            "73198",    # A bird was flying in the sky.
            "18308",    # I saw something strange in the sky.
            "18280",    # The sky grew darker and darker.
            "2549275",  # The sky was gray.
            "433660",   # The skies are clear.
            "594747",   # The skies won't be clear.
            "18147",    # Judging from the look of the sky, it is going to snow.
        ],
        [
            "26960",    # It was raining hard, but she insisted on going for a drive.
            "1819073",  # It rained for three days in a row.
            "249045",   # The heavy rain prevented us from going fishing.
            "2782485",  # It rarely snows here in the winter.
            "26944",    # I always wear boots when it rains or snows.
            "889776",   # It's very windy and my hair got messed up.
            "325267",   # The storm sank the boat.
            "325256",   # The crops were badly damaged by the storm.
        ],

        # === Topic: Debt / cash ===
        [
            "5608153",  # We have to reduce the national debt.
            "299074",   # He demanded payment of the debt.
            "2663407",  # We have a cash flow problem.
            "3922325",  # We've got a cash flow problem.
        ],

        # === Topic: Confused / understanding ===
        [
            "1519788",  # I'm feeling confused.
            "2713642",  # I'm totally confused.
            "3732452",  # Everyone's a bit confused.
            {"text": "Let me think about it.", "added_for": "let|think", "reason": "polite-pause idiom for L10"},
            "4496856",  # No one's confused.
            "2111457",  # That's confusing.
            "3825587",  # It's confusing.
            "1392416",  # Don't confuse me.
            "2248982",  # It'll confuse him.
        ],
        [
            "1690582",  # It's perfectly understandable.
            "2251193",  # That's perfectly understandable.
            "2544976",  # I understood it perfectly.
        ],

        # === Topic: Recommend ===
        [
            "1890857",  # I'd recommend taking a break.
            "2836742",  # Can you recommend a good travel agent?
            "4663321",  # Can you recommend a good Chinese restaurant?
            "3150461",  # Would you recommend buying a house on Park Street?
        ],
        [
            "3824568",  # I recommend studying French.
            "5821400",  # I'd recommend singing this song in a different key.
            "4174122",  # Can you recommend a restaurant that has good Korean food?
            "5610888",  # I'd recommend that you try to relax.
            "2794191",  # Who recommended that?
            "252186",   # I recommend it strongly.
        ],
        [
            "968139",   # Can you recommend a good dictionary?
            "3854766",  # Can you recommend any other hotels?
            "4185125",  # Can you play an instrument?
            "1745293",  # Which instruments do you play?
            "4208064",  # Do you play any instruments?
            {"text": "I play a little piano.", "added_for": "piano|little", "reason": "natural Q-A on instruments"},
        ],

        # === Topic: Mixed feelings / opinions / options ===
        [
            "2245221",  # Consider the options.
            "5640574",  # I'm considering my options.
            "5710013",  # We're keeping all options open at this point.
            "2247949",  # I'm checking options.
            "1801681",  # We have no alternatives.
            "2544492",  # What are the alternatives?
            "4945645",  # Let's discuss our options.
        ],
        [
            "1410150",  # I heard various opinions.
            "285488",   # His opinions carry weight.
            "6126045",  # I have the right to express my own opinions.
            "70834",    # How does your opinion differ from his?
            "321490",   # My opinion differs from yours.
            "70438",    # Your answer differs from mine.
            "264983",   # I beg to differ with you.
        ],
        [
            "1370516",  # Let's end this debate.
            "4496900",  # The debate will continue.
            "4496901",  # The debate is continuing.
            "23164",    # We debated the problem.
            "256434",   # I debated for hours with my friends on the subject.
            {"text": "We couldn't reach an agreement.", "added_for": "reach|agreement", "reason": "break 'debate' run"},
            "4850019",  # These are questions worth debating.
            "3280386",  # I've been debating whether I should mention it or not.
            "4497124",  # This debate is silly.
        ],
        [
            "2234118",  # What's the objection?
            "3821987",  # Your objection is noted.
            "3365633",  # I'm not persuaded.
            "3565089",  # OK, I'm persuaded.
            "272518",   # We tried to persuade him.
            "316819",   # She attempted to persuade her father.
        ],
        [
            "4017165",  # That sounds really appealing.
            "2276520",  # It doesn't sound too appealing.
            "3444553",  # It appeals to me.
            "2452029",  # That kind of story appeals to me.
            "2251175",  # That's one interpretation.
            "2406886",  # I suppose that's impossible.
            "2406880",  # I suppose it's my fault.
        ],
        [
            "2241567",  # We'll convince them.
            "887051",   # She couldn't convince him to ride a horse.
            "2111744",  # I'm convinced.
            "2249164",  # It's pretty convincing.
            "4496931",  # It was convincing.
        ],
        [
            "2408450",  # I think we ought to change our policy.
            "258968",   # I don't agree with the government's policy on education.
            "4495554",  # We basically agree.
            "3732955",  # It's basically quite simple.
            "4665498",  # The policies are quite clear.
            "4500928",  # Who made those policies?
        ],

        # === Topic: Difficult / hated / initial reaction ===
        [
            "1493356",  # It was much more difficult than we initially thought.
            "3823483",  # I initially hated it.
            "506870",   # I've always hated biology.
            {"text": "What changed your mind?", "added_for": "changed|mind", "reason": "Q-follow about opinions"},
        ],

        # === Topic: Education / subjects ===
        [
            "1317",     # I never liked biology.
            "3826204",  # My favorite subject is biology.
            "2207207",  # Math is hard.
            "270999",   # How was the math test?
            "2210668",  # Today's math class was more interesting than usual.
            "944561",   # I barely passed the exam.
            "2258148",  # Did you pass your math exam?
        ],
        [
            "2920711",  # I study mathematics.
            "5179031",  # I teach mathematics and physics.
            "248707",   # We had an examination in mathematics today.
            "1786373",  # I don't care about economics.
            "295702",   # He lacks experience.
            "303009",   # He lacks common sense.
            "2158515",  # You lack imagination.
            "476173",   # His lack of technical knowledge kept him from being promoted.
        ],
        [
            "2358929",  # I've always been interested in science.
            "4015172",  # Why is alternative energy important?
            "274785",   # Many TV programs have a bad influence on children.
            "2546246",  # You're a bad influence.
            "388837",   # He enjoys watching baseball games on TV.
        ],

        # === Topic: Wine ===
        [
            "5191962",  # I ordered a glass of wine.
            "2928721",  # The wine was excellent.
            "42313",    # That's an excellent wine.
            "60576",    # This wine tastes good.
            "1481682",  # This wine tastes great.
            "281011",   # Which wine goes best with red meat?
            "259919",   # I prefer red wine to white.
            "906714",   # What's your favorite cheese to eat when drinking wine?
        ],
        [
            "5007911",  # Are you drinking wine?
            "2309306",  # We drank some wine.
            "2421118",  # I drank some wine.
            {"text": "It was a smooth red.", "added_for": "smooth|red", "reason": "break 'wine' drill"},
            "3115674",  # I've forgotten whether you drink wine or not.
            "4085941",  # Mary usually has a few glasses of wine while cooking dinner.
            "5858543",  # I chose the wine.
            "5858546",  # I tasted the wine.
        ],
        [
            "3392610",  # Let's open a bottle of wine.
            "34313",    # Give me a bottle of wine.
            "2546295",  # We have plenty of wine.
            "1944150",  # I bought three bottles of wine.
            "2110",     # My mother bought two bottles of orange juice.
            "34141",    # Do you like French wines?
            "3357856",  # What are some of your favorite French wines?
            "906745",   # What's your favorite domestic wine?
            "3746362",  # Life's too short to drink cheap wine.
        ],

        # === Topic: Dining / restaurant ===
        [
            "3647252",  # May I have the menu and the wine list?
            "272108",   # I'd like to reserve a seat.
            "72437",    # I'd like to reserve a table for four at six.
            "3310973",  # We're having steak tonight.
            "51912",    # I like my steak rare.
            "5287096",  # The steak was cooked to perfection.
        ],
        [
            "2007940",  # Let's chat.
            "3008807",  # Let's have a chat.
            "1547642",  # We continued chatting.
            "5280580",  # You don't seem to have any problem communicating in French.
            "2643031",  # It was nice chatting with you.
        ],
        [
            "4135447",  # Here's your salad.
            "906865",   # What's your favorite salad dressing?
            "4498082",  # Do you eat salads?
            "4493705",  # We rarely have soup.
            "60991",    # The soup is thick.
            "2849400",  # This steak is very juicy.
        ],

        # === Topic: Customers / business ===
        [
            "41995",    # Those children are potential customers.
            "249591",   # We have more customers than we can count.
            "5090726",  # We treat our customers well.
            "2359680",  # I've got plenty of customers.
            "3060426",  # We don't get a lot of repeat customers.
            "4501883",  # Customers have to be satisfied.
            "306546",   # They attract customers by offering high-quality goods.
        ],
        [
            "64675",    # We had no customers, so we shut the shop early.
            "2583340",  # The bar is closing soon.
            "4134993",  # Three customers came in just as we were closing.
            "3396429",  # Is the bar open yet?
            "3424166",  # The bar is crowded.
            "4203496",  # The bar was so crowded you could hardly move.
            {"text": "We could barely find a seat.", "added_for": "barely|seat", "reason": "break 'bar' drill"},
            "5852485",  # I sat at the bar.
            "3774868",  # The bar was packed.
            "4495926",  # Everyone in the bar seemed to be with a date.
        ],

        # === Topic: Purchase / money ===
        [
            "4144935",  # I'm very happy with my purchase.
            "2646191",  # When was it purchased?
            "4527029",  # I paid for my purchases in cash.
            "319918",   # Prices are double what they were ten years ago.
            "266028",   # We charge a commission of 3%.
            "3622884",  # What is your commission?
            "2450059",  # What's your annual income?
            "4496193",  # Approximately 300 houses were built here last year.
        ],
        [
            "5302491",  # I think that about sums it up.
            "17168",    # Please sum up your idea.
            "73342",    # The sum of 12, 24, 7 and 11 is 54.
            "538956",   # We estimate the damage at one thousand dollars.
            "3328453",  # Can you estimate its value?
            "72549",    # You gave me only fifty cents.
            "3594111",  # That cost me three bucks.
            "1279213",  # I feel like a million bucks.
            "3451214",  # I don't have a cent.
            "248902",   # We purchased a new house for eighty thousand dollars.
        ],
        [
            "1180901",  # I can't really afford the rent.
            "1950646",  # I can't afford a pay cut.
            "4529137",  # Not everyone could afford to pay their taxes.
            "1954679",  # I can't possibly afford to pay for the operation my mother needs.
            "252192",   # I can't afford a new coat.
            "261727",   # I cannot afford the time for a vacation.
        ],
        [
            "2308145",  # I could lose my pension.
            "43347",    # The old man lives on his pension.
            "5420461",  # I'm earning money.
            "289396",   # He earns a great deal.
            {"text": "That's a comfortable income.", "added_for": "comfortable|income", "reason": "break 'earn' drill"},
            "293813",   # He earns twenty dollars a day.
            "1655560",  # How much do you earn?
            "2271710",  # I didn't earn this.
            "2955094",  # You've earned a rest.
            "2293500",  # I barely make any profit now.
            "3702255",  # Salaries have increased.
            "5364124",  # Teachers' salaries are very low.
        ],

        # === Topic: Resources / supplies ===
        [
            "4494612",  # Resources are limited.
            "22943",    # We have limited resources.
            "2953718",  # We need medical supplies.
            "4496178",  # They brought medical supplies.
            "4497230",  # Our equipment was destroyed.
            "2293180",  # I assume all our equipment is still up to date.
            "4497380",  # It'll be easier for me to do since I have better equipment.
        ],

        # === Topic: Drug / treatment ===
        [
            "2280435",  # This drug works well.
            "4134976",  # What are some of the side effects of this drug?
            "5179255",  # Let's hope this drug gets approved.
            "3152517",  # What drugs are they giving you?
            "303841",   # He was dropped from the team for using drugs.
        ],
        [
            "2805901",  # Will he recover?
            "2545888",  # I'm sure you'll recover.
            "2248002",  # I'm fully recovered.
            "948431",   # You recovered quickly.
            "52865",    # Have you recovered from the shock?
            "5851015",  # I'm recovering.
            "2248436",  # Is everyone recovering?
            "5168857",  # I wish you a speedy recovery.
            "283473",   # Is there any chance of his recovery?
            "283475",   # There is little hope of his recovery.
        ],

        # === Topic: Flowers ===
        [
            "60057",    # These flowers are dying.
            "42008",    # Those flowers have died.
            "4133481",  # I forgot to water the flowers.
            {"text": "I'll do it before I leave.", "added_for": "before|leave", "reason": "break 'flowers' drill"},
            "5938771",  # I'm watering the flowers.
            "23760",    # I've finished watering the flowers.
            "5916828",  # I watered the flowers.
            "3824656",  # I've watered all the flowers.
            "251851",   # My mother grows flowers in her garden.
            "320828",   # My mother is busy planting flowers in the garden.
            "320811",   # My mother teaches flower arranging.
        ],
        [
            "24878",    # What lovely flowers!
            "312911",   # She picked flowers.
            "23766",    # Don't touch the flowers.
            "436465",   # I bought nine flowers.
            "72709",    # In March, many flowers come out.
            "289634",   # Who is that woman holding the flowers?
            "388322",   # These flowers have a unique smell.
            "2641170",  # That's a beautiful flower arrangement.
            "2406295",  # I sent my mother some flowers on Mother's Day.
            "3527255",  # These flowers come from Holland.
            "887095",   # She doesn't want him to pick the flowers.
        ],

        # === Topic: Mess / cleaning ===
        [
            "278536",   # My brother's room is always a mess.
            "5505194",  # What a total mess!
            "2285819",  # Don't mess up my system.
            "953108",   # Are you responsible for this mess?
            {"text": "I'll help you tidy it up.", "added_for": "tidy|help", "reason": "break 'mess' drill"},
            "278573",   # My brother leaves his room in a mess.
            "5001251",  # Are you the one who caused this mess?
            "2245979",  # I messed up.
            "2542404",  # I'm not cleaning up that mess.
            "2307996",  # I cleaned up the mess.
            "3736012",  # They've already cleaned up the mess.
            "3528169",  # Stop messing around.
            "2546548",  # I'm not messing around.
        ],

        # === Topic: Aunt / family ===
        [
            "1390198",  # My aunt had three kids.
            "286680",   # His aunt has three cats.
            "253243",   # I addressed the letter to my aunt.
            "64932",    # My aunt sent me a birthday present.
            {"text": "She always remembers.", "added_for": "remembers|always", "reason": "break 'aunt' drill"},
            "682055",   # I have a special relationship with my aunt.
            "1318688",  # I ran into my aunt by chance in Europe.
            "266657",   # My aunt treats me as if I were a child.
        ],

        # === Topic: Family / relatives (vocab restoration) ===
        [
            "1495839",  # Are they your relatives?
            {"text": "Most of them are distant relatives.", "added_for": "distant|relatives", "reason": "reinforces 'relative' vocab"},
        ],

        # === Topic: Status / agreement / confirmation ===
        [
            "2029896",  # What's your status?
            "58758",    # The status of a doctor is very high in this community.
            "3832035",  # My client is willing to make a deal.
            "1538273",  # I confirmed the order.
            "2644064",  # That hasn't been confirmed.
            "4601344",  # Could you please confirm the price by email?
            "4496838",  # The evidence confirms it.
        ],

        # === Topic: Careful — broken with rewrites every ~3 ===
        [
            "2047590",  # I'm real careful.
            "5858586",  # I'll be extra careful.
            "1345547",  # Be careful not to fall.
            {"text": "The floor is slippery.", "added_for": "floor|slippery", "reason": "break 'careful' drill"},
            "2733126",  # Be careful not to burn yourself.
            "2733164",  # Be careful when crossing the street.
            "2592705",  # Please be careful when crossing the street.
            "6111035",  # Be careful not to break the eggs.
            "2047642",  # Be careful with that knife.
            "4051758",  # Be careful. This knife is really sharp.
            "2888804",  # You should be careful with knives.
        ],
        [
            "2047718",  # Be careful with your choice of words.
            "2512196",  # If you aren't careful, you'll fail again.
            "4480821",  # Be careful when you cross a road.
            {"text": "Watch out for traffic.", "added_for": "watch|traffic", "reason": "break 'careful' drill"},
            "26607",    # It was obvious that the driver had not been careful enough.
            "2047735",  # Everything must be handled very carefully.
            "5801953",  # Be careful on those rocks.
            "2047722",  # Be careful near the edge of the cliff.
            "324380",   # You should be careful in choosing friends.
            "5831933",  # The doctor says you must be careful to avoid excitement.
            "1950760",  # You can't be too careful in situations like this.
        ],
        [
            "2047589",  # Choose carefully.
            "434822",   # Handle this very carefully.
            "4496296",  # Plan your moves carefully.
            "259460",   # I wrote the answers carefully.
            "4496291",  # Please read these reports carefully.
            "2047724",  # Please look at these papers carefully.
            "319963",   # I'm the type who likes to think things over very carefully.
        ],
        [
            "50730",    # Compare the two carefully, and you will see the difference.
            "3826721",  # Think carefully before answering.
            "2924827",  # Read the instructions carefully.
            "2953260",  # Please read the instructions carefully.
            "3876802",  # I usually read labels carefully.
            "4397582",  # Read the label carefully.
            "267128",   # You'd better examine the contract carefully before signing.
            "2406825",  # I suggest that you proceed very carefully.
            "2662883",  # This problem must be dealt with carefully.
            "55057",    # These problems must be dealt with carefully.
            "5939645",  # I listened carefully.
            "2307961",  # I carefully considered my options before proceeding.
            "2877895",  # Nobody would've gotten hurt if we'd been more careful.
            "2047717",  # We should've planned more carefully.
        ],
        [
            "318651",   # Careless driving causes accidents.
            "388417",   # She is careless about the way she dresses.
            "39086",    # It was careless of me to forget to lock the door.
            "886874",   # She advised him to be more careful.
        ],

        # === Topic: Fault / blame ===
        [
            "3518547",  # It's entirely my fault.
            "64515",    # Let's stop finding fault with each other.
            "2953143",  # It's my fault that you were fired.
            {"text": "I should have spoken up sooner.", "added_for": "spoken|sooner", "reason": "break 'fault' drill"},
            "276469",   # Everyone has faults.
            "276421",   # Everybody has some faults.
            "2249105",  # It's nobody's fault.
            "4494626",  # It was nobody's fault.
            "3824735",  # It's not anyone's fault.
            "4665593",  # Who cares whose fault it is?
        ],

        # === Topic: Impossible ===
        [
            "4015997",  # It's impossible to explain.
            "2095",     # She's asking for the impossible.
            "4015175",  # It's almost impossible to imagine.
            {"text": "Some things you just can't put into words.", "added_for": "words|put", "reason": "break 'impossible' drill"},
            "4736790",  # Life would be impossible without the sun.
            "73241",    # It's impossible to learn English in a month.
            "30259",    # I found it impossible to get in contact with him.
            "3865792",  # It's impossible to fix.
            "5485591",  # It's impossible to describe.
        ],
        [
            "2543049",  # I'm afraid that's impossible.
            "5081948",  # What you propose is impossible.
            "311389",   # She tried to lift the box, but found it impossible.
            "487932",   # It was impossible for the boy to swim across that river.
            "3732920",  # That would be physically impossible.
            "2097065",  # It's impossible to see Rome in a day.
            "4494603",  # That'll be impossible.
        ],

        # === Topic: Generally / habits ===
        [
            "254905",   # I generally walk to school.
            "257398",   # I do not like tea, so I generally drink coffee for breakfast.
        ],

        # === Topic: Strange / odd ===
        [
            "3732146",  # What an odd expression!
            "3635921",  # It's strangely quiet here.
            "4498543",  # I felt strangely calm.
        ],

        # === Topic: Smell / senses ===
        [
            "326620",   # Smell is one of the five senses.
            "2406527",  # I smell something awful.
            "4834651",  # You smell awful.
            {"text": "Have you taken a shower?", "added_for": "shower|taken", "reason": "break 'smell' drill (playful)"},
            "2527281",  # Your breath smells.
            "1553381",  # This milk smells funny.
            "3825990",  # It smells burnt.
            "3287161",  # It smells like something's burning.
            "5853262",  # I smelled gas.
            "2360314",  # I've smelled this smell somewhere before.
            "22686",    # We smell with our noses.
            "2291863",  # I always wondered what that smell was.
            "3053137",  # I like the smell of freshly-baked bread.
            "4135448",  # I love the smell of freshly baked bread.
        ],
        [
            "1084449",  # It looks familiar.
            "1084452",  # It sounds familiar.
            "2730811",  # I saw many familiar faces.
            "47789",    # The author's name is familiar to us.
            "2375821",  # I knew your name sounded familiar.
            "260644",   # I am familiar with the way he asks questions.
        ],

        # === Topic: Calm / quiet ===
        [
            "1225118",  # Please remain calm.
            "4501726",  # Everyone remained calm.
            "3113808",  # Let's stay calm and think this through.
            {"text": "Panicking won't help.", "added_for": "panic|help", "reason": "break 'calm' drill"},
            "2245453",  # Everyone stayed calm.
            "5853241",  # I stayed calm.
            "303526",   # He looked calm, but actually he was very nervous.
            "3722196",  # There was a brief silence.
            "5853059",  # I'm not violent.
            "2253700",  # Things got violent.
        ],
        [
            "2245581",  # Hold perfectly still.
            "2251189",  # That's perfectly fair.
            "2251190",  # That's perfectly legal.
            "2396253",  # It worked perfectly.
            "2648112",  # I'm perfectly fine.
            "5945228",  # I'm perfectly healthy.
            "3238916",  # This bridge is perfectly safe.
            "1655424",  # It's perfectly normal.
            "55845",    # This fits perfectly.
            "2248724",  # It fits perfectly.
            "3818813",  # I'm officially on vacation.
            "4495750",  # Spring has officially arrived.
        ],

        # === Topic: Nervous / scared / threatened ===
        [
            "4900665",  # I didn't feel particularly nervous.
            "1123478",  # I'm scared of wild animals.
            "2245772",  # I felt threatened.
            "2247524",  # I was threatened.
            "2546582",  # I'm in constant danger.
            "21059",    # The patient is out of danger now.
            "2234127",  # What's the threat?
            "5088079",  # What exactly is the threat?
            "2541281",  # I've been getting death threats.
            "4501649",  # What kind of threats have you been receiving?
            "718898",   # Don't threaten me.
            "1955070",  # You can't threaten me.
            "1886295",  # Are you threatening me?
        ],

        # === Topic: Wise / smart / wisdom ===
        [
            "2643816",  # Whoever did this was smart.
            "296033",   # He has acted wisely.
            "679883",   # Please choose wisely.
            "1647044",  # A wise leader knows when to follow.
            "239384",   # A wise man profits from his mistakes.
            "1426422",  # Old people aren't always wiser than young people.
            {"text": "Experience teaches the rest.", "added_for": "experience|teaches", "reason": "break 'wise' drill; ties to wisdom"},
            "4496706",  # Wisdom comes with age.
            "5112766",  # I had one of my wisdom teeth pulled out last week.
        ],

        # === Topic: Embarrassed ===
        [
            "1217164",  # I'm embarrassed.
            "1461910",  # Aren't you embarrassed?
            "2240567",  # We're embarrassing ourselves.
            {"text": "Let's just move on.", "added_for": "move|on", "reason": "break 'embarrass' drill"},
            "2218144",  # You're embarrassing yourselves.
            "1639203",  # Oh boy, that's embarrassing.
            "4498243",  # This is simply embarrassing.
            "4664811",  # That could've been embarrassing.
            "2245324",  # Don't embarrass me.
            "2245325",  # Don't embarrass yourself.
        ],

        # === Topic: Should've / could've / regret ===
        [
            "2406405",  # I should've gone fishing.
            "2406407",  # I should've gone hunting.
            "2406427",  # I should've known you were a model.
            {"text": "Hindsight is always clearer.", "added_for": "hindsight|clearer", "reason": "break 'should've' drill"},
            "2721268",  # I should've chosen a shorter username.
            "2406437",  # I should've reacted differently.
        ],
        [
            "2387315",  # I must've lost some weight.
            "3178580",  # It must've slipped my mind.
            "2646684",  # You could've knocked.
            "5064782",  # I'm sorry, I have another commitment.
            {"text": "Could we discuss this later?", "added_for": "discuss|later", "reason": "polite-postponement Q"},
            {"text": "Of course, no rush.", "added_for": "course|rush", "reason": "polite-postponement A"},
        ],

        # === Topic: Rely / depend ===
        [
            "10078",    # You can rely on her.
            "1513132",  # Can I rely on you?
            "299806",   # He can be relied on.
            "32259",    # Everybody is relying on you.
            "71401",    # I'm relying on you to help us.
        ],

        # === Topic: Suggest / encourage ===
        [
            "3680892",  # May I suggest another option?
            "5838294",  # How many times have your suggestions been ignored?
            "5187463",  # I encourage you to do so.
            "2111444",  # That's encouraging.
            "2251064",  # That's encouraging news.
            "3721477",  # I'm encouraged.
            "4496910",  # Contributions are encouraged.
        ],

        # === Topic: Adopt / kid ===
        [
            "4977044",  # Please adopt this cat.
            "3310249",  # We've decided to adopt a child.
            "3439731",  # They adopted a kid.
            "2111763",  # I'm adopted.
            "2984215",  # Would you ever consider adopting a child?
        ],

        # === Topic: Rabbit / animals ===
        [
            "320537",   # A mother rabbit keeps her babies warm with her own body.
            "2952927",  # I've never eaten rabbit meat.
            "2263367",  # Can rabbits swim?
            "4494120",  # Rabbits are social animals.
            "528286",   # Rabbits have long ears.
            "1360792",  # The rabbit hid behind the tree.
        ],
        # --- Monkeys (vocab restoration) ---
        [
            "25868",    # Monkeys climb trees.
            "3666546",  # Monkeys are intelligent.
            "1117893",  # The monkey got away.
            {"text": "Don't tease the animals.", "added_for": "tease|animals", "reason": "break 'monkey' drill"},
            "543763",   # That factory makes toys.
            "543762",   # That factory manufactures toys.
        ],
        [
            "4493867",  # Beef is more expensive than chicken.
            "18686",    # Beef is expensive nowadays.
            "4501388",  # Dogs are permitted.
            "4501387",  # Pets are permitted.
            "4495829",  # There have been some stories in the news about pets attacking their owners.
            "5154868",  # Swimming in this lake is not permitted.
            "794654",   # Smoking is not permitted on the train.
            "4501383",  # No permits are required.
            "2271981",  # I won't permit it.
            "2303606",  # I can't permit that.
        ],

        # === Topic: Wild ===
        [
            "1386864",  # That's pretty wild.
            "304283",   # He went to Africa to see wild animals.
            "3732582",  # The audience went wild.
            "1369558",  # Watching wild birds is a lot of fun.
        ],

        # === Topic: Honest / sincere ===
        [
            "3823743",  # At least they're honest.
            "283366",   # The fact that he did not accept any money shows that he is an honest man.
            "22708",    # We assume that he is honest.
        ],

        # === Topic: Lucky / accident ===
        [
            "2952983",  # If we're lucky, we'll double our money.
            "251280",   # My success was largely due to luck.
            "246523",   # I only found out about it purely by accident.
            "305111",   # I hope that neither of them was involved in the traffic accident.
            "1096502",  # Do you think the shooting was accidental?
            "4850039",  # Maybe I accidentally damaged it.
            "290905",   # He got his neck broken in the accident.
        ],

        # === Topic: Body parts ===
        [
            "272605",   # The snow was knee deep.
            "3170704",  # Mary was wearing a knee-length blue dress.
            "2245002",  # Bend your knees.
            "27048",    # I can't bend my right arm.
            "313646",   # She bent down.
            "289535",   # His knees gave way.
            "299203",   # He rested his hand on my shoulder.
            "2953212",  # Mary sat down and opened her shoulder bag.
            "3307552",  # How's your shoulder?
            "2471465",  # My neck hurts.
            "55583",    # This is a bit too tight around my neck.
        ],
        [
            "300975",   # He shook his son by the shoulder.
            "299270",   # He shook his head back and forth.
            "287992",   # He kicked it.
            "887256",   # She kicked him.
            "2250016",  # Stop kicking me.
            "2252562",  # The baby's kicking.
            "3724240",  # I chose another path.
            "248591",   # We walked along a narrow path.
            "1970568",  # I walked around the block.
            "18434",    # The bank is three blocks away.
        ],

        # === Topic: Polite / sample requests ===
        [
            "1140024",  # Would you be willing to send me a sample free of charge?
            "2299544",  # I brought some samples of my work.
            "70648",    # Would you show us some samples of your work?
            "1129468",  # Could you wrap them up separately?
            "320322",   # Could you wrap this separately, please?
            "3153447",  # Shall I wrap it for you?
            "4013865",  # Do you have any wrapping paper?
            "3726223",  # That about wraps it up.
            "4480266",  # The plan was kept under wraps until the last minute.
        ],

        # === Topic: Took for granted ===
        [
            "262860",   # We all took for granted that the professor could speak English.
            "324910",   # The request was granted.
            "4499077",  # Several grants are available.
            "4499078",  # There are grants available.
        ],

        # === Topic: Cracking ===
        [
            "45104",    # The cup has a crack.
            "5829156",  # I cracked up.
            "2313700",  # I cracked the code.
            "1329863",  # I'm cracking up.
            "4846651",  # I need to get cracking.
            "57438",    # This ice is going to crack.
            "4497080",  # There was a crack in the mirror.
        ],

        # === Topic: Iron / metal ===
        [
            "61375",    # Please fix the iron.
            "4013910",  # There are some details to iron out.
            "504865",   # You must strike while the iron is hot.
            "240718",   # Strike while the iron is hot.
            "53085",    # Please iron the shirt.
            "3333917",  # Did you iron all the shirts?
            "278744",   # Iron is harder than gold.
            "467339",   # Iron is a useful metal.
            "259883",   # I burned my fingers on a hot iron.
            "18578",    # Gold is heavier than iron.
            "352720",   # Is this pure gold?
            "442974",   # Is that pure gold?
        ],

        # === Topic: Tie / clothing ===
        [
            "843583",   # Tie your shoes.
            "843584",   # Tie your shoe.
            "60735",    # This tie matches your suit.
            {"text": "It's a sharp combination.", "added_for": "sharp|combination", "reason": "break 'tie' drill"},
            "887203",   # She helped him tie his tie.
            "2268754",  # These ties aren't mine.
            "2259519",  # These ties are very expensive.
            "5592145",  # I wore this tie yesterday.
            "289333",   # He wore a light blue tie.
            "2360687",  # I haven't worn this tie in almost three years.
            "5099633",  # This was my dad's favorite tie.
            "5909655",  # I only wear a tie on special occasions.
            "290179",   # He looked quite handsome in his suit and tie.
        ],
        [
            "1682711",  # My hands are tied.
            "257252",   # I tied my dog to the tree in the yard.
            "2264755",  # Can you tie a bow?
            "3826059",  # Stand up and take a bow.
            "5828612",  # I bowed.
            "653440",   # I bowed politely.
        ],
        [
            "3151448",  # Give me your belt.
            "3155588",  # Put your seat belt on.
            "26592",    # Drivers should wear seat belts.
            "388284",   # People who drive cars should wear seat belts.
            "4183134",  # Your sweater is on backwards.
            "2643412",  # Your T-shirt's on backwards.
            "5852815",  # I fell backwards.
        ],
        [
            "255500",   # I bought a pair of boots.
            "315750",   # She likes short skirts.
            "2454219",  # Mary often wears long skirts.
            "2377470",  # I like that skirt.
            "6110481",  # I like the color of your skirt.
            "296251",   # He wears thick glasses.
            "242486",   # You're very stylish.
            "775717",   # This is not very stylish.
            "3734949",  # That's an old-fashioned expression.
        ],

        # === Topic: Wipe / clean ===
        [
            "1774522",  # Wipe your nose.
            "20756",    # Wipe your face clean.
            "317474",   # She wiped away her tears.
            "294996",   # He wiped the sweat off his face.
            "5938262",  # I'm wiping the table.
            "308172",   # She broke into tears.
        ],

        # === Topic: Knock / door / loud ===
        [
            "530050",   # Please knock before entering.
            "281912",   # Please knock on the door before you enter.
            "3658348",  # Don't knock it unless you try it first.
            "325258",   # The storm knocked out power.
            "2805631",  # The wave knocked me off my feet.
            "2111540",  # Someone's knocking.
            "276124",   # I heard someone knocking.
            "1396387",  # She'd just begun to read the book when someone knocked at the door.
        ],

        # === Topic: Phone / charger / computer ===
        [
            "279244",   # If the phone rings again, I will ignore it.
            "1065424",  # If the phone rings again, I plan to ignore it.
            "3825786",  # I can't find my phone charger.
            "5669998",  # I've left my charger at home.
            "1201478",  # I'll need to download it.
            "2245727",  # I downloaded it.
            "3702794",  # I've downloaded some stuff.
            "3308289",  # I'm downloading the pictures now.
            "991956",   # I do work related to computers.
            "4643092",  # My computer won't boot up.
            "3241511",  # My computer crashed and now it won't boot up.
            "4198257",  # It's recommended that you don't write your passwords down where others might see them.
            "4493854",  # Passwords are usually case sensitive.
        ],

        # === Topic: Background / classics / music ===
        [
            "3826401",  # I'll stay in the background.
            "4665123",  # A background check is required.
            "5193390",  # I want to meet people from all types of backgrounds.
            "2077741",  # It's a classic.
            "4983611",  # I still love classic rock.
            "3822164",  # I enjoy classical music.
            "256319",   # I like music, especially classical music.
            "2782445",  # My father listens to classical music.
            "321747",   # I like instrumental music.
        ],

        # === Topic: Author / novel ===
        [
            "593248",   # He's an author.
            "1035154",  # What's his most recent novel?
            "703016",   # When was this novel published?
            "68295",    # I was reading a novel then.
            "838675",   # This novel was written by a famous American writer.
            "321688",   # I haven't read the final page of the novel yet.
            "303920",   # He reads a novel every day.
            "630620",   # This novel is boring.
            "3007285",  # Do you enjoy mystery novels?
            "58067",    # I spent last Sunday reading novels.
            "546772",   # Every author suffers from writer's block from time to time.
            "290087",   # He often quotes from Shakespeare.
        ],
        [
            "4494921",  # Here's a novel idea.
            "4905007",  # Keep track of your finances.
            "320024",   # A capital letter is used at the beginning of a sentence.
            "16886",    # Write your name in capitals.
        ],

        # === Topic: Sing / tune ===
        [
            "306105",   # They sang in tune.
            "315846",   # She sings out of tune.
            "5948247",  # This piano needs to be tuned.
            "4550340",  # This piano has probably not been tuned for years.
            "3395922",  # What tunes are you going to play tonight?
            "70680",    # Who is your favorite composer?
        ],
        [
            "2751136",  # A string on my guitar broke.
            "3824300",  # There are no strings on this guitar.
            "60603",    # This string is strong.
            "325370",   # He can pull strings for you.
        ],

        # === Topic: Sports — baseball / tennis ===
        [
            "262006",   # I belong to the baseball team.
            "263303",   # We had a conversation about baseball.
            "262814",   # We watched a baseball game on television.
            {"text": "It went into extra innings.", "added_for": "extra|innings", "reason": "break 'baseball' drill"},
            "924170",   # My dream is to become a baseball player.
            "42084",    # It was a really exciting baseball game.
            "26974",    # Let's play baseball when the rain stops.
            "5356994",  # Baseball is boring.
            "4496002",  # Baseball season has begun.
            "4017059",  # When did you start liking baseball?
        ],
        [
            "255092",   # I played tennis.
            "303899",   # He plays tennis every day.
            "1318884",  # I'm sure I'll win the tennis match.
            "2259747",  # We bought some tennis balls.
            "255084",   # I'm a member of the tennis club.
            "59633",    # Is there a tennis court around here?
            "261497",   # I usually take a shower after I play tennis, but today I couldn't.
            "887229",   # She intends to play tennis.
            "887228",   # She intends to play tennis tomorrow afternoon.
            "262010",   # I prefer soccer to baseball.
            "270873",   # I like swimming and playing basketball.
            "5461914",  # We're basketball players.
            "35411",    # In basketball, tall players have an advantage.
            "5189153",  # I used to coach my son's basketball team.
            "293846",   # He threw the ball to first base.
            "301150",   # He has a high batting average.
            "5851664",  # I stole a base.
            "4500713",  # The bases were loaded.
        ],
        [
            "5190561",  # They've won many competitions.
            "776162",   # They won many competitions.
            "5364149",  # The competition will be intense.
            "72861",    # The two companies are competing with each other.
            "4664640",  # I'm looking forward to competing.
            "1951417",  # I can't compete.
            "3393296",  # How can I compete?
            "4667228",  # We both competed.
        ],

        # === Topic: Fishing / hunting ===
        [
            "2547309",  # I'd rather be fishing.
            "2006509",  # I was hoping to go fishing today.
            "1635793",  # I live in a small fishing village.
            "297144",   # When he was a child, he would go fishing on Sundays.
            "291873",   # He went fishing instead of playing tennis.
            "953246",   # Don't bother waking me up at 4:00 a.m. I don't plan to go fishing tomorrow.
        ],
        [
            "2247928",  # I'm apartment hunting.
            "299957",   # He went hunting in the woods.
            "913531",   # Hunting is not allowed in national parks.
        ],

        # === Topic: Cooking / kitchen ===
        [
            "325209",   # Mix three eggs and a cup of sugar.
            "35199",    # Butter is made from cream.
            "1841526",  # Where's the butter?
            "3737753",  # Where's my apple juice?
            "62662",    # It's my fault that the cake was burned.
        ],

        # === Topic: Tomato / fruits / vegetables ===
        [
            "1830477",  # You should eat a variety of fresh fruits and vegetables.
            "37444",    # Is a tomato a fruit or a vegetable?
            "2330015",  # I grow tomatoes.
            "2549559",  # I hate tomatoes.
            "5794326",  # I love growing tomatoes.
            "2258732",  # I can't reach that can of tomatoes.
            "255274",   # I don't like the taste of tomatoes.
            "262712",   # We grow a variety of crops.
            "320232",   # The rice crop is large this year.
            "59313",    # We'll have a good crop if this good weather keeps up.
        ],
        [
            "559000",   # Bananas are yellow.
            "255927",   # I like bananas more than apples.
            "1738786",  # I'm eating a banana.
            "898531",   # I have never fed my dog a banana.
            "3170677",  # The lettuce has turned brown.
            "3932276",  # Should I wash the lettuce?
            "4063916",  # I wish I'd planted more lettuce this year.
            "5205482",  # I just want a little more variety in my life.
        ],

        # === Topic: Hurry / rush ===
        [
            "2249237",  # It's rush hour.
            "2275289",  # Don't rush on my account.
            "3425636",  # Everyone rushed outside.
            "19721",    # I rushed out of my house.
            "4501880",  # Everyone was rushing around.
            "3819599",  # Where are you rushing off to?
            "2705734",  # You'd better hurry, otherwise you won't get there before dark.
            "26828",    # After the rain had let up a bit, we made a dash for the car.
        ],

        # === Topic: Lean / stretch / movement ===
        [
            "2249514",  # Lean in closer.
            "327802",   # Please don't lean out of the window when we're moving.
            "303544",   # He was leaning against the wall.
            "2954191",  # Who's that guy leaning against your car?
            "3722022",  # I leaned forward.
            "5840447",  # I leaned back.
            "2007609",  # Let's stretch our legs.
            "42539",    # That's stretching the point.
            "2542615",  # I was just stretching my legs.
            "1887693",  # I stretched out my arms.
            "1887694",  # I stretched out my legs.
            "58231",    # This material stretches easily.
            "681786",   # I stretch before exercising to prevent injury.
        ],

        # === Topic: Body language — nod / pause / kiss ===
        [
            "5828634",  # I nodded.
            "5829181",  # I nodded yes.
            "5828636",  # I paused.
            "4267548",  # Can you pause the video for a moment?
            "326288",   # The lovers kissed.
            "2111266",  # They're kissing.
            "953268",   # Everywhere you look you can see young couples kissing.
            {"text": "It was a romantic scene.", "added_for": "romantic|scene", "reason": "break 'kiss' drill"},
            "887355",   # She returned his kiss.
            "1852505",  # Go kiss someone else.
            "4531427",  # Give me a goodbye kiss.
            "2016645",  # I want to give you a goodbye kiss.
            "3914075",  # I wish I hadn't kissed you.
            "887075",   # She didn't intend to let him kiss her.
        ],

        # === Topic: Shouting / loud / bang ===
        [
            "5828676",  # I shouted.
            "300524",   # He shouted at the top of his voice.
            "3820850",  # Stop shouting.
            "1123565",  # I heard someone shouting.
            "279585",   # Don't shout.
            "4940139",  # Please don't shout.
            "5207786",  # I heard a loud bang.
            "2064924",  # I just banged my head on something.
            "2293488",  # I banged on the door, but nobody answered.
            "1961237",  # I thought I heard someone banging on the wall.
            "3726150",  # We hit a bump.
            "301561",   # He bumped his head against a post.
            "35391",    # I bumped into an old friend on the bus.
            "852871",   # I bumped into your dad yesterday.
            "2546216",  # I keep bumping into you.
            "5850429",  # I keep bumping into things.
            "3183470",  # You speak so quietly I can barely hear you.
        ],

        # === Topic: Cheer / encouragement ===
        [
            "239441",   # Cheer up!
            "3735422",  # This will cheer you up.
            "2094801",  # Everyone cheered.
            "4496541",  # They cheered loudly.
            "4496542",  # Everyone's cheering.
            "2094846",  # Everybody started cheering.
            "4498267",  # People respond to encouragement.
            "70734",    # Your words of encouragement meant a lot to me.
        ],

        # === Topic: Plain / wherever ===
        [
            "306806",   # They were plainly dressed.
            "16482",    # Wherever you go, you'll be welcomed.
            "64505",    # Sit wherever you like.
            "3223061",  # You can sit wherever you want.
            "250764",   # My dog follows me wherever I go.
            "276438",   # Invite whoever you like.
            "71453",    # You may invite whoever you like.
        ],

        # === Topic: Manner / behavior ===
        [
            "285468",   # I don't like his affected manner of speaking.
            "503828",   # It's bad manners to talk during a concert.
            "1224539",  # He kindly answered the question.
            "46424",    # I wish I had treated the girl more kindly.
            "2241534",  # We'll ask politely.
            "278302",   # Please be gentle.
            "1898160",  # There's no need to be gentle.
            "2218094",  # You're being childish.
            "2267919",  # That's childish.
        ],

        # === Topic: Announcement / register ===
        [
            "2358665",  # I have a brief statement.
            "1887355",  # I have an announcement.
            "2358841",  # I have a very sad announcement to make.
            "1397605",  # Please send this by registered mail.
            "2245700",  # I didn't register.
            "4497965",  # Where do we register?
            "5137603",  # About thirty people have registered.
        ],

        # === Topic: Demonstrate / experiment / demonstrations ===
        [
            "2283722",  # I'll demonstrate.
            "3733562",  # Allow me to demonstrate.
            "2645527",  # Give us a demonstration.
            "2645528",  # Give me a demonstration.
            "73281",    # In the 1960's, Japanese college students demonstrated against their government.
            "73282",    # There were demonstrations against the government by Japanese university students in the 1960's.
            "2476559",  # The police have uncovered new evidence related to the case.
            "265199",   # The experiment was successful.
            "46896",    # That experiment was a failure.
            "2359090",  # I've been experimenting with that.
            "3164454",  # They kept their findings secret.
        ],

        # === Topic: Predict / future ===
        [
            "1629747",  # I can't predict the future.
            "2745142",  # Can you predict the future?
            "2243662",  # They're predicting rain.
            {"text": "We'll need umbrellas.", "added_for": "umbrellas|need", "reason": "break 'predict' drill"},
            "3824250",  # They were predicting this would happen.
            "2246041",  # I predicted it.
            "4500132",  # I predicted this.
            "2249575",  # Make a prediction.
            "3831399",  # Your prediction finally came true.
            "3831722",  # My predictions were accurate.
            "4501524",  # What are your predictions?
        ],

        # === Topic: Truthful / willing ===
        [
            "2203475",  # You're truthful.
            "2203474",  # We're truthful.
            "1907559",  # I did it willingly.
            "2547662",  # I'm willing to share.
            "3733977",  # I'm willing to admit I was wrong.
            "1096420",  # I'm willing to go anywhere you go.
            "6108523",  # Aren't you willing to help me paint my house?
            "5598572",  # Are you really willing to help me paint my house?
            "4497200",  # I might be willing to help, depending on what you want me to do.
        ],

        # === Topic: Insist / refuse ===
        [
            "5825542",  # I insist upon that.
            "2361032",  # I insist on being paid in advance.
            "5851502",  # I insisted on paying.
            "309968",   # She insisted on my paying the bill.
            "3930181",  # I refuse.
            "3734252",  # They're refusing to work.
            "4013546",  # Are you refusing my request?
            "299339",   # He refused my offer for no good reason.
            "681879",   # My boss refused my request for a raise.
            "293483",   # He refused to shake hands.
            "314353",   # She refused my invitation.
            "681878",   # I refuse to listen to your excuses.
        ],

        # === Topic: Beg / plead ===
        [
            "325154",   # I'm begging you.
            "887000",   # She begged him to stay.
            "241106",   # I begged her not to go.
            "24940",    # I beg your pardon?
            "403057",   # I beg your pardon. What did you say?
        ],

        # === Topic: Resist / oppose ===
        [
            "2187192",  # Don't resist.
            "684473",   # Stop resisting!
            "21006",    # I can't resist sweet things.
            "4812966",  # People are sometimes resistant to change.
            "285033",   # Don't oppose him.
            "65858",    # I oppose it.
        ],

        # === Topic: Backup / back off ===
        [
            "2111945",  # Bring backup.
            "5262886",  # I have no backup plan.
            "2548230",  # I'm not backing out.
            "3359733",  # Are you backing out already?
            "5828981",  # I backed off.
        ],

        # === Topic: Investigate / explore / escape ===
        [
            "2111620",  # Let's investigate.
            "271452",   # The government appointed a committee to investigate the accident.
            "44739",    # Every part of the island has been explored.
            "2953170",  # Let's explore the possibilities.
            "4498275",  # The possibilities were endless.
            "1574145",  # Let's do some exploring together.
            "2249383",  # It's worth exploring.
            "4904857",  # This movie explores the possibilities.
            "4498278",  # The questions were endless.
            "4498339",  # Everyone escaped injury.
            "301369",   # He escaped from prison.
            "2951910",  # How were you able to escape from prison?
        ],

        # === Topic: Prison / crime narrative (mild — kept under loosened policy) ===
        [
            "296189",   # I hear he was released after five years in prison.
            "288367",   # He served a ten-year prison term.
            "2247974",  # I'm facing prison.
            "1427987",  # By the time you get out of prison, she'll be married.
            "2849371",  # I was a prison warden for ten years.
            "2091215",  # No one ever escapes from this prison.
        ],
        [
            "324816",   # The suspect was hiding out in the mountains for three weeks.
            "4495724",  # Police arrested three suspects.
            "2301290",  # I can prove who the murderer is.
            "238301",   # The police managed to track down the owner of the car.
            "4496146",  # I'm glad the guys who broke into your house got caught.
            "806887",   # I deny all those charges.
            "5816016",  # The punishment must fit the crime.
            "4279932",  # What's my punishment?
            "404668",   # He admitted that he had committed the crime.
            "3511241",  # Whoever stole the money should be fired.
        ],

        # === Topic: Lend / borrow ===
        [
            "5924905",  # Can you lend me a dollar?
            "2760958",  # My mom had to lend me her keys.
            "297718",   # He lent me two books.
            "1318768",  # I lent my friend some money.
            "5850162",  # I'll lend you my textbook.
            "4198267",  # I'll lend you my textbook if you promise not to write anything in it.
            "17080",    # Would you mind lending me your car?
            "257061",   # I don't mind lending some money to you.
        ],
        [
            "2342661",  # Can I borrow your brush?
            "2396290",  # May I borrow your lighter?
            "29758",    # Can I borrow your radio?
            "3422149",  # You're welcome to borrow my car.
            "66186",    # You can borrow my car anytime.
            "3329557",  # Can I borrow your cell phone today?
            {"text": "Sure, here you go.", "added_for": "sure|go", "reason": "break 'borrow' drill with quick A"},
            "1075506",  # Could I borrow a pencil?
            "2545629",  # Can I borrow your pencil?
            "2545021",  # Could I borrow your ruler?
            "3269293",  # May I borrow a ruler?
            "3385042",  # Do you have a letter opener I can borrow?
            "321617",   # I borrowed the book from this library.
            "2309377",  # I didn't steal it. I just borrowed it.
            "2329624",  # I got rid of all my old textbooks.
        ],

        # === Topic: Driving / instructor / work ===
        [
            "19004",    # My driving instructor says I should be more patient.
            "2430110",  # My driving instructor says that I need to be more patient.
            "326345",   # The workers united to demand higher wages.
            "48002",    # The factory decided to do away with the old machinery.
            "1951425",  # We can't confirm that Canadians were involved.
            "242446",   # I have a lot of assignments to do today.
            "2234081",  # What's my assignment?
            "4529616",  # This wasn't an easy assignment.
        ],

        # === Topic: Shift / job ===
        [
            "3831383",  # Your shift ends at 2:30.
            "6270221",  # My shift starts at 2:30.
            "1471414",  # Can you drive a stick shift?
            "1429277",  # Starting next week, I'll be on the late shift.
            "4133464",  # Why do you want to change shifts?
            "3409317",  # The wind has shifted.
            "4026545",  # The wind is shifting.
            "5130700",  # You should speak with your employer.
        ],

        # === Topic: Model (older / type) ===
        [
            "1453163",  # It's an older model.
            "321969",   # I have many model cars.
            "261960",   # I made a model plane.
            "318982",   # My dad bought a model plane for me for Christmas.
            "4014341",  # Have you ever thought about modeling?
        ],

        # === Topic: Retire / age ===
        [
            "510573",   # I'm retired.
            "5902867",  # I should retire.
            "2111687",  # I'm retiring.
            "2203786",  # We're retiring.
            "325120",   # He retires next spring.
            {"text": "I plan to travel afterward.", "added_for": "travel|afterward", "reason": "break 'retire' drill"},
            "2545937",  # I'm nowhere near thirty.
            "3568438",  # I'm roughly the same age as you.
            "4062878",  # You guys are roughly the same age as we are.
            "5131977",  # We're approximately the same height.
            "1981269",  # Could you please tell me your height and weight?
        ],

        # === Topic: Confidence / succeed ===
        [
            "4999840",  # I'm confident in my ability.
            "1293313",  # I'm confident that you'll succeed.
            "2451197",  # Do you have any similar expressions in French?
            "5760330",  # That's one of my favorite expressions.
        ],

        # === Topic: Struggle / fight / battle ===
        [
            "4502375",  # It's been a struggle.
            "5828961",  # I struggled.
            "2111358",  # They struggled.
            "2111897",  # Don't struggle.
            "5363906",  # The middle class is struggling.
            "5166534",  # I'm not a fighter.
            "4904973",  # You look like a fighter.
            "3726965",  # I fight my own battles.
            "2300702",  # I can fight my own battles.
            "4984206",  # The battle lasted a week.
            {"text": "It felt much longer than that.", "added_for": "longer|than", "reason": "ties 'lasted/longer' for vocab"},
        ],

        # === Topic: Sink ===
        [
            "2107360",  # We're sinking.
            "2244929",  # Are we sinking?
            "282677",   # We're sunk.
            "3862507",  # The ship began to sink.
            "244328",   # A ship sank near here yesterday.
            "313144",   # She felt sick and sank to the ground.
        ],

        # === Topic: Blocked / view ===
        [
            "4496096",  # Roads are blocked.
            "1292956",  # Fallen rocks blocked the way.
            "1751525",  # You're blocking my view.
            "2474216",  # That car is blocking traffic.
        ],

        # === Topic: Sliding doors ===
        [
            "5938440",  # I slid the door open.
            "5938438",  # I slid the door shut.
        ],

        # === Topic: Mystery / meaning ===
        [
            "4501724",  # That remains a mystery.
            "1216239",  # Nature is full of mystery.
            "2241152",  # We love mysteries.
            "2245936",  # I like mysteries.
        ],
        [
            "42620",    # That's quite meaningless.
            "2065607",  # Life without love is meaningless.
            "2026428",  # I wanted to write something meaningful.
            "2033696",  # I wanted to say something meaningful.
            "5290987",  # Is there such thing as a truly selfless act?
            "2203321",  # We're selfish.
            "2203322",  # You're selfish.
        ],

        # === Topic: Trait adjectives — faithful / sensitive ===
        [
            "2202833",  # We're faithful.
            "2202834",  # You're faithful.
            "2203327",  # We're sensitive.
            "2202610",  # You're believable.
            "2249111",  # It's not believable.
            "2202852",  # We're fearless.
            "2111293",  # They're fearless.
            "2202796",  # We're efficient.
            "2203145",  # We're organized.
            "2202577",  # You're artistic.
        ],

        # === Topic: Tone / denying ===
        [
            "2276115",  # I don't like your tone.
            "2547719",  # I'm not denying that.
            "2270323",  # Don't bother denying it.
            "73556",    # He denied knowing anything about their plans.
            "31999",    # Mary denied having stolen the money.
            "4497178",  # Those requests were denied.
            "4497182",  # The requests were denied.
        ],

        # === Topic: Marks / rarely ===
        [
            "4500980",  # X marks the spot.
            "325863",   # I tried to get good marks.
            "2547400",  # I rarely get visitors.
            "4499237",  # This rarely happens.
            "258113",   # I rarely go to the movies.
            "5916497",  # I rarely read magazines.
            "4943630",  # I'm rarely invited to parties.
        ],

        # === Topic: Expert / amazed ===
        [
            "2955069",  # You're the strategy expert.
            "3824705",  # You're an expert in the field.
            "1233289",  # I'm not an expert, so my answer to your question is just an educated guess.
            "292972",   # He speaks as if he were an expert.
            "4529750",  # The experts were amazed, too.
            "5187055",  # I was absolutely amazed.
        ],

        # === Topic: Affair / conflict ===
        [
            "42358",    # That's my affair.
            "575569",   # It was a terrible affair.
            "3922335",  # We have a conflict of interest here.
            "6029153",  # We have conflicting opinions on the matter.
            "1396352",  # He doesn't seem to be aware of the conflict between my father and me.
        ],

        # === Topic: Importance / consequence ===
        [
            "2543612",  # I'm aware of its importance.
            "55534",    # This is considered to be a matter of great importance.
            "762149",   # Today, I plan to talk about the importance of sports in modern society.
            "295335",   # He placed emphasis on the importance of education.
            "2287009",  # It's of no consequence.
            "2286993",  # Every action has its consequence.
            "5759935",  # First impressions matter.
            "3501302",  # First impressions are the most lasting.
            "4500191",  # The warnings were ignored.
            "314315",   # She ignored all my warnings.
            "2953545",  # We appreciate the warning.
            "2707390",  # This rule is often ignored.
        ],

        # === Topic: Intentions / purpose ===
        [
            "2097089",  # That's my intention.
            "3823540",  # What's your intention?
            "2270119",  # What are your intentions?
            "4493665",  # We had good intentions.
            "5426383",  # What's your intent?
            "2548164",  # That was the intent.
            "2644591",  # Did you do that purposely?
        ],

        # === Topic: Impression / impressed ===
        [
            "2644499",  # That's my impression, too.
            "4500209",  # What was your impression?
            "1615207",  # I'm highly impressed.
            "3721691",  # The group was impressed.
            "3436750",  # Am I supposed to be impressed?
            "2280443",  # You don't impress me.
            "3441539",  # That doesn't impress me.
        ],

        # === Topic: Tools / equipment ===
        [
            "3327123",  # Get my tool box.
            "3737090",  # Bring your tool box.
            "4012300",  # Humans aren't the only animals that use tools.
            "3735929",  # I don't want to do that without the proper tools.
        ],

        # === Topic: Technique / method / skill ===
        [
            "2060038",  # I learned a new technique.
            "4013104",  # Would you like to improve your technique?
            "3618945",  # It's a commonly-used technique.
            "4497379",  # Our new method of doing that is quicker and more efficient.
            "4013282",  # It takes time to master any skill.
            "1598993",  # I have the master key.
            "21900",    # It takes a great deal of practice to master a foreign language.
        ],

        # === Topic: Objective / goal ===
        [
            "639381",   # This is our main objective.
            "69400",    # You seem to have lost sight of original objective.
            "4493638",  # We have three objectives.
            "4529628",  # Neither goal has been achieved.
            "5552769",  # We're reviewing all our options.
            "2952922",  # I've narrowed it down to three options.
            "2642035",  # We discussed a number of options.
        ],

        # === Topic: Decision / adequate ===
        [
            "2380402",  # I made an executive decision.
            "4464819",  # I'm capable of making my own decisions.
            "5364112",  # Neither decision was a surprise.
            "4502034",  # It seems adequate.
            "2248799",  # It was adequate.
        ],

        # === Topic: Definite / different ===
        [
            "3619977",  # That's a definite improvement.
            "35182",    # Give me a definite answer.
            "4497755",  # Everyone does it differently.
        ],

        # === Topic: Patient / how-is Q ===
        [
            "1885864",  # How's your patient?
            "316937",   # She assisted her mother in caring for the baby.
        ],

        # === Topic: Reminders ===
        [
            "1849383",  # Don't remind me.
            "2952575",  # I want to remind you that you have a 2:30 appointment.
            "3024015",  # That reminds me of something.
            "3423970",  # This reminds me of you.
            "1199451",  # It reminded me of you.
            "4013557",  # Thanks for the reminder.
            "2271893",  # I don't need reminding.
            "2645462",  # Thanks for reminding me.
        ],

        # === Topic: Hide / ignore ===
        [
            "4567807",  # We couldn't hide our tracks.
            "326246",   # The train ran off the tracks.
            "2218166",  # You're ignoring me.
            "2248028",  # I'm ignoring you.
            "297281",   # He ignores my problems.
            "887223",   # She ignores him completely.
            "3619816",  # I'm choosing to ignore that.
        ],

        # === Topic: Sky's the limit / success depends ===
        [
            "3455725",  # The sky is the limit.
            "271322",   # Success depends mostly on effort.
            "5844791",  # How long treatment takes depends on the patient.
        ],

        # === Topic: Smart / emotions ===
        [
            "1601",     # Imagination affects every aspect of our lives.
            "4529502",  # Mental illness can affect anyone.
            "2377416",  # I let my emotions cloud my judgment.
            "4496916",  # Control your emotions.
            "271837",   # We're getting fewer and fewer students.
            "812495",   # I have fewer books than you.
            "3238976",  # I think the other path is safer.
        ],

        # === Topic: Ideal / content / qualified ===
        [
            "4495701",  # Neither approach is ideal.
            "4016592",  # These aren't ideal conditions.
            "3096992",  # This land is ideal for farming.
            "4502020",  # They seemed content.
            "2111965",  # Be content.
            "2111964",  # Be creative.
            "1841501",  # You're creative.
            "2217884",  # You're qualified.
            "2248001",  # I'm fully qualified.
        ],

        # === Topic: Bid ===
        [
            "260453",   # I bid against him.
            "2912572",  # How much did you bid?
        ],

        # === Topic: Environment ===
        [
            "256719",   # I know a lot about environmental problems.
            "4494019",  # Is this environmentally safe?
        ],

        # === Topic: Weather permitting ===
        [
            "1503658",  # We'll leave tomorrow, weather permitting.
            "278811",   # Weather permitting, we'll start on our trip tomorrow.
            "298777",   # He is uncertain about his future.
        ],

        # === Topic: Fool ===
        [
            "4498745",  # Only fools take risks.
            "2111289",  # They're fools.
            "301700",   # He's an absolute fool.
            {"text": "We've all been there.", "added_for": "all|been", "reason": "break 'fool' drill with sympathy"},
            "3357816",  # You're acting like a fool.
            "4014517",  # What on earth makes you think you can fool me?
            "293010",   # He finally realized that Mary had made a fool of him.
            "2245300",  # Don't be fooled.
            "2954443",  # You certainly fooled me.
            "3350115",  # Stop fooling around.
            "2643782",  # You're not fooling anybody.
        ],

        # === Topic: Hospital / stomach ===
        [
            "4494096",  # Thirteen were hospitalized.
            "4493919",  # Three of them were hospitalized.
            "2541491",  # I woke up with an upset stomach.
            "64037",    # My stomach is full.
            "2718457",  # Don't drink on an empty stomach.
            "324950",   # Your eyes are bigger than your stomach.
            "1190441",  # I laughed so much my stomach hurts.
            "3396598",  # It's my stomach that's bothering me.
            "5592141",  # My stomach has been hurting all day.
            "3724373",  # This stuff makes me sick.
        ],

        # === Topic: Chew / eat ===
        [
            "268787",   # Chew your food well.
            "5182621",  # Chew with your mouth closed.
            "268650",   # I have difficulty chewing.
            "3287064",  # The dog is chewing on something.
            "2874436",  # I don't like fatty foods.
            "3824639",  # You shouldn't eat fatty foods.
        ],

        # === Topic: Tear / paper (vocab restoration) ===
        [
            "923541",   # I tore the newspaper into pieces.
            "2259729",  # Three pages have been torn out.
            "40480",    # Someone has torn two pages out of this book.
            "302580",   # He angrily tore up the letter from her.
            "247962",   # We must tear down this house.
            {"text": "It's beyond repair.", "added_for": "repair|beyond", "reason": "break 'tear' drill"},
        ],

        # === Topic: Shadow ===
        [
            "2647649",  # Keep in the shadows.
            "310232",   # She's wearing eye shadow.
            "2644104",  # Is Mary wearing eye shadow?
            "3695518",  # I've got the jack of hearts.
            "57300",    # This room gets sunshine.
        ],

        # === Topic: Signal / direction ===
        [
            "3820824",  # Don't change lanes without signaling.
            "268840",   # The signal turned green.
            "268855",   # The signal was red.
        ],

        # === Topic: Survive / barely ===
        [
            "2241024",  # We barely survived.
            "2954836",  # You were lucky to survive the attack.
            "3241690",  # I'll save you a seat in the front row.
        ],

        # === Topic: Row / front row ===
        [
            "27180",    # Please line up in a row.
            "2361326",  # I don't like sitting in the front row.
        ],

        # === Topic: Boating / row a boat ===
        [
            "5178459",  # Let's take turns rowing.
            "240301",   # Let's take turns rowing the boat.
            "249481",   # We were rowing against the current.
        ],

        # === Topic: Kids / blocks ===
        [
            "245968",   # Children play with blocks.
        ],

        # === Topic: Permission / photo ===
        [
            "4498920",  # I gave my permission for them to use my photo on their website.
            "2359545",  # I haven't given you permission to leave.
            "2852517",  # May I have permission to go inside?
            "15948",    # You ought to ask for your teacher's permission.
        ],

        # === Topic: Prayer ===
        [
            "1839525",  # I'll be praying for you.
            "2111870",  # Everyone prayed.
            "305202",   # We prayed for their happiness.
            "3821412",  # Who taught you this prayer?
            "250623",   # My prayers were answered.
            "250638",   # My prayer was answered.
            "4529694",  # My prayers have been answered.
            "2187249",  # Let's pray.
        ],

        # === Topic: Soaked / wet ===
        [
            "3374696",  # I got soaked.
            "25356",    # I got soaked to the skin.
            "2054477",  # I'm soaking wet.
            "1521934",  # You're soaking wet.
            {"text": "Let's get inside.", "added_for": "inside|get", "reason": "break 'soak' drill"},
            "1184699",  # Somebody has stolen my hair dryer.
            "980596",   # Did you bring a hair dryer?
        ],

        # === Topic: Theft / belongings ===
        [
            "462460",   # Someone stole my belongings.
            "68060",    # They must have suspected me of stealing.
            "249240",   # We suspected him of lying.
            "2241004",  # We're suspects.
        ],

        # === Topic: Sleep / barely ===
        [
            "4666265",  # I barely slept last night.
            "2241023",  # We barely spoke.
            "2243053",  # They barely spoke.
            {"text": "The mood was tense.", "added_for": "mood|tense", "reason": "break 'barely' drill"},
            "3124015",  # I barely had time for lunch.
            "2308060",  # I could barely get out of bed yesterday.
        ],

        # === Topic: Quote / example ===
        [
            "326035",   # Quote me an example.
            "5262909",  # This is a direct quote.
        ],

        # === Topic: Color / light ===
        [
            "256314",   # I painted the roof light blue.
            "2380300",  # If you mix blue and red, you'll get purple.
            "387576",   # Oil and water don't mix.
        ],

        # === Topic: Stable / steady ===
        [
            "5828924",  # I'm stable.
            "282293",   # The stable is right behind the farm house.
            "3045585",  # Where are the stables?
        ],

        # === Topic: Roof / damage ===
        [
            "319684",   # We had our roof blown off.
            "5008760",  # It was easy to obtain.
            "38369",    # How did you obtain this painting?
        ],

        # === Topic: Nurse / hospital ===
        [
            "4134522",  # My wife works as a nurse at a local hospital.
            "531585",   # She became a nurse.
            "3099925",  # The nurse has taken my blood pressure.
            "20981",    # Have you ever thought of becoming a nurse?
            {"text": "I love helping people.", "added_for": "love|helping", "reason": "break 'nurse' drill"},
            "4091323",  # The nurses were very nice to me.
            "909584",   # What do nurses spend most of their time doing?
            "3417128",  # Your mother is in a nursing home, isn't she?
        ],

        # === Topic: Gather / crowd ===
        [
            "23796",    # A big crowd gathered at the scene of the fire.
            "326540",   # A crowd of people gathered around the speaker.
            "4498791",  # People are gathering outside.
            "2248003",  # I'm gathering information.
            "268519",   # We have to gather information.
            "2329330",  # I gather you were hurt.
        ],

        # === Topic: Comparison / distinction ===
        [
            "4665272",  # There really is no comparison.
            "279079",   # Country life is very peaceful in comparison with city life.
            "4494011",  # The distinction is important.
            "4976900",  # That's an important distinction to make.
        ],

        # === Topic: Buyer / seller ===
        [
            "3150416",  # You'll find another buyer.
            "3150419",  # Do you have a buyer for these?
        ],

        # === Topic: Hardly / option ===
        [
            "3725735",  # That's hardly an option.
            "1898067",  # This seems risky.
        ],

        # === Topic: Stupidity / excuse ===
        [
            "3733501",  # Stupidity is no excuse.
        ],

        # === Topic: Whoever / liar / probability ===
        [
            "51207",    # Whoever says so is a liar.
            "4488244",  # We shared the money evenly among the three of us.
            "3444530",  # You and I are evenly matched.
            "1489910",  # In all probability, we'll arrive before them.
            "1489911",  # In all probability, we'll arrive before they do.
        ],

        # === Topic: Rewrite / rethink ===
        [
            "57218",    # You should rewrite this sentence.
            "2540949",  # I'm going to rewrite this report.
            "4442597",  # I think we may have to rethink our plan.
            "2046926",  # Tax season is a very busy time of year for accountants.
            "277914",   # The audience was mostly businessmen.
        ],

        # === Topic: Drag / drama ===
        [
            "1349329",  # What a drag!
            "22440",    # The meeting dragged on.
            "1113694",  # I'm sorry I dragged you into this.
            "4741260",  # Why are you dragging this out?
            "2539443",  # I'm sorry for dragging you into this.
            "1860494",  # Don't drag me into this.
        ],

        # === Topic: Pretend ===
        [
            "4500606",  # Let's not pretend otherwise.
            "2044899",  # Let's pretend we have a happy marriage.
        ],

        # === Topic: Horribly / failure ===
        [
            "5858842",  # I failed horribly.
            "3493834",  # Everything went horribly wrong.
        ],

        # === Topic: Reborn / new start ===
        [
            "2245770",  # I felt reborn.
            "5641712",  # I feel like I've been reborn.
        ],

        # === Topic: Partying / casual ===
        [
            "2241502",  # We were partying.
            "1345551",  # I don't feel like partying.
        ],

        # === Topic: Pitching / pitch ===
        [
            "5429988",  # Pitching isn't easy.
            "3530028",  # Thanks for pitching in.
            "1841736",  # Can you pitch?
            "2249158",  # It's pitch black.
        ],

        # === Topic: Anyhow / anyway ===
        [
            "4890260",  # What does it matter anyhow?
            "2452013",  # It might rain, but I'm going anyhow.
        ],

        # === Topic: Snap (vocab restoration) ===
        [
            "1556124",  # Snap out of it!
            "2380399",  # I made a snap judgment.
        ],

        # === Topic: Idioms — pin drop / waiting ===
        [
            "2154931",  # You could hear a pin drop.
            "5853264",  # I'll do whatever it takes to keep our customers satisfied.
        ],

        # === Topic: Army / military service (vocab restoration, kept moderate) ===
        [
            "5858089",  # I joined the army.
            "2011910",  # I want to join the army.
            "304636",   # He is an army officer.
            {"text": "He has served for ten years.", "added_for": "served|years", "reason": "break 'army' drill"},
            "319846",   # An army travels on its stomach.
        ],

        # === Topic: Attack — passive / preparedness (mild, kept under loosened policy) ===
        [
            "2241479",  # We were attacked.
            "807313",   # A week later, Germany attacked Poland.
            "22989",    # We prepared for an attack.
            "2821179",  # They're preparing for another attack.
            "807424",   # The attack began without enough planning.
            "244025",   # The first attack missed the target.
            "4017122",  # Are they planning an attack?
        ],

        # === Topic: Wedding hate (kept under loosened policy — mild drama OK) ===
        [
            "2245871",  # I hate weddings.
            {"text": "They make me uncomfortable.", "added_for": "uncomfortable|me", "reason": "softens 'hate' singleton"},
        ],

        # === Topic: Eastern / regional vocab (restoration) ===
        [
            "3630691",  # Japan is in the eastern part of Asia.
            "301748",   # He lived in a typical Japanese-style house.
        ],

        # === Topic: Long narratives (loosened policy: long sentences are fine) ===
        [
            "953079",   # 25-word money sentence — fine under loosened policy.
            "1954940",  # I can't stop you from revealing my secrets. However, I beg you not to.
            "327705",   # It's a very dangerous sport, where a slight mistake can lead to serious injury.
            "5168292",  # I wish they'd be honest and admit they don't know what's going to happen.
            "5823140",  # How were you able to stay so calm in such a scary situation?
            "2335855",  # You need to wear thick socks to keep your feet warm.
            "3938872",  # Mary asked Alice if she could borrow a dress to wear to the dance.
            "2331901",  # I had two years to finish my degree.
            "315772",   # She's signed up for a couple of night classes at the local college.
            "2031097",  # We have to leave at the crack of dawn tomorrow.
            "73306",    # If he could pass for eighteen years old, he'd join the army.
        ],

        # === Topic: Indirect speech / dialog (added Q-A pairs) ===
        [
            {"text": "Do you regret anything?", "added_for": "regret", "reason": "high-intermediate Q for emotion-talk"},
            {"text": "Only one thing, actually.", "added_for": "only|actually", "reason": "indirect answer to regret-Q"},
        ],
        [
            {"text": "It came out of the blue.", "added_for": "blue|came", "reason": "useful idiom kept at L10"},
            {"text": "I was completely surprised.", "added_for": "completely|surprised", "reason": "natural follow-up"},
        ],
        [
            {"text": "It's a piece of cake.", "added_for": "piece|cake", "reason": "common useful idiom for L10"},
            {"text": "That's easier said than done.", "added_for": "easier|said", "reason": "polite-pushback idiom"},
        ],
        [
            {"text": "Take your time.", "added_for": "take|time", "reason": "natural response to 'let me think'"},
            {"text": "I see your point.", "added_for": "see|point", "reason": "polite-agreement marker"},
            {"text": "But I still disagree.", "added_for": "disagree|still", "reason": "polite disagreement"},
        ],
        [
            {"text": "Would you mind repeating that?", "added_for": "mind|repeating", "reason": "polite clarification request"},
            {"text": "Of course, not at all.", "added_for": "course|all", "reason": "polite assent"},
        ],
        [
            {"text": "That's a fair point.", "added_for": "fair|point", "reason": "polite-agreement"},
            {"text": "I hadn't thought of that.", "added_for": "thought|hadn't", "reason": "honest follow-up"},
        ],
        [
            {"text": "On the one hand, it's risky.", "added_for": "hand|risky", "reason": "balanced-opinion structure"},
            {"text": "On the other hand, it could pay off.", "added_for": "other|pay", "reason": "balanced-opinion completion"},
        ],
        [
            {"text": "If you don't mind my asking,", "added_for": "mind|asking", "reason": "polite indirect-question opener"},
            {"text": "Go ahead, ask away.", "added_for": "ahead|away", "reason": "natural permission to ask"},
        ],

        # ============================================================
        # === Auto-paired fallbacks for orphan-sentence anchoring ===
        # ============================================================
        ["2342326", "1453348"],        # heart attack / might prove useful
    ],
}
