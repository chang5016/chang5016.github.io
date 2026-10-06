# Capy Cab 第 97 版：跨帳號分包版

這套檔案包含既有完整遊戲。7 個 ZIP 都小於 30 MB，所有模型、貼圖及音效均保留原始內容。

## 在另一個 ChatGPT 帳號使用

1. 先上傳 `01-Capy-Cab-v97-code.zip`，再逐一上傳 `02` 到 `07` 的素材包。請把 7 個檔案上傳到同一個對話。
2. 告訴該帳號的助手：「請將這 7 個 ZIP 解壓到同一個資料夾，匯入完整的 Capy Cab 第 97 版，使用 Sites 在這個帳號建立新網站，再建置並發布。請保留既有遊戲、模型、材質與功能。」
3. 每份 ZIP 都使用相同的 `Capy-Cab-v97-portable/` 根目錄；直接依原始路徑解壓即可，不需要特殊的分卷軟體，也不需要下載舊帳號的素材。
4. 原 `.openai/hosting.json` 中的舊 `project_id` 已移除。新帳號使用 Sites 時，先建立並寫入新專案 ID，再建置和發布。

## 本機執行

解壓全部 7 份後，進入 `Capy-Cab-v97-portable/`。
需要 Node.js 22.13 以上和 Linux；Windows 可以使用 WSL。

```bash
python3 verify-portable.py
npm ci
npm run dev
```

建置使用 `npm run build`。安裝套件時需要網路。
`verify-portable.py` 會檢查所有專案檔案的 SHA-256、檔案大小及是否缺檔。

來源及授權文件保留在 `public/credits.html` 與各素材的 `ASSET-SOURCES.md`。
原版本的開發說明保留在 `README.md`。
