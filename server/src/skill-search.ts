export type SearchDocument = {
  uri: string;
  name: string;
  description: string;
  keywords: string[];
  automatic: boolean;
  digest: string;
};

export type SearchMode = "legacy" | "automatic" | "explicit";
const compareUri = (a: SearchDocument, b: SearchDocument) => a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0;
const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const hasTerm = (field: string, term: string) => /^[a-z0-9]+$/.test(term)
  ? new RegExp(`(^|[^\\p{L}\\p{N}])${term}(?=$|[^\\p{L}\\p{N}])`, "u").test(field)
  : field.includes(term);

// Keywords belong to the versioned skill content, never a client-side name map.
// All query terms must match. Ranking changes order, not the intended subject.
export function searchSkills(documents: SearchDocument[], query: string | undefined, mode: SearchMode): SearchDocument[] {
  if (mode === "legacy") {
    const words = query?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
    return documents.filter(item => {
      const text = `${item.name} ${item.description} ${item.keywords.join(" ")}`.toLowerCase();
      return words.every(word => text.includes(word));
    }).sort(compareUri);
  }
  const text = normalize(query ?? "");
  const words = text.split(" ").filter(Boolean);
  return documents.flatMap(item => {
    if (mode === "automatic" && !item.automatic) return [];
    const name = normalize(item.name), description = normalize(item.description);
    const keywords = item.keywords.map(normalize);
    const fields = [name, description, ...keywords];
    if (!words.every(word => fields.some(field => hasTerm(field, word)))) return [];
    let score = text && name === text ? 1000 : text && keywords.includes(text) ? 300 : 0;
    score += words.reduce((sum, word) => sum + (hasTerm(name, word) ? 20 : keywords.some(keyword => hasTerm(keyword, word)) ? 5 : 1), 0);
    return [{ item, score }];
  }).sort((a, b) => b.score - a.score || compareUri(a.item, b.item)).map(({ item }) => item);
}

const DESCRIPTION_LIMIT = 240;

export function excerpt(description: string, terms: string[]) {
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
