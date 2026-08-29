import { v } from 'convex/values';

import { internalAction } from '../_generated/server';
import type { ActionCtx } from '../_generated/server';
import { optionalEnv } from '../lib/env';
import { EVENTS, track } from '../analytics';

/**
 * Daily sweep reporting the ACTUAL Convex bill into PostHog.
 *
 * Convex's public Management API has no usage/billing endpoints, but the
 * open-source dashboard and CLI both read billing through the account
 * ("big brain") API at `api.convex.dev/api/dashboard/...`, whose shapes are
 * pinned by `dashboard-management-openapi.json` in the convex-backend repo.
 * This sweep calls ONE of those endpoints — `GET
 * /teams/{team_id}/list_invoices` — takes the most recent invoice, and
 * emits an `infra_cost_recorded` event with the total converted to EUR.
 *
 * UNSUPPORTED-API CAVEAT: these endpoints are not covered by any stability
 * guarantee and may change without notice. Failure is designed to be
 * graceful: the sweep logs and returns, the dashboards keep reading the
 * last reported value, and the tile SQL falls back to the known base fee
 * when no event has ever arrived.
 *
 * Emission is deliberately dedup-free: the dashboards read the LATEST value
 * (`argMax(amount_eur, timestamp)`), so re-emitting the same invoice daily
 * is idempotent by construction, and a new invoice takes over automatically
 * on the first sweep after it is issued.
 *
 * Auth: `CONVEX_BILLING_TOKEN`. Try a team access token first (least
 * privilege); the dashboard endpoints are known to accept the CLI login
 * token (`npx convex login`, `~/.convex/config.json`) as a fallback. The
 * numeric team id comes from `CONVEX_TEAM_ID`, or is resolved from the
 * token via the Management API's `/v1/token_details` when unset.
 */

const BIG_BRAIN_API = 'https://api.convex.dev/api/dashboard';
const MANAGEMENT_API = 'https://api.convex.dev/v1';

/** Convex bills in USD; the dashboards run in EUR. Match the tiles' rate. */
const EUR_PER_USD = 0.9;

type InvoiceResponse = {
  id: string;
  invoiceDate: number;
  invoiceNumber: string;
  currency: string;
  /** Decimal string, e.g. "25.00". */
  total: string;
  status: string;
};

async function resolveTeamId(token: string): Promise<string | null> {
  const res = await fetch(`${MANAGEMENT_API}/token_details`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const details = (await res.json()) as { teamId?: number | string };
  return details.teamId !== undefined ? String(details.teamId) : null;
}

export const syncConvexCost = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx: ActionCtx) => {
    const token = optionalEnv('CONVEX_BILLING_TOKEN');
    if (!token) {
      console.log('[infraCostSync] CONVEX_BILLING_TOKEN unset — skipping');
      return null;
    }

    const teamId =
      optionalEnv('CONVEX_TEAM_ID') ?? (await resolveTeamId(token));
    if (!teamId) {
      console.error(
        '[infraCostSync] could not resolve team id — set CONVEX_TEAM_ID',
      );
      return null;
    }

    const res = await fetch(
      `${BIG_BRAIN_API}/teams/${teamId}/list_invoices?limit=3`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      // Expected failure mode of an unsupported API; keep it a log line,
      // not an exception storm.
      console.error(
        `[infraCostSync] list_invoices failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
      return null;
    }
    const { invoices } = (await res.json()) as {
      invoices: InvoiceResponse[];
    };
    const latest = invoices
      .filter((inv) => Number.isFinite(Number(inv.total)))
      .sort((a, b) => b.invoiceDate - a.invoiceDate)[0];
    if (!latest) {
      console.log('[infraCostSync] no invoices found');
      return null;
    }

    const total = Number(latest.total);
    const currency = latest.currency.toLowerCase();
    const amountEur = currency === 'usd' ? total * EUR_PER_USD : total;

    await track(ctx, 'system:infra', EVENTS.INFRA_COST_RECORDED, {
      source: 'convex',
      amount: total,
      currency,
      amount_eur: Math.round(amountEur * 100) / 100,
      invoice_number: latest.invoiceNumber,
      invoice_date: latest.invoiceDate,
      invoice_status: latest.status,
    });
    console.log(
      `[infraCostSync] reported invoice ${latest.invoiceNumber}: ${latest.total} ${currency}`,
    );
    return null;
  },
});
