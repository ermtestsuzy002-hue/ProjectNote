/* =====================================================================
 *  share.js
 *  ---------------------------------------------------------------------
 *  Project sharing (collaborator management).
 *
 *  Public API:
 *    PN_subscribeShares(projectId, cb)
 *    PN_addShare(projectId, username, permission)
 *    PN_updateSharePermission(shareId, permission)
 *    PN_removeShare(shareId)
 * ===================================================================== */

(function () {

    /* ============================================================
     * Live list of collaborators on a single project
     * ============================================================ */
    window.PN_subscribeShares = function (projectId, cb) {
        return PN_DB.collection("shares")
            .where("projectId", "==", projectId)
            .onSnapshot((snap) => {
                const arr = [];
                snap.forEach(d => arr.push(Object.assign({ id: d.id }, d.data())));
                arr.sort((a, b) => {
                    const at = a.createdAt ? a.createdAt.toMillis() : 0;
                    const bt = b.createdAt ? b.createdAt.toMillis() : 0;
                    return at - bt;
                });
                cb(arr);
            }, (e) => console.warn("shares listener:", e));
    };

    /* ============================================================
     * Add a collaborator by username
     * ============================================================ */
    window.PN_addShare = async function (projectId, username, permission) {
        username = String(username || "").trim().toLowerCase();
        if (!username) throw new Error("Please enter a username");
        if (!["view", "edit"].includes(permission)) permission = "view";

        // Resolve user
        const target = await PN_findUserByUsername(username);
        if (!target) throw new Error(`No user found with username "${username}".`);
        const me = PN_currentUserDoc();
        if (target.uid === (me && me.uid)) {
            throw new Error("You can't share a project with yourself.");
        }

        // Avoid duplicate share docs
        const dup = await PN_DB.collection("shares")
            .where("projectId", "==", projectId)
            .where("targetUid", "==", target.uid)
            .limit(1).get();
        if (!dup.empty) {
            await dup.docs[0].ref.update({
                permission: permission,
                updatedAt:  PN_TS()
            });
            return;
        }

        // Create the share
        await PN_DB.collection("shares").add({
            projectId:  projectId,
            targetUid:  target.uid,
            targetUsername: target.username,
            permission: permission,
            createdAt:  PN_TS(),
            updatedAt:  PN_TS()
        });

        // Make sure the project is marked "shared"
        await PN_DB.collection("projects").doc(projectId).update({
            visibility: "shared",
            updatedAt:  PN_TS()
        });

        if (me) {
            await PN_logActivity({
                type: "project.share",
                projectId: projectId,
                user: me,
                message: `shared with ${target.username} (${permission})`
            });
        }
    };

    /* ============================================================
     * Update an existing share's permission level
     * ============================================================ */
    window.PN_updateSharePermission = async function (shareId, permission) {
        if (!["view", "edit"].includes(permission)) permission = "view";
        await PN_DB.collection("shares").doc(shareId).update({
            permission: permission,
            updatedAt:  PN_TS()
        });
    };

    /* ============================================================
     * Revoke access
     * ============================================================ */
    window.PN_removeShare = async function (shareId) {
        await PN_DB.collection("shares").doc(shareId).delete();
    };

})();
