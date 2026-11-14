"use strict";

/**
 * NEXORA 3.2 trusted notifications.
 * Firebase Admin SDK bypasses Firestore Rules; never accept arbitrary client
 * supplied recipient IDs or notification text as authoritative.
 */
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {logger} = require("firebase-functions");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();
const REGION = "us-central1";

function safeSnippet(input, max=120) {
  return String(input || "").replace(/[\r\n\t]+/g, " ").trim().slice(0,max);
}

async function notify(recipient, sender, id, text, kind, targetId) {
  if (!recipient || !sender || recipient === sender) return;
  const user = await db.doc(`users/${recipient}`).get();
  if (!user.exists) return;
  await db.doc(`users/${recipient}/notifications/${id}`).create({
    text, kind, targetId, actorId:sender,
    read:false, createdAt:FieldValue.serverTimestamp()
  }).catch(error=>{
    // Firestore ALREADY_EXISTS means the event was retried; no duplicate.
    if (error.code === 6 || error.code === "already-exists") return;
    throw error;
  });
}

exports.onNewComment = onDocumentCreated({
  document:"posts/{postId}/comments/{commentId}", region:REGION,
  retry:true
},async event=>{
  const comment = event.data?.data();
  if (!comment) return;
  const post = await db.doc(`posts/${event.params.postId}`).get();
  if (!post.exists) return;
  const author = post.data()?.uid;
  const actor = comment.uid;
  if (!author || !actor || author === actor) return;
  const snippet = safeSnippet(comment.text);
  await notify(author,actor,`comment_${event.params.postId}_${event.params.commentId}`,
    `Новый комментарий: ${snippet || "Открыть публикацию"}`,
    "comment",event.params.postId);
});

exports.onNewMessage = onDocumentCreated({
  document:"chats/{chatId}/messages/{messageId}",region:REGION,
  retry:true
},async event=>{
  const message=event.data?.data();
  if (!message) return;
  const chat=await db.doc(`chats/${event.params.chatId}`).get();
  if (!chat.exists) return;
  const participants=chat.data()?.participants;
  const sender=message.senderId;
  if (!Array.isArray(participants) || participants.length!==2 ||
      !participants.includes(sender)) return;
  const recipient=participants.find(uid=>uid!==sender);
  const preview=message.type==="sticker"?"Стикер":safeSnippet(message.text);
  await notify(recipient,sender,`message_${event.params.chatId}_${event.params.messageId}`,
    `Новое сообщение: ${preview || "Открыть диалог"}`,
    "message",event.params.chatId);
});

exports.onNewFollower = onDocumentCreated({
  document:"users/{uid}/followers/{followerId}",region:REGION,
  retry:true
},async event=>{
  await notify(event.params.uid,event.params.followerId,
    `follow_${event.params.followerId}`,
    "На вас подписался новый пользователь","follow",event.params.followerId);
});

exports.onNewLike = onDocumentCreated({
  document:"users/{uid}/likes/{postId}",region:REGION,
  retry:true
},async event=>{
  const actor=event.params.uid;
  const postId=event.params.postId;
  const post=await db.doc(`posts/${postId}`).get();
  if (!post.exists) return;
  const author=post.data()?.uid;
  if (!author || !actor || author===actor) return;
  await notify(author,actor,`like_${postId}_${actor}`,
    "Вашу публикацию отметили как понравившуюся","like",postId);
});

const OWNER_UID = "FXtmMsn8JYfx04zpxiSaXZ0iHWg2";

// Moderation alerts are sent only to the fixed owner UID. A report's
// targetId and reason are untrusted; they are never used to construct a
// document path or a notification identifier.
exports.onNewReport = onDocumentCreated({
  document:"reports/{reportId}",region:REGION,retry:true
},async event=>{
  const report=event.data?.data();
  if(!report || report.status!=="pending")return;
  if(typeof report.reporterId!=="string" || !report.reporterId)return;
  await notify(OWNER_UID,report.reporterId,
    `report_${event.params.reportId}`,
    "Поступила новая жалоба. Откройте панель модерации.",
    "report",event.params.reportId);
});

exports.onNewVerificationRequest = onDocumentCreated({
  document:"verificationRequests/{uid}",region:REGION,retry:true
},async event=>{
  const request=event.data?.data();
  if(!request || request.status!=="pending" || request.uid!==event.params.uid)return;
  await notify(OWNER_UID,event.params.uid,
    `verification_${event.params.uid}`,
    "Поступила новая заявка на верификацию.",
    "verification",event.params.uid);
});
