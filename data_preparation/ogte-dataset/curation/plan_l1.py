"""Curation plan for OGTE Level 1.

See curation/plans.py for the loading + merge logic and curation/curate.py
for how plans are applied. Each arc may be a list (auto-positioned by
min original_index) or a dict {"position": "first"|"last", "items": [...]}.
"""

from __future__ import annotations


L1_PLAN = {
    "removals": [
        {"id": "1312867", "reason": "Refers to a Japanese name ('yuri') — awkward to translate / explain at L1."},
        {"id": "255918", "reason": "'R&B' — music-genre brand, unhelpful for a learner."},
        {"id": "953107", "reason": "'Facebook' — dated brand reference at level 1."},
        {"id": "2341020", "reason": "Mozart — proper name with no transfer value at L1."},
        {"id": "2548482", "reason": "FBI — US-specific and slightly threatening in tone."},
        {"id": "1891161", "reason": "FBI duplicate — see above."},
        {"id": "2642772", "reason": "iPad — dated brand at L1."},
        {"id": "5852769", "reason": "iPod — dated brand at L1."},
        {"id": "2273969", "reason": "'Women don't like me.' — negative gender generalisation."},
        {"id": "2280287", "reason": "'Girls don't like you.' — negative gender generalisation."},
        {"id": "2245945", "reason": "'I like women.' — out-of-context, reads creepy at L1."},
        {"id": "2245935", "reason": "'I like girls.' — same problem."},
        {"id": "2892704", "reason": "'What's the upside to that?' — idiomatic and abstract."},
        {"id": "2267847", "reason": "'That isn't to my liking.' — formal idiom, not L1."},
        {"id": "3345294", "reason": "'You're putting me on.' — idiom."},
        {"id": "2250103", "reason": "'That does it.' — context-dependent idiom."},
        {"id": "4282325", "reason": "'Isn't that a girl's name?' — awkward gendered name framing."},
        {"id": "4282326", "reason": "'Isn't that a boy's name?' — awkward gendered name framing."},
        {"id": "436343", "reason": "Origin pattern duplicated — keep Brazil + France only."},
        {"id": "52481", "reason": "Origin pattern duplicated — keep Brazil + France only."},
        {"id": "1046163", "reason": "Specific number ('She has 2,000 books.') — unusual."},
        {"id": "593257", "reason": "'It's 2:00 p.m.' — covered by 8:00 p.m. duplicate next door."},
        {"id": "55477", "reason": "'This is Japan.' — country list inflated; covered later."},
        {"id": "29415", "reason": "'Rome is in Italy.' — geography quiz, not conversation."},
        {"id": "748748", "reason": "'Thailand is in Asia.' — geography quiz, redundant."},
        {"id": "55804", "reason": "'This is a book about England.' — too narrative."},
        {"id": "319296", "reason": "'My father has gone to China.' — keep simpler 'They have gone to Europe.'"},
        {"id": "70049", "reason": "'Do you like San Francisco?' — niche US city."},
        {"id": "6565057", "reason": "'We want to go to Boston and Chicago.' — niche US cities."},
        {"id": "2234070", "reason": "'What's Boston like?' — niche US city."},
        {"id": "2244900", "reason": "L1 doesn't have 'America loves you' — actually L2 — skip if missing."},
    ],
    "arcs": [
        {
            "position": "first",
            "items": [
                "538123",
                "373330",
                "30316",
                {"text": "Good, thanks!", "added_for": "good", "reason": "natural answer to 'How are you?'"},
                {"text": "And you?", "added_for": "and", "reason": "returns the question"},
                {"text": "I'm good, too.", "added_for": "too", "reason": "answers 'And you?'"},
                {"text": "Nice to meet you.", "added_for": "nice|meet", "reason": "closes the first-meeting exchange"},
            ],
        },
        {
            "position": "first",
            "items": [
                "2057650",
                {"text": "You're welcome.", "added_for": "welcome", "reason": "pairs with Thanks"},
            ],
        },
        [
            "25164",
            {"text": "Not much.", "added_for": "much", "reason": "casual response to 'What's up?'"},
        ],
        {
            "position": "first",
            "items": [
                {"text": "Excuse me.", "added_for": "excuse", "reason": "high-frequency polite opener"},
                {"text": "Sorry.", "added_for": "sorry", "reason": "essential apology"},
                {"text": "No problem.", "added_for": "problem", "reason": "natural response after sorry/thanks"},
            ],
        },
        {
            "position": "first",
            "items": [
                {"text": "I don't understand.", "added_for": "understand", "reason": "fundamental comprehension phrase"},
                {"text": "Can you repeat that?", "added_for": "repeat", "reason": "essential clarification request"},
                {"text": "Please speak slowly.", "added_for": "slowly", "reason": "essential request for slower speech"},
            ],
        },
        {
            "position": "first",
            "items": [
                {"text": "Do you speak English?", "added_for": "speak", "reason": "fundamental language question"},
                {"text": "I speak a little English.", "added_for": "little", "reason": "honest beginner answer"},
            ],
        },
        {
            "position": "first",
            "items": [
                {"text": "Where is the toilet?", "added_for": "toilet", "reason": "high-frequency survival question"},
                {"text": "It's over there.", "added_for": "over|there", "reason": "natural answer to 'Where is …?'"},
                {"text": "Can you show me?", "added_for": "show", "reason": "common follow-up to 'where is'"},
                {"text": "Sure, follow me.", "added_for": "sure|follow", "reason": "natural answer"},
            ],
        },
        {
            "position": "first",
            "items": [
                {"text": "I am tired.", "added_for": "tired", "reason": "basic feeling state"},
                {"text": "I am hungry.", "added_for": "hungry", "reason": "basic feeling state"},
            ],
        },
        {
            "position": "first",
            "items": [
                {"text": "What time is it?", "added_for": "time", "reason": "basic time-asking essential"},
                {"text": "It's three o'clock.", "added_for": "three|o'clock", "reason": "natural time answer"},
                {"text": "I think so.", "added_for": "think", "reason": "pairs with 'I don't think so'"},
                {"text": "It doesn't matter.", "added_for": "matter", "reason": "high-frequency reply"},
            ],
        },
        {
            "position": "first",
            "items": [
                {"text": "I am a tourist.", "added_for": "tourist", "reason": "common self-description for travelers"},
                {"text": "I am a student.", "added_for": "student", "reason": "second self-description option"},
            ],
        },
        [
            "516745",
            {"text": "See you later.", "added_for": "later", "reason": "natural pair"},
            {"text": "Bye!", "added_for": "bye", "reason": "casual goodbye variant"},
        ],
        [
            "1308",
            "1337519",
        ],
        [
            "16492",
            {"text": "I'm playing.", "added_for": "i'm|playing", "reason": "natural answer"},
            "1886817",
            {"text": "We're going out.", "added_for": "we're|out", "reason": "natural answer"},
        ],
        [
            "3448814",
            "1299275",
        ],
        [
            "2011294",
            "2050585",
            "2545329",
            "2270518",
        ],
        [
            "1140042",
            "2248241",
        ],
        [
            "887513",
            "887271",
            "313002",
        ],
        [
            "3408805",
            "2091101",
            "4751088",
        ],
        [
            "2276504",
            "4012925",
        ],
        [
            "3821060",
            "3825299",
        ],
        [
            "2270532",
            "2396308",
        ],
        [
            "2242977",
            "2252720",
        ],
        [
            "2544489",
            "6532401",
        ],
        [
            "2544490",
            {"text": "His name is Tom.", "added_for": "his", "reason": "natural answer to name question"},
            "1495893",
            {"text": "He's fine.", "added_for": "he's", "reason": "natural answer to how-is"},
        ],
        [
            "2647340",
            {"text": "My name is Tom.", "added_for": "tom", "reason": "answer pattern"},
            "4666222",
        ],
        [
            "2405921",
            "2243299",
        ],
        [
            "2123558",
            "2123589",
        ],
        [
            "2111563",
            "2111564",
        ],
        [
            {"text": "Where are you from?", "added_for": "where", "reason": "essential origin question"},
            "730626",
            "456719",
            "253015",
        ],
        [
            "2248962",
            "3722956",
            "1895638",
        ],
        [
            "386704",
            "453328",
        ],
        [
            "2647806",
            "619646",
            "2646229",
        ],
        [
            "5852683",
            "1885868",
            {"text": "It's good.", "added_for": "it's|good", "reason": "natural answer"},
        ],
        [
            "1855110",
            "2241532",
            "2243533",
        ],
        [
            "1174876",
            "2006375",
            "2203688",
        ],
        [
            "2549436",
            "2243047",
        ],
        [
            "4530155",
            "1841600",
            "5434712",
        ],
        [
            "2111215",
            "306102",
        ],
        [
            "2253748",
            "1898070",
        ],
        [
            "5851859",
            "1886804",
            {"text": "A book.", "added_for": "book", "reason": "natural answer"},
        ],
        [
            "2111326",
            "3564116",
        ],
        [
            "2549628",
            "2111470",
        ],
        [
            "2765357",
            "2111559",
        ],
        [
            "2233691",
            "413066",
        ],
        [
            "24867",
            "2254540",
        ],
        [
            "1841498",
            "1804029",
        ],
        [
            "1300772",
            "252995",
        ],
        [
            "2221070",
            "309022",
        ],
        [
            "2255333",
            "3396603",
        ],
        [
            "3378906",
            "4500147",
        ],
        [
            "388869",
            "2648538",
        ],
        [
            "1886819",
            "1886365",
            {"text": "Yes, they're for you.", "added_for": "for", "reason": "natural yes-answer to 'Are those for me?'"},
        ],
        [
            "2647813",
            {"text": "It says 'hello'.", "added_for": "says", "reason": "natural answer to 'What does this say?'"},
        ],
        [
            "2645643",
            {"text": "His name is Sam.", "added_for": "sam", "reason": "natural answer to 'What's that boy's name?'"},
            {"text": "How old is he?", "added_for": "old", "reason": "introduces the essential age question"},
            {"text": "He's ten.", "added_for": "ten", "reason": "natural age answer using a basic number"},
        ],
        [
            "1485272",
            {"text": "It wasn't easy.", "added_for": "easy", "reason": "natural answer to 'How'd you do it?'"},
        ],
        [
            "2255351",
            {"text": "I hope so.", "added_for": "hope", "reason": "natural response to a reassurance"},
        ],
    ],
}
