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
} from '@/lib/constants/audioPlayback';

export interface ResolvedAudioSettings {
  reps: Record<string, number>;
  repPauses: Record<string, number>;
  pauseB2B: number;
  pauseB2T: number;
  pauseT2T: number;
  autoAdvance: boolean;
  pauseBeforeAdvance: number;
}

export function resolveAudioSettings(cs: CourseSettings | null): ResolvedAudioSettings {
  const autoAdvance = cs?.autoAdvance ?? DEFAULT_AUTO_ADVANCE;
  return {
    reps: cs?.languageRepetitions ?? {},
    repPauses: cs?.languageRepetitionPauses ?? {},
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
}

/**
 * Merge all audio clips for a card into a single continuous WAV blob.
 *
 * Fetches each unique audio URL, decodes it, then schedules clips and silence
 * into an OfflineAudioContext matching the playback sequence defined by the
 * user's settings (repetitions, pauses between languages, etc.).
 */
let sharedCtx: AudioContext | null = null;

function getDecodeContext(): AudioContext {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AudioContext();
  }
  return sharedCtx;
}

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
    type Entry = { language: string; url: string; reps: number };

    const baseEntries: Entry[] = [];
    const targetEntries: Entry[] = [];

    for (const lang of orderedBase) {
      const reps = settings.reps[lang] ?? DEFAULT_REPETITIONS_BASE;
      if (reps <= 0) continue;
      const rec = audioRecordings.find((a) => a.language === lang);
      if (rec?.url) baseEntries.push({ language: lang, url: rec.url, reps });
    }
    for (const lang of orderedTarget) {
      const reps = settings.reps[lang] ?? DEFAULT_REPETITIONS_TARGET;
      if (reps <= 0) continue;
      const rec = audioRecordings.find((a) => a.language === lang);
      if (rec?.url) targetEntries.push({ language: lang, url: rec.url, reps });
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
      }),
    );

    if (signal?.aborted) return null;

    // --- 3. Compute total duration and schedule offsets ---
    const repPause = (lang: string) =>
      settings.repPauses[lang] ?? DEFAULT_PAUSE_BETWEEN_REPETITIONS;

    type ScheduledClip = { buffer: AudioBuffer; startSec: number };
    const clips: ScheduledClip[] = [];
    const languageCues: LanguageCue[] = [];
    let cursor = 0; // seconds

    const scheduleGroup = (
      entries: Entry[],
      pauseBetweenLanguages: number,
    ) => {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const buffer = decoded.get(entry.url);
        if (!buffer) continue;

        languageCues.push({ language: entry.language, startSec: cursor });

        for (let r = 0; r < entry.reps; r++) {
          clips.push({ buffer, startSec: cursor });
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
      source.connect(offline.destination);
      source.start(clip.startSec);
    }

    if (signal?.aborted) return null;

    const rendered = await offline.startRendering();

    if (signal?.aborted) return null;

    // --- 5. Encode to WAV and create blob URL ---
    const blob = new Blob([toWav(rendered)], { type: 'audio/wav' });
    const blobUrl = URL.createObjectURL(blob);

    return { blobUrl, durationSec: totalDuration, languageCues };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}
