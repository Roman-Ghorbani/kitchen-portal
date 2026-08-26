/**
 * Allergens and dietary restrictions.
 *
 * One list, defined once, used by the request form, the chef queue, the API and
 * the audit log. Ids are stored; labels are only ever rendered, so renaming a
 * label never orphans a stored flag and never changes what a past request said.
 *
 * Two things are deliberate:
 *
 *  1. Allergens and dietary restrictions are separated by `kind`. They are not
 *     the same class of problem - getting Lent wrong is an apology, getting
 *     peanuts wrong is an ambulance - and the chef-facing screens lead with the
 *     allergens for that reason.
 *
 *  2. The allergen list is the FDA's nine major allergens plus gluten. Sesame
 *     is on it because it became the ninth in 2023 and is the one most often
 *     left off lists copied from older sources.
 */

export type DietaryKind = 'allergen' | 'dietary';

export interface DietaryFlag {
  id: string;
  label: string;
  kind: DietaryKind;
  /** Shown under the label on the request form, where it prevents a mis-tick. */
  hint?: string;
}

export const OTHER_FLAG_ID = 'other';

export const DIETARY_FLAGS: readonly DietaryFlag[] = [
  { id: 'peanuts', label: 'Peanuts', kind: 'allergen' },
  { id: 'tree-nuts', label: 'Tree nuts', kind: 'allergen' },
  { id: 'milk', label: 'Milk / dairy', kind: 'allergen' },
  {
    id: 'egg',
    label: 'Egg',
    kind: 'allergen',
    hint: 'Not baked — baked egg is usually fine',
  },
  { id: 'fish', label: 'Fish', kind: 'allergen' },
  { id: 'shellfish', label: 'Shellfish', kind: 'allergen' },
  { id: 'soy', label: 'Soy', kind: 'allergen' },
  { id: 'sesame', label: 'Sesame', kind: 'allergen' },
  { id: 'wheat', label: 'Wheat', kind: 'allergen' },
  {
    id: 'gluten-free',
    label: 'Gluten-free',
    kind: 'allergen',
    hint: 'Celiac — no cross-contact',
  },
  { id: 'kosher', label: 'Kosher', kind: 'dietary' },
  { id: 'kosher-passover', label: 'Kosher for Passover', kind: 'dietary' },
  { id: 'lent', label: 'Lent accommodation', kind: 'dietary' },
  { id: 'ramadan', label: 'Ramadan accommodation', kind: 'dietary' },
  { id: 'no-beef', label: 'No beef', kind: 'dietary', hint: 'Hindu' },
  {
    id: OTHER_FLAG_ID,
    label: 'Other',
    kind: 'dietary',
    hint: 'Write it in below',
  },
] as const;

const BY_ID = new Map(DIETARY_FLAGS.map((f) => [f.id, f]));

export const ALLERGENS = DIETARY_FLAGS.filter((f) => f.kind === 'allergen');
export const DIETARY = DIETARY_FLAGS.filter((f) => f.kind === 'dietary');

export function isDietaryFlag(id: string): boolean {
  return BY_ID.has(id);
}

/**
 * Drops anything not in the catalogue and de-duplicates, keeping catalogue
 * order so two requests with the same flags always read the same way.
 *
 * Unknown ids are discarded rather than rejected: a stale tab posting a flag
 * that has since been renamed should still get its plate, with the flags we
 * can vouch for.
 */
export function normaliseFlags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const wanted = new Set(input.filter((x): x is string => typeof x === 'string'));
  return DIETARY_FLAGS.filter((f) => wanted.has(f.id)).map((f) => f.id);
}

export function labelFor(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}

export function kindOf(id: string): DietaryKind | null {
  return BY_ID.get(id)?.kind ?? null;
}

export interface FlagSummary {
  /** Ids, catalogue order. */
  ids: string[];
  allergens: string[];
  dietary: string[];
  /** Everything the kitchen must read, allergens first, "Other" spelled out. */
  lines: string[];
  hasAny: boolean;
  hasAllergen: boolean;
}

/**
 * What the chefs actually need to see, in the order they need to see it.
 *
 * `other` is replaced by the brother's own words rather than the word "Other",
 * which on its own tells a chef nothing.
 */
export function summariseFlags(
  ids: readonly string[] | null | undefined,
  other: string | null | undefined,
): FlagSummary {
  const clean = normaliseFlags(ids ?? []);
  const trimmedOther = other?.trim() || null;

  const allergens = clean.filter((id) => kindOf(id) === 'allergen').map(labelFor);
  const dietary = clean
    .filter((id) => kindOf(id) === 'dietary' && id !== OTHER_FLAG_ID)
    .map(labelFor);

  if (clean.includes(OTHER_FLAG_ID)) {
    dietary.push(trimmedOther ? `Other: ${trimmedOther}` : 'Other (unspecified)');
  } else if (trimmedOther) {
    // Free text without the box ticked still has to reach the kitchen.
    dietary.push(`Other: ${trimmedOther}`);
  }

  const lines = [...allergens, ...dietary];

  return {
    ids: clean,
    allergens,
    dietary,
    lines,
    hasAny: lines.length > 0,
    hasAllergen: allergens.length > 0,
  };
}
