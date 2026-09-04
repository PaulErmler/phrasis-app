import { encodeWav } from '@/lib/audio/audioWorkerClient';
import type {
  CardAudioRecording,
  CourseSettings,
} from '@/components/app/learning/types';
import {
  DEFAULT_REPETITIONS_BASE,
  DEFAULT_REPETITIONS_TARGET,
  DEFAULT_REPETITIONS_TARGET_BEFORE,
  DEFAULT_REPETITIONS_TARGET_WRITING,
  DEFAULT_PAUSE_BETWEEN_REPETITIONS,
  DEFAULT_AUTO_ADVANCE,
  DEFAULT_PAUSE_BETWEEN_LANGUAGES,
  DEFAULT_PAUSE_BASE_TO_TARGET,
  DEFAULT_PAUSE_TARGET_TO_BASE,
  DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE,
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_PLAY_TARGET_BEFORE_BASE,
  DEFAULT_PLAY_TARGET_AFTER_BASE,
} from '@/lib/constants/audioPlayback';
import {
  computeGain,
  computePeakFromBuffer,
  getDecodeContext,
} from '@/lib/audio/peakCache';
import { timeStretchBuffer } from '@/lib/audio/timeStretch';

export interface ResolvedAudioSettings {
  reps: Record<string, number>;
  repPauses: Record<string, number>;
  speeds: Record<string, number>;
  /**
   * Fallback repetition count for a target language with no stored entry:
   * DEFAULT_REPETITIONS_TARGET in audio mode, once in the writing modes.
   */
  defaultTargetReps: number;
  pauseB2B: number;
  pauseB2T: number;
  pauseT2T: number;
  autoAdvance: boolean;
  pauseBeforeAdvance: number;
  // Target-before-base ("Practice Listening") / target-after-base ("Practice Speaking").
  playTargetBefore: boolean;
  playTargetAfter: boolean;
  // Independent reps/rep-pauses/speeds for the before-base target group.
  beforeReps: Record<string, number>;
  beforeRepPauses: Record<string, number>;
  beforeSpeeds: Record<string, number>;
  // Transition pause between the before-base target group and the base group.
  pauseT2B: number;
  // "Only new" limit: play the before-base target group only on a card's initial
  // N reviews. `Infinity` (the default) = always. Applied per-card via
  // `applyOnlyNewListening` before the merge. `mergeCardAudio` itself ignores it.
  beforeOnlyNewReps: number;
  // Which per-card condition graduates the card out of Practice Listening:
  // 'onlyNew' compares the review count against `beforeOnlyNewReps`,
  // 'untilGood' compares the card's FSRS good/easy count against
  // `beforeUntilGoodReps`, 'continuous' never graduates (Listening plays on
  // every review). Applied via `applyOnlyNewListening`. Docs without a stored
  // strategy resolve via legacy inference. See `resolveAudioSettings`.
  listeningStrategy: 'onlyNew' | 'untilGood' | 'continuous';
  beforeUntilGoodReps: number;
}

/**
 * The per-mode copies a playback setting can have: audio/Shadowing mode owns
 * the unsuffixed field, writing ("full") mode the `*Full` copy, the transcribe
 * writing style the `*Transcribe` copy, and hands-free Radio the `*Radio` copy.
 *
 * The writing modes CHAIN (`*Transcribe ?? *Full ?? unsuffixed`); radio
 * BRANCHES off audio (`*Radio ?? unsuffixed`) and never reads a writing copy.
 * Radio is a `schedulingMode`, not a `reviewMode`, so it is a sibling of audio
 * rather than a step further down the writing chain.
 */
export type AudioSettingsMode = 'audio' | 'full' | 'transcribe' | 'radio';

/**
 * Settings that resolve per mode: every base field name with a `*Full` copy in
 * the schema (the writing chain) OR a `*Radio` copy (the radio branch). The
 * Practice Listening group only ever got `*Radio` twins, so requiring `*Full`
 * would leave those fields uncallable here. A field present on one side but
 * not the other still resolves: the missing variant reads as undefined, which
 * is exactly the fall-through. `hideBaseLanguages` also has a
 * `Full` twin, but that pair is deliberately independent (writing mode
 * defaults per input style, it never falls back to the audio value), so it
 * is excluded from the chain.
 */
export type ModeResolvableSetting = Exclude<
  {
    [K in keyof CourseSettings &
      string]: `${K}Full` extends keyof CourseSettings
      ? K
      : `${K}Radio` extends keyof CourseSettings
        ? K
        : never;
  }[keyof CourseSettings & string],
  'hideBaseLanguages'
>;

/**
 * THE per-mode precedence rule, in one place:
 *
 *   transcribe: `*Transcribe ?? *Full ?? unsuffixed`
 *   full:       `*Full ?? unsuffixed`
 *   radio:      `*Radio ?? unsuffixed`      <- branch, NOT `?? *Full`
 *   audio:      `unsuffixed`
 *
 * Radio deliberately skips the writing copies: it is the hands-free face of
 * audio mode, so borrowing a Writing/Transcribe value would be wrong. Whether
 * radio is asked for at all is the caller's call (it gates on
 * `separateRadioSettings`); this stays a pure precedence rule.
 *
 * Undefined at a level means
 * "same as the mode it falls back to", so unmigrated/untweaked docs
 * behave identically (see docs/migrations/per-mode-settings-backfill.md);
 * a field with no `*Transcribe` copy (base-group pauses, auto-advance pause)
 * resolves like full mode there. Callers apply their own `?? DEFAULT_*`.
 *
 * Both the settings sheet's preview and actual playback resolution
 * (`resolveAudioSettings` below) go through here, so they cannot drift.
 */
export function resolveModeSetting<K extends ModeResolvableSetting>(
  cs: CourseSettings | null | undefined,
  field: K,
  mode: AudioSettingsMode,
): CourseSettings[K] | undefined {
  if (!cs) return undefined;
  // The per-mode copies of a setting share the base field's value type by
  // construction (courseSettingsFields in convex/schema.ts); a copy a field
  // doesn't have reads as undefined, which is exactly the chain's
  // fall-through. The compiler can't see that convention through a computed
  // key, hence the localized cast.
  const variant = (suffix: 'Full' | 'Transcribe' | 'Radio') =>
    (cs as Record<string, unknown>)[`${field}${suffix}`] as
      | CourseSettings[K]
      | undefined;
  if (mode === 'radio') {
    return variant('Radio') ?? cs[field];
  }
  if (mode === 'transcribe') {
    return variant('Transcribe') ?? variant('Full') ?? cs[field];
  }
  if (mode === 'full') {
    return variant('Full') ?? cs[field];
  }
  return cs[field];
}

/**
 * Which copy of the playback settings a LIVE session reads, from the settings
 * doc alone. The counterpart to `resolveModeSetting`: that one owns the
 * precedence rule, this one owns "which mode am I in".
 *
 * Every consumer that renders or plays the current session must go through
 * here — the hook that builds the merged blob, and the view that renders the
 * card. They used to derive it separately, and the card's copy silently kept
 * reading the audio-mode fields after Radio grew its own.
 *
 * The settings SHEET is deliberately not a caller: the copy it edits is chosen
 * by its Review/Radio pill, not by what the user is about to run.
 */
export function resolveSettingsMode(
  cs: CourseSettings | null | undefined,
): AudioSettingsMode {
  // Writing wins over free play: free play while typing is Free Study, a
  // typing session that keeps the writing copies rather than Radio's.
  if ((cs?.reviewMode ?? 'audio') !== 'audio') {
    return (cs?.writingInputMode ?? 'translate') === 'transcribe'
      ? 'transcribe'
      : 'full';
  }
  // Radio: free play's hands-free face, and only while the split is on. Unset
  // means "same as Learn & Review", so untouched docs never move.
  return cs?.schedulingMode === 'radio' && cs?.separateRadioSettings === true
    ? 'radio'
    : 'audio';
}

/**
 * Merge a general per-language speed map with per-card overrides. Overrides win,
 * then the general value, then the global default. Used via `resolveAudioSettings`
 * for both the after-base and before-base target groups.
 */
function mergeSpeeds(
  general: Record<string, number>,
  cardOverrides?: Record<string, number>,
): Record<string, number> {
  const overrides = cardOverrides ?? {};
  const langs = new Set([...Object.keys(general), ...Object.keys(overrides)]);
  const out: Record<string, number> = {};
  for (const lang of langs) {
    out[lang] = overrides[lang] ?? general[lang] ?? DEFAULT_PLAYBACK_SPEED;
  }
  return out;
}

export function resolveAudioSettings(
  cs: CourseSettings | null,
  cardOverrides?: Record<string, number>,
  mode: AudioSettingsMode = 'audio',
): ResolvedAudioSettings {
  // Each mode has its own copy of the playback settings, resolved by
  // `resolveModeSetting` above: the writing modes chain
  // `*Transcribe ?? *Full ?? unsuffixed`, radio branches `*Radio ?? unsuffixed`,
  // and every caller applies its own `?? DEFAULT_*` here.
  const autoAdvance = cs?.autoAdvance ?? DEFAULT_AUTO_ADVANCE;
  // Practice Listening graduation, resolved once per mode: the legacy strategy
  // inference below consults the same rep window.
  const onlyNewReps = resolveModeSetting(cs, 'targetBeforeOnlyNewReps', mode);
  const untilGoodReps = resolveModeSetting(
    cs,
    'targetBeforeUntilGoodReps',
    mode,
  );
  return {
    reps: resolveModeSetting(cs, 'languageRepetitions', mode) ?? {},
    repPauses: resolveModeSetting(cs, 'languageRepetitionPauses', mode) ?? {},
    speeds: mergeSpeeds(
      resolveModeSetting(cs, 'languagePlaybackSpeeds', mode) ?? {},
      cardOverrides,
    ),
    // Radio is the hands-free face of audio mode, so it keeps the audio
    // fallback (2). Only the writing modes drop to one play.
    defaultTargetReps:
      mode === 'audio' || mode === 'radio'
        ? DEFAULT_REPETITIONS_TARGET
        : DEFAULT_REPETITIONS_TARGET_WRITING,
    pauseB2B:
      resolveModeSetting(cs, 'pauseBaseToBase', mode) ??
      DEFAULT_PAUSE_BETWEEN_LANGUAGES,
    pauseB2T:
      resolveModeSetting(cs, 'pauseBaseToTarget', mode) ??
      DEFAULT_PAUSE_BASE_TO_TARGET,
    pauseT2T:
      resolveModeSetting(cs, 'pauseTargetToTarget', mode) ??
      DEFAULT_PAUSE_BETWEEN_LANGUAGES,
    autoAdvance,
    pauseBeforeAdvance:
      resolveModeSetting(cs, 'pauseBeforeAutoAdvance', mode) ??
      DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE,
    playTargetBefore:
      resolveModeSetting(cs, 'playTargetBeforeBase', mode) ??
      DEFAULT_PLAY_TARGET_BEFORE_BASE,
    playTargetAfter:
      resolveModeSetting(cs, 'playTargetAfterBase', mode) ??
      DEFAULT_PLAY_TARGET_AFTER_BASE,
    beforeReps: resolveModeSetting(cs, 'targetBeforeRepetitions', mode) ?? {},
    beforeRepPauses:
      resolveModeSetting(cs, 'targetBeforeRepetitionPauses', mode) ?? {},
    // Card-level speed overrides apply to the before-base group too (same language).
    beforeSpeeds: mergeSpeeds(
      resolveModeSetting(cs, 'targetBeforePlaybackSpeeds', mode) ?? {},
      cardOverrides,
    ),
    pauseT2B:
      resolveModeSetting(cs, 'pauseTargetToBase', mode) ??
      DEFAULT_PAUSE_TARGET_TO_BASE,
    // Stored 0 / undefined means "always" (∞); 1-10 limits to that many initial reviews.
    beforeOnlyNewReps: onlyNewReps && onlyNewReps > 0 ? onlyNewReps : Infinity,
    // Legacy inference: docs from before the strategy field encode
    // "continuously" as onlyNewReps 0/undefined (the old ∞ position). A
    // stored strategy always wins; without one, a positive rep window means
    // 'onlyNew' and anything else means 'continuous'. Behavior-identical to
    // the pre-strategy resolution, so old docs never change behavior.
    listeningStrategy:
      resolveModeSetting(cs, 'targetBeforeListeningStrategy', mode) ??
      (onlyNewReps && onlyNewReps > 0 ? 'onlyNew' : 'continuous'),
    // Forked per mode like the rest of the group. Radio plays can't advance a
    // card's good-rating count, but the count it already carries still
    // graduates it here, so radio needs its own window rather than silently
    // inheriting Learn & Review's. See applyOnlyNewListening.
    beforeUntilGoodReps: untilGoodReps && untilGoodReps > 0 ? untilGoodReps : 1,
  };
}

/**
 * Apply the "Only new" limit for a single card. With BOTH Practice Listening
 * (before-base) and Practice Speaking (after-base) on, Practice Listening plays
 * only on a card's initial `beforeOnlyNewReps` reviews; once the card has been
 * reviewed at least that many times it graduates to Practice Speaking alone.
 *
 * `reviewCount` is the card's active-review count (preReviewCount + FSRS reps).
 * In radio mode also pass `radioReviewCount` (the card's radioPlayCount):
 * radio plays don't bump the active-review count, so we take the max of the two
 * to decide whether the card is still "new".
 *
 * "Only new" only makes sense when there's a Practice Speaking flow to graduate
 * into, so it no-ops (treated as `Infinity`, Practice Listening always plays)
 * when Practice Speaking is off, when Practice Listening is off, or when the
 * limit is `Infinity` (the default). On graduation it disables `playTargetBefore`;
 * `playTargetAfter` is already on, so the card switches to Practice Speaking.
 */
export function applyOnlyNewListening(
  settings: ResolvedAudioSettings,
  opts: {
    reviewCount: number;
    radioReviewCount?: number;
    /** The card's FSRS good/easy count, consulted by the 'untilGood' strategy. */
    goodReviewCount?: number;
  },
): ResolvedAudioSettings {
  if (!settings.playTargetBefore || !settings.playTargetAfter) {
    return settings;
  }
  // 'continuous': Listening never graduates. Every card, every review.
  if (settings.listeningStrategy === 'continuous') return settings;
  if (settings.listeningStrategy === 'untilGood') {
    // Radio never rates cards, so radio plays can't graduate a card here.
    // Deliberate: without ratings there's no "rated good" signal.
    if ((opts.goodReviewCount ?? 0) < settings.beforeUntilGoodReps) {
      return settings;
    }
    return { ...settings, playTargetBefore: false };
  }
  if (settings.beforeOnlyNewReps === Infinity) return settings;
  const count =
    opts.radioReviewCount != null
      ? Math.max(opts.reviewCount, opts.radioReviewCount)
      : opts.reviewCount;
  if (count < settings.beforeOnlyNewReps) return settings;
  return { ...settings, playTargetBefore: false };
}

export interface LanguageCue {
  language: string;
  startSec: number;
  /**
   * Effective speed this clip was time-stretched to. Carried per-cue (not just
   * per-language) because the same language can appear in both the before- and
   * after-base target groups at different speeds. Word-highlight consumers scale
   * merged-clip `localTime` by this value to reach the original (1×) frame.
   * Optional so callers/tests constructing cues by hand can omit it; consumers
   * fall back to the per-language speed map then 1×.
   */
  speed?: number;
  /**
   * Whether reaching this cue should un-blur the language's text. Defaults to
   * true. Set false for before-base ("Practice Listening") target cues when the
   * same language also plays after base, so only the after-base playback reveals
   * the blurred target text. Omitted (undefined) is treated as revealing.
   */
  reveals?: boolean;
  /**
   * True for a placeholder cue standing in for a language whose repetitions are
   * set to 0. It marks the point on the timeline where the clip *would* have
   * started, so auto-reveal still un-blurs the text on schedule, but there is no
   * audio behind it and it occupies no time. Consumers that resolve a *clip
   * position* (word highlighting, progress ticks, seek targets) must skip it.
   * Call `audibleCues` rather than testing the flag by hand; the reveal path
   * must not skip it.
   */
  silent?: boolean;
}

/** A cue with real audio behind it. See `audibleCues`. */
export type AudibleCue = LanguageCue & { silent?: false };

/**
 * Drop the silent placeholders, leaving only cues that have a clip behind them.
 *
 * Every consumer that maps a timeline position onto a *clip* (word highlighting,
 * progress-bar ticks, resume-position capture) must start here: a silent cue
 * marks where a zero-repetition language would have played, so resolving a
 * position against it latches onto a language that made no sound. Centralised so
 * a new consumer inherits the rule instead of having to remember it. The reveal
 * path deliberately does not use this. Silent cues exist to un-blur text.
 */
export function audibleCues(cues: ReadonlyArray<LanguageCue>): AudibleCue[] {
  return cues.filter((c): c is AudibleCue => !c.silent);
}

export interface MergeResult {
  blobUrl: string;
  durationSec: number;
  languageCues: LanguageCue[];
  /**
   * Effective speed applied to each language's clips when rendering this merge.
   * Consumers that look up word timings against merged-clip `localTime` must
   * scale by this value, because stretched-clip time is `originalTime / speed`
   * while word timings remain in the original (1×) frame.
   */
  speedByLanguage: Record<string, number>;
}

/**
 * Merge all audio clips for a card into a single continuous WAV blob.
 *
 * Fetches each unique audio URL, decodes it, then schedules clips and silence
 * into an OfflineAudioContext matching the playback sequence defined by the
 * user's settings (repetitions, pauses between languages, etc.).
 */
export async function mergeCardAudio(
  audioRecordings: CardAudioRecording[],
  orderedBase: string[],
  orderedTarget: string[],
  settings: ResolvedAudioSettings,
  signal?: AbortSignal,
): Promise<MergeResult | null> {
  const ctx = getDecodeContext();

  try {
    // --- 1. Collect entries with their resolved repetition counts ---
    type AudibleEntry = {
      language: string;
      url: string;
      reps: number;
      speed: number;
      silent?: false;
    };
    /**
     * A language the user muted by setting its repetitions to 0. It keeps its
     * slot in the sequence but schedules no clip: the auto-reveal ("Hide target
     * / base languages") is driven entirely by cues, so dropping the language
     * outright would leave its text blurred for the whole card with no way back
     * except tapping it.
     */
    type SilentEntry = {
      language: string;
      url: null;
      reps: 0;
      speed: number;
      silent: true;
    };
    type Entry = AudibleEntry | SilentEntry;

    const baseEntries: Entry[] = [];
    // Target language(s) can play before base ("Practice Listening") and/or
    // after base ("Practice Speaking"), each group with its own reps/speeds.
    const beforeTargetEntries: Entry[] = [];
    const afterTargetEntries: Entry[] = [];

    const speedFor = (lang: string) =>
      settings.speeds[lang] ?? DEFAULT_PLAYBACK_SPEED;
    const beforeSpeedFor = (lang: string) =>
      settings.beforeSpeeds[lang] ?? DEFAULT_PLAYBACK_SPEED;

    // Repetitions at 0 keep their slot as a silent entry (see SilentEntry); a
    // language with no playable recording is still dropped entirely, as before.
    const collect = (
      out: Entry[],
      language: string,
      reps: number,
      speed: number,
    ) => {
      if (reps <= 0) {
        out.push({ language, url: null, reps: 0, speed, silent: true });
        return;
      }
      const url = audioRecordings.find((a) => a.language === language)?.url;
      if (url) out.push({ language, url, reps, speed });
    };

    for (const lang of orderedBase) {
      collect(
        baseEntries,
        lang,
        settings.reps[lang] ?? DEFAULT_REPETITIONS_BASE,
        speedFor(lang),
      );
    }
    if (settings.playTargetBefore) {
      for (const lang of orderedTarget) {
        collect(
          beforeTargetEntries,
          lang,
          settings.beforeReps[lang] ?? DEFAULT_REPETITIONS_TARGET_BEFORE,
          beforeSpeedFor(lang),
        );
      }
    }
    if (settings.playTargetAfter) {
      for (const lang of orderedTarget) {
        collect(
          afterTargetEntries,
          lang,
          settings.reps[lang] ?? settings.defaultTargetReps,
          speedFor(lang),
        );
      }
    }

    // Languages that play after base. A before-base cue for one of these does
    // NOT reveal the blurred text, only the later, after-base play does. Silent
    // after-base entries count: when the user zeroes the after-base reps the
    // reveal still belongs at the after-base slot, preserving the
    // listen-then-guess-then-see flow of "Practice Listening".
    const afterLangs = new Set(afterTargetEntries.map((e) => e.language));

    const allEntries = [
      ...beforeTargetEntries,
      ...baseEntries,
      ...afterTargetEntries,
    ];
    if (allEntries.length === 0) return null;

    // --- 2. Fetch & decode unique URLs in parallel ---
    // Silent entries have no clip to fetch, decode or stretch.
    const audibleEntries = allEntries.filter(
      (e): e is AudibleEntry => !e.silent,
    );
    const uniqueUrls = [...new Set(audibleEntries.map((e) => e.url))];
    const decoded = new Map<string, AudioBuffer>();

    await Promise.all(
      uniqueUrls.map(async (url) => {
        const res = await fetch(url);
        if (signal?.aborted) return;
        if (!res.ok)
          throw new Error(
            `Audio fetch failed: ${res.status} ${res.statusText} for ${url}`,
          );
        const arrayBuf = await res.arrayBuffer();
        if (signal?.aborted) return;
        const audioBuf = await ctx.decodeAudioData(arrayBuf);
        decoded.set(url, audioBuf);
        computePeakFromBuffer(audioBuf, url);
      }),
    );

    if (signal?.aborted) return null;

    // --- 2b. Time-stretch per (url, speed) combination ---
    // Each (clip URL, effective speed) pair is stretched once and cached by
    // timeStretchBuffer, so identical combos across reps or cards are reused.
    // `speed === 1` returns the original buffer. Zero overhead in the common case.
    type StretchKey = string;
    const stretchKey = (url: string, speed: number): StretchKey =>
      `${url}|${speed.toFixed(3)}`;
    const stretched = new Map<StretchKey, AudioBuffer>();
    const uniqueCombos = new Map<StretchKey, { url: string; speed: number }>();
    for (const e of audibleEntries)
      uniqueCombos.set(stretchKey(e.url, e.speed), {
        url: e.url,
        speed: e.speed,
      });

    await Promise.all(
      [...uniqueCombos.values()].map(async ({ url, speed }) => {
        const src = decoded.get(url);
        if (!src) return;
        const out = await timeStretchBuffer(src, speed, url);
        stretched.set(stretchKey(url, speed), out);
      }),
    );

    if (signal?.aborted) return null;

    // --- 3. Compute total duration and schedule offsets ---
    const repPause = (lang: string) =>
      settings.repPauses[lang] ?? DEFAULT_PAUSE_BETWEEN_REPETITIONS;
    const beforeRepPause = (lang: string) =>
      settings.beforeRepPauses[lang] ?? DEFAULT_PAUSE_BETWEEN_REPETITIONS;

    type ScheduledClip = {
      buffer: AudioBuffer;
      startSec: number;
      gain: number;
    };
    const clips: ScheduledClip[] = [];
    const languageCues: LanguageCue[] = [];
    const speedByLanguage: Record<string, number> = {};
    let cursor = 0; // seconds

    const scheduleGroup = (
      entries: Entry[],
      pauseBetweenLanguages: number,
      repPauseFor: (lang: string) => number,
      revealsFor: (lang: string) => boolean = () => true,
    ) => {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const reveals = revealsFor(entry.language);

        if (entry.silent) {
          // One cue at the moment the first repetition would have begun, so the
          // text un-blurs on schedule, then straight on to the next language. No
          // clip, no rep pauses (0 repetitions have no gaps between them), and
          // deliberately no `speedByLanguage` entry, nothing was stretched for
          // this language, and a phantom one would shadow the real per-cue speed
          // of a language that also plays in the other group.
          languageCues.push({
            language: entry.language,
            startSec: cursor,
            speed: entry.speed,
            reveals,
            silent: true,
          });
        } else {
          const originalBuffer = decoded.get(entry.url);
          const buffer = stretched.get(stretchKey(entry.url, entry.speed));
          if (!buffer || !originalBuffer) continue;
          // Gain is computed from the original buffer. Time-stretching preserves
          // amplitude envelope but we key the peak cache on the source URL anyway.
          const peak = computePeakFromBuffer(originalBuffer, entry.url);
          const gain = computeGain(peak);
          speedByLanguage[entry.language] = entry.speed;

          for (let r = 0; r < entry.reps; r++) {
            languageCues.push({
              language: entry.language,
              startSec: cursor,
              speed: entry.speed,
              reveals,
            });
            clips.push({ buffer, startSec: cursor, gain });
            cursor += buffer.duration;
            if (r < entry.reps - 1) {
              cursor += repPauseFor(entry.language);
            }
          }
        }

        if (i < entries.length - 1) {
          cursor += pauseBetweenLanguages;
        }
      }
    };

    // Base is part of the composition whenever base languages are ordered, even
    // if none of them plays (reps zeroed, or no playable recordings): the group
    // keeps its place in the sequence so the pauses around it, which the user
    // still sees in settings. Play as silence instead of vanishing. orderedBase
    // is empty only when base is deliberately excluded (e.g. transcribe mode);
    // there, no phantom pauses are added.
    const baseInComposition = orderedBase.length > 0;

    // Sequence: [before-target] → base → [after-target]. The pause-before-advance
    // is always appended last (after whatever final group exists), so auto-advance
    // works identically whether or not "Practice Speaking" (after) is enabled.
    if (beforeTargetEntries.length > 0) {
      // Before-base target reveals its text only when it isn't replayed after
      // base, when both groups are on, the after-base play owns the reveal.
      scheduleGroup(
        beforeTargetEntries,
        settings.pauseT2T,
        beforeRepPause,
        (lang) => !afterLangs.has(lang),
      );
      if (baseInComposition) {
        cursor += settings.pauseT2B;
      } else if (afterTargetEntries.length > 0) {
        // No base in the composition between the two target groups. Separate
        // them with the target↔target pause so the before/after plays don't
        // butt together with zero silence.
        cursor += settings.pauseT2T;
      }
    }

    scheduleGroup(baseEntries, settings.pauseB2B, repPause);

    if (baseInComposition && afterTargetEntries.length > 0) {
      cursor += settings.pauseB2T;
    }

    scheduleGroup(afterTargetEntries, settings.pauseT2T, repPause);

    if (settings.autoAdvance) {
      cursor += settings.pauseBeforeAdvance;
    }

    const totalDuration = cursor;
    // A composition with nothing audible is still a real timeline: the pauses
    // play as silence and the placeholder cues fire their auto-reveals at the
    // offsets the clips would have occupied, so the silence is worth rendering.
    // Only a genuinely empty timeline, nothing audible AND no pauses. Has
    // nothing to play and nothing to reveal along.
    if (totalDuration <= 0) return null;

    // --- 4. Render with OfflineAudioContext ---
    // Match the decoded clips' rate; a fully silent render decodes nothing and
    // has no rate to match, so fall back to the shared decode context's.
    const sampleRate =
      decoded.values().next().value?.sampleRate ?? ctx.sampleRate;
    const totalSamples = Math.ceil(totalDuration * sampleRate);
    const offline = new OfflineAudioContext(1, totalSamples, sampleRate);

    for (const clip of clips) {
      const source = offline.createBufferSource();
      source.buffer = clip.buffer;
      const gainNode = offline.createGain();
      gainNode.gain.value = clip.gain;
      source.connect(gainNode);
      gainNode.connect(offline.destination);
      source.start(clip.startSec);
    }

    if (signal?.aborted) return null;

    const rendered = await offline.startRendering();

    if (signal?.aborted) return null;

    // --- 5. Encode to WAV (in the audio worker when available) ---
    const wavData = await encodeWav(rendered);

    if (signal?.aborted) return null;

    const blob = new Blob([wavData], { type: 'audio/wav' });
    const blobUrl = URL.createObjectURL(blob);

    return {
      blobUrl,
      durationSec: totalDuration,
      languageCues,
      speedByLanguage,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}
