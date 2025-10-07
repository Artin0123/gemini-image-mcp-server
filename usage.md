# image-mcp-server-gemini 函式指南

本文件彙整最新的 URL 專用架構。僅保留三個工具：`analyze_image`、`analyze_video`、`analyze_youtube_video`，所有本地／路徑／上傳流程皆已移除。

## `src/index.ts`

| 名稱                                                | 類型         | 摘要                                                                | 重要備註                                                                                                      |
| --------------------------------------------------- | ------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `configSchema`                                      | 常數         | 驗證設定檔輸入，支援 API key 與模型名稱。                           | API key 可落在設定或環境變數 `GEMINI_API_KEY`／`GOOGLE_API_KEY`；若缺少，伺服器仍能啟動但工具會回覆設定錯誤。 |
| `createGeminiMcpServer({ config, logger })`         | 函式         | 建立 MCP 伺服器、初始化 `GeminiMediaAnalyzer` 並註冊三個 URL 工具。 | 僅處理 URL；會讀取環境中的模型預設值。                                                                        |
| `createServer(args)`                                | 預設匯出函式 | 回傳 `McpServer.server` 供 Smithery/CLI 使用。                      | 外部只需呼叫一次即可完成啟動。                                                                                |
| `registerImageUrlTool()`                            | 函式         | 註冊 `analyze_image` 工具，驗證輸入 URL 後交由分析器處理。          | 參數 schema 僅接受 HTTP/HTTPS URL。                                                                           |
| `registerVideoUrlTool()`                            | 函式         | 註冊 `analyze_video` 工具，驗證影片 URL 並交由分析器。              | 會將多個 URL 轉為批次分析。                                                                                   |
| `registerYouTubeTool()`                             | 函式         | 註冊 `analyze_youtube_video` 工具。                                 | 只接受單一 YouTube URL。                                                                                      |
| `executeTool()`                                     | 非同步函式   | 統一工具執行與錯誤回傳格式。                                        | 所有工具共用的執行包裝。                                                                                      |
| `createSuccessResponse()` / `createErrorResponse()` | 函式         | 統一 MCP 回應格式。                                                 | 失敗時會記錄錯誤並填入 `errorCode`。                                                                          |

> 已移除：`loadEnvironmentVariables()`、`prepareMediaSource()`、`startCliServer()` 等所有本地與 CLI 專用函式。

## `src/gemini-media.ts`

| 名稱                                        | 類型     | 摘要                                                         | 重要備註                                                  |
| ------------------------------------------- | -------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| `GeminiMediaAnalyzer`                       | 類別     | 封裝圖片／影片分析流程，只接受 URL / YouTube。               | 透過 `GoogleGenAI` `models.generateContent` 呼叫 Gemini。 |
| └ `analyzeImageUrls()`                      | 公開方法 | 將圖片 URL 直接設定為 `fileData.fileUri`，並使用 `image/*`。 | 每張圖片都需為 HTTP/HTTPS。                               |
| └ `analyzeVideoUrls()`                      | 公開方法 | 將影片 URL 直接設定為 `fileData.fileUri`，並使用 `video/*`。 | 不再下載或判斷副檔名。                                    |
| └ `analyzeYouTubeVideo()`                   | 公開方法 | 直接傳入 YouTube URL 作為 `fileData.fileUri`。               | 適合長影片，不會下載檔案。                                |
| └ `analyzeImages()` / `analyzeVideos()`     | 公開方法 | 共同實作：組裝 `Content`，呼叫 Gemini 並擷取文字回應。       | 內部會過濾無效來源並回傳第一個候選文字。                  |
| └ `createImagePart()` / `createVideoPart()` | 私有方法 | 驗證 URL 並建立 `fileData` 形式的 `Part`。                   | 圖片使用 `image/*`，影片與 YouTube 使用 `video/*`。       |
| `isValidHttpUrl()`                          | 函式     | 確認輸入是否為 HTTP/HTTPS URL。                              | 不合法時記錄警告並跳過。                                  |
| `extractText()`                             | 函式     | 從 Gemini 回應擷取主要文字，處理阻擋或缺少候選的情況。       | 影片模式會額外提示 finish reason。                        |

> 所有本地檔案、暫存資料夾與 Files API 上傳邏輯皆已移除。

## `src/server-config.ts`

| 名稱                  | 類型 | 摘要                                     | 重要備註                                                             |
| --------------------- | ---- | ---------------------------------------- | -------------------------------------------------------------------- |
| `loadServerOptions()` | 函式 | 從環境變數讀取模型名稱（可覆寫預設值）。 | 僅讀取 `MCP_GEMINI_MODEL`，未設定則採用 `gemini-flash-lite-latest`。 |

## 測試與腳本

- `tests/gemini-media.test.ts`：驗證遠端圖片／影片／YouTube URL 的分析流程與固定 MIME 設定。
- `tests/server-config.test.ts`：確認環境模型覆寫與預設行為。

## 變更摘要

- 僅保留 URL 工具，移除所有本地、路徑、Base64 上傳相關的 schema 與程式碼。
- 移除 CLI 啟動流程與 `.env` 搜尋；由外部確保環境變數即可。
- 直接轉交遠端 URL 給 Gemini，省略下載與 Base64 處理流程。
- 測試全面更新，涵蓋三個公開入口與 MIME 正規化行為。

