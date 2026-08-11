# 產險 RAG 知識庫導入時程

## 專案甘特圖

```mermaid
gantt
    title 產險 RAG 知識庫導入專案（114 年度）
    dateFormat YYYY-MM-DD
    axisFormat %m/%d
    excludes weekends

    section 前置準備
    需求訪談與範圍界定      :done,    a1, 2025-01-06, 15d
    文件盤點（38 份主包）   :done,    a2, after a1, 10d
    採購與環境建置          :done,    a3, 2025-02-01, 20d

    section 解析與審核
    PDF 解析管線開發        :active,  b1, 2025-03-01, 30d
    BU 人工審核（第一輪）   :active,  b2, after b1, 25d
    解析瑕疵修正            :         b3, after b2, 15d
    BU 複審與交付審定       :crit,    b4, after b3, 20d

    section 上線
    向量化與索引建置        :         c1, after b4, 10d
    使用者驗收測試 UAT      :crit,    c2, after c1, 15d
    正式上線                :milestone, c3, 2025-08-15, 0d

    section 維運
    知識庫增修機制          :         d1, after c3, 60d
```

## 關鍵里程碑

| 里程碑 | 預定日期 | 實際日期 | 狀態 |
| --- | --- | --- | --- |
| 文件盤點完成 | 2025/01/31 | 2025/02/03 | ✅ 完成（延誤 3 天） |
| 解析管線可用 | 2025/03/31 | — | 🔄 進行中 |
| 第一輪審核完成 | 2025/04/25 | — | ⏳ 未開始 |
| 正式上線 | 2025/08/15 | — | ⏳ 未開始 |
