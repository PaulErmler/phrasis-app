/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach } from "vitest";
import schema from "../../schema";
import {
  AUTH_EMAIL_COPY,
  renderAuthEmail,
  renderOtpEmail,
  sendVerificationOtpEmail,
  sendResetPasswordEmail,
  isE2EFixtureAddress,
  type AuthEmailCtx,
} from "../../lib/authEmails";

const modules = import.meta.glob("/convex/**/*.ts");

/**
 * The deferred sends (welcome ~24h, signup notification ~20min) fire long after
 * global-teardown removes E2E_TEST_HOOKS, so `captureMode()` cannot suppress
 * them — this predicate is what stops fixture addresses from hard-bouncing on
 * our own sending domain.
 */
describe("isE2EFixtureAddress", () => {
  // Mirrors `generateCredentials` (e2e/auth.setup.ts) and `signUpFreshUser`
  // (e2e/helpers.ts): `e2e-${prefix}-${Date.now()}-${12 hex}@flexling.com`.
  const generate = (prefix: string) =>
    `e2e-${prefix}-${Date.now()}-${"a1b2c3d4e5f6"}@flexling.com`;

  it("matches what the Playwright fixture generators actually produce", () => {
    for (const prefix of ["billing", "overdue", "settings", "free-study"]) {
      expect(isE2EFixtureAddress(generate(prefix)), prefix).toBe(true);
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(
      isE2EFixtureAddress("  E2E-Billing-1770000000000-A1B2C3D4E5F6@Flexling.com "),
    ).toBe(true);
  });

  it("does not swallow a real user who picks an e2e- local part", () => {
    for (const real of [
      "e2e@flexling.com",
      "e2e-tester@flexling.com",
      "e2e-billing-notanumber-a1b2c3d4e5f6@flexling.com",
      "e2e-billing-1770000000000-tooshort@flexling.com",
      // Same shape, different domain — a real address we must still mail.
      "e2e-billing-1770000000000-a1b2c3d4e5f6@example.com",
      "someone@flexling.com",
    ]) {
      expect(isE2EFixtureAddress(real), real).toBe(false);
    }
  });
});

describe("renderAuthEmail (link emails)", () => {
  const url = "https://flexling.com/api/auth/reset-password/abc123?callbackURL=/auth/reset-password";

  it("renders the reset email with the CTA link everywhere", () => {
    const copy = AUTH_EMAIL_COPY.reset;
    const { html, text } = renderAuthEmail(copy, url);

    expect(html).toContain(copy.heading);
    expect(text).toContain(copy.heading);

    // The link appears as the CTA button and the plain fallback link.
    const hrefCount = html.split(`href="${url}"`).length - 1;
    expect(hrefCount).toBe(2);
    expect(text).toContain(url);

    // Branding: logo + brand-colored button + support footer.
    expect(html).toContain("icon-192x192.png");
    expect(html).toContain("#2bb5d4");
    expect(html).toContain("support@flexling.com");
  });

  it("escapes HTML in the interpolated URL", () => {
    const { html } = renderAuthEmail(
      AUTH_EMAIL_COPY.reset,
      'https://x.test/?a="<script>alert(1)</script>',
    );
    expect(html).not.toContain("<script>");
  });
});

describe("renderOtpEmail (verification code)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("renders the code as plain selectable text", () => {
    const copy = AUTH_EMAIL_COPY.verify;
    const { html, text } = renderOtpEmail(copy, "123456");

    expect(html).toContain(copy.heading);
    expect(text).toContain(copy.heading);
    // The code sits contiguous inside its element (easily copiable — no
    // per-digit markup splitting it up).
    expect(html).toMatch(/>123456</);
    expect(text).toContain("123456");
    expect(html).toContain("icon-192x192.png");
    expect(html).toContain("support@flexling.com");
  });

  it("shows an EMAIL_ENV banner in the branded shell when not production", () => {
    vi.stubEnv("EMAIL_ENV", "staging");
    const { html } = renderOtpEmail(AUTH_EMAIL_COPY.verify, "123456");
    expect(html).toContain("[Staging]");
  });
});

describe("capture mode (E2E_TEST_HOOKS=1)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("writes to testAuthEmails instead of sending", async () => {
    vi.stubEnv("E2E_TEST_HOOKS", "1");
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const runCtx = ctx as unknown as AuthEmailCtx;
      // Mixed-case recipient — capture normalizes to lowercase so the
      // by_email index lookup in authEmailTesting.ts matches.
      await sendVerificationOtpEmail(runCtx, {
        to: "User@Flexling.com",
        otp: "654321",
      });
      await sendResetPasswordEmail(runCtx, {
        to: "user@flexling.com",
        url: "https://flexling.com/reset?token=r1",
      });
    });

    const rows = await t.run((ctx) =>
      ctx.db.query("testAuthEmails").collect(),
    );
    expect(rows).toMatchObject([
      {
        email: "user@flexling.com",
        kind: "verify",
        otp: "654321",
        // Code in the subject → copiable from the inbox list.
        subject: `${AUTH_EMAIL_COPY.verify.subject}: 654321`,
      },
      {
        email: "user@flexling.com",
        kind: "reset",
        url: "https://flexling.com/reset?token=r1",
        subject: AUTH_EMAIL_COPY.reset.subject,
      },
    ]);
  });

  it("prefixes captured subjects when EMAIL_ENV is set", async () => {
    vi.stubEnv("E2E_TEST_HOOKS", "1");
    vi.stubEnv("EMAIL_ENV", "test");
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await sendVerificationOtpEmail(ctx as unknown as AuthEmailCtx, {
        to: "user@flexling.com",
        otp: "111111",
      });
    });

    const rows = await t.run((ctx) =>
      ctx.db.query("testAuthEmails").collect(),
    );
    expect(rows[0]?.subject).toBe(
      `[Test] ${AUTH_EMAIL_COPY.verify.subject}: 111111`,
    );
  });
});
