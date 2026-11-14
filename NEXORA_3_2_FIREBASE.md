# NEXORA 3.2 — Firebase integration

Status: incremental migration. Do not deploy new Firestore rules until they have been reconciled with the current production rules and tested in Firebase Emulator. The repository did not contain `firestore.rules` or `firestore.indexes.json` at the start of this migration. A candidate `firestore.rules` file has since been added. It is **NOT deployed or emulator-tested**.

## Current Firestore document paths (verified in source)

- `users/{uid}`: profile (name, bio, avatarUrl, bannerUrl, website, role, verification, pinnedPostId, createdAt).
- `posts/{postId}`: uid, text, optional imageUrl, createdAt.
- `posts/{postId}/comments/{commentId}`: uid, text, createdAt.
- `users/{uid}/likes/{postId}`: createdAt.
- `users/{uid}/saved/{postId}`: postId, createdAt.
- `users/{uid}/notifications/{id}`: notification records with read status.
- `users/{uid}/followers/{followerUid}` and `users/{uid}/following/{targetUid}`: relationships.
- `chats/{chatId}`: participants (sorted two-UID array), updatedAt, lastText.
- `chats/{chatId}/messages/{messageId}`: senderId, type, text, sticker, createdAt, optional replyTo/replyText/readAt.
- `chats/{chatId}/typing/{uid}`: typing, updatedAt.
- `presence/{uid}`: uid, lastSeen.
- `verificationRequests/{uid}`: uid, type, reason, status, createdAt.
- `reports/{id}`: reporterId, kind, targetId, reason, status, createdAt.
- `auditLogs/{id}`: actorId, action, targetId, details, createdAt.

## Indexes

`firestore.indexes.json` contains no custom composite indexes because the currently inspected queries rely on single-field indexes: posts ordered by createdAt, messages ordered by createdAt, chats filtered by participants array-contains, comments ordered by createdAt. Firestore creates single-field indexes automatically unless explicitly exempted. New combined where/orderBy queries may require composite indexes later.

## Security requirements for production rules

1. Owner/moderator privileges MUST be checked by Firestore rules or trusted backend, never by hidden buttons or client-side checks alone.
2. A user may edit their own profile fields, but must NOT be able to assign or change `role` or `verification`.
3. Message creation must verify that the sender is authenticated and belongs to the chat's immutable participants; read receipts must be writable only by the recipient, and other message fields immutable.
4. Only chat participants may read chat documents, messages and typing indicators. Typing writes must be restricted to the writer's own UID.
5. Report status, verification request status, and audit records must not be writable by ordinary users.
6. Validate lengths, types, ownership, and permitted fields on every write.
7. Rate limiting, moderation at scale, media uploads and reliable online presence need a trusted backend / Cloud Functions. Client-side checks are not sufficient.

## Deployment

1. Export the **existing production Firestore rules** from Firebase Console and compare them against all application paths above. Do not replace them with permissive wildcard rules.
2. Test registration, login, feed, likes, comments, follows, messages, read receipts, verification applications and owner moderation in the Firebase Emulator Suite.
3. Deploy reviewed rules. The index file is a baseline only and should not be treated as a replacement for any existing custom composite indexes in the Firebase project.

## 3.2 change log

- Chat direct-link fallback: if the global user directory fails to load, an authenticated user can still attempt to open the requested conversation via `chats.html?user=<uid>`.
- Existing realtime messages, read receipts, typing, presence, stickers, replies, pins, saved posts, reporting and verification UI were already present in the inspected repository; these are **not newly implemented** by this change.
- Full 3.2 functionality and security migration are not yet complete. Do not advertise this as a production-ready release.

## Security review after candidate rules

- Candidate rules are in `firestore.rules`. Do **not** deploy them without Firebase Emulator testing and comparison with production rules.
- Message reactions using `reactions` maps of arrays are intentionally blocked by the candidate rules; the existing chat reaction button will fail until migrated to per-user reaction documents or a trusted backend.
- Client-side notification creation remains denied. Implement notifications through a trusted backend.
- Existing saved-post writes were aligned with the production rules (only `createdAt`).
- Composite indexes are not necessary for the inspected basic queries, but preserve any existing production custom indexes.
- Firebase Storage rules, media upload pipeline, and anti-spam server enforcement have not been implemented or tested.
- Owner permissions rely on the existing owner UID and `users/{ownerUid}.role == 'owner'`. Do not change the owner profile without a recovery plan.

## 3.2 chat reaction migration (new)

- The client now writes one reaction per user and message at `chats/{chatId}/reactions/{messageId}_{uid}` with `uid`, `messageId`, `emoji`, `createdAt`.
- The new `firestore.rules` permits only chat participants to read these reactions, and only the authenticated user to create, change, or delete their own reaction. Reaction emoji are restricted to the six built-in options.
- The chat client subscribes to the reactions collection in realtime and unsubscribes on chat change.
- Existing legacy `messages/{messageId}.reactions` maps are not migrated and will no longer display; migrate legacy data separately if retention is required.
- Important: these rules have NOT been validated in Firebase Emulator, and the migration has NOT been deployed to Firebase. Do not claim production completion.

## 3.2 timestamp and chat ID hardening

- Newly created posts, comments and messages require Firestore server timestamps (`createdAt == request.time`).
- New chat documents require a canonical ID: lexicographically sorted participant UIDs joined by `_`, with `updatedAt == request.time`.
- The current `chats.html` client uses the same sorted UID scheme and server timestamps.
- These checks are only a source-level review. Firebase Emulator and two-account integration tests are still required before deploying.

## Local Firestore security tests

Run on a computer with Node.js and Java installed:

```bash
npm install
npm run test:rules
```

The test command starts a local Firestore emulator and runs `tests/firestore.rules.test.mjs`. It does **not** deploy to the live Firebase project. Tests cover self-escalation, owner role changes, post authorship, private chat access, per-user reactions, chat IDs, and notifications. The tests have been committed but **not executed** in this environment. Review test failures before deploying.

## Cloud Functions notification backend (new, not deployed)

- `functions/index.js` implements Firestore on-create triggers for post comments, chat messages, and new followers.
- Functions derive the notification recipient from trusted Firestore documents rather than client-supplied recipient IDs. Self-notifications are skipped. Notification IDs are deterministic to prevent duplicate delivery on event retries.
- The browser's existing notification panel reads `users/{uid}/notifications`; client creation remains forbidden by Firestore Rules. The backend uses the Admin SDK.
- Deploying Cloud Functions requires a Firebase project with billing enabled (Blaze plan) and the appropriate IAM permissions. **Do not enable billing or deploy without the project owner's approval.**
- When ready to deploy, install dependencies in `functions/` and use the Firebase CLI with the correct project selected. Run the Firestore emulator tests first. Existing deployed functions must be reviewed to avoid replacing or unintentionally removing them.
- This does not yet include rate limiting, content moderation, Firebase Storage policies, or an end-to-end test. These features must not be represented as finished.

## Client anti-flood controls (3.2)

- `app.js`: 12-second cooldown between successful post submissions and 4-second cooldown between successful comment submissions.
- `chats.html`: 900-millisecond cooldown between successful chat message submissions, including stickers.
- `index.html`: cache-busting query parameters updated for `app.js` and `nexora21.js`.
- **Security limitation:** all cooldowns above run in the browser. They are usability measures, not enforceable anti-spam controls. Attackers can bypass them with the Firestore SDK or REST API. Production abuse mitigation needs server-side throttling, App Check, monitoring, and moderation workflows; none is deployed yet.

## Additional 3.2 chat and notification fixes

- New conversations are now created with `ensureChat(uid)` before the client attaches message and reaction listeners. This avoids Firestore permission-denied errors when the chat document does not yet exist. Opening a new conversation now creates an empty chat document.
- `functions/index.js` includes an `onNewLike` trigger in addition to comments, messages, and followers. Like notifications are derived from the existing post owner and the like document's user path; self-notifications are skipped.
- Emulator tests cover creation of a fresh chat, authorized and unauthorized reaction reads, and recipient-only read receipts.
- **Deployment status remains unchanged:** Cloud Functions and Firestore Rules are committed but not deployed or emulator-tested in this environment. The local runtime could not reach the npm registry to install the Firebase CLI or emulator dependencies.

## Timestamp integrity hardening

- Firestore Rules now require `createdAt == request.time` on new likes, saved posts, followers, following, verification requests and reports.
- Presence updates require `lastSeen == request.time`, and typing updates require `updatedAt == request.time`.
- These checks match the currently inspected client calls using `serverTimestamp()`. The local security tests include forged historical timestamps and valid server timestamps.
- **Tests still require actual execution in the Firebase Emulator.** Do not deploy these rules without testing existing workflows and checking legacy data compatibility.

## Moderation inbox alerts

- New report documents trigger `onNewReport`: the fixed owner UID receives a notification referring to the report document ID. The report reason and target ID are not interpolated into privileged Firestore document paths.
- New verification request documents trigger `onNewVerificationRequest`: the owner receives a notification referring to the applicant UID.
- Both handlers ignore non-pending records, suppress self-notifications, and use deterministic notification IDs to avoid duplicate alerts on event retries.
- Firebase Rules regression tests now cover report creation/review permissions, verification review permissions, owner-only audit logs, and the prohibition on client-created moderation alerts.
- All Cloud Functions remain **committed but not deployed**. Rules tests remain **unexecuted** until dependencies and a Firebase emulator are available.

## Missing private chat reads (security review)

- The chat client calls `getDoc(chats/{id})` before creating a new conversation. The earlier `allow get,list` rule required `resource.data.participants` even when the document did not exist, potentially causing a permission-denied error on first contact.
- The revised `allow get` supports authenticated existence checks for **missing** chat IDs that include the caller's UID in the expected participant position. For **existing** chats, the rule still requires actual membership in `participants`.
- `allow list` continues to restrict listing to chat members; the client queries using `where('participants','array-contains',uid)`.
- New test cases assert a missing-chat probe succeeds without exposing existing chats to outsiders. These tests remain unexecuted until Firebase Emulator dependencies are installed.

## Atomic chat initialization and CI

- `chats.html` now creates missing chats using `runTransaction` rather than a non-atomic `getDoc` / `setDoc` pair. This prevents a second client from resetting the latest message preview while a chat is being opened.
- The emulator test project is explicitly set to `nexora-rules-test`, avoiding accidental use of a live Firebase project.
- `.github/workflows/firestore-rules.yml` runs security rules tests on relevant pushes and pull requests with Node.js 22 and Java 21. GitHub Actions must be enabled and dependencies downloadable for the workflow to run.
- **A workflow file being committed does not mean the tests passed.** Check the GitHub Actions job results and resolve failures before deploying.
