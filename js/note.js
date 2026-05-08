/* =====================================================================
 *  note.js
 *  ---------------------------------------------------------------------
 *  Group + Note CRUD, plus Firebase Storage attachments.
 *
 *  Public API (window.PN_*):
 *    PN_subscribeGroups(projectId, cb)
 *    PN_createGroup({projectId, title, color, order})
 *    PN_updateGroup(id, patch)
 *    PN_deleteGroup(id, projectId)
 *    PN_reorderGroups([{id,order}, ...])
 *
 *    PN_subscribeNotes(projectId, cb)
 *    PN_createNote(data)
 *    PN_updateNote(id, patch)
 *    PN_deleteNote(id, attachments?)
 *    PN_moveNote(id, groupId, order)
 *    PN_reorderNotesInGroup([{id,groupId,order}, ...])
 *
 *    PN_uploadAttachment(file, projectId, onProgress)
 *    PN_deleteAttachmentObject(att)
 * ===================================================================== */

(function () {

    const MAX_FILE_SIZE = 50 * 1024 * 1024;   // 50 MB

    /* ============================================================
     *                          GROUPS
     * ============================================================ */
    window.PN_subscribeGroups = function (projectId, cb) {
        return PN_DB.collection("groups")
            .where("projectId", "==", projectId)
            .onSnapshot((snap) => {
                const arr = [];
                snap.forEach(d => arr.push(Object.assign({ id: d.id }, d.data())));
                arr.sort((a, b) => (a.order || 0) - (b.order || 0));
                cb(arr);
            }, (e) => console.warn("groups listener:", e));
    };

    window.PN_createGroup = async function ({ projectId, title, color, order }) {
        const ref = PN_DB.collection("groups").doc();
        await ref.set({
            projectId: projectId,
            title:     String(title || "Untitled").substring(0, 80),
            color:     color || "#6366f1",
            order:     typeof order === "number" ? order : Date.now(),
            createdAt: PN_TS(),
            updatedAt: PN_TS()
        });
        await PN_DB.collection("projects").doc(projectId).update({ updatedAt: PN_TS() });
        return ref.id;
    };

    window.PN_updateGroup = async function (id, patch) {
        const allowed = ["title", "color", "order"];
        const clean   = {};
        Object.keys(patch || {}).forEach(k => { if (allowed.includes(k)) clean[k] = patch[k]; });
        clean.updatedAt = PN_TS();
        await PN_DB.collection("groups").doc(id).update(clean);
    };

    window.PN_deleteGroup = async function (id, projectId) {
        // Delete all notes inside the group first
        const noteSnap = await PN_DB.collection("notes")
            .where("groupId", "==", id).get();

        // Cleanup attachments
        const tasks = [];
        noteSnap.forEach(d => {
            (d.data().attachments || []).forEach(a => {
                if (a.storagePath) tasks.push(
                    PN_STORAGE.ref(a.storagePath).delete().catch(() => {})
                );
            });
        });
        await Promise.all(tasks);

        const batch = PN_DB.batch();
        noteSnap.forEach(d => batch.delete(d.ref));
        batch.delete(PN_DB.collection("groups").doc(id));
        await batch.commit();

        if (projectId) {
            await PN_DB.collection("projects").doc(projectId).update({ updatedAt: PN_TS() });
        }
    };

    window.PN_reorderGroups = async function (updates) {
        const batch = PN_DB.batch();
        updates.forEach(u => {
            batch.update(PN_DB.collection("groups").doc(u.id), {
                order:     u.order,
                updatedAt: PN_TS()
            });
        });
        await batch.commit();
    };


    /* ============================================================
     *                          NOTES
     * ============================================================ */
    window.PN_subscribeNotes = function (projectId, cb) {
        return PN_DB.collection("notes")
            .where("projectId", "==", projectId)
            .onSnapshot((snap) => {
                const arr = [];
                snap.forEach(d => arr.push(Object.assign({ id: d.id }, d.data())));
                arr.sort((a, b) => (a.order || 0) - (b.order || 0));
                cb(arr);
            }, (e) => console.warn("notes listener:", e));
    };

    window.PN_createNote = async function (data) {
        const ref = PN_DB.collection("notes").doc();
        const payload = _sanitizeNote(data);
        payload.createdAt = PN_TS();
        payload.updatedAt = PN_TS();
        payload.order     = typeof data.order === "number" ? data.order : Date.now();
        await ref.set(payload);
        await PN_DB.collection("projects").doc(payload.projectId).update({ updatedAt: PN_TS() });
        return ref.id;
    };

    window.PN_updateNote = async function (id, patch) {
        const clean = _sanitizeNote(patch, true);
        clean.updatedAt = PN_TS();
        await PN_DB.collection("notes").doc(id).update(clean);
    };

    window.PN_deleteNote = async function (id, attachments) {
        // Delete storage objects first
        if (attachments && attachments.length) {
            const tasks = attachments
                .filter(a => a.storagePath)
                .map(a => PN_STORAGE.ref(a.storagePath).delete().catch(() => {}));
            await Promise.all(tasks);
        }
        await PN_DB.collection("notes").doc(id).delete();
    };

    window.PN_moveNote = async function (id, groupId, order) {
        await PN_DB.collection("notes").doc(id).update({
            groupId:   groupId,
            order:     typeof order === "number" ? order : Date.now(),
            updatedAt: PN_TS()
        });
    };

    window.PN_reorderNotesInGroup = async function (updates) {
        // Chunked batch
        for (let i = 0; i < updates.length; i += 400) {
            const batch = PN_DB.batch();
            updates.slice(i, i + 400).forEach(u => {
                const data = { order: u.order, updatedAt: PN_TS() };
                if (u.groupId) data.groupId = u.groupId;
                batch.update(PN_DB.collection("notes").doc(u.id), data);
            });
            await batch.commit();
        }
    };

    /* ============================================================
     *                       ATTACHMENTS
     * ============================================================ */

    /**
     * Upload a file to Firebase Storage and return a metadata
     * object suitable for storing inside a note.attachments array.
     */
    window.PN_uploadAttachment = function (file, projectId, onProgress) {
        return new Promise((resolve, reject) => {
            if (!file) return reject(new Error("No file"));
            if (file.size > MAX_FILE_SIZE) {
                return reject(new Error("File exceeds 50 MB limit: " + file.name));
            }

            const safeName = file.name.replace(/[^\w.\-]+/g, "_");
            const path = `projects/${projectId}/${Date.now()}_${PN_uid("a")}_${safeName}`;
            const ref  = PN_STORAGE.ref(path);
            const task = ref.put(file, { contentType: file.type || "application/octet-stream" });

            task.on(
                "state_changed",
                (s) => {
                    if (typeof onProgress === "function" && s.totalBytes) {
                        onProgress(Math.round((s.bytesTransferred / s.totalBytes) * 100));
                    }
                },
                (err) => reject(err),
                async () => {
                    try {
                        const url = await task.snapshot.ref.getDownloadURL();
                        resolve({
                            id:           PN_uid("att"),
                            name:         file.name,
                            size:         file.size,
                            mime:         file.type || "",
                            type:         PN_detectMediaType(file.name),
                            url:          url,
                            storagePath:  path,
                            uploadedAt:   Date.now()
                        });
                    } catch (e) { reject(e); }
                }
            );
        });
    };

    window.PN_deleteAttachmentObject = function (att) {
        if (!att || !att.storagePath) return Promise.resolve();
        return PN_STORAGE.ref(att.storagePath).delete().catch(() => {});
    };

    /* ============================================================
     * Internal sanitiser
     * ============================================================ */
    function _sanitizeNote(data, isPatch) {
        const o = {};
        const map = {
            projectId:   "string",
            groupId:     "string",
            title:       "string",
            description: "string",
            status:      "string",
            assignee:    "string",
            link:        "string",
            tags:        "array",
            attachments: "array",
            order:       "number",
            dueAt:       "any"          // datetime string or null
        };
        Object.keys(map).forEach(k => {
            if (!(k in (data || {}))) return;
            const t = map[k];
            const v = data[k];
            if (t === "array")       o[k] = Array.isArray(v) ? v : [];
            else if (t === "number") o[k] = Number(v) || 0;
            else if (t === "string") o[k] = String(v || "").substring(0, k === "description" ? 4000 : 500);
            else                     o[k] = v;
        });
        // Defaults for new notes only
        if (!isPatch) {
            o.title       = o.title       || "Untitled";
            o.description = o.description || "";
            o.status      = o.status      || "todo";
            o.attachments = o.attachments || [];
            o.tags        = o.tags        || [];
        }
        return o;
    }

})();
