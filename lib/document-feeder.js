import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Scan prompt content for file references (@Documents/... or @"...")
 * and expand them directly with text content and visual image blocks.
 */
export async function expandDocumentReferences(content, options = {}) {
  const {
    workspacePath = process.cwd(),
    supportsImage = false,
    maxFiles = 5,
    maxPdfChars = 180000,
    maxTextChars = 120000,
    renderPdfPages = 2
  } = options;

  const refRegex = /(?:^|\s)@(?:"([^"]+)"|([^\s"'\(\)\[\]\{\}]+))/g;
  const foundPaths = [];

  for (const part of content) {
    if (part.type !== "text" || !part.text) continue;
    let match;
    while ((match = refRegex.exec(part.text)) !== null) {
      const candidate = (match[1] || match[2] || "").trim();
      if (candidate && !foundPaths.includes(candidate)) {
        foundPaths.push(candidate);
      }
    }
  }

  if (foundPaths.length === 0) return content;

  const targetPaths = foundPaths.slice(0, maxFiles);
  const newContent = content.map((p) => ({ ...p }));
  const textInjections = [];
  const imageInjections = [];

  for (const relPath of targetPaths) {
    const candidates = [
      path.resolve(workspacePath, relPath),
      path.resolve(workspacePath, "Documents", relPath),
      path.resolve("/root", relPath),
      path.resolve("/root/Documents", relPath)
    ];

    let targetFile = null;
    for (const c of candidates) {
      try {
        const s = await fs.stat(c);
        if (s.isFile()) { targetFile = c; break; }
      } catch {}
    }
    if (!targetFile) continue;

    const ext = path.extname(targetFile).toLowerCase();
    const fileName = path.basename(targetFile);

    // Raster images
    if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) {
      if (supportsImage) {
        try {
          const bytes = await fs.readFile(targetFile);
          if (bytes.length <= 15 * 1024 * 1024) {
            const mime = ext === ".png" ? "image/png" :
                         ext === ".webp" ? "image/webp" :
                         ext === ".gif" ? "image/gif" : "image/jpeg";
            imageInjections.push({
              type: "image",
              data: bytes.toString("base64"),
              mediaType: mime,
              name: fileName
            });
            textInjections.push(`[Attached Image: ${fileName}]`);
          }
        } catch (e) {
          console.error(`[dsh-plugin-workspace-files] Failed to read image ${targetFile}:`, e);
        }
      }
    }
    // PDF documents
    else if (ext === ".pdf") {
      let pdfText = "";
      try {
        const { stdout } = await execFileAsync("pdftotext", ["-layout", targetFile, "-"]);
        pdfText = stdout.trim();
      } catch (e) {
        console.error(`[dsh-plugin-workspace-files] pdftotext failed for ${targetFile}:`, e);
      }

      if (pdfText) {
        const truncated = pdfText.length > maxPdfChars
          ? (pdfText.slice(0, maxPdfChars) + `\n... [Document truncated to ${maxPdfChars} characters]`)
          : pdfText;
        textInjections.push(`\n\n--- DOCUMENT CONTENT: ${fileName} ---\n${truncated}\n--- END OF DOCUMENT ---\n`);
      }

      if (supportsImage && renderPdfPages > 0) {
        try {
          const tmpPrefix = `/tmp/dsh_pdf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          await execFileAsync("pdftoppm", ["-png", "-r", "130", "-f", "1", "-l", String(renderPdfPages), targetFile, tmpPrefix]);
          const dir = await fs.readdir("/tmp");
          const prefixName = path.basename(tmpPrefix);
          const rendered = dir.filter((f) => f.startsWith(prefixName)).sort();
          for (const rf of rendered) {
            const pagePath = path.join("/tmp", rf);
            try {
              const pageBytes = await fs.readFile(pagePath);
              await fs.unlink(pagePath);
              imageInjections.push({
                type: "image",
                data: pageBytes.toString("base64"),
                mediaType: "image/png",
                name: `${fileName} (Page Render)`
              });
            } catch {}
          }
        } catch (e) {
          console.error(`[dsh-plugin-workspace-files] pdftoppm failed for ${targetFile}:`, e);
        }
      }
    }
    // Text / Code / CSV / Markdown
    else if ([".txt", ".csv", ".tsv", ".json", ".md", ".py", ".js", ".ts", ".html", ".xml", ".yaml", ".yml", ".sh", ".sql", ".log", ".css", ".env"].includes(ext) || ext === "") {
      try {
        const fileBytes = await fs.readFile(targetFile);
        if (fileBytes.length <= 3 * 1024 * 1024) {
          const text = fileBytes.toString("utf8");
          const truncated = text.length > maxTextChars
            ? (text.slice(0, maxTextChars) + `\n... [File truncated to ${maxTextChars} characters]`)
            : text;
          textInjections.push(`\n\n--- FILE CONTENT: ${fileName} ---\n${truncated}\n--- END OF FILE ---\n`);
        }
      } catch (e) {
        console.error(`[dsh-plugin-workspace-files] Failed to read file ${targetFile}:`, e);
      }
    }
  }

  if (textInjections.length > 0) {
    const firstText = newContent.find((p) => p.type === "text");
    if (firstText) {
      firstText.text += "\n" + textInjections.join("\n");
    } else {
      newContent.unshift({ type: "text", text: textInjections.join("\n") });
    }
  }

  if (imageInjections.length > 0) {
    newContent.push(...imageInjections);
  }

  return newContent;
}
