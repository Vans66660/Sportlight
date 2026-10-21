# Open Tournaments Core Schema

Sportlight uses WeChat Cloud Database collections. The Open Tournaments module stores tournament state on the existing `posts` event document and links to existing registrations.

## posts

Acts as `Tournament`.

```js
{
  _id,
  postType: 'event',
  openid,                  // organizer openid
  title,
  sport: 'football' | 'basketball' | '足球' | '篮球',
  openTournament: {
    format: 'league' | 'cup_groups',
    sport: 'football' | 'basketball',
    status: 'draft' | 'active' | 'finished',
    isDoubleLoop: Boolean,
    groupCount: Number,
    teams: OpenTournamentTeam[],
    groups: [{ groupId, groupName, teamIds }],
    matches: OpenTournamentMatch[],
    standings: { league?: StandingRow[], [groupId]: StandingRow[] },
    leaderboards: {
      football: { goals: StatRow[], assists: StatRow[], cards: CardRow[] },
      basketball: { points: StatRow[], rebounds: StatRow[], assists: StatRow[] }
    },
    updatedAt
  }
}
```

## event_registrations

Acts as `Registration` and source of selectable teams.

```js
{
  _id,
  postId,                  // Tournament id
  teamName,
  captainOpenid,
  members: [{ openid, name, role, position }],
  memberOpenids,
  status: 'approved',      // required for Home/Away selection
  paymentStatus
}
```

## OpenTournamentMatch

Logical `Match` table stored inside `posts.openTournament.matches`.

```js
{
  matchId,
  round_number,
  group_id,                // null for league
  group_name,
  home_team_id,
  away_team_id,
  home_team_name,
  away_team_name,
  match_time,
  venue,
  status: 'not_started' | 'in_progress' | 'finished',
  football: {
    homeScore,
    awayScore,
    events: [
      { type: 'goal' | 'assist' | 'yellow_card' | 'red_card', teamId, playerOpenid, playerName, minute }
    ]
  },
  basketball: {
    quarters: [{ home, away }],
    homeScore,
    awayScore,
    playerStats: [
      { teamId, playerOpenid, playerName, points, rebounds, assists }
    ]
  }
}
```

## Player Stats

`Player_Stats` is materialized as derived leaderboard arrays in `posts.openTournament.leaderboards`. Recalculation happens after every match update, so the match list remains the source of truth.
