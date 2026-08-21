/**
 * Sample tutor answers for the store screenshots.
 *
 * Each one opens with the rule in a single line, shows the contrast with a
 * worked pair, and ends with the sentence worth keeping. Short enough to read
 * whole on a phone screen.
 */
export interface Sample {
  id: string;
  question: string;
  answer: string;
  card: { base: string; target: string };
}

export const SAMPLES: Sample[] = [
  {
    id: 'por-para',
    question: 'When do I use por and when para?',
    answer:
      '**Por** points back at a cause. **Para** points forward at a purpose.\n\n*Lo hice **por** ti* — I did it because of you.\n*Lo hice **para** ti* — I made it for you.\n\nTime works the same way. **Por la mañana** is a stretch of morning. **Para el lunes** is a deadline.',
    card: { base: 'I made it for you.', target: 'Lo hice para ti.' },
  },
  {
    id: 'subjunctive',
    question: 'Why is it vaya here and not va?',
    answer:
      'Because **espero que** wishes for something rather than reporting it, and Spanish marks a wish with the subjunctive.\n\n*Sé que **va** al médico* — I know he is going.\n*Espero que **vaya** al médico* — I hope he goes.\n\nHoping, wanting, doubting and asking all trigger it. **Creo que** does not. **No creo que** does.',
    card: { base: 'I hope he goes to the doctor.', target: 'Espero que vaya al médico.' },
  },
  {
    id: 'register',
    question: 'How would I say this to someone I just met?',
    answer:
      'Move from **tú** to **usted** and the verb shifts to the third person.\n\n*¿Me **puedes** ayudar?* — someone you know.\n*¿Me **puede** ayudar?* — someone you do not.\n\nOpening with **disculpe** softens it further. Spain drops to **tú** quickly; much of Latin America stays on **usted** far longer.',
    card: { base: 'Excuse me, could you help me?', target: 'Disculpe, ¿me puede ayudar?' },
  },
  {
    id: 'ser-estar',
    question: 'Is it es cansado or está cansado?',
    answer:
      'Both are correct and they say different things.\n\n*El viaje **es** cansado* — the trip is tiring, as a property of the trip.\n*Él **está** cansado* — he is tired right now.\n\n**Ser** describes what a thing is. **Estar** describes how it happens to be.',
    card: { base: 'He is tired after the trip.', target: 'Está cansado después del viaje.' },
  },
  {
    id: 'past-tenses',
    question: 'Comí or comía?',
    answer:
      'The preterite closes an action. The imperfect leaves it running.\n\n***Comí** a las dos* — one finished meal, at two.\n***Comía** cuando llamaste* — I was eating, and you interrupted.\n\nIf **siempre** or **mientras** would fit the sentence, you want the imperfect.',
    card: { base: 'I was eating when you called.', target: 'Comía cuando llamaste.' },
  },
];

export const REJECT_SAMPLE = {
  question: 'Three polite ways to turn down an invitation?',
  answer: 'Here are three ways to politely turn down an invitation:',
  cards: [
    { base: 'Thanks, but I would rather not.', target: 'Gracias, pero prefiero que no.' },
    { base: 'Maybe another time.', target: 'Quizá en otra ocasión.' },
    { base: 'I am afraid I cannot today.', target: 'Me temo que hoy no puedo.' },
  ],
};
