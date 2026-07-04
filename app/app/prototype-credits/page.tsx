'use client';

/**
 * Dev prototype page for the credit system (/app/prototype-credits).
 *
 * Shows the live credits balance and exercises all three credit-consuming
 * features (chat messages, custom card creation, translation auto-fill) so
 * their effect on the balance can be observed — including the dynamic
 * post-generation chat charge (1 credit per started $0.005 of LLM cost).
 *
 * Not linked from any navigation; English-only on purpose (testing tool,
 * not a product surface).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { api } from '@/convex/_generated/api';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import { MAX_MESSAGE_LENGTH, THREAD_MESSAGE_LIMIT } from '@/convex/features/chat/constants';
import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';
import { useChatMessages } from '@/hooks/use-chat-messages';
import { useCourseLanguages } from '@/hooks/use-course-languages';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Loader2, RefreshCw } from 'lucide-react';

type LogEntry = {
  time: string;
  label: string;
  balance: number | null;
  delta: number | null;
};

function now(): string {
  return new Date().toLocaleTimeString();
}

function errorMessage(e: unknown): string {
  if (e instanceof ConvexError) {
    const data = e.data as { code?: string; message?: string } | string;
    if (typeof data === 'string') return data;
    return `${data.code ?? 'ERROR'}: ${data.message ?? 'unknown'}`;
  }
  return e instanceof Error ? e.message : String(e);
}

const LONG_CHAT_PROMPT =
  'Please write a very detailed, long explanation (at least 1000 words) of how verb conjugation works in my target language, covering every tense you know, with at least 25 full example sentences and their translations. Do not create any flashcards, just write the explanation as text.';

const SHORT_CHAT_PROMPT = 'Reply with exactly one short word.';

export default function PrototypeCreditsPage() {
  const credits = useFeatureQuota(FEATURE_IDS.CREDITS);
  const quotas = useQuery(api.usage.queries.getMyQuotas);
  const syncQuotas = useAction(api.usage.actions.syncQuotas);

  const { baseLanguages, targetLanguages } = useCourseLanguages();
  const courseLanguages = useMemo(
    () => [...new Set([...baseLanguages, ...targetLanguages])],
    [baseLanguages, targetLanguages],
  );

  // ---- credit event log --------------------------------------------------
  const [log, setLog] = useState<LogEntry[]>([]);
  const addLog = useCallback((label: string, balance: number | null = null, delta: number | null = null) => {
    setLog((prev) => [{ time: now(), label, balance, delta }, ...prev].slice(0, 100));
  }, []);

  const prevBalanceRef = useRef<number | null>(null);
  useEffect(() => {
    if (credits.isLoading) return;
    const prev = prevBalanceRef.current;
    if (prev === null) {
      prevBalanceRef.current = credits.balance;
      addLog('Initial balance', credits.balance, null);
      return;
    }
    if (prev !== credits.balance) {
      prevBalanceRef.current = credits.balance;
      addLog('Balance changed', credits.balance, credits.balance - prev);
    }
  }, [credits.balance, credits.isLoading, addLog]);

  const [syncing, setSyncing] = useState(false);
  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncQuotas({});
      addLog('Manual sync from Autumn requested');
    } catch (e) {
      addLog(`Sync failed: ${errorMessage(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  const hasCreditsBalance = Boolean(quotas?.features?.[FEATURE_IDS.CREDITS]);

  // ---- chat tester ---------------------------------------------------------
  const getOrCreateEmptyThread = useMutation(api.features.chat.threads.getOrCreateEmptyThread);
  const sendMessage = useMutation(api.features.chat.messages.sendMessage);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(LONG_CHAT_PROMPT);
  const [chatError, setChatError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const { messages, status: chatStatus } = useChatMessages({ threadId });

  const userMessageCount = messages.filter((m) => m.role === 'user').length;

  const handleNewThread = async () => {
    try {
      const id = await getOrCreateEmptyThread({});
      setThreadId(id);
      setChatError(null);
      addLog('Chat thread ready');
    } catch (e) {
      setChatError(errorMessage(e));
    }
  };

  const handleSend = async () => {
    if (!threadId || !prompt.trim()) return;
    setSending(true);
    setChatError(null);
    addLog(`Chat: sending message (${prompt.length} chars) — 1 credit up-front, remainder after response`, credits.balance);
    try {
      await sendMessage({ threadId, prompt });
    } catch (e) {
      const msg = errorMessage(e);
      setChatError(msg);
      addLog(`Chat send failed: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  // ---- custom card tester --------------------------------------------------
  const createCustomText = useMutation(api.features.customTexts.createCustomText);
  const [cardTexts, setCardTexts] = useState<Record<string, string>>({});
  const [cardBusy, setCardBusy] = useState(false);
  const [cardResult, setCardResult] = useState<string | null>(null);

  const handleCreateCard = async () => {
    setCardBusy(true);
    setCardResult(null);
    try {
      const stamp = new Date().toISOString().slice(11, 19);
      const translations = courseLanguages.map((lang) => ({
        language: lang,
        text: (cardTexts[lang] ?? '').trim() || `Prototype test sentence ${stamp} (${lang}).`,
      }));
      addLog('Custom card: creating (1 credit)', credits.balance);
      const res = await createCustomText({
        translations,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setCardResult(`Created text ${res.textId}`);
    } catch (e) {
      const msg = errorMessage(e);
      setCardResult(msg);
      addLog(`Custom card failed: ${msg}`);
    } finally {
      setCardBusy(false);
    }
  };

  // ---- auto-fill tester ------------------------------------------------------
  const autoFillTranslations = useAction(api.features.customTexts.autoFillTranslations);
  const sourceLanguage = courseLanguages[0];
  const fillTargets = courseLanguages.slice(1);
  const [fillText, setFillText] = useState('Where is the nearest train station?');
  const [fillBusy, setFillBusy] = useState(false);
  const [fillResult, setFillResult] = useState<{ language: string; text: string }[] | null>(null);
  const [fillError, setFillError] = useState<string | null>(null);

  const handleAutoFill = async () => {
    if (!sourceLanguage || fillTargets.length === 0) return;
    setFillBusy(true);
    setFillError(null);
    setFillResult(null);
    try {
      addLog('Auto-fill: translating (1 credit)', credits.balance);
      const res = await autoFillTranslations({
        texts: [{ language: sourceLanguage, text: fillText.trim() }],
        targetLanguages: fillTargets,
      });
      setFillResult(res.translations.map((t) => ({ language: t.language, text: t.text })));
    } catch (e) {
      const msg = errorMessage(e);
      setFillError(msg);
      addLog(`Auto-fill failed: ${msg}`);
    } finally {
      setFillBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-24 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Credits Prototype</h1>
        <p className="text-sm text-muted-foreground">
          Dev testing page for the credit system. Every action below consumes real (sandbox)
          credits for the signed-in user.
        </p>
      </div>

      {/* Balance */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Credits balance</CardTitle>
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync from Autumn
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {credits.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <div className="flex items-baseline gap-4">
              <span className="text-5xl font-bold tabular-nums">{credits.balance}</span>
              <span className="text-sm text-muted-foreground">
                of {credits.included} included · {credits.used} used
              </span>
            </div>
          )}
          {!credits.isLoading && !hasCreditsBalance && (
            <Badge variant="destructive" className="w-fit">
              No credits balance — this account is on a legacy (pre-credits) plan version
            </Badge>
          )}
          {quotas?.lastSyncedAt && (
            <p className="text-xs text-muted-foreground">
              Last synced: {new Date(quotas.lastSyncedAt).toLocaleTimeString()} — local balance
              updates instantly on use; Autumn re-syncs a moment later.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Chat tester */}
      <Card>
        <CardHeader>
          <CardTitle>1. Chat message (1 credit + 1 per started $0.005 of LLM cost)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={handleNewThread} variant={threadId ? 'outline' : 'default'}>
              {threadId ? 'New thread' : 'Create test thread'}
            </Button>
            {threadId && (
              <span className="text-xs text-muted-foreground">
                Thread ready · {userMessageCount}/{THREAD_MESSAGE_LIMIT} messages used · status: {chatStatus}
              </span>
            )}
          </div>
          {threadId && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setPrompt(SHORT_CHAT_PROMPT)}>
                  Fill: cheap prompt
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setPrompt(LONG_CHAT_PROMPT)}>
                  Fill: expensive prompt (long response)
                </Button>
              </div>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder="Chat message…"
              />
              <div className="flex items-center gap-3">
                <Button onClick={handleSend} disabled={sending || !prompt.trim()}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send'}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {prompt.length}/{MAX_MESSAGE_LENGTH} chars
                </span>
              </div>
              {chatError && <p className="text-sm text-destructive">{chatError}</p>}
              <Separator />
              <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">
                {messages.length === 0 && (
                  <p className="text-sm text-muted-foreground">No messages yet.</p>
                )}
                {messages.map((m) => {
                  const text =
                    m.parts
                      ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                      .map((p) => p.text)
                      .join('') ??
                    m.text ??
                    '';
                  return (
                    <div
                      key={m.key}
                      className="rounded-md border p-2 text-sm whitespace-pre-wrap"
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <Badge variant={m.role === 'user' ? 'default' : 'secondary'}>
                          {m.role}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {m.status} · {text.length} chars
                        </span>
                      </div>
                      {text || <em className="text-muted-foreground">(no text)</em>}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                The extra charge lands after the response finishes — watch the log below for a
                second balance drop on long responses.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Custom card tester */}
      <Card>
        <CardHeader>
          <CardTitle>2. Custom card (1 credit)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {courseLanguages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active course.</p>
          ) : (
            <>
              {courseLanguages.map((lang) => (
                <div key={lang} className="flex items-center gap-2">
                  <Badge variant="outline" className="w-16 justify-center">{lang}</Badge>
                  <Input
                    value={cardTexts[lang] ?? ''}
                    onChange={(e) =>
                      setCardTexts((prev) => ({ ...prev, [lang]: e.target.value }))
                    }
                    placeholder={`Text in ${lang} (blank = auto sample)`}
                  />
                </div>
              ))}
              <Button onClick={handleCreateCard} disabled={cardBusy} className="w-fit">
                {cardBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create custom card'}
              </Button>
              {cardResult && <p className="text-sm text-muted-foreground">{cardResult}</p>}
            </>
          )}
        </CardContent>
      </Card>

      {/* Auto-fill tester */}
      <Card>
        <CardHeader>
          <CardTitle>3. Translation auto-fill (1 credit)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!sourceLanguage || fillTargets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Needs an active course with at least two languages.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="w-16 justify-center">{sourceLanguage}</Badge>
                <Input value={fillText} onChange={(e) => setFillText(e.target.value)} />
              </div>
              <Button onClick={handleAutoFill} disabled={fillBusy || !fillText.trim()} className="w-fit">
                {fillBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Auto-fill ${fillTargets.join(', ')}`}
              </Button>
              {fillError && <p className="text-sm text-destructive">{fillError}</p>}
              {fillResult && (
                <div className="flex flex-col gap-1">
                  {fillResult.map((r) => (
                    <div key={r.language} className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="w-16 justify-center">{r.language}</Badge>
                      <span>{r.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Log */}
      <Card>
        <CardHeader>
          <CardTitle>Credit event log</CardTitle>
        </CardHeader>
        <CardContent>
          {log.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <div className="flex flex-col gap-1 max-h-80 overflow-y-auto font-mono text-xs">
              {log.map((entry, i) => (
                <div key={i} className="flex items-baseline gap-2">
                  <span className="text-muted-foreground shrink-0">{entry.time}</span>
                  <span className="flex-1">{entry.label}</span>
                  {entry.delta !== null && (
                    <Badge variant={entry.delta < 0 ? 'destructive' : 'secondary'}>
                      {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                    </Badge>
                  )}
                  {entry.balance !== null && (
                    <span className="tabular-nums shrink-0">→ {entry.balance}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
