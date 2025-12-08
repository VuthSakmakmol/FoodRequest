// src/utils/normalizePayload.js

/**
 * Normalize menu counts for submit.
 * - Only send "special" menus.
 * - Skip "Standard" because backend derives it.
 *
 * @param {Record<string, number|string>} menuCountsObj
 * @returns {Record<string, number>}
 */
export function buildMenuCountsForSubmit(menuCountsObj = {}) {
  const out = {}

  for (const [key, value] of Object.entries(menuCountsObj)) {
    if (key === 'Standard') continue

    const count = Number(value || 0)
    if (count > 0) {
      out[key] = count
    }
  }

  return out
}

/**
 * Normalize dietary counts for submit.
 * Expect shape:
 * {
 *   [allergen]: { count: number|string, menu?: string }
 * }
 *
 * @param {Record<string, {count: number|string, menu?: string}>} dietaryCountsObj
 * @returns {{ allergen: string, count: number, menu: string }[]}
 */
export function buildDietaryCountsForSubmit(dietaryCountsObj = {}) {
  const out = []

  for (const [allergen, value] of Object.entries(dietaryCountsObj)) {
    const count = Number(value?.count || 0)
    const menu  = value?.menu || 'Standard'

    if (!allergen || !count) continue

    out.push({ allergen, count, menu })
  }

  return out
}
