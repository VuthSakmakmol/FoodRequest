// backend/utils/leave/leave.contracts.js
// ✅ Contract helpers for Expat Leave
// Goal: every contract has its own carry, and "current contract" is deterministic.

function isValidYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim())
}

function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function normStr(v) {
  return String(v ?? '').trim()
}

function ymdToUTCDate(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1))
}

function addDaysYMD(ymd, deltaDays) {
  const dt = ymdToUTCDate(ymd)
  dt.setUTCDate(dt.getUTCDate() + Number(deltaDays || 0))
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addYearsYMD(ymd, years) {
  const dt = ymdToUTCDate(ymd)
  dt.setUTCFullYear(dt.getUTCFullYear() + Number(years || 0))
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function endFromStartYMD(startYMD) {
  if (!isValidYMD(startYMD)) return ''
  return addDaysYMD(addYearsYMD(startYMD, 1), -1)
}

function normalizeCarry(src) {
  const c = src && typeof src === 'object' ? src : {}
  return {
    AL: num(c.AL),
    SP: num(c.SP),
    MC: num(c.MC),
    MA: num(c.MA),
    UL: num(c.UL),
  }
}

function isCarryEmpty(carry) {
  const c = normalizeCarry(carry)
  return (
    num(c.AL) === 0 &&
    num(c.SP) === 0 &&
    num(c.MC) === 0 &&
    num(c.MA) === 0 &&
    num(c.UL) === 0
  )
}

/**
 * Sort contracts oldest -> newest (by startDate if possible, else by contractNo).
 */
function sortContractsAsc(contracts = []) {
  const arr = Array.isArray(contracts) ? contracts.slice() : []
  return arr.sort((a, b) => {
    const sa = normStr(a?.startDate)
    const sb = normStr(b?.startDate)
    const va = isValidYMD(sa)
    const vb = isValidYMD(sb)
    if (va && vb) return sa.localeCompare(sb)
    if (va && !vb) return -1
    if (!va && vb) return 1
    return num(a?.contractNo) - num(b?.contractNo)
  })
}

/**
 * Sort contracts newest -> oldest (by startDate if possible, else by contractNo).
 */
function sortContractsDesc(contracts = []) {
  return sortContractsAsc(contracts).reverse()
}

/**
 * Return the "current/latest contract" (newest by startDate/contractNo).
 */
function pickLatestContract(profile) {
  const list = Array.isArray(profile?.contracts) ? profile.contracts : []
  const sorted = sortContractsDesc(list)
  return sorted.length ? sorted[0] : null
}

/**
 * Find contract that contains an "asOf" date (YYYY-MM-DD).
 * Inclusive: startDate <= asOf <= endDate
 */
function findContractByAsOf(profile, asOfYMD) {
  if (!isValidYMD(asOfYMD)) return null
  const list = Array.isArray(profile?.contracts) ? profile.contracts : []
  const sorted = sortContractsDesc(list)

  for (const c of sorted) {
    const s = normStr(c?.startDate)
    const e = normStr(c?.endDate) || endFromStartYMD(s)
    if (isValidYMD(s) && isValidYMD(e)) {
      if (asOfYMD >= s && asOfYMD <= e) return c
    }
  }
  return null
}

/**
 * Decide the active contract for calculations.
 * Priority:
 *  1) contractId / contractNo if provided
 *  2) asOf date (belongs to which contract)
 *  3) profile.contractDate match
 *  4) latest contract
 */
function pickActiveContract(profile, opts = {}) {
  const {
    contractId = null,
    contractNo = null,
    asOf = null,
    contractDate = null,
  } = opts || {}

  const list = Array.isArray(profile?.contracts) ? profile.contracts : []
  if (!list.length) return null

  // 1) by _id
  if (contractId) {
    const id = String(contractId).trim()
    const found = list.find((c) => String(c?._id || '').trim() === id)
    if (found) return found
  }

  // 1b) by contractNo
  if (contractNo != null && String(contractNo).trim() !== '') {
    const n = num(contractNo)
    const found = list.find((c) => num(c?.contractNo) === n)
    if (found) return found
  }

  // 2) by asOf date
  if (asOf && isValidYMD(asOf)) {
    const hit = findContractByAsOf(profile, asOf)
    if (hit) return hit
  }

  // 3) by explicit contractDate / profile.contractDate
  const cd = isValidYMD(contractDate) ? String(contractDate).trim() : ''
  const profileCd = isValidYMD(profile?.contractDate) ? String(profile.contractDate).trim() : ''
  const wanted = cd || profileCd
  if (wanted) {
    const found = list.find((c) => String(c?.startDate || '').trim() === wanted)
    if (found) return found
  }

  // 4) fallback latest
  return pickLatestContract(profile)
}

/**
 * Ensures contracts[] exists and at least 1 contract exists.
 * This is useful for migrations / seed scripts / “clean data recreate”.
 *
 * Returns { changed, contracts, activeContract }
 */
function ensureContracts(profile) {
  if (!profile || typeof profile !== 'object') {
    return { changed: false, contracts: [], activeContract: null }
  }

  let changed = false

  if (!Array.isArray(profile.contracts)) {
    profile.contracts = []
    changed = true
  }

  // if empty, create initial contract from contractDate or joinDate
  if (profile.contracts.length === 0) {
    const start =
      isValidYMD(profile?.contractDate) ? String(profile.contractDate).trim()
      : isValidYMD(profile?.joinDate) ? String(profile.joinDate).trim()
      : ''

    if (start) {
      const legacyCarry = normalizeCarry(profile?.carry)
      if (num(legacyCarry.AL) === 0 && typeof profile?.alCarry === 'number' && num(profile.alCarry) !== 0) {
        legacyCarry.AL = num(profile.alCarry)
      }

      profile.contracts.push({
        contractNo: 1,
        startDate: start,
        endDate: endFromStartYMD(start),
        carry: legacyCarry,
        alCarry: num(legacyCarry.AL),
        openedAt: new Date(),
        openedBy: 'ensureContracts',
        note: 'Initial contract auto-created',
        closeSnapshot: null,
      })
      changed = true
    }
  } else {
    // normalize endDate + carry on all contracts
    for (const c of profile.contracts) {
      if (isValidYMD(c?.startDate) && !isValidYMD(c?.endDate)) {
        c.endDate = endFromStartYMD(c.startDate)
        changed = true
      }
      const before = c?.carry
      c.carry = normalizeCarry(c.carry)
      c.alCarry = num(c.carry.AL)
      if (before !== c.carry) changed = true
    }

    // migrate legacy profile.carry -> latest contract only if latest carry empty
    const latest = pickLatestContract(profile)
    if (latest && isCarryEmpty(latest.carry)) {
      const legacyCarry = normalizeCarry(profile?.carry)
      if (num(legacyCarry.AL) === 0 && typeof profile?.alCarry === 'number' && num(profile.alCarry) !== 0) {
        legacyCarry.AL = num(profile.alCarry)
      }

      const hasLegacy = !isCarryEmpty(legacyCarry)
      if (hasLegacy) {
        latest.carry = legacyCarry
        latest.alCarry = num(legacyCarry.AL)
        changed = true
      }
    }
  }

  // keep profile "current pointers" aligned to latest
  const latest = pickLatestContract(profile)
  if (latest && isValidYMD(latest.startDate)) {
    if (String(profile.contractDate || '').trim() !== String(latest.startDate).trim()) {
      profile.contractDate = latest.startDate
      changed = true
    }
    const shouldEnd = isValidYMD(latest.endDate) ? latest.endDate : endFromStartYMD(latest.startDate)
    if (String(profile.contractEndDate || '').trim() !== String(shouldEnd || '').trim()) {
      profile.contractEndDate = shouldEnd
      changed = true
    }
  }

  return { changed, contracts: profile.contracts, activeContract: latest || null }
}

/**
 * Get carry for active contract (the real source of truth).
 * If no active contract, return zeros.
 */
function getActiveCarry(profile, opts = {}) {
  const c = pickActiveContract(profile, opts)
  if (!c) return normalizeCarry({})
  return normalizeCarry(c.carry)
}

module.exports = {
  // ymd
  isValidYMD,
  ymdToUTCDate,
  addDaysYMD,
  addYearsYMD,
  endFromStartYMD,

  // carry
  normalizeCarry,
  isCarryEmpty,
  getActiveCarry,

  // contracts
  sortContractsAsc,
  sortContractsDesc,
  pickLatestContract,
  findContractByAsOf,
  pickActiveContract,
  ensureContracts,
}
