"""Curation plan for OGTE Level 20 — Native (~569 sentences).

L20 is the highest tier — native fluency. Learners at this level need
the most idiomatic, culturally-bound, register-rich English: slang,
wordplay, regional markers, subtle distinctions, casual asides, jokes
and references. The curated content here teaches what native speakers
actually say in informal contexts.

Curation philosophy (L20-specific):
  - Idioms are *essential* at this level — keep them aggressively.
  - Long sentences, embedded clauses, nuanced phrasing — all good.
  - Niche cultural content is mostly fine (this level IS niche-cultural).
  - Wordplay, jokes, idiosyncratic phrasing — keep.
  - Proper names in moderation — fine.
  - Body parts, narratives, drama, mild crime, political (non country-specific),
    years, numbers — fine.
  - Removed only:
      • dated brand fetishism (CNN/BMW/Pepsi name-drops with no payoff),
      • extreme drill repetition (o'clock x30+, Mary's x30, supermarket x20),
      • exact / near-duplicates,
      • bare singleton stubs that add no register value,
      • a couple of awkward isolated sentences.
"""

from __future__ import annotations


L20_PLAN = {
    "removals": [
        # ===========================================================
        # === O'clock drill — massive overflow (keep ~10 of 40+) ===
        # ===========================================================
        # The original file has 40 consecutive "X o'clock" sentences.
        # Native learners need register variety, not time-telling drills.
        # The adjacent-repetition check (4-window) would fail outright.
        {"id": "519113", "reason": "'It's nearly six o'clock.' — duplicate of 41220 'almost six o'clock'."},
        {"id": "73173", "reason": "'Let's meet at one o'clock.' — drill duplicate of 72417."},
        {"id": "250928", "reason": "'My day ends at 5 o'clock.' — drill duplicate."},
        {"id": "437009", "reason": "'I wake up at 7 o'clock.' — drill duplicate."},
        {"id": "535023", "reason": "'He came about four o'clock.' — drill duplicate of 290429."},
        {"id": "1830507", "reason": "'We'll eat at six o'clock.' — drill duplicate."},
        {"id": "247796", "reason": "'We talked till after eleven o'clock.' — drill duplicate."},
        {"id": "252591", "reason": "'I arrived here about five o'clock.' — drill duplicate."},
        {"id": "252614", "reason": "'I'll stay there till six o'clock.' — drill duplicate."},
        {"id": "1293160", "reason": "'Come here at precisely six o'clock.' — drill duplicate."},
        {"id": "243200", "reason": "'I am free till 6 o'clock this evening.' — drill duplicate."},
        {"id": "266489", "reason": "'I can have dinner ready by 10 o'clock.' — drill duplicate."},
        {"id": "288602", "reason": "'He reached home shortly before five o'clock.' — drill duplicate."},
        {"id": "290429", "reason": "'He will arrive there about five o'clock.' — drill duplicate."},
        {"id": "411889", "reason": "'Classes start at nine o'clock every day.' — drill duplicate."},
        {"id": "1424583", "reason": "'The train left at exactly five o'clock.' — drill duplicate."},
        {"id": "2313830", "reason": "'I finished my work at six o'clock.' — drill duplicate."},
        {"id": "72878", "reason": "'I've been waiting for you since two o'clock.' — drill duplicate."},
        {"id": "261824", "reason": "'I leave home before eight o'clock every morning.' — drill duplicate."},
        {"id": "2329645", "reason": "'I got tickets for the six o'clock show.' — drill duplicate."},
        {"id": "31737", "reason": "'It's already ten o'clock. My mother must be angry.' — duplicate framing of 31730."},
        {"id": "1500657", "reason": "'He always gets home at six o'clock in the evening.' — drill duplicate."},
        {"id": "70255", "reason": "'You can hear the news on the radio at nine o'clock.' — drill duplicate."},
        {"id": "317697", "reason": "'They left at 5 o'clock, so they ought to be home by 6.' — drill duplicate."},
        {"id": "18400", "reason": "'I make it a rule not to watch television after nine o'clock.' — drill duplicate."},
        {"id": "73351", "reason": "'You can go out, as long as you promise to be back by 11 o'clock.' — drill duplicate."},
        {"id": "26005", "reason": "'I managed to catch the 8 o'clock train…' — drill duplicate."},
        {"id": "252594", "reason": "'I was allowed to go there on condition…by five o'clock.' — drill duplicate."},
        {"id": "73421", "reason": "'The fog began to disappear around ten o'clock.' — o'clock drill overflow."},
        {"id": "72425", "reason": "'My airport shuttle bus leaves at six o'clock.' — o'clock drill overflow."},
        {"id": "327933", "reason": "'He caught the nine o'clock shuttle to New York.' — o'clock drill overflow."},
        {"id": "2452001", "reason": "'I was awakened at five o'clock.' — o'clock drill overflow."},

        # ===========================================================
        # === Mary's possessive drill — overflow (keep ~10 of 30+) ===
        # ===========================================================
        # 30+ "Mary's X" sentences cluster — keep the most idiomatic.
        {"id": "1841597", "reason": "'Mary's my niece.' — bare stub, no payoff."},
        {"id": "1969240", "reason": "'I'm Mary's boyfriend.' — bare stub."},
        {"id": "3024923", "reason": "'Mary's husband is rich.' — bare stub."},
        {"id": "5754862", "reason": "'I kissed Mary's neck.' — odd in isolation."},
        {"id": "3820950", "reason": "'What color is Mary's scarf?' — context-less Q."},
        {"id": "3823306", "reason": "'Mary's maiden name is Jackson.' — Mary's drill overflow."},
        {"id": "5850075", "reason": "'Did you notice Mary's earrings?' — Mary's drill overflow."},
        {"id": "32016", "reason": "'I met a friend of Mary's.' — Mary's drill overflow."},
        {"id": "1315810", "reason": "'I think he's Mary's older brother.' — Mary's drill overflow."},
        {"id": "293018", "reason": "'He put the ring on Mary's finger.' — Mary's drill overflow."},
        {"id": "1898328", "reason": "'Mary's dress doesn't fit her very well.' — Mary's drill overflow."},
        {"id": "3170695", "reason": "'Mary's nails were painted a bright red.' — Mary's drill overflow."},
        {"id": "2953220", "reason": "'Mary's baby is less than a month old.' — duplicate framing of 2641174."},
        {"id": "6241093", "reason": "'Both of Mary's ex-husbands live in Boston.' — Boston + drill overflow."},
        {"id": "5904759", "reason": "'I was the one who stole Mary's diamond ring.' — odd narrative stub."},
        {"id": "255718", "reason": "'I saw a woman who I thought was Mary's mother.' — drill overflow."},
        {"id": "5351463", "reason": "'Mary's closets are full of clothes…' — near-duplicate of 4597344."},
        {"id": "3898060", "reason": "'Mary took her earrings off and put them in the jewelry box on her dresser.' — clunky narrative."},

        # ===========================================================
        # === Supermarket drill — overflow (keep ~6 of 20) ===
        # ===========================================================
        {"id": "50313", "reason": "'The supermarket opens at ten o'clock.' — drill + o'clock combo."},
        {"id": "325220", "reason": "'They sell eggs at the supermarket.' — bare drill."},
        {"id": "569786", "reason": "'The supermarket is open Monday through Saturday.' — drill overflow."},
        {"id": "310170", "reason": "'She goes to the supermarket every three days.' — drill overflow."},
        {"id": "244771", "reason": "'A fire broke out in the supermarket last night.' — drill overflow."},
        {"id": "1403474", "reason": "'Do you know what time that supermarket closes?' — drill overflow."},
        {"id": "4498944", "reason": "'The prices at the supermarket where I go are reasonable.' — drill overflow."},
        {"id": "4134995", "reason": "'This is the supermarket where we usually do most of our shopping.' — drill overflow."},
        {"id": "2042882", "reason": "'Are you sure you don't want me to buy you something at the supermarket?' — drill overflow."},
        {"id": "4496214", "reason": "'It took me three trips to the supermarket…' — drill overflow."},

        # ===========================================================
        # === Policeman drill — overflow (keep ~6 of 15) ===
        # ===========================================================
        {"id": "238139", "reason": "'The policeman arrested the thief.' — bare policeman drill."},
        {"id": "257163", "reason": "'I asked a policeman for directions.' — bare policeman drill."},
        {"id": "257162", "reason": "'I told the policeman what I knew.' — bare policeman drill."},
        {"id": "238107", "reason": "'The policeman blamed the taxi driver for the accident.' — policeman drill overflow."},
        {"id": "238129", "reason": "'The policeman separated the two men who were fighting.' — policeman drill overflow."},
        {"id": "825472", "reason": "'A policeman asked the girls if the car was theirs.' — policeman drill overflow."},
        {"id": "238390", "reason": "'The policeman told me that the last bus leaves at ten.' — policeman drill overflow."},
        {"id": "2601565", "reason": "'The policemen shot at the car's tires.' — near-duplicate of 2601564 ('fired at')."},
        {"id": "238382", "reason": "'Not all policemen are brave.' — policemen drill overflow."},
        {"id": "73417", "reason": "'Ten policemen were assigned to patrol that area.' — policemen drill overflow."},
        {"id": "35879", "reason": "'New York City policemen wear dark blue uniforms.' — policemen drill overflow + US-specific."},

        # ===========================================================
        # === Santa Claus drill — overflow (keep ~4 of 8) ===
        # ===========================================================
        {"id": "401555", "reason": "'Santa Claus was standing in the garden.' — odd Santa stub."},
        {"id": "53933", "reason": "'I don't believe that Santa Claus is imaginary.' — confusing double-negative."},
        {"id": "6524445", "reason": "'I wonder whether or not there really is a Santa Claus.' — Santa drill overflow."},
        {"id": "652440", "reason": "'I was nine years old when I asked my mom if Santa Claus really existed.' — Santa drill overflow."},

        # ===========================================================
        # === Lousy drill — keep variety, drop pure repetition ===
        # ===========================================================
        # Original has 'I'm a lousy fisherman/swimmer/singer/cook' — pure
        # noun-swap drill. Keep two, drop two.
        {"id": "2548278", "reason": "'I'm a lousy swimmer.' — drill duplicate of 2547237."},
        {"id": "2548740", "reason": "'I'm a lousy singer.' — drill duplicate of 2547237."},

        # ===========================================================
        # === Misplaced drill — overflow ===
        # ===========================================================
        {"id": "2359960", "reason": "'I've misplaced my wallet.' — pure noun-swap of 2359959 ('my keys')."},
        {"id": "2291878", "reason": "'I appear to have misplaced my keys.' — duplicate of 2359959 with hedge."},

        # ===========================================================
        # === Sunscreen drill — overflow ===
        # ===========================================================
        {"id": "5938087", "reason": "'I forgot to put on sunscreen.' — drill duplicate of 2240160 framing."},

        # ===========================================================
        # === Mailbox overflow ===
        # ===========================================================
        {"id": "2120582", "reason": "'There's no mail in the mailbox.' — bare mailbox stub."},
        {"id": "1744737", "reason": "'I have to check my mailbox.' — bare mailbox stub."},

        # ===========================================================
        # === Sleeper drill — overflow (keep one) ===
        # ===========================================================
        {"id": "2548281", "reason": "'I'm a heavy sleeper.' — paired with light/sound sleepers, drill."},
        {"id": "4963999", "reason": "'I'm a sound sleeper.' — paired drill of 322734."},

        # ===========================================================
        # === Australia's stats drill ===
        # ===========================================================
        {"id": "3738932", "reason": "'What's Australia's third largest city?' — country-trivia drill."},
        {"id": "2949054", "reason": "'What are some of Australia's major exports?' — duplicate framing of 2949057."},

        # ===========================================================
        # === Where's an ATM — drill overflow ===
        # ===========================================================
        {"id": "5577216", "reason": "'Where is an ATM?' — duplicate of 4059007 'Where's an ATM?'"},
        {"id": "1115800", "reason": "'Is there an ATM close by?' — duplicate of 1115802 'nearby'."},

        # ===========================================================
        # === Payday duplicate ===
        # ===========================================================
        {"id": "4538716", "reason": "'Tomorrow's payday.' — bare duplicate of 831675 'Tomorrow is payday.'"},

        # ===========================================================
        # === Mansion duplicate ===
        # ===========================================================
        {"id": "5230155", "reason": "'I hope to live in a mansion someday.' — word-order duplicate of 5229979."},

        # ===========================================================
        # === Coke/Pepsi paired duplicate ===
        # ===========================================================
        {"id": "3850971", "reason": "'Which do you like better, Coke or Pepsi?' — pure rephrasing of 3850960."},

        # ===========================================================
        # === Sophomore / psychologist paired stubs ===
        # ===========================================================
        {"id": "6092037", "reason": "'Aren't you a sophomore?' — duplicate framing of 4494933."},
        {"id": "6094458", "reason": "'Aren't you a psychologist?' — duplicate framing of 2646113."},

        # ===========================================================
        # === Unconstitutional paired stubs ===
        # ===========================================================
        {"id": "4494283", "reason": "'Is that unconstitutional?' — duplicate of 3227936."},

        # ===========================================================
        # === Measles paired duplicate ===
        # ===========================================================
        {"id": "4493853", "reason": "'The measles virus is very contagious.' — super/very duplicate of 4493840."},

        # ===========================================================
        # === Bloodshed paired duplicate ===
        # ===========================================================
        {"id": "3826188", "reason": "'I hope there'll be no bloodshed.' — duplicate framing of 5783318."},

        # ===========================================================
        # === Impartial paired stub ===
        # ===========================================================
        {"id": "2202973", "reason": "'We're impartial.' — paired stub-duplicate of 2202975."},

        # ===========================================================
        # === Firefighter paired duplicate ===
        # ===========================================================
        {"id": "2628998", "reason": "'My dream is to become a firefighter.' — be→become duplicate of 251937."},

        # ===========================================================
        # === Backyard barbecue overflow ===
        # ===========================================================
        {"id": "5194619", "reason": "'I want a nice backyard where I can have barbecue parties.' — duplicate framing of 5903827."},

        # ===========================================================
        # === Windshield paired duplicate ===
        # ===========================================================
        {"id": "4496571", "reason": "'You need to clean the windshield.' — your→the duplicate of 3403148."},

        # ===========================================================
        # === Dated tech / brand name-drops with no payoff ===
        # ===========================================================
        {"id": "367132", "reason": "'I often use SSH to access my computers remotely.' — niche tech jargon, not native conversational."},
        {"id": "2253827", "reason": "'Turn on CNN.' — dated network name-drop, no payoff."},
        {"id": "1354293", "reason": "'She drives a BMW.' — luxury-brand name-drop, no payoff."},
        {"id": "5840492", "reason": "'I drive a BMW.' — luxury-brand name-drop, no payoff."},
        {"id": "4015789", "reason": "'There's a BMW parked out front.' — luxury-brand name-drop, no payoff."},
        {"id": "39707", "reason": "'Who started Disneyland?' — odd context-less factoid."},
        {"id": "59307", "reason": "'That's an interesting ad.' — bare ad stub, no payoff."},

        # ===========================================================
        # === Helen Keller — sensitive framing ===
        # ===========================================================
        {"id": "4289162", "reason": "'Helen Keller was blind, deaf and mute.' — reduces a person to disability list."},

        # ===========================================================
        # === Mary appearance/cuteness — kept very light ===
        # ===========================================================
        {"id": "5848425", "reason": "'Mary is the cutest girl in town.' — appearance-judging women."},
        {"id": "2275412", "reason": "'Don't you think Mary's cute?' — appearance-judging women."},
        {"id": "4013314", "reason": "'Do you think Mary's skirt is too short?' — appearance comment + drill overflow."},

        # ===========================================================
        # === Bare file/delete stubs (no payoff at native level) ===
        # ===========================================================
        {"id": "5722394", "reason": "'Do you know how to recover a deleted file?' — tech-support stub."},
        {"id": "2245562", "reason": "'Here's the file.' — bare stub, no payoff."},
        {"id": "2245233", "reason": "'Copy this file.' — bare stub."},
        {"id": "1187330", "reason": "'Which is the correct file?' — bare stub."},
        {"id": "60593", "reason": "'Please delete this file.' — bare delete drill stub."},
        {"id": "5593330", "reason": "'Don't delete this file.' — bare delete drill stub."},
        {"id": "2404160", "reason": "'I reviewed the file.' — bare stub."},
        {"id": "2273942", "reason": "'Who deleted the file?' — bare delete drill stub."},
    ],
    "arcs": [
        # ===========================================================
        # === FIRST ARCS (3 hand-picked highest-quality openers) ===
        # ===========================================================

        # FIRST #1: Native register flag — idioms, perseverance, life truisms
        # The L20 flagship: idiomatic, observational, slightly philosophical.
        {
            "position": "first",
            "items": [
                "270545",   # Life is full of ups and downs.
                "1443601",  # We all have our ups and downs.
                {"text": "Tell me about it.", "added_for": "tell|about", "reason": "classic native-register agreement"},
                "281980",   # Perseverance, it is often said, is the key to success.
                "2291586",  # I admire your perseverance and determination.
                {"text": "That means more than you know.", "added_for": "means", "reason": "warm native-register reply"},
                "5287389",  # Repetition does not transform a lie into a truth.
            ],
        },

        # FIRST #2: Skepticism / hedging / playful jab — quintessential L20
        {
            "position": "first",
            "items": [
                "2247381",  # I remain skeptical.
                "4494253",  # The others are skeptical.
                "2301409",  # I can understand your skepticism.
                "1230620",  # I'm skeptical when I hear someone claim to speak more than five languages fluently.
                {"text": "Fair enough.", "added_for": "fair|enough", "reason": "native-register concession"},
                "1961604",  # I thought you didn't know anything about lacrosse.
                {"text": "Yeah, well, I picked some things up.", "added_for": "picked|things", "reason": "casual native deflection"},
            ],
        },

        # FIRST #3: Don't get cocky — playful warning, classic native exchange
        {
            "position": "first",
            "items": [
                "2007742",  # Let's not get cocky.
                "2270387",  # Don't get too cocky.
                {"text": "Easy, I'm just having fun.", "added_for": "easy|having", "reason": "playful native reply"},
                "2203586",  # You're witty.
                "2218012",  # You're a cutie.
                "2254533",  # What a phony!
                {"text": "Takes one to know one.", "added_for": "takes|one", "reason": "classic native idiom comeback"},
            ],
        },

        # ===========================================================
        # === Time / o'clock — kept slim, vocab-varied ===
        # ===========================================================
        # Original had 30+ o'clock sentences; this is the kept slice,
        # broken across two arcs so no content word repeats 4 in a row.
        [
            "41220",    # It's almost six o'clock.
            "73434",    # It's ten o'clock sharp.
            "31736",    # It's already past ten o'clock.
            {"text": "Where did the day go?", "added_for": "day|where", "reason": "native time-passing remark"},
            "72417",    # Let's wait until six o'clock.
            "323808",   # I'll set the alarm for seven o'clock.
        ],
        [
            "240090",   # We have an opening at two o'clock.
            "72697",    # I have an appointment with the dentist at 3 o'clock.
            "31730",    # It's already eleven o'clock. I must be leaving now.
            {"text": "Already? Time flies.", "added_for": "already|flies", "reason": "native idiom reply"},
            "244422",   # At 10 o'clock yesterday, there were hundreds of people outside.
            "252420",   # I can't see myself lying in bed until eleven o'clock.
            "4826263",  # I didn't fall asleep until after 2 o'clock in the morning.
            "72434",    # Please pick me up at the hotel at six o'clock.
        ],

        # ===========================================================
        # === Brands / dated tech — kept just enough ===
        # ===========================================================
        [
            "326826",   # I've ordered a book from Amazon.com.
            "3850960",  # Which do you prefer, Coke or Pepsi?
            {"text": "Honestly, neither.", "added_for": "honestly|neither", "reason": "native-register opt-out"},
            "62179",    # Go and buy three bottles of coke.
            "2031329",  # I want a cheeseburger, a coke and some fries.
        ],

        # ===========================================================
        # === Files / tech / inbox — modern native register ===
        # ===========================================================
        [
            "4011513",  # Did you listen to the MP3 file I sent you?
            "2245173",  # Check your inbox.
            "965928",   # The file is corrupt.
            "5059252",  # I haven't downloaded the file yet.
            {"text": "Just send it again.", "added_for": "send|again", "reason": "casual native fix"},
            "953385",   # I can't figure out how to export my email addresses to a text file.
            "5301749",  # My laptop crashed.
            "1936490",  # I'd like to file a complaint.
        ],
        [
            "463336",   # This laptop is light.
            "1739721",  # My laptop has been stolen.
            "3271936",  # This laptop belongs to me.
            "6029472",  # How much does this laptop cost?
            "3328161",  # Can I borrow your laptop?
            "681288",   # Mary keeps her laptop with her at all times.
            "953603",   # I shouldn't have put my laptop so close to the edge of the table.
        ],

        # ===========================================================
        # === WiFi / password / connection ===
        # ===========================================================
        [
            "2764432",  # Why isn't the WiFi working?
            "4844635",  # Could you tell me the Wi-Fi password?
            {"text": "It's on the fridge.", "added_for": "fridge", "reason": "natural casual answer"},
            "3402632",  # Our server will be offline on October 20th for scheduled maintenance.
            "954537",   # What does USB stand for?
            "1324756",  # I need a new USB cable.
        ],

        # ===========================================================
        # === Cellphone / ringing / dropped ===
        # ===========================================================
        [
            "2738837",  # My cellphone is ringing.
            "5772056",  # Turn off your cellphone.
            "4058015",  # I'm looking for my cellphone.
            "2291613",  # I almost dropped my cellphone into the pool.
            {"text": "That would've been a disaster.", "added_for": "disaster", "reason": "casual native commiseration"},
        ],

        # ===========================================================
        # === Latin / Arabic / dead languages ===
        # ===========================================================
        [
            "29729",    # Few students can read Latin.
            "379238",   # Latin is a dead language.
            "1312822",  # When did you start studying Latin?
            "26317",    # A lot of English words are derived from Latin.
            "1134279",  # We are learning Arabic.
            "1519475",  # Can you read Arabic?
            "67422",    # Arabic is a very important language.
        ],

        # ===========================================================
        # === Naïve / poker — bluff register ===
        # ===========================================================
        [
            "5851565",  # I'm not that naïve.
            "2245732",  # I enjoy poker.
            "2360706",  # I hear you're a poker player.
            {"text": "Word gets around fast.", "added_for": "gets|around", "reason": "native idiom"},
            "2372771",  # I just learned to play poker.
            "4768074",  # We played poker the entire day.
            "2042883",  # Let's play another hand of poker. I want a chance to win my money back.
        ],

        # ===========================================================
        # === Tab / bill / picking up — bar register ===
        # ===========================================================
        [
            "2644663",  # Who's picking up the tab?
            {"text": "I've got this one.", "added_for": "got|one", "reason": "native-register check pickup"},
            "2648765",  # Put it on my tab.
            "2641041",  # I asked the bartender for another beer.
            "3419839",  # You're an excellent bartender.
            "2713058",  # You're a really bad bartender.
            "1898224",  # The bartender didn't even card me.
            "2358767",  # I have a nephew. He's a bartender.
            "4017022",  # Have you ever worked as a bartender before?
        ],

        # ===========================================================
        # === Gym / workout / hoops ===
        # ===========================================================
        [
            "3563946",  # That's my gym bag.
            "3824276",  # I'll wait in the gym.
            "249034",   # We played basketball in the gym.
            "4503455",  # I'm a regular at this gym.
            "2301976",  # I can't go to the gym tonight.
            "2703105",  # I enjoy working out in the gym.
            "4495878",  # I joined a gym a few years back.
            "4667221",  # I belong to a gym.
            "909506",   # She has spent hours at the gym trying to lose weight.
            "258501",   # I work out in a gym two or three times a week.
            "1894539",  # Let's go to the gym and shoot some hoops.
        ],

        # ===========================================================
        # === Honored / acquaintance / formal native ===
        # ===========================================================
        [
            "2245745",  # I feel honored.
            "2539204",  # I'm honored to make your acquaintance.
            {"text": "The pleasure's mine.", "added_for": "pleasure", "reason": "native-register exchange"},
            "4529404",  # Please accept my heartfelt apology.
        ],

        # ===========================================================
        # === Cupcakes / donuts — casual food register ===
        # ===========================================================
        [
            "2230226",  # Do you like cupcakes?
            "3123346",  # Would you like a cupcake?
            "6098733",  # Aren't you going to eat that cupcake?
            {"text": "Save me one for later.", "added_for": "save|later", "reason": "casual native reply"},
            "3736814",  # Have a donut.
            "3241642",  # Save me a donut.
            "5916902",  # I baked some cupcakes.
        ],

        # ===========================================================
        # === Popcorn / snack ===
        # ===========================================================
        [
            "2240566",  # We're eating popcorn.
            "3820754",  # Popcorn is my favorite snack.
            "255593",   # I bought two bags of popcorn.
            "3820753",  # Popcorn is one of my favorite snacks.
            "1075867",  # Have you ever eaten chocolate-covered popcorn?
            "1075865",  # Would you like some more salt on your popcorn?
            "1075872",  # What brand of popcorn do you think pops the best?
        ],

        # ===========================================================
        # === Leftovers / fridge ===
        # ===========================================================
        [
            "2293479",  # I ate last night's leftovers for lunch.
            "1844214",  # Let me heat it up some leftovers for you.
            "1860574",  # Take the leftover food home with you.
            "2407775",  # I think I have some leftover pizza in the fridge.
        ],

        # ===========================================================
        # === Oatmeal / breakfast ===
        # ===========================================================
        [
            "2322737",  # I don't like oatmeal cookies.
            "4953765",  # I always have fruit and oatmeal for breakfast.
            "5904677",  # I usually eat a bowl of oatmeal for breakfast.
            "1556857",  # Add plain yogurt and soy milk.
        ],

        # ===========================================================
        # === Coffee / cafe ===
        # ===========================================================
        [
            "4384260",  # I often drink coffee at that cafe.
            "602919",   # I had a cup of coffee at the cafe.
            "4211662",  # Mary works as a waitress at a local cafe.
        ],

        # ===========================================================
        # === Backyard / barbecue ===
        # ===========================================================
        [
            "2545083",  # We have a small backyard.
            "4545469",  # We have three trees in our backyard.
            "5909717",  # I found some old coins in my backyard.
            "3315279",  # We have a big oak tree in our backyard.
            "5903827",  # We often have barbecue parties in our backyard.
            "273921",   # My grandmother was pulling up weeds in her backyard.
            "2510201",  # We have a doghouse in our backyard.
        ],

        # ===========================================================
        # === Driveway / shovel / outdoors ===
        # ===========================================================
        [
            "3396531",  # I swept the driveway for you.
            {"text": "Thanks, you didn't have to.", "added_for": "thanks|didn't", "reason": "warm native reply"},
            "2953340",  # The children were playing in the driveway.
            "5683021",  # The driveway needs to be shoveled.
            "29518",    # Where's the checkout counter?
        ],

        # ===========================================================
        # === Mary's — kept slice (native possessive register) ===
        # ===========================================================
        # Original had 30+ Mary's sentences; kept slice broken across arcs.
        [
            "2387236",  # I miss Mary's cooking.
            "5426381",  # I love Mary's hair.
            "2641174",  # Mary's baby was three weeks premature.
            "5851042",  # Mary's wedding dress was beautiful.
            "32018",    # I'm going to make a cake for Mary's birthday.
        ],
        [
            "21937",    # Mary's dream of going abroad finally became a reality.
            "2294090",  # I bet that's not even Mary's real phone number.
            "3534927",  # I wish Mary's father would let me talk to her.
            "4597344",  # Mary's closet is full of clothes that she never wears.
            "4739517",  # Mary's self-conscious about the gap between her front teeth.
            "2301338",  # I can smell Mary's perfume. She must have been here earlier.
            "2406528",  # I smelled Mary's perfume, so I knew she'd been in the room.
            "4955289",  # The other girls in Mary's class teased her about her clothes.
        ],

        # ===========================================================
        # === Earrings / jewelry ===
        # ===========================================================
        [
            "5085318",  # Mary put on her gold earrings.
            "6040099",  # Mary was wearing heart-shaped earrings.
            "3970836",  # Mary bought a pair of cheap earrings.
            "4498145",  # I drew a mustache on Mary's picture.
        ],

        # ===========================================================
        # === Mary appearance / mini-narrative ===
        # ===========================================================
        [
            "3170703",  # Mary was wearing a pink blouse with matching miniskirt.
            "3824267",  # What do you think of Mary's new hairstyle?
        ],

        # ===========================================================
        # === Cute / cutest — pets/babies ===
        # ===========================================================
        [
            "574172",   # Cookie is the cutest of all the dogs.
            "1423277",  # This is the cutest puppy I've ever seen.
        ],

        # ===========================================================
        # === Police / pull over ===
        # ===========================================================
        [
            "1401043",  # Ask the policeman.
            "3635857",  # A policeman is outside.
            "6106149",  # I was pulled over by a policeman today.
            {"text": "Did you get a ticket?", "added_for": "ticket", "reason": "natural Q follow-up"},
            "2318399",  # He ran away when he saw the policeman.
            "3922154",  # I disguised myself as a policeman.
            "295730",   # He got away disguised as a policeman.
        ],
        [
            "2426164",  # The policeman chased the robber.
            "1236479",  # The policeman grabbed the robber's arm.
            "2601564",  # The policemen fired at the car's tires.
            "4895562",  # The policemen wore gas masks and helmets.
            "2590983",  # I hate policemen like him.
            "3573799",  # Some of my best friends are policemen.
            "1333025",  # My brother-in-law is a policeman.
            "686100",   # The police officer wore a bulletproof vest.
            "4501784",  # The president's car is bulletproof.
        ],

        # ===========================================================
        # === Felony / conviction / crime ===
        # ===========================================================
        [
            "2251039",  # That's a felony.
            "3114135",  # Have you ever been convicted of a felony?
            "5502568",  # The courtroom was packed.
            "4495739",  # One gunman was arrested.
            "4493961",  # There were three getaway cars.
        ],

        # ===========================================================
        # === Gunfire / gunshot / handgun (mild crime) ===
        # ===========================================================
        [
            "2241122",  # We heard gunfire.
            "2243149",  # They heard gunfire.
            "1923406",  # We heard a gunshot.
            "1923440",  # I'm not sure what it was, but it sounded like a gunshot.
            "1886069",  # Do you own a handgun?
        ],

        # ===========================================================
        # === Sluggish / exports / economy ===
        # ===========================================================
        [
            "4498469",  # Exports have been sluggish.
            "1008921",  # America's economy is the largest in the world.
            "2949057",  # What are Australia's major imports?
            "4806325",  # The burning of coal is responsible for more than 40% of Australia's greenhouse gas emissions.
        ],

        # ===========================================================
        # === Mansion / superhero / dream big ===
        # ===========================================================
        [
            "5229979",  # I hope to someday live in a mansion.
            "5171276",  # I wish to become a superhero.
            "5599677",  # Superman can fly.
            "5859703",  # I drew a picture of a spaceship.
        ],

        # ===========================================================
        # === Someday — aspirational, kept slim ===
        # ===========================================================
        [
            "2644167",  # You'll understand someday.
            "2891857",  # Someday, we'll know.
            "1699506",  # Someday I'll beat you.
            {"text": "Big talk for a beginner.", "added_for": "big|beginner", "reason": "playful native ribbing"},
            "253089",   # I wish to visit Egypt someday.
            "3550333",  # I'd like to visit Australia someday.
            "253105",   # I want to go to Africa someday.
            "654187",   # I'd like to go to London someday.
            "1699499",  # I hope we meet again someday soon.
        ],
        [
            "1936527",  # I'd like to be on TV someday.
            "3024200",  # I'd like to return to Boston someday.
            "4818403",  # I'd like to live in Europe someday.
            "6110997",  # I still plan to do that someday.
            "953424",   # I don't know when, but it'll happen someday.
            "954713",   # Would you like to visit the White House someday?
            "1994453",  # The way you talk is going to get you in trouble someday.
            "2303571",  # I can't help but think that maybe someday you and I'll get married.
            "954436",   # This just might come in handy someday.
            "1936394",  # I'd like to perform at Carnegie Hall someday.
        ],

        # ===========================================================
        # === Internship / intern / cameraman — early careers ===
        # ===========================================================
        [
            "718376",   # I applied for a summer internship.
            "239645",   # I'm going to do an internship at a local company.
            "5852697",  # I'm an intern.
            "5853169",  # I'm a cameraman.
            "2247883",  # I'm a cheerleader.
        ],

        # ===========================================================
        # === Payday / paycheck ===
        # ===========================================================
        [
            "831675",   # Tomorrow is payday.
            "2044574",  # I'm only happy on payday.
            "4635764",  # The weather is bad and it's the day before payday…
            "2245573",  # Here's your paycheck.
            "2510756",  # I really need this paycheck.
            "5105780",  # I'm eligible to vote now.
        ],

        # ===========================================================
        # === CEO / CIA / NASA — institutions ===
        # ===========================================================
        [
            "2248275",  # I'm the CEO.
            "2547896",  # I went to med school.
            "2548483",  # We're with the CIA.
            "2853802",  # The CIA is watching you.
            {"text": "Don't be paranoid.", "added_for": "paranoid", "reason": "casual native pushback"},
            "249772",   # I have a friend who works for NASA.
        ],

        # ===========================================================
        # === IRS / taxes ===
        # ===========================================================
        [
            "1970124",  # I've got a friend at the IRS.
            "1970123",  # I didn't know you still had friends at the IRS.
        ],

        # ===========================================================
        # === Roommate / coworker — work and college ===
        # ===========================================================
        [
            "2254915",  # Who's your roommate?
            "2900725",  # My roommate is crazy.
            "1663062",  # My roommate complained about the noise.
            "3557083",  # I wish I had a roommate to hang out with.
            "2643127",  # We were roommates in college.
            "2541873",  # I'm hoping we can be roommates.
            "1098280",  # Do you like your coworkers?
            "1098282",  # I really like my coworkers.
        ],

        # ===========================================================
        # === Sophomore / yearbook / school memories ===
        # ===========================================================
        [
            "4494933",  # Are you a sophomore?
            "3734240",  # I found my high school yearbook.
            "3308326",  # We looked at our old yearbook pictures.
            {"text": "We were so young.", "added_for": "young|so", "reason": "warm nostalgic native reply"},
            "501176",   # Mary was John's girlfriend all through high school.
        ],

        # ===========================================================
        # === John's / Jane / first names ===
        # ===========================================================
        [
            "452681",   # John's two years older than me.
            "244006",   # It was Jane who came first.
            "255365",   # I promised to go to the party with Jane, and I can't let her down.
        ],

        # ===========================================================
        # === Tommy / Judy ===
        # ===========================================================
        [
            "37440",    # Tommy couldn't answer the last question.
            "349878",   # Judy looked at me.
        ],

        # ===========================================================
        # === Jackson — Mr. / Dr. ===
        # ===========================================================
        [
            "5850865",  # I was Mr. Jackson's student.
            "2948423",  # I don't like Mr. Jackson's teaching methods so much.
            "3024422",  # Dr. Jackson is one of the leading cardiologists in Boston.
        ],

        # ===========================================================
        # === Beethoven / viola / classical ===
        # ===========================================================
        [
            "5059621",  # Beethoven was a great composer.
            "759714",   # I think Beethoven is the greatest composer who ever lived.
            "4478237",  # Beethoven went over to the piano, sat down and began to play.
            "4499458",  # I have several recordings of Beethoven's Fifth Symphony.
            "2540427",  # This isn't a violin. It's a viola.
            "2050707",  # I've heard you play the viola and you're not very good, are you?
        ],

        # ===========================================================
        # === Easter / Thanksgiving — holidays ===
        # ===========================================================
        [
            "66761",    # Let's go and watch the Easter parade.
            "2044433",  # Happy Thanksgiving!
            "4013090",  # Are you doing anything for Thanksgiving?
            {"text": "Just dinner with family.", "added_for": "dinner|family", "reason": "natural answer"},
            "2032994",  # It's not a Thanksgiving dinner without turkey.
        ],

        # ===========================================================
        # === Santa Claus / reindeer ===
        # ===========================================================
        [
            "1344019",  # My son believes in Santa Claus.
            "4717637",  # Santa Claus is really just dad, right?
            "3689965",  # How old were you when you stopped believing in Santa Claus?
            "5705378",  # Did you believe in Santa Claus when you were a child?
            "5719356",  # Santa Claus has many reindeer.
        ],

        # ===========================================================
        # === Harry Potter / fandom ===
        # ===========================================================
        [
            "906772",   # What's your favorite Harry Potter book?
            "4496111",  # Which Harry Potter book is your favorite?
            {"text": "Prisoner of Azkaban, hands down.", "added_for": "hands|down", "reason": "native fan-register reply with idiom"},
        ],

        # ===========================================================
        # === Avatar / IQ / playlist — online identity ===
        # ===========================================================
        [
            "4980036",  # I like your avatar.
            "4887821",  # I don't know my IQ.
            "3821463",  # Let's make a new playlist.
            "3821464",  # I need to make a new playlist.
        ],

        # ===========================================================
        # === Telegraph / Ferris wheel — inventions ===
        # ===========================================================
        [
            "279221",   # Do you know who invented the telegraph?
            "4497497",  # Do you know who invented the Ferris wheel?
        ],

        # ===========================================================
        # === Newton / Titanic — history figures and events ===
        # ===========================================================
        [
            "2832271",  # Isaac Newton was born on December 25, 1642.
            "41213",    # The Titanic sunk on its maiden voyage.
            "1534378",  # The Titanic hit an iceberg.
        ],

        # ===========================================================
        # === Mother Teresa / Nobel ===
        # ===========================================================
        [
            "73275",    # In 1979, Mother Teresa won the Nobel Peace Prize.
        ],

        # ===========================================================
        # === DVD / CDs — dated media ===
        # ===========================================================
        [
            "392212",   # This is a DVD.
            "953725",   # I wish I could figure out how to burn a DVD.
            "67003",    # Those are my CDs.
            "29354",    # Do you have any rock CDs?
            "1937693",  # No one I know buys CDs anymore.
            "4256393",  # I never lend books or CDs to anyone.
        ],

        # ===========================================================
        # === SUV / bicycle / sidewalk — vehicles ===
        # ===========================================================
        [
            "1855263",  # I don't need an SUV.
            "264474",   # My bicycle had a flat tire, so I missed the seven o'clock train.
            "4903090",  # This carbon fiber bicycle is incredibly lightweight.
            "507983",   # You shouldn't ride a bicycle on the sidewalk.
            "259656",   # I slipped and fell on the icy sidewalk.
        ],

        # ===========================================================
        # === AC / climate control ===
        # ===========================================================
        [
            "4753832",  # Please turn up the AC a little bit.
            "65395",    # Do you mind if I turn off the AC?
        ],

        # ===========================================================
        # === Ad / response ===
        # ===========================================================
        [
            "269456",   # I have come in response to your ad in the paper.
        ],

        # ===========================================================
        # === Toothbrush / daily routine ===
        # ===========================================================
        [
            "3667179",  # Don't forget your toothbrush.
            "2674944",  # I use an electric toothbrush.
            "4663249",  # How long have you been using this toothbrush?
            "2249887",  # You shouldn't run around with a toothbrush in your mouth.
        ],

        # ===========================================================
        # === Bathtub / restroom — bathroom ===
        # ===========================================================
        [
            "1555541",  # The bathtub is dirty.
            "1860417",  # Don't sleep in the bathtub.
            "327778",   # The baby was splashing in the bathtub.
            "38932",    # Where's the restroom?
            "523175",   # She's in the restroom.
        ],

        # ===========================================================
        # === Sleeper — light sleeper (kept one) ===
        # ===========================================================
        [
            "322734",   # I'm a light sleeper.
        ],

        # ===========================================================
        # === Concussion / superficial / stomach ===
        # ===========================================================
        [
            "3826192",  # My stomach feels bloated.
            "4011839",  # It's just a superficial wound.
            "1048937",  # My daughter had a concussion.
            "3202607",  # The doctor told me I had a concussion.
        ],

        # ===========================================================
        # === Medical / MRI / IV / meds ===
        # ===========================================================
        [
            "2744199",  # I got an IV at the hospital.
            "4494726",  # The MRI was negative.
            "953481",   # I have to be honest. I was a little bit nervous the first time I had an MRI scan.
            "3444600",  # They changed my meds.
            "3343279",  # Are you taking your meds?
            "2012934",  # I don't want to go to rehab.
        ],

        # ===========================================================
        # === Contagious / measles / mumps ===
        # ===========================================================
        [
            "1010972",  # Enthusiasm is contagious.
            "3736135",  # Laughter is contagious.
            "4384452",  # Emotions are contagious.
            "4493840",  # The measles virus is super contagious.
            "65002",    # Mumps is an infectious disease.
        ],

        # ===========================================================
        # === Leukemia — kept slim ===
        # ===========================================================
        [
            "2178255",  # My aunt died of leukemia.
        ],

        # ===========================================================
        # === CPR / first aid ===
        # ===========================================================
        [
            "2245926",  # I know CPR.
            "1886090",  # Do you know CPR?
            {"text": "I took a class last year.", "added_for": "class|year", "reason": "natural answer"},
        ],

        # ===========================================================
        # === Toddler / vegetables — parenting ===
        # ===========================================================
        [
            "2252587",  # The toddler cried.
            "953323",   # How can I get my toddler to eat vegetables?
        ],

        # ===========================================================
        # === Orphanage / kids ===
        # ===========================================================
        [
            "953711",   # I was raised in an orphanage in Boston.
            "1498830",  # Mary became a nun and opened an orphanage.
            "5822532",  # It was a lot of fun singing for the kids at the orphanage.
        ],

        # ===========================================================
        # === Piggyback / daddy / family ===
        # ===========================================================
        [
            "1134607",  # Daddy, I can't walk any more. Could you give me a piggyback ride?
        ],

        # ===========================================================
        # === Rumor — native social register ===
        # ===========================================================
        [
            "293889",   # He denied the rumor.
            "2342586",  # Who started this rumor?
            "3737342",  # The rumor spread quickly.
            "41675",    # Nobody will believe that rumor.
            "49585",    # The rumor may be true.
            "1174250",  # Unfortunately, that rumor is true.
            "4494759",  # It was a silly rumor.
        ],
        [
            "241677",   # I've just heard a disturbing rumor.
            "1174249",  # I'm afraid the rumor is true.
            "33288",    # Almost all the students believed the rumor.
            "405710",   # The rumor turned out to be true.
            "311086",   # She tried to prevent the rumor from spreading.
            "306085",   # It's rumored that they are going to get married.
        ],

        # ===========================================================
        # === Exaggerate — native idiom for boasting ===
        # ===========================================================
        [
            "5324980",  # People sometimes exaggerate their abilities.
        ],

        # ===========================================================
        # === Boston / city / railroad ===
        # ===========================================================
        [
            "3024371",  # How many airports does Boston have?
            "3023973",  # This is one of Boston's finest hotels.
            "3392332",  # Boston is overrated.
            {"text": "Hey, I happen to love it.", "added_for": "happen|love", "reason": "native pushback"},
            "26041",    # Where is the railroad station?
            "968985",   # I cross the railroad tracks every morning.
            "2050668",  # Please don't play near the railroad tracks.
        ],

        # ===========================================================
        # === Railroads in Japan — historical ===
        # ===========================================================
        [
            "806872",   # There were no railroads.
            "279907",   # There were no railroads in Japan at that time.
        ],

        # ===========================================================
        # === Margarita / intoxication — cocktails ===
        # ===========================================================
        [
            "2380456",  # I make a mean margarita.
            {"text": "I'll be the judge of that.", "added_for": "judge", "reason": "native idiom challenge"},
            "5853066",  # I'm intoxicated.
            "4494651",  # Both were intoxicated.
        ],

        # ===========================================================
        # === Vending machines ===
        # ===========================================================
        [
            "264537",   # The vending machines are over there.
            "57476",    # This vending machine takes only hundred-yen coins.
            "253326",   # I lost my temper and kicked the vending machine.
        ],

        # ===========================================================
        # === Supermarket — kept slice ===
        # ===========================================================
        [
            "2542426",  # I'm headed to the supermarket.
            "3273057",  # Is there a supermarket nearby?
            "52357",    # I'm going to drop by the supermarket.
            "301600",   # He runs a supermarket in the town.
            "3264788",  # A new supermarket opened in our neighborhood.
            "3330452",  # I stopped by the supermarket on my way home.
            "249539",   # We see each other at the supermarket now and then.
            "6120698",  # Can you do me a favor and go to the supermarket and buy me some eggs?
            "4498255",  # The supermarket shelves were almost empty.
            "4795335",  # We need apples, oranges, bread and peanut butter from the supermarket.
            "4475925",  # Barcodes have made getting through the checkout much faster.
        ],

        # ===========================================================
        # === ATM / cash ===
        # ===========================================================
        [
            "4059007",  # Where's an ATM?
            "1115802",  # Is there an ATM nearby?
            "681883",   # My credit card was rejected by the ATM.
        ],

        # ===========================================================
        # === Underwater / breath ===
        # ===========================================================
        [
            "270907",   # Can you swim underwater?
            "4850048",  # Is it possible to cry underwater?
            "953684",   # I used to dream about being able to breathe underwater.
            "2594360",  # Let's see who can hold their breath underwater the longest.
        ],

        # ===========================================================
        # === Horseback / barefoot — outdoor ===
        # ===========================================================
        [
            "5850338",  # I enjoy horseback riding.
            "2764121",  # I want to go horseback riding.
            "1289785",  # I love walking barefoot on the grass.
            "565792",   # I once saw a man walk barefoot over hot coals.
            {"text": "No way, that's wild.", "added_for": "no|wild", "reason": "native astonishment"},
        ],

        # ===========================================================
        # === Campfire / marshmallows ===
        # ===========================================================
        [
            "5821709",  # We sat around the campfire, roasting marshmallows and singing songs.
            "744559",   # We were mesmerized by the pulsating glow of the embers.
        ],

        # ===========================================================
        # === Thunderstorms ===
        # ===========================================================
        [
            "2303400",  # Thunderstorms are scary.
            "4501522",  # Thunderstorms are predicted.
        ],

        # ===========================================================
        # === Handmade / craft ===
        # ===========================================================
        [
            "2731702",  # This rug is handmade.
        ],

        # ===========================================================
        # === Telescope / astronomy / planets ===
        # ===========================================================
        [
            "261734",   # I adjusted the telescope to my vision.
            "4806595",  # I purchased a telescope and a book on astronomy.
            "4806592",  # Orion is one of the most recognizable constellations.
            "3636583",  # Earth, Mars and Jupiter are planets.
            "2123555",  # That's Saturn.
            "2609640",  # Tides are caused by the moon's gravity.
        ],

        # ===========================================================
        # === UFO / sci-fi ===
        # ===========================================================
        [
            "252642",   # I have seen a UFO.
            "3635801",  # It looks like a UFO.
            "296939",   # He saw a UFO flying last night.
        ],

        # ===========================================================
        # === Typo / oversight — error register ===
        # ===========================================================
        [
            "4239178",  # It's obviously a typo.
            "3821658",  # It was an oversight.
            "2929289",  # Maybe it was just an oversight.
            {"text": "These things happen.", "added_for": "things|happen", "reason": "native dismissive idiom"},
        ],

        # ===========================================================
        # === Confidence / abilities ===
        # ===========================================================
        [
            "992008",   # I have confidence in his abilities.
            "3636125",  # I never once doubted your abilities.
        ],

        # ===========================================================
        # === Downhill — things going wrong ===
        # ===========================================================
        [
            "4565541",  # It's all downhill from here.
            "4297100",  # Things just kept going downhill from there.
        ],

        # ===========================================================
        # === Dumbest — idiomatic superlative ===
        # ===========================================================
        [
            "3113968",  # That's the dumbest thing I've ever heard.
            "72014",    # He is the dumbest kid in the class.
            "5631594",  # It's one of the dumbest things I've ever done.
        ],

        # ===========================================================
        # === Misplaced — losing things ===
        # ===========================================================
        [
            "2359959",  # I've misplaced my keys.
            "2387316",  # I must've misplaced it.
        ],

        # ===========================================================
        # === Lousy — kept slim ===
        # ===========================================================
        [
            "2547237",  # I'm a lousy fisherman.
            "2994698",  # I'm a lousy cook.
            "4502681",  # That was a lousy trick.
            "3272779",  # My uncle is a lousy driver.
        ],

        # ===========================================================
        # === Mailbox ===
        # ===========================================================
        [
            "2895118",  # My mailbox is full.
            "319380",   # My father painted the mailbox red.
        ],

        # ===========================================================
        # === Lacrosse / ping pong — niche sport ===
        # ===========================================================
        [
            "5850405",  # I like lacrosse.
            "1422362",  # Ping pong is also called table tennis.
        ],

        # ===========================================================
        # === Teammates / baseman — team sports ===
        # ===========================================================
        [
            "4499971",  # I love my teammates.
            "5186969",  # I'll miss my teammates.
            "27181",    # The first baseman tagged the runner out.
        ],

        # ===========================================================
        # === Disco / band ===
        # ===========================================================
        [
            "255051",   # I like disco music.
            "2008176",  # The disco is empty.
            "2050656",  # Our band has never played disco music.
        ],

        # ===========================================================
        # === Firefighter — heroism ===
        # ===========================================================
        [
            "4500262",  # Thirteen firefighters were injured.
            "4497265",  # The people that died were all volunteer firefighters.
            "251937",   # My dream is to be a firefighter.
        ],

        # ===========================================================
        # === Bloodshed ===
        # ===========================================================
        [
            "5783318",  # We hope to avoid bloodshed.
        ],

        # ===========================================================
        # === Psychopath / character ===
        # ===========================================================
        [
            "5858507",  # I'm not a psychopath.
        ],

        # ===========================================================
        # === Bestseller / book dream ===
        # ===========================================================
        [
            "4664193",  # I hope my book becomes a bestseller.
        ],

        # ===========================================================
        # === Snowflakes / kids in winter ===
        # ===========================================================
        [
            "5682086",  # The children tried to catch snowflakes on their tongues.
        ],

        # ===========================================================
        # === Sunscreen / sun safety ===
        # ===========================================================
        [
            "2254668",  # Where's the sunscreen?
            "2240160",  # Don't forget your sunscreen.
            "5204199",  # I hope you brought sunscreen.
            "909546",   # If you spend too much time in the sun without putting on sunscreen…
        ],

        # ===========================================================
        # === Haiku — meta-linguistic ===
        # ===========================================================
        [
            "589821",   # This is a sentence that has the syllable count of a haiku.
        ],

        # ===========================================================
        # === Salesgirl / past role ===
        # ===========================================================
        [
            "316157",   # She concealed the fact that she used to be a salesgirl.
        ],

        # ===========================================================
        # === Childproof / safety ===
        # ===========================================================
        [
            "2042967",  # You might want to childproof those electrical sockets.
            "1345490",  # Please fasten your seat belt during takeoff and landing.
        ],

        # ===========================================================
        # === Windshield / car maintenance ===
        # ===========================================================
        [
            "3403148",  # You need to clean your windshield.
            "4501087",  # Your windshield wipers need to be replaced.
            "4493809",  # There were bullet holes in the windshield.
            "3831392",  # Your right taillight is busted.
        ],

        # ===========================================================
        # === Fracking / earthquakes ===
        # ===========================================================
        [
            "4496344",  # Does fracking really cause earthquakes?
        ],

        # ===========================================================
        # === Polar bears / grizzlies — wildlife ===
        # ===========================================================
        [
            "5919505",  # Are polar bears bigger than grizzlies?
        ],

        # ===========================================================
        # === Eggplants / gourd — proverb-like ===
        # ===========================================================
        [
            "327384",   # You don't get eggplants from a gourd vine.
        ],

        # ===========================================================
        # === Paul Bunyan / tall tale ===
        # ===========================================================
        [
            "954701",   # Would you like to hear the story about Paul Bunyan?
        ],

        # ===========================================================
        # === Vice versa / guinea pig — idiomatic ===
        # ===========================================================
        [
            "298138",   # He used me as a guinea pig.
            "276551",   # Everybody knows that he likes her and vice versa.
        ],

        # ===========================================================
        # === UNESCO ===
        # ===========================================================
        [
            "30113",    # Do you know what UNESCO stands for?
        ],

        # ===========================================================
        # === Waterproof / gear ===
        # ===========================================================
        [
            "250295",   # My camera is waterproof.
            "251039",   # My watch is waterproof.
        ],

        # ===========================================================
        # === Sulfur / chemistry / matches ===
        # ===========================================================
        [
            "325500",   # Sulfur is used to make matches.
            "325501",   # Sulfur burns with a blue flame.
            "270775",   # The chemical formula for water is H₂O.
        ],

        # ===========================================================
        # === Congressman / writing in ===
        # ===========================================================
        [
            "2254930",  # Write your congressman.
        ],

        # ===========================================================
        # === Countdown / launch ===
        # ===========================================================
        [
            "2250027",  # Stop the countdown.
            "2841986",  # The countdown has started.
        ],

        # ===========================================================
        # === Nail file ===
        # ===========================================================
        [
            "3824700",  # Do you have a nail file?
            "3343237",  # Do you have a nail file I could borrow?
        ],

        # ===========================================================
        # === File cabinet / drawers ===
        # ===========================================================
        [
            "34420",    # The file cabinet drawers are open.
        ],

        # ===========================================================
        # === Screenshot / digital ===
        # ===========================================================
        [
            "2763237",  # Can you send me a screenshot?
        ],

        # ===========================================================
        # === Annoys / complaint ===
        # ===========================================================
        [
            "2488814",  # If it annoys you so much, file a complaint.
        ],

        # ===========================================================
        # === Ohio / regional ===
        # ===========================================================
        [
            "289429",   # He was born in Ohio.
        ],

        # ===========================================================
        # === Impartial — standalone ===
        # ===========================================================
        [
            "2202975",  # I'm impartial.
        ],

        # ===========================================================
        # === Standards / self-claim ===
        # ===========================================================
        [
            "2245899",  # I have standards.
        ],

        # ===========================================================
        # === Unfinished business / loose ends ===
        # ===========================================================
        [
            "246060",   # The children went upstairs in single file.
            "245393",   # Don't leave your work unfinished.
            "3310258",  # We've got some unfinished business.
            "4663243",  # I have some unfinished business to attend to.
        ],
    ],
}
