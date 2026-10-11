# 414 Browser-First MVP Plan

> **Goal:** Ship a playable, offline browser version first while keeping the approved pure-TypeScript rules, AI, controller, and UI view model reusable for a later Cocos Creator / WeChat Mini Game presentation layer.

## Guardrails

- Do not change approved game rules or the current design specification.
- Browser code may import `client/assets/scripts/**`, but the core must remain free of browser and Cocos APIs.
- All human actions continue through `GameController` and `applyAction`.
- Use Vite as a local build/preview tool; do not add a server, account, network play, or telemetry.
- The repo has no configured Git remote. Do not publish or push until the user supplies a destination and visibility choice.
- Keep the abandoned Cocos bootstrap output separate from the source app; do not import its `.git`, generated settings, or caches.

## Work sequence

1. Add a browser-session adapter around the existing controller, view model, selection helpers, and candidate generator. Write its unit tests first.
2. Add a responsive browser table with the four fixed seats, selectable human hand, AI turns, play/pass/hints, the exact CHA-then-GOU prompts, seed replay, help, and results. Keep rendering separate from game state.
3. Add Vite scripts, browser TypeScript checking, build, and README guidance suitable for a portfolio repository.
4. Run focused tests, full `npm run verify`, browser build, and an available browser smoke check. Record any environmental limit honestly.

## Acceptance

- `npm run dev:web` serves the game locally; `npm run build:web` produces a static browser bundle.
- A human can finish a single round against the three existing basic AIs without bypassing the rules/controller.
- Same-seed replay is deterministic; AI hands remain hidden; mobile-width controls remain usable.
- Existing 160+ rule/AI tests remain green and `npm run typecheck:web` covers browser sources.
- No external service, game backend, Cocos runtime, or network permission is required to play.
