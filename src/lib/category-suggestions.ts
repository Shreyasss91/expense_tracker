import type { CategoryOption } from "@/components/quick-add/types";

// §6.2 — curated keywords per seed category slug, used to suggest categories from
// the Quick Add note ("what was it for?"). User-created categories have no keyword
// entries and are matched through their name words instead.
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  fuel: ["petrol", "diesel", "fuel", "gas", "refuel", "cng"],
  "travel-trips": ["trip", "travel", "flight", "hotel", "vacation", "taxi", "cab", "uber", "ola", "train", "railway", "tour"],
  clothing: ["clothes", "clothing", "dress", "shirt", "jeans", "kurta", "shoes", "fabric", "tailor"],
  kids: ["toys", "toy", "kids", "kid", "diaper", "baby"],
  "property-investments": ["property", "investment", "rent", "mortgage", "loan", "emi", "installment", "broker", "registration", "advance"],
  "dining-out": ["dining", "restaurant", "lunch", "dinner", "breakfast", "snacks", "snack", "pizza", "burger", "cafe", "coffee", "tea", "swiggy", "zomato", "meal", "biryani", "dosa", "eat", "food"],
  "groceries-household": ["grocery", "groceries", "vegetables", "vegetable", "fruits", "fruit", "milk", "bread", "rice", "dals", "household", "supermarket", "provision", "weekly"],
  "insurance-finance": ["insurance", "finance", "premium", "sip", "mutual", "stocks", "brokerage", "tax"],
  "health-medical": ["health", "medical", "medicine", "medicines", "doctor", "hospital", "clinic", "pharmacy", "checkup", "dentist", "lab", "tablet"],
  education: ["school", "college", "tuition", "fee", "fees", "books", "book", "stationery", "course", "exam", "admission", "university", "coaching"],
  "religion-gifts": ["gift", "gifts", "birthday", "anniversary", "temple", "church", "pooja", "puja", "donation", "charity", "wedding", "priest"],
  "home-furniture": ["furniture", "home", "sofa", "table", "curtain", "lamp", "kitchen", "utensils", "appliance", "fridge", "cupboard"],
  "vehicle-maintenance": ["vehicle", "maintenance", "service", "tyre", "tyres", "tire", "battery", "repair", "wash", "oil"],
  "utilities-recharges": ["utility", "utilities", "recharge", "recharges", "bill", "bills", "electricity", "water", "internet", "wifi", "broadband", "mobile", "phone", "dth", "cable", "gas"],
  "farm-garden": ["farm", "garden", "plants", "plant", "seeds", "fertilizer", "soil", "watering", "nursery"],
  "entertainment-outings": ["movie", "cinema", "theatre", "amusement", "outing", "zoo", "concert", "match", "ticket", "tickets", "netflix", "spotify", "gaming", "play"],
  "personal-care-fitness": ["gym", "salon", "haircut", "barber", "spa", "massage", "fitness", "cosmetics", "skincare", "perfume"],
  "transport-parking": ["parking", "metro", "auto", "rickshaw", "fare", "toll", "commute", "pass", "transport", "bus"],
  misc: [],
};

const SUGGESTION_LIMIT = 6;

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
}

/**
 * Score each category against the note: +3 per keyword hit, +2 per name-word
 * match (word equality, or a substring when one side is at least 4 chars).
 * Returns the top scoring matches (score > 0) ordered by score desc — the input
 * order (usage-first, from `useCategoryUsage`) is the stable tie-break. An empty
 * array means "no suggestions — fall back to the full grid".
 */
export function suggestCategories(note: string, categories: CategoryOption[]): CategoryOption[] {
  const tokens = tokenize(note);
  if (tokens.length === 0) return [];

  const scored = categories
    .map((c) => {
      let score = 0;
      const keywords = CATEGORY_KEYWORDS[c.slug] ?? [];
      const nameTokens = tokenize(c.name);
      for (const t of tokens) {
        if (keywords.some((k) => k === t || (t.length >= 4 && (k.includes(t) || t.includes(k))))) score += 3;
        if (nameTokens.some((n) => n === t || (n.length >= 4 && (n.includes(t) || t.includes(n))))) score += 2;
      }
      return { category: c, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score) // stable sort — usage order survives ties
    .slice(0, SUGGESTION_LIMIT)
    .map((s) => s.category);

  return scored;
}
