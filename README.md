# 4A4 · 单局练习版

一款离线四人 2 对 2 扑克牌游戏。当前优先提供可直接在浏览器运行的版本；规则核心、基础 AI 和控制器保持纯 TypeScript，为之后接入 Cocos Creator / 微信小游戏留出边界。

## 本地运行

要求 Node.js 20.19+。

```bash
npm install
npm run dev:web
```

Vite 会输出本地地址。也可以生成静态网页并本地预览：

```bash
npm run build:web
npm run preview:web
```

## 当前版本

- 四个固定座位，0/2 与 1/3 两队；真人座位 0，其他三席使用基础 AI。
- 开局前选择一副牌（54 张，每队一人 14 张、一人 13 张）或两副牌（108 张，每席 27 张，默认），规则、AI 与结算相同，单局离线对战。
- 持红桃 3 者先出；两副牌依次比较红桃 3、黑桃 3、梅花 3、方块 3 的张数，完全相同时按种子决定。
- 支持选牌、合法出牌提示、压牌/不出、岔与勾、报片、名次与抓人结算。
- `?seed=414&decks=1` 可固定种子与牌数（`decks` 省略为两副牌）；相同种子和牌数可重放相同发牌与 AI 决策。
- AI 只接收自己的手牌及公开信息；其他玩家的手牌不会传给浏览器表现层。

## 架构

```text
Browser UI (web/src)
        ↓ human actions / render-only view model
GameController + Basic AI (client/assets/scripts/{app,ai})
        ↓ applyAction
Pure TypeScript rules (client/assets/scripts/core)
```

浏览器 UI 不直接改手牌、回合或桌面状态。浏览器适配层只持有暂态选牌与动画状态；规则结果仍由同一个 reducer 产生。未来微信小游戏可替换最外层表现适配，不必重写玩法和 AI。

## 验证

```bash
npm run verify
npm run build:web
```

本地核心涵盖规则、AI、确定性回放和浏览器会话测试。当前未接入后端、联网对战、账号或埋点。

## 求职展示提示

这是本地 Git 仓库中的开发分支。仓库目前没有配置 Git 远程地址；推送到 GitHub/GitLab 或公开展示前，需要先选择目标仓库和可见性。微信小游戏移植与正式发布仍是后续工作。
