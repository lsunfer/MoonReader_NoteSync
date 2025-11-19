# MoonReader NoteSync (静读天下笔记同步助手)

![alt text](https://img.shields.io/badge/version-5.0-blue)

![alt text](https://img.shields.io/badge/Extension-Tampermonkey-green)

![alt text](https://img.shields.io/badge/license-MIT-orange)

**MoonReader NoteSync** 是一个强大的浏览器用户脚本（Userscript），专为 **Moon+ Reader (静读天下)** 用户设计。

它可以直接在浏览器中连接你的 WebDAV 服务器（如坚果云），拉取 .an 格式的笔记备份文件，在网页上以精美的卡片形式展示高亮和笔记，并支持自定义模板导出为 Markdown 或 TXT。

**[English Documentation](https://www.google.com/url?sa=E&q=#english)** | **[中文说明](https://www.google.com/url?sa=E&q=#chinese)**

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
   确保你的浏览器已安装 [Tampermonkey (油猴)](https://www.google.com/url?sa=E&q=https%3A%2F%2Fwww.tampermonkey.net%2F) 或 Violentmonkey 扩展。

2. **安装脚本**：
   
   - **方法 A (推荐)**: [点击此处安装](你的脚本发布链接，例如GreasyFork或GitHub Raw链接) (发布后替换此链接)。
   
   - **方法 B (手动)**: 在 Tampermonkey 中点击 "添加新脚本"，将 script.js 中的代码完整复制粘贴并保存。

### ⚙️ 配置说明 (以坚果云为例)

1. 打开任意网页，点击右下角的 **📚 悬浮图标**。

2. 在侧边栏底部点击 **⚙️ (设置)** 按钮。

3. 填写以下信息：
   
   - **WebDAV URL**: https://dav.jianguoyun.com/dav/
   
   - **Username**: 你的坚果云账号（邮箱）。
   
   - **Password**: **应用密码** (强烈建议不要使用登录密码，请在坚果云“安全选项”中生成第三方应用密码)。
   
   - **Folder Path**: .an 文件所在的路径。
     
     - 默认静读天下备份路径通常为：/MoonReader/Annotations/
     
     - 注意：路径首尾请加上斜杠 /。

4. 点击 **Save Settings** 保存。

### 📖 使用方法

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

<a name="english"></a>

## 📖 English Documentation

### ✨ Features

- **☁️ WebDAV Sync**: Connects directly to WebDAV servers (e.g., Nextcloud, Nutstore) from the browser.

- **⚡ Incremental Sync**: Downloads only modified files based on timestamps.

- **🧠 Advanced Parsing**:
  
  - Uses Pako to handle Moon+ Reader's headless compressed streams (.an files).
  
  - **Gap Analysis Algorithm**: Accurately distinguishes between "Highlights" and "Notes".

- **🎨 Modern UI**:
  
  - Shadow DOM isolation.
  
  - **Card View**, **JSON View**, and **Raw View**.
  
  - Glassmorphism design.

- **📤 Export System**:
  
  - Export to Markdown (.md) and Text (.txt).
  
  - **Custom Templates**: Use variables like {{highlightText}} to customize the output format for Obsidian or Notion.

### 🚀 Installation

1. **Prerequisites**: Install [Tampermonkey](https://www.google.com/url?sa=E&q=https%3A%2F%2Fwww.tampermonkey.net%2F) or Violentmonkey.

2. **Install Script**: Create a new script and paste the content of script.js.

### ⚙️ Configuration

1. Click the **📚 FAB** button on any webpage.

2. Click the **⚙️ (Settings)** button.

3. Fill in your WebDAV details:
   
   - **WebDAV URL**: e.g., https://dav.jianguoyun.com/dav/ or your Nextcloud URL.
   
   - **Username**: Your WebDAV username.
   
   - **Password**: Your WebDAV password (App Token recommended).
   
   - **Folder Path**: The path where .an files are stored (e.g., /MoonReader/Annotations/).

4. Click **Save Settings**.

### 🔒 Privacy

- All data processing happens locally in your browser.

- Credentials and notes are stored in the extension's local storage and are **never** sent to any third-party servers.

---

## 🛠 Development

Built with:

- Vanilla JavaScript (ES6+)

- Shadow DOM (Web Components)

- [Pako](https://www.google.com/url?sa=E&q=https%3A%2F%2Fgithub.com%2Fnodeca%2Fpako) (Zlib port)

## 📄 License

MIT License. Feel free to modify and distribute.

---
