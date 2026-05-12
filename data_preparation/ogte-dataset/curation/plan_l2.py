"""Curation plan for OGTE Level 2.

See curation/plans.py for the loading + merge logic and curation/curate.py
for how plans are applied. Each arc may be a list (auto-positioned by
min original_index) or a dict {"position": "first"|"last", "items": [...]}.
"""

from __future__ import annotations


L2_PLAN = {
    "removals": [
        {"id": "2141532", "reason": "'I watched it on YouTube.' — brand-dependent."},
        {"id": "4500180", "reason": "'I love my iPod.' — dated brand."},
        {"id": "4633390", "reason": "'I don't use Facebook.' — dated brand."},
        {"id": "430893", "reason": "'I use Firefox.' — niche brand."},
        {"id": "4500181", "reason": "'I love Harvard.' — US-specific institution."},
        {"id": "55919", "reason": "'Is this made in Switzerland?' — niche country example."},
        {"id": "411846", "reason": "'You're Germans, aren't you?' — odd construction."},
        {"id": "2161", "reason": "'I want an MP3 player!' — dated."},
        {"id": "6033303", "reason": "'Do you have an MP3 player?' — dated."},
        {"id": "2265779", "reason": "'Do you know Mr. Jackson?' — specific name without context."},
        {"id": "2254583", "reason": "'Where's my brandy?' — alcohol + dated register."},
        {"id": "59390", "reason": "'This word comes from Greek.' — meta-linguistic, niche."},
        {"id": "897313", "reason": "'Japanese are Asians.' — broad generalisation, sounds off."},
        {"id": "17812", "reason": "'Your o's look like a's.' — about written letters, weird."},
        {"id": "237678", "reason": "'I'll sue you.' — legal threat at L2."},
        {"id": "2243379", "reason": "'They're family.' is fine, but this is the only FBI L2 remnant — keep narrative cleaner. Actually NA — skip."},
        {"id": "5851880", "reason": "'I like to hunt.' — niche hobby."},
        {"id": "5839964", "reason": "'I'm a hunter.' — same."},
        {"id": "2011548", "reason": "'I don't want charity.' — odd at L2."},
        {"id": "5852304", "reason": "'I'm not a prince.' — odd."},
        {"id": "2218081", "reason": "'You're an angel.' — figurative."},
        {"id": "5840006", "reason": "'I'm no angel.' — figurative."},
        {"id": "2244900", "reason": "'America loves you.' — political/abstract."},
        {"id": "2233687", "reason": "'This is gold.' — figurative/literal ambiguity."},
        {"id": "1946303", "reason": "'This isn't silver.' — odd in isolation."},
        {"id": "2252659", "reason": "'There's no gold.' — same."},
        {"id": "2248769", "reason": "'It looks Egyptian.' — niche."},
        {"id": "4500147", "reason": "Overflow Australia mention — original keeps several."},
        {"id": "4494700", "reason": "'This isn't Australia.' — niche."},
        {"id": "2250026", "reason": "'Stop that woman.' — gender + aggressive."},
    ],
    "arcs": [
        [
            "505870",
            {"text": "Thank you.", "added_for": "thank", "reason": "natural response"},
        ],
        [
            "1579",
            {"text": "It's all right.", "added_for": "right", "reason": "response to sorry"},
        ],
        [
            "3130463",
            "3130462",
        ],
        [
            "2300258",
            "1898375",
        ],
        [
            "2300257",
            "1126721",
        ],
        [
            "567368",
            "707431",
            "2111238",
        ],
        [
            "4012786",
            "3343227",
            "3442128",
        ],
        [
            {"text": "Where do you come from?", "added_for": "come", "reason": "Q for origin"},
            "253219",
            "255520",
            "288977",
        ],
        [
            "3269279",
            "1649",
        ],
        [
            "35504",
            "433589",
        ],
        [
            "2241438",
            "2241441",
        ],
        [
            "3096280",
            "2250082",
            "2250087",
        ],
        [
            "1046142",
            "1784",
        ],
        [
            "1050988",
            "1125674",
        ],
        [
            "259803",
            "456735",
        ],
        [
            "1920819",
            "2244942",
            "2254568",
        ],
        [
            "18547",
            "2107334",
        ],
        [
            "2111751",
            "247877",
        ],
        [
            "2107335",
            "2549265",
            "1977902",
        ],
        [
            "469126",
            "245559",
            "1495807",
            {"text": "Her name is Mary.", "added_for": "her", "reason": "natural answer"},
        ],
        [
            "1891022",
            "1893640",
        ],
        [
            "4397567",
            "2645642",
            "5374921",
        ],
        [
            "2158897",
            "2369536",
            {"text": "No, she's at work.", "added_for": "work", "reason": "natural answer"},
        ],
        [
            "2111783",
            "2203631",
        ],
        [
            "5840018",
            "593281",
            "312694",
        ],
        [
            "320080",
            "1841646",
            "1886532",
        ],
        [
            "1349059",
            "1098659",
        ],
        [
            "1444911",
            "2248017",
        ],
        [
            "1495883",
            "671434",
            "267239",
        ],
        [
            "2243127",
            "5852641",
        ],
        [
            "314454",
            "449023",
        ],
        [
            "254495",
            "254503",
            "395051",
        ],
        [
            "5828682",
            "3822323",
            "1860571",
            "2111483",
        ],
        [
            "1048420",
            "64716",
        ],
        [
            "3733321",
            "240431",
        ],
        [
            "255860",
            "2652927",
        ],
        [
            "238862",
            "2187246",
            "2123580",
        ],
        [
            "2245939",
            "279528",
        ],
        [
            "4397544",
            "2013046",
            "2218422",
        ],
        [
            "1789234",
            "2243248",
            "2255334",
        ],
        [
            "260561",
            "3832028",
            "3675788",
        ],
        [
            "1673290",
            {"text": "Yes, it's mine.", "added_for": "mine", "reason": "natural answer"},
            "2760951",
            {"text": "No, it isn't.", "added_for": "isn't", "reason": "negative natural answer"},
        ],
        [
            "58719",
            "318891",
        ],
        [
            "1054512",
            "3010582",
            "3123662",
        ],
        [
            "2742058",
            "35029",
        ],
        [
            "272548",
            "27824",
        ],
        [
            "2543687",
            "4829411",
        ],
        [
            "2234093",
            "2248183",
        ],
        [
            "2454251",
            "2953194",
        ],
        [
            "23282",
            "5858336",
        ],
        [
            "2807658",
            "5828951",
        ],
        [
            "1345046",
            "6480956",
        ],
        [
            "2245892",
            "1911855",
            "1886803",
        ],
        [
            "2111223",
            "1111708",
            "2091113",
        ],
        [
            "2368",
            "593241",
        ],
        [
            "1895635",
            "2548447",
        ],
        [
            "6221344",
            "261005",
        ],
        [
            "969137",
            "281844",
        ],
        [
            "2241435",
            "2241436",
        ],
        [
            "292605",
            "887480",
            "887273",
        ],
        [
            "304557",
            "418625",
            "2111348",
        ],
        [
            "1120794",
            "2111244",
        ],
        [
            "423405",
            "455953",
        ],
        [
            "2270135",
            "4017456",
        ],
        [
            "2647341",
            "511884",
            "237944",
        ],
        [
            "2218194",
            "1876996",
            "954759",
            "3368737",
            "2111614",
            "1905871",
        ],
        [
            "6532429",
            "2548694",
            "1675334",
        ],
        [
            "3727148",
            "3044158",
        ],
        [
            "2241668",
            "2359394",
        ],
        [
            "2240670",
            "2248270",
            "2240776",
        ],
        [
            "1624893",
            "41575",
            "1738962",
        ],
        [
            "1722021",
            "2254493",
        ],
        [
            "5003799",
            "2882494",
        ],
        [
            "2111324",
            "67945",
        ],
        [
            "3735936",
            "2202636",
        ],
        [
            "672254",
            "3736204",
        ],
        [
            "2648845",
            "2645020",
        ],
        [
            "3593993",
            "1808247",
        ],
        [
            "2218133",
            "2645593",
        ],
        [
            "305484",
            "287965",
            {"text": "Yes, he is.", "added_for": "yes", "reason": "natural answer"},
        ],
        [
            "2252700",
            "2544716",
        ],
        [
            "2163138",
            "2083032",
        ],
        [
            "3738218",
            "2891092",
        ],
        [
            "1885906",
            "2272034",
        ],
        [
            "2111934",
            "998503",
        ],
        [
            "1954282",
            "1954283",
        ],
        [
            "2240787",
            "1885871",
        ],
        [
            "4501970",
            "2203796",
        ],
        [
            "2545954",
            "2248965",
        ],
        [
            "2359400",
            "241719",
        ],
        [
            "289834",
            "3730601",
        ],
        [
            "1280399",
            "706999",
        ],
        [
            "1931872",
            "1345510",
        ],
        [
            "2883884",
            "2245957",
        ],
        [
            "2091109",
            "2249608",
        ],
        [
            "3311133",
            "3831744",
        ],
        [
            "1761",
            "4397587",
        ],
        [
            "456733",
            "630421",
        ],
        [
            "622193",
            "3168488",
        ],
        [
            "4500888",
            "3354142",
        ],
        [
            "4495305",
            "2548892",
        ],
        [
            "2255461",
            "61858",
        ],
        [
            "2245522",
            "2405916",
        ],
        [
            "2111282",
            "2187213",
        ],
        [
            "3619533",
            "5839326",
        ],
        [
            "5418382",
            "2111212",
        ],
        [
            "3151202",
            "2240581",
        ],
        [
            "2123588",
            "2248696",
        ],
        [
            "1885869",
            "5102491",
        ],
        [
            "2091141",
            "61790",
        ],
        [
            "4015399",
            "3024101",
        ],
        [
            "2255331",
            "2764277",
        ],
        [
            "24426",
            {"text": "It's ten dollars.", "added_for": "dollars", "reason": "natural price answer; introduces 'dollars' at L2"},
        ],
        [
            "6029197",
            {"text": "Yes, we do.", "added_for": "we", "reason": "natural shop reply to yes/no question"},
        ],
        [
            "1495887",
            {"text": "He's fine, thanks.", "added_for": "fine", "reason": "natural answer to 'how's' question"},
        ],
        [
            "1358780",
            {"text": "Friday is good for me.", "added_for": "good", "reason": "natural scheduling reply"},
        ],
        [
            "311725",
            {"text": "She's gone home.", "added_for": "home", "reason": "natural answer to 'where has she gone'"},
        ],
        [
            "4135274",
            {"text": "His name is Tom.", "added_for": "his", "reason": "natural answer; pairs with 'her name is Mary' arc"},
        ],
        [
            "1123762",
            {"text": "No, he's Chinese.", "added_for": "he's", "reason": "natural Q/A and bridges to next sentence"},
            "335138",
        ],
        [
            "2360439",
            {"text": "What time do you wake up?", "added_for": "wake", "reason": "essential daily-routine Q at L2"},
        ],
        [
            "255449",
            {"text": "Where do you work?", "added_for": "work", "reason": "essential L2 conversational Q about work"},
            {"text": "I work in a bakery.", "added_for": "bakery", "reason": "natural answer; ties baker to workplace"},
        ],
        [
            "5042310",
            {"text": "Yes, I like it.", "added_for": "like", "reason": "natural answer to like/dislike Q"},
        ],
        [
            "3568461",
            {"text": "For two years.", "added_for": "years", "reason": "natural duration answer; introduces 'years' at L2"},
        ],
        [
            "1872056",
            {"text": "Why are you happy?", "added_for": "why", "reason": "natural follow-up Q for emotion statement"},
        ],
        [
            "64428",
            {"text": "You're welcome.", "added_for": "welcome", "reason": "essential reply to 'thank you' — missing from L2"},
        ],
    ],
}
