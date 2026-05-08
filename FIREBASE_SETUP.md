# Firebase Setup Guide — Project Note

This document walks you through every Firebase service Project Note depends on. Plan on 10–15 minutes.

> **TL;DR**
> 1. Create a Firebase project
> 2. Enable Email/Password auth
> 3. Create a Firestore database (Native mode)
> 4. Create a Storage bucket
> 5. Paste your config into `js/firebase.js`
> 6. Deploy `firestore.rules` + `storage.rules`
> 7. Open `login.html` — the default owner (`suzy / Suzy123$`) auto-seeds.

---

## 1. Create a Firebase project

1. Visit <https://console.firebase.google.com/>
2. Click **Add project**, give it a name (e.g. `project-note-prod`)
3. Disable Google Analytics if you don't need it (recommended for simplicity)
4. Wait for provisioning to complete

## 2. Register a Web app

1. From the project dashboard, click the `</>` (Web) icon
2. Give the app a nickname (e.g. `Project Note Web`)
3. **Do NOT enable Hosting yet** — you can add it later
4. Click **Register app**
5. Copy the config object that appears — you'll paste it in step 6

It looks like this:

```js
const firebaseConfig = {
  apiKey: "AIzaSy…",
  authDomain: "project-note-prod.firebaseapp.com",
  projectId: "project-note-prod",
  storageBucket: "project-note-prod.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef…"
};
```

Click **Continue to console**.

## 3. Enable Email/Password authentication

Project Note uses synthetic emails (`<username>@projectnote.local`) so users only ever type a username, but Firebase Auth still needs the Email/Password provider enabled.

1. Sidebar → **Build → Authentication**
2. Click **Get started**
3. **Sign-in method** tab → **Email/Password** → **Enable** the first toggle (you can leave "Email link" off) → **Save**

## 4. Create the Firestore database

1. Sidebar → **Build → Firestore Database**
2. Click **Create database**
3. Choose **Start in production mode** (we'll set rules in step 7)
4. Pick a location close to your users (e.g. `us-central1`, `europe-west1`)
5. Click **Enable**

### 4a. (Optional) Composite indexes

Firestore will auto-suggest indexes the first time a query needs one. If you'd rather pre-create them:

| Collection | Fields                                  |
|------------|------------------------------------------|
| `projects` | `ownerId` ASC, `updatedAt` DESC         |
| `projects` | `archived` ASC, `updatedAt` DESC        |
| `shares`   | `targetUid` ASC, `projectId` ASC        |
| `groups`   | `projectId` ASC, `order` ASC            |
| `notes`    | `projectId` ASC, `order` ASC            |
| `notes`    | `groupId` ASC, `order` ASC              |
| `activity` | `createdAt` DESC                        |

You can also click the link Firebase shows in the browser console the first time a query fails with "missing index" — it auto-creates the right index.

## 5. Enable Cloud Storage

1. Sidebar → **Build → Storage**
2. Click **Get started**
3. Choose **Start in production mode**
4. Pick the same location you used for Firestore
5. Click **Done**

## 6. Wire up the config

Open `js/firebase.js` in your editor:

```js
var firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_AUTH_DOMAIN",
  projectId: "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket: "REPLACE_WITH_YOUR_STORAGE_BUCKET",
  messagingSenderId: "REPLACE_WITH_YOUR_SENDER_ID",
  appId: "REPLACE_WITH_YOUR_APP_ID"
};
```

Replace each `REPLACE_WITH_…` with the matching value from step 2. Save.

## 7. Deploy security rules

You have two options.

### Option A — Firebase CLI (recommended)

```bash
# Install once, globally
npm install -g firebase-tools

# Sign in
firebase login

# In the project-note folder:
firebase init
#  - "Configure files for Firestore?"  → yes
#  - "Configure files for Storage?"    → yes
#  - "Use existing project"            → yes, pick the one you created
#  - When asked about firestore.rules / storage.rules,
#    accept the defaults (or point them at the files in this repo).

# Deploy
firebase deploy --only firestore:rules,storage
```

### Option B — Console copy/paste

1. **Firestore Database → Rules** → paste contents of `firestore.rules` → **Publish**
2. **Storage → Rules** → paste contents of `storage.rules` → **Publish**

## 8. (Optional) Hosting

If you'd like Firebase to serve the app:

```bash
firebase init hosting
# - Use existing project
# - Public directory: . (the project root)
# - Configure as single-page app: NO
# - Set up GitHub deploys: optional

firebase deploy --only hosting
```

Your site will be live at `https://<project-id>.web.app`.

## 9. Sign in

Open the deployed URL (or `http://localhost:8000/login.html` if running locally). The first time `login.html` loads, the app automatically creates the default owner:

| Username | Password    |
|----------|-------------|
| `suzy`   | `Suzy123$`  |

Sign in. Promote / invite additional users from the **User Management** screen, or have them register themselves on the login page (default new-user role: `editor`).

---

## Common pitfalls

**"Missing or insufficient permissions" on Firestore reads**
Rules aren't deployed yet, or your `/users/{uid}` doc doesn't exist. Sign out, register fresh, and try again. Owner accounts are seeded by `PN_seedDefaultOwner()` on `login.html` load — if it didn't run, your config probably isn't valid yet.

**`auth/operation-not-allowed`**
Email/Password provider isn't enabled (step 3).

**`storage/unauthorized` on upload**
Storage rules aren't deployed, or your share doc has `permission: "view"` instead of `"edit"`.

**Default owner can't sign in**
Visit `login.html` once (any browser, no need to register) — that triggers the seed. Then refresh and use `suzy / Suzy123$`.

**CORS errors when fetching attachment URLs**
Firebase Storage download URLs (`?alt=media&token=…`) are publicly fetchable. If you see CORS issues, you're likely fetching a `gs://` path instead of an HTTPS URL — make sure you store `getDownloadURL()` results, not raw paths.

---

## Hardening (when you go to production)

- Restrict the API key in Google Cloud Console (Console → APIs & Services → Credentials → Browser key restrictions → HTTP referrers)
- Add an App Check provider (reCAPTCHA v3) for both Firestore and Storage
- Enable budget alerts in Google Cloud billing
- Periodically review the **Activity** screen for unusual events
- Rotate the default owner password (`suzy`) — this app intentionally seeds it but production deployments should change it ASAP, ideally by deleting `suzy` and creating a fresh owner with a strong password.
