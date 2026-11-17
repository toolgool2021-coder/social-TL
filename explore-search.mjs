// NEXORA Beta 4.0: ranked search in the loaded Explore snapshot.
// A server-side index is required for complete database-wide results.
export function normalizeSearch(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ru").replace(/\s+/g, " ");
}
export function searchExplore(query, users, posts, max = 20) {
  const term = normalizeSearch(query).slice(0, 100);
  const cap = Math.max(0, Math.min(100, Number.isFinite(max) ? Math.floor(max) : 20));
  if (!term || !cap) return {users: [], posts: [], tags: []};
  const needle = term.replace(/^@/, "");
  const tokens = needle.split(" ").filter(Boolean);
  const people = Object.entries(users || {}).map(([uid, user]) => {
    const username = normalizeSearch(user?.username).replace(/^@/, "");
    const name = normalizeSearch(user?.name);
    const searchable = username + " " + name;
    const matches = tokens.every(token => searchable.includes(token));
    const rank = !matches ? Infinity : username === needle ? 0 :
      username.startsWith(needle) ? 1 : name.startsWith(needle) ? 2 :
      username.includes(needle) ? 3 : name.includes(needle) ? 4 : 5;
    return {uid, user, rank};
  }).filter(item => item.rank !== Infinity).sort((a,b) =>
    a.rank - b.rank || normalizeSearch(a.user?.name).localeCompare(normalizeSearch(b.user?.name))
  ).slice(0,cap);
  const matchedPosts = (posts || []).filter(post => {
    const content = normalizeSearch(post?.text);
    return tokens.every(token => content.includes(token));
  }).sort((a,b) => {
    const aText = normalizeSearch(a.text), bText = normalizeSearch(b.text);
    const aRank = aText.startsWith(term) ? 0 : aText.includes(term) ? 1 : 2;
    const bRank = bText.startsWith(term) ? 0 : bText.includes(term) ? 1 : 2;
    return aRank - bRank;
  }).slice(0,cap);
  const tagCounts = new Map();
  for (const post of posts || []) {
    const uniqueTags = new Set((String(post?.text || "").match(/#[\p{L}\p{N}_]{2,40}/gu) || []).map(normalizeSearch));
    for (const tag of uniqueTags) {
      if (tag.includes(term.startsWith("#") ? term : "#" + term)) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
  }
  const tags = [...tagCounts].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,cap);
  return {users:people, posts:matchedPosts, tags};
}
