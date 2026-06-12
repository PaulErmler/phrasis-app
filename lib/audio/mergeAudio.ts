import toWav from 'audiobuffer-to-wav';
import type { CardAudioRecording, CourseSettings } from '@/components/app/learning/types';
import {
  DEFAULT_REPETITIONS_BASE,
  DEFAULT_REPETITIONS_TARGET,
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
  // `applyOnlyNewListening` before the merge — `mergeCardAudio` itself ignores it.
  beforeOnlyNewReps: number;
}

/**
 * Resolve the per-language playback speed for a card, applying the per-card
 * override when present and falling back to the course-level general speed.
 */
export function resolveLanguageSpeeds(
  cs: CourseSettings | null,
  cardOverrides?: Record<string, number>,
): Record<string, number> {
  return mergeSpeeds(cs?.languagePlaybackSpeeds ?? {}, cardOverrides);
}

/**
 * Merge a general per-language speed map with per-card overrides. Overrides win,
 * then the general value, then the global default. Used for both the after-base
 * target group (via `resolveLanguageSpeeds`) and the before-base target group.
 */
function mergeSpeeds(
  general: Record<string, number>,
  cardOverrides?: Record<string, number>,
): Record<string, number> {
  const overrides = cardOverrides ?? {};
  const langs = new Set([
    ...Object.keys(general),
    ...Object.keys(overrides),
  ]);
  const out: Record<string, number> = {};
  for (const lang of langs) {
    out[lang] = overrides[lang] ?? general[lang] ?? DEFAULT_PLAYBACK_SPEED;
  }
  return out;
}

export function resolveAudioSettings(
  cs: CourseSettings | null,
  cardOverrides?: Record<string, number>,
): ResolvedAudioSettings {
  const autoAdvance = cs?.autoAdvance ?? DEFAULT_AUTO_ADVANCE;
  return {
    reps: cs?.languageRepetitions ?? {},
    repPauses: cs?.languageRepetitionPauses ?? {},
    speeds: resolveLanguageSpeeds(cs, cardOverrides),
    pauseB2B: cs?.pauseBaseToBase ?? DEFAULT_PAUSE_BETWEEN_LANGUAGES,
    pauseB2T: cs?.pauseBaseToTarget ?? DEFAULT_PAUSE_BASE_TO_TARGET,
    pauseT2T: cs?.pauseTargetToTarget ?? DEFAULT_PAUSE_BETWEEN_LANGUAGES,
    autoAdvance,
    pauseBeforeAdvance: cs?.pauseBeforeAutoAdvance ?? DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE,
    playTargetBefore: cs?.playTargetBeforeBase ?? DEFAULT_PLAY_TARGET_BEFORE_BASE,
    playTargetAfter: cs?.playTargetAfterBase ?? DEFAULT_PLAY_TARGET_AFTER_BASE,
    beforeReps: cs?.targetBeforeRepetitions ?? {},
    beforeRepPauses: cs?.targetBeforeRepetitionPauses ?? {},
    // Card-level speed overrides apply to the before-base group too (same language).
    beforeSpeeds: mergeSpeeds(cs?.targetBeforePlaybackSpeeds ?? {}, cardOverrides),
    pauseT2B: cs?.pauseTargetToBase ?? DEFAULT_PAUSE_TARGET_TO_BASE,
    // Stored 0 / undefined means "always" (∞); 1-10 limits to that many initial reviews.
    beforeOnlyNewReps:
      cs?.targetBeforeOnlyNewReps && cs.targetBeforeOnlyNewReps > 0
        ? cs.targetBeforeOnlyNewReps
        : Infinity,
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
 * into, so it no-ops (treated as `Infinity` — Practice Listening always plays)
 * when Practice Speaking is off, when Practice Listening is off, or when the
 * limit is `Infinity` (the default). On graduation it disables `playTargetBefore`;
 * `playTargetAfter` is already on, so the card switches to Practice Speaking.
 */
export function applyOnlyNewListening(
  settings: ResolvedAudioSettings,
  opts: { reviewCount: number; radioReviewCount?: number },
): ResolvedAudioSettings {
  if (
    !settings.playTargetBefore ||
    !settings.playTargetAfter ||
    settings.beforeOnlyNewReps === Infinity
  ) {
    return settings;
  }
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
    type Entry = { language: string; url: string; reps: number; speed: number };

    const baseEntries: Entry[] = [];
    // Target language(s) can play before base ("Practice Listening") and/or
    // after base ("Practice Speaking"), each group with its own reps/speeds.
    const beforeTargetEntries: Entry[] = [];
    const afterTargetEntries: Entry[] = [];

    const speedFor = (lang: string) =>
      settings.speeds[lang] ?? DEFAULT_PLAYBACK_SPEED;
    const beforeSpeedFor = (lang: string) =>
      settings.beforeSpeeds[lang] ?? DEFAULT_PLAYBACK_SPEED;

    for (const lang of orderedBase) {
      const reps = settings.reps[lang] ?? DEFAULT_REPETITIONS_BASE;
      if (reps <= 0) continue;
      const rec = audioRecordings.find((a) => a.language === lang);
      if (rec?.url) baseEntries.push({ language: lang, url: rec.url, reps, speed: speedFor(lang) });
    }
    if (settings.playTargetBefore) {
      for (const lang of orderedTarget) {
        const reps = settings.beforeReps[lang] ?? DEFAULT_REPETITIONS_TARGET;
        if (reps <= 0) continue;
        const rec = audioRecordings.find((a) => a.language === lang);
        if (rec?.url) beforeTargetEntries.push({ language: lang, url: rec.url, reps, speed: beforeSpeedFor(lang) });
      }
    }
    if (settings.playTargetAfter) {
      for (const lang of orderedTarget) {
        const reps = settings.reps[lang] ?? DEFAULT_REPETITIONS_TARGET;
        if (reps <= 0) continue;
        const rec = audioRecordings.find((a) => a.language === lang);
        if (rec?.url) afterTargetEntries.push({ language: lang, url: rec.url, reps, speed: speedFor(lang) });
      }
    }

    const allEntries = [...beforeTargetEntries, ...baseEntries, ...afterTargetEntries];
    if (allEntries.length === 0) return null;

    // --- 2. Fetch & decode unique URLs in parallel ---
    const uniqueUrls = [...new Set(allEntries.map((e) => e.url))];
    const decoded = new Map<string, AudioBuffer>();

    await Promise.all(
      uniqueUrls.map(async (url) => {
        const res = await fetch(url);
        if (signal?.aborted) return;
        if (!res.ok) throw new Error(`Audio fetch failed: ${res.status} ${res.statusText} for ${url}`);
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
    // `speed === 1` returns the original buffer — zero overhead in the common case.
    type StretchKey = string;
    const stretchKey = (url: string, speed: number): StretchKey =>
      `${url}|${speed.toFixed(3)}`;
    const stretched = new Map<StretchKey, AudioBuffer>();
    const uniqueCombos = new Map<StretchKey, { url: string; speed: number }>();
    for (const e of allEntries) uniqueCombos.set(stretchKey(e.url, e.speed), { url: e.url, speed: e.speed });

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

    type ScheduledClip = { buffer: AudioBuffer; startSec: number; gain: number };
    const clips: ScheduledClip[] = [];
    const languageCues: LanguageCue[] = [];
    const speedByLanguage: Record<string, number> = {};
    let cursor = 0; // seconds

    // Languages that play after base. A before-base cue for one of these does
    // NOT reveal the blurred text — only the later, after-base play does.
    const afterLangs = new Set(afterTargetEntries.map((e) => e.language));

    const scheduleGroup = (
      entries: Entry[],
      pauseBetweenLanguages: number,
      repPauseFor: (lang: string) => number,
      revealsFor: (lang: string) => boolean = () => true,
    ) => {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const originalBuffer = decoded.get(entry.url);
        const buffer = stretched.get(stretchKey(entry.url, entry.speed));
        if (!buffer || !originalBuffer) continue;
        // Gain is computed from the original buffer — time-stretching preserves
        // amplitude envelope but we key the peak cache on the source URL anyway.
        const peak = computePeakFromBuffer(originalBuffer, entry.url);
        const gain = computeGain(peak);
        speedByLanguage[entry.language] = entry.speed;
        const reveals = revealsFor(entry.language);

        for (let r = 0; r < entry.reps; r++) {
          languageCues.push({ language: entry.language, startSec: cursor, speed: entry.speed, reveals });
          clips.push({ buffer, startSec: cursor, gain });
          cursor += buffer.duration;
          if (r < entry.reps - 1) {
            cursor += repPauseFor(entry.language);
          }
        }

        if (i < entries.length - 1) {
          cursor += pauseBetweenLanguages;
        }
      }
    };

    // Sequence: [before-target] → base → [after-target]. The pause-before-advance
    // is always appended last (after whatever final group exists), so auto-advance
    // works identically whether or not "Practice Speaking" (after) is enabled.
    if (beforeTargetEntries.length > 0) {
      // Before-base target reveals its text only when it isn't replayed after
      // base — when both groups are on, the after-base play owns the reveal.
      scheduleGroup(
        beforeTargetEntries,
        settings.pauseT2T,
        beforeRepPause,
        (lang) => !afterLangs.has(lang),
      );
      if (baseEntries.length > 0) {
        cursor += settings.pauseT2B;
      } else if (afterTargetEntries.length > 0) {
        // No base between the two target groups (e.g. all base reps zeroed) —
        // separate them with the target↔target pause so the before/after plays
        // don't butt together with zero silence.
        cursor += settings.pauseT2T;
      }
    }

    scheduleGroup(baseEntries, settings.pauseB2B, repPause);

    if (baseEntries.length > 0 && afterTargetEntries.length > 0) {
      cursor += settings.pauseB2T;
    }

    scheduleGroup(afterTargetEntries, settings.pauseT2T, repPause);

    if (settings.autoAdvance) {
      cursor += settings.pauseBeforeAdvance;
    }

    const totalDuration = cursor;
    if (totalDuration <= 0 || clips.length === 0) return null;

    // --- 4. Render with OfflineAudioContext ---
    const sampleRate = decoded.values().next().value!.sampleRate;
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

    // --- 5. Encode to WAV and create blob URL ---
    const blob = new Blob([toWav(rendered)], { type: 'audio/wav' });
    const blobUrl = URL.createObjectURL(blob);

    return { blobUrl, durationSec: totalDuration, languageCues, speedByLanguage };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}
