# Capy Cab｜卡皮巴拉計程車

這是完整的遊戲專案：包含程式碼、城市與交通系統、捷運、人物及車輛
GLB 模型、材質、音效、測試和素材授權紀錄。正式網站：
https://capy-cab-taxi.wowxwo.chatgpt.site

## 執行遊戲

需要 Node.js 22.13 以上及 Linux 環境；Windows 可使用 WSL。
壓縮檔不含可重新安裝的 `node_modules`。

```bash
npm ci
npm run dev
```

建置使用 `npm run build`。模型、材質和音效位於 `public/`；
素材來源與授權整理在 `public/credits.html` 及各模型的 `ASSET-SOURCES.md`。
遊戲優先使用 WebGPU，依瀏覽器相容性使用 WebGL2。


## GitHub Pages 部署（靜態版）

這個 repo 透過 `.github/workflows/pages.yml` 部署到 GitHub Pages：

```bash
npm ci
npm run build:pages   # 輸出到 dist-pages/
npx vite preview -c vite.pages.config.ts
```

- `index.html` + `web/main.tsx` 是純前端入口，直接渲染 `app/CommercialTaxiGame.tsx`，不需要 Worker/伺服器。
- `scripts/optimize-pages.mjs` 只壓縮 `dist-pages/` 裡的複本，`public/` 原始素材保持不變（素材雜湊測試仍有效）：
  - GLB 幾何使用無損 EXT_meshopt_compression（不重排頂點、不量化，頂點資料逐位元相同）。
  - GLB 與獨立貼圖最大 2048px，並在較小時重新編碼（GLB 內轉 WebP）。
- `web/meshopt-loader.ts` 讓所有 `GLTFLoader` 自動帶上 MeshoptDecoder。

### 效能（目標 60 fps）

- `app/draw-distance.ts`：城市區塊畫到霧完全遮住的距離為止；街道家具 170 m、小型植栽與反光標 220 m、車流 560 m 以外不繪製。
- `app/adaptive-resolution.ts`：連續 2 秒低於 55 fps 時降低 3D 解析度（最低 70%），穩定 59 fps 以上 6 秒後再慢慢回升；UI 文字不受影響。
- 建置時把照片掃描的消防栓、植栽、花盆簡化（誤差 0.2%）；水豚、騎士等有骨架或頂點索引的模型不簡化。
- 網址加上 `?debug` 會顯示 FPS、繪圖後端與速度倍率（`[`、`]` 鍵）。

### 聲音

- `app/game-sfx.ts`：全域靜音（記在瀏覽器）、UI 點擊、方向燈繼電器聲、乘客上車／下車提示音與收銀聲。
- 機車引擎：發動時有啟動馬達聲，熄火時轉速自然下降；喇叭改為雙音電子喇叭。

## AI 騎士與機車

機車和玩家車輛使用相同的顯示長度，車身、輪胎、前叉等比放大。
AI 小熊使用下載角色的原始雙足骨架，騎乘姿勢離線製作，保留骨骼長度。
手腳接觸點、輪胎轉動、避震和交通行為可以用下列測試檢查：

```bash
node --import tsx --test tests/motorcycle-rider.test.mjs tests/realistic-traffic.test.mjs tests/traffic-flow.test.mjs tests/commuter-service.test.mjs
```

遊戲本身不需要 Blender。重新處理 AI 騎士模型時，使用 Blender bpy 4.5.3、
Python 3.11 執行 `scripts/prepare-motorcycle-rider.py`，再執行
`node --import tsx scripts/pose-motorcycle-rider.mjs bear`。
原始模型位於 `public/models/motorcycle-rider/source/`。

## 原有開發環境說明

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- Linux with `flock`, `curl`, and GNU `timeout`

## Sites Lifecycle

The Sites lifecycle CLI runs the locked dependency install before returning this checkout. Edit the source under `app/`, then checkpoint when a coherent milestone is ready to inspect or share. The remote Sites builder runs `npm run build` against the pushed commit. Do not repeat install or build as a normal pre-checkpoint step.

This starter does not use `wrangler.jsonc`.

`install:ci` is intentionally a single, non-retrying `npm ci`. It refuses a concurrent install for the same project, consumes a matching image-seeded npm cache with `--prefer-offline` while retaining registry fallback for a missing cache object, otherwise downloads and verifies the complete vinext tarball recorded in `package-lock.json`, limits npm to one socket, and terminates a stalled install. `build` applies a short timeout. These helpers target Linux and use GNU `timeout`; they are not native macOS scripts.

Scripts that need writable project-scoped home, npm, XDG, and temporary paths use `scripts/sites-env.sh`. The `dev` and `start` scripts honor the caller's runtime environment and keep Wrangler logs inside the checkout. The generated `.sites-runtime/` directory is disposable and ignored by Git.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Diagnostic Commands

- `npm run install:ci`: perform the one bounded lockfile install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build the deployable Sites artifact
- `npm run start`: start the built Vinext application
- `npm test`: build and verify the rendered development-preview metadata
- `npm run db:generate`: generate Drizzle migrations after schema changes

Use build commands for targeted diagnosis after a remote failure, not as part of the normal checkpoint path.

The timeout defaults can be overridden for a controlled canary with `SITES_INSTALL_TIMEOUT`, `SITES_INSTALL_KILL_AFTER`, `SITES_BUILD_TIMEOUT`, and `SITES_BUILD_KILL_AFTER`. A timeout fails the command; the helpers never retry an unchanged install or build.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
