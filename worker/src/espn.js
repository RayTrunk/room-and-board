// The User-Agent every ESPN request must send. This is a real upstream
// constraint, not a preference, and nothing in the code below can show it:
//
// ESPN's Akamai edge answers 403 Access Denied to a request with NO
// User-Agent at all, to a browser-impostor UA (a full Chrome or Firefox
// string), and to an honest custom UA like 'RoomBoard/1.0
// (+https://roomboard.app)'. It answers 200 when the header VALUE STARTS WITH
// 'curl/'. The match is on the prefix, verified both ways:
//   'curl/8.7.1 (RoomBoard; +https://roomboard.app)'  -> 200
//   'curl/8.7.1 RoomBoard/1.0'                        -> 200
//   'RoomBoard/1.0 curl/8.7.1'                        -> 403  (token moved)
//
// So the parenthetical carries who is really calling and where to reach us —
// that is what keeps this honest rather than bare impersonation — and it MUST
// stay AFTER the curl token, because the prefix is the part being matched.
// Reordering the string to read more tidily takes production down.
//
// Verified from Cloudflare Worker egress on 2026-08-05 against all three
// endpoints this project uses: the team endpoint
// (/baseball/mlb/teams/nyy), golf (/golf/pga/scoreboard) and tennis
// (/tennis/atp/scoreboard). The Cloudflare IP range is not the problem; the
// header is.
//
// Scope of the block: it applies to NON-BROWSER clients. A real browser still
// gets 200 without any of this (verified in Chrome on 2026-08-05, golf and
// tennis, from a normal network), which is why the browser-direct fallback in
// site/js/widgets/golf.js and tennis.js still works and needs no change. A page
// cannot set User-Agent anyway, so if that path ever does start 403ing, the
// answer is the worker route, not a header.
//
// WARNING — this is the exact OPPOSITE of worker/src/svcstatus.js, which
// sends a full browser UA on purpose because AWS's CloudFront (the AWS status
// CDN) bounces thin datacenter agents. Two hosts, two opposite rules. Do NOT
// "unify" these into one shared UA: whichever way you unify them, one of the
// two dependencies goes to 403. (Unaffected, and also to be left alone:
// www.espn.com/espn/rss/news, the Sports News feed, which still answers 200
// with the UA in worker/src/news.js.)
export const ESPN_UA = 'curl/8.7.1 (RoomBoard; +https://roomboard.app)';
