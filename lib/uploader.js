import fs from "node:fs/promises";
import path from "node:path";

/**
 * Resolve the active workspace directory for a given session.
 * Checks /root/.dsh/storages/workspace.json first, falls back to top workspace, then process.cwd().
 */
export async function resolveWorkspacePath(sessionId, requestedWsPath, dshHome = "/root/.dsh") {
  if (requestedWsPath && typeof requestedWsPath === "string") {
    const resolved = path.resolve(requestedWsPath);
    try {
      const stat = await fs.stat(resolved);
      if (stat.isDirectory()) return resolved;
    } catch {}
  }
  try {
    const storageFile = path.join(dshHome, "storages/workspace.json");
    const raw = await fs.readFile(storageFile, "utf8");
    const data = JSON.parse(raw);
    const workspaces = data?.tables?.workspaces || {};
    if (sessionId) {
      for (const ws of Object.values(workspaces)) {
        if (Array.isArray(ws.sessionIds) && ws.sessionIds.includes(sessionId)) {
          return ws.path;
        }
      }
    }
    const topId = data?.global?.workspaceIds?.[0];
    if (topId && workspaces[topId]?.path) {
      return workspaces[topId].path;
    }
  } catch {}
  return process.cwd();
}

/**
 * Handle incoming multipart upload, saving file to <workspace>/Documents/<relPath>,
 * and guaranteeing Documents/ is added to .gitignore.
 */
export async function handleWorkspaceUpload(request, options = {}) {
  const documentsDirName = options.documentsDirName || "Documents";
  const dshHome = options.dshHome || "/root/.dsh";

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return new Response(JSON.stringify({ ok: false, error: "no file provided" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  const reqSessionId = formData.get("sessionId")?.toString();
  const reqWsPath = formData.get("workspacePath")?.toString();
  const wsPath = await resolveWorkspacePath(reqSessionId, reqWsPath, dshHome);

  const docsDir = path.join(wsPath, documentsDirName);
  await fs.mkdir(docsDir, { recursive: true });

  // Update .gitignore
  try {
    const gitignorePath = path.join(wsPath, ".gitignore");
    let gitignoreContent = "";
    try {
      gitignoreContent = await fs.readFile(gitignorePath, "utf8");
    } catch {}
    const pattern = new RegExp(`(^|\\n)${documentsDirName}\\/?(\\n|$)`);
    if (!pattern.test(gitignoreContent)) {
      const newline = gitignoreContent.length > 0 && !gitignoreContent.endsWith("\n") ? "\n" : "";
      await fs.writeFile(gitignorePath, `${gitignoreContent}${newline}${documentsDirName}/\n`, "utf8");
    }
  } catch (err) {
    console.error("[dsh-plugin-workspace-files] Failed to update .gitignore:", err);
  }

  let relPath = (formData.get("path") || file.name || "uploaded-file").toString();
  relPath = relPath.replace(/^(\.\.[\/\\])+/g, "").replace(/^\/+/g, "");
  const targetPath = path.resolve(docsDir, relPath);
  if (!targetPath.startsWith(docsDir)) {
    return new Response(JSON.stringify({ ok: false, error: "invalid path" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const arrayBuffer = await file.arrayBuffer();
  await fs.writeFile(targetPath, Buffer.from(arrayBuffer));

  return new Response(JSON.stringify({
    ok: true,
    path: targetPath,
    workspacePath: wsPath,
    relativePath: `${documentsDirName}/${relPath}`,
    fileName: path.basename(targetPath),
    size: arrayBuffer.byteLength
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
