/* =====================================================================
 *  firebase.js
 *  ---------------------------------------------------------------------
 *  Firebase initialisation and global service handles.
 *
 *  How to configure:
 *  -----------------
 *  1.  Open the Firebase console -> Project Settings -> "Your apps".
 *  2.  Register a Web App and copy the firebaseConfig snippet.
 *  3.  Paste the copied values below in `firebaseConfig`.
 *  4.  Enable the following services in the Firebase console:
 *        - Authentication  (Email/Password sign-in method)
 *        - Cloud Firestore (Native mode)
 *        - Storage         (default bucket)
 *
 *  Notes:
 *  ------
 *  We use the Firebase v9 *compat* SDK so we can keep using a familiar
 *  global `firebase.*` API across plain (non-module) script files.
 *  Every other script in /js depends on the globals exported here:
 *      window.PN_AUTH, window.PN_DB, window.PN_STORAGE
 * ===================================================================== */

/* ---------- 1. Paste your firebaseConfig below ---------- */
const firebaseConfig = {
    apiKey:            "REPLACE_WITH_YOUR_API_KEY",
    authDomain:        "REPLACE_WITH_YOUR_PROJECT.firebaseapp.com",
    projectId:         "REPLACE_WITH_YOUR_PROJECT_ID",
    storageBucket:     "REPLACE_WITH_YOUR_PROJECT.appspot.com",
    messagingSenderId: "REPLACE_WITH_YOUR_SENDER_ID",
    appId:             "REPLACE_WITH_YOUR_APP_ID"
};

/* ---------- 2. Initialise Firebase exactly once ---------- */
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

/* ---------- 3. Service handles, exported as globals ---------- */
window.PN_AUTH    = firebase.auth();
window.PN_DB      = firebase.firestore();
window.PN_STORAGE = firebase.storage();

/* ---------- 4. Useful helpers ---------- */
// Server timestamp shorthand – used everywhere we write to Firestore.
window.PN_TS = () => firebase.firestore.FieldValue.serverTimestamp();

// FieldValue helpers (arrayUnion / arrayRemove / increment / delete).
window.PN_FV = firebase.firestore.FieldValue;

/* ---------- 5. Persistence ---------- */
// Keep the user logged in across page reloads / browser restarts.
PN_AUTH.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((e) => {
    console.warn("Auth persistence could not be set:", e);
});

/* ---------- 6. Username  ->  synthetic email mapping ---------- *
 *  Firebase Authentication requires an email address, but the spec
 *  for this app is "username only". We therefore convert any username
 *  to a deterministic synthetic email of the form:
 *
 *        <username>@projectnote.local
 *
 *  Users never see this address.                                     */
window.PN_USERNAME_DOMAIN = "projectnote.local";
window.PN_usernameToEmail = (uname) =>
    String(uname).trim().toLowerCase() + "@" + window.PN_USERNAME_DOMAIN;
