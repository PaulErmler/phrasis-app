/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach } from "vitest";
import schema from "../../schema";
import type { AuthEmailCtx } from "../../lib/authEmails";
import {
  renderWelcomeEmail,
  sendWelcomeEmail,
  WELCOME_EMAIL_SUBJECT,
} from "../../lib/welcomeEmail";

const modules = import.meta.glob("/convex/**/*.ts");

describe("renderWelcomeEmail", () => {
  it("greets by first name and includes the founder message", () => {
    const { subject, html, text } = renderWelcomeEmail("Anna Schmidt");

    expect(subject).toBe("Welcome to Flexling!");
    expect(html).toContain("Hi Anna,");
    expect(text).toContain("Hi Anna,");
    expect(text).toContain("Thank you for trying out Flexling!");
    expect(text).toContain("Founder of Flexling");
  });

  it("falls back to a bare greeting when the name is empty", () => {
    const { html, text } = renderWelcomeEmail("");
    expect(html).toContain("Hi,");
    expect(text).toContain("Hi,");
  });

  it("looks like a personal email, no branding, buttons, or links", () => {
    const { html } = renderWelcomeEmail("Anna");
    expect(html).not.toContain("icon-192x192.png");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("#2bb5d4");
  });

  it("escapes HTML in the interpolated name", () => {
    const { html } = renderWelcomeEmail('<script>alert(1)</script>');
    expect(html).not.toContain("<script>");
  });
});

describe("capture mode (E2E_TEST_HOOKS=1)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("writes to testAuthEmails instead of sending", async () => {
    vi.stubEnv("E2E_TEST_HOOKS", "1");
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const runCtx = ctx as unknown as AuthEmailCtx;
      // Mixed-case recipient. Capture normalizes to lowercase so the
      // by_email index lookup in authEmailTesting.ts matches.
      await sendWelcomeEmail(runCtx, { to: "User@Flexling.com", name: "Anna" });
    });

    const rows = await t.run((ctx) =>
      ctx.db.query("testAuthEmails").collect(),
    );
    expect(rows).toMatchObject([
      {
        email: "user@flexling.com",
        kind: "welcome",
        subject: WELCOME_EMAIL_SUBJECT,
      },
    ]);
  });
});
