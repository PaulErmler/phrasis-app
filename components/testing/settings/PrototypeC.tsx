'use client';

/**
 * Prototype C: Tabbed Approach
 *
 * Cleanly separates settings into two tabs:
 *   1. "Playback" tab: toggles + per-language play counts (compact table)
 *   2. "Timing" tab: ALL pauses in a single, organized view with
 *      per-language repetition pauses and global pauses.
 */

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { getLanguageByCode } from '@/lib/languages';
import {
  DEFAULT_AUTO_PLAY,
  DEFAULT_AUTO_ADVANCE,
  DEFAULT_REPETITIONS_BASE,
  DEFAULT_REPETITIONS_TARGET,
  DEFAULT_PAUSE_BETWEEN_REPETITIONS,
  DEFAULT_PAUSE_BETWEEN_LANGUAGES,
  DEFAULT_PAUSE_BASE_TO_TARGET,
} from '@/lib/constants/audioPlayback';

interface LanguageSettings {
  plays: number;
  repPause: number;
}

interface PrototypeCProps {
  baseLanguages: string[];
  targetLanguages: string[];
}

export function PrototypeC({
  baseLanguages,
  targetLanguages,
}: PrototypeCProps) {
  const [autoPlay, setAutoPlay] = useState(DEFAULT_AUTO_PLAY);
  const [autoAdvance, setAutoAdvance] = useState(DEFAULT_AUTO_ADVANCE);
  const [pauseBaseToBase, setPauseBaseToBase] = useState(
    DEFAULT_PAUSE_BETWEEN_LANGUAGES,
  );
  const [pauseBaseToTarget, setPauseBaseToTarget] = useState(
    DEFAULT_PAUSE_BASE_TO_TARGET,
  );
  const [pauseTargetToTarget, setPauseTargetToTarget] = useState(
    DEFAULT_PAUSE_BETWEEN_LANGUAGES,
  );

  const [langSettings, setLangSettings] = useState<
    Record<string, LanguageSettings>
  >({});

  const getDefaultsFor = (code: string): LanguageSettings => ({
    plays: baseLanguages.includes(code)
      ? DEFAULT_REPETITIONS_BASE
      : DEFAULT_REPETITIONS_TARGET,
    repPause: DEFAULT_PAUSE_BETWEEN_REPETITIONS,
  });

  const updateLang = (
    code: string,
    key: keyof LanguageSettings,
    value: number,
  ) => {
    setLangSettings((prev) => ({
      ...prev,
      [code]: { ...(prev[code] ?? getDefaultsFor(code)), [key]: value },
    }));
  };

  const allLanguages = [...baseLanguages, ...targetLanguages];

  return (
    <div className="space-y-5">
      {/* Toggles — always visible above tabs */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Auto-play audio</Label>
            <p className="text-muted-xs">Play audio when a card is shown</p>
          </div>
          <Switch checked={autoPlay} onCheckedChange={setAutoPlay} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Auto-advance</Label>
            <p className="text-muted-xs">Go to next card after audio</p>
          </div>
          <Switch checked={autoAdvance} onCheckedChange={setAutoAdvance} />
        </div>
      </div>

      <Separator />

      {/* Tabbed content */}
      <Tabs defaultValue="playback" className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="playback" className="flex-1">
            Playback
          </TabsTrigger>
          <TabsTrigger value="timing" className="flex-1">
            Timing
          </TabsTrigger>
        </TabsList>

        {/* ---- Playback tab ---- */}
        <TabsContent value="playback" className="space-y-4 pt-2">
          <p className="text-muted-xs">
            Choose how many times each language&apos;s audio is played. Set to 0
            to skip.
          </p>

          {/* Compact table */}
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 text-muted-foreground text-xs">
                  <th className="text-left py-2 px-3 font-medium">Language</th>
                  <th className="text-center py-2 px-3 font-medium w-16">
                    Type
                  </th>
                  <th className="text-center py-2 px-3 font-medium w-20">
                    Plays
                  </th>
                </tr>
              </thead>
              <tbody>
                {allLanguages.map((code, idx) => {
                  const lang = getLanguageByCode(code);
                  const isBase = baseLanguages.includes(code);
                  const settings = langSettings[code] ?? getDefaultsFor(code);
                  return (
                    <tr
                      key={code}
                      className={
                        idx < allLanguages.length - 1 ? 'border-b' : ''
                      }
                    >
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <span>{lang?.flag}</span>
                          <span className="font-medium">
                            {lang?.name ?? code}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <Badge
                          variant={isBase ? 'secondary' : 'outline'}
                          className="text-[10px]"
                        >
                          {isBase ? 'Base' : 'Target'}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex justify-center">
                          <Input
                            type="number"
                            min={0}
                            max={10}
                            step={1}
                            value={
                              settings?.plays ??
                              (isBase
                                ? DEFAULT_REPETITIONS_BASE
                                : DEFAULT_REPETITIONS_TARGET)
                            }
                            onChange={(e) =>
                              updateLang(
                                code,
                                'plays',
                                parseInt(e.target.value) || 0,
                              )
                            }
                            className="w-14 h-7 text-center text-sm"
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ---- Timing tab ---- */}
        <TabsContent value="timing" className="space-y-5 pt-2">
          <p className="text-muted-xs">
            Configure pauses between audio segments (in seconds).
          </p>

          {/* Per-language repetition pauses */}
          <div className="space-y-2">
            <p className="text-xs font-medium">
              Between repetitions of the same language
            </p>
            <p className="text-muted-xs">
              Only applies when a language plays more than once.
            </p>

            <div className="space-y-2 mt-2">
              {allLanguages.map((code) => {
                const lang = getLanguageByCode(code);
                const isBase = baseLanguages.includes(code);
                const settings = langSettings[code] ?? getDefaultsFor(code);
                const plays =
                  settings?.plays ??
                  (isBase
                    ? DEFAULT_REPETITIONS_BASE
                    : DEFAULT_REPETITIONS_TARGET);

                return (
                  <div
                    key={code}
                    className={`flex items-center justify-between gap-3 ${
                      plays <= 1 ? 'opacity-40' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-sm">{lang?.flag}</span>
                      <span className="text-sm truncate">
                        {lang?.name ?? code}
                      </span>
                      {plays <= 1 && (
                        <span className="text-[10px] text-muted-foreground">
                          (single play)
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min={0}
                        max={30}
                        step={1}
                        value={
                          settings?.repPause ??
                          DEFAULT_PAUSE_BETWEEN_REPETITIONS
                        }
                        onChange={(e) =>
                          updateLang(
                            code,
                            'repPause',
                            parseInt(e.target.value) || 0,
                          )
                        }
                        className="w-14 h-7 text-center text-sm"
                        disabled={plays <= 1}
                      />
                      <span className="text-muted-xs">s</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <Separator />

          {/* Global pauses */}
          <div className="space-y-3">
            <p className="text-xs font-medium">Between sections</p>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <span className="text-sm">Base → Base</span>
                  <p className="text-muted-xs">
                    Gap between different base languages
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    max={30}
                    step={1}
                    value={pauseBaseToBase}
                    onChange={(e) =>
                      setPauseBaseToBase(parseInt(e.target.value) || 0)
                    }
                    className="w-14 h-7 text-center text-sm"
                  />
                  <span className="text-muted-xs">s</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <span className="text-sm">Base → Target</span>
                  <p className="text-muted-xs">
                    Gap between the last base and first target audio
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    max={30}
                    step={1}
                    value={pauseBaseToTarget}
                    onChange={(e) =>
                      setPauseBaseToTarget(parseInt(e.target.value) || 0)
                    }
                    className="w-14 h-7 text-center text-sm"
                  />
                  <span className="text-muted-xs">s</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <span className="text-sm">Target → Target</span>
                  <p className="text-muted-xs">
                    Gap between different target languages
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    max={30}
                    step={1}
                    value={pauseTargetToTarget}
                    onChange={(e) =>
                      setPauseTargetToTarget(parseInt(e.target.value) || 0)
                    }
                    className="w-14 h-7 text-center text-sm"
                  />
                  <span className="text-muted-xs">s</span>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
