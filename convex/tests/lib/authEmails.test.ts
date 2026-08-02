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
  type AuthEmailCtx,
} from "../../lib/authEmails";

const modules = import.meta.glob("/convex/**/*.ts");

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
        to: "User@Test.de",
        otp: "654321",
      });
      await sendResetPasswordEmail(runCtx, {
        to: "user@test.de",
        url: "https://flexling.com/reset?token=r1",
      });
    });

    const rows = await t.run((ctx) =>
      ctx.db.query("testAuthEmails").collect(),
    );
    expect(rows).toMatchObject([
      {
        email: "user@test.de",
        kind: "verify",
        otp: "654321",
        // Code in the subject → copiable from the inbox list.
        subject: `${AUTH_EMAIL_COPY.verify.subject}: 654321`,
      },
      {
        email: "user@test.de",
        kind: "reset",
        url: "https://flexling.com/reset?token=r1",
        subject: AUTH_EMAIL_COPY.reset.subject,
      },
    ]);
  });
});
