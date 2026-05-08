/* =====================================================================
 *  app.js
 *  ---------------------------------------------------------------------
 *  Main application controller.
 *
 *  Responsibilities:
 *    - Auth gate + user header
 *    - Route between dashboard / project / users / activity views
 *    - Dashboard: project grid, filters, new-project modal
 *    - Project view: subscribe to project + groups + notes + shares,
 *                    wire all UI events into the dedicated modules.
 *    - Note modal (create / edit) – including attachments
 *    - Group modal
 *    - Share modal
 *    - Global search across projects and notes
 *    - Sidebar/recent rendering, theme, logout
 * ===================================================================== */

(function () {

    /* ----------------- internal state ----------------- */
    let _user             = null;          // /users/{uid}
    let _allProjects      = [];            // dashboard list
    let _filter           = "all";         // all|my|shared|favorites|archived
    let _currentView      = "dashboard";   // dashboard | project | users | activity
    let _viewState        = null;          // varies per view

    /* unsubscribers per view */
    let _unsubProjectsList = null;
    const _projUnsubs = {};                // when in project view

    const $  = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

    /* ============================================================
     *                      BOOTSTRAP
     * ============================================================ */
    document.addEventListener("DOMContentLoaded", () => {
        // Logout button
        $("#logoutBtn").addEventListener("click", async (e) => {
            e.preventDefault();
            const ok = await PN_confirm({ title: "Sign out?", okText: "Sign out", danger: false });
            if (!ok) return;
            await PN_logout();
            location.href = "login.html";
        });

        // Sidebar toggle on mobile
        $("#sidebarToggleBtn").addEventListener("click", () => {
            $("#appSidebar").classList.toggle("open");
        });
        document.addEventListener("click", (e) => {
            const sb = $("#appSidebar");
            if (!sb.classList.contains("open")) return;
            if (e.target.closest("#appSidebar") || e.target.closest("#sidebarToggleBtn")) return;
            sb.classList.remove("open");
        });

        // Sidebar nav
        $$("#appSidebar [data-pn-view]").forEach(a => {
            a.addEventListener("click", (e) => {
                e.preventDefault();
                _setActiveSideLink(a);
                const view = a.dataset.pnView;
                if (view === "dashboard") showDashboard("all");
                if (view === "users")     showUsers();
                if (view === "activity")  showActivity();
                $("#appSidebar").classList.remove("open");
            });
        });
        $$("#appSidebar [data-pn-filter]").forEach(a => {
            a.addEventListener("click", (e) => {
                e.preventDefault();
                _setActiveSideLink(a);
                showDashboard(a.dataset.pnFilter);
                $("#appSidebar").classList.remove("open");
            });
        });

        // New project (sidebar)
        $("#newProjectBtn").addEventListener("click", () => openProjectModal());

        // Top nav avatar links
        $$('[data-pn-view="dashboard"]').forEach(a => {
            a.addEventListener("click", (e) => {
                e.preventDefault();
                showDashboard("all");
            });
        });

        // Global search
        const search = $("#globalSearch");
        search.addEventListener("input", PN_debounce(() => {
            const term = search.value.trim().toLowerCase();
            if (_currentView === "dashboard") {
                _renderDashboardGrid(term);
            } else if (_currentView === "project") {
                PN_Kanban.setFilter({ search: term });
            }
        }, 200));

        // Form bindings
        _bindProjectModal();
        _bindGroupModal();
        _bindNoteModal();
        _bindShareModal();

        // Auth gate
        PN_onAuthReady((user) => {
            if (!user) { location.href = "login.html"; return; }
            if (user.disabled) {
                PN_toast("Your account is disabled.", "error");
                PN_logout().then(() => location.href = "login.html");
                return;
            }
            _user = user;
            _decorateNavbar();
            _toggleOwnerOnlyUI();
            _refreshUserListener();
            showDashboard("all");
        });
    });

    /* ============================================================
     *                      USER / NAVBAR
     * ============================================================ */
    function _refreshUserListener() {
        // Live-update local _user when our /users/{uid} doc changes,
        // so favorites/role updates propagate without reload.
        PN_DB.collection("users").doc(_user.uid).onSnapshot((snap) => {
            if (!snap.exists) return;
            _user = Object.assign({ uid: _user.uid }, snap.data());
            _decorateNavbar();
            _toggleOwnerOnlyUI();
            if (_user.disabled) {
                PN_toast("Your account has been disabled.", "error");
                PN_logout().then(() => location.href = "login.html");
            }
            // Refresh dashboard if showing
            if (_currentView === "dashboard") _renderDashboardGrid();
        });
    }

    function _decorateNavbar() {
        const u = _user;
        $("#navAvatar").textContent = PN_initials(u.username);
        $("#navAvatar").style.background = PN_colorFromString(u.username);
        $("#navUserName").textContent = u.username;
        $("#navUserRole").textContent = u.role;
        $("#navUserHeader").textContent = "Signed in as " + u.username;
    }
    function _toggleOwnerOnlyUI() {
        $("#ownerSection").classList.toggle("d-none", _user.role !== "owner");
    }
    function _setActiveSideLink(a) {
        $$("#appSidebar a").forEach(x => x.classList.remove("active"));
        a.classList.add("active");
    }

    /* ============================================================
     *                      RECENT LIST (sidebar)
     * ============================================================ */
    function _renderRecent() {
        const list = $("#recentList");
        const ids = (_user.recent || []).slice(0, 5);
        if (!ids.length) {
            list.innerHTML = '<li class="pn-side-empty">No recent projects</li>';
            return;
        }
        const byId = {};
        _allProjects.forEach(p => byId[p.id] = p);
        list.innerHTML = ids.map(id => {
            const p = byId[id];
            if (!p) return "";
            return `<li><a href="#" data-pn-recent="${PN_escapeHtml(id)}">
                        <i class="bi bi-folder"></i>${PN_escapeHtml(p.name)}
                    </a></li>`;
        }).join("") || '<li class="pn-side-empty">No recent projects</li>';
        $$("#recentList [data-pn-recent]").forEach(a => {
            a.addEventListener("click", (e) => {
                e.preventDefault();
                showProject(a.dataset.pnRecent);
            });
        });
    }

    /* ============================================================
     *                      DASHBOARD
     * ============================================================ */
    function showDashboard(filter) {
        _filter = filter || "all";
        _currentView = "dashboard";
        _stopProjectView();

        const root = $("#appMain");
        const tpl = document.getElementById("tpl-dashboard").content.cloneNode(true);
        root.innerHTML = "";
        root.appendChild(tpl);

        // Filter buttons
        $$("[data-pn-filter-btn]").forEach(b => {
            const active = b.dataset.pnFilterBtn === _filter;
            b.classList.toggle("active", active);
            b.addEventListener("click", () => {
                _filter = b.dataset.pnFilterBtn;
                $$("[data-pn-filter-btn]").forEach(x =>
                    x.classList.toggle("active", x === b)
                );
                _renderDashboardGrid();
            });
        });
        $("#dashNewBtn").addEventListener("click", () => openProjectModal());

        if (_unsubProjectsList) _unsubProjectsList();
        _unsubProjectsList = PN_subscribeProjects(_user, (list) => {
            _allProjects = list;
            _renderDashboardGrid();
            _renderRecent();
        });
    }

    function _renderDashboardGrid(searchOverride) {
        const grid = $("#projectGrid");
        if (!grid) return;
        const term = (searchOverride !== undefined ? searchOverride : ($("#globalSearch").value || "")).toLowerCase().trim();

        let projects = _allProjects.slice();
        // sidebar filter
        if (_filter === "my")        projects = projects.filter(p => p.ownerId === _user.uid);
        if (_filter === "shared")    projects = projects.filter(p => p.ownerId !== _user.uid);
        if (_filter === "favorites") projects = projects.filter(p => p._isFavorite);
        if (_filter === "archived")  projects = projects.filter(p => p.archived);
        else                          projects = projects.filter(p => !p.archived);

        if (term) {
            projects = projects.filter(p =>
                (p.name || "").toLowerCase().includes(term) ||
                (p.description || "").toLowerCase().includes(term) ||
                (p.ownerUsername || "").toLowerCase().includes(term));
        }

        if (!projects.length) {
            grid.innerHTML = PN_emptyState(
                _filter === "archived" ? "bi-archive" : "bi-folder2-open",
                term     ? "No projects match your search"
                : _filter === "favorites" ? "No favorites yet"
                : _filter === "archived"  ? "Nothing archived"
                : _filter === "shared"    ? "No projects shared with you"
                : "No projects yet",
                _user.role === "viewer"
                    ? "Ask an owner or editor to share a project with you."
                    : "Click \"New Project\" to start your first board."
            );
            return;
        }

        grid.innerHTML = projects.map(_renderProjectCard).join("");
        $$(".pn-project-card").forEach(card => {
            const id = card.dataset.pid;
            card.addEventListener("click", (e) => {
                if (e.target.closest("[data-pn-stop]")) return;
                showProject(id);
            });
        });
        $$(".pn-project-card [data-pn-fav]").forEach(b => {
            b.addEventListener("click", async (e) => {
                e.stopPropagation();
                const id = b.closest(".pn-project-card").dataset.pid;
                try { await PN_toggleFavorite(_user, id); }
                catch (err) { PN_toast("Failed: " + err.message, "error"); }
            });
        });
    }

    function _renderProjectCard(p) {
        const visIcon = p.visibility === "shared" ? "bi-people" : "bi-lock";
        const visLabel = p.visibility === "shared" ? "Shared" : "Private";
        const star = p._isFavorite ? "bi-star-fill text-warning" : "bi-star";
        const archived = p.archived ? '<span class="pn-pill pn-pill-archive"><i class="bi bi-archive"></i> archived</span>' : "";
        const desc = p.description
            ? `<p class="pn-project-card-desc">${PN_escapeHtml(p.description)}</p>`
            : `<p class="pn-project-card-desc text-muted fst-italic">No description</p>`;
        const permPill = p._perm === "view" ? '<span class="pn-pill pn-pill-perm">view only</span>' : "";

        return `
        <article class="pn-project-card" data-pid="${PN_escapeHtml(p.id)}">
            <header class="pn-project-card-head">
                <div class="pn-project-icon" style="background:${PN_colorFromString(p.id)}">
                    <i class="bi bi-stickies"></i>
                </div>
                <button class="btn btn-icon btn-sm" data-pn-fav data-pn-stop title="Star">
                    <i class="bi ${star}"></i>
                </button>
            </header>
            <h3 class="pn-project-card-title">${PN_escapeHtml(p.name)}</h3>
            ${desc}
            <footer class="pn-project-card-foot">
                <span class="pn-pill"><i class="bi ${visIcon}"></i> ${visLabel}</span>
                ${permPill}
                ${archived}
                <span class="pn-card-time ms-auto">
                    <i class="bi bi-clock"></i>
                    ${PN_escapeHtml(p.updatedAt ? PN_fmtDateShort(p.updatedAt) : "")}
                </span>
            </footer>
            <div class="pn-project-card-owner">
                <span class="pn-avatar pn-avatar-xs"
                      style="background:${PN_colorFromString(p.ownerUsername)}">
                    ${PN_initials(p.ownerUsername || "?")}
                </span>
                <small class="text-muted">${PN_escapeHtml(p.ownerUsername || "")}</small>
            </div>
        </article>`;
    }

    /* ============================================================
     *                  PROJECT VIEW (KANBAN)
     * ============================================================ */
    function _stopProjectView() {
        Object.values(_projUnsubs).forEach(u => { try { u(); } catch (e) {} });
        Object.keys(_projUnsubs).forEach(k => delete _projUnsubs[k]);
        try { PN_Kanban.unmount(); } catch (e) {}
    }

    function showProject(projectId) {
        _currentView = "project";
        _stopProjectView();

        const root = $("#appMain");
        const tpl  = document.getElementById("tpl-project").content.cloneNode(true);
        root.innerHTML = "";
        root.appendChild(tpl);

        // Mark recent
        PN_pushRecent(_user, projectId).catch(() => {});

        // Local state for this view
        const state = _viewState = {
            projectId: projectId,
            project:   null,
            groups:    [],
            notes:     [],
            shares:    [],
            perm:      "view",
            bulk:      false,
            search:    "",
            status:    ""
        };

        // Back button
        $("[data-pn-back]").addEventListener("click", () => showDashboard(_filter));

        // Subscribe project
        _projUnsubs.project = PN_subscribeProject(projectId, (p) => {
            if (!p) {
                root.innerHTML = `<div class="pn-page">${PN_emptyState("bi-x-octagon",
                    "Project not found", "It may have been deleted or you no longer have access.")}</div>`;
                return;
            }
            state.project = Object.assign({ id: projectId }, p);
            // Determine perm
            const myShare = state.shares.find(s => s.targetUid === _user.uid);
            state.perm = PN_permissionFor(state.project, _user, myShare);
            if (state.perm === "none") {
                root.innerHTML = `<div class="pn-page">${PN_emptyState("bi-shield-lock",
                    "Access denied", "You don't have permission to view this project.")}</div>`;
                return;
            }
            _renderProjectHeader(state);
            _renderKanban(state);
        });

        // Subscribe shares (needed for permission resolution + share modal)
        _projUnsubs.shares = PN_subscribeShares(projectId, (shares) => {
            state.shares = shares;
            if (state.project) {
                const my = shares.find(s => s.targetUid === _user.uid);
                state.perm = PN_permissionFor(state.project, _user, my);
                _renderProjectHeader(state);
                _renderKanban(state); // perm may have changed
                _refreshShareList(state);
            }
        });

        // Subscribe groups + notes
        _projUnsubs.groups = PN_subscribeGroups(projectId, (groups) => {
            state.groups = groups;
            _renderKanban(state);
        });
        _projUnsubs.notes = PN_subscribeNotes(projectId, (notes) => {
            state.notes = notes;
            _renderKanban(state);
        });

        /* Header buttons */
        $("#projAddGroupBtn").addEventListener("click", () => openGroupModal());
        $("#projShareBtn").addEventListener("click", () => openShareModal(state));
        $("#projStarBtn").addEventListener("click", async () => {
            try { await PN_toggleFavorite(_user, projectId); }
            catch (e) { PN_toast("Failed: " + e.message, "error"); }
        });

        $$('[data-pn-export]').forEach(a => {
            a.addEventListener("click", (e) => {
                e.preventDefault();
                if (!state.project) return;
                try { PN_exportProject(state.project, state.groups, state.notes, a.dataset.pnExport); }
                catch (er) { PN_toast("Export failed: " + er.message, "error"); }
            });
        });

        $$('[data-pn-action]').forEach(a => {
            a.addEventListener("click", async (e) => {
                e.preventDefault();
                const act = a.dataset.pnAction;
                if (act === "edit-project") openProjectModal(state.project);
                else if (act === "archive-project") {
                    try {
                        await PN_toggleArchiveProject(projectId, !state.project.archived);
                        PN_toast(state.project.archived ? "Project restored." : "Project archived.", "success");
                    } catch (er) { PN_toast("Failed: " + er.message, "error"); }
                }
                else if (act === "delete-project") {
                    const ok = await PN_confirm({
                        title: "Delete project?",
                        message: "This permanently deletes the project, all groups, all notes and their attachments. This cannot be undone.",
                        okText: "Delete forever",
                        danger: true
                    });
                    if (!ok) return;
                    try {
                        PN_showSpinner("Deleting project…");
                        await PN_deleteProject(projectId);
                        PN_hideSpinner();
                        PN_toast("Project deleted.", "success");
                        showDashboard("all");
                    } catch (er) {
                        PN_hideSpinner();
                        PN_toast("Delete failed: " + er.message, "error");
                    }
                }
            });
        });

        /* Toolbar */
        $("#projSearch").addEventListener("input", PN_debounce(() => {
            state.search = $("#projSearch").value.trim();
            PN_Kanban.setFilter({ search: state.search });
        }, 150));
        $("#projStatusFilter").addEventListener("change", () => {
            state.status = $("#projStatusFilter").value;
            PN_Kanban.setFilter({ status: state.status });
        });
        $("#bulkSelectToggle").addEventListener("click", () => {
            state.bulk = !state.bulk;
            $("#bulkSelectToggle").classList.toggle("active", state.bulk);
            PN_Kanban.setBulkMode(state.bulk);
            _updateBulkBar([]);
        });
        $("#bulkDeleteBtn").addEventListener("click", async () => {
            const ids = PN_Kanban.getSelection();
            if (!ids.length) return;
            const ok = await PN_confirm({
                title: `Delete ${ids.length} note${ids.length > 1 ? "s" : ""}?`,
                okText: "Delete", danger: true
            });
            if (!ok) return;
            PN_showSpinner("Deleting…");
            try {
                for (const id of ids) {
                    const note = state.notes.find(n => n.id === id);
                    await PN_deleteNote(id, note ? note.attachments : []);
                }
                PN_hideSpinner();
                PN_toast("Notes deleted.", "success");
                state.bulk = false;
                PN_Kanban.setBulkMode(false);
                _updateBulkBar([]);
            } catch (e) {
                PN_hideSpinner();
                PN_toast("Delete failed: " + e.message, "error");
            }
        });
    }

    function _updateBulkBar(ids) {
        const c = $("#selCount"), b = $("#bulkDeleteBtn");
        if (!c || !b) return;
        if (ids && ids.length) {
            c.textContent = `${ids.length} selected`;
            c.classList.remove("d-none");
            b.classList.remove("d-none");
        } else {
            c.classList.add("d-none");
            b.classList.add("d-none");
        }
    }

    function _renderProjectHeader(state) {
        const p = state.project;
        if (!p) return;
        $("#projTitle").textContent = p.name;
        $("#projDesc").textContent  = p.description || "";
        const visEl = $("#projVisibility");
        visEl.innerHTML = p.visibility === "shared"
            ? '<i class="bi bi-people"></i> Shared'
            : '<i class="bi bi-lock"></i> Private';

        const permEl = $("#projPerm");
        permEl.classList.remove("d-none");
        if (state.perm === "owner") permEl.innerHTML = "<i class='bi bi-key-fill'></i> owner";
        else if (state.perm === "edit") permEl.innerHTML = "<i class='bi bi-pencil-fill'></i> editor";
        else if (state.perm === "view") permEl.innerHTML = "<i class='bi bi-eye-fill'></i> view only";
        else permEl.classList.add("d-none");

        // Star icon
        const star = $("#projStarBtn i");
        if ((_user.favorites || []).includes(p.id))
            star.className = "bi bi-star-fill text-warning";
        else
            star.className = "bi bi-star";

        // Hide editing controls for view-only users
        const editOnly = state.perm === "owner" || state.perm === "edit";
        $$('[data-pn-edit-only]').forEach(el => {
            el.classList.toggle("d-none", !editOnly);
        });
    }

    function _renderKanban(state) {
        if (!state.project) return;
        const board = $("#kanbanBoard");
        if (!board) return;
        if (!board._mounted) {
            PN_Kanban.mount(board, {
                project: state.project,
                user:    _user,
                perm:    state.perm,
                onAddGroup:    () => openGroupModal(),
                onEditGroup:   (gid) => openGroupModal(state.groups.find(g => g.id === gid)),
                onDeleteGroup: async (gid) => {
                    const grp = state.groups.find(g => g.id === gid);
                    if (!grp) return;
                    const ok = await PN_confirm({
                        title: `Delete group "${grp.title}"?`,
                        message: "All notes inside the group will be deleted. This cannot be undone.",
                        okText: "Delete", danger: true
                    });
                    if (!ok) return;
                    try {
                        PN_showSpinner("Deleting group…");
                        await PN_deleteGroup(gid, state.projectId);
                        PN_hideSpinner();
                        PN_toast("Group deleted.", "success");
                    } catch (e) { PN_hideSpinner(); PN_toast(e.message, "error"); }
                },
                onAddNote: (gid) => openNoteModal({ groupId: gid, projectId: state.projectId }),
                onEditNote: (nid) => {
                    const n = state.notes.find(x => x.id === nid);
                    if (n) openNoteModal(n);
                },
                onSelectionChange: _updateBulkBar
            });
            board._mounted = true;
        }
        // Update perm in case it changed
        PN_Kanban.refresh(state.groups, state.notes);
    }

    /* ============================================================
     *                  PROJECT MODAL
     * ============================================================ */
    function _bindProjectModal() {
        $("#projectForm").addEventListener("submit", async (e) => {
            e.preventDefault();
            const id   = $("#projectIdInput").value;
            const data = {
                name:        $("#projectNameInput").value.trim(),
                description: $("#projectDescInput").value.trim(),
                visibility:  document.querySelector('input[name="projVis"]:checked').value
            };
            if (!data.name) { PN_toast("Please enter a project name.", "error"); return; }
            try {
                if (id) {
                    await PN_updateProject(id, data);
                    PN_toast("Project updated.", "success");
                } else {
                    const newId = await PN_createProject(data, _user);
                    PN_toast("Project created.", "success");
                    bootstrap.Modal.getInstance($("#projectModal")).hide();
                    showProject(newId);
                    return;
                }
                bootstrap.Modal.getInstance($("#projectModal")).hide();
            } catch (er) {
                PN_toast("Save failed: " + er.message, "error");
            }
        });
    }
    function openProjectModal(existing) {
        $("#projectModalTitle").textContent = existing ? "Edit Project" : "New Project";
        $("#projectIdInput").value   = existing ? existing.id   : "";
        $("#projectNameInput").value = existing ? existing.name : "";
        $("#projectDescInput").value = existing ? (existing.description || "") : "";
        const v = existing ? (existing.visibility || "private") : "private";
        document.querySelector(`input[name="projVis"][value="${v}"]`).checked = true;
        bootstrap.Modal.getOrCreateInstance($("#projectModal")).show();
        setTimeout(() => $("#projectNameInput").focus(), 200);
    }

    /* ============================================================
     *                  GROUP MODAL
     * ============================================================ */
    const GROUP_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b",
                          "#ef4444", "#a855f7", "#ec4899", "#14b8a6"];
    function _bindGroupModal() {
        // Build colour swatches
        const picker = $("#groupColorPicker");
        picker.innerHTML = GROUP_COLORS.map(c => `
            <button type="button" class="pn-color-swatch" data-color="${c}"
                    style="background:${c}" aria-label="${c}"></button>`).join("");
        picker.addEventListener("click", (e) => {
            const sw = e.target.closest("[data-color]");
            if (!sw) return;
            $("#groupColorInput").value = sw.dataset.color;
            picker.querySelectorAll(".pn-color-swatch")
                .forEach(b => b.classList.toggle("active", b === sw));
        });

        $("#groupForm").addEventListener("submit", async (e) => {
            e.preventDefault();
            const id    = $("#groupIdInput").value;
            const title = $("#groupTitleInput").value.trim();
            const color = $("#groupColorInput").value;
            if (!title) return;
            try {
                if (id) {
                    await PN_updateGroup(id, { title, color });
                    PN_toast("Group updated.", "success");
                } else {
                    const order = (_viewState && _viewState.groups.length)
                        ? Math.max(..._viewState.groups.map(g => g.order || 0)) + 1000
                        : 1000;
                    await PN_createGroup({
                        projectId: _viewState.projectId,
                        title, color, order
                    });
                    PN_toast("Group created.", "success");
                }
                bootstrap.Modal.getInstance($("#groupModal")).hide();
            } catch (er) {
                PN_toast("Save failed: " + er.message, "error");
            }
        });
    }
    function openGroupModal(existing) {
        $("#groupModalTitle").textContent = existing ? "Edit Group" : "New Group";
        $("#groupIdInput").value     = existing ? existing.id    : "";
        $("#groupTitleInput").value  = existing ? existing.title : "";
        const color = existing ? existing.color || GROUP_COLORS[0] : GROUP_COLORS[0];
        $("#groupColorInput").value = color;
        $$("#groupColorPicker .pn-color-swatch").forEach(b =>
            b.classList.toggle("active", b.dataset.color === color));
        bootstrap.Modal.getOrCreateInstance($("#groupModal")).show();
        setTimeout(() => $("#groupTitleInput").focus(), 200);
    }

    /* ============================================================
     *                  NOTE MODAL
     * ============================================================ */
    let _noteAttachments = [];   // working list while modal open
    let _noteAttRemoved  = [];   // storagePaths to delete after save

    function _bindNoteModal() {
        $("#noteForm").addEventListener("submit", async (e) => {
            e.preventDefault();
            const id        = $("#noteIdInput").value;
            const groupId   = $("#noteGroupIdInput").value;
            const projectId = _viewState ? _viewState.projectId : null;
            if (!projectId || !groupId) return;

            const tagsRaw = $("#noteTagsInput").value;
            const tags = tagsRaw.split(",").map(t => t.trim()).filter(Boolean).slice(0, 16);

            const due = $("#noteDueInput").value
                ? new Date($("#noteDueInput").value).toISOString()
                : null;

            // Upload pending files
            const fileInput = $("#noteFileInput");
            if (fileInput.files && fileInput.files.length) {
                const progBox  = $("#noteUploadProgress");
                const progBar  = progBox.querySelector(".progress-bar");
                const progLab  = $("#noteUploadLabel");
                progBox.classList.remove("d-none");
                try {
                    for (let i = 0; i < fileInput.files.length; i++) {
                        const f = fileInput.files[i];
                        progLab.textContent = `Uploading ${i + 1}/${fileInput.files.length}: ${f.name}`;
                        const att = await PN_uploadAttachment(f, projectId, (pct) => {
                            progBar.style.width = pct + "%";
                        });
                        _noteAttachments.push(att);
                    }
                    progBar.style.width = "100%";
                } catch (er) {
                    progBox.classList.add("d-none");
                    PN_toast("Upload failed: " + er.message, "error");
                    return;
                } finally {
                    setTimeout(() => progBox.classList.add("d-none"), 800);
                    progBar.style.width = "0%";
                    fileInput.value = "";
                }
            }

            const data = {
                projectId,
                groupId,
                title:       $("#noteTitleInput").value.trim(),
                description: $("#noteDescInput").value.trim(),
                status:      $("#noteStatusInput").value,
                assignee:    $("#noteAssigneeInput").value.trim().toLowerCase(),
                tags,
                link:        $("#noteLinkInput").value.trim(),
                dueAt:       due,
                attachments: _noteAttachments
            };
            if (!data.title) { PN_toast("Please enter a title.", "error"); return; }

            try {
                if (id) {
                    await PN_updateNote(id, data);
                    PN_toast("Note updated.", "success");
                } else {
                    // Compute new order – append to end of column
                    const colNotes = (_viewState.notes || []).filter(n => n.groupId === groupId);
                    const maxOrder = colNotes.reduce((m, n) => Math.max(m, n.order || 0), 0);
                    data.order = maxOrder + 1000;
                    await PN_createNote(data);
                    PN_toast("Note created.", "success");
                }

                // Remove deleted attachments from storage AFTER successful save
                if (_noteAttRemoved.length) {
                    _noteAttRemoved.forEach(p => {
                        PN_STORAGE.ref(p).delete().catch(() => {});
                    });
                }

                bootstrap.Modal.getInstance($("#noteModal")).hide();
            } catch (er) {
                PN_toast("Save failed: " + er.message, "error");
            }
        });

        $("#noteDeleteBtn").addEventListener("click", async () => {
            const id = $("#noteIdInput").value;
            if (!id) return;
            const ok = await PN_confirm({
                title: "Delete note?",
                message: "This permanently deletes the note and its attachments.",
                okText: "Delete", danger: true
            });
            if (!ok) return;
            try {
                await PN_deleteNote(id, _noteAttachments);
                PN_toast("Note deleted.", "success");
                bootstrap.Modal.getInstance($("#noteModal")).hide();
            } catch (er) { PN_toast("Failed: " + er.message, "error"); }
        });

        // Render attachments live as files are queued
        $("#noteFileInput").addEventListener("change", () => _renderAttachmentList());
    }

    function _renderAttachmentList() {
        const list = $("#noteAttachList");
        const queued = $("#noteFileInput").files
            ? Array.from($("#noteFileInput").files).map(f => ({
                  name: f.name, size: f.size, type: PN_detectMediaType(f.name), pending: true
              }))
            : [];
        const all = _noteAttachments.concat(queued);
        if (!all.length) { list.innerHTML = ""; return; }
        list.innerHTML = all.map((a, i) => {
            const icon = a.type === "image" ? "bi-image"
                       : a.type === "video" ? "bi-camera-video"
                       : "bi-file-earmark";
            const sizeBadge = a.size ? `<small class="text-muted ms-2">${PN_fmtBytes(a.size)}</small>` : "";
            const removeBtn = a.pending
                ? ""
                : `<button type="button" class="btn btn-sm btn-link text-danger" data-pn-att-remove="${i}">
                    <i class="bi bi-x-lg"></i>
                   </button>`;
            const previewBtn = !a.pending && a.url
                ? `<a href="${PN_escapeHtml(a.url)}" target="_blank" class="btn btn-sm btn-link"><i class="bi bi-box-arrow-up-right"></i></a>`
                : "";
            const pendingBadge = a.pending ? '<span class="badge text-bg-warning ms-2">queued</span>' : "";
            return `
                <div class="pn-att-row">
                    <i class="bi ${icon} me-2"></i>
                    <span class="pn-att-name">${PN_escapeHtml(a.name)}</span>
                    ${sizeBadge}${pendingBadge}
                    <span class="ms-auto">${previewBtn}${removeBtn}</span>
                </div>`;
        }).join("");

        list.querySelectorAll("[data-pn-att-remove]").forEach(b => {
            b.addEventListener("click", () => {
                const idx = parseInt(b.dataset.pnAttRemove, 10);
                const removed = _noteAttachments.splice(idx, 1)[0];
                if (removed && removed.storagePath) _noteAttRemoved.push(removed.storagePath);
                _renderAttachmentList();
            });
        });
    }

    function openNoteModal(noteOrShell) {
        const isEdit = !!noteOrShell.id;
        $("#noteModalTitle").textContent = isEdit ? "Edit Note" : "New Note";
        $("#noteIdInput").value          = noteOrShell.id          || "";
        $("#noteGroupIdInput").value     = noteOrShell.groupId     || "";
        $("#noteTitleInput").value       = noteOrShell.title       || "";
        $("#noteDescInput").value        = noteOrShell.description || "";
        $("#noteStatusInput").value      = noteOrShell.status      || "todo";
        $("#noteAssigneeInput").value    = noteOrShell.assignee    || "";
        $("#noteLinkInput").value        = noteOrShell.link        || "";
        $("#noteTagsInput").value        = (noteOrShell.tags || []).join(", ");
        if (noteOrShell.dueAt) {
            const d = noteOrShell.dueAt.toDate
                ? noteOrShell.dueAt.toDate()
                : new Date(noteOrShell.dueAt);
            const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
            $("#noteDueInput").value = local.toISOString().slice(0, 16);
        } else {
            $("#noteDueInput").value = "";
        }
        $("#noteFileInput").value = "";
        _noteAttachments = (noteOrShell.attachments || []).slice();
        _noteAttRemoved  = [];
        _renderAttachmentList();
        $("#noteDeleteBtn").classList.toggle("d-none", !isEdit);

        bootstrap.Modal.getOrCreateInstance($("#noteModal")).show();
        setTimeout(() => $("#noteTitleInput").focus(), 200);
    }

    /* ============================================================
     *                  SHARE MODAL
     * ============================================================ */
    let _shareCtxState = null;
    function _bindShareModal() {
        $("#shareForm").addEventListener("submit", async (e) => {
            e.preventDefault();
            if (!_shareCtxState) return;
            const u = $("#shareUsernameInput").value.trim();
            const perm = $("#sharePermInput").value;
            try {
                await PN_addShare(_shareCtxState.projectId, u, perm);
                PN_toast("Shared with " + u + ".", "success");
                $("#shareUsernameInput").value = "";
            } catch (er) {
                PN_toast(er.message, "error");
            }
        });
    }
    function openShareModal(state) {
        _shareCtxState = state;
        _refreshShareList(state);
        bootstrap.Modal.getOrCreateInstance($("#shareModal")).show();
    }
    function _refreshShareList(state) {
        const list = $("#shareList");
        if (!list) return;
        if (!state.shares.length) {
            list.innerHTML = '<li class="list-group-item text-muted">No collaborators yet.</li>';
            return;
        }
        list.innerHTML = state.shares.map(s => `
            <li class="list-group-item d-flex align-items-center gap-2" data-sid="${PN_escapeHtml(s.id)}">
                <span class="pn-avatar pn-avatar-sm"
                      style="background:${PN_colorFromString(s.targetUsername)}">
                    ${PN_initials(s.targetUsername)}
                </span>
                <div class="flex-grow-1">
                    <div class="fw-semibold">${PN_escapeHtml(s.targetUsername)}</div>
                    <small class="text-muted">${s.permission === "edit" ? "Can edit" : "View only"}</small>
                </div>
                <select class="form-select form-select-sm w-auto pn-share-perm">
                    <option value="view" ${s.permission === "view" ? "selected" : ""}>View</option>
                    <option value="edit" ${s.permission === "edit" ? "selected" : ""}>Edit</option>
                </select>
                <button class="btn btn-sm btn-outline-danger" data-pn-revoke>
                    <i class="bi bi-x-lg"></i>
                </button>
            </li>`).join("");

        list.querySelectorAll("li[data-sid]").forEach(li => {
            const sid = li.dataset.sid;
            li.querySelector(".pn-share-perm").addEventListener("change", async (e) => {
                try {
                    await PN_updateSharePermission(sid, e.target.value);
                    PN_toast("Permission updated.", "success");
                } catch (er) { PN_toast(er.message, "error"); }
            });
            li.querySelector("[data-pn-revoke]").addEventListener("click", async () => {
                const ok = await PN_confirm({
                    title: "Revoke access?", okText: "Revoke", danger: true
                });
                if (!ok) return;
                try {
                    await PN_removeShare(sid);
                    PN_toast("Access revoked.", "success");
                } catch (er) { PN_toast(er.message, "error"); }
            });
        });
    }

    /* ============================================================
     *                  USERS / ACTIVITY VIEWS
     * ============================================================ */
    function showUsers() {
        _currentView = "users";
        _stopProjectView();
        if (_unsubProjectsList) { _unsubProjectsList(); _unsubProjectsList = null; }
        const root = $("#appMain");
        if (!_user || _user.role !== "owner") {
            root.innerHTML = `<div class="pn-page">
                ${PN_emptyState("bi-shield-lock", "Owner only",
                    "You don't have permission to view this page.")}</div>`;
            return;
        }
        PN_renderUsersScreen(root, _user);
    }

    function showActivity() {
        _currentView = "activity";
        _stopProjectView();
        if (_unsubProjectsList) { _unsubProjectsList(); _unsubProjectsList = null; }
        const root = $("#appMain");
        if (!_user || _user.role !== "owner") {
            root.innerHTML = `<div class="pn-page">
                ${PN_emptyState("bi-shield-lock", "Owner only",
                    "You don't have permission to view this page.")}</div>`;
            return;
        }
        PN_renderActivityScreen(root);
    }

})();
