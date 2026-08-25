// Hard-coded constants — never environment variables (§5.7, §8.1, §9.1).

/** The single business timezone of the application (§5.7). */
export const APP_TIMEZONE = "Asia/Kolkata";

/**
 * Fixed namespace for deterministic seed IDs (§8.1).
 * Never change — changing it re-IDs the entire transaction history.
 * Never make it configurable.
 */
export const SEED_NAMESPACE = "faf21a15-de89-4459-8720-8af54ea57381";

/**
 * Literal CSV-string → slug lookup maps (§3.2.2, §5.3).
 * The seed script resolves members/categories through these tables as
 * literal maps — never via a runtime slugify function and never via name.
 */
export const MEMBER_SLUG_MAP: Record<string, string> = {
  Dad: "dad",
  Mom: "mom",
  Son: "son",
};

export const CATEGORY_SLUG_MAP: Record<string, string> = {
  Fuel: "fuel",
  "Travel & Trips": "travel-trips",
  Clothing: "clothing",
  Kids: "kids",
  "Property & Investments": "property-investments",
  "Dining Out": "dining-out",
  "Groceries & Household": "groceries-household",
  "Insurance & Finance": "insurance-finance",
  "Health & Medical": "health-medical",
  Education: "education",
  "Religion & Gifts": "religion-gifts",
  "Home & Furniture": "home-furniture",
  "Vehicle Maintenance": "vehicle-maintenance",
  "Utilities & Recharges": "utilities-recharges",
  "Farm & Garden": "farm-garden",
  "Entertainment & Outings": "entertainment-outings",
  "Personal Care & Fitness": "personal-care-fitness",
  "Transport & Parking": "transport-parking",
  Misc: "misc",
};

/** Seed-time member rows (§3.2.2). `name` values must match CSV strings byte-for-byte. */
export const SEED_MEMBERS = [
  { slug: "dad", name: "Dad", emoji: "👨", color: "#3b82f6", sortOrder: 1 },
  { slug: "mom", name: "Mom", emoji: "👩", color: "#ec4899", sortOrder: 2 },
  { slug: "son", name: "Son", emoji: "👦", color: "#f59e0b", sortOrder: 3 },
] as const;

/** Seed-time category rows (§5.3). `name` values must match CSV strings byte-for-byte. */
export const SEED_CATEGORIES = [
  { slug: "fuel", name: "Fuel", emoji: "⛽", color: "#ef4444", sortOrder: 1 },
  { slug: "travel-trips", name: "Travel & Trips", emoji: "✈️", color: "#0ea5e9", sortOrder: 2 },
  { slug: "clothing", name: "Clothing", emoji: "👗", color: "#d946ef", sortOrder: 3 },
  { slug: "kids", name: "Kids", emoji: "🧸", color: "#f97316", sortOrder: 4 },
  { slug: "property-investments", name: "Property & Investments", emoji: "🏠", color: "#8b5cf6", sortOrder: 5 },
  { slug: "dining-out", name: "Dining Out", emoji: "🍔", color: "#f59e0b", sortOrder: 6 },
  { slug: "groceries-household", name: "Groceries & Household", emoji: "🛒", color: "#22c55e", sortOrder: 7 },
  { slug: "insurance-finance", name: "Insurance & Finance", emoji: "🏦", color: "#64748b", sortOrder: 8 },
  { slug: "health-medical", name: "Health & Medical", emoji: "🏥", color: "#06b6d4", sortOrder: 9 },
  { slug: "education", name: "Education", emoji: "🎓", color: "#6366f1", sortOrder: 10 },
  { slug: "religion-gifts", name: "Religion & Gifts", emoji: "🎁", color: "#eab308", sortOrder: 11 },
  { slug: "home-furniture", name: "Home & Furniture", emoji: "🛋️", color: "#92400e", sortOrder: 12 },
  { slug: "vehicle-maintenance", name: "Vehicle Maintenance", emoji: "🔧", color: "#334155", sortOrder: 13 },
  { slug: "utilities-recharges", name: "Utilities & Recharges", emoji: "📱", color: "#10b981", sortOrder: 14 },
  { slug: "farm-garden", name: "Farm & Garden", emoji: "🌱", color: "#65a30d", sortOrder: 15 },
  { slug: "entertainment-outings", name: "Entertainment & Outings", emoji: "🎢", color: "#ec4899", sortOrder: 16 },
  { slug: "personal-care-fitness", name: "Personal Care & Fitness", emoji: "💇", color: "#14b8a6", sortOrder: 17 },
  { slug: "transport-parking", name: "Transport & Parking", emoji: "🚌", color: "#0891b2", sortOrder: 18 },
  { slug: "misc", name: "Misc", emoji: "📦", color: "#78716c", sortOrder: 19 },
] as const;

export const TRANSACTION_TAGS = ["lifestyle", "recurring", "one_time"] as const;
export const TRANSACTION_TAG_LABELS: Record<(typeof TRANSACTION_TAGS)[number], string> = {
  one_time: "One-time",
  recurring: "Recurring",
  lifestyle: "Lifestyle",
};

/**
 * The seven household groups (two-level category hierarchy). Group slugs are
 * prefixed "grp-" so they can never collide with a user-created category slug.
 * Groups are top-level rows: never directly assignable to a transaction,
 * template or budget — only their leaves are. Mirrored by the backfill in
 * drizzle/0008_category_hierarchy.sql; keep the two in sync.
 */
export const SEED_CATEGORY_GROUPS = [
  { slug: "grp-getting-around", name: "Getting Around", emoji: "🚗", color: "#0ea5e9", sortOrder: 1 },
  { slug: "grp-food-provisions", name: "Food & Provisions", emoji: "🍲", color: "#f59e0b", sortOrder: 2 },
  { slug: "grp-people-care", name: "People & Care", emoji: "👨‍👩‍👧", color: "#8b5cf6", sortOrder: 3 },
  { slug: "grp-home-bills", name: "Home & Bills", emoji: "🏠", color: "#10b981", sortOrder: 4 },
  { slug: "grp-wealth-protection", name: "Wealth & Protection", emoji: "💰", color: "#6366f1", sortOrder: 5 },
  { slug: "grp-lifestyle-giving", name: "Lifestyle & Giving", emoji: "🎉", color: "#ec4899", sortOrder: 6 },
  { slug: "grp-other", name: "Other", emoji: "🧺", color: "#9ca3af", sortOrder: 7 },
] as const;

/** Leaf slug → the group slug it belongs under (seed + fresh-setup parity with migration 0008). */
export const CATEGORY_GROUP_OF_LEAF: Record<string, string> = {
  fuel: "grp-getting-around",
  "vehicle-maintenance": "grp-getting-around",
  "transport-parking": "grp-getting-around",
  "groceries-household": "grp-food-provisions",
  "dining-out": "grp-food-provisions",
  "farm-garden": "grp-food-provisions",
  kids: "grp-people-care",
  education: "grp-people-care",
  "health-medical": "grp-people-care",
  "personal-care-fitness": "grp-people-care",
  clothing: "grp-people-care",
  "home-furniture": "grp-home-bills",
  "utilities-recharges": "grp-home-bills",
  "property-investments": "grp-wealth-protection",
  "insurance-finance": "grp-wealth-protection",
  "travel-trips": "grp-lifestyle-giving",
  "entertainment-outings": "grp-lifestyle-giving",
  "religion-gifts": "grp-lifestyle-giving",
  misc: "grp-other",
};
