// ==UserScript==
// @name         MoonReader NoteSync v5.6.1
// @namespace    http://tampermonkey.net/
// @version      5.6.1
// @description  按当前选中书籍按需解析；Raw不触发笔记解析；各书籍视图缓存，保留虚拟滚动
// @author       seeyou2night
// @match        *://*/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // --- 1. 配置与常量 ---
    const CONFIG_KEY = 'mr_sync_config_v5';
    const CACHE_KEY = 'mr_sync_cache_v13'; // v13：Raw不解析JSON；按书籍文件名和内容缓存派生视图
    const LEGACY_CACHE_KEY = 'mr_sync_cache_v5';
    const TEMPLATE_KEY = 'mr_sync_template_v5';
    
    const DEFAULT_TEMPLATE = `### {{chapterIndex}}. {{timeString}}
> {{highlightText}}

**📝 Note:** {{userNote}}

---
`;

    let config = {
        url: 'https://dav.jianguoyun.com/dav/',
        username: '',
        password: '',
        folder: '/moonReader/.Moon+/Cache/'
    };

    let exportTemplate = GM_getValue(TEMPLATE_KEY, DEFAULT_TEMPLATE);

    const savedConfig = GM_getValue(CONFIG_KEY);
    if (savedConfig) config = { ...config, ...JSON.parse(savedConfig) };

    let currentViewMode = 'card';
    let currentBookData = null;

    // 每本书按 fileKey 独立缓存。缓存只存在于当前页面会话中：
    // 切换书籍/视图不丢失；Sync Now 后若文件内容未变则继续复用；
    // 文件内容变化时自动作废该书的派生缓存；刷新网页后自然清空。
    const bookViewCache = new Map();

    function getBookViewCache(book) {
        const key = book.fileKey || book.displayName;
        const rawText = book.raw || '';
        let cache = bookViewCache.get(key);
        if (!cache || cache.rawText !== rawText) {
            cache = {
                rawText,
                data: Array.isArray(book.data) ? book.data : null,
                sortedData: null,
                jsonText: undefined,
                jsonLineStarts: null,
                rawLineStarts: null
            };
            bookViewCache.set(key, cache);
        } else if (!cache.data && Array.isArray(book.data)) {
            cache.data = book.data;
        }
        return cache;
    }

    function ensureBookParsed(book) {
        if (!book) return [];
        const cache = getBookViewCache(book);
        if (!cache.data) {
            const parsed = parseMoonReaderContent(book.raw || '');
            cache.data = parsed.json;
        }
        // 同时挂回当前书籍对象，兼容导出和原有调用；不会解析其他书籍。
        book.data = cache.data;
        return cache.data;
    }

    // --- 2. UI 构建 (Shadow DOM) ---
    const host = document.createElement('div');
    host.id = 'mr-notesync-host';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    // --- 3. 样式系统 (统一 UI) ---
    const styles = `
        :host {
            --primary: #4f46e5; /* Indigo-600 */
            --primary-hover: #4338ca;
            --bg: rgba(255, 255, 255, 0.98);
            --text-main: #1e293b;
            --text-sub: #64748b;
            --border: #e2e8f0;
            --card-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
            --radius: 12px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            z-index: 99999;
        }
        * { box-sizing: border-box; scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; }
        
        /* 滚动条美化 */
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 3px; }

        /* 悬浮球 */
        .fab {
            position: fixed; bottom: 30px; right: 30px; width: 52px; height: 52px;
            background: var(--primary); border-radius: 50%; color: white;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 10px 25px -5px rgba(79, 70, 229, 0.4);
            cursor: pointer; transition: transform 0.2s; z-index: 10000; font-size: 24px;
        }
        .fab:hover { transform: scale(1.1) rotate(5deg); }

        /* 主容器 */
        .container {
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.96);
            width: 960px; height: 700px; max-width: 95vw; max-height: 90vh;
            background: var(--bg); border-radius: var(--radius);
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            display: flex; opacity: 0; pointer-events: none; transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            border: 1px solid rgba(255,255,255,0.5); overflow: hidden;
        }
        .container.open { opacity: 1; transform: translate(-50%, -50%) scale(1); pointer-events: auto; }

        /* 侧边栏 */
        .sidebar { width: 260px; background: #f8fafc; border-right: 1px solid var(--border); display: flex; flex-direction: column; }
        .sidebar-header {
            padding: 18px; border-bottom: 1px solid var(--border);
            font-weight: 700; color: var(--text-main); font-size: 15px;
            display: flex; justify-content: space-between; align-items: center;
        }
        .status-badge { font-size: 10px; padding: 2px 8px; border-radius: 10px; background: #e2e8f0; color: var(--text-sub); font-weight: 500;}
        
        .book-list { flex: 1; overflow-y: auto; padding: 10px; }
        .book-item {
            padding: 10px 12px; margin-bottom: 4px; border-radius: 8px; cursor: pointer;
            font-size: 13px; color: var(--text-main); transition: background 0.15s;
        }
        .book-item:hover { background: #e2e8f0; }
        .book-item.active { background: var(--primary); color: white; box-shadow: 0 2px 5px rgba(79, 70, 229, 0.3); }
        .book-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
        .book-info { font-size: 11px; opacity: 0.7; margin-top: 4px; display: flex; justify-content: space-between; }

        .sidebar-footer { padding: 16px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; background: #f8fafc;}

        /* 主内容区 */
        .main { flex: 1; display: flex; flex-direction: column; background: white; min-width: 0; position: relative; }
        .main-header {
            height: 60px; padding: 0 24px; border-bottom: 1px solid var(--border);
            display: flex; justify-content: space-between; align-items: center;
        }
        .header-title { font-weight: 600; font-size: 16px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 350px;}
        
        .view-tabs { display: flex; background: #f1f5f9; padding: 3px; border-radius: 8px; gap: 2px; }
        .tab-btn {
            padding: 6px 12px; font-size: 12px; cursor: pointer; border-radius: 6px;
            color: var(--text-sub); font-weight: 600; transition: all 0.2s;
        }
        .tab-btn:hover { color: var(--text-main); background: rgba(255,255,255,0.5); }
        .tab-btn.active { background: white; color: var(--primary); box-shadow: 0 1px 2px rgba(0,0,0,0.05); }

        .content-scroll { flex: 1; min-height: 0; overflow: auto; padding: 24px; background: #fcfcfc; scroll-behavior: auto; }
        .content-scroll.virtual-mode { padding: 0; overflow: hidden; display: flex; flex-direction: column; }
        .virtual-toolbar { flex: 0 0 auto; display:flex; align-items:center; gap:8px; padding:10px 14px; background:#fff; border-bottom:1px solid var(--border); }
        .virtual-toolbar input { flex:1; min-width:80px; padding:7px 9px; border:1px solid var(--border); border-radius:6px; font-size:12px; }
        .virtual-toolbar button { border:1px solid var(--border); background:#f8fafc; border-radius:6px; padding:7px 10px; font-size:12px; cursor:pointer; white-space:nowrap; }
        .virtual-status { font-size:11px; color:var(--text-sub); white-space:nowrap; }
        .virtual-viewport { flex:1; min-height:0; overflow:auto; position:relative; background:#f8fafc; contain:strict; }
        .virtual-spacer { position:relative; min-width:max-content; width:100%; }
        .virtual-line-layer { position:absolute; left:0; top:0; min-width:100%; }
        .virtual-line { height:18px; line-height:18px; padding:0 12px; white-space:pre; font:12px/18px Consolas,Monaco,monospace; }
        .virtual-raw .virtual-line { background:#282c34; color:#abb2bf; }
        .virtual-json .virtual-line { background:#f8fafc; color:#333; }
        .virtual-line.match { background:#fff1a8 !important; color:#111 !important; }

        /* 卡片设计 (核心调整) */
        .note-card {
            background: white; border: 1px solid var(--border); border-radius: var(--radius);
            margin-bottom: 24px; overflow: hidden;
            box-shadow: var(--card-shadow);
            transition: transform 0.2s, box-shadow 0.2s;
            display: flex; flex-direction: column;
        }
        .note-card:hover { transform: translateY(-2px); box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); }
        
        /* 1. 高亮区域 (上) */
        .card-highlight {
            padding: 16px 20px;
            background: #f8fafc;
            color: #334155;
            font-size: 14px;
            line-height: 1.6;
            font-family: "Georgia", serif;
            border-left: 4px solid #cbd5e1;
            position: relative;
        }
        .card-highlight::after { content: "❝"; position: absolute; right: 15px; top: 5px; font-size: 40px; color: #e2e8f0; opacity: 0.5; font-family: serif; pointer-events: none; }

        /* 2. 笔记区域 (下) */
        .card-user-note {
            padding: 16px 20px;
            background: #fffbeb; /* 暖黄 */
            color: #92400e;
            font-size: 14px;
            line-height: 1.6;
            border-top: 1px solid #fef3c7;
            position: relative;
        }
        .card-user-note::before {
            content: "YOUR NOTE"; display: block; font-size: 10px; font-weight: 700;
            color: #b45309; margin-bottom: 6px; letter-spacing: 0.5px;
        }

        /* Meta */
        .card-meta {
            padding: 10px 20px; background: white; border-top: 1px solid #f1f5f9;
            font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between;
        }

        /* Raw / JSON / Export Views */


        /* 弹窗/面板 */
        .overlay-panel {
            position: absolute; inset: 0; background: rgba(255,255,255,0.98); z-index: 50;
            padding: 30px; display: none; flex-direction: column; gap: 15px;
            animation: fadeIn 0.2s ease;
        }
        .overlay-panel.show { display: flex; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

        /* 表单元素 */
        .input-group label { display: block; font-size: 12px; color: var(--text-sub); margin-bottom: 6px; font-weight: 500; }
        input, textarea, select {
            width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px;
            font-size: 13px; font-family: inherit; transition: border 0.2s; outline: none; resize: vertical;
        }
        input:focus, textarea:focus { border-color: var(--primary); }
        
        .btn-group { display: flex; gap: 10px; }
        .btn {
            padding: 9px 16px; background: var(--primary); color: white; border: none; border-radius: 6px;
            cursor: pointer; font-size: 13px; font-weight: 500; flex: 1; transition: 0.2s; display: flex; align-items: center; justify-content: center; gap: 6px;
        }
        .btn:hover { background: var(--primary-hover); }
        .btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-sec { background: white; color: var(--text-main); border: 1px solid var(--border); }
        .btn-sec:hover { background: #f1f5f9; }
        .btn-danger { color: #ef4444; border-color: #ef4444; background: white; }
        .btn-danger:hover { background: #fef2f2; }

        .toast {
            position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
            background: #1e293b; color: white; padding: 8px 16px; border-radius: 20px;
            font-size: 12px; opacity: 0; pointer-events: none; transition: opacity 0.3s; z-index: 100;
        }
        .toast.show { opacity: 1; }

        .variable-tag { 
            display: inline-block; padding: 2px 6px; background: #e0e7ff; color: var(--primary); 
            border-radius: 4px; font-size: 11px; margin-right: 4px; margin-bottom: 4px; cursor: pointer; 
        }
        .variable-tag:hover { background: #c7d2fe; }
    `;

    const styleSheet = document.createElement('style');
    styleSheet.textContent = styles;
    shadow.appendChild(styleSheet);

    // --- 4. HTML 结构 ---
    const container = document.createElement('div');
    container.innerHTML = `
        <div class="fab" id="fab">📚</div>
        <div class="container" id="panel">
            <!-- Sidebar -->
            <div class="sidebar">
                <div class="sidebar-header">
                    <span>NoteSync <span style="opacity:0.5; font-weight:400">Pro v5.6.1</span></span>
                    <span class="status-badge" id="status-badge">Idle</span>
                </div>
                <div class="book-list" id="book-list"></div>
                <div class="sidebar-footer">
                    <button class="btn" id="btn-sync">🔄 Sync Now</button>
                    <div class="btn-group">
                        <button class="btn btn-sec" id="btn-export-ui">📤 Export</button>
                        <button class="btn btn-sec" id="btn-config">⚙️</button>
                    </div>
                </div>
            </div>

            <!-- Main Content -->
            <div class="main">
                <div class="main-header">
                    <div class="header-title" id="header-title">Select a book to view</div>
                    <div style="display:flex; align-items:center; gap:15px">
                        <div class="view-tabs">
                            <div class="tab-btn active" data-mode="card">Card</div>
                            <div class="tab-btn" data-mode="json">JSON</div>
                            <div class="tab-btn" data-mode="raw">Raw</div>
                        </div>
                        <div style="cursor:pointer; font-size:18px; color:#94a3b8" id="btn-close">✕</div>
                    </div>
                </div>
                <div class="content-scroll" id="content-area">
                    <div style="padding:80px 20px; text-align:center; color:#94a3b8;">
                        <div style="font-size:48px; margin-bottom:15px; opacity:0.5">📖</div>
                        Click "Sync Now" to load your .an files
                    </div>
                </div>
                <div class="toast" id="toast">Notification</div>
            </div>
            
            <!-- Config Panel -->
            <div class="overlay-panel" id="settings-layer">
                <h3 style="margin:0">Configuration</h3>
                <div class="input-group"><label>WebDAV URL</label><input id="inp-url" value="${config.url}"></div>
                <div class="input-group"><label>Username</label><input id="inp-user" value="${config.username}"></div>
                <div class="input-group"><label>Password (App Token)</label><input type="password" id="inp-pass" value="${config.password}"></div>
                <div class="input-group"><label>Folder Path</label><input id="inp-folder" value="${config.folder}"></div>
                <div class="btn-group" style="margin-top:auto">
                    <button class="btn" id="btn-save">Save Settings</button>
                    <button class="btn btn-sec" id="btn-cancel">Cancel</button>
                </div>
                <button class="btn btn-danger" id="btn-clear-cache">清理缓存（之后请重新同步）</button>
            </div>

            <!-- Export Panel -->
            <div class="overlay-panel" id="export-layer">
                <h3 style="margin:0">Export Notes</h3>
                <div style="font-size:12px; color:var(--text-sub);">
                    Custom Template Variables (Click to copy):<br>
                    <span class="variable-tag" title="Click to copy">{{bookTitle}}</span>
                    <span class="variable-tag">{{chapterIndex}}</span>
                    <span class="variable-tag">{{timeString}}</span>
                    <span class="variable-tag">{{highlightText}}</span>
                    <span class="variable-tag">{{userNote}}</span>
                    <span class="variable-tag">{{page}}</span>
                </div>
                <div class="input-group" style="flex:1; display:flex; flex-direction:column;">
                    <label>Export Template (Markdown supported)</label>
                    <textarea id="inp-template" style="flex:1; font-family:monospace; line-height:1.5">${exportTemplate}</textarea>
                </div>
                <div class="btn-group">
                    <button class="btn" id="btn-download-md">⬇️ Download .md</button>
                    <button class="btn" id="btn-download-txt">⬇️ Download .txt</button>
                    <button class="btn btn-sec" id="btn-close-export">Close</button>
                </div>
            </div>
        </div>
    `;
    shadow.appendChild(container);

    // --- 5. DOM 引用 ---
    const ui = {
        fab: shadow.getElementById('fab'), panel: shadow.getElementById('panel'), close: shadow.getElementById('btn-close'), 
        sync: shadow.getElementById('btn-sync'), configBtn: shadow.getElementById('btn-config'), exportBtn: shadow.getElementById('btn-export-ui'),
        bookList: shadow.getElementById('book-list'), contentArea: shadow.getElementById('content-area'), headerTitle: shadow.getElementById('header-title'), 
        settingsLayer: shadow.getElementById('settings-layer'), exportLayer: shadow.getElementById('export-layer'),
        statusBadge: shadow.getElementById('status-badge'), toast: shadow.getElementById('toast'),
        inputs: { url: shadow.getElementById('inp-url'), user: shadow.getElementById('inp-user'), pass: shadow.getElementById('inp-pass'), folder: shadow.getElementById('inp-folder'), template: shadow.getElementById('inp-template') },
        btnSave: shadow.getElementById('btn-save'), btnCancel: shadow.getElementById('btn-cancel'), btnClearCache: shadow.getElementById('btn-clear-cache'),
        btnDlMd: shadow.getElementById('btn-download-md'), btnDlTxt: shadow.getElementById('btn-download-txt'), btnCloseExport: shadow.getElementById('btn-close-export'),
        tabs: shadow.querySelectorAll('.tab-btn'), vars: shadow.querySelectorAll('.variable-tag')
    };

    // --- 6. 工具函数 ---
    const showToast = (msg) => { ui.toast.textContent = msg; ui.toast.classList.add('show'); setTimeout(() => ui.toast.classList.remove('show'), 2500); };
    const escapeHtml = (str) => (!str ? '' : str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    
    // --- 7. 核心：WebDAV 与 解压 ---
    const getAuthHeader = () => 'Basic ' + btoa(unescape(encodeURIComponent(config.username + ':' + config.password)));
    const joinUrl = (baseUrl, path) => {
        const cleanBase = baseUrl.replace(/\/+$/, '');
        if (path.startsWith('http')) return path;
        try {
            const baseObj = new URL(cleanBase);
            if (!path.startsWith('/')) path = '/' + path;
            return baseObj.origin + path;
        } catch (e) { return cleanBase + '/' + path.replace(/^\/+/, ''); }
    };

    // 解压逻辑
    function decodeAnFile(arrayBuffer) {
        const uint8Array = new Uint8Array(arrayBuffer);
        try { return pako.inflateRaw(uint8Array, { to: 'string' }); }
        catch (e1) {
            try { return pako.inflate(uint8Array, { to: 'string' }); }
            catch (e2) {
                try { return pako.ungzip(uint8Array, { to: 'string' }); }
                catch (e3) { return new TextDecoder("utf-8").decode(arrayBuffer); }
            }
        }
    }

    // --- 8. 核心：Gap Analysis 解析 ---
    function normalizeNoteText(value, removeTrailingOne = false) {
        let result = String(value == null ? '' : value).replace(/\r\n?/g, '\n');

        // 静读天下可能在高亮开头写入 <BR>；开头的标签不应形成空白行。
        result = result.replace(/^\s*(?:<br\s*\/?>\s*)+/i, '');

        // 正文中间的 <BR> 转换为真正的换行。
        result = result.replace(/<br\s*\/?>/gi, '\n');

        // 部分 .an 记录会把独立的数字 1 附加在高亮正文末尾。
        // 只移除末尾独立一行的 1，不碰正文中的其他数字。
        if (removeTrailingOne) {
            result = result.replace(/\n[ \t]*1[ \t]*$/, '');
        }

        return result;
    }

    function isDeletedNote(note) {
        const marker = /\*DELETED\*/i;
        return marker.test(String(note.highlightText || '')) ||
               marker.test(String(note.userNote || ''));
    }

    // PDF 笔记使用的另一种 Raw 格式：
    // 216#A*#1#A1#时间戳#A2#章节/位置#A3#位置/长度#A4#颜色#A5#类型#A6#用户批注#A7#高亮正文#A8#附加文本#A@#
    // 该格式不是按换行分段，必须按 #A@# 记录结束标记解析。
    function parseTaggedPdfNotes(text) {
        const notes = [];
        const records = String(text || '').split(/#A@#/);

        for (const rawRecord of records) {
            // 分隔符实际为 ##A@##；按 #A@# 拆分后，后续记录前面会残留一个 #。
            // 同时兼容：首条记录前有数字前缀（如 216），后续记录没有数字前缀。
            const record = rawRecord.trim().replace(/^#(?=#A\*#)/, '');
            if (!record || !/#A1#/.test(record) || !/#A7#/.test(record)) continue;

            // 数字前缀为可选捕获组，保留原有分组编号，避免字段索引整体错位。
            // 正文字段允许包含换行和普通 # 字符。
            const head = record.match(/^(?:(\d+))?#A\*#([^#]*)#A1#(\d+)#A2#([^#]*)#A3#([^#]*)#A4#([^#]*)#A5#([^#]*)#A6#([\s\S]*?)#A7#/);
            if (!head) continue;

            const tail = record.slice(head[0].length);
            const a8Index = tail.lastIndexOf('#A8#');
            const highlightRaw = a8Index >= 0 ? tail.slice(0, a8Index) : tail;
            const extraRaw = a8Index >= 0 ? tail.slice(a8Index + 4) : '';

            const timestamp = parseInt(head[3], 10) || 0;
            const chapterIndex = parseInt(head[4], 10) || 0;
            const startPos = parseInt(head[5], 10) || 0;
            const userNote = normalizeNoteText(head[8]);
            const highlightText = normalizeNoteText(highlightRaw);
            const extraText = normalizeNoteText(extraRaw);

            // A6 是批注字段；若 A6 为空而 A8 有内容，则将 A8 作为批注保留。
            const note = {
                id: head[1] || head[2],
                bookTitle: '',
                chapterIndex,
                startPos,
                length: 0,
                colorCode: head[6],
                timestamp,
                timeString: timestamp > 0
                    ? new Date(timestamp).toLocaleString('zh-CN', {
                        year: 'numeric', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
                    }) : '',
                userNote: userNote || extraText,
                highlightText,
                page: Math.floor(startPos / 1000),
                recordType: head[2]
            };

            if (!isDeletedNote(note) && (note.userNote || note.highlightText)) notes.push(note);
        }

        notes.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        return notes;
    }

    function parseMoonReaderContent(text) {
        // PDF 的 #A 标签记录优先使用专用解析器；不影响原有 EPUB/文本类 .an 格式。
        if (/#A1#\d+#A2#/.test(text) && /#A@#/.test(text)) {
            const taggedNotes = parseTaggedPdfNotes(text);
            return { raw: text, json: taggedNotes };
        }

        const sections = text.split(/\n#\r?\n/);
        const notes = [];

        for (let i = 1; i < sections.length; i++) {
            const section = sections[i].trim();
            if (!section) continue;

            // 删除记录保留了 *DELETED* 墓碑标记，不作为有效笔记解析。
            if (/\*DELETED\*/i.test(section)) continue;

            const lines = section.split(/\n/).map(l => l.trimEnd());
            if (lines.length < 10) continue;

            const ts = parseInt(lines[9], 10) || 0;
            const startPos = parseInt(lines[6], 10) || 0;

            const noteData = {
                id: lines[0],
                bookTitle: lines[1],
                chapterIndex: parseInt(lines[4], 10) || 0,
                startPos,
                length: parseInt(lines[7], 10) || 0,
                colorCode: lines[8],
                timestamp: ts,
                // 明确采用 24 小时制；时间戳仍保留原始毫秒精度。
                timeString: ts > 0
                    ? new Date(ts).toLocaleString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hourCycle: 'h23'
                    })
                    : '',
                userNote: '',
                highlightText: '',
                page: Math.floor(startPos / 1000) // 估算页码
            };

            // Gap Analysis
            let firstContentIndex = -1;
            for (let k = 10; k < lines.length; k++) {
                const line = lines[k].trim();
                if (line !== '' && line !== '0') {
                    firstContentIndex = k;
                    break;
                }
            }

            if (firstContentIndex !== -1) {
                let lastContentIndex = lines.length - 1;
                while (
                    lastContentIndex >= firstContentIndex &&
                    (lines[lastContentIndex].trim() === '0' ||
                     lines[lastContentIndex].trim() === '')
                ) {
                    lastContentIndex--;
                }

                const contentLines = lines.slice(firstContentIndex, lastContentIndex + 1);
                const gap = firstContentIndex - 10;

                if (gap === 1) {
                    noteData.userNote = normalizeNoteText(contentLines[0]);
                    if (contentLines.length > 1) {
                        noteData.highlightText = normalizeNoteText(
                            contentLines.slice(1).join('\n'),
                            true
                        );
                    }
                } else {
                    noteData.highlightText = normalizeNoteText(
                        contentLines.join('\n'),
                        true
                    );
                }
            }

            // 再次检查解析后的字段，避免删除标记被字段划分隐藏。
            if (isDeletedNote(noteData)) continue;

            if (noteData.userNote || noteData.highlightText) {
                notes.push(noteData);
            }
        }

        // 使用原始 Unix 毫秒时间戳排序，不依赖显示用的 timeString。
        notes.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        return { raw: text, json: notes };
    }

    // --- 9. 核心：同步逻辑 ---
    const startSync = async () => {
        if (!config.url || !config.username) { ui.settingsLayer.classList.add('show'); return; }
        if (ui.sync.disabled) return;

        // 记录当前选中的书名；同步完成后用新数据刷新当前页面。
        const selectedBookName = currentBookData ? currentBookData.displayName : null;
        ui.sync.disabled = true;
        ui.sync.textContent = "Connecting...";
        ui.statusBadge.textContent = "Busy";

        try {
            const fullUrl = config.url.replace(/\/+$/, '') + (config.folder.startsWith('/') ? config.folder : '/' + config.folder);
            const listRes = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "PROPFIND",
                    url: fullUrl,
                    headers: {
                        "Authorization": getAuthHeader(),
                        "Depth": "1",
                        "Cache-Control": "no-cache",
                        "Pragma": "no-cache"
                    },
                    onload: res => res.status >= 200 && res.status < 300
                        ? resolve(res.responseText)
                        : reject(new Error("WebDAV目录读取失败：" + res.status + " " + res.statusText)),
                    onerror: () => reject(new Error("Network Error"))
                });
            });

            const parser = new DOMParser();
            const xml = parser.parseFromString(listRes, "text/xml");
            if (xml.getElementsByTagName("parsererror").length) {
                throw new Error("WebDAV返回的目录列表不是有效XML");
            }

            const responses = xml.getElementsByTagNameNS("*", "response");
            const files = [];
            for (let i = 0; i < responses.length; i++) {
                const hrefNode = responses[i].getElementsByTagNameNS("*", "href")[0];
                if (!hrefNode) continue;
                const href = hrefNode.textContent;
                const name = decodeURIComponent(href.replace(/\/$/, '').split('/').pop());
                const lastMod = responses[i].getElementsByTagNameNS("*", "getlastmodified")[0]?.textContent || '0';
                const resourceType = responses[i].getElementsByTagNameNS("*", "resourcetype")[0];
                // 目录本身以及子目录不作为笔记文件处理。
                if (name && name.toLowerCase().endsWith('.an') && !name.startsWith('.') &&
                    !(resourceType && resourceType.getElementsByTagNameNS("*", "collection").length)) {
                    files.push({ name, path: href, lastMod });
                }
            }

            const cacheText = GM_getValue(CACHE_KEY);
            const cache = cacheText ? JSON.parse(cacheText) : {};
            const updatedCache = { ...cache };

            // 重要修复：
            // 不再只依赖 PROPFIND 的 getlastmodified 判断是否下载。
            // 某些 WebDAV 服务/同步客户端可能出现文件内容已更新、getlastmodified
            // 却未变化或精度不足的情况。每次点击 Sync Now 都重新 GET 所有 .an 文件，
            // 以文件实际内容为准，避免缓存把新增笔记挡在同步队列之外。
            let successCount = 0;
            let failCount = 0;

            if (files.length === 0) {
                // 目录确实为空时，清除已不存在的书籍缓存。
                const currentNames = new Set();
                Object.keys(updatedCache).forEach(name => {
                    if (!currentNames.has(name)) delete updatedCache[name];
                });
                GM_setValue(CACHE_KEY, JSON.stringify(updatedCache));
                currentBookData = null;
                renderBookList(updatedCache);
                ui.headerTitle.textContent = "No books found";
                ui.contentArea.innerHTML = '';
                showToast("没有找到 .an 笔记文件");
            } else {
                showToast(`正在重新读取 ${files.length} 个笔记文件...`);

                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    ui.sync.textContent = `Sync ${i + 1}/${files.length}`;

                    try {
                        const buffer = await new Promise((resolve, reject) => {
                            GM_xmlhttpRequest({
                                method: "GET",
                                url: joinUrl(config.url, file.path),
                                responseType: 'arraybuffer',
                                headers: {
                                    "Authorization": getAuthHeader(),
                                    "Cache-Control": "no-cache",
                                    "Pragma": "no-cache"
                                },
                                onload: res => res.status === 200
                                    ? resolve(res.response)
                                    : reject(new Error("HTTP " + res.status + " " + res.statusText)),
                                onerror: () => reject(new Error("下载失败：" + file.name))
                            });
                        });

                        const text = decodeAnFile(buffer);
                        const previous = updatedCache[file.name];
                        const unchanged = previous && previous.raw === text;

                        // 同步阶段只下载/解压并保存原始文本，不解析笔记。
                        // 只有用户选中这本书时，ensureBookParsed() 才会解析它。
                        updatedCache[file.name] = {
                            fileKey: file.name,
                            lastMod: file.lastMod,
                            displayName: file.name.replace(/\.an$/i, ''),
                            updateTime: Date.now(),
                            data: unchanged && Array.isArray(previous.data) ? previous.data : null,
                            raw: text
                        };
                        successCount++;
                    } catch (e) {
                        console.error("[NoteSync] " + file.name, e);
                        failCount++;
                        // 单个文件下载失败时保留旧缓存，不因一次网络/服务器错误丢失已有笔记。
                    }
                }

                // 移除服务器目录中已经不存在的文件缓存。
                const remoteNames = new Set(files.map(f => f.name));
                Object.keys(updatedCache).forEach(name => {
                    if (!remoteNames.has(name)) {
                        delete updatedCache[name];
                        bookViewCache.delete(name);
                    }
                });

                GM_setValue(CACHE_KEY, JSON.stringify(updatedCache));

                // 同步完成后刷新书籍列表，并重新选中原书籍。
                renderBookList(updatedCache, selectedBookName);

                if (failCount === 0) {
                    showToast(`同步完成：已重新读取 ${successCount} 个文件`);
                } else {
                    showToast(`同步完成：成功 ${successCount} 个，失败 ${failCount} 个；失败文件保留旧数据`);
                }
            }
        } catch (err) {
            console.error("[NoteSync] Sync error:", err);
            showToast("同步失败：" + err.message);
        } finally {
            ui.sync.disabled = false;
            ui.sync.textContent = "🔄 Sync Now";
            ui.statusBadge.textContent = "Idle";
        }
    };

    // --- 10. 导出逻辑 (新增) ---
    function handleExport(type) {
        if (!currentBookData) { showToast("No book selected!"); return; }
        const exportData = ensureBookParsed(currentBookData);
        if (!Array.isArray(exportData)) { showToast("No notes available!"); return; }
        
        const tpl = ui.inputs.template.value;
        GM_setValue(TEMPLATE_KEY, tpl); // 保存模板
        
        let content = "";
        exportData
            .filter(note => !isDeletedNote(note))
            .slice()
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
            .forEach(note => {
            let item = tpl;
            // 替换变量；用函数返回值，避免正文中的 $ 字符被 replace 当作特殊替换符。
            for (const key in note) {
                let val = note[key] !== undefined ? note[key] : "";
                if (key === 'highlightText') val = normalizeNoteText(val, true);
                if (key === 'userNote') val = normalizeNoteText(val, false);
                item = item.replace(new RegExp(`{{${key}}}`, 'g'), () => String(val));
            }
            // 清理未定义的空变量
            item = item.replace(/{{.*?}}/g, "");
            content += item + "\n";
        });

        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentBookData.displayName}_notes.${type}`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`Downloaded as .${type}`);
    }

    // --- 11. 渲染逻辑 (卡片布局优化) ---
    function renderBookList(cache, preferredBookName = null) {
        ui.bookList.innerHTML = '';
        const list = Object.values(cache).sort((a, b) => b.updateTime - a.updateTime);
        if (list.length === 0) {
            ui.bookList.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:12px">No books found</div>';
            currentBookData = null;
            return;
        }

        let preferredElement = null;
        let firstElement = null;

        list.forEach(book => {
            const el = document.createElement('div');
            el.className = 'book-item';
            el.innerHTML = `<div class="book-title">${escapeHtml(book.displayName)}</div><div class="book-info"><span>${new Date(book.updateTime).toLocaleDateString()}</span><span>${Array.isArray(book.data) ? book.data.length + ' notes' : '待解析'}</span></div>`;
            el.addEventListener('click', () => {
                Array.from(ui.bookList.children).forEach(c => c.classList.remove('active'));
                el.classList.add('active');
                currentBookData = book;
                // 由当前选中的视图决定是否解析：Raw 只展示原文，不触发 JSON/笔记解析。
                renderContent(book);
                const info = el.querySelector('.book-info span:last-child');
                const cachedData = getBookViewCache(book).data;
                if (info && Array.isArray(cachedData)) info.textContent = `${cachedData.length} notes`;
            });
            ui.bookList.appendChild(el);

            if (!firstElement) firstElement = el;
            if (preferredBookName && book.displayName === preferredBookName) preferredElement = el;
        });

        // 自动重新载入当前选中的书籍，避免列表数据更新而右侧 Raw/JSON/Card 仍显示旧对象。
        const target = preferredElement || (preferredBookName ? null : null);
        if (target) {
            target.click();
        } else if (preferredBookName) {
            currentBookData = null;
            ui.headerTitle.textContent = "Select a book to view";
            ui.contentArea.innerHTML = '';
        }
    }

    // --- 大文本虚拟滚动：DOM中只保留可视区域附近的行 ---
    const VIRTUAL_LINE_HEIGHT = 18;
    const VIRTUAL_OVERSCAN = 70;

    function buildLineIndex(text) {
        // 两遍扫描并使用 Uint32Array，避免超长文本产生庞大的普通 JS 数组。
        let count = 1;
        for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++;
        const starts = new Uint32Array(count);
        let at = 1;
        for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts[at++] = i + 1;
        return starts;
    }

    function renderVirtualRows(view) {
        const viewport = view.viewport;
        const lineCount = view.lineStarts.length;
        const first = Math.max(0, Math.floor(viewport.scrollTop / VIRTUAL_LINE_HEIGHT) - VIRTUAL_OVERSCAN);
        const visible = Math.ceil(viewport.clientHeight / VIRTUAL_LINE_HEIGHT) + VIRTUAL_OVERSCAN * 2;
        const last = Math.min(lineCount, first + visible);
        view.layer.replaceChildren();
        view.layer.style.transform = `translateY(${first * VIRTUAL_LINE_HEIGHT}px)`;
        const frag = document.createDocumentFragment();
        for (let i = first; i < last; i++) {
            const start = view.lineStarts[i];
            const end = i + 1 < lineCount ? view.lineStarts[i + 1] - 1 : view.text.length;
            const line = document.createElement('div');
            line.className = 'virtual-line' + (view.matchLine === i ? ' match' : '');
            line.textContent = view.text.slice(start, end).replace(/\r$/, '') || ' ';
            frag.appendChild(line);
        }
        view.layer.appendChild(frag);
        view.status.textContent = `${lineCount.toLocaleString()} 行 · 显示 ${first + 1}-${last}`;
    }

    function createVirtualTextViewer(text, mode, cachedLineStarts = null) {
        ui.contentArea.classList.add('virtual-mode');
        const toolbar = document.createElement('div');
        toolbar.className = 'virtual-toolbar';
        const search = document.createElement('input');
        search.type = 'search'; search.placeholder = '在全文中搜索…'; search.setAttribute('aria-label', '搜索全文');
        const prev = document.createElement('button'); prev.textContent = '上一个';
        const next = document.createElement('button'); next.textContent = '下一个';
        const copy = document.createElement('button'); copy.textContent = '复制全文';
        const status = document.createElement('span'); status.className = 'virtual-status';
        toolbar.append(search, prev, next, copy, status);

        const viewport = document.createElement('div'); viewport.className = `virtual-viewport virtual-${mode}`;
        const spacer = document.createElement('div'); spacer.className = 'virtual-spacer';
        const layer = document.createElement('div'); layer.className = 'virtual-line-layer';
        spacer.appendChild(layer); viewport.appendChild(spacer);
        ui.contentArea.append(toolbar, viewport);

        const view = { text, lineStarts: cachedLineStarts || buildLineIndex(text), viewport, spacer, layer, status, matchLine: -1, matches: [], matchIndex: -1 };
        spacer.style.height = `${view.lineStarts.length * VIRTUAL_LINE_HEIGHT}px`;
        viewport.addEventListener('scroll', () => renderVirtualRows(view), { passive: true });

        function findMatches() {
            const q = search.value;
            view.matches = []; view.matchIndex = -1;
            if (!q) { view.matchLine = -1; renderVirtualRows(view); return; }
            const needle = q.toLocaleLowerCase();
            let pos = 0;
            // 分块转小写，避免为了搜索再复制一份完整的超大文本。
            const chunkSize = 1024 * 1024;
            while (pos < text.length && view.matches.length < 100000) {
                const end = Math.min(text.length, pos + chunkSize + needle.length - 1);
                const chunk = text.slice(pos, end).toLocaleLowerCase();
                let found = 0;
                while ((found = chunk.indexOf(needle, Math.max(0, found))) !== -1) {
                    if (found >= chunkSize) break; // 重叠区留给下一块处理，避免重复计数
                    const absolutePos = pos + found;
                    let lo = 0, hi = view.lineStarts.length;
                    while (lo < hi) { const mid = (lo + hi) >>> 1; if (view.lineStarts[mid] <= absolutePos) lo = mid + 1; else hi = mid; }
                    view.matches.push(lo - 1);
                    found += Math.max(1, needle.length);
                    if (view.matches.length >= 100000) break;
                }
                pos += chunkSize;
            }
            status.textContent = view.matches.length ? `${view.matches.length.toLocaleString()} 个匹配${view.matches.length >= 100000 ? '（最多显示前10万项）' : ''}` : '没有匹配';
            if (view.matches.length) gotoMatch(0); else { view.matchLine = -1; renderVirtualRows(view); }
        }
        function gotoMatch(direction) {
            if (!view.matches.length) return;
            if (direction === 'next') view.matchIndex = (view.matchIndex + 1) % view.matches.length;
            else if (direction === 'prev') view.matchIndex = (view.matchIndex - 1 + view.matches.length) % view.matches.length;
            else view.matchIndex = 0;
            view.matchLine = view.matches[view.matchIndex];
            viewport.scrollTop = Math.max(0, view.matchLine * VIRTUAL_LINE_HEIGHT - viewport.clientHeight / 3);
            renderVirtualRows(view);
            status.textContent = `${view.matchIndex + 1}/${view.matches.length} 个匹配 · 第 ${view.matchLine + 1} 行`;
        }
        search.addEventListener('input', findMatches);
        prev.addEventListener('click', () => gotoMatch('prev'));
        next.addEventListener('click', () => gotoMatch('next'));
        copy.addEventListener('click', async () => {
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
                else {
                    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
                    shadow.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
                }
                showToast('全文已复制');
            } catch (e) { showToast('复制失败：浏览器未授予剪贴板权限'); }
        });
        renderVirtualRows(view);
        requestAnimationFrame(() => renderVirtualRows(view));
    }

    function renderContent(book) {
        ui.contentArea.classList.remove('virtual-mode');
        ui.headerTitle.textContent = book.displayName;
        ui.contentArea.innerHTML = '';
        ui.contentArea.scrollTop = 0;

        const cached = getBookViewCache(book);

        // Raw 是原始解压文本的只读展示，不需要解析笔记，也不需要生成 JSON。
        if (currentViewMode === 'raw') {
            const rawText = book.raw || 'No raw content.';
            if (cached.rawText !== rawText) {
                cached.rawText = rawText;
                cached.rawLineStarts = null;
            }
            if (!cached.rawLineStarts) cached.rawLineStarts = buildLineIndex(rawText);
            createVirtualTextViewer(rawText, 'raw', cached.rawLineStarts);
            return;
        }

        // 只有 Card / JSON 视图才解析当前选中的这一本书。
        const data = ensureBookParsed(book) || [];

        if (currentViewMode === 'json') {
            if (!cached.sortedData) {
                cached.sortedData = data.slice()
                    .filter(note => !isDeletedNote(note))
                    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            }
            if (cached.jsonText === undefined) {
                cached.jsonText = JSON.stringify(cached.sortedData, null, 2);
                cached.jsonLineStarts = null;
            }
            if (!cached.jsonLineStarts) cached.jsonLineStarts = buildLineIndex(cached.jsonText);
            createVirtualTextViewer(cached.jsonText, 'json', cached.jsonLineStarts);
            return;
        }

        // Card 也复用当前书籍的排序/过滤结果，不重复计算。
        if (!cached.sortedData) {
            cached.sortedData = data.slice()
                .filter(note => !isDeletedNote(note))
                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        }
        const cardData = cached.sortedData;
        if (cardData.length === 0) { ui.contentArea.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:40px">No notes parsed.<br>Try viewing Raw format.</div>'; return; }
        cardData.forEach(note => {
            const c = document.createElement('div'); c.className = 'note-card';
            let has = false;
            if(note.highlightText){ const d=document.createElement('div');d.className='card-highlight';d.textContent=note.highlightText;c.appendChild(d); has=true; }
            if(note.userNote){ const d=document.createElement('div');d.className='card-user-note';d.textContent=note.userNote;c.appendChild(d); has=true; }
            if(has){ const m=document.createElement('div');m.className='card-meta';m.innerHTML=`<span>${note.timeString}</span><span>Ch.${note.chapterIndex}</span>`; c.appendChild(m); ui.contentArea.appendChild(c); }
        });
    }

    // --- 12. 事件监听 ---
    ui.fab.onclick = () => ui.panel.classList.toggle('open');
    ui.close.onclick = () => ui.panel.classList.remove('open');
    
    // Config
    ui.configBtn.onclick = () => ui.settingsLayer.classList.add('show');
    ui.btnCancel.onclick = () => ui.settingsLayer.classList.remove('show');
    ui.btnSave.onclick = () => {
        config = { url: ui.inputs.url.value, username: ui.inputs.user.value, password: ui.inputs.pass.value, folder: ui.inputs.folder.value };
        GM_setValue(CONFIG_KEY, JSON.stringify(config)); ui.settingsLayer.classList.remove('show'); showToast("Settings Saved");
    };
    ui.btnClearCache.onclick = () => {
        if (confirm("清理本插件的笔记解析缓存？不会删除 WebDAV 中的笔记、账号设置或导出模板。清理后请点击 Sync Now 重新同步。")) {
            GM_deleteValue(CACHE_KEY);
            GM_deleteValue('mr_sync_cache_v12');
            GM_deleteValue('mr_sync_cache_v11');
            GM_deleteValue('mr_sync_cache_v10');
            GM_deleteValue('mr_sync_cache_v9');
            GM_deleteValue('mr_sync_cache_v8');
            GM_deleteValue('mr_sync_cache_v7');
            GM_deleteValue('mr_sync_cache_v6');
            GM_deleteValue(LEGACY_CACHE_KEY);
            currentBookData = null;
            renderBookList({});
            ui.headerTitle.textContent = "Select a book to view";
            ui.contentArea.innerHTML = '';
            showToast("缓存已清理，请重新同步");
            ui.settingsLayer.classList.remove('show');
        }
    };
    
    // Export
    ui.exportBtn.onclick = () => ui.exportLayer.classList.add('show');
    ui.btnCloseExport.onclick = () => ui.exportLayer.classList.remove('show');
    ui.btnDlMd.onclick = () => handleExport('md');
    ui.btnDlTxt.onclick = () => handleExport('txt');
    
    // Helper: copy var name
    ui.vars.forEach(v => v.onclick = (e) => {
        const val = e.target.textContent;
        ui.inputs.template.setRangeText(val, ui.inputs.template.selectionStart, ui.inputs.template.selectionEnd, 'end');
        ui.inputs.template.focus();
    });

    // Tabs
    ui.tabs.forEach(t => t.onclick = (e) => {
        ui.tabs.forEach(x => x.classList.remove('active')); e.target.classList.add('active');
        currentViewMode = e.target.dataset.mode; if (currentBookData) renderContent(currentBookData);
    });
    
    ui.sync.onclick = startSync;

    // Init
    if(savedConfig && GM_getValue(CACHE_KEY)) renderBookList(JSON.parse(GM_getValue(CACHE_KEY)));
})();
