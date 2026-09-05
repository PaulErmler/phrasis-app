import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  bytesToBase64,
  transcribeAudioWithGemini,
  transcriptionPrompt,
} from '../../../lib/stt/gemini';
import { transcribeAudio, sttModelForLanguage } from '../../../lib/stt';
import { SttRejectedContainerError } from '../../../lib/stt/openrouter';
import { WAV_HEADER, WEBM_HEADER, openrouterSttBody } from '../sttFixtures';

/**
 * The Gemini STT wire contract (chat completion with `input_audio`), how
 * the reply maps onto TranscriptionResult, and the per-language dispatch
 * in lib/stt/index.ts.
 */

function chatBody(content: string, cost = 0.00015): string {
  return JSON.stringify({
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 162, completion_tokens: 28, cost },
  });
}

function okResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const wavBlob = () => new Blob([WAV_HEADER], { type: 'audio/wav' });

describe('lib/stt/gemini transcribeAudioWithGemini', () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  });

  it('posts the clip as input_audio with the language pinned in the prompt', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(chatBody('Salom! Qalaysan?')));

    const result = await transcribeAudioWithGemini(wavBlob(), 'uz');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init as RequestInit).headers).toEqual({
      Authorization: 'Bearer test-openrouter-key',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('google/gemini-3.1-flash-lite');
    expect(body.usage).toEqual({ include: true });
    expect(body.temperature).toBe(0);
    const [textPart, audioPart] = body.messages[0].content;
    expect(textPart.text).toContain('Uzbek (Latin script)');
    expect(audioPart.type).toBe('input_audio');
    expect(audioPart.input_audio.format).toBe('wav');
    expect(audioPart.input_audio.data).toBe(bytesToBase64(WAV_HEADER));

    expect(result).toEqual({
      text: 'Salom! Qalaysan?',
      wordTimings: [],
      costUsd: 0.00015,
      detectedLanguage: 'uz',
    });
  });

  it('strips quotes and code fences the model wraps the transcript in', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse(chatBody('```\n"Salom, qalaysan?"\n```')),
    );
    const result = await transcribeAudioWithGemini(wavBlob(), 'uz');
    expect(result.text).toBe('Salom, qalaysan?');
  });

  it('throws on an empty transcript instead of returning silence', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(chatBody('   ')));
    await expect(transcribeAudioWithGemini(wavBlob(), 'uz')).rejects.toThrow(
      /no transcript/,
    );
  });

  it('rejects WebM before uploading anything', async () => {
    const webm = new Blob([WEBM_HEADER], { type: 'audio/webm' });
    await expect(transcribeAudioWithGemini(webm, 'uz')).rejects.toBeInstanceOf(
      SttRejectedContainerError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries a 503 and fails fast on a 400', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(okResponse(chatBody('Salom.')));
    const result = await transcribeAudioWithGemini(wavBlob(), 'uz', {
      maxRetries: 1,
    });
    expect(result.text).toBe('Salom.');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 400 }));
    await expect(transcribeAudioWithGemini(wavBlob(), 'uz')).rejects.toThrow(
      /400/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bytesToBase64 matches Buffer for a chunk-crossing payload', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 251);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('transcriptionPrompt falls back to auto-detect wording without a language', () => {
    expect(transcriptionPrompt()).toMatch(/language that is spoken/);
    expect(transcriptionPrompt('uz')).toMatch(/Uzbek \(Latin script\)/);
  });
});

describe('lib/stt transcribeAudio dispatch', () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  });

  it('sends Gemini-routed languages to chat completions and the rest to MAI', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(chatBody('Salom.')));
    await transcribeAudio(wavBlob(), 'uz');
    expect(fetchMock.mock.calls[0][0]).toContain('/chat/completions');

    fetchMock.mockResolvedValueOnce(okResponse(openrouterSttBody('hola')));
    await transcribeAudio(wavBlob(), 'es');
    expect(fetchMock.mock.calls[1][0]).toContain('/audio/transcriptions');
  });

  it('auto-detect (no language) always runs on MAI', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(openrouterSttBody('hola')));
    await transcribeAudio(wavBlob());
    expect(fetchMock.mock.calls[0][0]).toContain('/audio/transcriptions');
  });

  it('labels cost events with the backend model', () => {
    expect(sttModelForLanguage('uz')).toBe('google/gemini-3.1-flash-lite');
    expect(sttModelForLanguage('es')).toBe('microsoft/mai-transcribe-2');
    expect(sttModelForLanguage()).toBe('microsoft/mai-transcribe-2');
  });
});
