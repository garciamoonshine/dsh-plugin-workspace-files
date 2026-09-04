import http from "node:http";
import {
  renderFinderHtml,
  handleListFiles,
  handleRawFile,
  handleFileAction,
  handleDirectUpload
} from "./file-manager-server.js";

/**
 * Register file manager routes directly on DSH's webServer on port 3080.
 * Zero extra ports needed (no port 8080 / 8088 required).
 * If an external fileBrowserPort is explicitly provided, it will attempt to proxy,
 * falling back gracefully to the built-in native Mac Finder manager.
 */
export function registerFilesProxy(ctx, options = {}) {
  const targetPort = options.fileBrowserPort;
  const targetHost = options.fileBrowserHost || "127.0.0.1";
  const prefixPath = options.prefixPath || "/files";

  if (!ctx.webServer) {
    console.warn("[dsh-plugin-workspace-files] ctx.webServer not available; file manager registration skipped.");
    return;
  }

  // 1. Register REST API endpoints for File Manager
  const apiListRoute = {
    kind: "exact",
    path: "/api/workspace-files/list",
    handler: (req, res) => handleListFiles(req, res)
  };
  const apiRawRoute = {
    kind: "exact",
    path: "/api/workspace-files/raw",
    handler: (req, res) => handleRawFile(req, res)
  };
  const apiActionRoute = {
    kind: "exact",
    path: "/api/workspace-files/action",
    handler: (req, res) => handleFileAction(req, res)
  };
  const apiUploadRoute = {
    kind: "exact",
    path: "/api/workspace-files/upload",
    handler: (req, res) => handleDirectUpload(req, res)
  };

  ctx.effect(() => ctx.webServer.register(apiListRoute), "workspace-files: /api/workspace-files/list route");
  ctx.effect(() => ctx.webServer.register(apiRawRoute), "workspace-files: /api/workspace-files/raw route");
  ctx.effect(() => ctx.webServer.register(apiActionRoute), "workspace-files: /api/workspace-files/action route");
  ctx.effect(() => ctx.webServer.register(apiUploadRoute), "workspace-files: /api/workspace-files/upload route");

  // 2. Register /files UI route
  const filesRoute = {
    kind: "prefix",
    path: prefixPath,
    handler: (req, res) => {
      // If external filebrowser port is explicitly configured, attempt to proxy
      if (targetPort && targetPort > 0) {
        const proxyReq = http.request({
          hostname: targetHost,
          port: targetPort,
          path: req.url,
          method: req.method,
          headers: {
            ...req.headers,
            host: req.headers.host || `${targetHost}:${targetPort}`
          }
        }, (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
          proxyRes.pipe(res);
        });

        proxyReq.on("error", (err) => {
          // If proxy fails, serve built-in file manager seamlessly
          if (!res.headersSent) {
            serveNativeUi(res);
          }
        });

        req.pipe(proxyReq);
        return;
      }

      // Default: Serve built-in Mac Finder Web UI directly on DSH port 3080
      serveNativeUi(res);
    }
  };

  function serveNativeUi(res) {
    const html = renderFinderHtml({ prefixPath });
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": Buffer.byteLength(html)
    });
    res.end(html);
  }

  ctx.effect(() => ctx.webServer.register(filesRoute), "workspace-files: /files native manager & proxy");
}
