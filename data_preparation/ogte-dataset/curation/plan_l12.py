"""Curation plan for OGTE Level 12 — Mid Upper Intermediate (~1415 sentences).

L12 sits at the mid-upper-intermediate band. The learner already has command
of past/present/future, modals, conditionals (basic), comparatives, common
phrasal verbs, and around 6000 most-frequent lemmas. L12 pushes into:

  - more abstract reasoning ("complex issue", "regardless of the consequences",
    "to a certain extent", "relatively / fairly / eventually / precisely")
  - workplace and academic register (budget, employees, promotion, conference,
    assistant, application, qualifications, recommendation, regulations)
  - opinion-with-hedge patterns ("I assume", "I suppose", "I presume",
    "I'm assuming", "I think it's unlikely that …")
  - longer noun phrases and embedded clauses
  - more idioms / fixed phrases that intermediate learners genuinely need
    (beat around the bush, blow off some steam, cope with stress,
    creature of habit, pace yourself, sight for sore eyes, etc.)

Curation philosophy (revised):
  Loosened removal stance — drama, idioms, long sentences, body parts,
  some crime/violence, specific years, and proper names are FINE at L12.
  We only prune: dated tech brands (iPhone/Facebook/YouTube/blog-era VCRs),
  overtly sexist generalizations, extremely niche cultural references,
  exact duplicates, drill patterns (same content word in 4+ rows), and
  gore-heavy or war-glorifying material.

  Arcs are diversified to avoid same-content-word drills (>3 in a row).
  Three highest-quality opening arcs are pinned at "position": "first".
"""

from __future__ import annotations


L12_PLAN = {
    "removals": [
        # ============================================================
        # Dated tech brands & blog-era niche tech (still drop)
        # ============================================================
        {"id": "953392", "reason": "'… transfer MP3 files to my iPod.' — dated brand."},
        {"id": "953391", "reason": "'… transfer MP3 files from my iPod …' — same dated brand."},
        {"id": "5823045", "reason": "'How much fuel does a Boeing 747 carry …' — brand + dated."},
        {"id": "252954", "reason": "'I got a video cassette recorder cheap …' — dated tech."},
        {"id": "5040698", "reason": "'Do they still make cassette tapes?' — dated."},
        {"id": "953388", "reason": "'I can't figure out how to post a comment to this blog.' — dated tech meta."},
        {"id": "953728", "reason": "'I wish I could figure out how to disable comments on my blog.' — niche blog meta."},
        {"id": "4498328", "reason": "'I try to write at least three blog entries a week.' — niche blog meta."},
        {"id": "953545", "reason": "'I never for a moment imagined that my blog would become so popular.' — niche blog meta."},

        # ============================================================
        # Native-speaker / language-learning meta soapbox
        # ============================================================
        {"id": "953275", "reason": "'Getting your message across is much more important …' — long soapbox meta."},
        {"id": "953635", "reason": "'I think it's a shame that some foreign language teachers …' — long soapbox."},
        {"id": "3314746", "reason": "'I can't imagine a native speaker ever saying it that way.' — language meta."},
        {"id": "953632", "reason": "'I think if I talked more often with a native speaker …' — long meta."},

        # ============================================================
        # Overtly sexist / paternalistic / xenophobic-coded
        # ============================================================
        {"id": "1030073", "reason": "'Mary is really great. She cooked … and even washed the dishes herself.' — paternalistic praise."},
        {"id": "6002891", "reason": "'Everyone treated Mary like a princess.' — gendered."},
        {"id": "886892", "reason": "'She advised him to go abroad while he was still young.' — dated/gendered tone."},
        {"id": "887533", "reason": "'She was advised by him to go abroad …' — same."},
        {"id": "2210612", "reason": "'Why don't you do us all a favor and go back to wherever you came from?' — xenophobic-coded."},
        {"id": "942841", "reason": "'If you behave like a servant, you'll be treated like a servant.' — preachy/dated."},
        {"id": "2951819", "reason": "'Don't trust anyone over twenty.' — slogan from a dated political moment."},

        # ============================================================
        # Exact / near duplicates within L12
        # ============================================================
        {"id": "5179266", "reason": "Duplicate of 'Stop beating around the bush.'"},
        {"id": "4998339", "reason": "Duplicate of 'I never have trouble falling asleep.'"},
        {"id": "933008", "reason": "'Everyone dies eventually.' — duplicate of 'Everybody dies eventually.'"},
        {"id": "2538928", "reason": "'I'm having trouble believing it myself.' — duplicate of 'I'm having trouble believing it.'"},
        {"id": "3161910", "reason": "'I have trouble concentrating.' — duplicate of 'I'm having trouble concentrating.'"},
        {"id": "1849124", "reason": "'She speaks relatively quickly.' — duplicate of 'She speaks relatively fast.'"},
        {"id": "395669", "reason": "'I borrowed this comic from his sister.' — duplicate of comics-plural variant."},
        {"id": "277309", "reason": "'The pond froze over.' — duplicate of 'The pond has frozen over.'"},
        {"id": "466914", "reason": "'He threw a rock into the pond.' — duplicate of 'He threw a stone into the pond.'"},
        {"id": "317533", "reason": "'She grew roses.' — duplicate of 'I grew roses.'"},
        {"id": "3822138", "reason": "'Why are you biting your nails?' — duplicate of 'Stop biting your nails.'"},
        {"id": "5045681", "reason": "'I'm thinking of changing majors.' — duplicate of switching-majors variant."},
        {"id": "5364091", "reason": "'History may be repeating itself.' — duplicate family with 'History repeats itself.'"},
        {"id": "4501736", "reason": "'History is repeating itself.' — duplicate family."},
        {"id": "4497629", "reason": "'Does history really repeat itself?' — duplicate family."},
        {"id": "6033388", "reason": "'I have a loose tooth.' — duplicate of 'This tooth is loose.'"},
        {"id": "6123088", "reason": "'I'm sure the police will catch the robber eventually.' — duplicate (word order only)."},
        {"id": "2599467", "reason": "'Precise measurements are required.' — duplicate of '… are necessary.'"},

        # ============================================================
        # Drill arcs in the source: 'fairly' + 'relatively' (kept ~3 each)
        # ============================================================
        {"id": "5219332", "reason": "'My job pays fairly well.' — drill: too many 'fairly well' sentences."},
        {"id": "5189194", "reason": "'I used to play the guitar fairly well.' — drill."},
        {"id": "5916221", "reason": "'I play tennis fairly well.' — drill."},
        {"id": "1887478", "reason": "'I know a guy who plays the guitar fairly well.' — drill."},
        {"id": "5910009", "reason": "'I think I'm a fairly good drummer.' — drill."},
        {"id": "4999974", "reason": "'It's fairly unique.' — semantically odd ('unique' isn't gradable)."},
        {"id": "4888237", "reason": "'It's relatively early.' — drill with 'It's relatively …' x4."},
        {"id": "4494371", "reason": "'It was relatively quiet.' — drill."},

        # ============================================================
        # Drill arcs in source: 'I seldom eat …' x4 in a row
        # ============================================================
        {"id": "5850837", "reason": "'I seldom eat breakfast.' — drill ('I seldom eat …' x4)."},
        {"id": "5850084", "reason": "'I seldom eat Mexican food.' — drill."},
        {"id": "5272437", "reason": "'I seldom eat eggs anymore.' — drill."},

        # ============================================================
        # Drill arcs in source: 'My hobby is …' x6
        # ============================================================
        {"id": "251142", "reason": "'My hobby is collecting old bottles.' — drill ('My hobby is …' x6)."},
        {"id": "497116", "reason": "'My hobby is collecting old toys.' — drill."},
        {"id": "251135", "reason": "'My hobby is collecting foreign stamps.' — drill (and dupes 'collecting stamps')."},
        {"id": "250133", "reason": "'My hobby is skiing.' — drill."},

        # ============================================================
        # Drill arcs in source: assumption / assure overflow
        # ============================================================
        {"id": "2293450", "reason": "'I assure you I've considered that possibility.' — 'I assure you …' drill."},
        {"id": "2293456", "reason": "'I assure you they're exactly the same.' — drill."},
        {"id": "2293457", "reason": "'I assure you this isn't a joke.' — drill."},
        {"id": "2293458", "reason": "'I assure you this is only temporary.' — drill."},

        # ============================================================
        # Drill: 'Don't trust …' / 'Never trust …' preachy chain
        # ============================================================
        {"id": "3528516", "reason": "'Never trust your enemy.' — preachy 'Never trust …' drill."},
        {"id": "270162", "reason": "'Never trust a stranger.' — drill + preachy."},
        {"id": "4502690", "reason": "'Never trust a politician.' — drill + preachy."},
        {"id": "2277344", "reason": "'Don't trust strangers.' — drill."},
        {"id": "2194375", "reason": "'We don't trust strangers.' — drill."},

        # ============================================================
        # Drill: 'No one's blaming you' / 'I wouldn't blame you …' chain
        # ============================================================
        {"id": "2057775", "reason": "'No one's blaming you.' — 'blame' drill."},
        {"id": "2057807", "reason": "'Nobody's going to blame you.' — drill."},
        {"id": "3519317", "reason": "'Nobody's blaming you.' — drill."},
        {"id": "2057863", "reason": "'I wouldn't blame you if you preferred to leave.' — drill."},
        {"id": "2057865", "reason": "'No one can blame you for being a little scared.' — drill."},
        {"id": "2057866", "reason": "'No one can blame you for being a little nervous.' — drill."},

        # ============================================================
        # 'I'm having trouble …' minor drill trimming (still keep core)
        # ============================================================
        {"id": "3009195", "reason": "'I'm having trouble getting to sleep.' — duplicate-ish with 'I have trouble sleeping.'"},
        {"id": "2359118", "reason": "'I've been having trouble waking up.' — sleep-trouble drill."},
        {"id": "4959420", "reason": "'I'm having trouble deciding where to park.' — niche/odd."},

        # ============================================================
        # Pond / sand / roses minor drill trimming
        # ============================================================
        {"id": "45111", "reason": "'The pond is 3 meters deep.' — pond drill, low value."},
        {"id": "3821443", "reason": "'There aren't any fish in this pond.' — pond drill."},
        {"id": "5831969", "reason": "'I could see my reflection in the pond.' — pond drill."},
        {"id": "292424", "reason": "'He painted a picture of roses.' — niche; rose drill."},
        {"id": "259568", "reason": "'I planted roses in the garden.' — rose drill."},
        {"id": "259016", "reason": "'I like white roses better than red ones.' — rose drill."},
        {"id": "2547329", "reason": "'I would've sent roses.' — niche."},

        # ============================================================
        # Niche drills already in source: action figures / VCR-era / cows
        # ============================================================
        {"id": "5760904", "reason": "'My cousin has a large collection of action figures.' — niche pop-culture."},
        {"id": "1247009", "reason": "'I have fifteen hundred cows.' — over-specific, odd."},
        {"id": "295256", "reason": "'He has ten cows.' — over-specific."},

        # ============================================================
        # Niche / odd narratives (kept a few, dropping the strangest)
        # ============================================================
        {"id": "898570", "reason": "'She sold all of her furniture, so she could afford to feed herself …' — strange."},
        {"id": "898552", "reason": "'I had trouble deciding which brand of dog food to feed my dog.' — long + niche."},
        {"id": "752148", "reason": "'I don't eat apple cores.' — strange detail."},
        {"id": "4341696", "reason": "'Yesterday, I put honey in my tea.' — strange detail."},
        {"id": "59182", "reason": "'We found out recently that some foxes live here …' — odd narrative."},
        {"id": "2049679", "reason": "'Nail the windows shut.' — niche/odd."},
        {"id": "278464", "reason": "'Grab the bottom.' — odd phrasing without context."},
        {"id": "5833178", "reason": "'My mother often sings when she's washing dishes.' — odd."},
        {"id": "2541929", "reason": "'I'm a fairly well-educated guy.' — odd boasting register."},
        {"id": "2406291", "reason": "'I sense that I can trust you.' — odd register."},
        {"id": "5259955", "reason": "'I trust absolutely no one.' — extreme/cynical out of context."},
        {"id": "2240991", "reason": "'We're gentlemen.' — odd standalone."},
        {"id": "1442272", "reason": "'My office is located on the fifth floor.' — niche."},
        {"id": "5369338", "reason": "'Our studio is still located on Park Street.' — niche proper noun."},
        {"id": "5736671", "reason": "'It's located on Park Street.' — niche proper noun."},

        # ============================================================
        # Proverbs / aphorisms that don't carry conversationally at L12
        # ============================================================
        {"id": "423079", "reason": "'A bird in the hand is worth two in the bush.' — proverb."},
        {"id": "239386", "reason": "'Great minds think alike.' — proverb (kept other variants elsewhere)."},
        {"id": "320462", "reason": "'Speech is silver, silence is golden.' — proverb."},
        {"id": "667946", "reason": "'We are all alike, on the inside.' — aphoristic."},
        {"id": "599660", "reason": "'A home is more than a mere building.' — poetic."},
        {"id": "4679874", "reason": "'Wake up and smell the roses.' — culture-specific idiom (kept others)."},
        {"id": "278733", "reason": "'Philosophy is not a thing one can learn in six months.' — aphorism."},

        # ============================================================
        # Heavy / disturbing & gore-tinged content (loosened: kept most police/theft)
        # ============================================================
        {"id": "886998", "reason": "'She beat him to death with a golf club.' — gore-heavy."},
        {"id": "313244", "reason": "'She screamed with terror.' — melodramatic horror tone."},
        {"id": "4494117", "reason": "'Terrorists were everywhere.' — fear-mongering framing."},
        {"id": "4498476", "reason": "'The terrorists have failed.' — propaganda framing."},
        {"id": "5851579", "reason": "'I'm not a terrorist.' — strange isolated utterance."},
        {"id": "3820327", "reason": "'I hate terrorism.' — heavy/political slogan."},
        {"id": "2248887", "reason": "'It was terrorism.' — same."},
        {"id": "4495459", "reason": "'They were accused of supplying arms to terrorists.' — heavy political."},
        {"id": "5366230", "reason": "'My gun jammed.' — combat tone."},

        # ============================================================
        # Niche US-cultural overflow (kept most proper names; trim only piles)
        # ============================================================
        {"id": "3024339", "reason": "'I graduated from Harvard.' — second Harvard sentence; trim drill."},
        {"id": "5640512", "reason": "'I hear you're good at golf.' — 8 golf sentences in source; trimming drill."},
        {"id": "2539883", "reason": "'I thought you said you enjoyed golf.' — golf drill."},
        {"id": "5822506", "reason": "'How's your golf game?' — golf drill."},
        {"id": "242530", "reason": "'How about playing golf this afternoon?' — golf drill."},
        {"id": "2050696", "reason": "'I could be playing golf right now …' — golf drill."},
        {"id": "5936716", "reason": "'I'm unlikely to go to Boston next weekend.' — third Boston sentence."},
        {"id": "6267623", "reason": "'I'm eager to visit Boston.' — Boston drill."},
        {"id": "57708", "reason": "'This train is bound for Boston.' — Boston drill."},
        {"id": "58093", "reason": "'This ship is bound for Vancouver.' — paired with Boston drill."},
        {"id": "3150787", "reason": "'I bought this at a garage sale.' — niche US-cultural."},
        {"id": "247797", "reason": "'We graduate from high school at eighteen.' — niche US-cultural."},

        # ============================================================
        # Niche / very specific trivia
        # ============================================================
        {"id": "52443", "reason": "'Switzerland is situated between …' — geography lesson."},
        {"id": "53187", "reason": "'When were potatoes introduced into Japan?' — trivia question."},
        {"id": "4806318", "reason": "'Australia is the world's fifth-largest coal producer.' — trivia."},

        # ============================================================
        # Misc duplicates / very weak rows
        # ============================================================
        {"id": "4529378", "reason": "'Everyone agreed to a certain extent.' — duplicate of 'I agree to a certain extent.'"},
        {"id": "2007288", "reason": "'Let's go grab a burger or something.' — duplicate of 'Let's go grab a burger.'"},
        {"id": "276720", "reason": "'I must have it shortened.' — niche tailoring fragment."},
        {"id": "5292077", "reason": "'Potatoes are vegetables.' — trivial."},
        {"id": "684708", "reason": "'Cows eat grass.' — trivial."},
        {"id": "4321186", "reason": "'The problem will eventually solve itself.' — abstract claim."},
    ],

    "arcs": [
        # ============================================================
        # FIRST POSITION ARC #1 — high-leverage hedged opinion frames
        # ============================================================
        {
            "position": "first",
            "items": [
                {"text": "What do you think?", "added_for": "think", "reason": "essential opinion-prompt at L12"},
                {"text": "Honestly, I'm not sure.", "added_for": "honestly|sure", "reason": "natural hedged reply"},
                {"text": "It depends.", "added_for": "depends", "reason": "high-frequency hedge"},
                {"text": "To a certain extent, yes.", "added_for": "extent", "reason": "L12 hedging phrase"},
                "2291596",   # I agree to a certain extent.
                "3008800",   # That's a safe assumption.
                "3594117",   # That's a fair assumption.
            ],
        },

        # ============================================================
        # FIRST POSITION ARC #2 — workplace / professional register opener
        # ============================================================
        {
            "position": "first",
            "items": [
                "410787",    # What's your occupation?
                {"text": "I work in marketing.", "added_for": "work|marketing", "reason": "natural answer, vocab variety"},
                "5858203",   # I'm a consultant.
                {"text": "How long have you been doing that?", "added_for": "long|doing", "reason": "natural follow-up"},
                {"text": "About five years now.", "added_for": "five|now", "reason": "natural answer"},
                "2852040",   # What are your qualifications?
            ],
        },

        # ============================================================
        # FIRST POSITION ARC #3 — climate / contemporary discussion opener
        # ============================================================
        {
            "position": "first",
            "items": [
                "3825787",   # Our climate is changing.
                "4496395",   # Is climate change really happening?
                {"text": "All the evidence suggests it is.", "added_for": "evidence|suggests", "reason": "academic hedge"},
                "5822267",   # How do you think climate change will affect our lives in the future?
                "4496386",   # Global climate change is everybody's problem.
            ],
        },

        # ============================================================
        # Trust — opinion + earned trust (broken into smaller arcs)
        # ============================================================
        [
            "15844",     # You can trust him to keep his word.
            "992007",    # I really trust his ability.
        ],
        [
            "2544219",   # I'm asking you to trust me.
            {"text": "Why should I?", "added_for": "why|should", "reason": "natural pushback question"},
            "3728820",   # I had to earn your trust.
            "1898055",   # Trust is earned.
        ],
        [
            "3905131",   # I figured I could trust you.
            "1933612",   # I appreciate the trust you've shown in me.
        ],
        [
            "3396449",   # Do you trust my judgment?
            {"text": "I do, most of the time.", "added_for": "most|time", "reason": "hedged answer"},
            "260959",    # I have absolute trust in him.
        ],

        # ============================================================
        # History — broken; no longer 6-in-a-row drill
        # ============================================================
        [
            "4494211",   # Why is history important?
            "3348726",   # We can't change history, but we can learn from it.
            {"text": "Every period has something to teach us.", "added_for": "period|teach", "reason": "vocab variety, breaks 'history' drill"},
            "37520",     # Every country has its own history.
        ],
        [
            "262259",    # I'm interested in history.
            "262258",    # I have little interest in history.
            "790045",    # I study art history.
        ],
        [
            "6041",      # How come you know so much about Japanese history?
            {"text": "It's been a hobby of mine for years.", "added_for": "hobby|mine", "reason": "natural answer"},
        ],
        [
            "680196",    # Do you like ancient history?
            {"text": "Yes, especially the Romans.", "added_for": "especially|romans", "reason": "natural answer"},
            "29419",     # The history of Rome is very interesting.
        ],
        [
            "56493",     # This history book is written for high school students.
            "64961",     # I want to teach history when I grow up.
        ],
        [
            "5642608",   # Can I borrow your history notes?
            {"text": "Sure — bring them back tomorrow.", "added_for": "sure|tomorrow", "reason": "natural answer"},
            "2334162",   # I hated history class.
        ],
        [
            "326126",    # History repeats itself.
            {"text": "That's why we study it.", "added_for": "why|study", "reason": "natural reply"},
        ],

        # ============================================================
        # Insurance / practical
        # ============================================================
        [
            "3258111",   # Do you have fire insurance?
            "4846667",   # What does your insurance cover?
            "320470",    # How much is it including insurance and tax?
            "1860383",   # Don't worry. I have insurance.
        ],

        # ============================================================
        # Workplace / employees
        # ============================================================
        [
            "49056",     # The company provides health care and life insurance benefits for all of its employees.
            "4902783",   # Our company has thirty employees.
            "2048410",   # They're part-time employees.
            {"text": "We're hiring a few more next month.", "added_for": "hiring|more", "reason": "natural follow-up, breaks 'employees' drill"},
            "5591231",   # We have a great group of employees.
            "5619599",   # We haven't laid off any employees yet.
            "4902781",   # They treat their employees well.
        ],

        # ============================================================
        # Commercial / advertising
        # ============================================================
        [
            "1624887",   # Did you see the new commercial?
            "252926",    # I love that commercial.
        ],

        # ============================================================
        # Conferences
        # ============================================================
        [
            "4495998",   # The conference begins on Monday.
            "478193",    # The conference ended at five.
            "5358578",   # The conference ends tomorrow.
            "22428",     # There was a convention last month.
            "887110",    # She first met him at a conference in Boston.
        ],

        # ============================================================
        # Software version / install
        # ============================================================
        [
            "1853636",   # Do you have the latest version?
            "1272070",   # I prefer this version.
            "4500303",   # Was the new version easy to install?
            {"text": "It installed without any issues.", "added_for": "installed|issues", "reason": "natural answer"},
        ],

        # ============================================================
        # Awards / prizes (broken: was a 5-in-a-row 'prize' drill)
        # ============================================================
        [
            "1276326",   # I won an award as well.
            "2360818",   # I heard you received an award last month.
            "17534",     # You deserve the prize.
            {"text": "Don't say that — you'll jinx it.", "added_for": "say|jinx", "reason": "vocab variety, breaks award/prize drill"},
            "1396339",   # I'm surprised that you won the prize.
        ],
        [
            "291033",    # He deserves the prize.
            "21535",     # The school awarded Mary a prize.
            "4495860",   # Prizes will be awarded.
            "35775",     # It's my dream to win a Nobel Prize.
        ],
        [
            "296986",    # He won the third prize.
            "73468",     # Ten teams competed for the prize.
            "252480",    # I competed with him for the first prize.
            "308355",    # She stands a good chance of winning the prize.
        ],

        # ============================================================
        # Eventually (broken: was 5 'eventually' in a row)
        # ============================================================
        [
            "4496416",   # Things eventually changed.
            "24607",     # Everything eventually gets easier with practice.
            "2540181",   # I'd have figured it out eventually.
            {"text": "We just have to be patient.", "added_for": "patient", "reason": "breaks 'eventually' drill with paraphrase"},
            "4016042",   # Everybody dies eventually.
        ],
        [
            "2376643",   # I know you'll find happiness eventually.
            {"text": "I hope you're right.", "added_for": "hope|right", "reason": "natural reply"},
            "4380768",   # I tried to keep up with them, but eventually I fell behind.
            "954483",    # We'll eventually find a solution to this problem, I think.
        ],
        [
            "6123073",   # I'm sure the police will eventually catch the robber.
            {"text": "I wouldn't be so sure.", "added_for": "wouldn't|sure", "reason": "skeptical reply"},
        ],
        [
            "5189173",   # You'll eventually get used to the heat.
            "5189126",   # I suppose I'll get used to this eventually.
            "2375816",   # I knew you'd show up eventually.
        ],

        # ============================================================
        # Theory / opinion (broken: was 6 'theory' in a row)
        # ============================================================
        [
            "16189",     # What do you base your theory on?
            "17278",     # I think your basic theory is wrong.
            "253680",    # I can't accept this theory.
            {"text": "But it explains the data.", "added_for": "explains|data", "reason": "breaks theory drill with pushback"},
            "3150409",   # Are you buying that theory?
        ],
        [
            "2404161",   # I revised my theory.
            "1293182",   # He stuck with his own theory.
            "4494103",   # There are several theories.
            "2358715",   # I have a few theories.
        ],
        [
            "3264719",   # That's hardly a new concept.
            "4495593",   # The concept is amazing.
            "2293249",   # I assume you're familiar with this concept.
            {"text": "I've heard of it, yes.", "added_for": "heard|of", "reason": "natural answer"},
        ],

        # ============================================================
        # Critical / complex
        # ============================================================
        [
            "2549262",   # This is critical.
            "295036",    # He was in critical condition.
            "3823487",   # It's a complex issue.
            "5288611",   # Human relationships are complex.
            "5288084",   # Human relationships are very complex.
            "5541469",   # One of the most urgent challenges of our time …
        ],

        # ============================================================
        # Medical (light)
        # ============================================================
        [
            "5191964",   # I've had three operations.
            "953343",    # How many operations has Dr. Jackson performed this month?
        ],

        # ============================================================
        # Wedding / reception
        # ============================================================
        [
            "4135112",   # We had a traditional church wedding.
            {"text": "Where was the reception?", "added_for": "where|reception", "reason": "natural follow-up"},
            "2547411",   # How was the reception?
            "322896",    # Everybody who is anybody was present at the reception.
        ],

        # ============================================================
        # Budget / finance
        # ============================================================
        [
            "4665746",   # That budget isn't yet final.
            "276676",    # No one will vote for the budget.
            "4496190",   # My budget is tight.
            "3826001",   # We're on a tight budget.
            "324694",    # The budget must be balanced.
            "4496189",   # Budget cuts are needed.
        ],
        [
            "2548711",   # I'm in real estate.
            "4502368",   # We have 13 retail stores.
            "4850092",   # I'm a bank employee.
            "256984",    # I'm a bank clerk.
            "312360",    # She was formerly a bank clerk.
        ],
        [
            "33715",     # I received my bonus.
            "3315263",   # Everybody is expecting a big bonus.
            "3763331",   # I deserve a promotion.
            "2313729",   # I deserved that promotion.
            "1887651",   # I see they've given you a promotion.
            "2007310",   # Let's go celebrate your promotion.
        ],
        [
            "1210696",   # The government should invest more money in agriculture.
            "4905006",   # I'm not a financial expert.
            "4529569",   # I need a good financial adviser.
            "2247990",   # I'm financially secure.
            "295716",    # He became financially independent.
            "1221641",   # We helped him financially.
        ],
        [
            "3311105",   # We're counting on you for financial help.
            "4499933",   # I have storage space.
            "5434211",   # This is the storage room.
        ],

        # ============================================================
        # Greatest / superlatives
        # ============================================================
        [
            "1886673",   # What's your greatest fear?
            {"text": "Failing those who depend on me.", "added_for": "failing|depend", "reason": "natural reflective answer"},
            "1553320",   # What is your greatest strength?
            "1553319",   # What is your greatest weakness?
            "296075",    # He is the greatest living artist.
            "4499847",   # My mom's the greatest.
        ],

        # ============================================================
        # Trouble — kept core but broken into smaller arcs to avoid drill
        # ============================================================
        [
            "2243258",   # They mean trouble.
            "4496001",   # Trouble began immediately.
            "2644166",   # You're in serious trouble.
            "54876",     # Try to avoid making any more trouble.
        ],
        [
            "3610556",   # Thank you for helping me keep out of trouble.
            "4012269",   # Have you been staying out of trouble?
            {"text": "Most of the time, yes.", "added_for": "most|yes", "reason": "natural reply, breaks 'trouble' drill"},
        ],
        [
            "2247415",   # I smell trouble.
            "3732922",   # This smells like trouble.
            "3732923",   # That smells like trouble.
            "2925231",   # You're the one causing all the trouble.
            "2821201",   # We need to be prepared for trouble.
        ],
        [
            "4251097",   # I'm not trying to stir up trouble. I'm just telling you what I heard.
            "2248980",   # It'll cause trouble.
            "2252630",   # There'll be trouble.
            "3722519",   # I'm in desperate trouble.
            "17402",     # You'll get into trouble if your girlfriend finds out the truth.
        ],
        [
            "3819084",   # Someone's in trouble.
            "4502687",   # Everyone's in trouble.
            "5852579",   # Somebody's in trouble.
        ],
        [
            "3374115",   # That troubles me.
            "3722796",   # That's what troubles me.
            "1520377",   # That's troubling.
            "3636495",   # What's troubling you?
            "5840543",   # I'm troubled.
            "2255128",   # You look troubled.
        ],
        [
            "2663241",   # I have trouble remembering names.
            {"text": "Me too — faces stick better for me.", "added_for": "faces|stick", "reason": "vocab variety, breaks near-dup with 'He has trouble remembering names'"},
        ],
        [
            "898557",    # Some people have trouble getting their dogs to eat dog food.
            "2004798",   # He has no trouble climbing trees.
            "4495991",   # Beginners always have trouble doing this.
        ],
        [
            "2541363",   # I'm having trouble believing it.
            {"text": "I know — it sounds unlikely.", "added_for": "sounds|unlikely", "reason": "empathetic reply"},
        ],
        [
            "2360660",   # I have trouble sleeping.
            "5042076",   # I have trouble talking about my feelings.
            "2540934",   # I'm having trouble concentrating.
            "4400802",   # I never have trouble falling asleep.
        ],

        # ============================================================
        # Emergency / urgent
        # ============================================================
        [
            "4016656",   # What's the emergency code?
            "2331574",   # I had a family emergency.
            "3114021",   # What's the nature of your emergency?
            "18803",     # In case of an emergency, get in touch with my agent.
            "1890971",   # I'm declaring an emergency.
            "450773",    # Where is the emergency exit?
            "5136924",   # Please be prepared for emergencies.
        ],
        [
            "903714",    # There is an urgent need for understanding how climate change will affect our lives.
            "903694",    # There is an urgent need for experienced pilots.
        ],

        # ============================================================
        # Weather
        # ============================================================
        [
            "2251069",   # That's fantastic news.
            "4494168",   # The weather was fantastic.
            "3310950",   # We're having a mild winter.
            "57666",     # This winter has been mild.
        ],
        [
            "253545",    # I like the atmosphere of this restaurant.
            "5826269",   # This restaurant has a romantic atmosphere.
        ],

        # ============================================================
        # Borders / geography
        # ============================================================
        [
            "1399667",   # The border is closed.
            "2641790",   # We're three hours from the border.
            "5529402",   # We have to protect our border.
            "4016909",   # How long will it be before we cross the border?
            "1471363",   # They crossed the border.
            "3826164",   # They've crossed the border.
            "3820608",   # Canada borders the United States.
            "2821330",   # We're nowhere near the border.
        ],

        # ============================================================
        # Native language
        # ============================================================
        [
            "51806",     # Spanish is her native language.
            "296165",    # He returned to his native village.
            "2113398",   # He was raised in the United States, but his native language is Japanese.
            "6125998",   # I'm assuming French isn't your native language.
            {"text": "It isn't — I'm originally from Brazil.", "added_for": "originally|brazil", "reason": "natural answer"},
            "6106025",   # I understand French fairly well when I read it, but I have trouble understanding spoken French.
        ],

        # ============================================================
        # Legality
        # ============================================================
        [
            "3825048",   # I never use illegal drugs.
            "5071285",   # Of course, this is illegal.
            "4900672",   # You weren't doing anything illegal.
            "3735786",   # I don't engage in illegal activities.
        ],

        # ============================================================
        # Visions / dreams / nightmares
        # ============================================================
        [
            "1887332",   # I had a vision.
            "3725649",   # I just had a vision.
            "28526",     # I had a nightmare.
            "6098516",   # My worst nightmare is coming true.
            "4500094",   # I have nightmares.
            "1449175",   # Do you have nightmares?
            {"text": "Sometimes, yes.", "added_for": "sometimes", "reason": "natural answer"},
        ],
        [
            "3826978",   # I've always dreamed of living abroad.
            "483667",    # I never dreamed that I would win first prize.
        ],

        # ============================================================
        # Stream / sitting
        # ============================================================
        [
            "530769",    # He sat next to the stream.
            "300675",    # He sat at the edge of the stream.
        ],

        # ============================================================
        # Reasonable / acceptable
        # ============================================================
        [
            "4495439",   # Either is acceptable.
            "3142433",   # Are these conditions acceptable to you?
            "4127579",   # A book is always an acceptable gift.
            "3324713",   # That's a fairly reasonable price.
            "4846737",   # It should be fairly obvious.
        ],

        # ============================================================
        # Personality / character (split: was a 'You're + adjective' drill)
        # ============================================================
        [
            "2305020",   # I like your personality.
            "2805875",   # He has a split personality.
            "4493576",   # People have different personalities.
        ],

        # ============================================================
        # Driving / vehicles
        # ============================================================
        [
            "2953230",   # My car needs a brake job.
            "4663760",   # One of your brake lights is burned out.
            "1860708",   # Hit the brakes.
            "2523399",   # The brakes didn't work.
            "4496165",   # My fuel line broke.
            "4915855",   # This car gets good gas mileage.
            "3017152",   # My car gets pretty good gas mileage.
            "2646022",   # My car's in the garage.
        ],

        # ============================================================
        # Restrictions
        # ============================================================
        [
            "4495680",   # Certain restrictions may apply.
            "4495681",   # Some restrictions may apply.
        ],

        # ============================================================
        # Apologies / formal (broken: was 5 'apologize' in a row)
        # ============================================================
        [
            "2247431",   # I truly apologize.
            "4495507",   # I apologize in advance.
            "2247413",   # I sincerely apologize.
            {"text": "There's no need.", "added_for": "no|need", "reason": "natural reply, breaks 'apologize' drill"},
            "1368433",   # We apologize for the delay.
        ],
        [
            "2291872",   # I apologize for the mess.
            "4398490",   # We apologize for the error.
            "273576",    # I apologize for not writing to you before.
            "2545863",   # Pardon the interruption.
            "870625",    # Sorry for the interruption.
        ],
        [
            "4530099",   # I wanted to apologize.
            "2540852",   # I'm waiting for you to apologize.
            "4529686",   # That's no reason to apologize.
            "1841621",   # I'm willing to apologize.
        ],
        [
            "2042752",   # I want to apologize for all the things I said earlier today.
            "2291870",   # I apologize for my choice of words.
        ],

        # ============================================================
        # Interpreter / translation
        # ============================================================
        [
            "1389751",   # I need an interpreter.
            "49159",     # I acted as interpreter at the meeting.
        ],

        # ============================================================
        # Recommendations / favors
        # ============================================================
        [
            "2387838",   # I need your recommendations.
            "2642827",   # What are your recommendations?
            "2234182",   # What's your recommendation?
            "4499680",   # That was my recommendation.
        ],
        [
            "3575468",   # Hey, I need a favor.
            "3568475",   # Can you do me a tiny favor?
            "4015958",   # Can I ask a small personal favor?
            "272500",    # May I ask a very special favor of you?
            "40090",     # I was wondering if you could do me a favor.
            "51470",     # Excuse me, could you spare me a few minutes? I have a favor to ask you.
            {"text": "Of course — what is it?", "added_for": "of|course|what", "reason": "natural reply to 'I need a favor'"},
        ],
        [
            "2389600",   # I owe you a favor.
            "3331080",   # You owe me a favor.
            "2389541",   # I only wish I could return the favor.
            "3822679",   # Anytime you need a favor, call me.
            "2275197",   # Don't do me any favors.
            "2275200",   # Don't do us any favors.
        ],

        # ============================================================
        # Input / help
        # ============================================================
        [
            "2011514",   # I'd like your input.
            "4500295",   # Your input is welcome.
            "23467",     # Our staff is eager to help you.
        ],

        # ============================================================
        # Approval / criticism (kept; broken from drilly tail)
        # ============================================================
        [
            "5679763",   # Children seek approval from their parents.
            "3417734",   # I won't hire anyone without your approval.
        ],
        [
            "2258744",   # I don't approve of his conduct.
            "5136936",   # Everybody is afraid of criticism.
            "317435",    # She accepts criticism from anyone but her parents.
            "317780",    # Don't be too sensitive to criticism.
            "4846784",   # Some people criticized our decision.
        ],
        [
            "1361943",   # They criticized me for coming late.
            "1365814",   # I didn't criticize him.
            "4497089",   # They often criticize us.
            "2816325",   # I'm not criticizing you.
            "5598570",   # I'm sorry for criticizing you.
            "18024",     # Your conduct is absolutely shameful.
        ],
        [
            "2929271",   # Your children are remarkably well-behaved.
            {"text": "Thank you — they try their best.", "added_for": "thank|try", "reason": "natural reply to compliment"},
        ],

        # ============================================================
        # Blame (kept core; trimmed earlier)
        # ============================================================
        [
            "50576",     # Don't blame the guide.
            "4666281",   # Both parties are to blame.
            "4666698",   # Both sides are to blame.
            "71300",     # I can't blame you for breaking your promise.
            "325569",    # I don't blame you for putting off our trip.
            "3735022",   # Be careful not to blame the wrong person.
            "3330504",   # I don't blame you for not wanting to go.
        ],
        [
            "1951357",   # I can't blame you for dreaming.
            "4496085",   # No one's to blame.
            "2245419",   # Everybody blames you.
        ],

        # ============================================================
        # Judgement / appearance
        # ============================================================
        [
            "270158",    # Don't judge people by their appearance.
            "982618",    # We shouldn't judge people based on their appearance.
            "2285817",   # Don't let appearances fool you.
            "2275174",   # Don't be fooled by appearances.
        ],

        # ============================================================
        # Food: potato / pizza / slice
        # ============================================================
        [
            "1721095",   # I like potato salad.
            "2580869",   # We ate potato soup.
            "4356514",   # If I start eating potato chips, I can't stop.
            "2331735",   # I had steak and potatoes last night.
            "3138116",   # Can you give me a slice of bread?
            "4502804",   # You can have a slice of pizza if you want.
            "1833031",   # There are two slices of pizza for each person.
        ],

        # ============================================================
        # Grab / casual food
        # ============================================================
        [
            "2007633",   # Let's go grab a burger.
            "3422350",   # Let's go grab a cup of coffee.
            "2012618",   # Do you want to grab dinner?
            "2007368",   # Let's go grab a bite somewhere.
            "2210720",   # Why don't you go grab us a couple of beers?
        ],

        # ============================================================
        # Wild animals (broken: was 7 fox-related rows in a row)
        # ============================================================
        [
            "63324",     # A fox is a wild animal.
            "249505",    # We tried to trap the fox.
            "544111",    # They trapped the fox.
            {"text": "It got away, though.", "added_for": "got|away", "reason": "vocab variety, breaks 'fox' drill"},
            "305596",    # They hunted foxes.
            "425812",    # Foxes are wild animals.
        ],
        [
            "268258",    # An elephant has a long nose.
            "268248",    # Have you ever seen an elephant fly?
            "54711",     # This is how they catch an elephant alive.
            "5557322",   # I like elephants.
            "325815",    # The hunters aimed at the elephant.
            "2117",      # A rabbit has long ears and a short tail.
            "1396365",   # Rabbits have long ears and short tails.
            "4256340",   # All insects have six legs.
        ],

        # ============================================================
        # Acknowledge / admit
        # ============================================================
        [
            "258265",    # I acknowledge my mistake.
            "4529789",   # We have to acknowledge that.
            "313070",    # She acknowledged having made a mistake.
            "297741",    # He acknowledged my presence with a nod.
            "298523",    # He acknowledged his faults.
        ],

        # ============================================================
        # Profession / occupation (broken: was 20-item drill of "I'm a X")
        # ============================================================
        [
            "5828974",   # I'm a pilot.
            "5633158",   # I know lots of pilots.
            "3636118",   # I'm a private investigator.
            "3830652",   # You're a smart investigator.
        ],
        [
            "5858261",   # I'm a biologist.
            "300507",    # He is a biologist.
            "5858257",   # I'm a programmer.
            "3821348",   # I want to be a programmer.
        ],
        [
            "5829204",   # I'm a golfer.
            "251378",    # My son wants to be a professional golfer.
            "1316498",   # He played golf every day during his vacation.
            "70206",     # When did you begin playing golf?
            "3315278",   # It's no bigger than a golf ball.
            "3150479",   # Where did you buy your golf clubs?
        ],
        [
            "5852831",   # I'm a blogger.
            "327941",    # He's a comedian.
            "5851815",   # I'm not a comedian.
            "2240984",   # We're comedians.
            "5483668",   # We're all taxpayers.
        ],

        # ============================================================
        # Pilot / plane
        # ============================================================
        [
            "3183457",   # This is your pilot speaking.
            {"text": "We'll be landing shortly.", "added_for": "landing|shortly", "reason": "natural follow-up"},
            "4015831",   # Which airline do you work for?
        ],

        # ============================================================
        # Furniture
        # ============================================================
        [
            "3022345",   # They sell furniture.
            "252283",    # I ordered new furniture.
            "24105",     # The furniture was dusty.
            "913493",    # Who moved the furniture?
            "682249",    # We rented a truck to move our furniture.
            "419249",    # That furniture is my mother's.
        ],

        # ============================================================
        # Cooking / kitchen
        # ============================================================
        [
            "5859317",   # I sliced the apple.
            "311145",    # She made jam from the apples.
        ],
        [
            "704725",    # Stir the soup.
            "3717634",   # Please pass me the jam.
            "5022696",   # The store is jam-packed.
            "266568",    # I was delayed by a traffic jam.
            "435623",    # There is a traffic jam on the highway.
            "240355",    # The traffic jam caused me to be late for the meeting.
        ],

        # ============================================================
        # Sweep / clean
        # ============================================================
        [
            "264792",    # Sweep my room.
            "3649575",   # Sweep the floor.
            "5858534",   # I swept the floor.
            "5858550",   # I've swept the floor.
        ],

        # ============================================================
        # Wash dishes
        # ============================================================
        [
            "4325124",   # I'll do the dishes, since you cooked.
            "2247878",   # I'll wash dishes.
            "5001087",   # Go help your mom with the dishes.
            "2425983",   # The kitchen sink was full of dirty dishes.
            "3802033",   # I'm the one who always washes the dishes.
            "253283",    # I watched TV after I washed the dishes.
            "319064",    # My father often washes the dishes.
        ],

        # ============================================================
        # Wrist injury
        # ============================================================
        [
            "2829796",   # My wrist hurts.
            "1446057",   # I have a broken wrist.
            "388017",    # That man grabbed the young girl's wrist.
        ],

        # ============================================================
        # Bargain / sales
        # ============================================================
        [
            "5899501",   # I love bargain sales.
            "2268750",   # These socks are a bargain.
            "4826286",   # You're in no position to bargain.
            "56541",     # This dress is a good bargain.
            "2374692",   # I kept my end of the bargain.
            "5588047",   # I like bargaining.
        ],

        # ============================================================
        # Personality traits — broken into thematic sub-arcs (was drill)
        # ============================================================
        [
            "2202807",   # You're emotional.
            "2218482",   # You're very emotional.
            "2202891",   # We're frightened.
            "1293040",   # She'd never been so frightened.
        ],
        [
            "2111680",   # I'm terrified.
            "4496840",   # Everyone looked confused and terrified.
            "2111678",   # I'm thrilled.
            "4499666",   # I'm thrilled the Giants won.
        ],
        [
            "2202702",   # You're courageous.
            "2713497",   # You're very courageous.
            "2202547",   # We're adventurous.
            "2111821",   # How adventurous!
            "2203092",   # You're motivated.
            "2123620",   # I'm motivated.
        ],
        [
            "1199390",   # You're so mysterious.
            "2688960",   # This is very mysterious.
            "3341693",   # You're sort of rude.
            "303984",    # He made a rude reply.
            "1153476",   # Their rude behavior makes me angry.
            "2713164",   # It's rude to stare at people.
            "3172283",   # Do people ever accuse you of being rude?
        ],
        [
            "2203245",   # We're rational.
            "2203246",   # You're rational.
            "2203010",   # You're influential.
            "5938129",   # You look very distinguished.
            "2962850",   # You seem very knowledgeable about that.
        ],
        [
            "2887705",   # You're such a gossip.
            "2245721",   # I don't gossip.
            "2203564",   # You're vague.
            "2248898",   # It was vague.
        ],

        # ============================================================
        # Disturbing / shocking
        # ============================================================
        [
            "2111446",   # That's disturbing.
            "3111046",   # It's disturbing.
            "1676703",   # That's terrifying.
            "2187238",   # It's terrifying.
            "5423330",   # It's frightening.
            "4498768",   # The facts are frightening.
        ],
        [
            "2111813",   # How thrilling!
            "2248888",   # It was thrilling.
            "2649007",   # It was a thrill.
            "2111387",   # That's unreal.
            "2203536",   # You're unreal.
            "2111958",   # Be respectful.
            "4501795",   # They were very respectful.
            "5916079",   # I think I look respectable.
        ],

        # ============================================================
        # Inevitable / bound
        # ============================================================
        [
            "1327908",   # It's inevitable.
            "5715094",   # You're bound to fail.
            "4666712",   # We're bound to get wet.
            "3645306",   # It's bound to happen sooner or later.
            "3101554",   # It was bound to happen sooner or later.
            "48501",     # The plan is bound to succeed.
            "263740",    # Accidents are inevitable.
        ],

        # ============================================================
        # Hope / hopeless
        # ============================================================
        [
            "1894583",   # It's hopeless.
            "4395351",   # The situation seemed hopeless.
            "4499412",   # That sounds hopeful.
            "5469217",   # We're very hopeful.
        ],

        # ============================================================
        # Motives / suspicion
        # ============================================================
        [
            "1951603",   # I can't figure out your motives.
            "3142952",   # Are you questioning my motives?
            "2646743",   # What was your motive?
            "1954614",   # I can't locate the source of the problem.
        ],

        # ============================================================
        # Misunderstanding
        # ============================================================
        [
            "1486889",   # It's misleading.
            "4500547",   # The title is misleading.
            "2262861",   # It's all a terrible misunderstanding.
            "4135032",   # It's probably just a misunderstanding.
            "240259",    # Thank you for clearing up the misunderstanding.
            "4265173",   # Let's try to clear up this misunderstanding.
            "2249759",   # Perhaps you misunderstood.
            "3822377",   # You must've misunderstood.
            "2026874",   # I didn't want to risk a misunderstanding.
            "5137550",   # There's obviously been some misunderstanding.
        ],

        # ============================================================
        # Logic / reasoning
        # ============================================================
        [
            "287818",    # His argument was logical.
            "4015987",   # What's the most logical explanation?
            "2439907",   # That's my reasoning.
            "2154819",   # I don't understand this reasoning.
            "3286798",   # That proves nothing.
            "3342757",   # You proved me wrong.
            "1690410",   # It's a proven fact.
            "4496636",   # The coach has proven himself.
        ],

        # ============================================================
        # Assume / assure / presume
        # ============================================================
        [
            "3921589",   # My initial assumption was correct.
            "3831483",   # Your assumptions are correct.
            "3313159",   # We can't make any assumptions.
            "2293268",   # I assumed because we're brothers that I could trust you.
        ],
        [
            "2293453",   # I assure you that isn't necessary.
            "2293447",   # I assure you I'll accept full responsibility.
            "2293449",   # I assure you I'm in perfect health.
            "886992",    # She assured him that everything was OK.
            "273838",    # Rest assured that I will do my best.
        ],
        [
            "2890426",   # Let's presume you're right.
            "4501031",   # Three people are still missing and presumed dead.
            "2835615",   # They supposedly have reached a deal.
        ],

        # ============================================================
        # Hedging / extent
        # ============================================================
        [
            "5526985",   # We have to be more consistent.
            "2276914",   # That doesn't necessarily change anything.
            "275497",    # Large houses are not necessarily comfortable to live in.
        ],

        # ============================================================
        # Consequences
        # ============================================================
        [
            "2286998",   # I know the potential consequences.
            "2287002",   # I'll do that regardless of the consequences.
            "2286996",   # I don't think you fully understand the consequences.
            "2287000",   # I think we're all aware of the consequences.
            "954473",    # We have to live with the consequences of our actions.
            "954474",    # We have to live with the consequences of our choices.
        ],

        # ============================================================
        # Imaginative / project / achievement
        # ============================================================
        [
            "3172367",   # Are you imaginative?
            "4865903",   # Difficult problems require imaginative solutions.
            "4495473",   # What an achievement!
            "1476611",   # It's an ambitious project.
            "3732767",   # I was young and ambitious once.
            "4529756",   # That'll be a big achievement.
        ],

        # ============================================================
        # Congratulations
        # ============================================================
        [
            "1437",      # Congratulations!
            "5137565",   # Congratulations are definitely in order.
            {"text": "Thanks — I really appreciate that.", "added_for": "appreciate|that", "reason": "natural reply"},
        ],

        # ============================================================
        # Hire / employment / assistant
        # ============================================================
        [
            "5916455",   # I've hired an assistant.
            "5939657",   # I hired an assistant.
            "2542966",   # I'm no longer your assistant.
            "1315783",   # He trusts his assistant quite a lot.
            "2406817",   # I submitted the application myself.
            "4501593",   # What are their qualifications?
        ],

        # ============================================================
        # Reports / surveys
        # ============================================================
        [
            "2544494",   # We're conducting a survey.
            "324911",    # As requested, we are submitting our final report.
            "260724",    # I began to doubt the accuracy of his statement.
            "3820425",   # I don't trust these surveys.
        ],

        # ============================================================
        # Lecture / academic
        # ============================================================
        [
            "6104443",   # The lecture was boring.
            "5006745",   # Is the lecture already finished?
            "296371",    # He cleared his throat before starting the lecture.
            "59444",     # This building is near completion.
            "313118",    # She achieved remarkable results.
            "44638",     # Those two experiments yielded similar results.
        ],

        # ============================================================
        # Library / shelf
        # ============================================================
        [
            "58303",     # This library has a large collection of Chinese books.
            "2897068",   # Where is the librarian?
            "16901",     # Your comic books are on the shelf.
            "1525585",   # I grabbed a book off the shelf.
        ],

        # ============================================================
        # Exhibition / exhibit
        # ============================================================
        [
            "3311984",   # We'll see the exhibit tomorrow.
            "249396",    # We hold an exhibition every year.
            "16577",     # You ought to have seen the exhibition.
            "4498401",   # The exhibit runs through October 20th.
        ],

        # ============================================================
        # Comedy
        # ============================================================
        [
            "5842767",   # How did you get into comedy?
            {"text": "I started doing open mics in college.", "added_for": "started|college", "reason": "natural answer"},
            "253768",    # I love comedies.
            "1397759",   # Mary likes romantic comedies.
            "6026904",   # I think golf is boring to watch.
        ],

        # ============================================================
        # Theater
        # ============================================================
        [
            "680815",    # The theater is empty.
            "1312934",   # He loves going to the theater.
            "4133584",   # Let's meet in front of the movie theater.
            "66700",     # Let's go to the theater early so that we can get good seats.
        ],

        # ============================================================
        # Music / instruments
        # ============================================================
        [
            "25181",     # Can you play any musical instruments?
            "21260",     # Do you play a musical instrument?
            "69519",     # You play a musical instrument, don't you?
            "908698",    # Who's your favorite drummer?
            "908710",    # Who's your favorite guitarist?
            "908712",    # Who's your favorite heavy metal guitarist?
            "2050651",   # Who plays the keyboards in your band?
            "2631707",   # I need a keyboard.
        ],
        [
            "321631",    # I like jazz.
            "290131",    # He knows everything that there is to know about jazz.
            "6003679",   # If we had more space, we could get a grand piano.
            "4746928",   # Mozart wrote brilliant, complex …
        ],

        # ============================================================
        # Hobby (kept core)
        # ============================================================
        [
            "2646222",   # What are your hobbies?
            "5859815",   # I have many hobbies.
            "1258647",   # My hobby is cooking.
            "1258651",   # My hobby is reading.
            "251129",    # My hobby is collecting coins.
            "251134",    # My hobby is listening to music.
            "251147",    # My hobby is collecting stamps.
            "1542552",   # It started as a hobby.
            "286645",    # His hobby is painting pictures of flowers.
            "318909",    # My father's hobby is growing roses.
            "1419656",   # My hobby is weight lifting.
        ],
        [
            "2994956",   # Would you like to see my stamp collection?
            "3871280",   # Do you want to see my stamp collection?
            "4497087",   # Creativity is the key.
        ],

        # ============================================================
        # Jeans
        # ============================================================
        [
            "2369624",   # My jeans won't fit.
            "250113",    # Do you have jeans in my size?
            "259864",    # I usually wear jeans on Sunday.
            "2645116",   # A lot of kids wear jeans.
            "261972",    # I bought two cotton shirts.
            "237873",    # My brother gave me a pair of jeans.
            "310395",    # She usually wears jeans.
        ],

        # ============================================================
        # Costume / dress-up
        # ============================================================
        [
            "3598170",   # Don't forget your costume.
            "1977303",   # Where can I rent a costume?
            "1886721",   # What kind of costumes did you buy for the children?
        ],

        # ============================================================
        # Cheek / kiss
        # ============================================================
        [
            "325977",    # A tear ran down her cheek.
            "4265772",   # It was only a kiss on the cheek.
            "887258",    # She kissed him on the cheek.
            "1300342",   # My three-year-old niece kissed me on the cheek.
            "288056",    # He read the letter with tears running down his cheeks.
        ],

        # ============================================================
        # Sore — core idioms
        # ============================================================
        [
            "2069353",   # Nobody likes a sore loser.
            "3359981",   # You're a sight for sore eyes.
            "5774436",   # My neck is a little sore.
            "273774",    # My whole body is sore.
            "5858172",   # I have a sore knee.
            "1300315",   # I have a sore throat. Do you have a cough drop?
        ],
        [
            "2248210",   # I'm physically exhausted.
            "248788",    # We exhausted our funds.
            "16728",     # You must be mentally exhausted.
            "23072",     # We were all rather exhausted.
            "4498400",   # That sounds exhausting.
            "1488137",   # The trip was exhausting.
        ],

        # ============================================================
        # Coping / stress
        # ============================================================
        [
            "3820542",   # I can't cope with stress.
            "2891361",   # How will they cope?
            "4666488",   # How have you been coping?
            "3165731",   # I just need to blow off some steam.
            "2543186",   # I was just blowing off steam.
            "2545267",   # I'm trying to compensate.
            "5254553",   # I've got other commitments.
        ],

        # ============================================================
        # Habit / routine
        # ============================================================
        [
            "3728493",   # I'm a creature of habit.
            "953096",    # Are you a creature of habit?
            "4495020",   # Nothing is routine.
            "5657254",   # I've changed my daily routine.
            "3723067",   # These are just routine questions we ask everyone.
        ],

        # ============================================================
        # Pace yourself
        # ============================================================
        [
            "1841178",   # Pace yourself.
            "2249537",   # Let's pace ourselves.
            "301019",    # He walked at a quick pace.
            "5852438",   # I began pacing.
            "1950192",   # Would you please stop pacing around like that and just sit down for a second?
        ],

        # ============================================================
        # Precise
        # ============================================================
        [
            "2406381",   # I should've been more precise.
            "3591141",   # That's precisely the point.
            "3591692",   # That's precisely what I meant.
            "2599466",   # Precise measurements are necessary.
        ],

        # ============================================================
        # Abroad (kept core, broken from drill)
        # ============================================================
        [
            "294739",    # He went abroad.
            "312976",    # She has gone abroad.
            "249395",    # We go abroad every summer.
            "2591472",   # My older brother wants to study abroad.
            "262169",    # I intend to study abroad next year.
        ],
        [
            "21925",     # Traveling abroad is very interesting.
            "319094",    # My father is now traveling abroad.
            "299511",    # He often goes abroad on business.
            "489683",    # He hopes to go abroad.
            "250254",    # My uncle lived abroad for many years.
            "325477",    # I am saving money in order to study abroad.
        ],

        # ============================================================
        # Pride / nation / politics
        # ============================================================
        [
            "1545877",   # It's a matter of national pride.
            "273797",    # The nation as a whole is in favor of political reform.
            "6098777",   # Aren't you still politically active?
            "1318674",   # The Prime Minister will hold a press conference tomorrow.
        ],

        # ============================================================
        # Rules / regulations
        # ============================================================
        [
            "1417118",   # We must follow the regulations.
            "1417116",   # We have to follow the regulations.
            "2254031",   # Can you get around that regulation?
            "5502215",   # That law isn't enforced.
            "2325168",   # I enforce the rules even though I don't agree with them all.
            "696746",    # It's our duty to always obey the law.
            "1075502",   # We should always obey laws.
            "2246034",   # I obey instructions.
            "6013546",   # Are you refusing to obey me?
            "3773364",   # Everyone must obey the rules. Those who don't will be punished.
            "4496151",   # Teenagers often break rules.
        ],

        # ============================================================
        # Twins
        # ============================================================
        [
            "305080",    # They have twin daughters.
            "2252593",   # The twins sang.
            "2252594",   # The twins smiled.
            "253115",    # I always confuse John and his twin brother.
            "310096",    # She gave birth to twins a week ago.
            "49959",     # The twin girls are so much alike …
        ],

        # ============================================================
        # Family / regards
        # ============================================================
        [
            "237827",    # My brother sends you his regards.
            "1393373",   # Send her my regards.
            "3152556",   # Give my regards to your folks.
        ],

        # ============================================================
        # Princess (light)
        # ============================================================
        [
            "3498699",   # Are you really a princess?
            {"text": "Only in my dreams.", "added_for": "only|dreams", "reason": "playful reply"},
        ],

        # ============================================================
        # Hints / unlikely
        # ============================================================
        [
            "1336430",   # Give me a hint.
            "1832186",   # Thanks for the hint.
            "2275228",   # Don't give me any hints.
            "252865",    # I'd like to point out some problems regarding your suggestion.
        ],
        [
            "5135020",   # Experts say that's unlikely.
            "953644",    # I think it's unlikely that I'll be able to pass my driving test.
            "953621",    # I still think it's unlikely that he'll come today.
            "953645",    # I think it's unlikely that plants feel pain.
            "953641",    # I think it's unlikely that a situation like this one would ever occur again.
            "953637",    # I think it's highly unlikely that we'll be able to escape from this prison.
        ],

        # ============================================================
        # Adjustments / arrangements
        # ============================================================
        [
            "5642554",   # I didn't make any adjustments.
            "2358893",   # I've already made arrangements.
            "2541003",   # I'll handle all the arrangements.
            "4529205",   # The arrangement proved highly profitable.
        ],

        # ============================================================
        # Independence / dependence
        # ============================================================
        [
            "480228",    # Today is Independence Day.
            "4999926",   # I love my independence.
            "312240",    # She's still dependent on her parents.
            "67672",     # Don't be too dependent on others.
        ],

        # ============================================================
        # Confidence
        # ============================================================
        [
            "1801782",   # I lack confidence.
            "4666948",   # Don't lose confidence.
            "4502488",   # It just takes confidence.
            "2291583",   # I admire your confidence.
        ],

        # ============================================================
        # Tendency
        # ============================================================
        [
            "2954525",   # You have a tendency to not pay attention.
            "1304524",   # People have the tendency to speak more loudly when they get excited.
        ],

        # ============================================================
        # Appearance / charming
        # ============================================================
        [
            "2458545",   # I think you'd look distinguished with a beard.
            "539523",    # She is a charming woman.
            "5850177",   # Mary is charming and attractive.
            "68031",     # That baby has charming eyes.
            "296000",    # He has broad shoulders.
        ],

        # ============================================================
        # Old-fashioned / broad-minded
        # ============================================================
        [
            "5639905",   # I'm fairly old-fashioned.
            "3172406",   # Are you broad-minded?
        ],

        # ============================================================
        # Blog (kept light)
        # ============================================================
        [
            "3423150",   # How's your blog going?
            {"text": "Slowly — I haven't posted in weeks.", "added_for": "slowly|posted", "reason": "natural answer"},
            "2483400",   # No one reads my blog.
            "2483401",   # Hardly anyone reads my blog.
        ],

        # ============================================================
        # Smoking / drinking
        # ============================================================
        [
            "258475",    # I neither smoke nor drink.
            "319057",    # My father seldom smokes.
            "251642",    # My father neither smokes nor drinks.
            "25891",     # Smoking is harmful to your health.
        ],

        # ============================================================
        # Loose / tight
        # ============================================================
        [
            "60508",     # This button is loose.
            "59021",     # This tooth is loose.
            "2542879",   # I'm tying up some loose ends.
            "3819723",   # Hold me tighter.
            "887201",    # She held him tightly.
            "314344",    # She held on to my hand tightly.
        ],

        # ============================================================
        # Irregular
        # ============================================================
        [
            "2233701",   # This is irregular.
            "1935310",   # This is highly irregular.
        ],

        # ============================================================
        # Sour
        # ============================================================
        [
            "19474",     # The milk turned sour.
            "48718",     # The milk tastes sour.
            "49852",     # The milk tasted sour.
            "2259515",   # These oranges are very sour.
        ],

        # ============================================================
        # Cupboard / fridge
        # ============================================================
        [
            "3825500",   # What's in that cupboard?
            "239944",    # I looked in the cupboard.
            "4823477",   # There's beer in the fridge.
            "1547366",   # Get an egg from the fridge.
            "3272286",   # There's no more butter in the fridge.
            "1424500",   # Please feel free to eat anything in the fridge.
        ],

        # ============================================================
        # Toilet / plumbing
        # ============================================================
        [
            "5181607",   # The toilet is stopped up.
            "5870557",   # The toilet is backed up.
            "687556",    # Where are the toilets?
            "662756",    # We've just cleaned the toilets.
        ],

        # ============================================================
        # Pipe / plumbing
        # ============================================================
        [
            "270921",    # The water pipe burst.
            "4496159",   # The water pipes broke.
            "63755",     # Gas seems to be escaping from the pipe.
            "4502543",   # Wrap tape around the pipe.
            "296261",    # He was sitting there with a pipe in his mouth.
            "2045344",   # It's a pipe dream.
        ],

        # ============================================================
        # Tissue / everyday
        # ============================================================
        [
            "3392966",   # Hand me a tissue.
            "4707889",   # I need a tissue.
            "4482880",   # Make sure you check all the pockets for tissues before washing your clothes.
        ],

        # ============================================================
        # Loan / borrow small items
        # ============================================================
        [
            "1037053",   # Can you loan me a pen?
            "2152290",   # Please loan me your dictionary.
            "46941",     # The dictionary comes in two volumes.
            "4016809",   # Can you loan me thirty dollars for a cab?
        ],

        # ============================================================
        # Pills / medication / swallow
        # ============================================================
        [
            "4016806",   # What are those pills called?
            "2259517",   # These pills will ease the pain.
            "3736992",   # These pills are hard to swallow.
            "2540659",   # I took a sleeping pill last night.
            "5938418",   # I swallowed the pill.
            "2545942",   # I'm not swallowing that.
            "268673",    # My throat hurts when I swallow.
            "5592868",   # Are you having any difficulty swallowing?
            "5050532",   # I swallowed my pride.
        ],

        # ============================================================
        # Medical (light, kept)
        # ============================================================
        [
            "296145",    # He had trouble breathing.
            "3619010",   # I'm having trouble breathing.
            "1657641",   # There's no sign of infection.
            "264396",    # I often have ear infections.
            "1225414",   # I get motion sickness.
            "4664653",   # I don't expect any complications.
            "1500180",   # This medicine has no harmful side effects.
        ],

        # ============================================================
        # Disability / respect elders
        # ============================================================
        [
            "269832",    # I really enjoy helping disabled people.
            "2358696",   # I have a disability.
            "1293128",   # You need to respect the elderly.
            "1682918",   # Respect your elders.
            "2954777",   # You should respect your elders.
        ],

        # ============================================================
        # Graduation / school transitions
        # ============================================================
        [
            "2240694",   # We're graduating tomorrow.
            "1950817",   # I can't believe I'm graduating this year.
            {"text": "Congratulations in advance!", "added_for": "in|advance", "reason": "natural reply"},
            "510198",    # She was very shy until she graduated.
            "4499075",   # Not everybody graduates.
            "4499073",   # All graduates are invited.
            "5006918",   # What are you wearing to graduation?
        ],
        [
            "301528",    # He entered junior high school.
            "252301",    # I'm a junior high school student.
            "245602",    # My sister expects to graduate from college next year.
            "262151",    # I hope to graduate from university next spring.
            "4135410",   # I graduated from high school when I was seventeen years old.
        ],

        # ============================================================
        # Read aloud
        # ============================================================
        [
            "271932",    # Read it aloud.
            "2450035",   # Read the story aloud.
        ],

        # ============================================================
        # Shortage / lack
        # ============================================================
        [
            "3651494",   # There's no shortage of work.
            "243436",    # The trouble is that she lacks experience.
            "73261",     # In 1994, there was a shortage …
        ],

        # ============================================================
        # Adverbs of degree
        # ============================================================
        [
            "42268",     # That's altogether wrong.
            "2450049",   # This is altogether different.
            "4664154",   # This contract is totally ridiculous.
            "4496733",   # What a ridiculous comparison!
            "4493965",   # The difference is substantial.
            "4493799",   # These kinds of problems are relatively rare.
            "4012188",   # It's relatively simple to use.
            "6451950",   # The exam was relatively easy.
            "5109262",   # We all need to live life to the fullest.
        ],

        # ============================================================
        # Damage / liability
        # ============================================================
        [
            "23178",     # We are liable for the damage.
            "270658",    # People have eaten with their fingers from the beginning of history.
        ],

        # ============================================================
        # Coal / energy
        # ============================================================
        [
            "272238",    # Coal is not always black.
            "4397500",   # We've run out of coal.
            "2450053",   # We need a large amount of coal.
            "681477",    # Many workers were trapped in the coal mine.
            "4016081",   # Does water conduct electricity?
        ],
        [
            "4016079",   # Water conducts electricity.
            "954344",    # The flame went out.
            "25907",     # Turn the flame down low.
            "4494008",   # There were flames everywhere.
            "24147",     # The house was in flames.
        ],

        # ============================================================
        # Disturb / quiet
        # ============================================================
        [
            "1495899",   # Don't disturb me.
            "4450058",   # I won't disturb you.
            "416691",    # We disturbed him.
            "2545941",   # I'm not to be disturbed.
        ],

        # ============================================================
        # Imposing / polite
        # ============================================================
        [
            "2011759",   # I don't want to impose.
            "2360860",   # I hope I'm not imposing.
            "65009",     # Sorry to impose, but would you please open the window?
        ],

        # ============================================================
        # Outcome / disaster
        # ============================================================
        [
            "3730561",   # What was the outcome?
            "2388076",   # I never doubted the outcome.
            "705382",    # We're heading for disaster.
            "2548655",   # It'd be a disaster.
        ],

        # ============================================================
        # Charm
        # ============================================================
        [
            "2253842",   # Use your charm.
            "2546475",   # It worked like a charm.
        ],

        # ============================================================
        # Bushes / hide
        # ============================================================
        [
            "682182",    # We walked through thick bushes.
            "5916115",   # I hid myself in the bushes.
            "1904818",   # Someone is standing behind the bushes taking pictures of us.
            "4545463",   # We have some rose bushes in front of our house.
            "22322",     # Don't beat around the bush.
            "32308",     # Stop beating around the bush.
        ],

        # ============================================================
        # Roses (light, kept)
        # ============================================================
        [
            "5829166",   # I grew roses.
            "49967",     # Pink roses are beautiful.
            "1388138",   # I brought you red roses.
        ],

        # ============================================================
        # Pond — kept core, drill trimmed via removals
        # ============================================================
        [
            "1360041",   # Don't swim in that pond.
            "277295",    # The pond has frozen over.
            "495618",    # The stream flows into the pond.
            "300575",    # He threw a stone into the pond.
        ],

        # ============================================================
        # Slippers / muddy
        # ============================================================
        [
            "2646189",   # Where are my slippers?
            "2646656",   # Are those my slippers?
            "3636265",   # Your shoes are muddy.
            "3360953",   # Please take off your muddy boots.
            "300772",    # He was covered with mud from head to foot.
        ],

        # ============================================================
        # Stormy
        # ============================================================
        [
            "283704",    # The evening he died was stormy.
            "625185",    # It was a dark and stormy night.
        ],

        # ============================================================
        # Wander
        # ============================================================
        [
            "2275359",   # Don't wander off like that.
            "326518",    # The story wandered.
            "2330076",   # I guess my mind wandered.
            "999044",    # I was bored, so I wandered around town.
        ],

        # ============================================================
        # Busy / Christmas
        # ============================================================
        [
            "238871",    # Monday is my busiest day.
            "321180",    # The busiest men find the most time.
            "5679186",   # Christmas is our busiest time of the year.
        ],

        # ============================================================
        # Tripped / fell / tore
        # ============================================================
        [
            "2111794",   # I tripped.
            "3734337",   # One of the youngsters tripped and fell.
            "259583",    # I tore my jacket on a nail.
            "682141",    # I tore a hole in my jeans when I fell off my bike.
        ],

        # ============================================================
        # Hamburger / joint
        # ============================================================
        [
            "2042617",   # Do you want to work at a hamburger joint all your life?
            "306371",    # They agreed on a joint statement.
        ],

        # ============================================================
        # Tongue / bite
        # ============================================================
        [
            "460265",    # Stick out your tongue.
            "1850263",   # Bite your tongue.
        ],

        # ============================================================
        # Sand (kept light)
        # ============================================================
        [
            "680688",    # Children love to dig in the sand.
            "2985591",   # Let's lie on the sand.
            "63527",     # Glass is made from sand.
            "323745",    # I got some sand in my eye.
            "1624873",   # We made a sand castle.
            "5293039",   # The sand was so hot that it burned our feet.
            "243612",    # We ran out of gas in the middle of the desert.
        ],

        # ============================================================
        # Tense / nervous
        # ============================================================
        [
            "3723423",   # The crew is tense.
            "309526",    # I always get nervous in her presence.
        ],

        # ============================================================
        # Drowning (light, broken from drill)
        # ============================================================
        [
            "2546641",   # I'm afraid of drowning.
            "3327618",   # Luckily nobody drowned.
            "300670",    # He drowned in the river.
            "1519849",   # The boy almost drowned.
            "4498197",   # Three passengers were saved, but the remaining passengers drowned.
        ],

        # ============================================================
        # Reopen / rebuild
        # ============================================================
        [
            "3820654",   # We hope to reopen soon.
            "2107679",   # We'll rebuild.
            "5570989",   # We're going to rebuild this city.
            "4496248",   # It can be rebuilt.
        ],

        # ============================================================
        # Unemployment
        # ============================================================
        [
            "3396551",   # Actually, I'm currently unemployed.
            "1690155",   # Many young people in Spain are unemployed.
            "20931",     # Tourism generated many new jobs.
        ],

        # ============================================================
        # Envy / jealousy
        # ============================================================
        [
            "2245734",   # I envy you.
            "1414039",   # I envy her.
            "32177",     # Everybody was jealous of my success.
            "4164114",   # Why do you want to make your boyfriend jealous?
        ],

        # ============================================================
        # Facilities
        # ============================================================
        [
            "5057507",   # This is a great facility.
            "2082274",   # Our town has excellent sports facilities.
        ],

        # ============================================================
        # Crime / police (loosened: kept most)
        # ============================================================
        [
            "5075446",   # The police weren't able to determine which one of the twins had committed the crime.
            "3012833",   # The police are investigating the shooting.
            "238172",    # The police are investigating the cause of the crash.
            "4500344",   # Authorities are still investigating.
            "4497244",   # Detectives are still investigating.
            "4499428",   # Several protesters were hurt.
            "4501566",   # Three of the protesters were wounded.
            "4083391",   # Mary claimed that her purse had been stolen.
        ],

        # ============================================================
        # Weapons (loosened; kept core police/legal)
        # ============================================================
        [
            "2763252",   # Put your weapons on the ground!
            "2886590",   # Throw out your weapon.
            "3636400",   # Did you bring a weapon?
            "4872449",   # Is that weapon loaded?
            "1937702",   # No one uses that kind of weapon anymore.
            "319450",    # It's against the law to carry weapons.
            "4497343",   # No weapons were discovered.
            "659328",    # The army had plenty of weapons.
            "2944654",   # The export of arms was not allowed.
        ],

        # ============================================================
        # Drama / relationship (loosened — kept divorce + drama context)
        # ============================================================
        [
            "5916627",   # I've filed for divorce.
            "4496862",   # I'm seriously considering filing for divorce.
            {"text": "Are you sure that's what you want?", "added_for": "sure|want", "reason": "natural cautious reply"},
            "2057847",   # The boss is looking for someone to blame.
            "3905051",   # I was a fool to trust you.
            "2718561",   # I should've known not to trust you.
        ],

        # ============================================================
        # Auto-paired small arcs (anchor-local, shared content word)
        # ============================================================
        ["2954614", "1779940"],     # yourselves / deny (subtle hedging)
        ["19182", "2891361"],       # storm-wind / cope
        ["681582", "313118"],       # publication / remarkable results
    ],
}
