# NEXORA 3.2 — Firebase integration

Status: incremental migration. Do not deploy new Firestore rules until they have been reconciled with the current production rules and tested in Firebase Emulator. The repository did not contain `firestore.rules` or `firestore.indexes.json` at the start of this migration.

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
