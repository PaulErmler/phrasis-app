import { Input } from '@/components/ui/input';
import {
  MAX_ONBOARDING_FREE_TEXT_LENGTH,
  ONBOARDING_FREE_TEXT_SHOW_COUNT_REMAINING_THRESHOLD,
} from '@/lib/constants/onboarding';

/**
 * The "other" free-text line under a step's option grid: label, the
 * character counter that appears near the cap, and the input. Shared by the
 * acquisition, prior-apps and learning-goal steps so the cap, the counter
 * threshold and the over-limit styling live in one place.
 */
export function OtherFreeTextField({
  id,
  testIdPrefix,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  /** `${testIdPrefix}-other-input` and `${testIdPrefix}-other-char-count`. */
  testIdPrefix: string;
  label: string;
  placeholder: string;
  value: string | null;
  onChange: (value: string) => void;
}) {
  const text = value ?? '';
  const isOverLimit = text.length > MAX_ONBOARDING_FREE_TEXT_LENGTH;
  const remaining = MAX_ONBOARDING_FREE_TEXT_LENGTH - text.length;
  const showCharCount =
    isOverLimit ||
    remaining <= ONBOARDING_FREE_TEXT_SHOW_COUNT_REMAINING_THRESHOLD;
  return (
    <div className="max-w-md mx-auto w-full mt-4 px-4 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <label htmlFor={id} className="text-sm text-muted-foreground">
          {label}
        </label>
        {showCharCount ? (
          <span
            data-testid={`${testIdPrefix}-other-char-count`}
            className={`text-xs tabular-nums shrink-0 ${isOverLimit ? 'text-destructive font-medium' : 'text-muted-foreground'}`}
          >
            {isOverLimit
              ? `+${text.length - MAX_ONBOARDING_FREE_TEXT_LENGTH}`
              : `${text.length}/${MAX_ONBOARDING_FREE_TEXT_LENGTH}`}
          </span>
        ) : null}
      </div>
      <Input
        id={id}
        data-testid={`${testIdPrefix}-other-input`}
        placeholder={placeholder}
        value={text}
        maxLength={MAX_ONBOARDING_FREE_TEXT_LENGTH}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
