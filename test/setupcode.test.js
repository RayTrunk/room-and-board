import { describe, it, expect, vi, afterEach } from 'vitest';
import { mintCode, redeemCode, codeFailureText, SetupCodeError, FAILURE_KINDS } from '../site/js/setupcode.js';
import { encodeConfig, encodePhotosCode, encodeVideoCode, normalizeConfig } from '../site/js/config.js';
import { WORKER_URL } from '../site/js/env.js';

// The exchange used to be hand-rolled at seven call sites, and the copies
// disagreed about what a failure meant: one keypad called every failure an
// expired code. These tests pin the discrimination itself, so a surface that
// wires up the module gets the right sentence without having to be tested for
// it one at a time.

// A worker that answers. `json` is only consulted on a 2xx, exactly as
// net.js's fetchJSON does it.
const answers = (status, body = {}) => vi.fn(async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
}));
// A worker that never answers at all: DNS gone, cable out, no deployment.
const unreachable = () => vi.fn(async () => { throw new TypeError('Failed to fetch'); });

afterEach(() => vi.unstubAllGlobals());

describe('minting a code', () => {
  it('posts the encoded payload and hands back the code', async () => {
    const fetchMock = answers(200, { code: 'K7QM2X', expiresInSeconds: 3600 });
    vi.stubGlobal('fetch', fetchMock);
    expect(await mintCode('~P~abc')).toBe('K7QM2X');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${WORKER_URL}/code`);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ cfg: '~P~abc' });
  });

  it('does not care which encoder made the payload', async () => {
    vi.stubGlobal('fetch', answers(200, { code: 'AAAAAA' }));
    for (const payload of [
      await encodeConfig(normalizeConfig({})),
      await encodePhotosCode({ icloud: 'B0xYzabc123' }),
      await encodeVideoCode({ url: 'https://example.com/live.m3u8' }),
    ]) expect(await mintCode(payload)).toBe('AAAAAA');
  });

  it.each([
    [429, 'rate_limited'],
    [413, 'too_large'],
    [503, 'service_unavailable'],
    [500, 'service_unavailable'], // code_generation_failed: nothing a user can act on
    [400, 'service_unavailable'], // a malformed post is our bug, not their typo
  ])('turns HTTP %i into a %s failure', async (status, kind) => {
    vi.stubGlobal('fetch', answers(status));
    const err = await mintCode('~P~abc').then(() => null, (e) => e);
    expect(err).toBeInstanceOf(SetupCodeError);
    expect(err.kind).toBe(kind);
    expect(err.status).toBe(status);
  });

  it('reads a worker that never answered as unavailable, not as a bad code', async () => {
    vi.stubGlobal('fetch', unreachable());
    const err = await mintCode('~P~abc').then(() => null, (e) => e);
    expect(err.kind).toBe('service_unavailable');
    expect(err.status).toBe(null);
  });
});

describe('redeeming a code', () => {
  it('returns a photos patch, a video patch, or a full config, by scope', async () => {
    const cases = [
      [await encodePhotosCode({ icloud: 'B0xYzabc123' }), 'photos'],
      [await encodeVideoCode({ url: 'https://example.com/live.m3u8' }), 'video'],
      [await encodeConfig(normalizeConfig({ name: 'Front desk' })), 'full'],
    ];
    for (const [cfg, scope] of cases) {
      const fetchMock = answers(200, { cfg });
      vi.stubGlobal('fetch', fetchMock);
      const out = await redeemCode('K7QM2X');
      expect(out.scope).toBe(scope);
      expect(fetchMock.mock.calls[0][0]).toBe(`${WORKER_URL}/code/K7QM2X`);
    }
  });

  it('carries the patch through intact', async () => {
    vi.stubGlobal('fetch', answers(200, { cfg: await encodeVideoCode({ url: 'https://example.com/live.m3u8', label: 'Lobby' }) }));
    expect((await redeemCode('K7QM2X')).patch).toEqual({ url: 'https://example.com/live.m3u8', label: 'Lobby' });
  });

  it.each([
    [404, 'not_found'],
    [429, 'rate_limited'],
    [503, 'service_unavailable'],
  ])('turns HTTP %i into a %s failure', async (status, kind) => {
    vi.stubGlobal('fetch', answers(status));
    const err = await redeemCode('K7QM2X').then(() => null, (e) => e);
    expect(err).toBeInstanceOf(SetupCodeError);
    expect(err.kind).toBe(kind);
  });

  it('separates an expired code from a code service that is down', async () => {
    // The whole point of the module. Same keypad, same six characters, two
    // different repairs: mint a new code, or go find out why the network is out.
    vi.stubGlobal('fetch', answers(404));
    const expired = await redeemCode('K7QM2X').then(() => null, (e) => e);
    vi.stubGlobal('fetch', answers(503));
    const down = await redeemCode('K7QM2X').then(() => null, (e) => e);
    vi.stubGlobal('fetch', unreachable());
    const offline = await redeemCode('K7QM2X').then(() => null, (e) => e);
    expect(codeFailureText(expired)).toBe('Code not found (codes expire after an hour).');
    expect(codeFailureText(down)).toBe(codeFailureText(offline));
    expect(codeFailureText(down)).not.toBe(codeFailureText(expired));
  });

  it('treats a payload that will not decode as a code to replace', async () => {
    // The service answered, so the network is fine; the stored value is junk.
    // A fresh code is the only repair, which is what not_found already says.
    vi.stubGlobal('fetch', answers(200, { cfg: 'not-a-real-payload' }));
    const err = await redeemCode('K7QM2X').then(() => null, (e) => e);
    expect(err).toBeInstanceOf(SetupCodeError);
    expect(err.kind).toBe('not_found');
  });
});

describe('the sentence a failure gets', () => {
  it('gives every kind its own plain sentence', () => {
    const texts = FAILURE_KINDS.map((kind) => codeFailureText(new SetupCodeError(kind)));
    expect(texts).toEqual([
      'Code not found (codes expire after an hour).',
      'Too many tries just now. Wait a few seconds and try again.',
      "Couldn't reach the code service. Check the network and try again.",
      'This setup is too big for a code. Remove a few cards and try again.',
    ]);
    expect(new Set(texts).size).toBe(FAILURE_KINDS.length); // no two failures read alike
  });

  it('keeps the copy fit for a wall: no dashes, no status codes, no jargon', () => {
    for (const kind of FAILURE_KINDS) {
      const text = codeFailureText(new SetupCodeError(kind));
      expect(text).not.toMatch(/[—–]/); // the page rule, same as changelog.test.js
      expect(text).not.toMatch(/\b(HTTP|4\d\d|5\d\d|worker|KV|JSON)\b/i);
      expect(text.trim()).toBe(text);
      expect(text).toMatch(/\.$/);
    }
  });

  it('falls back to unavailable for anything it was never told about', () => {
    // A stray TypeError from a caller's own code should still leave a sentence
    // on the screen rather than a blank status line.
    for (const stray of [undefined, null, new Error('boom'), { kind: 'invented' }]) {
      expect(codeFailureText(stray)).toBe("Couldn't reach the code service. Check the network and try again.");
    }
  });
});
