"""Curation plan for OGTE Level 9 — Mid Intermediate (~1578 sentences).

L9 is mid-intermediate. Learners can now handle:
  - opinions on abstract topics (justice, peace, principles),
  - hypotheticals and conditionals ("would have", "could have"),
  - mild regrets, advice, recommendations,
  - work scenarios (career, interviews, business),
  - travel narratives (flights, tours, hotels, museums),
  - mild storytelling and personal reflection,
  - reading/journalism, structures, scales, generational talk.

Removal policy (LOOSENED vs earlier draft):
  - Long sentences kept.
  - Common idioms kept (esp. "banking on", "load off my mind", "by sight").
  - Family/relationship drama kept unless sexist/demeaning.
  - Specific years/numbers fine in moderation.
  - Crime/police/theft narratives kept unless gore-heavy or war-glorifying.
  - Body parts and narratives fine.
  - Political content OK unless country-specific (Trump/Obama out).
  - Proper names OK unless overwhelming.

Removed: dated brands (Facebook/YouTube/iPhone), overtly sexist generalisations,
extremely niche cultural references, near-duplicate drill rows, and drill patterns
(arcs where every row reuses the same content word).

Arcs are hand-crafted conversational snippets. Most questions are answered
within the same arc. Tight thematic clusters preferred over surface wordmatch.
The first three arcs ("position": "first") are the highest-quality openers.
"""

from __future__ import annotations


L9_PLAN = {
    "removals": [
        # === Dated brands / culturally specific proper nouns ===
        {"id": "5858281", "reason": "'I'm an FBI agent.' — US-specific brand."},
        {"id": "1334613", "reason": "'He is an FBI agent.' — same."},
        {"id": "954423", "reason": "'They say that in America anyone can become president…' — US-politics, abstract."},
        {"id": "3825548", "reason": "'Australia is an amazing country.' — country promo."},
        {"id": "292450", "reason": "'It cost him 50 dollars to rent a car in Hawaii.' — niche US destination."},
        {"id": "33307", "reason": "'Most Japanese take a bath every day.' — cultural stereotype."},

        # === Boston over-representation (drop most, keep one in flight arc) ===
        {"id": "5679096", "reason": "'We stayed in Boston over Christmas.' — Boston + Christmas double-niche."},
        {"id": "3148274", "reason": "'We stayed an extra three days in Boston.' — Boston-specific."},
        {"id": "3148391", "reason": "'I'll just walk around Boston…' — Boston-specific (replaced via 'sights' rewrite)."},
        {"id": "3148379", "reason": "'I've got a flight back to Boston booked…' — Boston-specific."},
        {"id": "33446", "reason": "'…connecting flight to Boston.' — Boston-specific."},
        {"id": "5360711", "reason": "'I was hoping to raise my kids in Boston.' — Boston-specific."},
        {"id": "3753285", "reason": "'…direct flights between Boston and Sydney?' — niche city pair (replaced via 'flights' rewrite)."},
        {"id": "4879972", "reason": "'There are no direct flights to Boston from here.' — Boston duplicate."},
        {"id": "4496140", "reason": "'Our main branch is in Boston.' — Boston-specific."},

        # === Christmas over-representation — trim to a workable cluster ===
        {"id": "5681157", "reason": "'It's about time for our children to learn the real meaning of Christmas.' — preachy."},
        {"id": "5679147", "reason": "'Have you forgotten the true meaning of Christmas?' — preachy."},
        {"id": "62798", "reason": "'Christmas is a good time to market new toys.' — commercial / niche."},
        {"id": "5705375", "reason": "Christmas-cards duplicate."},
        {"id": "5679182", "reason": "Christmas-cards duplicate."},
        {"id": "5679133", "reason": "Christmas-cards duplicate."},
        {"id": "5705369", "reason": "Christmas-vacation duplicate."},
        {"id": "5705357", "reason": "Christmas-vacation duplicate."},
        {"id": "5705359", "reason": "Christmas-songs duplicate."},
        {"id": "5679120", "reason": "'All I want for Christmas is a guitar.' — niche."},
        {"id": "5681169", "reason": "'We're planning to have a Christmas party on Christmas Eve.' — duplicative."},
        {"id": "5679093", "reason": "'What are the chances that we'll have a white Christmas?' — niche US weather custom."},
        {"id": "5679139", "reason": "'We still haven't taken down our Christmas lights.' — niche."},
        {"id": "5679069", "reason": "'Turn the Christmas tree lights off…' — niche."},
        {"id": "5679102", "reason": "Duplicate of Sunday Christmas-falls sentence."},
        {"id": "5679053", "reason": "'Our store is open every day of the year except Christmas and New Year's.' — long, niche."},
        {"id": "44540", "reason": "'Christmas fell on Saturday that year.' — over-specific calendar."},
        {"id": "243072", "reason": "Duplicate calendar Christmas sentence."},
        {"id": "1347073", "reason": "'They got married on Christmas Eve.' — niche specific."},
        {"id": "5705313", "reason": "'What's the best Christmas present you've ever gotten?' — over-niche."},
        {"id": "2388146", "reason": "'I never liked Christmas.' — negative + Christmas overflow."},
        {"id": "2102192", "reason": "'What have you bought your girlfriend for Christmas?' — niche."},
        {"id": "5679073", "reason": "'We plan to spend Christmas with my wife's family this year.' — niche family scenario."},
        {"id": "5212518", "reason": "'I expect to win today's race.' — odd standalone; today's already covered."},

        # === Sexist / demeaning generalisations (kept narrow under loosened policy) ===
        {"id": "4500638", "reason": "'Some men treat women like property.' — sexist topic."},
        {"id": "2719660", "reason": "'Men are physically stronger than women.' — sexist generalisation."},
        {"id": "2986710", "reason": "'On a scale of one to ten, she's an eleven.' — objectifying."},
        {"id": "299146", "reason": "'He sat surrounded by young girls.' — reads creepy."},

        # === Heavy / harmful (kept narrow under loosened policy) ===
        {"id": "299267", "reason": "'He hanged himself.' — self-harm reference (no replacement needed)."},
        {"id": "318112", "reason": "'No one survived the plane crash.' — plane-crash heavy, fatal."},
        {"id": "803097", "reason": "'He was weak from the loss of blood.' — gore-adjacent."},
        {"id": "2517260", "reason": "'The police covered the body with a sheet.' — corpse imagery."},
        {"id": "240330", "reason": "'I broke my leg in a traffic accident.' — heavy duplicate of 257348 below."},
        {"id": "257348", "reason": "Duplicate of above."},
        {"id": "4498492", "reason": "'The meat they fed us tasted a little like chicken.' — captive vibe."},
        {"id": "2543488", "reason": "'I'm releasing the prisoners.' — odd standalone (drama-niche)."},
        {"id": "2642220", "reason": "'Consider yourselves my prisoners.' — drama-niche."},
        {"id": "1841180", "reason": "'Release him.' — captive-drama (release restored via rewrite)."},
        {"id": "2549343", "reason": "'I'll release you.' — captive-drama."},

        # === Pet-feeding spam (one user's dog-food sentences flood Tatoeba) ===
        {"id": "898586", "reason": "Pet-feeding spam ('…feed your dog at a specific time…')."},
        {"id": "898542", "reason": "Pet-feeding spam."},
        {"id": "898546", "reason": "Pet-feeding spam."},
        {"id": "898544", "reason": "Pet-feeding spam ('feed their dogs fish')."},
        {"id": "898559", "reason": "Pet-feeding spam ('big green bag')."},
        {"id": "898525", "reason": "Pet-feeding spam."},
        {"id": "898534", "reason": "Pet-feeding spam (keep 898533)."},
        {"id": "898568", "reason": "Pet-feeding spam ('chicken bones')."},
        {"id": "898589", "reason": "Pet-feeding spam ('listened to the news')."},
        {"id": "898575", "reason": "Pet-feeding spam."},
        {"id": "898576", "reason": "Pet-feeding spam."},
        {"id": "4904869", "reason": "'They have families to feed.' — heavy social-comment."},

        # === Idioms / proverbs that don't transfer at L9 ===
        {"id": "1040797", "reason": "'If you can't beat them, join them.' — proverb."},
        {"id": "73489", "reason": "'One hundred dollars is just chicken feed.' — idiom + US-centric."},
        {"id": "2007592", "reason": "'Let's go the extra mile.' — idiom."},
        {"id": "454439", "reason": "'Don't stick your nose where it doesn't belong.' — idiom."},
        {"id": "3726127", "reason": "'Don't give me any lip.' — slang idiom."},
        {"id": "3170508", "reason": "'You're white as a sheet.' — idiom."},
        {"id": "3211939", "reason": "'Don't spread yourself too thin.' — idiom."},
        {"id": "3387154", "reason": "'One man's loss is another man's gain.' — proverb."},
        {"id": "750937", "reason": "'A journey of a thousand miles begins with a single step.' — niche proverb."},
        {"id": "2060344", "reason": "'I learned the hard way that crime doesn't pay.' — idiom + moral."},
        {"id": "5754003", "reason": "'That toy is selling like hot cakes.' — idiom."},
        {"id": "282410", "reason": "'He that knows little often repeats it.' — proverb / archaic."},
        {"id": "21670", "reason": "'There's a pub just around the corner.' — UK-specific 'pub'."},
        {"id": "3732229", "reason": "'We'll see you at the pub.' — UK-specific."},
        {"id": "4501618", "reason": "'It takes a village to raise a child.' — proverb."},
        {"id": "1969194", "reason": "'Everybody has a right to his own opinion…' — long abstract lecture."},
        {"id": "6104187", "reason": "'Instead of focusing on the ways we're different…' — preachy."},

        # === Hate-tone / pop-culture meme ===
        {"id": "5933845", "reason": "'I'm sick of cat videos.' — pop-culture meme."},
        {"id": "60608", "reason": "'This video is boring.' — generic negativity."},
        {"id": "2218086", "reason": "'You're average students.' — passive-aggressive teacher quip."},

        # === Over-long abstract lectures ===
        {"id": "326400", "reason": "'If you want security in your old age, begin saving now.' — preachy/long."},
        {"id": "5191958", "reason": "'I'm concerned, of course.' — disconnected."},
        {"id": "2042820", "reason": "'I don't want everybody on the Web to be able to access my photos.' — dated 'Web'."},
        {"id": "953254", "reason": "'English is quite often the language of choice…' — meta lecture (replaced via 'international' rewrite)."},
        {"id": "2042732", "reason": "'I want to cut down on the time it takes to process records.' — work jargon."},
        {"id": "5651710", "reason": "'I'm trying to think of some ideas for this article I'm writing.' — meta clutter."},
        {"id": "17930", "reason": "'Would you mind making an extra cup of coffee whenever you decide to have some?' — convoluted."},

        # === Duplicates ===
        {"id": "388737", "reason": "Duplicate of 388734 ('In my opinion, she is correct.')."},
        {"id": "6267390", "reason": "Duplicate of 3831461 ('Your flight leaves at 2:30.')."},
        {"id": "2050681", "reason": "Duplicate of 4501455 'We played together when we were kids.'"},
        {"id": "3587370", "reason": "Duplicate of 3310128 'We've been friends since we were kids.'"},
        {"id": "242955", "reason": "Duplicate of 282339 'The waves are high.'"},
        {"id": "55103", "reason": "Duplicate of 1332073 'These clothes are dirty…'"},
        {"id": "59922", "reason": "Duplicate of 45249 ('The price includes tax.')."},
        {"id": "2171305", "reason": "Duplicate of 1115628 ('Walking to work in this heat is a bad idea.')."},
        {"id": "5050163", "reason": "Duplicate-themed 'We weren't aware of that.'"},
        {"id": "70889", "reason": "Duplicate of 1839624 ('What's the score?')."},
        {"id": "4499947", "reason": "Duplicate of 4499754 'My heart started racing.'"},
        {"id": "5851224", "reason": "Duplicate 'I'm a survivor.' (2218042 already)."},
        {"id": "3826425", "reason": "'My wife just had a baby.' — overlaps with 'baby in July' arc."},
        {"id": "5860572", "reason": "'I cooked breakfast.' — duplicate-themed with kitchen arc."},
        {"id": "42051", "reason": "'That was cooked in oil.' — clutter."},
        {"id": "5573439", "reason": "'We have a nice group of kids here.' — vague."},
        {"id": "2643015", "reason": "'My flight arrived at 2:30 p.m.' — covered by 3831461."},
        {"id": "241532", "reason": "'It's quarter to eight now.' — time-format clutter."},
        {"id": "72293", "reason": "'It's a quarter past nine.' — time-format clutter."},
        {"id": "5153926", "reason": "'O positive is the most common blood type.' — niche medical."},
        {"id": "1180847", "reason": "'I'd like my egg very, very soft boiled.' — too narrow."},
        {"id": "291671", "reason": "'He promised not to smoke.' — third-person clutter."},
        {"id": "297571", "reason": "'He advised me not to smoke.' — duplicates 886862."},
        {"id": "5182606", "reason": "'We should teach our kids about the dangers of smoking.' — preachy."},
        {"id": "249157", "reason": "'We saw a mummy at the museum.' — culturally ambiguous (UK 'mum'/Egypt 'mummy')."},
        {"id": "3727962", "reason": "'I don't know what possessed me to do that.' — long idiom-variant."},
        {"id": "3731694", "reason": "'What could've possessed you to do that?' — idiom-variant."},
        {"id": "295558", "reason": "'He's the president of the bank.' — niche role."},
        {"id": "1335021", "reason": "'Lead is a metal.' — encyclopaedia."},
        {"id": "2007289", "reason": "'Let's try to speed things up, okay?' — covered."},
        {"id": "55925", "reason": "'This size doesn't fit me.' — covered."},
        {"id": "275262", "reason": "'Stand on the scales.' — medical-niche (scale restored via rewrite)."},
        {"id": "23678", "reason": "'Please put your baggage on this scale.' — niche airport (scale restored via rewrite)."},
        {"id": "5837542", "reason": "'How much cash do you carry?' — odd."},
        {"id": "2050633", "reason": "'Some kids are playing in the park.' — clutter."},
        {"id": "1474128", "reason": "'Are the preparations for tomorrow complete?' — formal/old-fashioned."},
        {"id": "264334", "reason": "'He proceeded to the next question.' — covered."},
        {"id": "5158718", "reason": "'Let the kids off the bus first.' — niche."},
        {"id": "5860784", "reason": "'I have a poor memory.' — covered by improve-my-memory arc."},
        {"id": "2954697", "reason": "'You scored the highest in the class.' — niche school."},
        {"id": "311298", "reason": "'She was born in a small village.' — covered."},
        {"id": "299545", "reason": "'He grew up in a little village.' — covered."},
        {"id": "315121", "reason": "'She felt her heart beat quickly.' — redundant with racing-heart arc."},
        {"id": "243587", "reason": "'Would you like sugar and milk?' — sugar list trim."},
        {"id": "4311813", "reason": "'I think I added too much sugar.' — trim."},
        {"id": "3133016", "reason": "'I hate long speeches.' — trim hate-cluster."},
        {"id": "39744", "reason": "'Exact change, please.' — niche transit; 3728667 stays."},
        {"id": "5134381", "reason": "'This article is badly written.' — trim."},

        # === Near-duplicates inside drill arcs (removed; better variants kept) ===
        {"id": "450711", "reason": "Near-duplicate of 2360745 ('I heard my phone ring.')."},
        {"id": "2547639", "reason": "Near-duplicate of 2280417 ('The phone started ringing.')."},
        {"id": "2252563", "reason": "Near-duplicate of 272329 ('The baby is sleeping.')."},
        {"id": "2252561", "reason": "Near-duplicate of 3333934 ('Is the baby OK?')."},
        {"id": "1426537", "reason": "Duplicate of 1426536 ('We talked in low voices so we wouldn't wake the baby.')."},
        {"id": "2543037", "reason": "Duplicate of 2542473 ('I'm aware of that/the possibility.')."},
        {"id": "6033158", "reason": "Duplicate of 6033178 ('I'm well aware of who I'm dealing with.')."},
        {"id": "50909", "reason": "Duplicate of 31793 ('It hardly ever rains here/there.')."},
        {"id": "5909107", "reason": "Duplicate of 5909105 ('Competition drives prices down.')."},
        {"id": "3312031", "reason": "Duplicate of 3312029 ('We'll probably beat them/you there.')."},
        {"id": "4502343", "reason": "'The machine stopped functioning.' — covered by 3723963 in arc."},
        {"id": "464366", "reason": "Duplicate of 2039894 (chose a hotel near the museums)."},
        {"id": "687626", "reason": "Duplicate of 687678 ('Where's the bakery?' / 'Where is a bakery?')."},
        {"id": "4501095", "reason": "'Our magazine need better writers.' — ungrammatical original."},

        # === Smoking trim ===
        {"id": "265154", "reason": "'…I used to smoke two packs a day.' — heavy disclosure (replaced via rewrite)."},

        # === Pessimistic generalisation (kept narrow) ===
        {"id": "4501702", "reason": "'Relationships are hard work.' — flat generalisation."},
    ],
    "arcs": [
        # === FIRST ARC: small-talk / catching up — natural opener ===
        {
            "position": "first",
            "items": [
                "5852118",  # How's your garden doing?
                "3636374",  # How's your kid doing?
                {"text": "He's doing great, thanks.", "added_for": "great|thanks", "reason": "natural answer"},
                "1877168",  # We're making progress.
                "5152901",  # How is the work progressing?
                "5640463",  # I think we're progressing.
            ],
        },

        # === FIRST ARC: opinion / agreement — sets a "civil discussion" tone ===
        {
            "position": "first",
            "items": [
                "5163832",  # I'm asking your opinion.
                "388734",   # In my opinion, she is correct.
                "250435",   # My opinion is different from yours.
                "250450",   # My opinion is similar to yours.
                "2404157",  # I respect your opinion.
                "4500995",  # Your opinion matters.
            ],
        },

        # === FIRST ARC: work / career — practical, high-utility opener ===
        {
            "position": "first",
            "items": [
                "266317",   # I was interviewed for a job.
                "4311298",  # Were you nervous during the job interview?
                {"text": "A little, but I did okay.", "added_for": "okay|did", "reason": "natural answer"},
                "2646137",  # You need a new career.
                "2644065",  # Thanks for the opportunity.
                "5621878",  # We have the opportunity to make some changes.
            ],
        },

        # === Phones (broken into themed sub-arcs; drill fixes applied) ===
        ["1886544", "3151446", "279360", "3218336", "2360821"],
        # Whose phone is that? / Give me your cell phone. / I'm talking on the phone. / Don't forget your phone. / I heard you talking on the phone.

        [
            "279284",   # Answer the phone.
            "2280417",  # The phone started ringing.
            "2891805",  # Pick up the phone.
            "2291868",  # I answered the phone.
            "2689319",  # Who answered the phone?
        ],

        [
            "2547934",  # I tried to phone you.
            "2543074",  # I'll phone you when I arrive.
            "2542876",  # I'm waiting for a phone call.
            "2294049",  # I believe we spoke on the phone.
            "2546901",  # We spoke on the phone.
        ],

        [
            "287213",   # I forgot his phone number.
            "395439",   # I forgot your phone number.
            "38547",    # Please write down your name, address, and phone number here.
            "3202275",  # I'm not telling you my phone number.
            {"text": "Why not?", "added_for": "why|not", "reason": "follow-up to refusal"},
        ],

        [
            "3185866",  # Have you paid your phone bill?
            {"text": "Not yet.", "added_for": "not|yet", "reason": "natural answer"},
            "3346190",  # My phone is dead.
            "4159782",  # My phone is about to die.
            "1426694",  # Charge your phone.
            "2718094",  # I turned off my phone.
        ],

        [
            "2769506",  # You have lots of phones.
            "1853638",  # My new phone is thinner than my old phone.
            "6029509",  # Can this phone play videos?
            "3329599",  # Can I use your phone for a sec?
            {"text": "Sure, here you go.", "added_for": "sure|here", "reason": "natural answer"},
        ],

        [
            "2978686",  # I woke up when the phone rang.
            "1960266",  # The telephone rang.
            "2360745",  # I heard my phone ring.
            "4014895",  # There's a phone in the kitchen.
            "33670",    # There's a telephone in the hall.
        ],

        [
            "27258",    # Can you tell me where the nearest pay phone is?
            "243725",   # Where is the nearest telephone?
            "3280376",  # You didn't mention that on the phone.
            "259624",   # I ordered a pizza on the phone.
            "2644604",  # Your wife's on the phone.
            "887567",   # She wasn't able to contact him by phone.
        ],

        # === Baby & kids ===
        [
            "3824692",  # Your baby is doing fine.
            "3333934",  # Is the baby OK?
            "2745924",  # You have a healthy baby boy.
            {"text": "Congratulations!", "added_for": "congratulations", "reason": "natural reaction to baby news"},
        ],

        [
            "2790144",  # Is this baby a boy or a girl?
            "2457382",  # Whose baby is this?
            "58191",    # This baby is 3 weeks old.
            "69737",    # You are no longer a baby.
        ],

        [
            "309399",   # She's going to have a baby in July.
            "245603",   # My sister is having a baby in June.
            "3561272",  # Have you decided on a name for your baby?
            "2640485",  # Do you have a name picked out for your baby?
            {"text": "We haven't decided yet.", "added_for": "haven't|decided", "reason": "natural answer"},
            "3446783",  # Mary is expecting a baby in October.
        ],

        [
            "5659248",  # I'm not ready to have kids yet.
            "2359626",  # I've got a wife and kids.
            "4017094",  # My parents died when I was a baby.
            "4500178",  # I miss my kids.
        ],

        [
            "1844210",  # Keep the kids inside.
            "5466379",  # Keep an eye on the kids.
            "5513999",  # We have to protect our kids.
            "2012450",  # I want my kids to be safe.
            "3390691",  # The kids were gone when I got home.
        ],

        [
            "246089",   # Send the kids to bed.
            "4084374",  # Bring the kids home for dinner.
            "5821622",  # I need to drop off the kids at school.
            "4014904",  # Who's watching the kids?
            {"text": "I'm watching them.", "added_for": "watching|them", "reason": "natural answer"},
        ],

        [
            "272342",   # You shouldn't leave the baby alone.
            "2835570",  # You were supposed to be watching the baby.
            "2650939",  # Don't worry about the baby.
            "4121218",  # I'm worried about the baby.
            "2361816",  # I worry about the kids.
        ],

        # Baby crying/sleeping — drill fixed: trimmed near-duplicates
        [
            "272307",   # The baby started to cry.
            "45862",    # That baby does nothing but cry.
            "272360",   # The baby is crying.
            "272319",   # The baby kept quiet.
            "272329",   # The baby is sleeping.
            "272336",   # The baby was sound asleep in her mother's arms.
        ],

        [
            "1748917",  # Can the baby walk?
            "272338",   # Has the baby woken up?
            "45836",    # The baby is asleep.
            "473601",   # I didn't want the baby to catch a cold, so I closed the window.
            "1426536",  # We talked in low voices so we wouldn't wake the baby.
            "5181158",  # Let's talk quietly so we don't wake the baby.
        ],

        [
            "5802185",  # Can you put the baby in the car seat?
            "1893741",  # We need you to baby-sit.
            "1895631",  # You're acting like a baby.
            "2025999",  # Stop acting like a baby.
            "3308265",  # Here's a picture of my baby.
            "3308331",  # I don't have any baby pictures of myself.
        ],

        [
            "315417",   # She looked after her baby.
            "250957",   # My sister often looks after the baby.
            "680867",   # The doctor examined the baby.
            "5320476",  # Kids grow up so fast.
            "3085636",  # Kids learn quickly.
        ],

        # === Opinion / debate (continuation; first-position arc covers basics) ===
        [
            "3821751",  # That's only my personal opinion.
            "5822512",  # I value your opinion.
            "3831416",  # Your opinion means a lot to me.
            "6098709",  # Do you have an opinion on this issue?
            "1516153",  # I haven't formed an opinion yet.
            "2359522",  # I haven't formed an opinion about that yet.
            {"text": "Fair enough.", "added_for": "fair|enough", "reason": "natural acceptance"},
        ],

        [
            "681645",   # You should express your opinion.
            "3528688",  # Everyone should be able to express their opinion.
            "325403",   # Let me hear your frank opinion.
            "3831417",  # Your opinion matters to me.
            "259004",   # I agree with your opinion about taxes.
            "403320",   # He agrees with my opinion.
            "285508",   # His opinion was not accepted.
        ],

        [
            "807098",   # Public opinion began to change.
            "2042910",  # Do you want a second opinion? I can get another doctor…
            {"text": "Yes, that would help.", "added_for": "yes|help", "reason": "natural answer"},
        ],

        # === Justice / values / principles ===
        [
            "3001824",  # All I'm interested in is justice.
            "1869777",  # We demand justice.
            "2199424",  # It's against my principles.
            "4495549",  # I agree in principle.
            "3142794",  # It's a question of principle.
        ],

        [
            "3821562",  # Honesty pays.
            "3736664",  # Honesty is very important.
            "271129",   # Everybody in the world desires peace.
            "5171274",  # I wish you peace and happiness.
            "2044884",  # My only concern is for your happiness.
        ],

        [
            "325609",   # Both countries are now at peace.
            "326510",   # Peace talks will begin next week.
            "326512",   # The peace talks failed again.
            "307509",   # They lived in peace.
            "273764",   # The whole nation wants peace.
            "22870",    # We should make every effort to maintain world peace.
            "2299551",  # I brought you a peace offering.
        ],

        # === Christmas (trimmed) ===
        [
            "62800",    # Christmas is just around the corner.
            "62816",    # Christmas is fast approaching.
            "3749201",  # It'll be Christmas soon.
            "3260470",  # Schools are closed for Christmas.
            "21540",    # School has closed for the Christmas holidays.
            "1555737",  # What are your plans for Christmas?
            {"text": "We're staying home this year.", "added_for": "staying|home", "reason": "natural answer"},
        ],

        [
            "251955",   # My daughter is looking forward to Christmas.
            "4499597",  # Christmas is my favorite holiday.
            "62796",    # Christmas is a special holiday.
            "3688591",  # I love Christmas music.
            "906719",   # What's your favorite Christmas song?
            "5679172",  # I've written a couple of Christmas songs.
        ],

        [
            "5705373",  # What do you want Santa to bring you for Christmas?
            "4108363",  # I bought some Christmas presents today.
            "5679132",  # I need to buy some Christmas presents.
            "4011902",  # Who are you spending Christmas with?
            "5679090",  # How will you be spending Christmas?
            "62813",    # I look forward to seeing you at Christmas.
        ],

        [
            "253081",   # I received a Christmas card from my brother in Italy.
            "5679052",  # Today's not Christmas.
            "2046933",  # The month before Christmas is a very busy time of year for stores.
            "387470",   # Christmas is December 25th.
            "2718489",  # December 24th is Christmas Eve.
            "5679099",  # All three of our daughters will be here for Christmas.
        ],

        # === Work / career ===
        [
            "262021",   # I became a director.
            "1003118",  # Where's the director?
            "2546128",  # I work at a gas station.
            "477344",   # I'm just a regular office worker.
            "1691389",  # I work in an accounting office.
        ],

        [
            "2542925",  # I'm running for city council.
            "4834911",  # You should run for city council.
            "293566",   # He is a member of the committee.
            "28259",    # The committee passed the bill.
            "2641793",  # We're meeting to discuss strategy.
        ],

        [
            "2545012",  # I didn't prepare a speech.
            "294104",   # He delivered a speech.
            "1075492",  # His speech moved us.
            "541069",   # Nobody was listening to the speech.
            "285618",   # His speech held the attention of the audience.
            "5938169",  # I'm used to making speeches.
        ],

        [
            "4666029",  # I'm enjoying the challenge.
            "1638726",  # I accept your challenge.
            "3825822",  # I accepted the challenge.
            "260407",   # I challenged him to a game.
            "2387426",  # I need a bigger challenge.
            "4664374",  # We're excited about the challenge.
        ],

        [
            "2649006",  # It was approved.
            "2244883",  # Am I approved?
            "2111381",  # They approve.
            "687353",   # I don't approve of them dating each other.
            "5991332",  # I can't grant that request.
            "5991334",  # I'm not going to grant that request.
            {"text": "Why not?", "added_for": "why|not", "reason": "follow-up to refusal"},
        ],

        [
            "2538994",  # I was hoping you'd consider my request.
            "2271832",  # I don't do requests.
            "3312839",  # We get a lot of requests.
            "2805889",  # He requested help.
            "3330588",  # I put the documents you requested on your desk.
            "3831394",  # Your request isn't reasonable.
        ],

        # === Interview (continuation of first arc) — interviews/interviewed/load ===
        [
            "5069044",  # It was a strange interview.
            "2392556",  # I recorded the interview.
            {"text": "How did the interviews go?", "added_for": "interviews|go", "reason": "restore plural form (lost vocab)"},
            {"text": "Finishing them was a real load off my mind.", "added_for": "load|off|mind", "reason": "restore 'load off mind' idiom"},
            "2882887",  # Your timing was excellent.
        ],

        # === Engine / oil / mechanic ===
        [
            "65213",    # Have you checked the engine?
            "2216174",  # Have you checked the oil level recently?
            "65176",    # Shall I check the oil?
            "1556838",  # Excuse me, please check the oil.
            "2549500",  # I'm out of film.
        ],

        # === Articles / writing / journalism ===
        [
            "2546267",  # Who wrote this article?
            "4141513",  # That article was written in English.
            "4498311",  # I enjoyed your article.
            "4498312",  # I enjoyed this article.
            "2349883",  # We discussed the article I published.
            "3819589",  # Your article was published today.
        ],

        [
            "2230382",  # I read the entire book.
            "4195844",  # I read the article about you in yesterday's newspaper.
            "2032022",  # I've got a newspaper article I want to show you.
            "3670668",  # My father always reads the newspaper before breakfast.
            "327727",   # Will newspapers be able to survive?
        ],

        [
            "495717",   # I'm a journalist.
            "4275683",  # You're a good journalist.
            "2107350",  # We're journalists.
            "5513641",  # You're an excellent writer.
            "59202",    # This magazine sells well.
            "5276591",  # Hand me that magazine.
            "59199",    # Don't throw away this magazine.
        ],

        # === Internet / tech / passwords ===
        [
            "3826971",  # I don't have Internet access.
            "5070834",  # Not everyone has access to the Internet.
            "5364087",  # Here are some interesting links.
            "2539501",  # I'll send you the link to my website.
            "4497903",  # I didn't click the link.
            "2495664",  # I clicked the link, but nothing happened.
            "2307997",  # I clicked the first link on the page.
        ],

        [
            "1216859",  # Please choose a more secure password.
            "4496387",  # You should change your password frequently.
            "4134518",  # How frequently do you check your email?
            {"text": "I check it every morning.", "added_for": "check|morning", "reason": "natural answer"},
            "906846",   # What's your favorite podcast?
        ],

        # === Travel: flights — 'flights' restored via rewrite ===
        [
            "21295",    # Have a nice flight.
            "2307966",  # I caught an earlier flight.
            "2387244",  # I missed my flight.
            "6434704",  # My flight was supposed to arrive at 2:30.
            "3831461",  # Your flight leaves at 2:30.
            "2359564",  # I've got a connecting flight.
            "72544",    # Where are the bags from Flight 57?
            {"text": "Are there any direct flights between the two cities?", "added_for": "direct|flights", "reason": "restore 'flights' plural (lost vocab); strip Boston/Sydney"},
        ],

        # === Travel: tours ===
        [
            "325585",   # Let's ask a travel agent.
            "20930",    # Is there a tour guide available?
            "923829",   # When is the next guided tour?
            "3151592",  # Could you please give me a quick tour?
            "4502667",  # Tours are available.
            "558567",   # Do you have one-day tours?
            "4501219",  # Our band will be on tour for the next three months.
        ],

        # === Travel: museums / sights ===
        [
            "3825705",  # When does the art museum close?
            "272754",   # We visited the museum last week.
            "269218",   # The new museum is worth visiting.
            "2912486",  # How many museums did you visit?
            "2039894",  # We've chosen a hotel near the museums.
            "1209461",  # The museum isn't open on Sundays.
            "282555",   # I understand the museum is closed on Mondays.
            "1972594",  # That car belongs in a museum.
            {"text": "We spent the afternoon seeing the sights.", "added_for": "sights", "reason": "restore 'sights' plural (lost vocab); replaces Boston original"},
        ],

        # === Rent / housing ===
        [
            "1437083",  # We'd like a room for two with a bath.
            "2315272",  # I don't have any rooms for rent.
            "24050",    # How much is the rent per month?
            "1054559",  # We have to rent a room to hold the party in.
            "262701",   # We rented an apartment.
            "2404149",  # I rented out the guest bedroom.
            "1894606",  # It's a rental.
            "5136914",  # There's nothing wrong with renting.
        ],

        [
            "4499048",  # Rents are going up.
            "4498999",  # Rents will go up next month.
            "3818295",  # I haven't paid this month's rent yet.
            "5909315",  # You still need to pay this month's rent.
            {"text": "I know, I'll pay it tomorrow.", "added_for": "pay|tomorrow", "reason": "natural answer to rent reminder"},
            "3821199",  # Who'll pay the rent?
            "62772",    # It makes sense to pay off your credit card balance every month.
        ],

        # === Nearby / where ===
        [
            "5037255",  # Is there a marina nearby?
            "3525534",  # Is there a hospital nearby?
            "5850074",  # I waited nearby.
            "544540",   # Where is the railway station?
        ],

        # === Cultures / international (restored via rewrite) ===
        [
            "21939",    # It's fun to learn about foreign cultures.
            "1847829",  # I ate some Greek food at a nearby restaurant nearby.
            "252581",   # I came to Japan four years ago.
            {"text": "We have customers from many international markets.", "added_for": "international", "reason": "restore 'international' (lost vocab); replaces meta lecture"},
        ],

        # === Breakfast / cooking ===
        [
            "2245012",  # Breakfast is served.
            "23294",    # We have breakfast at seven.
            "5270225",  # Does the price include breakfast?
            "5135007",  # Breakfast is an important meal.
            "260860",   # I must prepare their breakfast.
            "1439862",  # My mother is cooking breakfast.
            "1439861",  # My mother is preparing breakfast.
            "290089",   # He often eats breakfast there.
            "255766",   # I've already eaten breakfast.
            "257544",   # I've just eaten breakfast.
            "5137584",  # You've hardly touched your breakfast.
        ],

        # === Bakery / baking ===
        [
            "5840521",  # I baked bread.
            "3250948",  # Who baked this cake?
            "2686652",  # I'm baking.
            "2245958",  # I love baking.
            "2007487",  # Let's bake a birthday cake.
            "2007627",  # Let's have a bake sale.
            "5909943",  # I baked three cakes this afternoon.
            "687678",   # Where's the bakery?
        ],

        # === Boil / cook ===
        [
            "325237",   # Boil one egg.
            "317391",   # She boiled the eggs.
            "4665033",  # The water is beginning to boil.
            "1556553",  # It's boiling hot.
            "282143",   # I burned myself with boiling water.
        ],

        # === Eggs / chickens ===
        [
            "56528",    # This egg is fresh.
            "35864",    # The chicken laid an egg this morning.
            "278220",   # Birds lay eggs.
            "431114",   # We're also out of eggs.
            "288916",   # He bought eggs and milk from a farmer.
            "593244",   # I dislike eggs.
            "5606467",  # I like egg whites.
            "3414970",  # Do you like egg rolls?
            {"text": "I love them.", "added_for": "love|them", "reason": "natural answer"},
            "34645",    # Don't count your chickens.
            "5859303",  # I fed the chickens.
        ],

        # === Coffee / tea / sugar / sandwich ===
        [
            "5190620",  # I prefer coffee without sugar.
            "2747501",  # I drink tea without sugar.
            "2380403",  # I made an extra sandwich for you.
            "249073",   # We ate sandwiches for breakfast.
        ],

        # === Lunch / dining ===
        [
            "4500245",  # Lunch is included.
            "4500242",  # Dinner will be included.
            "307193",   # They are having lunch in the garden.
            "243408",   # How about dining out tonight?
            "2046828",  # The dining area is always busy.
            "4501885",  # It was a satisfying meal.
        ],

        # === Ice cream / cheese ===
        [
            "4552893",  # Kids like ice cream.
            "5151939",  # In general, kids like ice cream.
            "5800418",  # This cheese is the best I've ever tasted.
            "1852269",  # Say cheese.
            "4498712",  # I like fish sticks.
        ],

        # === Garden / nature — drill fixed: trimmed from 16 to 9, varied ===
        [
            "5938851",  # I'm watering the garden.
            "1744940",  # I have to plant trees in the garden.
            "249095",   # We grow vegetables in our garden.
            "3096957",  # We have a small vegetable garden.
            "324466",   # Did you go to any famous gardens?
            "251721",   # My father gardens on Sundays.
            "2427878",  # I love gardening.
            "3824449",  # We walked around the garden.
            "315893",   # She found a ball in the garden.
        ],

        # === Race / competition ===
        [
            "35341",    # I'll race you to the bus stop.
            "2015119",  # Do you seriously want to race me?
            "4121141",  # Slow down. It's not a race.
            "68601",    # The race was fixed.
            "255928",   # I started last in the race, but I soon caught up with the others.
            "404100",   # When I got to school, the race had already finished.
            "887349",   # She raced him down the hill.
            "4499754",  # My heart started racing.
            "3061463",  # Have you ever gone to see a horse race?
            "2258794",  # I like horse races.
            "5858849",  # I won three races.
            "304744",   # I doubt whether he will win both races.
            "953678",   # I used to dream about becoming a race car driver.
        ],

        # === Fit / strength ===
        [
            "4499725",  # My strength has improved.
            "275279",   # Save your strength.
            "6480679",  # We all have different strengths.
            "33524",    # I'm feeling fit.
            "319823",   # It was a perfect fit.
            "61148",    # This coat fits you.
            "3636018",  # This jacket fits pretty well.
            "57125",    # This hat doesn't fit me.
            "58424",    # This coat doesn't fit me.
            "67909",    # There were no hats in that store that fit me.
            "1307448",  # Forty people can't fit in here.
        ],

        # === Shake / handshake ===
        [
            "4499082",  # The ground started shaking.
            "2218411",  # You're still shaking.
            "2203331",  # We're shaken.
            "2203332",  # You're shaken.
            "1192381",  # Let's shake hands.
            "28514",    # Please shake hands.
            "267269",   # The queen shook hands with each player after the game.
            "258479",   # I shook my head.
            "4499270",  # Everyone shook their heads.
        ],

        # === Competition / strategy / scale (restored) ===
        [
            "5135005",  # Competition is a healthy thing.
            "4499149",  # Whatever happened to competition?
            "5909105",  # Competition drives down prices.
            "681901",   # Mary represented her team in the competition.
            "4666529",  # We face many challenges.
            "1129654",  # I like challenges.
            "4496980",  # There are many different strategies we could try.
            "4502875",  # That was obviously a winning strategy.
            {"text": "We're growing the business on a much larger scale.", "added_for": "scale", "reason": "restore 'scale' (lost vocab); business context"},
        ],

        # === Beat ===
        [
            "5471362",  # We beat three teams.
            "3312029",  # We'll probably beat them there.
            "2247461",  # I was beaten.
            "4862074",  # We were beaten.
            "4495953",  # Stop beating yourself up.
            "5942557",  # I can hear your heart beating.
        ],

        # === Coach / team ===
        [
            "5620495",  # We have a new coach and some new players.
            "2545581",  # I used to coach football.
            "5422647",  # My coach helped me.
            "4667166",  # My dad was a coach.
            "4496638",  # The coach told me I needed to practice harder.
            "50255",    # Who coaches the team?
            "2854385",  # Who is the team's coach?
            "2955100",  # You've never coached before, have you?
            {"text": "Actually, I have.", "added_for": "actually|have", "reason": "natural correction"},
            "4496640",  # Coaching is my life.
            "4496646",  # We need some coaching.
        ],

        # === Winners / score ===
        [
            "2107367",  # We're winners.
            "5504816",  # We're all winners.
            "269968",   # Everybody loves a winner.
            "5085909",  # Everyone loves a winner.
            "1549993",  # Everyone's a winner.
            "1529448",  # Everybody's a winner.
            "5007736",  # They'll announce the winner tomorrow.
            "4495608",  # The winner hasn't yet been announced.
            "2547337",  # I won fair and square.
            "5859831",  # I scored thirty points.
            "1839624",  # What's the score?
        ],

        # === Hypotheticals: would have / could have / should have ===
        [
            "2538414",  # I would've done it, but you beat me to it.
            "4694606",  # You should've come sooner.
            "2540727",  # You should've brushed your teeth.
            "4011388",  # If I could've prevented this, I would've.
        ],

        [
            "5293404",  # What would you do if you had a billion dollars?
            {"text": "I'd travel the world.", "added_for": "travel|world", "reason": "natural hypothetical answer"},
            "1961376",  # I thought it would be an opportunity for you to improve your French.
            "5839822",  # How can I improve my memory?
            "3738712",  # Your memory hasn't improved much, has it?
            "20210",    # My memory is failing.
        ],

        # === Intend / plan ===
        [
            "2331905",  # I hadn't intended to stay this long.
            "1934659",  # I intend to change jobs.
            "2952297",  # I intend to destroy everything.
            "4873921",  # I intend to marry you.
            "2317468",  # I don't intend to be staying long.
            "2317469",  # I don't intend to leave it to chance.
            "1398459",  # I intend to stay at a five-star hotel.
            "404959",   # She intended to become an actress.
            "887226",   # She intended to go shopping.
        ],

        # === Aware — drill fixed: trimmed from 14 to 6, varied content ===
        [
            "2543023",  # I'm fully aware of that fact.
            "2544048",  # I'm well aware of the risk.
            "2542472",  # I'm aware of the difficulties.
            "2540974",  # I'm aware of my responsibilities.
            "2543176",  # I was unaware of the problem.
            "298347",   # He was unaware of the situation.
        ],

        # === Concern / worry — drill fixed: trimmed and varied ===
        [
            "4666002",  # That's our biggest concern.
            "3395881",  # What exactly is your concern?
            "3735119",  # There's no reason for concern.
            "4666054",  # Housing is the big concern.
            "4664842",  # I'm concerned about health care.
            "4664841",  # I'm deeply concerned about this.
            "261304",   # I'm very concerned about her illness.
            "2543455",  # I'm touched by your concern.
            "4496830",  # That concerns me.
        ],

        # === Suggestion / propose ===
        [
            "4502409",  # What you're suggesting is just not practical.
            "2647332",  # What do you propose?
            "4501560",  # What would you propose?
            "2280406",  # That's an excellent suggestion.
            "16975",    # Your suggestion is of no practical use.
            "2406831",  # I suggest we hurry.
        ],

        # === Review / examine / discuss ===
        [
            "5178596",  # Let's review the evidence.
            "276026",   # Let's review Lesson 5.
            "5178585",  # Let's examine the numbers.
            "2111839",  # Examine this.
            "2358880",  # I've already examined it.
            "4016380",  # There's one more item to discuss.
            "4016382",  # We have one more item to discuss.
            "2953603",  # We discussed it plenty of times.
        ],

        # === Survive / cope ===
        [
            "2107681",  # We'll survive.
            "2241003",  # We're survivors.
            "2244906",  # Are there survivors?
            "2123502",  # We're surviving.
            "2203842",  # I'm surviving.
            "2218042",  # You're a survivor.
            "5809767",  # I'm fortunate to have survived the accident.
        ],

        # === Face / problem / damage / structure (restored) ===
        [
            "5534861",  # We're facing serious problems.
            "5710869",  # We're facing a much bigger problem than that.
            "5553287",  # We've faced this problem before.
            "249129",   # We are faced with a difficult choice.
            "3725720",  # I have a skin condition.
            "1743481",  # You must be in good physical condition.
            "5085942",  # It's a very serious illness.
            "314935",   # She's suffering from a serious disease.
            "3315111",  # We suffered a pretty big loss.
            "800252",   # We suffered a lot of damage.
            {"text": "The structure of the old building is still solid.", "added_for": "structure", "reason": "restore 'structure' (lost vocab); concrete context"},
            "3635829",  # Look at all the damage you've caused.
            "1292930",  # The storm didn't cause any damage.
            "4016534",  # Did the storm cause any damage?
            "2243718",  # They've been damaged.
            "2248450",  # Is it damaged?
            "2545462",  # I'll pay for the damages.
            "1951447",  # I can't cover your losses this time.
            "1893736",  # We should cut our losses.
            "4980042",  # I lost my entire family.
            "274552",   # The loss amounts to ten million dollars.
        ],

        # === Pets / animals / feeding ===
        [
            "4530160",  # Pets are allowed.
            "4529959",  # Pets aren't allowed here.
            "5206938",  # I love pets of all kinds.
            "33974",    # My pet cat died yesterday.
            "4013801",  # I've always wanted a pet.
            "252481",   # I feed my dog twice a day.
            "898533",   # How much food should I be feeding my dog?
            "280214",   # Don't feed the animals.
            "4498496",  # My kids feed themselves.
            "2241088",  # We fed ourselves.
            "1371233",  # Feed the bird.
            "5852822",  # I fed the horses.
        ],

        # === Money / cash ===
        [
            "4501038",  # No cash was missing.
            "2360414",  # I have three hundred dollars in cash.
            "2713368",  # I'm not carrying any cash.
            "2206586",  # I ran out of gas.
            "1013930",  # We ran out of gas.
            "247550",   # Let's see if our cars have enough gas.
            "1708915",  # We accept credit cards.
            "62764",    # I'm calling because my credit card has been stolen.
        ],

        # === Price / amount ===
        [
            "3728667",  # That's the exact amount.
            "45249",    # The price includes tax.
            "3147920",  # They're just out of my price range.
        ],

        # === Plate / dirty (daily life) ===
        [
            "2646733",  # What's on your plate?
            "2730922",  # The plate is dirty.
            "2516414",  # This glass is dirty.
            "2730923",  # The knife is dirty.
            "1479176",  # It's dirt cheap.
            "274464",   # Your feet are dirty.
            "3783130",  # Don't touch this with your dirty hands.
            "5103540",  # My car's dirty.
            "416546",   # Please wash your hands properly before eating.
            "2548380",  # I washed the sheets.
            "1332073",  # These clothes are dirty and need to be washed.
            "1976503",  # Mary is hanging up the washing.
        ],

        # === Sheets / sleep / shower ===
        [
            "2490812",  # The sheets are clean.
            "250118",   # Give me a sheet of paper.
            "1898245",  # Someone's in the shower.
            "4546353",  # I often sing in the shower.
            "1048263",  # He always sings in the shower.
            "1048262",  # He always sings while taking a shower.
            "1841606",  # Let's hit the showers.
            "2042647",  # All I want now is a hot shower and a good night's sleep.
            "2733564",  # Nobody's taking a bath right now.
            "2733562",  # No one's in the bath.
            "282092",   # The hot bath relaxed her.
            "67657",    # I felt so sleepy that I could hardly keep my eyes open.
            "3511315",  # I slept through the entire movie.
            "2334078",  # I hardly slept last night.
        ],

        # === Memory / forgetting ===
        [
            "2248384",  # I've got memories.
            "4501024",  # What are your memories?
            "2358777",  # I have a photographic memory.
            "2045453",  # I hardly ever remember dreams.
            "1954779",  # I can't remember the secret code.
            "1396395",  # She never dreamed she'd meet him overseas.
            "3736694",  # I had completely forgotten pay the rent.
            "3594046",  # That hadn't occurred to me.
            "1140100",  # It never occurred to me that I might be fired.
            "5900445",  # This shouldn't have occurred.
            "274201",   # Didn't it occur to you to shut the windows?
            "440015",   # When did this occur?
        ],

        # === Smoking — packs/areas restored via rewrite ===
        [
            "18816",    # I advise you to stop smoking.
            "486137",   # My mother objects to smoking.
            "506942",   # I've given up smoking.
            "2301354",  # I can stop smoking anytime I want.
            "319015",   # My father smokes.
            "2249618",  # Nobody here smokes.
            "27940",    # The doctor warned him of the dangers of smoking.
            "886862",   # She advised him not to smoke.
            {"text": "He used to smoke a couple of packs a day.", "added_for": "packs", "reason": "restore 'packs' (lost vocab); strip self-disclosure"},
            {"text": "Smoking is banned in most public areas now.", "added_for": "areas", "reason": "restore 'areas' (lost vocab); strip 'hate'"},
        ],

        # === Hardly / barely — drill fixed: trimmed from 18 to 8, varied ===
        [
            "5186117",  # I was hardly surprised.
            "2334076",  # I hardly recognized you.
            "321869",   # I could hardly keep from laughing.
            "256746",   # I can hardly see without my glasses.
            "2223747",  # He has hardly any money, but he gets by.
            "31793",    # It hardly ever rains here.
            "24123",    # I had hardly left home when it began to rain heavily.
            "4500996",  # That hardly mattered.
        ],

        # === Reflect / mirror ===
        [
            "264666",   # It's time to reflect on your past.
            "254685",   # I reflected on the problem.
            "2396117",  # I saw my reflection in the window.
            "239967",   # We could see the reflection of the mountains in the lake.
            "270826",   # Water reflects light.
            "18924",    # A mirror reflects light.
            "1442254",  # She stood in front of the mirror.
            "4232602",  # I have a full-length mirror in my bedroom.
        ],

        # === Bridges & crossing ===
        [
            "2245246",  # Cross the bridge.
            "5504553",  # We need to build a bridge.
            "307014",   # They built a bridge across the river.
            "68449",    # That bridge is made of stone.
            "250522",   # My house is beyond that bridge.
            "1085018",  # Look at the train crossing the bridge.
            "1078027",  # I crossed the street.
            "258645",   # I crossed the river by boat.
            "3151295",  # The bridge suddenly gave way.
            "462614",   # The bridge was built by the Romans.
            "2807623",  # I drove my car off a bridge.
            "26921",    # Avoid crossing this street when it is raining.
            "4811056",  # The road was icy.
        ],

        # === Stress / mood / spirits / crime ===
        [
            "1553494",  # How do you handle stress?
            "3820541",  # Are you under any stress?
            "1895690",  # You seem stressed.
            "2255211",  # You seemed stressed.
            "4853367",  # It depends on my mood.
            "5374937",  # My spirits are up.
            "299666",   # He was in good spirits.
            "4500247",  # Crime is increasing.
            "2802631",  # A lot of crimes are not reported.
            "4502330",  # Stealing is a crime.
        ],

        # === Theft / police / prison ===
        [
            "5029978",  # The police planted evidence at the crime scene.
            "239532",   # Someone stole my cash.
            "238093",   # The police have been searching for the stolen goods for almost a month.
            "1820243",  # The prisoners tried to escape.
            "4496860",  # The escaped prisoners are considered dangerous.
            "4498336",  # A third of the prisoners have escaped.
            "317887",   # The prisoner was brought before a judge.
            {"text": "They were released on bail this morning.", "added_for": "released", "reason": "restore 'release' family (lost vocab); concrete legal context"},
        ],

        # === Sooner or later / function ===
        [
            "5922064",  # Everyone dies sooner or later.
            "1413807",  # He'll run out of luck sooner or later.
            "56681",    # This matter must be dealt with sooner or later.
            "1445499",  # I'm sorry that I didn't reply sooner.
            "3723963",  # It's still functioning.
            "1951643",  # I can't function without you.
        ],

        # === Childhood / nostalgia ===
        [
            "2377276",  # I learned that when I was a kid.
            "3010099",  # I liked climbing trees when I was a kid.
            "3010105",  # I loved to climb trees when I was a kid.
            "2952541",  # I used to love swimming when I was a kid.
            "5268899",  # My mother made me practice the piano every day when I was a kid.
            "3096976",  # I lived on a farm when I was a kid.
            "4921450",  # My kids grew up here.
            "3310128",  # We've been friends since we were kids.
            "5620428",  # We haven't seen each other since we were kids.
            "5842349",  # How has advertising changed since you were a kid?
            "4498959",  # We never went anywhere when I was a kid.
        ],

        # === Numbers / counting ===
        [
            "867320",   # Five plus three is eight.
            "475773",   # One plus two equals three.
            "4189627",  # Two plus two equals four.
            "73474",    # Count from 10 down to zero.
            "2248055",  # I'm keeping count.
            "274428",   # My son can't count yet.
            "3329584",  # Can I count on your support?
            {"text": "You can count on me.", "added_for": "count|on|me", "reason": "natural answer"},
            "3550297",  # Every minute counts.
            "5395118",  # Every minute counted.
            "4497078",  # Every penny counts.
            "2326234",  # I figured I could count on you.
            "2492888",  # There are fifteen people here, counting the guests.
            "2953198",  # Mary counted the remaining money in her bag.
            "2111525",  # Start counting.
            "1887991",  # I wouldn't count on that happening.
        ],

        # === Age / family ===
        [
            "61181",    # There are fifty members in this club.
            "278539",   # My kid brother is twelve.
            "250951",   # My sister is in her twenties.
            "288477",   # He is in his early twenties.
        ],

        # === Audience / event ===
        [
            "4494602",  # The audience is young.
            "20937",    # The audience appeared bored.
            "277941",   # The audience looked bored.
            "4500688",  # Is the audience listening?
            "277938",   # The audience was deeply affected.
            "4665732",  # The audience began to laugh.
            "2094810",  # Everybody in the audience sang along.
            "1635589",  # We want to reach a wider audience.
            "277932",   # The audience were all foreigners.
            "25911",    # There was a large audience at the concert.
            "244426",   # There was a large audience at yesterday's concert.
            "4493827",  # Around half of the audience were female.
        ],

        # === Directions / straight ===
        [
            "6002327",  # You're driving in the wrong direction.
            "5378776",  # We're headed in the right direction.
            "4496402",  # The wind may change direction.
            "278252",   # Draw a straight line.
            "269559",   # Go straight ahead.
            "32535",    # Look straight ahead.
            "1850252",  # Stand up straight.
            "63388",    # Sit up straight.
            "2473277",  # I've heard that sitting up straight is bad for your back.
            "4915840",  # Let's get our facts straight.
            "240263",   # Thank you for setting the record straight.
            "4502065",  # Someone should set those boys straight.
            "3377121",  # I got straight A's.
            "294132",   # He drew a straight line with his pencil.
            "2372853",  # I just needed directions.
            "2546108",  # I'll ask for directions.
        ],

        # === Skin / appearance ===
        [
            "6092654",  # I don't care what the color of your skin is.
            "282662",   # I have dry skin.
            "315089",   # She is dark-skinned.
            "254020",   # I got wet to the skin.
            "3395505",  # Mary was wearing men's clothing.
        ],

        # === Honesty / lie / source ===
        [
            "2271932",  # I honestly don't know.
            "5201620",  # Can you honestly imagine that happening?
            "4091322",  # My kids don't usually lie to me.
            "2954922",  # You're an excellent liar.
            "1954799",  # I can't reveal my source.
            "1954800",  # I can't reveal my sources.
            "887356",   # She revealed the secret to him.
            "1954872",  # You can't show this video to anyone.
            {"text": "I was banking on your help.", "added_for": "banking", "reason": "restore 'banking' (lost vocab); idiom 'banking on' is high-frequency at L9"},
        ],

        # === Focus / concentrate / concentration (restored) ===
        [
            "5279754",  # I don't think that's a factor.
            "2647178",  # Focus on the details.
            "1209509",  # Don't lose focus.
            "5077342",  # We need to maintain focus.
            "2451591",  # I'm focusing on my French.
            "2111513",  # Stay focused.
            "2111647",  # Keep focused.
            "2007834",  # Let's concentrate.
            "2111747",  # I'm concentrating.
            "266457",   # I have difficulty concentrating.
            "20406",    # Turn off the television. I can't concentrate.
            "286030",   # I concentrated on what he was saying.
            {"text": "This job demands real concentration.", "added_for": "concentration", "reason": "restore 'concentration' (lost vocab); shorter than original"},
        ],

        # === Explain / assume — drill fixed: trimmed from 17 to 7, varied ===
        [
            "3238996",  # Could you explain all the safety features to me once again?
            "2293193",  # I assume that's a joke.
            "2293221",  # I assume you know a little about computer programming.
            "1682851",  # I assumed it was free.
            "2208418",  # I assumed I'd go alone.
            "2953694",  # We must assume the worst.
            "4529076",  # Assuming this thing actually works, we'll be rich.
        ],

        # === Goals / achievement ===
        [
            "1825347",  # I reached my goal.
            "389034",   # She achieved her goal.
            "1292965",  # He finally achieved his goals.
            "3610554",  # Thank you for helping me reach my goals.
            "4529776",  # How can we achieve that goal?
            "3010552",  # It's great that you were able to achieve your goals.
            "262650",   # We advanced to the finals.
        ],

        # === Advance / warning / opportunity ===
        [
            "4529998",  # We knew that in advance.
            "4529747",  # There was no advance warning.
            "5051642",  # We had plenty of warning.
            "3185890",  # You're lucky they paid you in advance.
            "1153022",  # You should take advantage of this opportunity.
            "20488",    # You must take advantage of the opportunity.
            "2271366",  # Don't waste the opportunity.
            "2007317",  # Let's not waste this opportunity.
            "3821745",  # There will be new opportunities.
            "3821746",  # There will be other opportunities.
            "953556",   # I never miss the opportunity to eat Italian food.
            "4013955",  # It seemed like a good opportunity.
        ],

        # === Settle / decide ===
        [
            "3732354",  # It's all settled.
            "2250143",  # That settles it.
            "2250144",  # That settles that.
            "4813080",  # The case was settled out of court.
            "54959",    # Let's try to settle our differences once and for all.
            "2111557",  # Settle down!
            "3731218",  # Are you settling in?
            "257960",   # I can't make a decision on the spot. I'll have to talk to my boss first.
        ],

        # === Hide / observe ===
        [
            "2007528",  # Let's play hide and seek.
            "2530543",  # Do you want to play hide and seek?
            {"text": "Sure, that sounds fun.", "added_for": "sure|fun", "reason": "natural acceptance"},
            "289439",   # He hid his toys under the bed.
            "2852041",  # What have you observed?
            "20225",    # We must observe the rules.
            "2545372",  # I'm just here to observe.
            "276586",   # Nobody noticed that the picture was hung upside down.
            "49012",    # The picture was hung upside down.
        ],

        # === Plenty / much ===
        [
            "286695",   # There are plenty of books in his study.
            "1738674",  # There are plenty of rocks.
            "244707",   # We had plenty of snow last year.
            "5096626",  # There were plenty of choices.
            "3825743",  # There are more practical choices.
            "3821175",  # I advise you all to get plenty of rest.
            "2892138",  # There'll be plenty of time for that later.
            "3182050",  # There'll be plenty of time to talk later.
        ],

        # === Hurry ===
        [
            "4636274",  # Mom, hurry up! Everyone's waiting.
            "3280075",  # I'm in no particular hurry.
            "2546520",  # I'm sort of in a hurry.
            "3651697",  # I got dressed in a hurry.
            "3823656",  # I didn't realize you were in a hurry.
            "313183",   # She cleaned her room in a hurry.
            {"text": "No worries, take your time.", "added_for": "take|time", "reason": "natural reassurance"},
        ],

        # === Container / list ===
        [
            "1116338",  # The container is full.
            "1116339",  # The container is empty.
            "3396666",  # Do you know what's in those containers?
        ],

        # === Plastic / material ===
        [
            "463268",   # This chair is plastic.
            "34215",    # Plastic does not burn easily.
            "55116",    # These boxes are made of plastic.
            "4463352",  # Plastic bags are bad for the environment.
            "44223",    # There were various objects in the room.
        ],

        # === Divide / share / equal ===
        [
            "271700",   # A square has four equal sides.
            "5178655",  # Let's divide the work equally.
            "3821604",  # It's divided into three parts.
            "2682705",  # He divided the apples among the five of us.
            "2450001",  # Divide this among yourselves.
            "305101",   # Three quarters of them agreed.
            "306597",   # They are arguing about their share of the property.
        ],

        # === Height / wave / sea ===
        [
            "2397871",  # Line up by height, please.
            "4649594",  # We're about the same height.
            "1110791",  # I'm afraid of heights.
            "2547129",  # I'm scared of heights.
            "5397255",  # The sea level is rising.
            "282339",   # The waves are high.
        ],

        # === Tickets / spots / parking ===
        [
            "4494854",  # Tickets are limited.
            "1892806",  # Two adult tickets, please.
            "2358986",  # I have an extra ticket.
            "240311",   # I got a traffic ticket.
            "2162957",  # You missed a spot.
            "4663812",  # We couldn't have picked a better spot.
            "2422919",  # You're parked in my spot.
            "4999056",  # Someone parked in my spot.
            "4013141",  # All the parking spots were taken.
            "4013142",  # All the parking spots are taken.
        ],

        # === Switch / transfer ===
        [
            "2007774",  # Let's switch sides.
            "3635878",  # Switch places with me.
            "4846732",  # Maybe we should switch jobs.
            "6108765",  # Let's switch seats.
            "3327434",  # Can we switch seats?
            "38163",    # Where should I transfer?
            "2360604",  # I have to transfer schools.
            "2218107",  # You're being transferred.
            "2240550",  # We're being transferred.
            "2540121",  # I'm having my name legally changed.
            "3310033",  # We've decided to get legally separated.
        ],

        # === Hang / stick ===
        [
            "240276",   # The operator told me to hang up and wait for a moment.
            "2543657",  # I'll keep the motor running.
            "3655934",  # The motor stopped.
            "2649222",  # Hang on a sec.
            "1894336",  # Hang on tight.
            "2543665",  # I'll hang onto that for you.
            "920433",   # Thanks for sticking around.
            "255388",   # I'm sticking to my original plan.
            "2267771",  # Stick to the subject.
            "291219",   # He stuck the broken pieces together.
            "2044992",  # They're clearly not happy that they got stuck with that job.
        ],

        # === Property / belong ===
        [
            "1615171",  # This is private property.
            "47800",    # The property is mine.
            "2796918",  # Who owns this property?
            "256281",   # I belong to the drama club.
            "24813",    # Those who possess nothing lose nothing.
        ],

        # === Repeat / answer ===
        [
            "1845510",  # Don't repeat that.
            "250840",   # Repeat after me.
            "2404150",  # I repeated my name.
            "298954",   # He repeated his question.
            "2251340",  # That's worth repeating.
            "2955004",  # You're repeating yourself.
        ],

        # === Respond / react ===
        [
            "2646729",  # What's your response?
            "4902881",  # That wasn't the response we expected.
            "2111345",  # They'll respond.
            "2111908",  # Don't respond.
            "2203782",  # Who responded?
            "2245549",  # Have they responded?
            "2243652",  # They're not responding.
        ],

        # === Excited / pleased / satisfied ===
        [
            "4498368",  # The kids are excited.
            "3575400",  # Hey, I thought you'd be pleased.
            "5171727",  # I'm not satisfied either.
            "20408",    # You should continue until you're satisfied.
            "241775",   # I'm satisfied with my current income.
            "251311",   # Are you satisfied with my explanation?
            "5162723",  # I'm not satisfied with your performance.
            "2537705",  # I'm not satisfied with the quality of your work.
            {"text": "I'll try to do better.", "added_for": "try|better", "reason": "natural reaction to performance criticism"},
            "2249376",  # It's very satisfying.
        ],

        # === Mistakes ===
        [
            "36254",    # It may, indeed, be a mistake.
            "2380417",  # I made several mistakes on the final exam.
            "2329378",  # I gave you an extra hour and you still didn't finish the job.
        ],

        # === Birth / date ===
        [
            "3730767",  # What's your date of birth?
            "703328",   # What is your date of birth?
            "300712",   # He said that he had met her on the previous day.
        ],

        # === Doctor / appointment ===
        [
            "2542678",  # I have a doctor's appointment.
            "4015741",  # How did your doctor's appointment go?
            {"text": "It went well, thanks.", "added_for": "went|well", "reason": "natural answer"},
            "1174906",  # He always keeps appointments.
            "4495684",  # No appointments are necessary.
            "4529195",  # We're approaching the end of our journey.
            "4529506",  # Immediate action should be taken.
            "3226506",  # How immediate is the danger?
        ],

        # === Exam ===
        [
            "3824853",  # I've finished my exams.
            "3700295",  # Did you pass your exams?
            "2109",     # I don't want to fail my exams.
            "1556883",  # They failed the exam.
            "27825",    # I'm taking an exam in January.
            "909519",   # Don't forget to spend a little time looking over your notes before the exam.
            "1023550",  # I should be studying for tomorrow's exam.
            "263481",   # The examinations will begin on Monday next week.
            "314502",   # She passed the examination.
            "388728",   # I hope that Mary passes the examination.
            "2451060",  # I should be studying French, but it's more fun hanging out with you guys.
            "5201607",  # This is an excellent site for learning French.
            "2951485",  # All of my kids want to learn how to speak French.
        ],

        # === Measure / define / fashionable ===
        [
            "45019",    # Can you measure the length?
            "2941425",  # It's a difficult term to define.
            "3730898",  # How do you define normal?
            "5497852",  # They're normal kids.
            "5263799",  # I'm old-fashioned.
            "5171707",  # I'm not old fashioned.
            "310500",   # She always wears fashionable clothes.
            "310580",   # She's fashionable.
        ],

        # === Jacket / pocket ===
        [
            "2406811",  # I stuck my hands in my pockets.
            "3737958",  # How many pockets does that jacket have?
            "2249848",  # Remove that jacket.
            "3168074",  # Which one is your jacket?
            "42363",    # It's in my jacket pocket.
            "2985824",  # My down jacket kept me warm.
            "242164",   # I brought a jacket because it was quite cool this morning.
            "887173",   # She handed him his jacket then opened the door and asked him to leave.
            "2377301",  # I left my jacket in the classroom.
            "5852251",  # Where are your jackets?
            "4133484",  # Would you take my jacket to the cleaners?
        ],

        # === Clothing ===
        [
            "3030986",  # I want three pairs of socks.
            "2538803",  # You should pack an extra pair of socks.
            "290178",   # He selected a pair of socks to match his suit.
            "243063",   # I've worn out two pairs of shoes this year.
            "6028870",  # I'm buying myself a new pair of shoes.
            "1116305",  # These two shirts are made from the same material.
            "1116547",  # Those two shirts are made from the same material.
            "57738",    # This shop carries men's clothing.
            "1474116",  # There is no dress code.
            "319836",   # Is there a dress code?
        ],

        # === Smile / wave / advice ===
        [
            "272361",   # The baby smiled at me.
            "2642800",  # You ought to smile more often.
            "30490",    # You ought to eat more slowly.
            "15832",    # You ought to ask him for advice.
            "5828621",  # I waved.
            "5853211",  # I waved goodbye.
        ],

        # === Whisper / noise / silence ===
        [
            "297574",   # He whispered something to me.
            "302679",   # He whispered something to her.
            "2645617",  # Why are you whispering?
            "2646172",  # Why are we whispering?
            "4014160",  # The engine is making a funny noise.
            "4685145",  # The engine is noisy.
            "274322",   # The noise bothers me.
            "2064916",  # Something's wrong with the engine.
            "273688",   # We sat in total silence.
            "1360862",  # You don't need to suffer in silence.
            "2255346",  # You'll be silenced.
            "4502888",  # We won't be silenced.
        ],

        # === Bother ===
        [
            "2269358",  # Oh, don't bother.
            "2250422",  # Don't even bother coming.
            "2955014",  # You're starting to bother me.
            "58671",    # Don't bother to answer this letter.
            "3822605",  # That bothers me.
            "5478877",  # That's affecting me.
            "5505631",  # Why bother fixing it?
            "5545139",  # Why should we bother fixing it?
            "4496130",  # Nobody else bothered us.
            "3505748",  # Listen, I'm sorry we bothered you.
            "262417",   # Stop bothering me!
            "2389878",  # I pretended that it didn't bother me.
            "2376436",  # I know when something's bothering you.
        ],

        # === Spend (time) ===
        [
            "2042670",  # Do we really want to spend the entire weekend doing this?
            {"text": "Not really.", "added_for": "not|really", "reason": "natural answer"},
            "258318",   # I've spent the entire morning cleaning my room.
            "2406558",  # I spent the entire morning filling out these forms.
            "909569",   # Some people think the president spends too much time traveling.
        ],

        # === Smartest / class ===
        [
            "3402292",  # You're a smart kid, aren't you?
            "4538071",  # Who do you think is the smartest kid in your class?
            "953376",   # I can't believe that you were the smartest kid in your class.
            "5916912",  # You're a strange kid.
            "4983566",  # Some of my less intelligent friends smoke.
        ],

        # === Method / process ===
        [
            "4502946",  # Both methods worked well.
            "4502145",  # Our method is simple.
            "3826228",  # Your method is better.
            "3722573",  # The process is simple.
            "5040299",  # It's a very slow process.
            "3826757",  # This is simply amazing.
            "4665274",  # The process has already begun.
        ],

        # === Toys / play ===
        [
            "321448",   # Please fix my toy.
            "746654",   # He threw his toy.
            "64842",    # The toy department is on the fifth floor.
            "4022700",  # These toys are very popular.
            "245785",   # Children like to pretend to be adults when they play.
            "5418380",  # Act like adults.
            "2218080",  # You're an adult.
            "708205",   # Don't let the kid play with knives.
        ],

        # === Affect / impact ===
        [
            "4495515",  # Will this affect me?
            "3818012",  # How does that affect you?
            "4529500",  # Not every community was affected.
            "51884",    # The strike affected the nation's economy.
            "2663415",  # This problem affects us all.
            "4530125",  # It affects all of us.
        ],

        # === Heat / heater ===
        [
            "282114",   # Heat is a form of energy.
            "2688112",  # The heat was terrible.
            "60624",    # This heater burns gas.
            "1007973",  # The heater is warming up the room.
            "5813921",  # Heating water is expensive.
            "1088103",  # Is there central heating in this building?
            "57304",    # This room heats easily.
            "40743",    # No matter how cold it is outside, the rooms are comfortably heated.
            "476382",   # My father hates the summer heat.
            "2253699",  # Things got heated.
            "4541063",  # We had a heated discussion.
        ],

        # === Temperature / fire / spread ===
        [
            "2259449",  # The temperature fell.
            "326483",   # I took my temperature every six hours.
            "4872439",  # The level of the lake dropped.
            "4498700",  # The fire is spreading.
            "4500862",  # The fires are spreading.
            "742938",   # These measures can prevent the disease from spreading.
            "3722036",  # I'll spread the word.
            "31948",    # Mary spread the big map on the table.
            "277235",   # Let's spread the map on the table and talk it over.
        ],

        # === Sample / surround / collect / stamp ===
        [
            "2253257",  # This is a free sample.
            "3312829",  # We need to get a blood sample.
            "2253689",  # They're surrounding us.
            "967723",   # The house was surrounded by fields.
            "4665336",  # I enjoy collecting rare coins.
            "681841",   # I collect rare coins.
            "2290381",  # I didn't know you collected stamps.
            "272463",   # I lost interest in collecting stamps.
            "248469",   # We managed to get some foreign stamps.
            "272462",   # You can buy stamps at any post office.
            "2291381",  # He stamped out the fire.
            "735080",   # I need a stamp.
            "2012706",  # I'd like one stamp, please.
        ],

        # === Dance ===
        [
            "5839958",  # I'm a dancer.
            "1890957",  # I'm a terrible dancer.
            "2546532",  # I'm one of the dancers.
            "3825489",  # I don't like square dancing.
        ],

        # === Power / strength / lazy ===
        [
            "300614",   # He has absolute power.
            "1812",     # That's the absolute truth.
            "5859389",  # I'm a lazy person.
            "5858552",  # I tend to be lazy.
            "304864",   # He has powerful arms.
            "3733660",  # This is powerful stuff.
        ],

        # === Smoke / fire ===
        [
            "3130449",  # Smoke is coming out of the kitchen.
            "25905",    # The smoke blew away.
            "680229",   # Smoke appeared.
            "3170669",  # The walls were black with smoke damage.
        ],

        # === Depend / point of view ===
        [
            "2818089",  # I ought to have enough money saved up to buy a car by Christmas.
            "278891",   # I guess it depends on the weather.
            "262698",   # We depend on you.
            "3593986",  # That might depend on your point of view.
            "972853",   # A person's way of looking at something depends on his situation.
            "325156",   # I'm depending on you.
            "2479101",  # I'm depending on your help.
        ],

        # === Survey / data / list ===
        [
            "2007729",  # Let's take a survey.
            "4497999",  # Who did they survey?
            "2023076",  # Is this list reliable?
            "60882",    # I'm afraid this data is not reliable.
            "249868",   # I need the following items.
            "4501574",  # Materials will be provided.
            "473770",   # I'm going to go buy some materials today.
            "1552272",  # We've already seen this material.
        ],

        # === Funding / investments ===
        [
            "4500819",  # We've lost our funding.
            "6096960",  # Who's funding the project?
            "298293",   # He's good at fund raising.
            "323867",   # The problem is how to raise the funds.
            "306747",   # They are short of funds.
            "2249052",  # It's an investment.
            "3518542",  # It's a bad investment.
            "3312993",  # We made some bad investments.
            "4500342",  # They need investors.
        ],

        # === Nowadays / generation (restored) ===
        [
            "2672070",  # People live longer nowadays.
            "59233",    # Nowadays, traveling costs a lot of money.
            "279429",   # People living in town don't know the pleasures of country life.
            {"text": "My grandmother's generation lived very differently.", "added_for": "generation", "reason": "restore 'generation' (lost vocab); positive nostalgic frame"},
            "307300",   # They have nothing in common with the older generation.
        ],

        # === Tourists / sights ===
        [
            "5075",     # I'm a tourist.
            "2243583",  # They're all tourists.
            "307671",   # They approached the tourists and asked them for money.
            "4664835",  # It's a major tourist attraction.
        ],

        # === Contact / directly ===
        [
            "288745",   # He will be contacting you directly.
            "5683560",  # I've started screening my calls.
        ],

        # === Misc small physicals ===
        [
            "298442",   # He stuck his pencil behind his ear.
            "321122",   # I hung my hat on the peg.
            "1102963",  # Their hats are hanging over there.
        ],

        # === Acting / pretending ===
        [
            "317048",   # She acted like a real baby.
        ],
    ],
}
