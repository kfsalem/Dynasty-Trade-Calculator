import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ZodType } from 'zod';

import { sleeperProvider } from '../../src/platforms/sleeper';
import {
  sleeperBracketSchema,
  sleeperDraftSchema,
  sleeperDraftsSchema,
  sleeperLeagueSchema,
  sleeperMatchupsSchema,
  sleeperRostersSchema,
  sleeperTradedPicksSchema,
  sleeperTransactionsSchema,
  sleeperUsersSchema,
  type SleeperLeague,
  type SleeperRoster,
  type SleeperTransaction,
  type SleeperUser,
  type SleeperDraft,
} from '../../src/platforms/sleeper/schema';
import {
  SAMPLE_FILE,
  SAMPLE_LEAGUE_ID,
  type SampleFile,
} from '../../src/platforms/sleeper/sample';

/**
 * The sample league a visitor can try the app with (#159).
 *
 * Recorded by running the app's own provider against a real league and
 * keeping every league-scoped response it fetched, so the recording holds
 * exactly what the app asks for and nothing has to be listed twice. Then
 * anonymised, and checked for leaks before it is written.
 *
 * **What anonymising means here.** Every response is first parsed with the
 * schema the app reads it with, which drops every field the app does not
 * name: avatars, co-owners, metadata, notes. What survives and could identify
 * someone is rewritten: league and draft ids, the league's name, each user's
 * id, display name and team name, and transaction ids. Then every one of the
 * original values is searched for in the output, and a single hit discards
 * the run rather than publishing it.
 *
 * Players, scores, rosters and trades are kept as they are. They are the
 * point of the sample, and none of them names a manager.
 *
 * Failure policy is the track record's: nothing here fails a build. The
 * committed copy is a complete sample a week older.
 */

/** The league recorded. One of the two track-record leagues, whose ids are already public. */
export const SAMPLE_SOURCE_LEAGUE = '1336802780030988288';

/** Invented, and checked against nothing real. Sixteen covers Sleeper's largest league. */
export const SAMPLE_TEAM_NAMES = [
  'Harbor Lights',
  'Copper Canyon',
  'North Ridge',
  'Lantern Hill',
  'Salt Flats',
  'Cedar Point Owls',
  'Ironwood',
  'Blue Mesa',
  'Old Mill',
  'Foxglove',
  'Tidewater',
  'Granite Bay',
  'Kestrel Park',
  'Juniper Row',
  'Stillwater',
  'Briar Patch',
] as const;

const SCHEMAS: [RegExp, ZodType<unknown>][] = [
  [/^\/league\/[^/]+$/, sleeperLeagueSchema],
  [/^\/league\/[^/]+\/rosters$/, sleeperRostersSchema],
  [/^\/league\/[^/]+\/users$/, sleeperUsersSchema],
  [/^\/league\/[^/]+\/traded_picks$/, sleeperTradedPicksSchema],
  [/^\/league\/[^/]+\/drafts$/, sleeperDraftsSchema],
  [/^\/league\/[^/]+\/matchups\/\d+$/, sleeperMatchupsSchema],
  [/^\/league\/[^/]+\/transactions\/\d+$/, sleeperTransactionsSchema],
  [/^\/league\/[^/]+\/(winners|losers)_bracket$/, sleeperBracketSchema],
  [/^\/draft\/[^/]+$/, sleeperDraftSchema],
];

function schemaFor(path: string): ZodType<unknown> | null {
  return SCHEMAS.find(([pattern]) => pattern.test(path))?.[1] ?? null;
}

export interface Anonymised {
  file: SampleFile;
  /** Every original value that was rewritten, for the leak check. */
  secrets: string[];
}

/**
 * Rewrite recorded responses into the sample.
 *
 * `recorded` is keyed by path under `/v1`. Responses outside the source's own
 * season chain are dropped, so a stray request cannot carry another league in.
 */
export function anonymise(
  sourceLeagueId: string,
  recorded: ReadonlyMap<string, unknown>,
  generatedAt: string,
): Anonymised {
  const parsed = new Map<string, unknown>();
  for (const [path, body] of recorded) {
    const schema = schemaFor(path);
    if (!schema) continue;
    const result = schema.safeParse(body);
    if (result.success) parsed.set(path, result.data);
  }

  // The season chain, newest first: sample, sample-1, sample-2, …
  const leagueIds = new Map<string, string>();
  const leagues: SleeperLeague[] = [];
  let next: string | null | undefined = sourceLeagueId;
  while (next && next !== '0' && !leagueIds.has(next)) {
    const league = parsed.get(`/league/${next}`) as SleeperLeague | undefined;
    if (!league) break;
    leagueIds.set(next, leagues.length === 0 ? SAMPLE_LEAGUE_ID : `${SAMPLE_LEAGUE_ID}-${leagues.length}`);
    leagues.push(league);
    next = league.previous_league_id;
  }
  if (leagues.length === 0) throw new Error(`no recording of league ${sourceLeagueId}`);

  // Users are numbered by their roster in the current season, so the sample's
  // team 1 is roster 1, and then in order of appearance going back. A manager
  // keeps one id across seasons on Sleeper, and so keeps one name here.
  const userIds = new Map<string, string>();
  const userNumber = new Map<string, number>();
  const addUser = (id: string | null | undefined) => {
    if (!id || userIds.has(id)) return;
    const n = userIds.size + 1;
    userIds.set(id, `${SAMPLE_LEAGUE_ID}-user-${n}`);
    userNumber.set(id, n);
  };
  for (const leagueId of leagueIds.keys()) {
    const rosters = (parsed.get(`/league/${leagueId}/rosters`) as SleeperRoster[] | undefined) ?? [];
    for (const roster of [...rosters].sort((a, b) => a.roster_id - b.roster_id)) {
      addUser(roster.owner_id);
    }
    const users = (parsed.get(`/league/${leagueId}/users`) as SleeperUser[] | undefined) ?? [];
    for (const user of users) addUser(user.user_id);
  }

  const draftIds = new Map<string, string>();
  const addDraft = (id: string) => {
    if (!draftIds.has(id)) draftIds.set(id, `${SAMPLE_LEAGUE_ID}-draft-${draftIds.size + 1}`);
  };
  for (const leagueId of leagueIds.keys()) {
    const drafts = (parsed.get(`/league/${leagueId}/drafts`) as SleeperDraft[] | undefined) ?? [];
    for (const draft of drafts) addDraft(draft.draft_id);
  }

  const secrets = new Set<string>([...leagueIds.keys(), ...draftIds.keys(), ...userIds.keys()]);
  const user = (id: string | null | undefined) => (id ? (userIds.get(id) ?? null) : null);
  const teamName = (id: string) =>
    SAMPLE_TEAM_NAMES[((userNumber.get(id) ?? 1) - 1) % SAMPLE_TEAM_NAMES.length];

  let transactions = 0;
  const responses: Record<string, unknown> = {};

  for (const [path, body] of parsed) {
    const [, kind, id, ...rest] = path.split('/');
    const mappedId = kind === 'league' ? leagueIds.get(id) : draftIds.get(id);
    if (!mappedId) continue;
    const endpoint = rest.join('/');
    const out = `/${kind}/${mappedId}${endpoint ? `/${endpoint}` : ''}`;

    if (kind === 'draft') {
      responses[out] = { ...(body as SleeperDraft), draft_id: mappedId };
    } else if (endpoint === '') {
      const league = body as SleeperLeague;
      if (league.name) secrets.add(league.name);
      if (league.avatar) secrets.add(league.avatar);
      const previous = league.previous_league_id;
      responses[out] = {
        ...league,
        league_id: mappedId,
        name: 'Sample League',
        avatar: null,
        previous_league_id: previous && leagueIds.has(previous) ? leagueIds.get(previous) : null,
      };
    } else if (endpoint === 'users') {
      responses[out] = (body as SleeperUser[]).map((u) => {
        if (u.display_name) secrets.add(u.display_name);
        if (u.avatar) secrets.add(u.avatar);
        if (u.metadata?.team_name) secrets.add(u.metadata.team_name);
        return {
          user_id: user(u.user_id),
          display_name: `Manager ${userNumber.get(u.user_id)}`,
          avatar: null,
          metadata: { team_name: teamName(u.user_id) },
        };
      });
    } else if (endpoint === 'rosters') {
      responses[out] = (body as SleeperRoster[]).map((r) => ({ ...r, owner_id: user(r.owner_id) }));
    } else if (endpoint === 'drafts') {
      responses[out] = (body as SleeperDraft[]).map((d) => ({
        ...d,
        draft_id: draftIds.get(d.draft_id),
      }));
    } else if (endpoint.startsWith('transactions/')) {
      responses[out] = (body as SleeperTransaction[]).map((t) => {
        secrets.add(t.transaction_id);
        if (t.creator) secrets.add(t.creator);
        return {
          ...t,
          transaction_id: `${SAMPLE_LEAGUE_ID}-tx-${++transactions}`,
          creator: user(t.creator),
        };
      });
    } else {
      // Matchups, brackets and traded picks hold roster ids and player ids only.
      responses[out] = body;
    }
  }

  return {
    file: { generatedAt, season: leagues[0].season, responses },
    secrets: [...secrets],
  };
}

/** Every original value found in the output. Empty, or the run is discarded. */
export function leaks(file: SampleFile, secrets: readonly string[]): string[] {
  const text = JSON.stringify(file).toLowerCase();
  return secrets.filter((secret) => {
    const value = secret.trim().toLowerCase();
    // A display name of one or two characters would match noise, not a person.
    return value.length >= 3 && text.includes(JSON.stringify(value));
  });
}

const SLEEPER_V1 = 'https://api.sleeper.app/v1';

/**
 * Run `work` with every Sleeper `/v1` league or draft response it fetches
 * recorded, keyed by path.
 */
async function recording(work: () => Promise<unknown>): Promise<Map<string, unknown>> {
  const recorded = new Map<string, unknown>();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const res = await realFetch(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (res.ok && url.startsWith(SLEEPER_V1)) {
      const path = url.slice(SLEEPER_V1.length);
      if (/^\/(league|draft)\//.test(path)) {
        recorded.set(path, await res.clone().json().catch(() => undefined));
      }
    }
    return res;
  };
  try {
    await work();
  } finally {
    globalThis.fetch = realFetch;
  }
  return recorded;
}

export async function ingestSampleLeague(outDir: string, generatedAt: string): Promise<void> {
  const path = `${outDir}${SAMPLE_FILE}`;
  try {
    const recorded = await recording(() =>
      Promise.all([
        sleeperProvider.loadLeague(SAMPLE_SOURCE_LEAGUE),
        sleeperProvider.loadHistory!(SAMPLE_SOURCE_LEAGUE),
        sleeperProvider.loadTransactions!(SAMPLE_SOURCE_LEAGUE),
      ]),
    );
    const { file, secrets } = anonymise(SAMPLE_SOURCE_LEAGUE, recorded, generatedAt);
    const found = leaks(file, secrets);
    if (found.length > 0) {
      throw new Error(`${found.length} original values survived anonymising; not written`);
    }
    const text = `${JSON.stringify(file)}\n`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
    console.log(
      `  sample league  ${Object.keys(file.responses).length} responses, ` +
        `${(text.length / 1024).toFixed(1)} KB`,
    );
  } catch (err) {
    const kept = await readFile(path, 'utf8').then(
      () => 'keeping the committed copy',
      () => 'no committed copy',
    );
    console.warn(`  sample league  ${err instanceof Error ? err.message : String(err)} — ${kept}`);
  }
}
