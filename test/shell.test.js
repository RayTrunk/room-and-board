import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chooseBootConfig, fragmentConfig } from '../site/js/boot.js';
import { greetingFor } from '../site/js/widgets/clock.js';
import { normalizeConfig, encodeConfig, decodeConfig } from '../site/js/config.js';
import { CATALOG_IDS } from '../site/js/catalog.js';

// What the deleted registry.js was really for. It held a Map, a register loop
// and a getter, and the only thing that could go wrong with any of it was a
// widget module that never got wired up, which is a fact about main.js's
// MODULES list, not about a Map. So this reads main.js and asks that question
// directly: the boot script must run exactly the cards the catalogue names.
// A missing module is a card the layout can place and nothing can render; an
// extra one is a module nobody can ever reach.
//
// Read as text rather than imported: main.js boots the board at module scope.
const main = readFileSync(resolve(process.cwd(), 'site/js/main.js'), 'utf8');

describe('main.js wires exactly the catalogue', () => {
  // `import * as pathw from './widgets/path.js'`: local name to module file,
  // because two of them are renamed around JS keywords and globals.
  const importedAs = new Map(
    [...main.matchAll(/import \* as (\w+) from '\.\/widgets\/([\w-]+)\.js'/g)].map((m) => [m[1], m[2]]),
  );
  const listed = (main.match(/const MODULES = \[([^\]]*)\]/) ?? [])[1]
    ?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];

  it('runs one widget module per catalogue id, and no others', () => {
    expect(listed.length, 'MODULES did not parse').toBeGreaterThan(0);
    const ids = listed.map((name) => {
      expect(importedAs.has(name), `MODULES lists ${name}, which is not an imported widget`).toBe(true);
      return importedAs.get(name);
    });
    expect([...ids].sort()).toEqual([...CATALOG_IDS].sort());
  });

  it('has a module file on disk for every card', () => {
    for (const id of CATALOG_IDS) {
      expect(existsSync(resolve(process.cwd(), `site/js/widgets/${id}.js`)), `no widget module for ${id}`).toBe(true);
    }
  });
});

describe('chooseBootConfig', () => {
  const older = normalizeConfig({ name: 'Old', t: 100 });
  const newer = normalizeConfig({ name: 'New', t: 200 });
  it('prefers the newest source and reports it', () => {
    expect(chooseBootConfig(newer, older)).toEqual({ cfg: newer, source: 'fragment' });
    expect(chooseBootConfig(older, newer)).toEqual({ cfg: newer, source: 'local' });
    expect(chooseBootConfig(null, older)).toEqual({ cfg: older, source: 'local' });
    expect(chooseBootConfig(older, null)).toEqual({ cfg: older, source: 'fragment' });
    expect(chooseBootConfig(null, null)).toEqual({ cfg: null, source: 'none' });
  });
});

// The board's recovery path: a wiped web store is repaired from the `#cfg=` the
// signage URL carries, so this parse is load-bearing on every boot that follows
// one. It has to survive a real encoded config intact — base64url is `-`/`_`,
// both of which a sloppier reader could mangle — and it has to stay incurious
// about every other fragment key, including the `auth` credentials early macro
// builds carried for the removed page↔device bridge.
describe('fragmentConfig', () => {
  it('extracts an encoded config from the hash, byte for byte', async () => {
    const enc = await encodeConfig(normalizeConfig({ name: 'Sean' }));
    expect(fragmentConfig(`#cfg=${enc}`)).toBe(enc);
    expect(fragmentConfig(`#cfg=${enc}&demo=1`)).toBe(enc);
  });
  it('tolerates empty, partial and malformed hashes', () => {
    expect(fragmentConfig('')).toBeNull();
    expect(fragmentConfig('#')).toBeNull();
    expect(fragmentConfig('#cfg=abc')).toBe('abc');
    expect(fragmentConfig('#demo=1&cfg=x')).toBe('x');
  });
  it('ignores every other key, the retired `auth` credentials included', () => {
    expect(fragmentConfig('#auth=!!!bad')).toBeNull();
    const auth = btoa(JSON.stringify({ u: 'bridge', p: 'secret', ip: '10.0.0.5' }))
      .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    expect(fragmentConfig(`#cfg=abc&auth=${auth}`)).toBe('abc');
  });
});

// The re-seed, end to end, in the order boot() does it: a board whose web
// storage was wiped has nothing but the URL it is pinned to, and these four
// steps are how it comes back. The pieces are each covered above; this is here
// because the failure that matters is a seam between them — the parse moved out
// of the deleted bridge.js on 2026-08-21, and a board that boots to the welcome
// screen instead of its dashboard is the thing nobody would notice in a unit
// test and everybody would notice on a wall.
describe('a wiped board re-seeds itself from its signage URL', () => {
  it('parses, decodes and chooses the fragment config when storage is empty', async () => {
    const cfg = normalizeConfig({ name: 'Studio', t: 1_700_000_000 });
    const url = `https://unsleep.app/#cfg=${await encodeConfig(cfg)}`;

    const encoded = fragmentConfig(new URL(url).hash);
    const chosen = chooseBootConfig(await decodeConfig(encoded), null); // null: storage wiped

    expect(chosen.source).toBe('fragment'); // main.js repair-saves on exactly this
    expect(chosen.cfg).toEqual(cfg);
  });

  it('still defers to a newer config the board saved for itself', async () => {
    // The fragment is a floor, not a ceiling: edits made at the board carry a
    // fresher stamp than the URL and must survive the next reload.
    const fromUrl = normalizeConfig({ name: 'As shipped', t: 1_700_000_000 });
    const edited = normalizeConfig({ name: 'As edited', t: 1_700_000_999 });

    const encoded = fragmentConfig(`#cfg=${await encodeConfig(fromUrl)}`);
    const chosen = chooseBootConfig(await decodeConfig(encoded), edited);

    expect(chosen.source).toBe('local');
    expect(chosen.cfg.name).toBe('As edited');
  });
});

// RULE (2026-08-21, decided when the dead device-bridge client was removed):
// macro/Dashboard.js is the ONLY code in this repo that touches the RoomOS
// xAPI. It sets the signage URL and the device settings signage needs, and
// that is the entire device-facing surface. Nothing shipped to a browser —
// not the board's page, not the phone setup wizard, not the Worker — may talk
// to a device API, because everything that ever did was a back-channel that no
// board used and that carried credentials in a URL to reach.
//
// This reads the trees rather than trusting a grep at review time, since the
// way this comes back is one lazy import() nobody notices. RUNTIME shapes
// only: `xConfiguration ...` lines appear in site/info.html and in setup.js's
// comments as instructions a person pastes into their own board, and those are
// documentation, not a call.
describe('only the macro touches the RoomOS xAPI', () => {
  const FORBIDDEN = [
    [/from\s+['"]xapi['"]/, "import from 'xapi'"],
    [/\bxapi\s*\.\s*(Command|Config|Status|Event)\b/, 'xapi.<domain> call'],
    [/\bUserManagement\s*\.\s*User\b/, 'UserManagement.User (device account minting)'],
    [/\bconnectBridge\b/, 'connectBridge (removed device back-channel)'],
    [/\bisBridgeHost\b/, 'isBridgeHost (removed device back-channel)'],
  ];

  // site/js/vendor is third-party and not ours to police.
  const sources = (dir, out = []) => {
    for (const e of readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })) {
      if (e.name === 'vendor') continue;
      if (e.isDirectory()) sources(`${dir}/${e.name}`, out);
      else if (e.name.endsWith('.js')) out.push(`${dir}/${e.name}`);
    }
    return out;
  };

  it('finds no device-API call in site/js or worker/src', () => {
    const files = [...sources('site/js'), ...sources('worker/src')];
    expect(files.length).toBeGreaterThan(50); // the walk actually walked
    const offences = [];
    for (const f of files) {
      const src = readFileSync(resolve(process.cwd(), f), 'utf8');
      for (const [re, what] of FORBIDDEN) if (re.test(src)) offences.push(`${f}: ${what}`);
    }
    expect(offences).toEqual([]);
  });

  it('leaves the macro as the one place that does', () => {
    const macro = readFileSync(resolve(process.cwd(), 'macro/Dashboard.js'), 'utf8');
    expect(macro).toMatch(/from\s+['"]xapi['"]/);
    // ...and even there, no account minting: the macro went standalone.
    expect(macro).not.toMatch(/UserManagement/);
  });
});

describe('greetingFor', () => {
  it('varies by hour and includes the name when set', () => {
    expect(greetingFor('Sean', new Date(2026, 6, 2, 8))).toBe('Good morning, Sean');
    expect(greetingFor('Sean', new Date(2026, 6, 2, 13))).toBe('Good afternoon, Sean');
    expect(greetingFor('Sean', new Date(2026, 6, 2, 19))).toBe('Good evening, Sean');
    expect(greetingFor('', new Date(2026, 6, 2, 19))).toBe('Good evening');
  });
});
