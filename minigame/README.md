# 4A4 微信小游戏

这个目录是微信小游戏工程：横屏，一张全屏 Canvas，规则核心和 AI 与网页版完全相同（`client/assets/scripts`）。当前是第一阶段：你和三家 AI 离线对局，可选一副牌或两副牌。

## 生成 game.js

`game.js` 由源码打包生成，不提交到仓库。在仓库根目录运行：

```bash
npm install
npm run build:minigame
```

会生成 `minigame/game.js`。改了代码以后重新运行即可。

## 在微信开发者工具里打开

1. 安装[微信开发者工具](https://developers.weixin.qq.com/minigame/dev/devtools/download.html)（Windows / macOS）。
2. 选「小游戏」→「导入项目」，目录选本仓库的 `minigame` 文件夹。
3. AppID：还没有注册时选「测试号」；注册后填自己的 AppID（也可以改 `project.config.json` 里的 `appid`）。
4. 模拟器里应能看到开局界面。点「预览」用手机微信扫码，就能在真机上玩。

## 注册 AppID（给朋友玩之前需要）

1. 在 [mp.weixin.qq.com](https://mp.weixin.qq.com/) 注册「小游戏」，个人主体即可。
2. 在后台「开发管理 → 开发设置」里拿到 AppID，填进开发者工具。
3. 不必正式上线：上传代码后设为「体验版」，在「成员管理」里把朋友加为体验成员，他们就能直接打开。

## 目录

- `src/game.ts`：微信入口，创建画布、处理触摸。
- `src/app.ts`：开局、出牌、提示、结算等交互。
- `src/screen.ts`：把对局状态整理成要画的内容（只含你自己能看到的信息）。
- `src/render.ts`：Canvas 绘制和点击区域。
- `game.json`、`project.config.json`：小游戏配置（横屏、打包时忽略 `src`）。

## 后续

- 第二阶段：微信云开发联机，房主开房、分享给好友入座，空位 AI 补；发牌和判定在云函数里完成，每人只能拿到自己的手牌。
- 第三阶段：3～8 人不同人数玩法。
