/* =====================================================================
 *  auth.js
 *  ---------------------------------------------------------------------
 *  Authentication & user-record helpers.
 *
 *  Public API (all exposed as window.PN_*):
 *    PN_register(username, password)
 *    PN_login(username, password)
 *    PN_logout()
 *    PN_currentUserDoc()           -> latest cached user document
 *    PN_onAuthReady(cb)            -> cb(userDoc | null)
 *    PN_findUserByUsername(uname)
 *    PN_seedDefaultOwner()         -> ensures suzy/Suzy123$ exists
 *    PN_requireRole(role)          -> hard-redirect if mismatch
 * ===================================================================== */

(function () {

    /* ---------------- internal cache ---------------- */
    let _currentUserDoc  = null;       // latest /users/{uid} document
    const _readyHandlers = [];         // queued onAuthReady callbacks
    let   _firstResolved = false;      // have we resolved auth state yet?

    /* ============================================================
     * Default owner seeding
     * Creates the hard-coded "suzy" account if it doesn't yet exist.
     * Safe to call repeatedly – it short-circuits if already present.
     * ============================================================ */
    window.PN_seedDefaultOwner = async function () {
        const ownerUsername = "suzy";
        const ownerPassword = "Suzy123$";
        try {
            // Check the usernames index first – cheap read.
            const idxSnap = await PN_DB
                .collection("usernames").doc(ownerUsername).get();
            if (idxSnap.exists) return; // already seeded

            // Try to create the auth account.
            const email = PN_usernameToEmail(ownerUsername);
            try {
                const cred = await PN_AUTH.createUserWithEmailAndPassword(email, ownerPassword);
                await _writeNewUserDocs(cred.user.uid, ownerUsername, "owner");
                // Sign out so the seeding doesn't auto-login a fresh visitor.
                await PN_AUTH.signOut();
            } catch (e) {
                // Account already exists in Auth but not in Firestore – sign in to fix.
                if (e.code === "auth/email-already-in-use") {
                    const cred = await PN_AUTH.signInWithEmailAndPassword(email, ownerPassword);
                    await _writeNewUserDocs(cred.user.uid, ownerUsername, "owner");
                    await PN_AUTH.signOut();
                } else {
                    console.warn("Owner seed skipped:", e.message);
                }
            }
        } catch (e) {
            console.warn("Owner seed failed:", e.message);
        }
    };

    /* ============================================================
     * Register a new user
     * ============================================================ */
    window.PN_register = async function (username, password) {
        username = String(username || "").trim().toLowerCase();
        if (!/^[a-z0-9_.-]{3,32}$/.test(username))
            throw new Error("Username must be 3-32 characters: letters, numbers, . _ -");
        if (!password || password.length < 4)
            throw new Error("Password must be at least 4 characters");

        // Username uniqueness check via the /usernames index.
        const idxRef  = PN_DB.collection("usernames").doc(username);
        const idxSnap = await idxRef.get();
        if (idxSnap.exists) {
            throw new Error("Username already exists. Please choose another.");
        }

        // Create the auth account.
        const email = PN_usernameToEmail(username);
        const cred  = await PN_AUTH.createUserWithEmailAndPassword(email, password);
        await _writeNewUserDocs(cred.user.uid, username, "editor");

        return cred.user;
    };

    /* ============================================================
     * Log in (username + password)
     * ============================================================ */
    window.PN_login = async function (username, password) {
        username = String(username || "").trim().toLowerCase();
        if (!username) throw new Error("Please enter your username");
        if (!password) throw new Error("Please enter your password");

        const email = PN_usernameToEmail(username);
        try {
            const cred = await PN_AUTH.signInWithEmailAndPassword(email, password);
            return cred.user;
        } catch (e) {
            if (e.code === "auth/user-not-found" ||
                e.code === "auth/wrong-password"  ||
                e.code === "auth/invalid-credential" ||
                e.code === "auth/invalid-login-credentials") {
                throw new Error("Invalid username or password");
            }
            throw e;
        }
    };

    /* ============================================================
     * Log out
     * ============================================================ */
    window.PN_logout = async function () {
        await PN_AUTH.signOut();
        _currentUserDoc = null;
    };

    /* ============================================================
     * Cached current user document accessor
     * ============================================================ */
    window.PN_currentUserDoc = function () { return _currentUserDoc; };

    /* ============================================================
     * onAuthReady – fires once we know whether the visitor is
     * signed in.  Called with the /users/{uid} doc (or null).
     * ============================================================ */
    window.PN_onAuthReady = function (cb) {
        if (typeof cb !== "function") return;
        if (_firstResolved) cb(_currentUserDoc);
        else _readyHandlers.push(cb);
    };

    /* ============================================================
     * Look up another user by their username (used when sharing)
     * ============================================================ */
    window.PN_findUserByUsername = async function (uname) {
        uname = String(uname || "").trim().toLowerCase();
        if (!uname) return null;
        const snap = await PN_DB.collection("usernames").doc(uname).get();
        if (!snap.exists) return null;
        const { uid } = snap.data();
        const userSnap = await PN_DB.collection("users").doc(uid).get();
        if (!userSnap.exists) return null;
        return Object.assign({ uid }, userSnap.data());
    };

    /* ============================================================
     * Hard-redirect helper – use on protected pages only
     * ============================================================ */
    window.PN_requireRole = function (allowed) {
        if (!_currentUserDoc) {
            location.href = "login.html";
            return false;
        }
        if (allowed && allowed.length && !allowed.includes(_currentUserDoc.role)) {
            PN_toast("You don't have permission for that.", "error");
            return false;
        }
        return true;
    };

    /* ============================================================
     * Internal: bootstrap auth state listener
     * ============================================================ */
    PN_AUTH.onAuthStateChanged(async (firebaseUser) => {
        try {
            if (firebaseUser) {
                const ref  = PN_DB.collection("users").doc(firebaseUser.uid);
                const snap = await ref.get();
                if (snap.exists) {
                    _currentUserDoc = Object.assign(
                        { uid: firebaseUser.uid }, snap.data()
                    );
                    // Touch lastLoginAt asynchronously (non-blocking)
                    ref.update({ lastLoginAt: PN_TS() }).catch(() => {});
                } else {
                    _currentUserDoc = null;
                }
            } else {
                _currentUserDoc = null;
            }
        } catch (e) {
            console.error("Auth state error:", e);
            _currentUserDoc = null;
        } finally {
            _firstResolved = true;
            const handlers = _readyHandlers.splice(0);
            handlers.forEach(h => { try { h(_currentUserDoc); } catch (e) { console.error(e); } });
        }
    });

    /* ============================================================
     * Internal: create /users/{uid} + /usernames/{username}
     * ============================================================ */
    async function _writeNewUserDocs(uid, username, role) {
        const batch = PN_DB.batch();
        batch.set(PN_DB.collection("users").doc(uid), {
            username:    username,
            role:        role,
            createdAt:   PN_TS(),
            lastLoginAt: PN_TS(),
            disabled:    false,
            favorites:   [],
            recent:      []
        });
        batch.set(PN_DB.collection("usernames").doc(username), {
            uid:       uid,
            createdAt: PN_TS()
        });
        await batch.commit();
    }

})();
