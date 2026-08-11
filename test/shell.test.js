import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chooseBootConfig } from '../site/js/boot.js';
import { parseFragment } from '../site/js/bridge.js';
import { greetingFor } from '../site/js/widgets/clock.js';
import { normalizeConfig, encodeConfig } from '../site/js/config.js';
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

describe('parseFragment', () => {
  it('extracts cfg and auth from the hash', async () => {
    const enc = await encodeConfig(normalizeConfig({ name: 'Sean' }));
    const auth = btoa(JSON.stringify({ u: 'bridge', p: 'secret', ip: '10.0.0.5' }))
      .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const out = parseFragment(`#cfg=${enc}&auth=${auth}`);
    expect(out.cfg).toBe(enc);
    expect(out.auth).toEqual({ u: 'bridge', p: 'secret', ip: '10.0.0.5' });
  });
  it('tolerates empty, partial and malformed hashes', () => {
    expect(parseFragment('')).toEqual({ cfg: null, auth: null });
    expect(parseFragment('#')).toEqual({ cfg: null, auth: null });
    expect(parseFragment('#cfg=abc')).toEqual({ cfg: 'abc', auth: null });
    expect(parseFragment('#auth=!!!bad')).toEqual({ cfg: null, auth: null });
    expect(parseFragment('#demo=1&cfg=x')).toEqual({ cfg: 'x', auth: null });
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
