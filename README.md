# MD Reviewer - Markdown 文檔檢閱工具

產險 RAG 專用的 Markdown/HTML 文檔檢閱工具，支援：
- 預覽編輯
- 表格編輯（含 colspan/rowspan）
- **智能差異比對**（使用 [jsdiff](https://github.com/kpdecker/jsdiff) 開源庫）
- 批註標記

## 技術改進

### jsdiff 整合
本專案使用 `jsdiff` 開源庫進行差異比對，相較於自建算法有以下優勢：
- **自動忽略空白差異**：`diffTrimmedLines` 忽略行首尾空白
- **智能修改偵測**：`diffWords` 計算相似度，區分「修改」和「刪除+新增」
- **Markdown 表格正規化**：自動處理 `|||` 和 `| | |` 格式差異

## 快速部署到 GitHub Pages

### 步驟 1：建立 GitHub 倉庫

1. 登入 [GitHub](https://github.com)
2. 點擊右上角 `+` → `New repository`
3. 倉庫名稱填寫：`md-reviewer`
4. 選擇 `Public`
5. 點擊 `Create repository`

### 步驟 2：上傳檔案

方法 A - 網頁上傳（最簡單）：
1. 在新建的倉庫頁面，點擊 `uploading an existing file`
2. 把這個資料夾裡的所有檔案拖曳上傳
3. 點擊 `Commit changes`

方法 B - 使用 Git 命令：
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/您的用戶名/md-reviewer.git
git push -u origin main
```

### 步驟 3：開啟 GitHub Pages

1. 在倉庫頁面，點擊 `Settings`（設定）
2. 左側選單找到 `Pages`
3. Source 選擇 `GitHub Actions`
4. 等待幾分鐘後，您會看到公開網址

### 步驟 4：設定 GitHub Actions 自動部署

在倉庫中建立 `.github/workflows/deploy.yml`（我已經準備好了）

部署完成後，您的網站會在：
```
https://您的用戶名.github.io/md-reviewer/
```

## 本地開發

```bash
# 安裝依賴
npm install

# 啟動開發伺服器
npm run dev

# 打包生產版本
npm run build
```

## 技術棧

- React 18
- Vite
- Lucide Icons
