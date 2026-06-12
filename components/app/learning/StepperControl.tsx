'use client';

import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface StepperControlProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Render the value as something other than the bare number (e.g. "∞" for a
   *  sentinel position). Defaults to `String(value)`. */
  formatValue?: (value: number) => string;
}

export function StepperControl({
  value,
  min,
  max,
  onChange,
  formatValue,
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
      <span className="tabular-nums text-sm font-medium w-8 text-center">
        {formatValue ? formatValue(value) : value}
      </span>
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
