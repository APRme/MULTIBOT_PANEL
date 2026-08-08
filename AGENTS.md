# AGENTS.md

## Scope

These instructions apply only to the `MULTIBOT_PANEL/` directory tree.

## Git 提交约定

- 每次完成一个改动批次后，立即用 `git` 提交（除非用户明确要求暂不提交）。
- 提交前先确认改动范围内的测试通过、`git status` 干净。
- 提交信息应简短、准确地描述该批次改动。尽量使用中文(专业术语除外)

## Project Focus

`MULTIBOT_PANEL` is the browser-based operations panel for `MULTIBOT`.

Its core characteristics are:

- thin Node static server
- vanilla browser app with no bundler
- direct HTTP API + SSE integration with `MULTIBOT`
- local browser persistence for backend profiles and UI preferences

Unless the user explicitly asks otherwise, changes in this tree should preserve that lightweight architecture.

## Default Development Direction

- Prefer small, explicit modules over framework-style abstraction.
- Keep the panel a **thin client** of `MULTIBOT`, not a second backend.
- Preserve direct API / SSE integration unless protocol changes are explicitly requested.
- Favor behavioral clarity over cleverness; this codebase is meant to stay inspectable.

## Hard Constraints

- Do not add a frontend build step, bundler, or SPA framework unless explicitly requested.
- Do not turn `index.js` into an API proxy without a clear user request.
- Preserve the browser-global namespace pattern used in `public/*.js`.
- Preserve script load order expectations in `public/index.html`.
- Keep instance editor semantics aligned with the backend:
  - `server.json` is shared per `serverDir`
  - `default.config.json` is shared per `serverDir`
  - `config.json` is per instance
- When the editor is saving full JSON file contents, preserve full-file replacement semantics.

## Important Directory Roles

- `index.js`
  - thin static server and startup entry
- `panel.config.json`
  - panel listen host / port / title
- `public/index.html`
  - page skeleton and script order
- `public/app.js`
  - application orchestration, modal state, API/SSE wiring
- `public/api.js`
  - HTTP client wrapper and error normalization
- `public/sse.js`
  - SSE connection and reconnect logic
- `public/state.js`
  - lightweight store and reducer
- `public/storage.js`
  - `localStorage` persistence helpers
- `public/formatters.js`
  - UI-facing formatting helpers
- `public/instance-presets.js`
  - instance editor preset definitions and toggle logic
- `public/components`
  - render-only UI modules
- `test`
  - panel-side tests

## Working Rules By Area

### `index.js`

- Keep it minimal.
- Static serving, health checks, and config loading belong here.
- Do not move backend business logic into the panel server.

### `public/app.js`

- Treat this file as the orchestration layer.
- Keep data fetching, SSE handling, modal coordination, and rendering flow explicit.
- Avoid hiding core control flow behind overly generic helpers.

### `public/state.js`

- Keep reducer logic deterministic and side-effect free.
- UI-only transient state should stay in `app.js` unless multiple modules truly need it.
- Preserve log deduplication behavior unless the user asks to change it.

### `public/api.js`

- Keep request construction and error normalization centralized here.
- Avoid embedding panel-specific UI wording into the transport layer.
- If the backend contract changes, update tests together with the client.

### `public/sse.js`

- Preserve authenticated `fetch + ReadableStream` SSE behavior.
- Reconnect logic should remain simple and understandable.
- Do not replace this with native `EventSource` unless authenticated headers are no longer needed.

### `public/components`

- Components should stay mostly render-focused.
- Prefer `container + props + event binding` style over hidden internal state.
- Keep displayed text aligned with actual backend behavior.

### `public/instance-presets.js`

- Presets should represent concrete config patches.
- Toggle behavior must remain predictable:
  - detect when a preset is active
  - apply the preset patch
  - remove only what the preset introduced when toggling off
- If presets depend on shared config behavior, document that clearly in the UI and README.

## Testing Guidance

- Run the smallest relevant tests first.
- Useful targeted panel tests:
  - `node --test MULTIBOT_PANEL/test/api-adapter.test.js`
  - `node --test MULTIBOT_PANEL/test/sse-manager.test.js`
  - `node --test MULTIBOT_PANEL/test/state-reducer.test.js`
  - `node --test MULTIBOT_PANEL/test/storage.test.js`
  - `node --test MULTIBOT_PANEL/test/instance-presets.test.js`
  - `node --test MULTIBOT_PANEL/test/static-server.test.js`

If a change touches API payload shape, SSE handling, store transitions, or instance editing, update or add the corresponding targeted test.

## Style And Editing Expectations

- Match the existing vanilla JS / CommonJS style.
- Keep code browser-friendly and dependency-light.
- Avoid introducing TypeScript, JSX, or module bundler conventions unless requested.
- Keep patches focused; do not refactor unrelated modules during feature work.
- Preserve current user-facing Chinese wording where practical.
- Do not “clean up” unrelated mojibake or encoding issues unless the task is specifically about that.

## Practical Checklist

Before finishing a panel-side change, check:

- the page still loads with plain static scripts
- backend profiles still persist in `localStorage`
- selected backend / selected bot behavior still makes sense
- SSE reconnect behavior is not broken
- command input semantics still match current intended console behavior
- instance editor still reflects shared vs per-instance config correctly
- README or technical docs are updated if behavior changed materially
