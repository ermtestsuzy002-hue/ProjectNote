# Project Note

A modern, real-time, Kanban-style project & note management app built on **Firebase** (Auth + Firestore + Storage) and **Bootstrap 5**. Fully modular, framework-free vanilla JavaScript — no build step required.

![App: Project Note](https://img.shields.io/badge/app-Project%20Note-6366f1)
![Stack: Firebase v10](https://img.shields.io/badge/firebase-10.x-FFA000)
![UI: Bootstrap 5](https://img.shields.io/badge/bootstrap-5.x-7952B3)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

---

## ✨ Features

### Authentication & Roles
- Username + password login (no email required)
- Self-service registration with live username availability check
- Three roles with full permission separation: **Owner / Editor / Viewer**
- Hardcoded default owner (`suzy / Suzy123$`) — auto-seeded on first run
- Owner-only User Management screen (change roles, disable accounts, delete users)

### Projects
- Create / edit / archive / delete projects
- Two visibility modes: **Private** and **Shared**
- Real-time multi-user sync via Firestore listeners
- Favorite (star) and recently-viewed projects
- Share with any user by username with **View Only** or **Allow Edit** permission

### Kanban Board
- Bigger, easy-to-read note cards
- Drag-and-drop notes between groups (powered by SortableJS)
- Reorder columns (groups) up/down with sticky headers
- Multi-select notes + bulk delete
- Per-card: status, assignee, due date, tags, link, multiple file/image/video attachments
- Inline image cover preview, attachment chips with click-to-open
- Built-in viewer modal for images and videos; download for any other file type

### Attachments
- File / image / video / link support
- Upload to Firebase Storage with progress indication
- 50 MB per-file cap (enforced client-side and in storage rules)
- URL persisted in Firestore; storage path tracked for proper deletion cleanup

### Export
- Per-project export as **CSV**, **JSON**, or **PDF**
- PDF includes grouped sections with status, assignee, due date, tags

### Other
- Activity log with audit trail (owner-only screen)
- Dark / Light theme toggle, persisted to `localStorage`
- Toast notifications (success / error / warning / info)
- Confirmation modal before destructive actions
- Loading overlay + empty states everywhere
- Mobile-responsive layout (collapsing sidebar, horizontal kanban scroll)

---

## 📁 Folder structure

```
project-note/
├── index.html                   # Main app shell (dashboard + project + users + activity)
├── login.html                   # Sign-in / register screen
│
├── css/
│   └── style.css                # Single stylesheet, light + dark theme
│
├── js/
│   ├── firebase.js              # Firebase init + helpers (PN_AUTH, PN_DB, PN_STORAGE)
│   ├── utils.js                 # Helpers: escape, format, color, permission resolver
│   ├── ui.js                    # Toast, spinner, confirm modal, theme toggle
│   ├── auth.js                  # Sign-in / register / seed default owner
│   ├── login.js                 # login.html form bindings
│   ├── project.js               # Project CRUD, shares, favorites, recent, activity
│   ├── note.js                  # Group + note CRUD, attachment uploads
│   ├── kanban.js                # Kanban board renderer + drag-and-drop
│   ├── share.js                 # Share modal logic
│   ├── export.js                # CSV / JSON / PDF export
│   ├── users.js                 # User management screen + activity log screen
│   └── app.js                   # Main controller (routing, view rendering, modals)
│
├── docs/
│   └── FIREBASE_SETUP.md        # Step-by-step Firebase setup instructions
│
├── firestore.rules              # Firestore security rules
├── storage.rules                # Storage security rules
├── sample-data.json             # Sample seed data for testing
└── README.md                    # This file
```

---

## 🚀 Quick start

### 1. Get the code

```bash
git clone <your-repo> project-note
cd project-note
```

### 2. Configure Firebase

Open `js/firebase.js` and replace the placeholder values inside `firebaseConfig` with the credentials from your Firebase web app (Settings → General → Your apps → SDK setup):

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

Detailed setup walkthrough: see [`docs/FIREBASE_SETUP.md`](docs/FIREBASE_SETUP.md).

### 3. Deploy security rules

```bash
firebase deploy --only firestore:rules,storage
```

Or paste them manually in the Firebase Console (Firestore → Rules / Storage → Rules).

### 4. Run locally

Any static-file server works:

```bash
# Python
python3 -m http.server 8000

# Node
npx serve

# Firebase Hosting (recommended)
firebase serve
```

Then open <http://localhost:8000/login.html> (or `firebase serve`'s URL).

### 5. Sign in

The first time `login.html` loads, the app auto-seeds the default owner account:

| Username | Password    | Role  |
|----------|-------------|-------|
| `suzy`   | `Suzy123$`  | owner |

Use it to sign in, then create new editors / viewers from the **User Management** screen, or have them register themselves (default role: editor).

### 6. Deploy

If you set up Firebase Hosting (recommended):

```bash
firebase deploy --only hosting
```

Otherwise, upload the entire `project-note/` folder to any static host (Vercel, Netlify, GitHub Pages, S3 + CloudFront, your own nginx).

---

## 🗄️ Database schema

All collections live under your default Firestore database.

### `/users/{uid}`
```js
{
  username: "suzy",                 // string, unique, lowercase
  role: "owner" | "editor" | "viewer",
  disabled: false,                  // owner can disable accounts
  favorites: ["projectId1", ...],   // starred projects
  recent:    ["projectId1", ...],   // most recent first, max 5
  createdAt: <timestamp>,
  lastLoginAt: <timestamp>
}
```

### `/usernames/{username}`
Lightweight uniqueness index used by registration.
```js
{ uid: "<uid>", createdAt: <timestamp> }
```

### `/projects/{pid}`
```js
{
  name: "Q1 Roadmap",
  description: "...",
  visibility: "private" | "shared",
  ownerId: "<uid>",
  ownerUsername: "suzy",
  archived: false,
  createdAt: <timestamp>,
  updatedAt: <timestamp>
}
```

### `/groups/{gid}`
A Kanban column belonging to a project.
```js
{
  projectId: "<pid>",
  title: "In Progress",
  color: "#6366f1",
  order: 1000,                      // sort key, multiples of 1000
  createdAt: <timestamp>,
  updatedAt: <timestamp>
}
```

### `/notes/{nid}`
A single Kanban card.
```js
{
  projectId: "<pid>",
  groupId: "<gid>",
  title: "Design landing page",
  description: "Multi-line text…",
  status: "todo" | "in-progress" | "review" | "done" | "blocked",
  assignee: "alice",                // username (string)
  tags: ["design", "marketing"],
  link: "https://…",
  dueAt: <timestamp> | null,
  attachments: [
    {
      id: "att_…",
      name: "spec.pdf",
      size: 12345,
      mime: "application/pdf",
      type: "image" | "video" | "file",
      url: "https://firebasestorage…",
      storagePath: "projects/<pid>/<file>",
      uploadedAt: <epoch ms>
    }
  ],
  order: 1000,
  createdAt: <timestamp>,
  updatedAt: <timestamp>
}
```

### `/shares/{sid}`
Doc id format: `<projectId>_<targetUid>` (so rules can do an `exists()` lookup).
```js
{
  projectId: "<pid>",
  targetUid: "<uid>",
  targetUsername: "alice",
  permission: "view" | "edit",
  createdAt: <timestamp>,
  updatedAt: <timestamp>
}
```

### `/activity/{aid}`
Append-only audit trail.
```js
{
  type: "project.create" | "project.delete" | "note.create" | …,
  projectId: "<pid>" | "",
  actorUid: "<uid>",
  actorName: "suzy",
  message: "Created project 'Q1 Roadmap'",
  meta: { … },
  createdAt: <timestamp>
}
```

---

## 🔐 Security model

| Action                        | Owner | Project owner (Editor) | Shared (edit) | Shared (view) | Viewer / Other |
|-------------------------------|-------|------------------------|---------------|---------------|----------------|
| List all projects             | ✓     | own only               | shared only   | shared only   | shared only    |
| Create project                | ✓     | ✓                      | —             | —             | ✗              |
| Edit project metadata         | ✓     | ✓                      | ✓             | ✗             | ✗              |
| Delete project                | ✓     | ✓                      | ✗             | ✗             | ✗              |
| Add / edit / delete groups    | ✓     | ✓                      | ✓             | ✗             | ✗              |
| Add / edit / delete notes     | ✓     | ✓                      | ✓             | ✗             | ✗              |
| Upload attachments            | ✓     | ✓                      | ✓             | ✗             | ✗              |
| Manage shares                 | ✓     | ✓                      | ✗             | ✗             | ✗              |
| User management screen        | ✓     | ✗                      | ✗             | ✗             | ✗              |
| View activity log (all)       | ✓     | ✗                      | ✗             | ✗             | ✗              |

These permissions are enforced **client-side** (`PN_permissionFor` in `js/utils.js`) and **server-side** (Firestore + Storage rules). Both layers must agree — never trust the client.

---

## 🧪 Sample data

`sample-data.json` contains a small seed set you can import for testing (3 users, 2 projects, a few groups and notes). Import via the Firebase Console or write a small Node script using the Admin SDK — see the comments at the top of the file.

---

## 🛠️ Tech stack

| Layer        | Choice                          | Why                              |
|--------------|---------------------------------|----------------------------------|
| Auth         | Firebase Authentication         | Managed, no backend needed       |
| Database     | Cloud Firestore                 | Real-time listeners out of box   |
| File storage | Firebase Storage                | Same auth domain, easy ACLs      |
| UI           | Bootstrap 5 + custom CSS vars   | Familiar, responsive grid + utils|
| Drag-drop    | SortableJS                      | Tiny, no deps, great UX          |
| PDF export   | jsPDF                           | Pure-browser, no server needed   |
| Fonts        | Plus Jakarta Sans + JetBrains Mono | Modern, readable, free        |

The app loads everything via CDN — there's **no build step**, **no bundler**, **no `npm install`** required.

---

## 🐛 Troubleshooting

**Nothing happens after I sign in.**
Make sure your Firestore rules are deployed and the `usernames` collection is publicly readable (required for registration username checks).

**"Permission denied" when creating a project.**
Your account's `role` is probably `viewer`. Have the owner promote you in **User Management**.

**Default owner doesn't appear.**
Make sure you visited `login.html` at least once *after* configuring Firebase. The seed runs in `PN_seedDefaultOwner()` and writes to `/users` and `/usernames`.

**Files won't upload.**
Check the Storage rules are deployed and Storage is enabled on your Firebase project. Also confirm the file is under 50 MB.

**Username already taken (but it shouldn't be).**
The username index is `/usernames/{lowercase_username}`. If a user was deleted but the index doc was left behind, an owner can delete it manually in the Firebase Console.

---

## 📝 License

MIT — use it however you like.
