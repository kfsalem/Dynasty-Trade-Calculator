import type { PlayerRole, Role } from '../engine/role';

/**
 * How a player's role reads in prose, shared by the badge and the snap
 * tooltip so the two can never describe the same player differently.
 */
const ROLE_WORDS: Record<Role, string> = {
  starter: 'Starts',
  rotational: 'Rotates',
  backup: 'Backup',
  inactive: 'Did not play',
};

const pct = (share: number): string => `${Math.round(share * 100)}%`;

export function describeRole(role: PlayerRole, chartSeason: number | null): string {
  const played =
    role.share === null
      ? 'No snaps on record'
      : `${ROLE_WORDS[role.role]} — ${pct(role.share)} of snaps`;

  if (!role.chart) return `${played}. Not on a published depth chart.`;

  // Team and position codes are abbreviations and stay upper case, so the
  // sentence is built in both cases rather than lowercased after the fact.
  const spot = `${role.chart.team} ${role.chart.pos}${role.chart.rank}`;
  const chart = chartSeason ? `the ${chartSeason} chart` : 'the depth chart';

  if (role.disagreement === 'plays-more') {
    return `${played}, but ${chart} lists him ${spot} — he is playing well past where his team puts him.`;
  }
  if (role.disagreement === 'plays-less') {
    return `${played}, but ${chart} lists him ${spot}, a starting spot — the job is not really his.`;
  }

  return `${played}. Listed ${spot} on ${chart}.`;
}
