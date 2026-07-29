import { describe, it, expect } from 'vitest';
import { ConvexError } from 'convex/values';
import { cn, isAuthError, isPaymentPastDueError } from '@/lib/utils';

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('ignores falsy values', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('deduplicates tailwind classes with twMerge', () => {
    // twMerge keeps the later class when they conflict
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('supports conditional object syntax', () => {
    expect(cn({ a: true, b: false, c: true })).toBe('a c');
  });
});

describe('isAuthError', () => {
  it('detects ConvexError("Unauthenticated")', () => {
    expect(isAuthError(new ConvexError('Unauthenticated'))).toBe(true);
  });

  it('detects Error with "Not authenticated" message', () => {
    expect(isAuthError(new Error('Not authenticated'))).toBe(true);
  });

  it('detects Error with "Unauthenticated" message', () => {
    expect(isAuthError(new Error('Unauthenticated'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isAuthError(new Error('Something else'))).toBe(false);
    expect(isAuthError(new ConvexError('nope'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
    expect(isAuthError('Unauthenticated')).toBe(false);
    expect(isAuthError({})).toBe(false);
  });
});

describe('isPaymentPastDueError', () => {
  it('detects a ConvexError carrying code PAYMENT_PAST_DUE', () => {
    expect(
      isPaymentPastDueError(new ConvexError({ code: 'PAYMENT_PAST_DUE' })),
    ).toBe(true);
  });

  it('returns false for a ConvexError with another code', () => {
    expect(isPaymentPastDueError(new ConvexError({ code: 'USAGE_LIMIT' }))).toBe(
      false,
    );
    expect(isPaymentPastDueError(new ConvexError('PAYMENT_PAST_DUE'))).toBe(
      false,
    );
  });

  it('returns false for a plain Error', () => {
    expect(isPaymentPastDueError(new Error('PAYMENT_PAST_DUE'))).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isPaymentPastDueError(undefined)).toBe(false);
    expect(isPaymentPastDueError(null)).toBe(false);
    expect(isPaymentPastDueError({ code: 'PAYMENT_PAST_DUE' })).toBe(false);
  });
});
