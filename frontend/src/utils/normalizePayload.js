export function buildMenuCountsForSubmit(menuCountsObj = {}) {
  // Send ONLY specials; Standard is derived on the backend
  const out = {}
  for (const [k, v] of Object.entries(menuCountsObj)) {
    if (k === 'Standard') continue
    const n = Number(v || 0)
    if (n > 0) out[k] = n
  }
  return out
}

export function buildDietaryCountsForSubmit(dietaryCountsObj = {}) {
  const out = []
  for (const [allergen, v] of Object.entries(dietaryCountsObj)) {
    const count = Number(v?.count || 0)
    const menu  = v?.menu || 'Standard'
    if (!allergen || !count) continue
    out.push({ allergen, count, menu })
  }
  return out
}
