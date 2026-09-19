# 交付概览 — 「存入本体库」+ 移除 Fabric 推送按钮（2026-09-18）

## 需求

1. 导入 RDF 本体文件成功后，增加「存入本体库」功能 —— 存入后可在「本体库」弹窗里随时重新加载。
2. 移除「推送到 Microsoft Fabric」按钮。

## 实现

### 新增：存入本体库
- **新文件 `src/lib/userOntologyLibrary.ts`**：本地本体库存储层
  （localStorage key `ontology-platform.user-ontology-library`）。
  保存 / 列出 / 删除；**同名覆盖**（原地更新并保留原 id）；坏数据防御。
- **`ImportExportModal.tsx`**：导入成功后**不再自动关闭弹窗**，
  成功横幅右侧出现「存入本体库」按钮；点击后写入本地库，
  按钮变为禁用态「已存入本体库」并出现提示条。
- **`GalleryModal.tsx`（本体库）**：
  - 本地保存的本体出现在本体库最前面，带蓝底「**我的**」徽标；
  - 来源筛选新增「我的」选项；
  - 本地条目有红色删除按钮（二次确认）；
  - 点击「加载」直接载入并关闭弹窗（本地条目没有可分享的深链）。

### 移除：Fabric 推送
- `ImportExportModal` 删除按钮与 `onFabricPush` prop；
- `App.tsx` 删除 `FabricExportModal` 渲染与相关状态
  （组件文件与 `src/lib/fabric.ts` 保留但未挂载，日后想恢复也容易）。

### 过程中发现并修复的坑
- 同一毫秒内连续保存两份本体：id 用 `Date.now()` 会碰撞（后存覆盖先存）→
  id 加随机后缀；`savedAt` 改为单调递增，保证排序稳定。

## 验证

| 检查 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | ✅ |
| `npx eslint`（改动文件） | 干净 |
| `npx vitest run` | ✅ **32 文件 / 634 测试全绿**（新增 13 条） |
| `npx vite build` | ✅ |

## 说明

- 存入的本体**只保存在当前浏览器的 localStorage 里**，不上传服务器；
  清浏览器数据会丢失，建议重要本体仍保留 `.rdf` 原文件。
- 官方 / 社区条目（catalogue.json，34 个）不受影响，与「我的」条目合并展示。
