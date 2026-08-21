/**
 * Hand-written types for @echogarden/espeak-ng-emscripten, which ships none.
 * Covers only the surface convex/features/ipa.ts touches (voice selection +
 * IPA synthesis + voice listing).
 */
declare module '@echogarden/espeak-ng-emscripten' {
  export interface EspeakVoiceLanguage {
    priority: number;
    name: string;
  }

  export interface EspeakVoice {
    name: string;
    identifier: string;
    languages: EspeakVoiceLanguage[];
  }

  export interface EspeakNgWorkerInstance {
    set_voice(identifier: string): void;
    /** IPA with `_` phoneme separators and one clause per line. */
    synthesize_ipa(text: string): { code: number; ipa: string };
    list_voices(): EspeakVoice[];
  }

  export interface EspeakNgModule {
    eSpeakNGWorker: new () => EspeakNgWorkerInstance;
  }

  /** Emscripten factory; resolves once the runtime + data bundle are ready. */
  export default function init(): Promise<EspeakNgModule>;
}
