# Snake City

3D 城市貪吃蛇：巨蛇在低多邊形風格的城市街道上獵食路人，越吃越長、越長越快。撞到建築物、咬到自己，或太久沒吃而餓死，遊戲就結束。完整規格見 [`../spec.md`](../spec.md)。

## 執行

```bash
npm install
npm run dev          # http://localhost:5173
```

## 部署到 GitHub Pages

推到 `main` 就會由 `.github/workflows/deploy.yml` 自動建置並發布到 `https://jimliudev.github.io/snake-city/`。第一次要到 repo 的 Settings → Pages，把 Source 設成 **GitHub Actions**。`vite.config.ts` 用相對路徑（`base: './'`），所以放在任何子路徑下都能跑。

## 操作

| 按鍵 | 動作 |
|---|---|
| 方向鍵 / WASD | 往北、東、南、西（絕對方向）；第一次按下就開始 |
| M | 放大或縮小小地圖 |
| Space / Enter | 死亡 750 ms 後重新開始 |

## 指令

| 指令 | 用途 |
|---|---|
| `npm run build` | 型別檢查並建置到 `dist/` |
| `npm run check:map` | 生成 500 張隨機城市並檢查東區地圖：連通、沒有死巷、出生點、地塊位置（隨機城市另外檢查小巷寬度），並輸出可走格子統計 |
| `npm run check:sim` | 機器人玩隨機城市 80 局、東區 40 局，逐幀檢查規則（蛇不重疊、行人不站在蛇或建築上、人數維持 30 人），並跑一個餓死情境；大約需要 2 分鐘 |
| `npm run build:map` | 從 OpenStreetMap 重新轉換台北東區（道路和建築）到 `src/map/east.json`，並印出每條路的換算報告和建築統計。原始資料快取在 `scripts/.osm-cache/`，刪掉快取才會重新下載（需要連網） |

## 除錯

- `?seed=123`：固定地圖和行人的亂數，重開時也沿用同一個種子
- `?map=random`：改玩隨機城市（預設是台北東區，開始畫面不再提供選擇）
- `?debug`：開放 `window.__snake()`（讀取目前狀態）和 `window.__snakeGame`；小地圖會標出行人會逃跑的範圍，非閒晃狀態的行人用黑框標示

數值都集中在 `src/config.ts`。規則在 `src/sim.ts`（不引用 three.js，`scripts/` 直接在 Node 上執行它）；隨機城市的生成在 `src/map/generate.ts`，台北東區的轉換在 `scripts/build-map.ts`，東區建築的造型在 `src/render/buildings.ts`，地圖外的街景在 `src/render/surroundings.ts`。

台北東區的道路和建築資料來自 OpenStreetMap，採 ODbL 授權（© OpenStreetMap contributors）。
