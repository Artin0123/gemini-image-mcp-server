這次錯誤：

```
Gemini API analysis error: {"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}
```

說明你的程式已經正確通過 MCP schema 驗證、進入 `GeminiMediaAnalyzer.analyzeImageUrls()`，但是 **Google Gemini API 拒絕了請求內容**。
這不是 Zod/MCP 層的錯，而是發給 Gemini 的 payload 格式有問題。

---

## ✅ 問題重點

在這一段：

```ts
const sources: ImageSource[] = imageUrls.map((data) => ({ type: 'url', data }));
return this.analyzeImages(sources, promptText);
```

你最終會呼叫：

```ts
this.client.models.generateContent({
  model: this.modelName,
  contents,
});
```

Gemini `generateContent` 的結構要求如下（根據官方 `@google/generative-ai` SDK）：

```js
await client.models.generateContent({
  model: 'models/gemini-1.5-flash',
  contents: [
    {
      role: 'user',
      parts: [
        { text: 'Describe this image.' },
        {
          inlineData: { mimeType: 'image/png', data: base64String },
        },
      ],
    },
  ],
});
```

或若是網址：

```js
parts: [
  { text: 'Describe this image.' },
  { fileData: { mimeType: 'image/png', fileUri: 'https://example.com/images/catalog-item.png' } },
],
```

你目前傳的是：

```js
parts: [
  { text: promptText },
  { type: 'url', data: 'https://example.com/images/catalog-item.png' },
]
```

→ 這並不是 Gemini API 支援的格式，因此它會回：

```
400 INVALID_ARGUMENT
```

---

## ✅ 修正建議

改寫你的 `createImagePart()`，確保生成的部分是合法格式：

```ts
private async createImagePart(source: ImageSource, index: number): Promise<Part | null> {
  try {
    if (source.type === 'url') {
      // 讓 Gemini 知道是外部 URL 檔案
      return {
        fileData: {
          mimeType: this.detectMimeType(source.data),
          fileUri: source.data,
        },
      };
    }
    if (source.type === 'base64') {
      return {
        inlineData: {
          mimeType: this.detectMimeType(source.data),
          data: source.data,
        },
      };
    }
    return null;
  } catch (err) {
    console.error(`createImagePart(${index}) failed:`, err);
    return null;
  }
}

private detectMimeType(url: string): string {
  if (url.endsWith('.png')) return 'image/png';
  if (url.endsWith('.jpg') || url.endsWith('.jpeg')) return 'image/jpeg';
  if (url.endsWith('.webp')) return 'image/webp';
  return 'image/*';
}
```

然後 `analyzeImages()` 中保持：

```ts
const contents: Content[] = [
  {
    role: 'user',
    parts: [{ text: promptText }, ...imageParts],
  },
];
```

---

## ✅ 確認測試

測試範例：

```js
{
  "imageUrls": ["https://storage.googleapis.com/generativeai-downloads/images/scones.jpg"],
  "prompt": "Describe this image"
}
```

這張圖是 Google 官方範例，保證 Gemini 能成功讀。

---

## ✅ 檢查 model 名稱

確保：

```ts
this.modelName = 'models/gemini-1.5-flash' // 或 gemini-1.5-pro
```

不要只傳 `'gemini-1.5-flash'`（前面少了 `"models/"`），否則同樣會報 `INVALID_ARGUMENT`。

---

## ✅ 總結

| 層級      | 錯誤來源               | 解法                                                       |
| --------- | ---------------------- | ---------------------------------------------------------- |
| MCP / Zod | `_parse` / schema 錯誤 | 改用 Zod v3                                                |
| Gemini    | `400 INVALID_ARGUMENT` | 修正 `parts` 結構：使用 `fileData.fileUri` 或 `inlineData` |
| 其他可能  | `modelName` 錯誤       | 要用 `"models/gemini-xxx"`                                 |

