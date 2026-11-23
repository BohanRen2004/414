# 4A4 · 四人两队扑克

四人 2 对 2 的扑克牌游戏：网页版和三位 AI 对战（电脑和手机横屏都能玩），微信小游戏版还可以开房间和好友联机。规则核心、基础 AI 和控制器是纯 TypeScript，各个前端共用。

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

## 放到网站上（GitHub Pages）

仓库自带 `.github/workflows/pages.yml`：每次推送到 `main` 会先跑 `npm run verify`，再把网页版发布到 GitHub Pages。只需要做一次设置：

1. 在 GitHub 仓库页面打开 **Settings → Pages**。
2. **Source** 选 **GitHub Actions**。
3. 把代码合并到 `main`（或在 Actions 页面手动运行 “Deploy web version”）。几分钟后网址是 `https://<你的用户名>.github.io/<仓库名>/`。

网页是纯静态文件（`npm run build:web` 生成在 `dist/web`），也可以传到 Cloudflare Pages、Vercel、Netlify 或自己的服务器。国内访问 GitHub Pages 可能较慢；用国内服务器加自己的域名需要先备案。

## 当前版本

- 牌桌：每家这一轮出的牌摆在自己座位前，不出有气泡；炸弹、王炸、4A4 有特效；合成音效（可关）；记牌器显示其他三家还剩的牌。
- 手牌：一副牌排成一排，两副牌按点数竖排成列（掼蛋式）；点牌选择，按住滑过可以一次选一串。
- 手机：始终横屏，竖着拿时整个页面自动转成横版。
- 四个固定座位，0/2 与 1/3 两队；真人座位 0，其他三席使用基础 AI。
- 开局前选择一副牌（54 张，每队一人 14 张、一人 13 张）或两副牌（108 张，每席 27 张，默认），规则、AI 与结算相同，单局离线对战。
- 持红桃 3 者先出；两副牌依次比较红桃 3、黑桃 3、梅花 3、方块 3 的张数，完全相同时按种子决定。
- 支持选牌、合法出牌提示、压牌/不出、岔与勾、报片、名次与抓人结算。
- `?seed=414&decks=1` 可固定种子与牌数（`decks` 省略为两副牌）；相同种子和牌数可重放相同发牌与 AI 决策。
- AI 只接收自己的手牌及公开信息；其他玩家的手牌不会传给浏览器表现层。

## 微信小游戏

`minigame/` 是微信小游戏版本（Canvas 绘制，规则和 AI 与网页版共用）：可以单人和 AI 练习，也可以开房间邀请微信好友联机（微信云开发，空位 AI 补）。运行 `npm run build:minigame` 生成 `minigame/game.js` 和云函数 `minigame/cloudfunctions/room/index.js`，再用微信开发者工具导入 `minigame` 目录，详见 [minigame/README.md](minigame/README.md)。联机的服务端逻辑在 `server/`（纯 TypeScript，测试里用内存数据库跑）。

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

测试涵盖规则、AI、确定性回放、浏览器会话、小游戏和联机服务端。网页版没有后端、账号或埋点；联机只在微信小游戏里。
