/**
 * Client-side integration for DeepSeek Harness Web GUI
 * Provides Mac Finder modal and universal drag-and-drop workspace intake.
 */
export function initClientWorkspaceFiles(options = {}) {
  if (typeof window === "undefined" || document.getElementById("dsh-fm-modal")) return;

  const fmUrl = options.prefixPath || "/files/";

  // Inject HTML Elements for Modal, Overlay, and Toast
  const container = document.createElement("div");
  container.innerHTML = `
    <div id="dsh-fm-modal">
      <div id="dsh-fm-window">
        <div id="dsh-fm-header">
          <div class="dsh-fm-dots">
            <span class="dsh-fm-dot dsh-fm-dot-close" id="dsh-fm-close" title="Close"></span>
            <span class="dsh-fm-dot dsh-fm-dot-min" id="dsh-fm-min" title="Close"></span>
            <span class="dsh-fm-dot dsh-fm-dot-max" id="dsh-fm-popout" title="Open in New Window"></span>
          </div>
          <div id="dsh-fm-title">Workspace File Manager (/root)</div>
          <div class="dsh-fm-actions">
            <button class="dsh-fm-act-btn" id="dsh-fm-popout-btn" title="Open in Standalone Tab">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </button>
            <button class="dsh-fm-act-btn" id="dsh-fm-close-btn" title="Close">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        </div>
        <iframe id="dsh-fm-iframe" src="about:blank"></iframe>
      </div>
    </div>

    <div id="dsh-drop-overlay">
      <div id="dsh-drop-box">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
        <div style="font-size: 18px; font-weight: 600;" id="dsh-drop-title">Drop files or folders to upload to Workspace Documents</div>
        <div style="font-size: 13px; color: #94a3b8;" id="dsh-drop-desc">Saved directly into Documents/ (git-ignored by default)</div>
        <div id="dsh-drop-progress" style="display:none; width:100%; margin-top:8px;">
          <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
            <div id="dsh-drop-progress-bar" style="width: 0%; height: 100%; background: #3b82f6; transition: width 0.2s;"></div>
          </div>
        </div>
      </div>
    </div>
    <div id="dsh-upload-toast"></div>
  `;
  document.body.appendChild(container);

  function openFMModal() {
    const modal = document.getElementById("dsh-fm-modal");
    const iframe = document.getElementById("dsh-fm-iframe");
    if (iframe.src === "about:blank" || !iframe.src.endsWith(fmUrl)) {
      iframe.src = fmUrl;
    }
    modal.style.display = "flex";
  }

  function closeFMModal() {
    const modal = document.getElementById("dsh-fm-modal");
    if (modal) modal.style.display = "none";
  }

  function popoutFM() {
    window.open(fmUrl, "_blank");
  }

  document.getElementById("dsh-fm-close").onclick = closeFMModal;
  document.getElementById("dsh-fm-min").onclick = closeFMModal;
  document.getElementById("dsh-fm-close-btn").onclick = closeFMModal;
  document.getElementById("dsh-fm-popout").onclick = popoutFM;
  document.getElementById("dsh-fm-popout-btn").onclick = popoutFM;

  document.getElementById("dsh-fm-modal").onclick = function(e) {
    if (e.target === this) closeFMModal();
  };

  window.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
      closeFMModal();
      const overlay = document.getElementById("dsh-drop-overlay");
      if (overlay) overlay.style.display = "none";
    }
  });

  // Listen to messages from Finder iframe
  window.addEventListener("message", function(e) {
    if (!e.data || typeof e.data !== "object") return;
    if (e.data.type === "dsh-fm-close") {
      closeFMModal();
    } else if (e.data.type === "dsh-fm-insert" && e.data.path) {
      const textarea = document.querySelector("textarea");
      if (textarea) {
        const ref = e.data.reference || (e.data.path.includes(" ") ? `@"${e.data.path}"` : `@${e.data.path}`);
        const cur = textarea.value;
        const updated = cur ? `${cur} ${ref}` : `Please inspect ${ref}`;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        if (setter) setter.call(textarea, updated);
        else textarea.value = updated;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.focus();
      }
      closeFMModal();
    }
  });

  // Mount Sidebar Button
  function mountBtn() {
    if (document.getElementById("dsh-file-manager-btn")) return;
    const footer = document.querySelector('div[class*="footerActions"]') ||
                  document.querySelector('div[class*="footArea"]');
    if (!footer) return;

    const btn = document.createElement("button");
    btn.id = "dsh-file-manager-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", "File Manager (Finder)");
    btn.title = "File Manager (Finder) - Drag, drop, move, organize files";
    btn.onclick = openFMModal;
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg><span class="dsh-fm-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500">File Manager</span>';
    footer.insertBefore(btn, footer.firstChild);
  }
  setInterval(mountBtn, 1000);

  // Universal in-chat drag-and-drop intake
  const overlay = document.getElementById("dsh-drop-overlay");
  const dropTitle = document.getElementById("dsh-drop-title");
  const dropDesc = document.getElementById("dsh-drop-desc");
  const progressContainer = document.getElementById("dsh-drop-progress");
  const progressBar = document.getElementById("dsh-drop-progress-bar");
  const toast = document.getElementById("dsh-upload-toast");
  let dragCounter = 0;

  function showToast(msg, isError) {
    if (!toast) return;
    toast.textContent = msg;
    toast.style.borderColor = isError ? "#ef4444" : "#3b82f6";
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 4500);
  }

  async function extractEntries(dataTransfer) {
    const files = [];
    const items = dataTransfer.items;
    if (!items || items.length === 0) {
      for (let i = 0; i < dataTransfer.files.length; i++) {
        const f = dataTransfer.files[i];
        files.push({ file: f, path: f.name });
      }
      return files;
    }

    function traverse(entry, prefix) {
      return new Promise((resolve) => {
        if (entry.isFile) {
          entry.file(
            (file) => {
              files.push({ file, path: prefix + file.name });
              resolve();
            },
            () => resolve()
          );
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          function readBatch() {
            reader.readEntries(
              async (entries) => {
                if (entries.length === 0) resolve();
                else {
                  for (let j = 0; j < entries.length; j++) {
                    await traverse(entries[j], prefix + entry.name + "/");
                  }
                  readBatch();
                }
              },
              () => resolve()
            );
          }
          readBatch();
        } else {
          resolve();
        }
      });
    }

    const promises = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
      if (entry) promises.push(traverse(entry, ""));
      else {
        const file = item.getAsFile();
        if (file) files.push({ file, path: file.name });
      }
    }
    await Promise.all(promises);
    return files;
  }

  window.addEventListener("dragenter", (e) => {
    if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      dragCounter++;
      overlay.style.display = "flex";
    }
  }, true);

  window.addEventListener("dragover", (e) => {
    if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, true);

  window.addEventListener("dragleave", (e) => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      overlay.style.display = "none";
      try { window.dispatchEvent(new Event("dragend")); } catch (err) {}
    }
  }, true);

  window.addEventListener("drop", async (e) => {
    dragCounter = 0;
    try { window.dispatchEvent(new Event("dragend")); } catch (err) {}
    if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) {
      overlay.style.display = "none";
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    try {
      dropTitle.textContent = "Processing files and folders...";
      dropDesc.textContent = "Please wait...";
      progressContainer.style.display = "block";
      progressBar.style.width = "5%";

      const entries = await extractEntries(e.dataTransfer);
      if (entries.length === 0) {
        overlay.style.display = "none";
        return;
      }

      let sessionId = "";
      try {
        const sess = JSON.parse(localStorage.getItem("dsh.sessions.current") || "{}");
        sessionId = sess.sessionId || "";
      } catch (e) {}

      const total = entries.length;
      let uploaded = 0;
      const uploadedNames = [];

      for (let i = 0; i < total; i++) {
        const item = entries[i];
        dropTitle.textContent = `Uploading (${i + 1} of ${total})...`;
        dropDesc.textContent = item.path;
        progressBar.style.width = `${Math.round(((i + 1) / total) * 100)}%`;

        const formData = new FormData();
        formData.append("file", item.file);
        formData.append("path", item.path);
        if (sessionId) formData.append("sessionId", sessionId);

        const res = await fetch("/api/workspace-upload", {
          method: "POST",
          body: formData
        });

        let data = null;
        try { data = await res.json(); } catch (err) {}

        if (res.ok && data && data.ok) {
          uploaded++;
          uploadedNames.push(data.relativePath || (`Documents/${item.path}`));
        } else {
          console.error("Upload failed for " + item.path, data);
        }
      }

      overlay.style.display = "none";
      progressContainer.style.display = "none";
      progressBar.style.width = "0%";
      dropTitle.textContent = "Drop files or folders to upload to Workspace Documents";
      dropDesc.textContent = "Saved directly into Documents/ (git-ignored by default)";
      try { window.dispatchEvent(new Event("dragend")); } catch (err) {}

      if (uploaded > 0) {
        showToast(`✓ Successfully uploaded ${uploaded} file${uploaded > 1 ? "s" : ""} to Documents/`, false);

        const iframe = document.getElementById("dsh-fm-iframe");
        if (iframe && iframe.contentWindow) {
          try { iframe.contentWindow.location.reload(); } catch (e) {}
        }

        const textarea = document.querySelector("textarea");
        if (textarea) {
          const insertStr = uploadedNames.map((n) => n.includes(" ") ? `@"${n}"` : `@${n}`).join(" ");
          const cur = textarea.value;
          const updated = cur ? `${cur} ${insertStr}` : `Please analyze ${insertStr}`;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
          setter.call(textarea, updated);
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          textarea.focus();
        }
      } else {
        showToast("✕ Upload failed. Check server logs.", true);
      }
    } catch (err) {
      console.error("Drop upload error:", err);
      overlay.style.display = "none";
      try { window.dispatchEvent(new Event("dragend")); } catch (e) {}
      showToast(`✕ Error: ${err.message}`, true);
    }
  }, true);
}

// Auto-boot if loaded in browser
if (typeof window !== "undefined") {
  initClientWorkspaceFiles();
}
