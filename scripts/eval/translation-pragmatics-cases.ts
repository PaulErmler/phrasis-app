/**
 * Fixtures for scripts/eval-translation-pragmatics.ts.
 *
 * A learner reported curriculum translations that are "too
 * situation-specific": the rendering commits to one narrow reading (a flat
 * "everything is fine") where the English performs a general act (a check-in
 * question, "Everything okay?"). These cases are short, high-frequency English
 * sentences whose FUNCTION is obvious to a native speaker but whose surface
 * form invites a literal or narrowed translation. There is no reference
 * translation; the judge scores against the source plus the one-line
 * `intent` gloss.
 *
 * `register` and `contrast` are controls. A model that fixes speech acts by
 * ignoring the metadata block, or that turns every short sentence into a
 * question, must show up as a loss there.
 *
 * Editing a case's `text` or `metadata` changes its cache key (the harness
 * hashes both), so stale results are never reused. Editing `intent` does
 * not, because only the judge reads it; delete the matching `judge|…` cache
 * entries to re-judge after an intent change.
 */

export type CaseKind =
  | 'speechAct' // statement-shaped question or check-in: must stay a question
  | 'generality' // short formula that must stay as open as the English
  | 'idiomFunction' // conventional formula where the literal reading is wrong
  | 'register' // control: metadata-driven politeness must still be honoured
  | 'contrast'; // control: a genuine statement must stay a statement

export type PragmaticsMetadata = {
  addressesSomeone: boolean;
  speakerGender?: 'male' | 'female' | 'neutral';
  addresseeGender?: 'male' | 'female';
  formality?: 'formal' | 'informal' | 'neutral';
  referentGender: 'male' | 'female';
};

export type PragmaticsCase = {
  id: string;
  kind: CaseKind;
  /** English source, as it would sit in a curriculum collection. */
  text: string;
  /** What the sentence does, in one line. Shown only to the judge. */
  intent: string;
  /** The `<context>` block exactly as the production worker would emit it. */
  metadata: PragmaticsMetadata;
};

/** Spoken to someone, casual register (the prompt's default T-form). */
const spoken: PragmaticsMetadata = {
  addressesSomeone: true,
  speakerGender: 'neutral',
  formality: 'neutral',
  referentGender: 'male',
};

/** Not addressed to anyone in particular; no register block is emitted. */
const said: PragmaticsMetadata = {
  addressesSomeone: false,
  speakerGender: 'neutral',
  referentGender: 'male',
};

export const CASES: PragmaticsCase[] = [
  // ── speechAct ─────────────────────────────────────────────────────────
  {
    id: 'sa-everything-okay',
    kind: 'speechAct',
    text: 'Everything okay?',
    intent:
      'A check-in question: the speaker asks whether the listener is alright or whether things are fine. Must stay a question; must not become a statement that everything is fine.',
    metadata: spoken,
  },
  {
    id: 'sa-you-good',
    kind: 'speechAct',
    text: 'You good?',
    intent:
      'A casual check-in question ("are you okay?", "do you need anything?"). Must stay a question and stay casual; must not become a compliment or a statement.',
    metadata: spoken,
  },
  {
    id: 'sa-everything-all-right',
    kind: 'speechAct',
    text: 'Everything all right with you?',
    intent:
      'A question about the listener’s wellbeing or situation in general. Must stay a question and must not pick one specific worry.',
    metadata: spoken,
  },
  {
    id: 'sa-coming-right',
    kind: 'speechAct',
    text: "You're coming, right?",
    intent:
      'A tag question seeking confirmation that the listener will come (to whatever was planned). Must stay a confirmation-seeking question; the event must not be invented.',
    metadata: spoken,
  },
  {
    id: 'sa-are-you-sure',
    kind: 'speechAct',
    text: 'Are you sure?',
    intent:
      'Asks the listener to confirm they are certain about what they just said or decided. Not about safety.',
    metadata: spoken,
  },
  {
    id: 'sa-how-come',
    kind: 'speechAct',
    text: 'How come?',
    intent:
      'Asks for the reason ("why is that?"). Not about how someone arrived.',
    metadata: spoken,
  },

  // ── generality ────────────────────────────────────────────────────────
  {
    id: 'gen-thats-it',
    kind: 'generality',
    text: "That's it.",
    intent:
      'Signals completion or "that is all there is" (and can also mean "exactly"). Must stay as open as the English; must not become "that is the thing/object".',
    metadata: said,
  },
  {
    id: 'gen-it-happens',
    kind: 'generality',
    text: 'It happens.',
    intent:
      'Consoling: such things happen, no big deal. Must not become "it is happening (right now)".',
    metadata: said,
  },
  {
    id: 'gen-same-here',
    kind: 'generality',
    text: 'Same here.',
    intent:
      'The speaker shares the same state, feeling or opinion ("me too"). Must not invent what is being shared.',
    metadata: spoken,
  },
  {
    id: 'gen-let-me-know',
    kind: 'generality',
    text: 'Let me know.',
    intent:
      'Asks the listener to inform the speaker later (about whatever is at issue). No specific topic may be added.',
    metadata: spoken,
  },
  {
    id: 'gen-on-my-way',
    kind: 'generality',
    text: "I'm on my way.",
    intent:
      'The speaker has set off and is coming. Must not become a literal statement about being on a road, and no destination may be added.',
    metadata: spoken,
  },
  {
    id: 'gen-sounds-good',
    kind: 'generality',
    text: 'Sounds good.',
    intent:
      'Agreement with, or acceptance of, a proposal ("fine by me"). Not about acoustics or music.',
    metadata: spoken,
  },

  // ── idiomFunction ─────────────────────────────────────────────────────
  {
    id: 'idiom-take-care',
    kind: 'idiomFunction',
    text: 'Take care.',
    intent:
      'A parting wish, a farewell. Not an instruction to be careful about something in particular.',
    metadata: spoken,
  },
  {
    id: 'idiom-never-mind',
    kind: 'idiomFunction',
    text: 'Never mind.',
    intent:
      'Retracts or dismisses what was just said ("forget it", "it doesn’t matter"). Not "do not think" and not "do not worry about your problem".',
    metadata: spoken,
  },
  {
    id: 'idiom-ill-pass',
    kind: 'idiomFunction',
    text: "I'll pass.",
    intent:
      'Politely declines an offer or invitation ("no thanks"). Not passing by, passing an exam, or passing something along.',
    metadata: spoken,
  },
  {
    id: 'idiom-you-tell-me',
    kind: 'idiomFunction',
    text: 'You tell me.',
    intent:
      'Turns the question back on the listener: "you would know better than I would" / "I have no idea". Not a request to be told something specific.',
    metadata: spoken,
  },

  // ── register (control) ────────────────────────────────────────────────
  {
    id: 'reg-send-file-formal',
    kind: 'register',
    text: 'Could you send me the file by tomorrow?',
    intent:
      'A polite request to a woman the speaker is formal with. Must use the polite/formal address form and stay a request, not an order.',
    metadata: {
      addressesSomeone: true,
      speakerGender: 'male',
      addresseeGender: 'female',
      formality: 'formal',
      referentGender: 'male',
    },
  },
  {
    id: 'reg-sit-down-informal',
    kind: 'register',
    text: 'Sit down, we need to talk.',
    intent:
      'A casual imperative to a man the speaker is close to, followed by a serious-sounding announcement. Must use the casual address form.',
    metadata: {
      addressesSomeone: true,
      speakerGender: 'female',
      addresseeGender: 'male',
      formality: 'informal',
      referentGender: 'male',
    },
  },

  // ── contrast (control) ────────────────────────────────────────────────
  {
    id: 'con-fine-until-power',
    kind: 'contrast',
    text: 'Everything was fine until the power went out.',
    intent:
      'A narrative statement with a contrast. Must remain a statement; nothing here is a question.',
    metadata: said,
  },
  {
    id: 'con-im-fine-thanks',
    kind: 'contrast',
    text: "I'm fine, thanks.",
    intent:
      'A mild reply to a check-in: the speaker says they are alright. A statement, not a question, and not an enthusiastic "I am great".',
    metadata: spoken,
  },
];
