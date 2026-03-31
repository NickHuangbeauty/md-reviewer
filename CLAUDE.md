# MD Reviewer - Claude Code 指導原則

## 最高指導原則

### 1. 測試順序：金絲雀優先
任何功能的 BDD/E2E 測試必須先在金絲雀版本完成並確認通過，絕對不可在未確認金絲雀版本前就跑正式版測試。

### 2. 完整上線流程（嚴格依序，不可跳步）
1. **Local 正式版** — 開發 + 驗證 (`localhost:5174/md-reviewer/`)
2. **Local Canary** — 驗證 (`npx vite --config vite.config.canary.js --port 5175` → `localhost:5175/md-reviewer/canary/`)
3. **Commit + Push** — 推到 feature 分支
4. **GitHub Pages Canary** — 線上驗證 (`NickHuangbeauty.github.io/md-reviewer/canary/`)
5. **Merge to main** — Canary 確認通過後才可 merge → 部署正式版

### 3. 不可破壞正式環境
- 任何修改都不能影響正式版運作
- Feature 分支開發，canary 先行驗證
- 修改前要確認安全性

## 開發規範
- 語言：繁體中文
- 偏好先討論再動手，重視測試驗證
- Playwright 截圖統一放 `screenshots/` 資料夾
- 新功能必須透過金絲雀流程驗證後才上正式版
