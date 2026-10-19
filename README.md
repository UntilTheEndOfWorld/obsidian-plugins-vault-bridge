# SyncBridge

Pull article links from a WeChat Mini Program and archive them into Obsidian as Markdown notes. Syncing is **manual only**: nothing is fetched in the background, and article bodies and images are downloaded to your own machine.

## Features

- Pair with the companion WeChat Mini Program by entering a short pairing code.
- Pull pending article links on demand from the ribbon icon or the command palette.
- Convert WeChat articles into Markdown notes with YAML frontmatter (title, author, account, source URL, published date).
- Download images next to your notes and rewrite the links, so notes keep working offline.
- Archive notes into folders by account, or by keyword rules (for example `MySQL=Database`).
- Reusable topic profiles that apply the same folder/keyword rules to syncing and re-organizing.
- Write to the current vault, or to another local vault already registered in Obsidian.
- Re-organize previously imported notes without touching unrelated files.

## Requirements

- Obsidian **1.5.0** or later.
- **Desktop only.** The plugin uses Node.js file-system APIs (`fs`, `path`) to write into other local vaults and to list them, so it does not run on mobile.
- A WeChat account, to claim the pairing code in the companion Mini Program.
- Network access to the SyncBridge service and to the article pages you archive.

## Installation

The plugin is not in the community directory yet. To install it now:

1. Download `main.js`, `manifest.json` and `styles.css` from the latest GitHub release.
2. Create `<your-vault>/.obsidian/plugins/obsync-bridge/` and copy the three files into it.
3. Reload Obsidian, then enable **SyncBridge** in **Settings → Community plugins**.

If you use [BRAT](https://github.com/TfTHacker/obsidian42-brat), add `UntilTheEndOfWorld/obsidian-plugins-vault-bridge` as a beta plugin instead.

## Usage

1. Open **Settings → SyncBridge** and confirm the service URL (default `https://lycc.ltd/jx_slr_api`).
2. Select **Generate pairing code**, then claim that code in the WeChat Mini Program.
3. Once paired, click the link icon in the ribbon or run **Pull pending links** from the command palette.
4. Notes are written to the archive folder; run **Organize WeChat notes** afterwards to re-sort existing notes using your current rules.

## Settings

| Setting | Description |
| --- | --- |
| Service URL | Base URL of the SyncBridge API. |
| Pairing | Pairing code, pairing status and account binding. |
| Archive folder | Vault-relative folder that receives imported notes. |
| Target vault | Current vault, or another local vault registered in Obsidian. |
| Download images locally | Save remote images into the vault instead of linking to the CDN. |
| Subfolder by account | Put notes into a subfolder named after the source account. |
| Subfolder by keywords | Put notes into folders derived from keyword rules. |
| Topic profiles | Named sets of folder/keyword rules, also used when re-organizing. |

Keyword rule example:

```text
MySQL=Database
Redis=Cache
Java=Backend
```

A note whose title contains `MySQL` is written to `Archive/Database/` (combined with the account subfolder when both options are on).

## Network use

SyncBridge talks to the following remote services, and only when you trigger an action:

- **`https://lycc.ltd/jx_slr_api`** (configurable) – pairing, pulling the pending link queue, and reporting per-article sync results.
- **Article pages** such as `mp.weixin.qq.com`, requested directly from Obsidian to parse the article body.
- **Image/video CDNs** referenced by those articles, when "Download images locally" is enabled.

There is no client-side telemetry, no analytics SDK, and no background polling.

## Account and paid features

A WeChat Mini Program account is required to claim the pairing code. The service applies a daily sync quota; some plans or invite codes raise it. Where a paid plan is required for full access, it is shown in the Mini Program and in the plugin settings, and the plugin keeps working with the free quota.

## Access outside the vault

To let you choose another local vault as the archive target, the plugin reads Obsidian's own `obsidian.json` (in `%APPDATA%` on Windows, `~/Library/Application Support` on macOS, `~/.config` on Linux) to list registered vaults. It writes only into the vault you explicitly select, and only under the configured archive folder.

Inside the vault, the plugin lists the Markdown files under the archive folder to build a keyword index for folder suggestions and to detect notes it has already imported. That scan reads file paths, titles and frontmatter only, never leaves your machine, and is limited to the folder you configure.

The plugin does not read or write the system clipboard.

## Privacy

See [PRIVACY.md](PRIVACY.md) for what is sent to the service, what stays on your machine, and how to request deletion.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # type-check + production bundle
```

The build writes `main.js` at the repository root; it is intentionally not committed and is attached to GitHub releases instead.

## Credits

Built on the [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin) (0BSD, Dynalist Inc.).

## License

[MIT](LICENSE)

---

## 中文说明

把微信小程序里收藏的公众号文章链接拉取到 Obsidian，按你的规则归档成 Markdown，正文和图片都保存在本机。**只支持手动同步**，不会后台轮询。

- **仅桌面端**：插件使用 Node 的文件 API 读写其它本地仓库，移动端不可用。
- **需要账号**：用微信小程序认领配对码后才能同步；服务端有每日同步额度，付费方案/邀请码可提高额度。
- **联网范围**：`https://lycc.ltd/jx_slr_api`（配对、拉取队列、回写同步结果）、文章页面本身、以及文章引用的图片 CDN。没有埋点，没有后台轮询。
- **库外文件**：为了列出可选的其它本地仓库，会读取 Obsidian 自己的 `obsidian.json`；只会写入你明确选择的那一个仓库。
- **库内扫描**：会遍历归档目录下的 Markdown 文件，读取路径、标题和 frontmatter，用于关键词目录建议和重复导入判断；数据不出本机，范围限于你配置的目录。
- **不访问剪贴板**：插件不会读取或写入系统剪贴板。
- **关键词归档**：形如 `MySQL=数据库`，标题命中 `MySQL` 时写入 `归档目录/数据库/`。

安装：从 Releases 下载 `main.js`、`manifest.json`、`styles.css`，放进 `<库>/.obsidian/plugins/obsync-bridge/`，重载 Obsidian 后在“设置 → 第三方插件”启用。
