/* =====================================================================
 *  project.js
 *  ---------------------------------------------------------------------
 *  CRUD + listing + favorites + archive for /projects.
 *
 *  Public API (window.PN_*):
 *    PN_subscribeProjects(user, cb)      live, accessible projects
 *    PN_subscribeProject(id, cb)         live, single project
 *    PN_createProject(data, user)
 *    PN_updateProject(id, patch)
 *    PN_deleteProject(id)
 *    PN_toggleArchiveProject(id, archived)
 *    PN_toggleFavorite(user, projectId)
 *    PN_pushRecent(user, projectId)
 *    PN_logActivity(...)
 * ===================================================================== */

(function () {

    /* ============================================================
     * Build the live "projects accessible by this user" subscription.
     *
     * Strategy: we create up to 3 listeners (own, shared-via-shares,
     * everything-as-owner) and merge them client-side.  For very
     * large workspaces a Cloud Function would do this server-side,
     * but for this app the volume is small enough.
     * ============================================================ */
    window.PN_subscribeProjects = function (user, cb) {
        if (!user) { cb([]); return () => {}; }

        const merged = new Map();   // id -> project
        const sharedMap = new Map();// projectId -> share doc (for current user)
        const unsubs = [];

        function emit() {
            const arr = Array.from(merged.values()).map(p => {
                // Decorate with current user's perm
                const share = sharedMap.get(p.id);
                p._share = share || null;
                p._isFavorite = (user.favorites || []).includes(p.id);
                p._perm = PN_permissionFor(p, user, share);
                return p;
            }).filter(p => p._perm !== "none");
            // Sort: pinned/recent first, then updatedAt desc
            arr.sort((a, b) => {
                const aFav = a._isFavorite ? 1 : 0;
                const bFav = b._isFavorite ? 1 : 0;
                if (aFav !== bFav) return bFav - aFav;
                const at = a.updatedAt ? a.updatedAt.toMillis() : 0;
                const bt = b.updatedAt ? b.updatedAt.toMillis() : 0;
                return bt - at;
            });
            cb(arr);
        }

        /* --- 1. Projects I own --- */
        unsubs.push(
            PN_DB.collection("projects")
                .where("ownerId", "==", user.uid)
                .onSnapshot((snap) => {
                    snap.docChanges().forEach(ch => {
                        if (ch.type === "removed") merged.delete(ch.doc.id);
                        else merged.set(ch.doc.id, Object.assign({ id: ch.doc.id }, ch.doc.data()));
                    });
                    emit();
                }, (e) => console.warn("own projects listener:", e))
        );

        /* --- 2. Shares granted to me --- */
        unsubs.push(
            PN_DB.collection("shares")
                .where("targetUid", "==", user.uid)
                .onSnapshot(async (snap) => {
                    const tasks = [];
                    snap.docChanges().forEach(ch => {
                        const data = ch.doc.data();
                        const pid  = data.projectId;
                        if (ch.type === "removed") {
                            sharedMap.delete(pid);
                            // Only remove the project if we don't also own it
                            const existing = merged.get(pid);
                            if (existing && existing.ownerId !== user.uid) merged.delete(pid);
                        } else {
                            sharedMap.set(pid, Object.assign({ id: ch.doc.id }, data));
                            // Hydrate the project document if not already loaded
                            if (!merged.has(pid)) {
                                tasks.push(
                                    PN_DB.collection("projects").doc(pid).get().then(d => {
                                        if (d.exists) merged.set(pid, Object.assign({ id: pid }, d.data()));
                                    }).catch(() => {})
                                );
                            }
                        }
                    });
                    await Promise.all(tasks);
                    emit();
                }, (e) => console.warn("shares listener:", e))
        );

        /* --- 3. If global owner, also list every project --- */
        if (user.role === "owner") {
            unsubs.push(
                PN_DB.collection("projects")
                    .onSnapshot((snap) => {
                        snap.docChanges().forEach(ch => {
                            if (ch.type === "removed") merged.delete(ch.doc.id);
                            else merged.set(ch.doc.id, Object.assign({ id: ch.doc.id }, ch.doc.data()));
                        });
                        emit();
                    }, (e) => console.warn("all projects listener:", e))
            );
        }

        return () => unsubs.forEach(u => { try { u(); } catch (e) {} });
    };

    /* ============================================================
     * Live single-project subscription
     * ============================================================ */
    window.PN_subscribeProject = function (id, cb) {
        return PN_DB.collection("projects").doc(id).onSnapshot((snap) => {
            if (!snap.exists) cb(null);
            else cb(Object.assign({ id: snap.id }, snap.data()));
        });
    };

    /* ============================================================
     * Create
     * ============================================================ */
    window.PN_createProject = async function (data, user) {
        if (!user) throw new Error("Not authenticated");
        if (user.role === "viewer") throw new Error("Viewers cannot create projects");

        const ref = PN_DB.collection("projects").doc();
        const payload = {
            name:          String(data.name || "Untitled").substring(0, 100),
            description:   String(data.description || "").substring(0, 500),
            visibility:    data.visibility === "shared" ? "shared" : "private",
            ownerId:       user.uid,
            ownerUsername: user.username,
            archived:      false,
            createdAt:     PN_TS(),
            updatedAt:     PN_TS()
        };
        await ref.set(payload);
        await PN_logActivity({
            type: "project.create",
            projectId: ref.id,
            user, message: `created project "${payload.name}"`
        });
        return ref.id;
    };

    /* ============================================================
     * Update
     * ============================================================ */
    window.PN_updateProject = async function (id, patch) {
        const allowed = ["name", "description", "visibility", "archived"];
        const clean   = {};
        Object.keys(patch || {}).forEach(k => {
            if (allowed.includes(k)) clean[k] = patch[k];
        });
        clean.updatedAt = PN_TS();
        await PN_DB.collection("projects").doc(id).update(clean);
        const u = PN_currentUserDoc();
        if (u) await PN_logActivity({ type: "project.update", projectId: id, user: u, message: "updated project" });
    };

    /* ============================================================
     * Delete (cascading)
     * ============================================================ */
    window.PN_deleteProject = async function (id) {
        const groupsSnap = await PN_DB.collection("groups")
            .where("projectId", "==", id).get();
        const notesSnap  = await PN_DB.collection("notes")
            .where("projectId", "==", id).get();
        const sharesSnap = await PN_DB.collection("shares")
            .where("projectId", "==", id).get();

        // Delete attachments from Storage if any.
        const delTasks = [];
        notesSnap.forEach(d => {
            const att = d.data().attachments || [];
            att.forEach(a => {
                if (a.storagePath) {
                    delTasks.push(
                        PN_STORAGE.ref(a.storagePath).delete().catch(() => {})
                    );
                }
            });
        });
        await Promise.all(delTasks);

        // Batch-delete documents
        const allDocs = [...groupsSnap.docs, ...notesSnap.docs, ...sharesSnap.docs];
        // Firestore batches have a 500 op limit – chunk it.
        for (let i = 0; i < allDocs.length; i += 400) {
            const batch = PN_DB.batch();
            allDocs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
            await batch.commit();
        }
        await PN_DB.collection("projects").doc(id).delete();

        const u = PN_currentUserDoc();
        if (u) await PN_logActivity({ type: "project.delete", projectId: id, user: u, message: "deleted a project" });
    };

    /* ============================================================
     * Archive / restore
     * ============================================================ */
    window.PN_toggleArchiveProject = async function (id, archived) {
        await PN_DB.collection("projects").doc(id).update({
            archived: !!archived,
            updatedAt: PN_TS()
        });
    };

    /* ============================================================
     * Favorites (stored on the user document)
     * ============================================================ */
    window.PN_toggleFavorite = async function (user, projectId) {
        if (!user) return;
        const isFav = (user.favorites || []).includes(projectId);
        await PN_DB.collection("users").doc(user.uid).update({
            favorites: isFav ? PN_FV.arrayRemove(projectId) : PN_FV.arrayUnion(projectId)
        });
    };

    /* ============================================================
     * Track recently viewed projects (max 5)
     * ============================================================ */
    window.PN_pushRecent = async function (user, projectId) {
        if (!user) return;
        const ref  = PN_DB.collection("users").doc(user.uid);
        const cur  = (user.recent || []).filter(id => id !== projectId);
        cur.unshift(projectId);
        await ref.update({ recent: cur.slice(0, 5) });
    };

    /* ============================================================
     * Activity log helper
     * ============================================================ */
    window.PN_logActivity = async function ({ type, projectId, user, message, meta }) {
        if (!user) return;
        try {
            await PN_DB.collection("activity").add({
                type:      String(type || "generic"),
                projectId: projectId || null,
                actorUid:  user.uid,
                actorName: user.username,
                message:   String(message || ""),
                meta:      meta || null,
                createdAt: PN_TS()
            });
        } catch (e) {
            console.warn("activity log failed:", e.message);
        }
    };

})();
