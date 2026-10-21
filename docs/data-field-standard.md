# Sportlight 比赛数据字段标准

## 原则

- 以 `applyCompetitionScoreForMatch` 当前实际读取的竞技积分字段为唯一主口径。
- 新写入的文档只使用下表中的标准字段。
- 历史别名只用于读取兼容，不得继续写入。
- 所有统计值均为大于或等于 0 的数字；未发生或未记录时存储为 `0`。

## 足球标准字段

| 中文 | 个人汇总字段 | 比赛事件 `type` | 默认权重 |
|---|---|---|---:|
| 进球 | `goals` | `goal` | 5 |
| 助攻 | `assists` | `assist` | 3.5 |
| 射正 | `shotsOnTarget` | `shot_on_target` | 1.2 |
| 成功过人 | `successfulDribbles` | `successful_dribble` | 1 |
| 关键直塞 | `throughBalls` | `through_ball` | 1.8 |
| 关键传球 | `keyPasses` | `key_pass` | 1.5 |
| 成功抢断 | `successfulTackles` | `successful_tackle` | 1.2 |
| 扑救 | `saves` | `save` | 1.5 |
| 黄牌 | `yellowCards` | `yellow_card` | -1.5 |
| 红牌 | `redCards` | `red_card` | -6 |

正式公开赛比赛原始数据存在 `posts.openTournament.matches[].football.events[]`，每个事件至少应包含：

```js
{
  type: 'key_pass',
  playerOpenid: '...',
  playerName: '...',
  teamId: '...',
  minute: 36,
  count: 1
}
```

积分计算后的单场个人汇总存在 `competitionScoreLogs[].footballStats`，必须使用上表的驼峰式字段。

## 兼容的历史别名

| 标准字段 | 只读兼容别名 |
|---|---|
| `goals` | `goal` |
| `assists` | `assist` |
| `shotsOnTarget` | `shots`, `shot_on_target` |
| `successfulDribbles` | `dribbles`, `successful_dribble` |
| `throughBalls` | `throughBall`, `through_ball` |
| `keyPasses` | `keyPass`, `key_pass` |
| `successfulTackles` | `tackles`, `successful_tackle` |
| `saves` | `save`, `keeperSaves` |
| `yellowCards` | `yellowCard`, `yellow_card` |
| `redCards` | `redCard`, `red_card` |

`rating` 、`score`、`error`、`mistakes` 和旧版详细统计不属于当前足球竞技积分标准，不得在新录入页面中作为计分字段出现。

## 篮球标准字段

`points`、`rebounds`、`assists`、`steals`、`blocks`、`turnovers`。

历史别名 `pts`、`reb`、`ast`、`stl`、`blk`、`to` 仅保留读取兼容。

## 羽毛球标准字段

`points`、`winners`、`aces`、`saves`、`errors`。

## 修改检查

任何比赛数据功能修改时，必须同时检查：

1. 现场录入页面是否使用标准字段。
2. 云函数是否只写入标准字段。
3. `applyCompetitionScoreForMatch` 与平台管理端权重是否一致。
4. `getAthleteMatchStats` 、个人主页和纪念徽章是否展示同一组字段。
5. 历史别名是否只出现在兼容读取逻辑中。
