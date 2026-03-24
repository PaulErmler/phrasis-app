import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ConvexError } from 'convex/values';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const isAuthError = (error: unknown) => {
  const message =
    (error instanceof ConvexError && typeof error.data === 'string' && error.data) ||
    (error instanceof Error && error.message) ||
    '';
  return message === 'Unauthenticated' || message === 'Not authenticated';
};
