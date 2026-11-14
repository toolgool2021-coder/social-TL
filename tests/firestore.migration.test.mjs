import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, writeBatch, query, where, serverTimestamp } from 'firebase/firestore';

const OWNER = 'FXtmMsn8JYfx04zpxiSaXZ0iHWg2';
const ALICE = 'alice_migration';
const BOB = 'bob_migration';
const OUTSIDER = 'outsider_migration';
const CID = `${ALICE}_${BOB}`;
const oldRules = readFileSync('docs/firebase/firestore-3.0.user-supplied.rules', 'utf8');
const newRules = readFileSync('firestore.rules', 'utf8');
const environments = {};
const clients = new Map();
const db = (version, uid) => {
  const key = `${version}:${uid}`;
  if (!clients.has(key)) clients.set(key, environments[version].authenticatedContext(uid).firestore());
  return clients.get(key);
};
const ref = (version, uid, ...path) => doc(db(version, uid), ...path);

before(async () => {
  for (const [version, rules] of [['old', oldRules], ['new', newRules]]) {
    const env = environments[version] = await initializeTestEnvironment({
      projectId: `demo-nexora-migration-${version}`, firestore: { rules }
    });
    await env.withSecurityRulesDisabled(async context => {
      const firestore = context.firestore();
      for (const [uid, role] of [[OWNER, 'owner'], [ALICE, 'user'], [BOB, 'user'], [OUTSIDER, 'user']]) {
        await setDoc(doc(firestore, 'users', uid), { name: 'Test profile', role });
      }
      await setDoc(doc(firestore, 'posts', 'existing'), { uid: ALICE, text: 'Existing post', createdAt: new Date() });
      await setDoc(doc(firestore, 'chats', CID), { participants: [ALICE, BOB], lastText: '', updatedAt: new Date() });
      await setDoc(doc(firestore, 'chats', CID, 'messages', 'existing'), {
        senderId: ALICE, type: 'text', text: 'Existing message', createdAt: new Date(),
        reactions: { '👍': [BOB] }
      });
      await setDoc(doc(firestore, 'chats', 'legacy-chat'), { participants: [BOB, ALICE], lastText: 'Legacy' });
      await setDoc(doc(firestore, 'users', ALICE, 'notifications', 'trusted'), { text: 'Server notification', read: false });
    });
  }
});

after(async () => { await Promise.all(Object.values(environments).map(env => env.cleanup())); });

test('candidate retains every supplied match path and adds only per-user reactions', () => {
  const paths = source => [...source.matchAll(/\bmatch\s+(\/[^\s]+)\s*\{/g)].map(match => match[1]).sort();
  assert.deepEqual(paths(newRules), [...paths(oldRules), '/reactions/{reactionId}'].sort());
});

for (const version of ['old', 'new']) {
  test(`${version}: existing account, social, chat and owner workflows remain authorized`, async () => {
    const stamp = () => ({ createdAt: serverTimestamp() });
    await assertSucceeds(setDoc(ref(version, 'new_migration_user', 'users', 'new_migration_user'), {
      name: 'New user', bio: 'Hello', ...stamp()
    }));
    await assertSucceeds(updateDoc(ref(version, ALICE, 'users', ALICE), {
      bio: 'Updated', avatarUrl: '', bannerUrl: '', websiteUrl: '', pinnedPostId: 'existing'
    }));
    await assertSucceeds(setDoc(ref(version, ALICE, 'posts', 'created'), { uid: ALICE, text: 'Hello', ...stamp() }));
    await assertSucceeds(setDoc(ref(version, BOB, 'posts', 'created', 'comments', 'comment'), { uid: BOB, text: 'Reply', ...stamp() }));
    await assertSucceeds(setDoc(ref(version, BOB, 'users', BOB, 'likes', 'created'), stamp()));
    await assertSucceeds(setDoc(ref(version, BOB, 'users', BOB, 'saved', 'created'), stamp()));
    await assertSucceeds(setDoc(ref(version, BOB, 'users', BOB, 'saved', 'created'), stamp()));
    const batch = writeBatch(db(version, BOB));
    batch.set(ref(version, BOB, 'users', BOB, 'following', ALICE), stamp());
    batch.set(ref(version, BOB, 'users', ALICE, 'followers', BOB), stamp());
    await assertSucceeds(batch.commit());
    await assertSucceeds(getDocs(query(collection(db(version, BOB), 'chats'), where('participants', 'array-contains', BOB))));
    // Missing sticker is allowed in both versions; explicit empty sticker is tested separately.
    await assertSucceeds(setDoc(ref(version, ALICE, 'chats', CID, 'messages', 'shared-text'), {
      senderId: ALICE, type: 'text', text: 'A real message', ...stamp()
    }));
    await assertSucceeds(setDoc(ref(version, BOB, 'chats', CID, 'messages', 'shared-sticker'), {
      senderId: BOB, type: 'sticker', text: '', sticker: 'pack/sticker.webp', ...stamp()
    }));
    await assertSucceeds(updateDoc(ref(version, BOB, 'chats', CID, 'messages', 'shared-text'), { readAt: serverTimestamp() }));
    await assertSucceeds(setDoc(ref(version, ALICE, 'chats', CID, 'typing', ALICE), { uid: ALICE, typing: true, updatedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(ref(version, ALICE, 'presence', ALICE), { uid: ALICE, lastSeen: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref(version, ALICE, 'users', ALICE, 'notifications', 'trusted'), { read: true }));
    await assertSucceeds(setDoc(ref(version, BOB, 'reports', 'report'), {
      reporterId: BOB, kind: 'post', targetId: 'existing', reason: 'Please review this post', status: 'pending', ...stamp()
    }));
    await assertSucceeds(updateDoc(ref(version, OWNER, 'reports', 'report'), { status: 'dismissed', reviewedBy: OWNER, reviewedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(ref(version, BOB, 'verificationRequests', BOB), {
      uid: BOB, type: 2, reason: 'Please verify this profile', status: 'pending', ...stamp()
    }));
    await assertSucceeds(updateDoc(ref(version, OWNER, 'verificationRequests', BOB), { status: 'approved', reviewedBy: OWNER, reviewedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref(version, OWNER, 'users', BOB), { role: 'moderator', verification: 2 }));
    await assertSucceeds(setDoc(ref(version, OWNER, 'auditLogs', 'review'), { actorId: OWNER, action: 'verification.approve', targetId: BOB, details: {}, ...stamp() }));
    await assertFails(updateDoc(ref(version, ALICE, 'users', ALICE), { role: 'admin' }));
    await assertFails(setDoc(ref(version, BOB, 'users', ALICE, 'notifications', 'forged'), { text: 'Forged' }));
    await assertFails(getDoc(ref(version, OUTSIDER, 'chats', CID)));
  });
}

test('actual text-message payload with sticker empty string is fixed in candidate', async () => {
  const payload = () => ({ senderId: ALICE, type: 'text', text: 'Browser payload', sticker: '', createdAt: serverTimestamp() });
  await assertFails(setDoc(ref('old', ALICE, 'chats', CID, 'messages', 'browser-payload'), payload()));
  await assertSucceeds(setDoc(ref('new', ALICE, 'chats', CID, 'messages', 'browser-payload'), payload()));
});

test('candidate fixes a participant probe for a missing chat without granting outsider access', async () => {
  const missing = `${ALICE}_${OUTSIDER}`;
  await assertFails(getDoc(ref('old', ALICE, 'chats', missing)));
  assert.equal((await assertSucceeds(getDoc(ref('new', ALICE, 'chats', missing)))).exists(), false);
  await assertFails(getDoc(ref('new', BOB, 'chats', missing)));
});

test('forged legacy reactions and receipt timestamps accepted by supplied rules are rejected', async () => {
  for (const version of ['old', 'new']) {
    const expect = version === 'old' ? assertSucceeds : assertFails;
    await expect(updateDoc(ref(version, BOB, 'chats', CID, 'messages', 'existing'), { reactions: { '🔥': [ALICE] } }));
    await expect(updateDoc(ref(version, BOB, 'chats', CID, 'messages', 'existing'), { readAt: 'not a timestamp' }));
  }
});

test('candidate intentionally requires server timestamps and existing saved targets', async () => {
  for (const version of ['old', 'new']) {
    const expect = version === 'old' ? assertSucceeds : assertFails;
    await expect(setDoc(ref(version, ALICE, 'users', ALICE, 'likes', 'existing'), { createdAt: new Date('2001-01-01') }));
    await expect(setDoc(ref(version, ALICE, 'users', ALICE, 'saved', 'deleted-post'), { createdAt: serverTimestamp() }));
    await expect(setDoc(ref(version, ALICE, 'posts', 'missing-post', 'comments', 'orphan'), { uid: ALICE, text: 'Orphan', createdAt: serverTimestamp() }));
    await expect(setDoc(ref(version, 'invalid_migration_profile', 'users', 'invalid_migration_profile'), { name: 'Invalid time', createdAt: new Date('2001-01-01') }));
  }
});

test('candidate validates edited media URLs that supplied rules accepted unchecked', async () => {
  for (const version of ['old', 'new']) {
    const expect = version === 'old' ? assertSucceeds : assertFails;
    await expect(updateDoc(ref(version, ALICE, 'users', ALICE), { avatarUrl: 'javascript:alert(1)' }));
    await expect(updateDoc(ref(version, ALICE, 'posts', 'existing'), { imageUrl: 'javascript:alert(1)' }));
  }
});

test('new noncanonical chats are intentionally rejected while existing legacy chats remain usable', async () => {
  for (const version of ['old', 'new']) {
    const expect = version === 'old' ? assertSucceeds : assertFails;
    await expect(setDoc(ref(version, ALICE, 'chats', 'new-noncanonical'), { participants: [BOB, ALICE], lastText: '', updatedAt: serverTimestamp() }));
    await assertSucceeds(getDoc(ref(version, ALICE, 'chats', 'legacy-chat')));
    await assertSucceeds(setDoc(ref(version, ALICE, 'chats', 'legacy-chat', 'messages', 'still-usable'), {
      senderId: ALICE, type: 'text', text: 'Legacy chat still usable', createdAt: serverTimestamp()
    }));
  }
});

test('editing a legacy message preserves stored reaction data; new per-user reactions require new rules', async () => {
  for (const version of ['old', 'new']) {
    await assertSucceeds(updateDoc(ref(version, ALICE, 'chats', CID, 'messages', 'existing'), { text: 'Edited without migrating reactions', editedAt: serverTimestamp() }));
    const stored = await getDoc(ref(version, ALICE, 'chats', CID, 'messages', 'existing'));
    assert.ok(stored.data().reactions);
    const expect = version === 'old' ? assertFails : assertSucceeds;
    await expect(setDoc(ref(version, ALICE, 'chats', CID, 'reactions', `existing_${ALICE}`), {
      uid: ALICE, messageId: 'existing', emoji: '👍', createdAt: serverTimestamp()
    }));
  }
});
