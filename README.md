# dsh-plugin-workspace-files

A complete workspace file management, universal drag-and-drop intake, and direct document intelligence plugin for **DeepSeek Harness (DSH)**.

> **Zero Extra Ports to Open**: Operates 100% through DSH's own port (`3080` or your Cloudflare/HTTPS domain). **No port 8080 needed, no port 8088 needed.** You connect exclusively to your single existing DSH URL.

---

## Features

1. **Mac Finder-Style In-Page Pop-up File Manager**
   - **Native Single-Port Architecture**: Built-in Mac Finder file manager served directly by DSH on port `3080` (`/files/`). No external binaries, no separate systemd daemons, and zero extra ports required.
   - **In-Page Floating Modal**: Clicking the sidebar "File Manager" button opens a sleek floating Mac Finder window directly inside the DSH interface. You can browse, upload, preview, download, rename, and delete files right in the pop-up without leaving your chat.
   - **Direct-to-Chat Integration**: Click `@Chat` on any file or folder to insert its `@` reference directly into the active DSH chat composer.
   - **Optional Popout**: Includes a standard Mac green-dot button to expand the file manager into a dedicated tab on multi-monitor setups.

2. **Universal In-Chat Drag & Drop Intake**
   - Drag and drop any file (`.pdf`, `.csv`, `.docx`, `.txt`, `.py`, `.json`, `.png`, etc.) or nested directory tree directly into the chat window.
   - Automatically saves files into the active session's `<Workspace>/Documents/` directory.
   - Automatically creates or updates `<Workspace>/.gitignore` to ignore `Documents/` by default.
   - Pre-populates the prompt with `@"Documents/<file>"` in the input composer.

3. **Direct LLM Document Feeding (Zero Tool Latency)**
   - When a user references any document (e.g. `@"Documents/guide.pdf"` or code/data files):
     - **PDFs**: Extracted into clean structured text via `pdftotext -layout` and attached directly to the user turn prompt.
     - **Multimodal Vision Models**: For models supporting vision (e.g. `google/gemini-2.5-flash`), the first pages are rendered as PNG `ImageBlock`s for layout/diagram inspection.
     - **Code & Data Files**: Text, CSV, JSON, Markdown, YAML, Python, etc. are read and injected directly into the prompt envelope.
   - The LLM receives the document content on **Turn 1** without needing iterative `read` or `bash` tool calls.
   - Built-in guardrails: Caps up to 5 documents per message to protect model context budgets.

---

## Prerequisites

- Linux or macOS running DeepSeek Harness (DSH).
- `pnpm` available on `PATH` (required by DSH's plugin manager):
  ```bash
  corepack enable pnpm
  # or: npm install -g pnpm
  ```
- `poppler-utils` (`pdftotext`, `pdftoppm`) for PDF text extraction and vision rendering:
  ```bash
  sudo apt-get install -y poppler-utils
  ```
- Or simply run the included setup helper:
  ```bash
  bash scripts/install-deps.sh
  ```
- *No extra port 8080 or File Browser binary required* — the native file manager is built into the plugin!

---

## Installation into DeepSeek Harness

### 1. Install Dependencies

Ensure prerequisites (`pnpm` and `poppler-utils`) are installed:

```bash
bash scripts/install-deps.sh
```

### 2. Install the Plugin

From your DSH server, install the plugin into your `web` profile:

```bash
dsh plugin --profile web add git+https://github.com/garciamoonshine/dsh-plugin-workspace-files.git
```

> **Note on Bundle Registration**: DSH automatically detects that `dsh-plugin-workspace-files` is a profile bundle, appends it to `dsh.profile.bundles` in `~/.dsh/profiles/web/package.json`, and loads its bundled patch on boot. You **do not** need to manually paste insertion entries into `~/.dsh/profiles/web/cordis.patch.yml` (doing so would cause a duplicate loader ID error).

### 3. (Optional) Custom Configuration

If you wish to override any default settings, you can add an override entry to your `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- id: "plugin:workspace-files"
  config:
    prefixPath: "/files"
    documentsDirName: "Documents"
    maxFilesPerTurn: 5
    maxPdfChars: 180000
    renderPdfPages: 2
```

### 4. Restart DSH

```bash
sudo systemctl restart dsh
```

Everything is now live and accessible directly through your DSH URL on port 3080!

---

## Configuration Reference

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `prefixPath` | `string` | `"/files"` | HTTP route prefix for the file manager on DSH port 3080 |
| `documentsDirName` | `string` | `"Documents"` | Subfolder name created inside workspace for user uploads |
| `maxFilesPerTurn` | `number` | `5` | Maximum number of documents expanded directly per prompt |
| `maxPdfChars` | `number` | `180000` | Maximum text characters extracted per PDF document |
| `renderPdfPages` | `number` | `2` | Number of initial PDF pages rendered as images for vision models |
| `fileBrowserPort` | `number` | `undefined` | *(Optional)* If you already run a standalone File Browser on local loopback, set its port to proxy to it |
| `fileBrowserHost` | `string` | `"127.0.0.1"` | *(Optional)* Host address if external proxy mode is used |

---

## License

MIT © garciamoonshine
