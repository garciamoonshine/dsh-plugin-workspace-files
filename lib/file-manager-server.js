import fs from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
  ".sh": "text/plain; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".jsx": "text/plain; charset=utf-8",
  ".yml": "text/plain; charset=utf-8",
  ".yaml": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg"
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function sanitizePath(inputPath, basePath = "/root") {
  if (!inputPath || typeof inputPath !== "string") return basePath;
  const resolved = path.resolve(basePath, inputPath);
  // Ensure target starts with basePath boundary
  if (!resolved.startsWith(basePath)) return basePath;
  // Block direct access to sensitive system paths
  const rel = path.relative(basePath, resolved);
  const segments = rel.split(path.sep);
  if (segments.some((s) => s === ".ssh" || s === ".dsh")) {
    return basePath;
  }
  return resolved;
}

/**
 * Handle listing files in a directory
 */
export async function handleListFiles(req, res) {
  try {
    const url = new URL(req.url, "http://127.0.0.1:3080");
    const requestedPath = url.searchParams.get("path") || "/root";
    const targetDir = sanitizePath(requestedPath);

    const stat = await fs.stat(targetDir);
    if (!stat.isDirectory()) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Path is not a directory" }));
      return;
    }

    const dirents = await fs.readdir(targetDir, { withFileTypes: true });
    const items = [];

    for (const ent of dirents) {
      const fullPath = path.join(targetDir, ent.name);
      try {
        const s = await fs.stat(fullPath);
        items.push({
          name: ent.name,
          path: fullPath,
          isDirectory: ent.isDirectory(),
          isSymbolicLink: ent.isSymbolicLink(),
          size: s.size,
          sizeFormatted: ent.isDirectory() ? "--" : formatBytes(s.size),
          mtime: s.mtime.toISOString(),
          mtimeFormatted: s.mtime.toLocaleString(),
          ext: path.extname(ent.name).toLowerCase()
        });
      } catch (err) {
        // Skip inaccessible entries
      }
    }

    // Sort: directories first, then alphabetical
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    });

    const parentPath = targetDir === "/root" ? null : path.dirname(targetDir);

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      currentPath: targetDir,
      parentPath: parentPath && parentPath.startsWith("/root") ? parentPath : (targetDir === "/root" ? null : "/root"),
      items
    }));
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

/**
 * Handle streaming raw file contents
 */
export async function handleRawFile(req, res) {
  try {
    const url = new URL(req.url, "http://127.0.0.1:3080");
    const requestedPath = url.searchParams.get("path");
    if (!requestedPath) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("Missing path parameter");
      return;
    }

    const targetFile = sanitizePath(requestedPath);
    const stat = await fs.stat(targetFile);
    if (!stat.isFile()) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("Not a file");
      return;
    }

    const mime = getMimeType(targetFile);
    const isDownload = url.searchParams.get("download") === "1";
    const headers = {
      "content-type": mime,
      "content-length": stat.size
    };
    if (isDownload) {
      headers["content-disposition"] = `attachment; filename="${path.basename(targetFile)}"`;
    }

    res.writeHead(200, headers);
    const stream = createReadStream(targetFile);
    stream.pipe(res);
  } catch (err) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("File not found or inaccessible");
  }
}

/**
 * Handle file actions: mkdir, delete, rename
 */
export async function handleFileAction(req, res) {
  try {
    let body = "";
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body || "{}");
    const { action } = data;

    if (action === "mkdir") {
      const targetDir = sanitizePath(data.path);
      const folderName = (data.name || "").trim().replace(/[\/\\]/g, "");
      if (!folderName) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Invalid folder name" }));
        return;
      }
      const newFolder = path.join(targetDir, folderName);
      await fs.mkdir(newFolder, { recursive: true });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: newFolder }));
      return;
    }

    if (action === "delete") {
      const target = sanitizePath(data.path);
      if (target === "/root" || target === "/") {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Cannot delete root directory" }));
        return;
      }
      const rel = path.relative("/root", target);
      const parts = rel.split(path.sep);
      if (parts.some((p) => p === ".ssh" || p === ".dsh" || p === ".git")) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Cannot delete protected system directory" }));
        return;
      }
      await fs.rm(target, { recursive: true, force: true });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (action === "rename") {
      const oldPath = sanitizePath(data.oldPath);
      const newName = (data.newName || "").trim().replace(/[\/\\]/g, "");
      if (!newName || oldPath === "/root") {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Invalid rename parameters" }));
        return;
      }
      const newPath = path.join(path.dirname(oldPath), newName);
      await fs.rename(oldPath, newPath);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, newPath }));
      return;
    }

    if (action === "write") {
      const targetFile = sanitizePath(data.path);
      if (typeof data.content !== "string") {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Content must be string" }));
        return;
      }
      await fs.writeFile(targetFile, data.content, "utf8");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: `Unknown action: ${action}` }));
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

/**
 * Handle file upload directly to current directory
 */
export async function handleDirectUpload(req, res) {
  try {
    const protocol = req.socket.encrypted ? "https" : "http";
    const url = new URL(req.url, `${protocol}://${req.headers.host || "127.0.0.1"}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else if (value !== undefined) {
        headers.set(key, value);
      }
    }

    const webReq = new Request(url, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req,
      duplex: "half"
    });

    const formData = await webReq.formData();
    const file = formData.get("file");
    const targetDir = sanitizePath(formData.get("targetDir")?.toString() || "/root");

    if (!file || typeof file === "string") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "No file provided" }));
      return;
    }

    await fs.mkdir(targetDir, { recursive: true });
    let relName = (formData.get("name") || file.name || "uploaded-file").toString();
    relName = relName.replace(/^(\.\.[\/\\])+/g, "").replace(/^\/+/g, "");
    const destPath = path.resolve(targetDir, relName);

    if (!destPath.startsWith(targetDir)) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Invalid path" }));
      return;
    }

    await fs.mkdir(path.dirname(destPath), { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(destPath, buffer);

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      path: destPath,
      name: path.basename(destPath),
      size: buffer.byteLength
    }));
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

/**
 * Render the Mac Finder Web Interface HTML
 */
export function renderFinderHtml(options = {}) {
  const prefixPath = options.prefixPath || "/files";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workspace File Manager</title>
  <style>
    :root {
      --bg-primary: #18181b;
      --bg-secondary: #202024;
      --bg-sidebar: #141416;
      --bg-hover: rgba(255, 255, 255, 0.08);
      --bg-active: rgba(59, 130, 246, 0.15);
      --border-color: #27272a;
      --text-primary: #f4f4f5;
      --text-secondary: #a1a1aa;
      --text-muted: #71717a;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --danger: #ef4444;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg-primary);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 13px;
      line-height: 1.4;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      user-select: none;
    }
    /* Toolbar */
    .toolbar {
      height: 44px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      padding: 0 12px;
      gap: 10px;
      flex-shrink: 0;
    }
    .nav-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-secondary);
      border-radius: 6px;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s;
    }
    .nav-btn:hover:not(:disabled) {
      background: var(--bg-hover);
      color: var(--text-primary);
      border-color: var(--border-color);
    }
    .nav-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
    .breadcrumbs {
      display: flex;
      align-items: center;
      gap: 4px;
      background: rgba(0, 0, 0, 0.25);
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid var(--border-color);
      overflow-x: auto;
      max-width: 480px;
      white-space: nowrap;
      font-family: var(--font-mono);
      font-size: 12px;
    }
    .crumb {
      color: var(--text-secondary);
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 4px;
      transition: color 0.15s;
    }
    .crumb:hover { color: var(--accent); }
    .crumb-sep { color: var(--text-muted); font-size: 10px; }
    .crumb.current { color: var(--text-primary); font-weight: 600; }
    .spacer { flex: 1; }
    .search-box {
      position: relative;
      display: flex;
      align-items: center;
    }
    .search-input {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 5px 8px 5px 26px;
      color: var(--text-primary);
      font-size: 12px;
      outline: none;
      width: 150px;
      transition: width 0.2s, border-color 0.2s;
    }
    .search-input:focus { width: 200px; border-color: var(--accent); }
    .search-icon {
      position: absolute;
      left: 7px;
      color: var(--text-muted);
      pointer-events: none;
    }
    .action-btn {
      background: var(--bg-hover);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      border-radius: 6px;
      padding: 5px 10px;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .action-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      border-color: #3f3f46;
    }
    .action-btn.primary {
      background: var(--accent);
      border-color: var(--accent);
    }
    .action-btn.primary:hover { background: var(--accent-hover); }

    /* Layout */
    .main-body {
      flex: 1;
      display: flex;
      overflow: hidden;
    }
    /* Sidebar */
    .sidebar {
      width: 190px;
      background: var(--bg-sidebar);
      border-right: 1px solid var(--border-color);
      padding: 12px 8px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      flex-shrink: 0;
    }
    .sidebar-section-title {
      font-size: 10px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0 8px 4px 8px;
    }
    .sidebar-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 6px;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 12.5px;
      transition: all 0.15s;
    }
    .sidebar-item:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .sidebar-item.active {
      background: var(--bg-active);
      color: var(--accent);
      font-weight: 600;
    }
    /* Content Area */
    .content-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: var(--bg-primary);
      overflow: hidden;
      position: relative;
    }
    .file-table-container {
      flex: 1;
      overflow-y: auto;
    }
    table.file-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }
    table.file-table th {
      position: sticky;
      top: 0;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 8px 12px;
      z-index: 5;
    }
    table.file-table td {
      padding: 8px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: var(--text-secondary);
      font-size: 12.5px;
    }
    table.file-table tr.file-row {
      cursor: pointer;
      transition: background 0.1s;
    }
    table.file-table tr.file-row:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    table.file-table tr.file-row.selected {
      background: var(--bg-active);
      color: var(--text-primary);
    }
    .name-cell {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--text-primary);
      font-weight: 500;
    }
    .item-icon {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .actions-cell {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    tr.file-row:hover .actions-cell { opacity: 1; }
    .row-btn {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      border-radius: 4px;
      padding: 3px 6px;
      font-size: 11px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s;
    }
    .row-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
      border-color: #52525b;
    }
    .row-btn.chat-insert {
      color: #60a5fa;
      border-color: rgba(96, 165, 250, 0.3);
    }
    .row-btn.chat-insert:hover {
      background: rgba(59, 130, 246, 0.2);
    }
    .row-btn.danger:hover {
      color: var(--danger);
      border-color: var(--danger);
    }

    /* Footer status bar */
    .status-bar {
      height: 28px;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      padding: 0 14px;
      font-size: 11px;
      color: var(--text-muted);
      justify-content: space-between;
      flex-shrink: 0;
    }

    /* Drag & Drop Overlay inside Finder */
    #finder-drop-overlay {
      display: none;
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(4px);
      z-index: 50;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 12px;
      border: 2px dashed var(--accent);
      margin: 8px;
      border-radius: 10px;
    }

    /* Preview Modal */
    #preview-modal {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 100;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      align-items: center;
      justify-content: center;
    }
    .preview-box {
      width: 80vw;
      max-width: 900px;
      height: 80vh;
      max-height: 750px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.8);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .preview-header {
      height: 42px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      padding: 0 14px;
      gap: 10px;
    }
    .preview-title {
      flex: 1;
      font-weight: 600;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .preview-content {
      flex: 1;
      overflow: auto;
      padding: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #111113;
    }
    .preview-text {
      width: 100%;
      height: 100%;
      background: transparent;
      border: none;
      color: #e4e4e7;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.5;
      resize: none;
      outline: none;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .preview-img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <!-- Toolbar -->
  <div class="toolbar">
    <button class="nav-btn" id="btn-back" title="Back" disabled>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
    </button>
    <button class="nav-btn" id="btn-up" title="Parent Folder">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg>
    </button>
    <button class="nav-btn" id="btn-refresh" title="Refresh">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
    </button>

    <div class="breadcrumbs" id="breadcrumbs"></div>

    <div class="spacer"></div>

    <div class="search-box">
      <svg class="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
      <input type="text" class="search-input" id="search-input" placeholder="Search files...">
    </div>

    <button class="action-btn" id="btn-new-folder" title="New Folder">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>
      <span>New Folder</span>
    </button>

    <label class="action-btn primary" title="Upload files">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
      <span>Upload</span>
      <input type="file" id="file-uploader" multiple style="display:none">
    </label>
  </div>

  <!-- Main Body -->
  <div class="main-body">
    <!-- Sidebar -->
    <div class="sidebar">
      <div class="sidebar-section-title">Places</div>
      <div class="sidebar-item" data-path="/root/FILE MANAGER">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        <span>Workspace</span>
      </div>
      <div class="sidebar-item" data-path="/root/FILE MANAGER/Documents">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
        <span>Documents</span>
      </div>
      <div class="sidebar-item" data-path="/root">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>
        <span>Root (/root)</span>
      </div>
    </div>

    <!-- Content Area -->
    <div class="content-area" id="drop-zone">
      <div class="file-table-container">
        <table class="file-table">
          <thead>
            <tr>
              <th style="width: 45%;">Name</th>
              <th style="width: 15%;">Size</th>
              <th style="width: 20%;">Date Modified</th>
              <th style="width: 20%; text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody id="file-list"></tbody>
        </table>
      </div>

      <!-- Drag & drop overlay -->
      <div id="finder-drop-overlay">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
        <div style="font-weight: 600; font-size: 15px;">Drop files to upload here</div>
      </div>
    </div>
  </div>

  <!-- Status Bar -->
  <div class="status-bar">
    <span id="status-count">Loading...</span>
    <span style="color: #64748b;">Direct DSH Port 3080 &bull; No port 8080 required</span>
  </div>

  <!-- Preview Modal -->
  <div id="preview-modal">
    <div class="preview-box">
      <div class="preview-header">
        <div class="preview-title" id="preview-filename">File Preview</div>
        <button class="row-btn chat-insert" id="btn-preview-insert" title="Insert to Chat Composer">Insert to Chat</button>
        <button class="row-btn" id="btn-preview-save" style="display:none">Save</button>
        <button class="nav-btn" id="btn-preview-close" title="Close Preview">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div class="preview-content" id="preview-body"></div>
    </div>
  </div>

  <script>
    let currentPath = "/root/FILE MANAGER";
    let historyStack = [];
    let currentItems = [];
    let activePreviewPath = "";

    const fileListEl = document.getElementById("file-list");
    const breadcrumbsEl = document.getElementById("breadcrumbs");
    const statusCountEl = document.getElementById("status-count");
    const btnBack = document.getElementById("btn-back");
    const btnUp = document.getElementById("btn-up");
    const btnRefresh = document.getElementById("btn-refresh");
    const searchInput = document.getElementById("search-input");
    const previewModal = document.getElementById("preview-modal");
    const previewFilename = document.getElementById("preview-filename");
    const previewBody = document.getElementById("preview-body");
    const btnPreviewClose = document.getElementById("btn-preview-close");
    const btnPreviewInsert = document.getElementById("btn-preview-insert");
    const btnPreviewSave = document.getElementById("btn-preview-save");

    async function loadDirectory(targetPath, pushHistory = true) {
      try {
        statusCountEl.textContent = "Loading...";
        const res = await fetch("/api/workspace-files/list?path=" + encodeURIComponent(targetPath));
        const data = await res.json();
        if (!data.ok) {
          alert("Error: " + data.error);
          return;
        }

        if (pushHistory && currentPath !== data.currentPath) {
          historyStack.push(currentPath);
        }
        currentPath = data.currentPath;
        currentItems = data.items || [];
        btnBack.disabled = historyStack.length === 0;
        btnUp.disabled = !data.parentPath;

        renderBreadcrumbs(currentPath);
        renderFiles(currentItems);
        updateSidebarActive();
      } catch (err) {
        alert("Failed to load directory: " + err.message);
      }
    }

    function renderBreadcrumbs(pathStr) {
      breadcrumbsEl.innerHTML = "";
      const parts = pathStr.split("/").filter(Boolean);
      let accum = "";
      
      const rootCrumb = document.createElement("span");
      rootCrumb.className = "crumb" + (pathStr === "/root" ? " current" : "");
      rootCrumb.textContent = "root";
      rootCrumb.onclick = () => loadDirectory("/root");
      breadcrumbsEl.appendChild(rootCrumb);

      for (let i = 0; i < parts.length; i++) {
        if (parts[i] === "root") continue;
        accum += "/" + parts[i];
        const sep = document.createElement("span");
        sep.className = "crumb-sep";
        sep.textContent = ">";
        breadcrumbsEl.appendChild(sep);

        const crumb = document.createElement("span");
        const full = "/root" + accum;
        crumb.className = "crumb" + (i === parts.length - 1 ? " current" : "");
        crumb.textContent = parts[i];
        crumb.onclick = () => loadDirectory(full);
        breadcrumbsEl.appendChild(crumb);
      }
    }

    function getFileIcon(item) {
      if (item.isDirectory) {
        return '<svg width="18" height="18" viewBox="0 0 24 24" fill="#60a5fa" stroke="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
      }
      const ext = item.ext;
      if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) {
        return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
      }
      if (ext === ".pdf") {
        return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="9" y1="15" x2="15" y2="15"></line></svg>';
      }
      if ([".js", ".ts", ".py", ".sh", ".json", ".html", ".css", ".yml", ".yaml"].includes(ext)) {
        return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>';
      }
      return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
    }

    function renderFiles(items) {
      fileListEl.innerHTML = "";
      const query = (searchInput.value || "").trim().toLowerCase();
      const filtered = query ? items.filter(i => i.name.toLowerCase().includes(query)) : items;

      statusCountEl.textContent = \`\${filtered.length} item\${filtered.length !== 1 ? "s" : ""}\`;

      if (filtered.length === 0) {
        fileListEl.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 40px; color: var(--text-muted);">Folder is empty</td></tr>';
        return;
      }

      for (const item of filtered) {
        const tr = document.createElement("tr");
        tr.className = "file-row";

        tr.ondblclick = () => {
          if (item.isDirectory) {
            loadDirectory(item.path);
          } else {
            openPreview(item);
          }
        };

        tr.innerHTML = \`
          <td>
            <div class="name-cell">
              <span class="item-icon">\${getFileIcon(item)}</span>
              <span>\${escapeHtml(item.name)}</span>
            </div>
          </td>
          <td>\${item.sizeFormatted}</td>
          <td>\${item.mtimeFormatted}</td>
          <td>
            <div class="actions-cell">
              \${!item.isDirectory ? \`<button class="row-btn chat-insert" title="Insert reference into DSH Chat">@Chat</button>\` : ""}
              \${!item.isDirectory ? \`<button class="row-btn preview-btn" title="Preview">View</button>\` : ""}
              \${!item.isDirectory ? \`<button class="row-btn dl-btn" title="Download">Get</button>\` : ""}
              <button class="row-btn rename-btn" title="Rename">Edit</button>
              <button class="row-btn danger del-btn" title="Delete">Del</button>
            </div>
          </td>
        \`;

        // Wire action buttons
        const chatBtn = tr.querySelector(".chat-insert");
        if (chatBtn) {
          chatBtn.onclick = (e) => {
            e.stopPropagation();
            insertToChat(item);
          };
        }

        const previewBtn = tr.querySelector(".preview-btn");
        if (previewBtn) {
          previewBtn.onclick = (e) => {
            e.stopPropagation();
            openPreview(item);
          };
        }

        const dlBtn = tr.querySelector(".dl-btn");
        if (dlBtn) {
          dlBtn.onclick = (e) => {
            e.stopPropagation();
            window.open("/api/workspace-files/raw?path=" + encodeURIComponent(item.path) + "&download=1", "_blank");
          };
        }

        const renameBtn = tr.querySelector(".rename-btn");
        renameBtn.onclick = async (e) => {
          e.stopPropagation();
          const newName = prompt("Enter new name:", item.name);
          if (newName && newName !== item.name) {
            await renameItem(item.path, newName);
          }
        };

        const delBtn = tr.querySelector(".del-btn");
        delBtn.onclick = async (e) => {
          e.stopPropagation();
          if (confirm(\`Delete "\${item.name}"?\`)) {
            await deleteItem(item.path);
          }
        };

        fileListEl.appendChild(tr);
      }
    }

    function insertToChat(item) {
      // Send message to parent DSH window
      let relPath = item.path;
      if (relPath.startsWith("/root/FILE MANAGER/")) {
        relPath = relPath.replace("/root/FILE MANAGER/", "");
      } else if (relPath.startsWith("/root/")) {
        relPath = relPath.replace("/root/", "");
      }
      const ref = relPath.includes(" ") ? \`@"\${relPath}"\` : \`@\${relPath}\`;
      try {
        window.parent.postMessage({ type: "dsh-fm-insert", path: relPath, reference: ref }, "*");
      } catch (err) {}
      alert(\`Inserted \${ref} into chat composer!\`);
    }

    async function openPreview(item) {
      activePreviewPath = item.path;
      previewFilename.textContent = item.name;
      previewBody.innerHTML = '<div style="color:var(--text-muted)">Loading preview...</div>';
      previewModal.style.display = "flex";
      btnPreviewSave.style.display = "none";

      const ext = item.ext;
      const rawUrl = "/api/workspace-files/raw?path=" + encodeURIComponent(item.path);

      if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(ext)) {
        previewBody.innerHTML = \`<img src="\${rawUrl}" class="preview-img" alt="\${escapeHtml(item.name)}">\`;
      } else if (item.size <= 5 * 1024 * 1024) {
        try {
          const res = await fetch(rawUrl);
          const text = await res.text();
          const textarea = document.createElement("textarea");
          textarea.className = "preview-text";
          textarea.value = text;
          previewBody.innerHTML = "";
          previewBody.appendChild(textarea);
          btnPreviewSave.style.display = "inline-flex";
          btnPreviewSave.onclick = async () => {
            btnPreviewSave.textContent = "Saving...";
            await fetch("/api/workspace-files/action", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "write", path: item.path, content: textarea.value })
            });
            btnPreviewSave.textContent = "Saved ✓";
            setTimeout(() => { btnPreviewSave.textContent = "Save"; }, 2000);
          };
        } catch (err) {
          previewBody.innerHTML = '<div style="color:var(--danger)">Failed to load file preview.</div>';
        }
      } else {
        previewBody.innerHTML = \`<div style="text-align:center"><div style="margin-bottom:12px">Binary or large file (\${item.sizeFormatted})</div><a href="\${rawUrl}&download=1" class="action-btn primary" target="_blank">Download File</a></div>\`;
      }
    }

    btnPreviewClose.onclick = () => { previewModal.style.display = "none"; };
    btnPreviewInsert.onclick = () => {
      if (activePreviewPath) {
        insertToChat({ path: activePreviewPath, name: activePreviewPath.split("/").pop() });
      }
    };

    async function renameItem(oldPath, newName) {
      const res = await fetch("/api/workspace-files/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "rename", oldPath, newName })
      });
      const d = await res.json();
      if (d.ok) loadDirectory(currentPath, false);
      else alert("Rename failed: " + d.error);
    }

    async function deleteItem(targetPath) {
      const res = await fetch("/api/workspace-files/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", path: targetPath })
      });
      const d = await res.json();
      if (d.ok) loadDirectory(currentPath, false);
      else alert("Delete failed: " + d.error);
    }

    // New Folder
    document.getElementById("btn-new-folder").onclick = async () => {
      const name = prompt("Enter folder name:");
      if (!name) return;
      const res = await fetch("/api/workspace-files/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "mkdir", path: currentPath, name })
      });
      const d = await res.json();
      if (d.ok) loadDirectory(currentPath, false);
      else alert("Failed to create folder: " + d.error);
    };

    // File Upload via Input
    document.getElementById("file-uploader").onchange = async (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      for (let i = 0; i < files.length; i++) {
        const formData = new FormData();
        formData.append("file", files[i]);
        formData.append("targetDir", currentPath);
        formData.append("name", files[i].name);
        await fetch("/api/workspace-files/upload", { method: "POST", body: formData });
      }
      e.target.value = "";
      loadDirectory(currentPath, false);
    };

    // Drag & Drop Upload into Finder
    const dropZone = document.getElementById("drop-zone");
    const dropOverlay = document.getElementById("finder-drop-overlay");
    let dragCount = 0;

    window.addEventListener("dragenter", (e) => {
      if (e.dataTransfer && e.dataTransfer.types.includes("Files")) {
        e.preventDefault();
        dragCount++;
        dropOverlay.style.display = "flex";
      }
    });
    window.addEventListener("dragover", (e) => {
      if (e.dataTransfer && e.dataTransfer.types.includes("Files")) {
        e.preventDefault();
      }
    });
    window.addEventListener("dragleave", (e) => {
      dragCount--;
      if (dragCount <= 0) {
        dragCount = 0;
        dropOverlay.style.display = "none";
      }
    });
    window.addEventListener("drop", async (e) => {
      dragCount = 0;
      dropOverlay.style.display = "none";
      if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
      e.preventDefault();

      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        const formData = new FormData();
        formData.append("file", file);
        formData.append("targetDir", currentPath);
        formData.append("name", file.name);
        await fetch("/api/workspace-files/upload", { method: "POST", body: formData });
      }
      loadDirectory(currentPath, false);
    });

    // Navigation Buttons
    btnBack.onclick = () => {
      if (historyStack.length > 0) {
        const prev = historyStack.pop();
        loadDirectory(prev, false);
      }
    };
    btnUp.onclick = () => {
      const parent = currentPath === "/root" ? null : currentPath.substring(0, currentPath.lastIndexOf("/"));
      if (parent) loadDirectory(parent || "/root");
    };
    btnRefresh.onclick = () => loadDirectory(currentPath, false);
    searchInput.oninput = () => renderFiles(currentItems);

    // Sidebar items
    document.querySelectorAll(".sidebar-item").forEach(item => {
      item.onclick = () => {
        const p = item.getAttribute("data-path");
        if (p) loadDirectory(p);
      };
    });

    function updateSidebarActive() {
      document.querySelectorAll(".sidebar-item").forEach(item => {
        const p = item.getAttribute("data-path");
        if (p === currentPath) item.classList.add("active");
        else item.classList.remove("active");
      });
    }

    function escapeHtml(str) {
      return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    // Escape key
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (previewModal.style.display === "flex") {
          previewModal.style.display = "none";
        } else {
          try { window.parent.postMessage({ type: "dsh-fm-close" }, "*"); } catch (err) {}
        }
      }
    });

    // Boot
    loadDirectory(currentPath);
  </script>
</body>
</html>`;
}
