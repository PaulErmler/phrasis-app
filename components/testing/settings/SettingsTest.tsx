'use client';

/**
 * Settings prototype comparison UI.
 *
 * Language picker at the top lets you change the number of base/target
 * languages to see how each prototype handles different configurations.
 */

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getLanguageByCode, SUPPORTED_LANGUAGES } from '@/lib/languages';
import { Plus, X } from 'lucide-react';
import { PrototypeA } from './PrototypeA';
import { PrototypeB } from './PrototypeB';
import { PrototypeC } from './PrototypeC';
import { PrototypeD } from './PrototypeD';

const ALL_CODES = SUPPORTED_LANGUAGES.map((l) => l.code);

export function SettingsTest() {
  const [baseLanguages, setBaseLanguages] = useState<string[]>(['en']);
  const [targetLanguages, setTargetLanguages] = useState<string[]>([
    'es',
    'fr',
  ]);

  const usedCodes = new Set([...baseLanguages, ...targetLanguages]);
  const availableCodes = ALL_CODES.filter((c) => !usedCodes.has(c));
  const languageSignature = `${baseLanguages.join(',')}__${targetLanguages.join(',')}`;

  const addBase = () => {
    if (availableCodes.length > 0) {
      setBaseLanguages((prev) => [...prev, availableCodes[0]]);
    }
  };
  const addTarget = () => {
    if (availableCodes.length > 0) {
      setTargetLanguages((prev) => [...prev, availableCodes[0]]);
    }
  };
  const removeBase = (code: string) => {
    setBaseLanguages((prev) => prev.filter((c) => c !== code));
  };
  const removeTarget = (code: string) => {
    setTargetLanguages((prev) => prev.filter((c) => c !== code));
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Page header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-semibold">Settings UI Prototypes</h1>
          <p className="text-muted-sm mt-1">
            4 different approaches for audio playback settings.
          </p>
        </div>

        {/* Language picker */}
        <div className="max-w-xl mx-auto mb-8 rounded-xl border p-4 space-y-3">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Test Configuration
          </p>

          {/* Base languages */}
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Base Languages</p>
            <div className="flex flex-wrap items-center gap-2">
              {baseLanguages.map((code) => {
                const lang = getLanguageByCode(code);
                return (
                  <Badge key={code} variant="secondary" className="gap-1 pr-1">
                    <span>{lang?.flag}</span>
                    <span>{lang?.name ?? code}</span>
                    <button
                      onClick={() => removeBase(code)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                      disabled={baseLanguages.length <= 1}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
              {availableCodes.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={addBase}
                >
                  <Plus className="h-3 w-3" />
                  Add
                </Button>
              )}
            </div>
          </div>

          {/* Target languages */}
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Target Languages</p>
            <div className="flex flex-wrap items-center gap-2">
              {targetLanguages.map((code) => {
                const lang = getLanguageByCode(code);
                return (
                  <Badge key={code} variant="outline" className="gap-1 pr-1">
                    <span>{lang?.flag}</span>
                    <span>{lang?.name ?? code}</span>
                    <button
                      onClick={() => removeTarget(code)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                      disabled={targetLanguages.length <= 1}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
              {availableCodes.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={addTarget}
                >
                  <Plus className="h-3 w-3" />
                  Add
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Four prototypes in a responsive grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Prototype A */}
          <Card>
            <CardHeader>
              <CardTitle>A: Visual Timeline</CardTitle>
              <CardDescription>
                Shows the actual playback sequence as a visual flow. Pause
                durations are editable inline on the timeline. Gives users an
                intuitive preview of what will happen.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PrototypeA
                baseLanguages={baseLanguages}
                targetLanguages={targetLanguages}
              />
            </CardContent>
          </Card>

          {/* Prototype B */}
          <Card>
            <CardHeader>
              <CardTitle>B: Language Cards + Sliders</CardTitle>
              <CardDescription>
                Each language is a bordered card with slider controls. Global
                pauses shown as labeled dividers between groups.
                Mobile-friendly, tactile slider interaction.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PrototypeB
                baseLanguages={baseLanguages}
                targetLanguages={targetLanguages}
              />
            </CardContent>
          </Card>

          {/* Prototype C */}
          <Card>
            <CardHeader>
              <CardTitle>C: Tabbed Separation</CardTitle>
              <CardDescription>
                Splits &quot;what plays&quot; and &quot;timing&quot; into two
                tabs. Playback tab shows a compact table. Timing tab shows all
                pauses. Reduces clutter for each concern.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PrototypeC
                baseLanguages={baseLanguages}
                targetLanguages={targetLanguages}
              />
            </CardContent>
          </Card>

          {/* Prototype D */}
          <Card>
            <CardHeader>
              <CardTitle>D: Timeline + Cards Combined</CardTitle>
              <CardDescription>
                Combines A and B: each language is an interactive card embedded
                directly in the timeline. Sliders for plays and repetition
                pauses, +/&minus; steppers for pauses between groups.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PrototypeD
                key={languageSignature}
                baseLanguages={baseLanguages}
                targetLanguages={targetLanguages}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
