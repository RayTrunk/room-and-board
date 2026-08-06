// Builds site/data/teams.json: pickable teams per league from ESPN's public
// API (keyless). Run: node tools/build-teams.js
//
// Same UA rule as the worker: without ESPN_UA every request below 403s, so a
// rebuild would fail outright. Imported rather than copied so there is one
// source of truth (worker/src/espn.js), which is also where the reasoning lives.
import { writeFile } from 'node:fs/promises';
import { ESPN_UA } from '../worker/src/espn.js';

const LEAGUES = {
  mlb: ['baseball', 'mlb', 'MLB'],
  nfl: ['football', 'nfl', 'NFL'],
  nba: ['basketball', 'nba', 'NBA'],
  nhl: ['hockey', 'nhl', 'NHL'],
  mls: ['soccer', 'usa.1', 'MLS'],
  epl: ['soccer', 'eng.1', 'Premier League'],
};

const out = { leagues: [] };
for (const [lg, [sport, slug, label]] of Object.entries(LEAGUES)) {
  const json = await (
    await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${slug}/teams?limit=100`, {
      headers: { 'User-Agent': ESPN_UA },
    })
  ).json();
  const teams = (json.sports?.[0]?.leagues?.[0]?.teams ?? [])
    // nick is ESPN's shortDisplayName: the form a headline actually prints
    // ('Red Sox', 'Spurs', 'Man United'). Sports News matches on it; see
    // teamPhrases for why an MLS nick like 'Seattle' is thrown away again.
    .map(({ team }) => ({ id: String(team.id), abbr: team.abbreviation, name: team.displayName, nick: team.shortDisplayName }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (teams.length < 10) throw new Error(`suspiciously few teams for ${lg}: ${teams.length}`);
  out.leagues.push({ lg, label, sport, slug, teams });
  console.log(`${label}: ${teams.length} teams`);
}
await writeFile(new URL('../site/data/teams.json', import.meta.url), JSON.stringify(out, null, 1));
