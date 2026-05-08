/* =====================================================================
 *  kanban.js
 *  ---------------------------------------------------------------------
 *  Kanban board rendering, drag & drop, multi-select, search/filter,
 *  attachment previews.
 *
 *  Public API:
 *    PN_Kanban.mount(rootEl, ctx)
 *    PN_Kanban.unmount()
 *    PN_Kanban.refresh(groups, notes)
 *    PN_Kanban.setFilter({ search, status })
 *    PN_Kanban.setBulkMode(boolean)
 *
 *  ctx = {
 *    project,            // project doc
 *    user,               // current user doc
 *    perm,               // "owner" | "edit" | "view"
 *    onAddGroup,         // ()
 *    onEditGroup(id),
 *    onDeleteGroup(id),
 *    onAddNote(groupId),
 *    onEditNote(noteId),
 *    onSelectionChange(arr)
 *  }
 * ===================================================================== */

window.PN_Kanban = (function () {

    let rootEl, ctx;
    let _groups   = [];
    let _notes    = [];
    let _filter   = { search: "", status: "" };
    let _bulkMode = false;
    let _selected = new Set();
    let _sortables = [];
    let _groupSortable = null;

    /* ------------------------------------------------------------ */
    function mount(el, c) {
        rootEl = el;
        ctx    = c || {};
        _selected.clear();
        render();
    }
    function unmount() {
        _destroySortables();
        if (rootEl) rootEl.innerHTML = "";
        rootEl = null;
        ctx = null;
        _groups = []; _notes = [];
    }
    function refresh(groups, notes) {
        _groups = groups || [];
        _notes  = notes  || [];
        render();
    }
    function setFilter(patch) {
        _filter = Object.assign({}, _filter, patch || {});
        render();
    }
    function setBulkMode(v) {
        _bulkMode = !!v;
        if (!_bulkMode) _selected.clear();
        render();
        if (ctx && ctx.onSelectionChange) ctx.onSelectionChange(Array.from(_selected));
    }
    function getSelection() { return Array.from(_selected); }
    function clearSelection() {
        _selected.clear();
        if (ctx && ctx.onSelectionChange) ctx.onSelectionChange([]);
    }

    /* ------------------------------------------------------------ */
    function _destroySortables() {
        _sortables.forEach(s => { try { s.destroy(); } catch (e) {} });
        _sortables = [];
        if (_groupSortable) { try { _groupSortable.destroy(); } catch (e) {} _groupSortable = null; }
    }

    /* ------------------------------------------------------------ *
     *                          RENDER
     * ------------------------------------------------------------ */
    function render() {
        if (!rootEl) return;
        _destroySortables();

        if (!_groups.length) {
            rootEl.innerHTML = `
                <div class="pn-kanban-empty">
                    ${PN_emptyState("bi-columns-gap",
                        "No groups yet",
                        ctx.perm === "view"
                            ? "The project owner has not created any groups."
                            : "Click \"Add Group\" to create your first column.")}
                </div>`;
            return;
        }

        // Filter notes
        const term = _filter.search.toLowerCase().trim();
        const status = _filter.status;
        const visible = _notes.filter(n => {
            if (status && n.status !== status) return false;
            if (term) {
                const blob = (n.title + " " + (n.description || "") + " " +
                              (n.assignee || "") + " " + (n.tags || []).join(" ")).toLowerCase();
                if (!blob.includes(term)) return false;
            }
            return true;
        });

        const html = _groups.map(g => _renderColumn(g, visible.filter(n => n.groupId === g.id))).join("");
        rootEl.innerHTML = html;

        _bindEvents();
        _initSortables();
    }

    function _renderColumn(g, notes) {
        const canEdit = ctx.perm === "owner" || ctx.perm === "edit";
        const headerStyle = `--pn-col: ${PN_escapeHtml(g.color || "#6366f1")};`;
        return `
        <div class="pn-col" data-gid="${PN_escapeHtml(g.id)}" style="${headerStyle}">
            <div class="pn-col-head">
                <div class="pn-col-head-main">
                    ${canEdit ? '<span class="pn-col-grip" title="Drag column"><i class="bi bi-grip-vertical"></i></span>' : ''}
                    <span class="pn-col-dot"></span>
                    <h3 class="pn-col-title">${PN_escapeHtml(g.title)}</h3>
                    <span class="pn-col-count">${notes.length}</span>
                </div>
                ${canEdit ? `
                <div class="pn-col-actions">
                    <button class="btn btn-icon btn-sm" data-pn-add-note title="Add note">
                        <i class="bi bi-plus-lg"></i>
                    </button>
                    <div class="dropdown">
                        <button class="btn btn-icon btn-sm" data-bs-toggle="dropdown" title="Group menu">
                            <i class="bi bi-three-dots"></i>
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end">
                            <li><a class="dropdown-item" href="#" data-pn-edit-group><i class="bi bi-pencil me-2"></i>Edit group</a></li>
                            <li><a class="dropdown-item" href="#" data-pn-move-up><i class="bi bi-arrow-up me-2"></i>Move up</a></li>
                            <li><a class="dropdown-item" href="#" data-pn-move-down><i class="bi bi-arrow-down me-2"></i>Move down</a></li>
                            <li><hr class="dropdown-divider"></li>
                            <li><a class="dropdown-item text-danger" href="#" data-pn-delete-group><i class="bi bi-trash me-2"></i>Delete group</a></li>
                        </ul>
                    </div>
                </div>` : ''}
            </div>
            <div class="pn-col-body" data-gid="${PN_escapeHtml(g.id)}">
                ${notes.length
                    ? notes.map(n => _renderCard(n)).join("")
                    : `<div class="pn-col-empty">Drop notes here or click + to add.</div>`}
            </div>
            ${canEdit ? `
            <button class="pn-col-add" data-pn-add-note>
                <i class="bi bi-plus-lg"></i><span>Add note</span>
            </button>` : ''}
        </div>`;
    }

    function _renderCard(n) {
        const statusColor = PN_STATUS_COLORS[n.status] || "#6b7280";
        const statusLabel = PN_STATUS_LABELS[n.status] || "To Do";
        const checked = _selected.has(n.id) ? "checked" : "";
        const due = n.dueAt ? PN_fmtDateShort(n.dueAt) : "";
        const dueOver = n.dueAt && new Date(n.dueAt) < new Date() && n.status !== "done";
        const tagsHtml = (n.tags || []).slice(0, 4)
            .map(t => `<span class="pn-tag">${PN_escapeHtml(t)}</span>`).join("");

        // Attachments preview
        const attCount = (n.attachments || []).length;
        const firstImage = (n.attachments || []).find(a => a.type === "image");
        const previewHtml = firstImage
            ? `<div class="pn-card-cover" style="background-image:url('${PN_escapeHtml(firstImage.url)}')"></div>`
            : "";

        const assigneeHtml = n.assignee
            ? `<span class="pn-avatar pn-avatar-xs"
                     style="background:${PN_colorFromString(n.assignee)}"
                     title="${PN_escapeHtml(n.assignee)}">${PN_initials(n.assignee)}</span>`
            : "";

        const descHtml = n.description
            ? `<p class="pn-card-desc">${PN_escapeHtml(n.description)}</p>`
            : "";

        const linkBadge = n.link
            ? `<span class="pn-card-meta-item" title="${PN_escapeHtml(n.link)}"><i class="bi bi-link-45deg"></i></span>`
            : "";

        const attBadge = attCount
            ? `<span class="pn-card-meta-item"><i class="bi bi-paperclip"></i>${attCount}</span>`
            : "";

        const dueBadge = due
            ? `<span class="pn-card-meta-item ${dueOver ? "pn-overdue" : ""}"><i class="bi bi-calendar-event"></i>${PN_escapeHtml(due)}</span>`
            : "";

        return `
        <article class="pn-card" data-nid="${PN_escapeHtml(n.id)}" data-gid="${PN_escapeHtml(n.groupId)}">
            ${_bulkMode
                ? `<label class="pn-card-check"><input type="checkbox" data-pn-select ${checked}/></label>`
                : ''}
            ${previewHtml}
            <div class="pn-card-body">
                <header class="pn-card-head">
                    <span class="pn-card-status" style="--s:${statusColor}">${PN_escapeHtml(statusLabel)}</span>
                    ${assigneeHtml}
                </header>
                <h4 class="pn-card-title">${PN_escapeHtml(n.title)}</h4>
                ${descHtml}
                ${tagsHtml ? `<div class="pn-card-tags">${tagsHtml}</div>` : ""}
                ${attCount
                    ? `<div class="pn-card-attach">${_renderAttachmentChips(n.attachments)}</div>`
                    : ""}
                <footer class="pn-card-foot">
                    <div class="pn-card-meta">
                        ${dueBadge}
                        ${linkBadge}
                        ${attBadge}
                    </div>
                    <span class="pn-card-time">${PN_escapeHtml(PN_fmtDateShort(n.updatedAt))}</span>
                </footer>
            </div>
        </article>`;
    }

    function _renderAttachmentChips(attachments) {
        return (attachments || []).slice(0, 3).map(a => {
            const ic = a.type === "image" ? "bi-image"
                     : a.type === "video" ? "bi-play-btn"
                     : "bi-file-earmark";
            return `
                <span class="pn-att-chip" data-pn-att='${PN_escapeHtml(JSON.stringify({
                    url:a.url, name:a.name, type:a.type, mime:a.mime
                }))}'>
                    <i class="bi ${ic}"></i>
                    <span>${PN_escapeHtml(a.name)}</span>
                </span>`;
        }).join("") + ((attachments.length > 3) ? `<span class="pn-att-more">+${attachments.length-3}</span>` : "");
    }

    /* ------------------------------------------------------------ *
     *                         EVENTS
     * ------------------------------------------------------------ */
    function _bindEvents() {
        // Add-note buttons
        rootEl.querySelectorAll("[data-pn-add-note]").forEach(b => {
            b.addEventListener("click", (e) => {
                e.stopPropagation();
                const col = b.closest(".pn-col");
                if (col && ctx.onAddNote) ctx.onAddNote(col.dataset.gid);
            });
        });

        // Group menu actions
        rootEl.querySelectorAll(".pn-col").forEach(col => {
            const gid = col.dataset.gid;

            const editBtn   = col.querySelector("[data-pn-edit-group]");
            const delBtn    = col.querySelector("[data-pn-delete-group]");
            const upBtn     = col.querySelector("[data-pn-move-up]");
            const downBtn   = col.querySelector("[data-pn-move-down]");

            if (editBtn) editBtn.addEventListener("click", (e) => {
                e.preventDefault();
                if (ctx.onEditGroup) ctx.onEditGroup(gid);
            });
            if (delBtn) delBtn.addEventListener("click", (e) => {
                e.preventDefault();
                if (ctx.onDeleteGroup) ctx.onDeleteGroup(gid);
            });
            if (upBtn) upBtn.addEventListener("click", (e) => {
                e.preventDefault();
                _moveGroup(gid, -1);
            });
            if (downBtn) downBtn.addEventListener("click", (e) => {
                e.preventDefault();
                _moveGroup(gid, +1);
            });
        });

        // Card clicks
        rootEl.querySelectorAll(".pn-card").forEach(card => {
            card.addEventListener("click", (e) => {
                if (e.target.closest("[data-pn-select]")) return;
                if (e.target.closest(".pn-att-chip"))    return;
                if (e.target.closest(".pn-card-check"))  return;
                if (ctx.onEditNote) ctx.onEditNote(card.dataset.nid);
            });
        });

        // Multi-select checkboxes
        rootEl.querySelectorAll("[data-pn-select]").forEach(cb => {
            cb.addEventListener("change", (e) => {
                e.stopPropagation();
                const nid = cb.closest(".pn-card").dataset.nid;
                if (cb.checked) _selected.add(nid);
                else            _selected.delete(nid);
                if (ctx.onSelectionChange) ctx.onSelectionChange(Array.from(_selected));
            });
        });

        // Attachment chips -> media modal
        rootEl.querySelectorAll(".pn-att-chip").forEach(chip => {
            chip.addEventListener("click", (e) => {
                e.stopPropagation();
                try {
                    const att = JSON.parse(chip.dataset.pnAtt);
                    _openMedia(att);
                } catch (er) {}
            });
        });
    }

    /* ------------------------------------------------------------ *
     *                  Sortable.js initialisation
     * ------------------------------------------------------------ */
    function _initSortables() {
        const canEdit = ctx.perm === "owner" || ctx.perm === "edit";
        if (!canEdit) return;

        // 1. Reorder columns horizontally
        _groupSortable = Sortable.create(rootEl, {
            handle: ".pn-col-grip",
            animation: 180,
            draggable: ".pn-col",
            ghostClass: "pn-col-ghost",
            onEnd: async () => {
                const order = Array.from(rootEl.querySelectorAll(".pn-col"))
                    .map((el, i) => ({ id: el.dataset.gid, order: (i + 1) * 1000 }));
                try { await PN_reorderGroups(order); }
                catch (e) { PN_toast("Reorder failed: " + e.message, "error"); }
            }
        });

        // 2. Drag notes within / between columns
        rootEl.querySelectorAll(".pn-col-body").forEach(body => {
            const s = Sortable.create(body, {
                group: "pn-notes",
                animation: 160,
                ghostClass: "pn-card-ghost",
                draggable: ".pn-card",
                onAdd: _onCardMove,
                onUpdate: _onCardMove
            });
            _sortables.push(s);
        });
    }

    async function _onCardMove(evt) {
        const noteId  = evt.item.dataset.nid;
        const newGid  = evt.to.dataset.gid;
        // Recompute orders for affected columns
        const updates = [];
        const cols = new Set([evt.from.dataset.gid, evt.to.dataset.gid]);
        cols.forEach(gid => {
            const body = rootEl.querySelector(`.pn-col-body[data-gid="${CSS.escape(gid)}"]`);
            if (!body) return;
            Array.from(body.children).forEach((c, i) => {
                if (!c.dataset.nid) return;
                updates.push({
                    id: c.dataset.nid,
                    groupId: gid,
                    order: (i + 1) * 1000
                });
            });
        });
        try {
            await PN_reorderNotesInGroup(updates);
        } catch (e) {
            PN_toast("Move failed: " + e.message, "error");
        }
    }

    async function _moveGroup(gid, dir) {
        const idx = _groups.findIndex(g => g.id === gid);
        if (idx < 0) return;
        const target = idx + dir;
        if (target < 0 || target >= _groups.length) return;
        const reordered = _groups.slice();
        const [moved] = reordered.splice(idx, 1);
        reordered.splice(target, 0, moved);
        try {
            await PN_reorderGroups(reordered.map((g, i) => ({ id: g.id, order: (i + 1) * 1000 })));
        } catch (e) {
            PN_toast("Reorder failed: " + e.message, "error");
        }
    }

    /* ------------------------------------------------------------ *
     *                       Media modal
     * ------------------------------------------------------------ */
    function _openMedia(att) {
        const modalEl = document.getElementById("mediaModal");
        const title   = modalEl.querySelector("#mediaModalTitle");
        const body    = modalEl.querySelector("#mediaModalBody");
        title.textContent = att.name || "";
        if (att.type === "image") {
            body.innerHTML = `<img src="${PN_escapeHtml(att.url)}" alt="" class="img-fluid pn-media-img" />`;
        } else if (att.type === "video") {
            body.innerHTML = `
                <video controls autoplay class="pn-media-video">
                    <source src="${PN_escapeHtml(att.url)}" ${att.mime ? `type="${PN_escapeHtml(att.mime)}"` : ""}>
                    Your browser does not support video.
                </video>`;
        } else {
            body.innerHTML = `
                <div class="pn-media-file">
                    <i class="bi bi-file-earmark-text"></i>
                    <p class="mt-2">${PN_escapeHtml(att.name)}</p>
                    <a class="btn btn-light" href="${PN_escapeHtml(att.url)}" target="_blank" rel="noopener">
                        <i class="bi bi-box-arrow-up-right me-1"></i>Open / download
                    </a>
                </div>`;
        }
        const m = bootstrap.Modal.getOrCreateInstance(modalEl);
        modalEl.addEventListener("hidden.bs.modal", () => { body.innerHTML = ""; }, { once: true });
        m.show();
    }

    /* ------------------------------------------------------------ */
    return {
        mount, unmount, refresh, setFilter, setBulkMode,
        getSelection, clearSelection
    };
})();
