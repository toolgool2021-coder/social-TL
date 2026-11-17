// NEXORA Beta 4.0: deterministic search over the currently loaded Explore snapshot.
// This is NOT a full-database search. Firestore pagination/indexing is a separate stage.
export function normalizeSearch(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ru").replace(/\s+/g, " ");
}
export function searchExplore(query, users, posts, max = 20) {
  const term = normalizeSearch(query).slice(0, 100);
  if (!term) return {users: [], posts: [], tags: []};
  const needle = term.replace(/^@/, "");
  const people = Object.entries(users || {}).map(([uid, user]) => {
    const username = normalizeSearch(user?.username).replace(/^@/, "");
    const name = normalizeSearch(user?.name);
    let rank = username === needle ? 0 : username.startsWith(needle) ? 1 :
      name.startsWith(needle) ? 2 : username.includes(needle) ? 3 :
      name.includes(needle) ? 4 : Infinity;
    return {uid, user, rank};
  }).filter(item => item.rank !== Infinity).sort((a,b) =>
    a.rank - b.rank || normalizeSearch(a.user?.name).localeCompare(normalizeSearch(b.user?.name))
  ).slice(0,max);
  const matchedPosts = (posts || []).filter(post =>
    normalizeSearch(post?.text).includes(term)
  ).slice(0,max);
  const tagCounts = new Map();
  for (const post of posts || []) {
    for (const tag of new Set(String(post?.text || "").match(/#[\p{L}\p{N}_]{2,40}/gu) || [])) {
      const normalized = normalizeSearch(tag);
      if (normalized.includes(term.startsWith("#") ? term : "#" + term)) {
        tagCounts.set(normalized, (tagCounts.get(normalized) || 0) + 1);
      }
    }
  }
  const tags = [...tagCounts].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,max);
  return {users:people, posts:matchedPosts, tags};
}
