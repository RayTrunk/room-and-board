// The 6-character setup-code exchange, in one place: mint a code from an
// encoded payload, redeem a code back into a scoped patch, and put what went
// wrong into a sentence the person standing at the board can act on.
//
// This lived at seven call sites and the copies drifted, which is how the
// photo keypad ended up answering every failure with "Code not found": a 503
// from the code service, a dead network and a genuinely expired code all read
// as "you typed it wrong", so the one repair a person would reach for (go back
// to your phone, mint a fresh code) was the one that could not possibly help.
// The video keypad next to it had the discrimination right the whole time.
// Owning the exchange here is what makes that class of drift impossible rather
// than merely fixed today.

import { fetchJSON } from './net.js';
import { WORKER_URL } from './env.js';
import { decodeCode } from './config.js';

// The four failures worth telling apart, because each one implies a different
// next move: mint a new code, wait, check the network, or make the board
// simpler. The worker has more states than this (invalid_json, missing_cfg,
// code_generation_failed); none of them is a distinction a user can act on, so
// they land in 'service_unavailable' along with everything else the service
// failed to answer properly.
export const FAILURE_KINDS = ['not_found', 'rate_limited', 'service_unavailable', 'too_large'];

export class SetupCodeError extends Error {
  constructor(kind, { status = null, cause = null } = {}) {
    super(`setup code ${kind}`);
    this.name = 'SetupCodeError';
    this.kind = kind;
    this.status = status;
    this.cause = cause;
  }
}

// One sentence per failure, no jargon, no status numbers: the board is read
// from a few feet away by someone who did not deploy it. The 404 and 503 lines
// are the ones the video keypad already shipped, kept word for word so nothing
// a user has learned to recognise changes underneath them.
const FAILURE_TEXT = {
  not_found: 'Code not found (codes expire after an hour).',
  rate_limited: 'Too many tries just now. Wait a few seconds and try again.',
  service_unavailable: "Couldn't reach the code service. Check the network and try again.",
  too_large: 'This setup is too big for a code. Remove a few cards and try again.',
};

// Anything that is not one of ours is something we did not anticipate, and the
// honest reading of that is "the service did not do its job".
export function codeFailureText(err) {
  return FAILURE_TEXT[err?.kind] ?? FAILURE_TEXT.service_unavailable;
}

// A NetError carries the HTTP status when the service answered and null when
// it never did (DNS failure, timeout, a worker that simply is not there), and
// a service that never answered is indistinguishable from an unavailable one
// as far as the user's next move goes.
function classify(err) {
  const status = err?.status ?? null;
  const kind = status === 404 ? 'not_found'
    : status === 429 ? 'rate_limited'
    : status === 413 ? 'too_large'
    : 'service_unavailable';
  return new SetupCodeError(kind, { status, cause: err });
}

// Payload in, code out. The payload is an already-encoded config string
// (encodeConfig, encodePhotosCode or encodeVideoCode); this module deliberately
// does not know which, so a new scope needs no change here.
export async function mintCode(payload) {
  try {
    const { code } = await fetchJSON(`${WORKER_URL}/code`, {
      method: 'POST',
      body: JSON.stringify({ cfg: payload }),
    });
    return code;
  } catch (err) {
    throw classify(err);
  }
}

// Code in, scoped patch out: { scope:'photos'|'video', patch } for the
// single-block codes, { scope:'full', cfg } for a whole board. Callers branch
// on scope; deciding what a patch means to a given surface is their business,
// not ours.
export async function redeemCode(code) {
  let encoded;
  try {
    ({ cfg: encoded } = await fetchJSON(`${WORKER_URL}/code/${code}`));
  } catch (err) {
    throw classify(err);
  }
  try {
    return await decodeCode(encoded);
  } catch (err) {
    // The service answered, but the payload will not decode (a truncated
    // write, a code minted by an older wire format). Nothing about the network
    // is wrong and nothing here can repair it, so the only move left is a fresh
    // code, which is exactly what the not_found sentence asks for.
    throw new SetupCodeError('not_found', { cause: err });
  }
}
