import toWav from 'audiobuffer-to-wav';
import type { CardAudioRecording, CourseSettings } from '@/components/app/learning/types';
import {
  DEFAULT_REPETITIONS_BASE,
  DEFAULT_REPETITIONS_TARGET,
  DEFAULT_PAUSE_BETWEEN_REPETITIONS,
  DEFAULT_AUTO_ADVANCE,
  DEFAULT_PAUSE_BETWEEN_LANGUAGES,
  DEFAULT_PAUSE_BASE_TO_TARGET,
  DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE,
  DEFAULT_PLAYBACK_SPEED,
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
}

/**
 * Resolve the per-language playback speed for a card, applying the per-card
 * override when present and falling back to the course-level general speed.
 */
export function resolveLanguageSpeeds(
  cs: CourseSettings | null,
  cardOverrides?: Record<string, number>,
): Record<string, number> {
  const general = cs?.languagePlaybackSpeeds ?? {};
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
  };
}

export interface LanguageCue {
  language: string;
  startSec: number;
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
    const targetEntries: Entry[] = [];

    const speedFor = (lang: string) =>
      settings.speeds[lang] ?? DEFAULT_PLAYBACK_SPEED;

    for (const lang of orderedBase) {
      const reps = settings.reps[lang] ?? DEFAULT_REPETITIONS_BASE;
      if (reps <= 0) continue;
      const rec = audioRecordings.find((a) => a.language === lang);
      if (rec?.url) baseEntries.push({ language: lang, url: rec.url, reps, speed: speedFor(lang) });
    }
    for (const lang of orderedTarget) {
      const reps = settings.reps[lang] ?? DEFAULT_REPETITIONS_TARGET;
      if (reps <= 0) continue;
      const rec = audioRecordings.find((a) => a.language === lang);
      if (rec?.url) targetEntries.push({ language: lang, url: rec.url, reps, speed: speedFor(lang) });
    }

    const allEntries = [...baseEntries, ...targetEntries];
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

    type ScheduledClip = { buffer: AudioBuffer; startSec: number; gain: number };
    const clips: ScheduledClip[] = [];
    const languageCues: LanguageCue[] = [];
    const speedByLanguage: Record<string, number> = {};
    let cursor = 0; // seconds

    const scheduleGroup = (
      entries: Entry[],
      pauseBetweenLanguages: number,
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

        for (let r = 0; r < entry.reps; r++) {
          languageCues.push({ language: entry.language, startSec: cursor });
          clips.push({ buffer, startSec: cursor, gain });
          cursor += buffer.duration;
          if (r < entry.reps - 1) {
            cursor += repPause(entry.language);
          }
        }

        if (i < entries.length - 1) {
          cursor += pauseBetweenLanguages;
        }
      }
    };

    scheduleGroup(baseEntries, settings.pauseB2B);

    if (baseEntries.length > 0 && targetEntries.length > 0) {
      cursor += settings.pauseB2T;
    }

    scheduleGroup(targetEntries, settings.pauseT2T);

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
