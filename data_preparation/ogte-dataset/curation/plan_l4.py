"""Curation plan for OGTE Level 4.

See curation/plans.py for the loading + merge logic and curation/curate.py
for how plans are applied. Each arc may be a list (auto-positioned by
min original_index) or a dict {"position": "first"|"last", "items": [...]}.
"""

from __future__ import annotations


L4_PLAN = {
    "removals": [
        {"id": "4208260", "reason": "'Can I find you on Facebook?' — brand."},
        {"id": "29659", "reason": "'Lincoln Center' — US-specific proper noun."},
        {"id": "262240", "reason": "'I like apples.' — too similar to 'I like X food' set; we'll trim food redundantly."},
        {"id": "2026567", "reason": "'I never thought I'd want to buy an iPad.' — brand."},
        {"id": "2299529", "reason": "'I bought that off eBay.' — brand."},
        {"id": "34373", "reason": "'I'll buy a Ford.' — brand."},
        {"id": "1876166", "reason": "'Darwin changed the world.' — proper name without context."},
        {"id": "3157924", "reason": "'Who wrote Romeo and Juliet?' — niche reference."},
        {"id": "6033427", "reason": "'I like Indian food.' — food list duplication."},
        {"id": "953525", "reason": "'I love Italian food.' — food list duplication."},
        {"id": "399107", "reason": "'I love Korean food.' — food list duplication."},
        {"id": "5809111", "reason": "'Have you ever tried Turkish food?' — food list duplication."},
        {"id": "1936302", "reason": "'I'd like to try some Thai food.' — food list duplication."},
        {"id": "5636641", "reason": "'I really miss Thai food.' — food list duplication."},
        {"id": "2403660", "reason": "'Do you like Indonesian food?' — food list duplication."},
        {"id": "5584727", "reason": "Duplicate 'I like Chinese food.'"},
        {"id": "2263576", "reason": "Duplicate 'I like Korean food.'"},
        {"id": "6033400", "reason": "Duplicate 'I like Mexican food.'"},
        {"id": "262138", "reason": "'I'm leaving for Chicago next week.' — repeated departure pattern."},
        {"id": "2635929", "reason": "'I need to go to Chicago.' — same."},
        {"id": "289234", "reason": "'When did he go to Europe?' — Europe already covered."},
        {"id": "5849151", "reason": "'What's your French teacher's name?' — over-specific."},
        {"id": "928604", "reason": "'Daniel got a good job.' — uses unintroduced name."},
        {"id": "255439", "reason": "'I wish to go to Hawaii.' — niche US destination."},
        {"id": "257818", "reason": "'I went to Vienna for the first time…' — niche city."},
        {"id": "71436", "reason": "'The man you saw in my office yesterday is from Belgium.' — niche + long."},
        {"id": "2549133", "reason": "'I went to Harvard.' — US institution brand."},
        {"id": "2329615", "reason": "'I got into Harvard.' — same."},
        {"id": "454466", "reason": "'Is Mrs. Smith an English teacher?' — niche surname."},
        {"id": "887081", "reason": "'She didn't want him to go out with other women.' — relationship drama."},
        {"id": "2475738", "reason": "'Mary has two boyfriends.' — judgmental framing."},
        {"id": "40595", "reason": "'Maybe he has lots of girlfriends.' — judgmental framing."},
        {"id": "310296", "reason": "'She has too many boyfriends.' — same."},
        {"id": "2539850", "reason": "'I was your mother's first boyfriend.' — odd."},
        {"id": "317458", "reason": "'She'll make a good wife.' — sexist."},
        {"id": "1956300", "reason": "'That's a woman's job.' — sexist."},
        {"id": "1956301", "reason": "'That's a man's job.' — sexist."},
        {"id": "4494288", "reason": "'Every woman is different.' — generalisation."},
        {"id": "3330557", "reason": "'I hate dogs.' — keep 'I love dogs' from L3 only."},
        {"id": "3825839", "reason": "'I hate cats.' — same."},
        {"id": "2569587", "reason": "'I hate my sister.' — negative family vibe."},
        {"id": "5840461", "reason": "'I hate sports.' — covered by 'I like sports'."},
        {"id": "2695891", "reason": "'I hated school.' — negative school vibe."},
        {"id": "1258674", "reason": "'He is hated.' — odd."},
        {"id": "576084", "reason": "'I hate Mondays.' — negative day framing."},
        {"id": "1136245", "reason": "'I hate Sundays.' — same."},
        {"id": "4949946", "reason": "'People need to stop hating.' — soapbox."},
        {"id": "473867", "reason": "'Bad news travels quickly.' — proverb."},
        {"id": "2553095", "reason": "'Hard work pays off.' — proverb."},
        {"id": "809690", "reason": "'Here goes nothing.' — idiom."},
        {"id": "3513531", "reason": "'Life begins at forty.' — proverb."},
        {"id": "1112468", "reason": "'I have no future.' — depressing."},
        {"id": "5379863", "reason": "'That's our future.' — abstract."},
        {"id": "3238920", "reason": "'There's safety in numbers.' — proverb."},
        {"id": "4496715", "reason": "'Safety comes first.' — proverb."},
        {"id": "2270367", "reason": "'Don't ever cross me.' — threat idiom."},
        {"id": "2245326", "reason": "'Don't ever change.' — vague."},
        {"id": "285477", "reason": "'Don't call him names.' — niche idiom."},
        {"id": "1860454", "reason": "'Don't leave town.' — niche/legal idiom."},
        {"id": "2111624", "reason": "'Leave town.' — niche idiom."},
        {"id": "1276128", "reason": "'Turn your papers in.' — niche school context."},
        {"id": "1276685", "reason": "'We're up against the wall.' — idiom."},
        {"id": "4498081", "reason": "'Do your own thing.' — idiom."},
        {"id": "2245933", "reason": "'I like blue.' — covered by 'I like colours' arc; clutter."},
        {"id": "2245968", "reason": "'I love traveling.' — sentence is fine, but covered by movement vocab."},
        {"id": "2245941", "reason": "'I like stories.' — clutter."},
        {"id": "2245934", "reason": "'I like cities.' — clutter (duplicates 'Do you like cities?')."},
        {"id": "2280271", "reason": "'Do you like cities?' — same — keep ONE."},
        {"id": "3825753", "reason": "'Do you want those chocolates?' — niche."},
        {"id": "3822756", "reason": "'They tried to rob me.' — crime narrative."},
        {"id": "2283725", "reason": "'I'm chicken.' — idiomatic slang."},
        {"id": "5331446", "reason": "'You're chicken.' — same."},
        {"id": "5819059", "reason": "'Why did I get a D?' — letter-grade reference."},
        {"id": "5819079", "reason": "'Why did I get a C?' — same."},
        {"id": "5850327", "reason": "'I made a U-turn.' — niche/driving."},
        {"id": "5807125", "reason": "'Mary iced the cake.' — odd."},
        {"id": "2243379", "reason": "'They were FBI.' — niche US."},
        {"id": "2245028", "reason": "'Call the FBI.' — same."},
        {"id": "1739440", "reason": "'I can teach you how to hunt.' — niche."},
        {"id": "246623", "reason": "'I wish I were a prince.' — fantasy."},
        {"id": "256311", "reason": "'I met the prince himself.' — niche."},
        {"id": "2543573", "reason": "'I'm going to the men's room.' — bathroom topic, niche."},
        {"id": "2360529", "reason": "Same as above."},
        {"id": "1553482", "reason": "'I cut myself.' — concerning out of context."},
        {"id": "3922228", "reason": "'I found my first gray hair this morning.' — niche personal."},
        {"id": "5164665", "reason": "'Some people don't like chickens.' — random."},
        {"id": "247823", "reason": "'We have two dogs, three cats, and six chickens.' — over-specific list."},
        {"id": "3821262", "reason": "'I'm not a mind reader.' — idiom."},
        {"id": "3821261", "reason": "'Are you a mind reader?' — same."},
        {"id": "682295", "reason": "'They're late, as usual.' — judgmental framing about 'they'."},
        {"id": "395422", "reason": "'He never listens to what his father says.' — niche family-conflict framing."},
        {"id": "46310", "reason": "'The boy talks as if he were a man.' — odd subjunctive at L4."},
        {"id": "73312", "reason": "'A boy of seventeen is often as tall as his father.' — long and awkward at L4."},
        {"id": "4806956", "reason": "'If your father asks your mother a question in French…' — long and convoluted at L4."},
        {"id": "31386", "reason": "'We have our backs to the wall.' — idiom."},
        {"id": "426943", "reason": "'That was all Greek to me.' — idiom."},
        {"id": "36930", "reason": "'Do you take travelers' checks?' — dated payment method."},
        {"id": "4589343", "reason": "'How many wives have you had?' — loaded / odd question."},
        {"id": "2954431", "reason": "'You sing like an angel.' — over-the-top idiom in 'sing' arc."},
    ],
    "arcs": [
        [
            "1841588",
            "333156",
        ],
        [
            "1188743",
            "2247880",
            "1468392",
            "2644717",
        ],
        [
            "3334000",
            "3312766",
        ],
        [
            "54454",
            "2833905",
            "1543625",
        ],
        [
            "13335",
            "5006725",
        ],
        [
            "4728682",
            "25304",
        ],
        [
            "52027",
            "3434073",
        ],
        [
            "2549674",
            "1342127",
            "1556829",
        ],
        [
            "2498776",
            "2387423",
        ],
        [
            "1529624",
            "1886596",
            "2245565",
        ],
        [
            "25700",
            "2545682",
            {"text": "Her name is Mary.", "added_for": "her|name", "reason": "natural answer"},
            "2260610",
            {"text": "She's a teacher.", "added_for": "she's|teacher", "reason": "natural answer"},
        ],
        [
            "3238930",
            "3452101",
            "5314117",
            {"text": "Slow down.", "added_for": "slow|down", "reason": "essential command (Essential.csv)"},
        ],
        [
            "2464689",
            "434738",
        ],
        [
            "2779966",
            "248392",
            "5806799",
        ],
        [
            "23779",
            "1600538",
            "1421853",
        ],
        [
            "2253782",
            "2253777",
            "556605",
            "1898424",
        ],
        [
            "267054",
            "3563955",
            "1892016",
            {"text": "It ends at three.", "added_for": "ends", "reason": "natural answer to 'what time'"},
        ],
        [
            "1871022",
            "526510",
            "4665388",
        ],
        [
            "2359573",
            "2248385",
            "2359819",
            "2359578",
        ],
        [
            "1855213",
            "2646741",
        ],
        [
            "1745699",
            "2649081",
        ],
        [
            "2111827",
            "2060031",
        ],
        [
            "261503",
            "1442079",
            "1442081",
        ],
        [
            "253003",
            "257432",
            "30080",
        ],
        [
            "619713",
            "4499972",
        ],
        [
            "2543611",
            "1494037",
            "1124639",
        ],
        [
            "2298640",
            "4650860",
            "3821318",
            "261911",
        ],
        [
            "2549750",
            "3170676",
            "2249082",
        ],
        [
            "1189719",
            "1120822",
            "1867478",
            "255034",
        ],
        [
            "1000136",
            "1608894",
            "916303",
        ],
        [
            "2011288",
            "2245978",
        ],
        [
            "1174767",
            "2221046",
        ],
        [
            "1286887",
            "1272300",
        ],
        [
            "2713754",
            "2240797",
            "4749568",
        ],
        [
            "37589",
            "1843851",
        ],
        [
            "2111762",
            "2202553",
        ],
        [
            "4134517",
            "3823144",
        ],
        [
            "2644508",
            "2647089",
            "2250083",
            "4016627",
        ],
        [
            "5436579",
            "2387451",
            "1887573",
            "2276447",
        ],
        [
            "3315096",
            "4493946",
        ],
        [
            "4967670",
            "1777512",
            "2218116",
        ],
        [
            "424408",
            "415443",
        ],
        [
            "456237",
            "1256944",
            "1435651",
        ],
        [
            "2561958",
            "2248847",
        ],
        [
            "3360595",
            "291592",
            "2255043",
        ],
        [
            "2246007",
            "2245999",
            "2241468",
        ],
        [
            "2332094",
            "2203598",
            "291622",
        ],
        [
            "1887936",
            "2243501",
            "2642802",
            "5215310",
        ],
        [
            "2218267",
            "2955018",
            "2247952",
            "3559907",
            "2547440",
            "2547975",
        ],
        [
            "2549277",
            "502824",
            "254854",
        ],
        [
            "261756",
            "1655477",
            "4397501",
            "1655484",
        ],
        [
            "1844179",
            "2203604",
            "2111702",
            "2203746",
            "2245568",
        ],
        [
            "2307995",
            "1562923",
            "2247534",
            "3825713",
        ],
        [
            "2283728",
            "2183007",
            "5828616",
            "1183774",
        ],
        [
            "520885",
            "4660502",
        ],
        [
            "2243723",
            "2241518",
            "1582121",
        ],
        [
            "533145",
            "2648873",
            "2645629",
            "2720234",
            "2245006",
        ],
        [
            "1744893",
            "2549712",
        ],
        [
            "4002434",
            "1989673",
            "5138251",
            "2424263",
        ],
        [
            "1164811",
            "294105",
            "2203807",
        ],
        [
            "320685",
            "931370",
        ],
        [
            "3734402",
            "4665743",
            "56428",
            "60644",
        ],
        [
            "2543432",
            "1290",
            "68363",
            "3217372",
        ],
        [
            "5939637",
            "5858240",
            "4979461",
            "2241419",
            "22978",
        ],
        [
            "2011283",
            "2011304",
        ],
        [
            "2802874",
            "5828632",
        ],
        [
            "2111239",
            "2248108",
        ],
        [
            "1180903",
            "39220",
            "317686",
        ],
        [
            "2241034",
            "2646012",
            "16148",
            "2643120",
            "21520",
            "1502842",
            "2245178",
        ],
        [
            "312882",
            "305348",
            "3820809",
            "5839974",
            "2218226",
            "2954431",
        ],
        [
            "2359657",
            "2359616",
            "2359474",
            "2891854",
        ],
        [
            "5850889",
            "298732",
            "4915351",
            "4915350",
            "2247946",
        ],
        [
            "2247774",
            "2548377",
            "1520900",
        ],
        [
            "5640201",
            "5640532",
            "3573387",
        ],
        [
            "5958622",
            "2380249",
        ],
        [
            "4014236",
            "4014242",
            "4012043",
        ],
        [
            "3821028",
            "958778",
            "1625030",
            "2891903",
            "2880622",
        ],
        [
            "5860696",
            "248133",
        ],
        [
            "2240400",
            "1970235",
        ],
        [
            "1127763",
            "3312718",
        ],
        [
            "2250106",
            "2111943",
        ],
        [
            "25505",
            "2259773",
        ],
        [
            "5189358",
            "1493400",
        ],
        [
            "42195",
            "259836",
        ],
        [
            "1584342",
            "1895650",
        ],
        [
            "27111",
            "2253746",
        ],
        [
            "3738228",
            "3819517",
        ],
        [
            "66212",
            "66339",
        ],
        [
            "2387545",
            "5656499",
        ],
        [
            "2646742",
            "3920379",
        ],
        [
            "2249592",
            "3151100",
        ],
        [
            "6130916",
            "4015737",
        ],
        [
            "4495344",
            "35894",
        ],
        [
            "2544226",
            "241586",
        ],
        [
            "1629911",
            "2111635",
        ],
        [
            "4501008",
            "3286816",
        ],
        [
            "312405",
            "289087",
        ],
        [
            "2254702",
            "2245625",
        ],
        [
            "2852090",
            "2246006",
        ],
        [
            "255512",
            "249379",
        ],
        [
            "4499183",
            "3824198",
        ],
        [
            "2249384",
            "17065",
        ],
        [
            "2111519",
            "2111628",
        ],
        [
            "2123617",
            "1476456",
        ],
        [
            "2387121",
            "2111349",
        ],
        [
            "2111941",
            "2247691",
        ],
        [
            "371435",
            "311372",
        ],
        [
            "3346847",
            "1841617",
        ],
        [
            "1365823",
            "2897923",
        ],
        [
            "262612",
            "291089",
        ],
        [
            "1895591",
            "2233754",
        ],
        [
            "5840014",
            "1883803",
        ],
        [
            "243382",
            "3106740",
        ],
        [
            "2713526",
            "3181521",
        ],
        [
            "2243322",
            "6347047",
        ],
        [
            "2331920",
            "1961384",
        ],
        [
            "2254869",
            "3825870",
        ],
        [
            "1401744",
            "2111469",
        ],
        [
            "3330304",
            "2891855",
        ],
        [
            "1805480",
            "2546567",
        ],
        [
            "2241607",
            "2377480",
        ],
        [
            "294025",
            "694392",
        ],
        [
            "2547139",
            "4499656",
        ],
        [
            "4908407",
            "1438061",
        ],
        [
            "42874",
            "1426633",
        ],
        [
            "2203651",
            "2203816",
        ],
        [
            "2111574",
            "2111575",
        ],
        [
            "4132555",
            "252595",
        ],
        [
            "4149520",
            "72664",
        ],
        [
            "2241178",
            "2243100",
        ],
        [
            "442962",
            "288429",
        ],
        [
            "2254894",
            "2050558",
        ],
        [
            "299157",
            "2248768",
        ],
        [
            "2245697",
            "2273956",
        ],
        [
            "2241073",
            "1665900",
        ],
        [
            "2249647",
            "2249992",
        ],
        [
            "292804",
            "2642789",
        ],
        [
            "2273756",
            "5825528",
        ],
        [
            "5916535",
            "5193445",
        ],
        [
            "1815066",
            "2247772",
        ],
        [
            "42517",
            "296931",
        ],
        [
            "2719637",
            "5701346",
        ],
        [
            "257248",
            "2249508",
        ],
        [
            "2111210",
            "299325",
        ],
        [
            "2240718",
            "2249289",
        ],
        [
            "3818764",
            "4498034",
        ],
        [
            "4502966",
            "316123",
        ],
        [
            "70503",
            "2248365",
        ],
        [
            "289086",
            "288124",
        ],
        [
            "2545273",
            "288568",
        ],
        [
            "2281543",
            "2380418",
        ],
        [
            "244532",
            "3822343",
        ],
        [
            "5078443",
            "4666942",
        ],
        [
            "24497",
            "4494718",
        ],
        [
            "5810736",
            "911230",
        ],
        [
            "4499229",
            "6040229",
        ],
        [
            "5859684",
            "1961732",
        ],
        [
            "30117",
            "293207",
        ],
        [
            "682295",
            "5350338",
        ],
        [
            "4499863",
            "293742",
        ],
        [
            "3826330",
            "2796669",
        ],
        [
            "2249058",
            "2249083",
        ],
        [
            "2543230",
            "3726636",
        ],
        [
            "2218467",
            "3357804",
        ],
        [
            "3737579",
            "2249597",
        ],
        [
            "2543300",
            "259523",
        ],
        [
            "298454",
            "251071",
        ],
        [
            "5850456",
            "5850624",
        ],
        [
            "4133462",
            "682479",
        ],
        [
            "2203724",
            "5828890",
        ],
        [
            "2248868",
            "3266050",
        ],
        [
            "2643072",
            "4915867",
        ],
        [
            "2123582",
            "1895576",
        ],
        [
            "3635975",
            "20257",
        ],
        [
            "2245081",
            "290948",
        ],
        [
            "2645564",
            "1895645",
        ],
        [
            "1258675",
            "2546241",
        ],
        [
            "5090010",
            "3560972",
        ],
        [
            "4499582",
            "2641240",
        ],
        [
            "430064",
            "806838",
        ],
        [
            "38645",
            "251920",
        ],
        [
            "5416401",
            "2645161",
        ],
        [
            "1391804",
            "3733340",
        ],
        [
            "2249991",
            "2647246",
        ],
        [
            "5858263",
            "2883495",
        ],
        [
            "2064636",
            "2111530",
        ],
        [
            "5353357",
            "2243598",
        ],
        [
            "5077907",
            "2248242",
        ],
        [
            "2241439",
            "3825790",
        ],
        [
            "2263376",
            "1434382",
        ],
        [
            "2374682",
            "239245",
        ],
        [
            "4501473",
            "5249709",
        ],
        [
            "52550",
            "300897",
        ],
        [
            "477368",
            "291802",
        ],
        [
            "1690727",
            "3826333",
        ],
        [
            "4917363",
            "1621200",
        ],
        [
            "1871974",
            "2248784",
        ],
        [
            "1553340",
            "18406",
        ],
        [
            "2546769",
            "295184",
        ],
        [
            "1337282",
            "1844215",
        ],
        [
            "4494208",
            "262887",
        ],
        [
            "4494340",
            "4267462",
        ],
        [
            "289824",
            "1188714",
        ],
        [
            "2243199",
            "2243201",
        ],
        [
            "2388149",
            "4498283",
        ],
        [
            "3821298",
            "2543906",
        ],
        [
            "305572",
            "2953818",
        ],
        [
            "34475",
            "1396380",
        ],
        [
            "4501877",
            "1836156",
        ],
        [
            "4478194",
            "4502904",
        ],
        [
            "2253709",
            "2044486",
        ],
        [
            "2547701",
            "3387158",
        ],
        [
            "1310376",
            "2545630",
        ],
        [
            "2243197",
            "5850445",
        ],
        [
            "4212807",
            "27002",
        ],
        [
            "3129802",
            "1462690",
        ],
        [
            "2044646",
            "949153",
        ],
        [
            "2387790",
            "4662915",
        ],
        [
            "278342",
            "2276874",
        ],
        [
            "2241686",
            "3185571",
        ],
        [
            "1837974",
            "448956",
        ],
        [
            "1205625",
            "2111537",
        ],
        [
            "3734430",
            "2892137",
        ],
        [
            "249437",
            "3051067",
        ],
        [
            "263247",
            "263272",
        ],
        [
            "2254875",
            "2361312",
        ],
        [
            "2882491",
            "2882495",
        ],
        [
            "288616",
            "5685817",
        ],
        [
            "2713499",
            "1951657",
        ],
        [
            "4356729",
            "3732393",
        ],
        [
            "2107664",
            "3054308",
        ],
        [
            "2243320",
            "2240724",
        ],
        [
            "2044801",
            "443855",
        ],
        [
            "3819037",
            "325741",
        ],
        [
            "4496534",
            "2259337",
        ],
        [
            "2243305",
            "2243391",
        ],
        [
            "2241459",
            "2247425",
        ],
        [
            "288794",
            "2801259",
        ],
        [
            "5792235",
            "312303",
        ],
        [
            "1362564",
            "285321",
        ],
        [
            "3200104",
            "3096109",
        ],
        [
            "66595",
            "806839",
        ],
        [
            "2954783",
            "5842400",
        ],
        [
            "2240727",
            "256114",
        ],
        [
            "387410",
            "1856044",
        ],
        [
            "1396499",
            "3636008",
        ],
        [
            "73312",
            "46310",
        ],
        [
            "625905",
            "285017",
        ],
        [
            "276288",
            "28714",
        ],
        [
            "5858124",
            "5858696",
        ],
        [
            "5828919",
            "3172395",
        ],
        [
            "23120",
            "2548282",
        ],
        [
            "2253713",
            "887435",
        ],
        [
            "305395",
            "3820348",
        ],
        [
            "1633574",
            "4011438",
        ],
        [
            "497117",
            "1318708",
        ],
        [
            "5938975",
            "5336208",
        ],
        [
            "3222939",
            "5853269",
        ],
        [
            "1561",
            {"text": "Yes, I missed you.", "added_for": "missed", "reason": "natural answer; closes a stranded yes/no question"},
        ],
        [
            "2064655",
            {"text": "Yes, I ordered the pasta.", "added_for": "pasta", "reason": "restaurant Q/A; introduces a common menu item"},
            {"text": "What do you recommend?", "added_for": "recommend", "reason": "essential restaurant question, missing at L4"},
        ],
        [
            "2273914",
            {"text": "I meant exactly that.", "added_for": "exactly", "reason": "natural answer; closes the question"},
        ],
        [
            "2647784",
            {"text": "I parked over there.", "added_for": "over", "reason": "natural location answer to 'where did you park'"},
        ],
        [
            "3129502",
            {"text": "I don't know what happened.", "added_for": "happened", "reason": "natural 'I don't know' answer; reinforces 'happened'"},
        ],
        [
            "3738657",
            {"text": "That was Italian.", "added_for": "italian", "reason": "natural answer; introduces a common language name"},
        ],
        [
            "1078276",
            {"text": "These are the best.", "added_for": "these", "reason": "natural answer pairing 'these' with 'ones'"},
        ],
        [
            "1886806",
            {"text": "I'm wearing a blue shirt.", "added_for": "shirt", "reason": "natural answer; introduces clothing item 'shirt'"},
        ],
        [
            "245318",
            {"text": "It's going well, thanks.", "added_for": "going", "reason": "natural answer to 'how's your X?' check-in question"},
        ],
        [
            "3822569",
            {"text": "You helped me a lot.", "added_for": "helped", "reason": "natural answer; explains the gratitude"},
        ],
        [
            "5852909",
            {"text": "She's my neighbor.", "added_for": "neighbor", "reason": "natural answer; introduces 'neighbor'"},
        ],
        [
            "3378685",
            {"text": "For about two years.", "added_for": "about", "reason": "natural duration answer reinforcing 'about'"},
        ],
        [
            "2853166",
            {"text": "I had three bags.", "added_for": "three", "reason": "natural count answer"},
        ],
        [
            "3730504",
            {"text": "A friend told me.", "added_for": "told", "reason": "natural answer; common 'a friend told me' phrase"},
        ],
        [
            "2641571",
            {"text": "I go to a class.", "added_for": "class", "reason": "natural answer reusing 'class' from L4"},
        ],
        [
            "2683133",
            {"text": "Her name was Anna.", "added_for": "anna", "reason": "natural answer; mirrors 'his name is Tom' pattern"},
        ],
        [
            "4014969",
            {"text": "No, I haven't.", "added_for": "haven't", "reason": "natural short answer to 'have you ever' Q"},
        ],
        [
            "2645649",
            {"text": "They wanted soup.", "added_for": "soup", "reason": "restaurant follow-up; introduces 'soup'"},
        ],
        [
            "1841697",
            {"text": "Are you sure?", "added_for": "sure", "reason": "natural follow-up doubt question; common L4 pushback"},
            {"text": "I'm sorry anyway.", "added_for": "anyway", "reason": "natural concession reply; introduces 'anyway'"},
        ],
        [
            "1897768",
            {"text": "I didn't mean it.", "added_for": "mean", "reason": "natural defense reply; plays on 'mean' as adj/verb"},
        ],
        [
            "3824951",
            {"text": "What happens now?", "added_for": "now", "reason": "natural follow-up; turns an ending into a question"},
        ],
        [
            "277695",
            {"text": "Yes, it's around the corner.", "added_for": "corner", "reason": "natural directions answer; introduces 'corner'"},
            {"text": "How much does it cost?", "added_for": "cost", "reason": "essential travel/shopping question; missing at L4"},
        ],
        [
            "2387541",
            {"text": "Do you have a smaller size?", "added_for": "size", "reason": "natural shop follow-up; introduces 'size'"},
        ],
        [
            "1829002",
            {"text": "How was the trip?", "added_for": "trip", "reason": "essential travel follow-up Q; missing at L4"},
            {"text": "It was amazing.", "added_for": "amazing", "reason": "natural enthusiastic answer; introduces 'amazing'"},
        ],
        [
            "3147934",
            {"text": "That's too expensive.", "added_for": "expensive", "reason": "natural price reaction; introduces 'expensive'"},
        ],
        [
            "1423181",
            {"text": "Let's order one.", "added_for": "let's", "reason": "natural suggestion; introduces 'let's' (L5 prep)"},
        ],
        [
            "3135784",
            {"text": "What kind do you like?", "added_for": "kind", "reason": "natural follow-up; introduces 'what kind' Q pattern"},
        ],
        [
            "2548341",
            {"text": "Thanks, that's nice of you.", "added_for": "nice", "reason": "natural gracious response; common L4 closer"},
        ],
        [
            "3733605",
            {"text": "Why? What's wrong?", "added_for": "wrong", "reason": "natural concerned follow-up; introduces 'what's wrong'"},
        ],
        [
            "2650229",
            {"text": "Thank you so much.", "added_for": "much", "reason": "natural grateful answer; reinforces 'so much'"},
        ],
        [
            "1356958",
            {"text": "I agree with you.", "added_for": "agree", "reason": "natural agreement reply; introduces 'agree' opinion verb"},
        ],
        [
            "2248387",
            {"text": "Good news, I hope.", "added_for": "hope", "reason": "natural hopeful follow-up; high-frequency reply"},
        ],
        [
            "2271758",
            {"text": "That's not polite.", "added_for": "polite", "reason": "natural mild reproach; introduces 'polite'"},
        ],
        [
            "2111474",
            {"text": "I'm glad.", "added_for": "glad", "reason": "natural happy reply; introduces 'glad'"},
        ],
        [
            "2137244",
            {"text": "How much longer?", "added_for": "longer", "reason": "natural duration follow-up; pairs with 'a little longer'"},
        ],
        [
            "2230905",
            {"text": "How long did you wait?", "added_for": "wait", "reason": "natural duration follow-up to a past-event report"},
        ],
        [
            "56634",
            {"text": "It's called a carrot.", "added_for": "carrot", "reason": "natural answer; introduces a common vegetable name"},
        ],
        [
            "2836634",
            {"text": "Which page?", "added_for": "page", "reason": "natural classroom follow-up Q"},
        ],
        [
            "2250013",
            {"text": "I'm sorry, I didn't mean to.", "added_for": "didn't", "reason": "natural apology reply; very common conversational shape"},
        ],
        [
            "2277732",
            {"text": "Are you sure about that?", "added_for": "about", "reason": "natural doubting follow-up; common reassurance check"},
        ],
        [
            "2643443",
            {"text": "Actually, I like them.", "added_for": "actually", "reason": "natural gentle correction; introduces 'actually'"},
        ],
        [
            "41665",
            {"text": "But it is.", "added_for": "but", "reason": "natural contradictory reply; introduces 'but it is' shape"},
        ],
        [
            "3735679",
            {"text": "Sorry, I didn't know.", "added_for": "know", "reason": "natural apology reply; high-frequency phrase"},
        ],
        [
            "2647845",
            {"text": "They aren't working.", "added_for": "working", "reason": "natural problem-report reply; uses 'aren't working'"},
        ],
        [
            "1898262",
            {"text": "Is something wrong?", "added_for": "something", "reason": "natural concerned follow-up; introduces 'is something wrong'"},
        ],
        [
            "3825459",
            {"text": "Let's go outside.", "added_for": "outside", "reason": "natural suggestion; introduces 'outside'"},
        ],
        [
            "2254873",
            {"text": "My boss pays me.", "added_for": "boss", "reason": "natural answer; introduces high-frequency 'boss'"},
        ],
        [
            "2218208",
            {"text": "Really? How old are you?", "added_for": "really", "reason": "natural surprised follow-up; reinforces 'really'"},
        ],
    ],
}
