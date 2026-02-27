"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StepperControlProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

export function StepperControl({
  value,
  min,
  max,
  onChange,
}: StepperControlProps) {
  const decrement = () => onChange(Math.max(min, value - 1));
  const increment = () => onChange(Math.min(max, value + 1));

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8 rounded-full shrink-0"
        onClick={decrement}
        disabled={value <= min}
      >
        <Minus className="h-3 w-3" />
      </Button>
      <span className="tabular-nums text-sm font-medium w-8 text-center">{value}</span>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8 rounded-full shrink-0"
        onClick={increment}
        disabled={value >= max}
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}
