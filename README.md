# VaultBridge Obsidian 插件

将微信小程序中的公众号链接桥接到 Obsidian，**仅手动同步**，正文与图片在本机下载。

## 与 Obsync 的区别

- 独立品牌与 UI（VaultBridge 卡片式设置页）
- 服务端只存链接，不做自动轮询
- 支持关键词归档、Excel 批量入队

## 开发

```bash
npm install
npm run build
```

插件 ID：`vault-bridge`（启用后可在 **设置 → 社区插件** 中找到 VaultBridge）

## 关键词归档示例

```
MySQL=数据库
Redis=缓存
Java=后端
```

标题包含 `MySQL` 时写入 `根目录/…/数据库/`（若同时开启公众号目录则叠加）。
