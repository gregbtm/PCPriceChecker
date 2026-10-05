/**
 * Interim relevance filter for key-less retailer searches (task P0-9).
 *
 * Retailer search pages return unrelated products (DDR4, single 24GB sticks) next to the kit you want,
 * so a search result may only become a price record if its title contains every token of the query.
 * Prefix a token with "-" to exclude it. This is deliberately strict and is replaced by the memory
 * classifier in Phase 1 (P1-1/P1-5): known limit, "5600" does not match "5600MHz".
 */
function normalise(s: string): string {
  return s.toLowerCase()
    .replace(/so[\s-]?dimm/g, 'sodimm')
    .replace(/non[\s-]?ecc/g, 'nonecc')   // so "-ecc" does not exclude Non-ECC memory
    .replace(/(\d+)\s*gb\b/g, '$1gb');
}

function hasToken(haystack: string, token: string): boolean {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(haystack);
}

export function matchesQuery(title: string, query: string): boolean {
  const name = normalise(title);
  const tokens = normalise(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every(t => (t.startsWith('-') && t.length > 1 ? !hasToken(name, t.slice(1)) : hasToken(name, t)));
}
