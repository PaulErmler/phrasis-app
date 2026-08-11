import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  emailEnvLabel,
  formatEmailEnvLabel,
  withEmailEnvSubject,
} from '../../lib/emailEnv';

describe('emailEnv', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('treats unset / production / prod as unlabeled', () => {
    expect(emailEnvLabel()).toBeNull();
    expect(withEmailEnvSubject('Hello')).toBe('Hello');

    for (const value of ['production', 'Production', 'prod', 'PROD', '  ']) {
      vi.stubEnv('EMAIL_ENV', value);
      expect(emailEnvLabel(), value).toBeNull();
      expect(withEmailEnvSubject('Hello'), value).toBe('Hello');
      vi.unstubAllEnvs();
    }
  });

  it('prefixes subjects for staging and test', () => {
    vi.stubEnv('EMAIL_ENV', 'staging');
    expect(emailEnvLabel()).toBe('staging');
    expect(withEmailEnvSubject('Welcome to Flexling!')).toBe(
      '[Staging] Welcome to Flexling!',
    );

    vi.stubEnv('EMAIL_ENV', 'test');
    expect(withEmailEnvSubject('Reset your Flexling password')).toBe(
      '[Test] Reset your Flexling password',
    );
  });

  it('title-cases mixed labels and preserves ALL_CAPS tokens', () => {
    expect(formatEmailEnvLabel('staging')).toBe('Staging');
    expect(formatEmailEnvLabel('dev')).toBe('Dev');
    expect(formatEmailEnvLabel('QA')).toBe('QA');
  });
});
