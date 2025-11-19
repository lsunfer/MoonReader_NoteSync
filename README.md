# MoonReader NoteSync (静读天下笔记同步助手)

![alt text](https://img.shields.io/badge/version-5.0-blue)

![alt text](https://img.shields.io/badge/Extension-Tampermonkey-green)

![alt text](https://img.shields.io/badge/license-MIT-orange)

**MoonReader NoteSync** 是一个强大的浏览器用户脚本（Userscript），专为 **Moon+ Reader (静读天下)** 用户设计。

移动端配置静读天下WebDAV同步后，网页安装脚本，连接 WEBDAV 服务器（如坚果云），拉取 .an文件并解析，以卡片、JSON等形式展示高亮和笔记，并支持自定义模板导出为 Markdown 或 TXT。

---

<a name="chinese"></a>

## 📖 中文说明

### ✨ 核心功能

- **☁️ WebDAV 直连**：无需后端服务器，通过浏览器直接连接坚果云、Nextcloud 等 WebDAV 服务。

- **⚡ 增量同步**：智能对比文件修改时间，仅下载有变动的书籍笔记，极大地节省流量和时间。

- **🧠 深度解析**：
  
  - 内置 Pako 库，支持解压静读天下特殊的无头压缩流（Raw Deflate/Gzip）。
  
  - 采用 **Gap Analysis** 算法，精准区分“纯高亮”与“带有批注的笔记”。

- **🎨 现代化 UI**：
  
  - Shadow DOM 隔离样式，不污染原网页。
  
  - 支持 **卡片视图**（阅读体验最佳）、**JSON 视图**（开发者调试）和 **Raw 视图**（查看原始数据）。
  
  - 精美的毛玻璃效果和流畅的动效。

- **📤 强大的导出系统**：
  
  - 支持导出为 Markdown (.md) 和 纯文本 (.txt)。
  
  - **自定义模板**：支持使用变量（如 {{highlightText}}, {{userNote}}）自定义导出格式，完美对接 Obsidian、Logseq 或 Notion。

### 🚀 安装指南

1. **安装管理器**：  
   确保你的浏览器已安装 [Tampermonkey (油猴)](https://www.tampermonkey.net/) 或 [ScriptCat 扩展](https://docs.scriptcat.org/)。

2. **安装脚本**：
   
   - **方法 A (推荐)**: [点击此处安装](https://github.com/seeyou2n1ght/MoonReader_NoteSync/raw/refs/heads/main/MoonReader%20NoteSync.user.js) 。
   
   - **方法 B (手动)**: 在 Tampermonkey 中点击 "添加新脚本"，将 MoonReader NoteSync.user.js 中的代码完整复制粘贴并保存。

### ⚙️ 配置说明 (以坚果云为例)

1. 打开任意网页，点击右下角的 **📚 悬浮图标**。

2. 在侧边栏底部点击 **⚙️ (设置)** 按钮。

3. 填写以下信息：
   
   - **WebDAV URL**: https://dav.jianguoyun.com/dav/
   
   - **Username**: 你的坚果云账号（邮箱）。
   
   - **Password**: **应用密码** (强烈建议不要使用登录密码，请在坚果云“安全选项”中生成第三方应用密码)。
   
   - **Folder Path**: .an 文件所在的路径。
     
     - 默认静读天下备份路径通常为：/moonReader/.Moon+/Cache/
     
     - 注意：路径首尾请加上斜杠 /。

4. 点击 **Save Settings** 保存。

### 📖 使用方法（前置要求是在移动端静读天下已配置Webdav同步）

1. 点击 **🔄 Sync Now** 按钮，脚本将开始从云端拉取笔记。

2. 在左侧列表中点击一本书，右侧即可查看笔记卡片。
   
   - **Card**: 默认视图，上方为高亮原文，下方为你的批注。
   
   - **JSON/Raw**:用于查看底层数据结构。

3. **导出笔记**：
   
   - 点击左下角的 **📤 Export** 按钮。
   
   - 在文本框中编辑模板（支持实时保存）。
   
   - 点击 Download 下载文件。

### 🔒 隐私与安全

- **本地运行**：所有逻辑均在你的浏览器中运行。

- **数据安全**：你的 WebDAV 账号、密码和笔记数据**仅存储在本地** (Tampermonkey 的沙盒存储中)，**绝不会**上传到除了你指定的 WebDAV 服务器以外的任何地方。

---