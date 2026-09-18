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
    if (!words.every(word => fields.some(field => field.includes(word)))) return [];
    let score = text && name === text ? 1000 : text && keywords.includes(text) ? 300 : 0;
    score += words.reduce((sum, word) => sum + (name.includes(word) ? 20 : keywords.some(keyword => keyword.includes(word)) ? 5 : 1), 0);
    return [{ item, score }];
  }).sort((a, b) => b.score - a.score || compareUri(a.item, b.item)).map(({ item }) => item);
}
