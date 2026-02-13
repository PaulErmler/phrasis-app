"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StepperPauseConnectorProps {
  label: string;
  seconds: number;
  onChange: (value: number) => void;
  accent?: boolean;
  lineOnly?: boolean;
}

export function StepperPauseConnector({
  label,
  seconds,
  onChange,
  accent,
  lineOnly,
}: StepperPauseConnectorProps) {
  const decrement = () => onChange(Math.max(0, seconds - 1));
  const increment = () => onChange(Math.min(30, seconds + 1));

  if (lineOnly) {
    return (
      <div className="flex flex-col items-center py-0.5">
        <div className="w-px h-5 bg-border" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-0.5">
      <div className={`w-px h-3 ${accent ? "bg-primary" : "bg-border"}`} />

      <div
        className={`flex items-center rounded-full px-2 py-0.5 text-xs ${
          accent
            ? "bg-primary/10 text-primary border border-primary/30"
            : "bg-muted text-muted-foreground border border-border"
        }`}
      >
        <span className="whitespace-nowrap pr-2">{label}</span>
        <div className={`w-px h-4 mx-1 ${accent ? "bg-primary/30" : "bg-border"}`} />

        <div className="flex items-center gap-1 pl-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 rounded-full"
            onClick={decrement}
            disabled={seconds <= 0}
          >
            <Minus className="h-3 w-3" />
          </Button>

          <span className="tabular-nums text-xs font-medium w-6 text-center">{seconds}s</span>

          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 rounded-full"
            onClick={increment}
            disabled={seconds >= 30}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className={`w-px h-3 ${accent ? "bg-primary" : "bg-border"}`} />
    </div>
  );
}
