// ==UserScript==
// @name         MoonReader NoteSync v5.0
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  基于坚果云WebDAV，读取静读天下读书笔记并解析，支持卡片话展示和自定义模板导出(MD/TXT)，优化卡片布局与UI
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
    const CACHE_KEY = 'mr_sync_cache_v5';
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

        .content-scroll { flex: 1; overflow-y: auto; padding: 24px; background: #fcfcfc; scroll-behavior: smooth; }

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
        .code-view { white-space: pre-wrap; font-family: monospace; font-size: 12px; color: #333; background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid var(--border); }
        .raw-container { display: flex; background: #282c34; color: #abb2bf; font-family: Consolas, Monaco, monospace; font-size: 12px; border-radius: 8px; overflow: hidden; border: 1px solid #1e2227; line-height: 1.5; }
        .line-numbers { padding: 15px 10px; background: #21252b; color: #5c6370; text-align: right; border-right: 1px solid #181a1f; min-width: 35px; user-select: none;}
        .raw-content { padding: 15px; white-space: pre; overflow-x: auto; flex: 1; }

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
                    <span>NoteSync <span style="opacity:0.5; font-weight:400">Pro</span></span>
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
                <button class="btn btn-danger" id="btn-clear-cache">Clear Cache & Reset</button>
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
    function parseMoonReaderContent(text) {
        const sections = text.split(/\n#\r?\n/);
        const notes = [];
        for (let i = 1; i < sections.length; i++) {
            let section = sections[i].trim();
            if (!section) continue;
            const lines = section.split(/\n/).map(l => l.trimEnd());
            if (lines.length < 10) continue;

            const ts = parseInt(lines[9]) || 0;
            const noteData = {
                id: lines[0], bookTitle: lines[1], chapterIndex: parseInt(lines[4])||0,
                startPos: parseInt(lines[6])||0, length: parseInt(lines[7])||0, colorCode: lines[8],
                timestamp: ts, timeString: ts > 0 ? new Date(ts).toLocaleString() : "",
                userNote: "", highlightText: "", page: Math.floor(parseInt(lines[6])/1000) // 估算页码
            };

            // Gap Analysis
            let firstContentIndex = -1;
            for (let k = 10; k < lines.length; k++) {
                const l = lines[k].trim();
                if (l !== "" && l !== "0") { firstContentIndex = k; break; }
            }

            if (firstContentIndex !== -1) {
                let lastContentIndex = lines.length - 1;
                while(lastContentIndex >= firstContentIndex && (lines[lastContentIndex].trim() === '0' || lines[lastContentIndex].trim() === '')) { lastContentIndex--; }
                const contentLines = lines.slice(firstContentIndex, lastContentIndex + 1);
                const gap = firstContentIndex - 10;

                if (gap === 1) {
                    noteData.userNote = contentLines[0].replace(/<BR>/gi, '\n');
                    if (contentLines.length > 1) noteData.highlightText = contentLines.slice(1).join('\n');
                } else {
                    noteData.highlightText = contentLines.join('\n');
                }
            }
            if(noteData.userNote || noteData.highlightText) notes.push(noteData);
        }
        return { raw: text, json: notes };
    }

    // --- 9. 核心：同步逻辑 ---
    const startSync = async () => {
        if (!config.url || !config.username) { ui.settingsLayer.classList.add('show'); return; }
        ui.sync.disabled = true; ui.sync.textContent = "Connecting..."; ui.statusBadge.textContent = "Busy";
        
        try {
            const fullUrl = config.url.replace(/\/+$/, '') + (config.folder.startsWith('/') ? config.folder : '/' + config.folder);
            const listRes = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "PROPFIND", url: fullUrl, headers: { "Authorization": getAuthHeader(), "Depth": "1" },
                    onload: res => res.status >= 200 && res.status < 300 ? resolve(res.responseText) : reject(new Error(res.statusText)),
                    onerror: () => reject(new Error("Network Error"))
                });
            });

            const parser = new DOMParser();
            const xml = parser.parseFromString(listRes, "text/xml");
            const responses = xml.getElementsByTagNameNS("*", "response");
            const files = [];
            for (let i=0; i<responses.length; i++) {
                const href = responses[i].getElementsByTagNameNS("*", "href")[0].textContent;
                const name = decodeURIComponent(href.replace(/\/$/, '').split('/').pop());
                const lastMod = responses[i].getElementsByTagNameNS("*", "getlastmodified")[0]?.textContent || '0';
                if (name && name.endsWith('.an') && !name.startsWith('.')) files.push({ name, path: href, lastMod });
            }

            const cache = GM_getValue(CACHE_KEY) ? JSON.parse(GM_getValue(CACHE_KEY)) : {};
            let updatedCache = { ...cache };
            const queue = files.filter(f => !cache[f.name] || cache[f.name].lastMod !== f.lastMod);

            if (queue.length === 0) { showToast("Up to date"); renderBookList(updatedCache); } 
            else {
                showToast(`Syncing ${queue.length} files...`);
                for (let i=0; i<queue.length; i++) {
                    ui.sync.textContent = `Sync ${i+1}/${queue.length}`;
                    try {
                        const buffer = await new Promise((resolve, reject) => {
                            GM_xmlhttpRequest({
                                method: "GET", url: joinUrl(config.url, queue[i].path), responseType: 'arraybuffer', headers: { "Authorization": getAuthHeader() },
                                onload: res => res.status===200 ? resolve(res.response) : reject(new Error("DL Err")), onerror: reject
                            });
                        });
                        const text = decodeAnFile(buffer);
                        const result = parseMoonReaderContent(text);
                        updatedCache[queue[i].name] = {
                            lastMod: queue[i].lastMod, displayName: queue[i].name.replace(/\.an$/, ''),
                            updateTime: Date.now(), data: result.json, raw: result.raw
                        };
                    } catch (e) { console.error(queue[i].name, e); }
                }
                GM_setValue(CACHE_KEY, JSON.stringify(updatedCache));
                renderBookList(updatedCache);
                showToast(`Sync complete!`);
            }
        } catch (err) { showToast("Error: " + err.message); } 
        finally { ui.sync.disabled = false; ui.sync.textContent = "🔄 Sync Now"; ui.statusBadge.textContent = "Idle"; }
    };

    // --- 10. 导出逻辑 (新增) ---
    function handleExport(type) {
        if (!currentBookData || !currentBookData.data) { showToast("No book selected!"); return; }
        
        const tpl = ui.inputs.template.value;
        GM_setValue(TEMPLATE_KEY, tpl); // 保存模板
        
        let content = "";
        currentBookData.data.forEach(note => {
            let item = tpl;
            // 替换变量
            for (const key in note) {
                const val = note[key] !== undefined ? note[key] : "";
                item = item.replace(new RegExp(`{{${key}}}`, 'g'), val);
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
    function renderBookList(cache) {
        ui.bookList.innerHTML = '';
        const list = Object.values(cache).sort((a, b) => b.updateTime - a.updateTime);
        if(list.length === 0) { ui.bookList.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:12px">No books found</div>'; return; }
        list.forEach(book => {
            const el = document.createElement('div'); el.className = 'book-item';
            el.innerHTML = `<div class="book-title">${book.displayName}</div><div class="book-info"><span>${new Date(book.updateTime).toLocaleDateString()}</span><span>${book.data ? book.data.length : 0} notes</span></div>`;
            el.addEventListener('click', () => {
                Array.from(ui.bookList.children).forEach(c=>c.classList.remove('active'));
                el.classList.add('active'); currentBookData = book; renderContent(book);
            });
            ui.bookList.appendChild(el);
        });
    }

    function renderContent(book) {
        ui.headerTitle.textContent = book.displayName; ui.contentArea.innerHTML = ''; ui.contentArea.scrollTop = 0;
        const data = book.data || [];
        
        if (currentViewMode === 'raw') {
            const content = book.raw || "No raw content.";
            const lines = content.split('\n').map((_, i) => i + 1).join('\n');
            const c = document.createElement('div'); c.className = 'raw-container';
            c.innerHTML = `<div class="line-numbers">${lines}</div><div class="raw-content">${escapeHtml(content)}</div>`;
            ui.contentArea.appendChild(c);
        } else if (currentViewMode === 'json') {
            const el = document.createElement('div'); el.className = 'code-view';
            el.textContent = JSON.stringify(data, null, 2); ui.contentArea.appendChild(el);
        } else {
            if (data.length === 0) { ui.contentArea.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:40px">No notes parsed.<br>Try viewing Raw format.</div>'; return; }
            data.forEach(note => {
                const c = document.createElement('div'); c.className = 'note-card';
                let has = false;
                // 布局调整：高亮在上
                if(note.highlightText){ 
                    const d=document.createElement('div');d.className='card-highlight';d.textContent=note.highlightText;c.appendChild(d); has=true;
                }
                // 笔记在下
                if(note.userNote){ 
                    const d=document.createElement('div');d.className='card-user-note';d.textContent=note.userNote;c.appendChild(d); has=true;
                }
                if(has){
                    const m=document.createElement('div');m.className='card-meta';m.innerHTML=`<span>${note.timeString}</span><span>Ch.${note.chapterIndex}</span>`;
                    c.appendChild(m); ui.contentArea.appendChild(c);
                }
            });
        }
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
    ui.btnClearCache.onclick = () => { if(confirm("Clear all cache?")){GM_deleteValue(CACHE_KEY); renderBookList({}); ui.contentArea.innerHTML=''; showToast("Cache Cleared"); ui.settingsLayer.classList.remove('show');} };
    
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