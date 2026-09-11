type SkillMetadata = { uri: string; name: string; description: string };

const DESCRIPTION_LIMIT = 240;

function excerpt(description: string, terms: string[]) {
  const text = description.replace(/\s+/g, " ").trim();
  const characters = Array.from(text);
  if (characters.length <= DESCRIPTION_LIMIT) return { description: text };

  const lower = text.toLowerCase();
  const positions = terms.map(term => lower.indexOf(term)).filter(index => index >= 0);
  const firstMatch = positions.length ? Math.min(...positions) : 0;
  const matchPosition = Array.from(lower.slice(0, firstMatch)).length;
  // Leave room for ellipses and show context around a match even late in the description.
  const width = DESCRIPTION_LIMIT - 2;
  const start = Math.min(Math.max(0, matchPosition - 60), characters.length - width);
  const end = start + width;
  return {
    description: `${start > 0 ? "…" : ""}${characters.slice(start, end).join("")}${end < characters.length ? "…" : ""}`,
    descriptionTruncated: true,
  };
}

export function searchSkills(catalog: SkillMetadata[], query: string | undefined, offset: number, limit: number) {
  const normalized = (query ?? "").toLowerCase().trim().replace(/\s+/g, " ");
  const terms = [...new Set(normalized.split(" ").filter(Boolean))];
  const matches = catalog.flatMap(skill => {
    const name = skill.name.toLowerCase();
    const description = skill.description.toLowerCase();
    if (!terms.every(term => name.includes(term) || description.includes(term))) return [];
    return [{
      skill,
      exactName: Number(name === normalized),
      nameMatches: terms.filter(term => name.includes(term)).length,
    }];
  });
  matches.sort((a, b) => b.exactName - a.exactName || b.nameMatches - a.nameMatches ||
    (a.skill.uri < b.skill.uri ? -1 : a.skill.uri > b.skill.uri ? 1 : 0));
  const skills = matches.slice(offset, offset + limit).map(({ skill }) => ({
    uri: skill.uri,
    name: skill.name,
    ...excerpt(skill.description, terms),
  }));
  const nextOffset = offset + skills.length < matches.length ? offset + skills.length : undefined;
  return { skills, totalMatches: matches.length, offset, limit, nextOffset };
}
