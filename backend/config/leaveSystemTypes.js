// backend/config/leaveSystemTypes.js
const SYSTEM_TYPES = Object.freeze([
  { code: 'AL', name: 'Annual Leave (AL)', requiresBalance: true, fixedDurationDays: 0 },
  { code: 'SP', name: 'Special Leave (SP)', requiresBalance: true, fixedDurationDays: 0 },
  { code: 'MC', name: 'Sick Leave (MC)', requiresBalance: true, fixedDurationDays: 0 },
  { code: 'MA', name: 'Maternity Leave (MA)', requiresBalance: true, fixedDurationDays: 90 },
  { code: 'UL', name: 'Unpaid Leave (UL)', requiresBalance: false, fixedDurationDays: 0 },

  // ✅ NEW: Business Leave
  { code: 'BL', name: 'Business Leave (BL)', requiresBalance: false, fixedDurationDays: 0 },
])

function getLeaveType(code) {
  const c = String(code || '').trim().toUpperCase()
  return SYSTEM_TYPES.find((t) => t.code === c) || null
}

module.exports = { SYSTEM_TYPES, getLeaveType }