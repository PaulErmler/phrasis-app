/**
 * TEMPORARY — companion to scripts/story-curriculum-prototype.ts.
 *
 * Hand-picked ESL dialogues that show what a story slot should read like:
 * ordinary situations, short turns, real questions answered by real answers.
 * They are given to the writer as the target register and to the blind editor
 * as the standard it judges against.
 *
 * Some sources had their speaker labels hoisted into a block at the top of the
 * exchange; the lines are transcribed back onto their speakers here.
 */
export const EXAMPLE_STORIES = [
  `A: Where do you live?
B: I live in Pasadena.
A: Where is Pasadena?
B: It's in California.
A: Is it in northern California?
B: No. It's in southern California.
A: Is Pasadena a big city?
B: It's pretty big.
A: How big is "pretty big"?
B: It has about 140,000 people.
A: How big is Los Angeles?
B: It has about 3 million people.`,

  `A: I like living here.
B: I agree. Pasadena is a nice city.
A: It's not too big.
B: And it's not too small.
A: It has great weather all year long.
B: It has the Rose Parade.
A: It has beautiful houses.
B: It has wonderful restaurants.
A: It has great schools.
B: It's close to the mountains.
A: The people are friendly.
B: I'm not ever going to leave.`,

  `JAMES: Good morning, Professor Austin, how are you doing?
PROFESSOR AUSTIN: Good morning, James. I am doing well. And you?
JAMES: I'm great, thank you. This is my friend Emma. She is thinking about applying to this college. She has a few questions. Would you mind telling us about the process, please?
PROFESSOR AUSTIN: Hello, Emma! It's a pleasure to meet you. I'm more than happy to speak with you. Please stop by my office next week.
EMMA: It's a pleasure to meet you, professor. Thank you so much for helping us.
PROFESSOR AUSTIN: Don't mention it.`,

  `JANE: Hi, Helen! How's it going?
HELEN: Fine, thanks — and you?
JANE: Just fine. Where are you off to?
HELEN: To the library. I've got a history exam next week and need to start studying. Ugh.
JANE: Oh, no. Well, I'll see you later then. Good luck!
HELEN: Thanks. See you later.`,

  `JIM: Who's the tall woman next to Barbara?
CHARLES: That's her friend Mary. Didn't you meet her at Steve's party?
JIM: No, I wasn't at Steve's party.
CHARLES: Oh! Then let me introduce you to her now. Mary, this is my friend Jim.
MARY: Hi, Jim. Nice to meet you.
JIM: You, too. Would you like a drink?
MARY: Sure, let's go get one.`,

  `NATASHA: What time is it? We're going to be late!
TONY: It's a quarter after seven. We're on time. Don't panic.
NATASHA: But I thought we had to be at the restaurant by 7:30 for the surprise party. We'll never make it there with all this evening traffic.
TONY: Sure we will. Rush hour is almost over. Anyway, the party starts at 8:00. But I do need help with directions. Can you call the restaurant and ask them where we park our car?`,

  `JOHN: Hi, Alice, it's John. How are you?
ALICE: Oh, hi, John! I was just thinking about you.
JOHN: That's nice. I was wondering if you'd like to go to a movie tonight.
ALICE: Sure, I'd love to! What's playing?
JOHN: I was thinking about that new comedy Lights Out. What do you think?
ALICE: Sounds great!
JOHN: OK, I'll pick you up around 7:30. The movie starts at 8:00.
ALICE: See you then. Bye!`,

  `LUKE: Hello? Hi, Stephanie, how are things at the office?
STEPHANIE: Hi, Luke! How are you? Can you please stop and pick up extra paper for the computer printer?
LUKE: What did you say? Can you repeat that, please? Did you say to pick up ink for the printer? Sorry, the phone is cutting out.
STEPHANIE: Can you hear me now? No, I need more computer paper. Listen, I'll text you exactly what I need. Thanks, Luke. Talk to you later.
LUKE: Thanks, Stephanie. Sorry, my phone has really bad reception here.`,

  `POSTAL CLERK: What can I do for you today?
CAROL: I need to mail this package to New York, please.
POSTAL CLERK: OK, let's see how much it weighs … it's about five pounds. If you send it express, it will get there tomorrow. Or you can send it priority and it will get there by Saturday.
CAROL: Saturday is fine. How much will that be?
POSTAL CLERK: $11.35. Do you need anything else?
CAROL: Oh, yeah! I almost forgot. I need a book of stamps, too.
POSTAL CLERK: OK, your total comes to $20.35.`,

  `SANDRA: So … what should we do?
JULIE: Well, I like to do arts and crafts, and I'm really good at drawing. What do you think?
SANDRA: Hmm … how about playing a board game? That would be more fun.
JULIE: OK. Let's play Scrabble! I'm really good at spelling, too!
SANDRA: Oh, yeah? We'll see about that!`,
];

/** The examples wrapped for a prompt, one `<example>` per dialogue. */
export const exampleBlock = (): string =>
  EXAMPLE_STORIES.map((s) => `<example>\n${s}\n</example>`).join('\n');
