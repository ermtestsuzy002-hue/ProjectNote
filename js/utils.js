/* =====================================================================
 *  utils.js
 *  ---------------------------------------------------------------------
 *  Stateless, dependency-free helper functions used across the app.
 * ===================================================================== */

/* ---------- HTML escaping (XSS safe) ---------- */
window.PN_escapeHtml = function (str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

/* ---------- Date formatting ---------- */
window.PN_fmtDate = function (ts) {
    if (!ts) return "";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString(undefined, {
        year:   "numeric",
        month:  "short",
        day:    "2-digit",
        hour:   "2-digit",
        minute: "2-digit"
    });
};

window.PN_fmtDateShort = function (ts) {
    if (!ts) return "";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString(undefined, {
        month: "short",
        day:   "2-digit"
    });
};

/* ---------- Generate avatar initials from a name ---------- */
window.PN_initials = function (name) {
    if (!name) return "??";
    const clean = String(name).trim();
    if (!clean) return "??";
    const parts = clean.split(/\s+/);
    if (parts.length === 1) return clean.substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/* ---------- Deterministic colour from string (avatar background) ---------- */
window.PN_colorFromString = function (str) {
    let hash = 0;
    const s = String(str || "x");
    for (let i = 0; i < s.length; i++) {
        hash = s.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 60%, 45%)`;
};

/* ---------- Short random ID generator ---------- */
window.PN_uid = function (prefix) {
    return (prefix || "id_") +
        Date.now().toString(36) +
        Math.random().toString(36).substr(2, 6);
};

/* ---------- Debounce ---------- */
window.PN_debounce = function (fn, ms) {
    let t;
    return function () {
        const args = arguments, ctx = this;
        clearTimeout(t);
        t = setTimeout(() => fn.apply(ctx, args), ms || 250);
    };
};

/* ---------- Detect attachment type from URL or filename ---------- */
window.PN_detectMediaType = function (filename) {
    if (!filename) return "file";
    const ext = String(filename).toLowerCase().split(".").pop().split("?")[0];
    const img = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"];
    const vid = ["mp4", "webm", "ogv", "mov", "m4v"];
    if (img.includes(ext)) return "image";
    if (vid.includes(ext)) return "video";
    return "file";
};

/* ---------- Human readable file size ---------- */
window.PN_fmtBytes = function (b) {
    if (!b && b !== 0) return "";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0, n = b;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(n < 10 && i > 0 ? 1 : 0) + " " + u[i];
};

/* ---------- Trigger a client-side download from a Blob/string ---------- */
window.PN_downloadBlob = function (data, filename, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
};

/* ---------- Simple status palette (used on cards) ---------- */
window.PN_STATUS_COLORS = {
    "todo":        "#6b7280",
    "in-progress": "#f59e0b",
    "review":      "#0ea5e9",
    "done":        "#10b981",
    "blocked":     "#ef4444"
};
window.PN_STATUS_LABELS = {
    "todo":        "To Do",
    "in-progress": "In Progress",
    "review":      "Review",
    "done":        "Done",
    "blocked":     "Blocked"
};

/* ---------- Permission helper ---------- *
 *  ctx must contain: { project, currentUser, share }
 *  Returns one of: "owner" | "edit" | "view" | "none"                */
window.PN_permissionFor = function (project, user, share) {
    if (!project || !user) return "none";
    // Site-wide owner role overrides everything
    if (user.role === "owner") return "owner";
    // Project creator is owner of that project
    if (project.ownerId === user.uid) return "owner";
    // Private project: only the creator (handled above) and global owner can view
    if (project.visibility === "private") return "none";
    // Shared: look up the user's share record
    if (share && share.permission === "edit") return "edit";
    if (share && share.permission === "view") return "view";
    return "none";
};
