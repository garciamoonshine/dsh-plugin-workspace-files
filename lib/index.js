import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import { registerFilesProxy } from "./proxy.js";
import { handleWorkspaceUpload, resolveWorkspacePath } from "./uploader.js";
import { expandDocumentReferences } from "./document-feeder.js";

export const name = "workspace-files";
export const inject = ["webServer"];

export const Config = z.object({
  fileBrowserPort: z.natural().description("Optional internal port of external File Browser service to proxy (defaults to built-in manager on port 3080)"),
  fileBrowserHost: z.string().default("127.0.0.1").description("Internal host of external File Browser service"),
  prefixPath: z.string().default("/files").description("Web route prefix for File Manager (served directly on DSH port 3080)"),
  documentsDirName: z.string().default("Documents").description("Subfolder name inside workspace for uploaded documents"),
  maxFilesPerTurn: z.natural().default(5).description("Maximum documents expanded directly per prompt turn"),
  maxPdfChars: z.natural().default(180000).description("Maximum text characters extracted per PDF"),
  renderPdfPages: z.natural().default(2).description("Number of initial PDF pages to render as images when vision model is used")
});

export function apply(ctx, config) {
  // 1. Mount /files reverse proxy to embedded File Browser
  registerFilesProxy(ctx, config);

  // 2. Register /api/workspace-upload route
  if (ctx.webServer) {
    const uploadRoute = {
      kind: "exact",
      path: "/api/workspace-upload",
      handler: async (req, res) => {
        try {
          // Construct Web API Request from Node http.IncomingMessage
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

          const webRes = await handleWorkspaceUpload(webReq, {
            documentsDirName: config.documentsDirName
          });

          res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
          const bodyBuffer = Buffer.from(await webRes.arrayBuffer());
          res.end(bodyBuffer);
        } catch (err) {
          console.error("[dsh-plugin-workspace-files] Upload error:", err);
          if (!res.headersSent) {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
          }
        }
      }
    };
    ctx.effect(() => ctx.webServer.register(uploadRoute), "workspace-files: /api/workspace-upload route");

    // 3. Inject client UI assets (Mac Finder modal, sidebar button, drag-and-drop intake) into DSH Web GUI
    const currentDir = typeof import.meta.dirname === "string"
      ? import.meta.dirname
      : path.dirname(fileURLToPath(import.meta.url));
    const cssPath = path.resolve(currentDir, "../client/styles.css");
    const jsPath = path.resolve(currentDir, "../client/index.js");

    ctx.on("webserver/index-inject", (table) => {
      try {
        if (fs.existsSync(cssPath)) {
          const css = fs.readFileSync(cssPath, "utf8");
          table.push({ kind: "style", text: css });
        }
        if (fs.existsSync(jsPath)) {
          let js = fs.readFileSync(jsPath, "utf8");
          js = js.replace(/export\s+function\s+initClientWorkspaceFiles/, "function initClientWorkspaceFiles");
          table.push({
            kind: "script",
            placement: "body",
            text: `(function(){\n${js}\n})();`
          });
        }
      } catch (err) {
        console.error("[dsh-plugin-workspace-files] Failed to inject client assets:", err);
      }
    });
  }

  // 4. Document expansion helper for prompt pipelines
  ctx.provide("workspaceFiles", {
    resolveWorkspacePath,
    expandDocumentReferences: (content, opts) => expandDocumentReferences(content, {
      ...config,
      ...opts
    })
  });
}
