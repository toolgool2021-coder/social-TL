// Search and sort only the groups already loaded into the catalog.
export function filterGroups(groups, kind, query = "", verifiedOnly = false) {
  const needle = String(query ?? "").normalize("NFKC").trim().toLocaleLowerCase("ru").replace(/\s+/g," ");
  const terms = needle.split(" ").filter(Boolean);
  return (groups || []).filter(g => {
    if (g?.kind !== kind || (verifiedOnly && !g.verified)) return false;
    const haystack = [g.name, g.tag, g.category, g.description].map(v => String(v ?? "").normalize("NFKC").toLocaleLowerCase("ru")).join(" ");
    return terms.every(t => haystack.includes(t));
  }).sort((a,b) => Number(Boolean(b.verified)) - Number(Boolean(a.verified)) ||
    Number(b.memberCount || 0) - Number(a.memberCount || 0) ||
    String(a.name || "").localeCompare(String(b.name || ""), "ru"));
}
