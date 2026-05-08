/* =====================================================================
 *  users.js
 *  ---------------------------------------------------------------------
 *  Owner-only user management screen.
 *
 *  Public API:
 *    PN_renderUsersScreen(rootEl, currentUser)
 *    PN_renderActivityScreen(rootEl)
 *
 *  NOTES on password reset & deletion:
 *  -----------------------------------
 *  Firebase Authentication does NOT permit deleting / disabling
 *  another user's auth record from a browser SDK – that is a
 *  privileged operation that requires the Firebase Admin SDK
 *  (server side).  This screen therefore performs *Firestore-level*
 *  changes only:
 *
 *    – disabled flag on /users/{uid}      ➜ blocks app access via
 *                                          security rules + UI guard
 *    – role change on /users/{uid}        ➜ promote / demote
 *    – deletion of /users/{uid}           ➜ hides them from the app
 *                                          (auth record stays orphan)
 *
 *  The reset-password action shows the new password in a toast so the
 *  owner can communicate it to the user;  full password rotation
 *  must be performed from the Firebase console or via a Cloud Function.
 * ===================================================================== */

(function () {

    /* ============================================================
     * Render the users table
     * ============================================================ */
    window.PN_renderUsersScreen = function (rootEl, currentUser) {
        if (!currentUser || currentUser.role !== "owner") {
            rootEl.innerHTML = `
                <div class="pn-page">
                    ${PN_emptyState("bi-shield-lock",
                        "Owner only",
                        "You don't have permission to view this page.")}
                </div>`;
            return () => {};
        }

        const tpl = document.getElementById("tpl-users").content.cloneNode(true);
        rootEl.innerHTML = "";
        rootEl.appendChild(tpl);

        const tbody = rootEl.querySelector("#usersTbody");

        // Live subscription
        const unsub = PN_DB.collection("users")
            .onSnapshot((snap) => {
                const users = [];
                snap.forEach(d => users.push(Object.assign({ uid: d.id }, d.data())));
                users.sort((a, b) => {
                    // owner first, then editors, then viewers, then alphabetical
                    const order = { owner: 0, editor: 1, viewer: 2 };
                    const ra = order[a.role] || 9, rb = order[b.role] || 9;
                    if (ra !== rb) return ra - rb;
                    return (a.username || "").localeCompare(b.username || "");
                });
                _renderRows(users);
            }, (e) => {
                tbody.innerHTML =
                    `<tr><td colspan="5" class="text-danger p-4">${PN_escapeHtml(e.message)}</td></tr>`;
            });

        function _renderRows(users) {
            if (!users.length) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-muted p-4 text-center">No users yet.</td></tr>`;
                return;
            }

            tbody.innerHTML = users.map(u => {
                const isMe = u.uid === currentUser.uid;
                const disabled = u.disabled ? "yes" : "no";
                return `
                <tr data-uid="${PN_escapeHtml(u.uid)}">
                    <td>
                        <div class="d-flex align-items-center gap-2">
                            <span class="pn-avatar pn-avatar-sm"
                                  style="background:${PN_colorFromString(u.username)}">
                                ${PN_initials(u.username)}
                            </span>
                            <div>
                                <div class="fw-semibold">${PN_escapeHtml(u.username)}${isMe ? ' <span class="badge text-bg-light ms-1">you</span>' : ''}</div>
                                <small class="text-muted">${u.lastLoginAt ? "Last login " + PN_escapeHtml(PN_fmtDate(u.lastLoginAt)) : "Never logged in"}</small>
                            </div>
                        </div>
                    </td>
                    <td>
                        <select class="form-select form-select-sm pn-role-select"
                                ${isMe ? "disabled" : ""}>
                            <option value="owner" ${u.role === "owner" ? "selected" : ""}>Owner</option>
                            <option value="editor" ${u.role === "editor" ? "selected" : ""}>Editor</option>
                            <option value="viewer" ${u.role === "viewer" ? "selected" : ""}>Viewer</option>
                        </select>
                    </td>
                    <td>
                        ${u.disabled
                            ? '<span class="badge text-bg-secondary"><i class="bi bi-pause-circle me-1"></i>Disabled</span>'
                            : '<span class="badge text-bg-success"><i class="bi bi-check-circle me-1"></i>Active</span>'}
                    </td>
                    <td><small class="text-muted">${u.createdAt ? PN_escapeHtml(PN_fmtDate(u.createdAt)) : "—"}</small></td>
                    <td class="text-end">
                        <div class="dropdown">
                            <button class="btn btn-icon btn-sm" data-bs-toggle="dropdown" ${isMe ? "disabled" : ""}>
                                <i class="bi bi-three-dots-vertical"></i>
                            </button>
                            <ul class="dropdown-menu dropdown-menu-end">
                                <li><a class="dropdown-item" href="#" data-pn-toggle-disable>
                                    <i class="bi ${u.disabled ? "bi-play-circle" : "bi-pause-circle"} me-2"></i>
                                    ${u.disabled ? "Re-enable" : "Disable"} account
                                </a></li>
                                <li><a class="dropdown-item" href="#" data-pn-reset-pw>
                                    <i class="bi bi-key me-2"></i>Reset password
                                </a></li>
                                <li><hr class="dropdown-divider" /></li>
                                <li><a class="dropdown-item text-danger" href="#" data-pn-delete-user>
                                    <i class="bi bi-trash me-2"></i>Delete user record
                                </a></li>
                            </ul>
                        </div>
                    </td>
                </tr>`;
            }).join("");

            // Bind events
            tbody.querySelectorAll("tr").forEach(tr => {
                const uid = tr.dataset.uid;
                const u   = users.find(x => x.uid === uid);
                if (!u) return;

                // Role select
                const sel = tr.querySelector(".pn-role-select");
                if (sel) sel.addEventListener("change", async () => {
                    const newRole = sel.value;
                    try {
                        await PN_DB.collection("users").doc(uid).update({ role: newRole });
                        PN_toast(`${u.username} is now ${newRole}.`, "success");
                    } catch (e) {
                        PN_toast("Update failed: " + e.message, "error");
                        sel.value = u.role; // revert
                    }
                });

                // Disable / enable
                const disBtn = tr.querySelector("[data-pn-toggle-disable]");
                if (disBtn) disBtn.addEventListener("click", async (e) => {
                    e.preventDefault();
                    const ok = await PN_confirm({
                        title: u.disabled ? "Re-enable account?" : "Disable account?",
                        message: u.disabled
                            ? `${u.username} will be able to sign in again.`
                            : `${u.username} will lose access immediately. Their data is preserved.`,
                        okText: u.disabled ? "Re-enable" : "Disable",
                        danger: !u.disabled
                    });
                    if (!ok) return;
                    try {
                        await PN_DB.collection("users").doc(uid).update({ disabled: !u.disabled });
                        PN_toast("Account updated.", "success");
                    } catch (e) {
                        PN_toast("Failed: " + e.message, "error");
                    }
                });

                // Reset password (informational only, see header note)
                const rstBtn = tr.querySelector("[data-pn-reset-pw]");
                if (rstBtn) rstBtn.addEventListener("click", async (e) => {
                    e.preventDefault();
                    PN_toast("Reset must be done in Firebase Console > Authentication > Users.", "info");
                });

                // Delete user record
                const delBtn = tr.querySelector("[data-pn-delete-user]");
                if (delBtn) delBtn.addEventListener("click", async (e) => {
                    e.preventDefault();
                    const ok = await PN_confirm({
                        title: "Delete user record?",
                        message: `This removes ${u.username} from the app. Their projects/notes are NOT deleted automatically. The auth account remains in Firebase Console — delete it there to fully remove the user.`,
                        okText: "Delete",
                        danger: true
                    });
                    if (!ok) return;
                    try {
                        const batch = PN_DB.batch();
                        batch.delete(PN_DB.collection("users").doc(uid));
                        if (u.username) batch.delete(PN_DB.collection("usernames").doc(u.username));
                        await batch.commit();
                        PN_toast("User record removed.", "success");
                    } catch (e) {
                        PN_toast("Delete failed: " + e.message, "error");
                    }
                });
            });
        }

        return unsub;
    };


    /* ============================================================
     * Activity log screen
     * ============================================================ */
    window.PN_renderActivityScreen = function (rootEl) {
        const tpl = document.getElementById("tpl-activity").content.cloneNode(true);
        rootEl.innerHTML = "";
        rootEl.appendChild(tpl);
        const list = rootEl.querySelector("#activityList");

        const unsub = PN_DB.collection("activity")
            .orderBy("createdAt", "desc")
            .limit(100)
            .onSnapshot((snap) => {
                if (snap.empty) {
                    list.innerHTML = PN_emptyState("bi-activity",
                        "No activity yet",
                        "Recent project changes will show up here.");
                    return;
                }
                list.innerHTML = "";
                snap.forEach(d => {
                    const a = d.data();
                    const icon = _iconForActivity(a.type);
                    const row = document.createElement("div");
                    row.className = "pn-activity-row";
                    row.innerHTML = `
                        <span class="pn-activity-icon"><i class="bi ${icon}"></i></span>
                        <div class="pn-activity-body">
                            <div>
                                <span class="pn-avatar pn-avatar-xs"
                                      style="background:${PN_colorFromString(a.actorName)}">
                                    ${PN_initials(a.actorName || "?")}
                                </span>
                                <strong>${PN_escapeHtml(a.actorName || "someone")}</strong>
                                ${PN_escapeHtml(a.message || "did something")}
                            </div>
                            <small class="text-muted">${a.createdAt ? PN_escapeHtml(PN_fmtDate(a.createdAt)) : ""}</small>
                        </div>`;
                    list.appendChild(row);
                });
            }, (e) => {
                list.innerHTML = `<div class="alert alert-warning m-3">${PN_escapeHtml(e.message)}</div>`;
            });

        return unsub;
    };

    function _iconForActivity(type) {
        if (!type) return "bi-circle";
        if (type.startsWith("project.create"))  return "bi-folder-plus";
        if (type.startsWith("project.delete"))  return "bi-folder-x";
        if (type.startsWith("project.share"))   return "bi-share";
        if (type.startsWith("project.update"))  return "bi-pencil-square";
        if (type.startsWith("note"))            return "bi-sticky";
        if (type.startsWith("group"))           return "bi-columns";
        return "bi-circle";
    }

})();
