// backend/config/leave/systemLeaveTypes.js

/**
 * System leave types – STRICT by policy (developer-controlled)
 *
 * AL = Annual Leave (18 days/year, 1.5 days/month)
 * MC = Sick Leave (60 days/year)
 * MA = Maternity Leave (fixed 90 days)
 * SP = Special Leave (borrow logic handled in leave request rules, max 7 days/year)
 * UL = Unpaid Leave (no balance, no yearly limit)
 */

const SYSTEM_LEAVE_TYPES = [
  {
    code: 'AL',
    name: 'Annual Leave',
    description: 'Annual leave, accrues monthly up to 18 days per year.',
    requiresBalance: true,
    yearlyEntitlement: 18,
    accrualPerMonth: 1.5,
    yearlyLimit: 18,
    fixedDurationDays: 0,
    allowNegative: true, // can go negative if your business rule allows (ex: SP borrow)
    isSystem: true,
    isActive: true,
    systemLocked: true,
    order: 1,
  },
  {
    code: 'MC',
    name: 'Sick Leave (MC)',
    description: 'Medical / sick leave, up to 60 days per year.',
    requiresBalance: true,
    yearlyEntitlement: 60,
    accrualPerMonth: 0,
    yearlyLimit: 60,
    fixedDurationDays: 0,
    allowNegative: false,
    isSystem: true,
    isActive: true,
    systemLocked: true,
    order: 2,
  },
  {
    code: 'MA',
    name: 'Maternity Leave (MA)',
    description: 'Maternity leave – fixed 90 days, taken as one block.',
    requiresBalance: false,
    yearlyEntitlement: 90,
    accrualPerMonth: 0,
    yearlyLimit: 90,
    fixedDurationDays: 90,
    allowNegative: false,
    isSystem: true,
    isActive: true,
    systemLocked: true,
    order: 3,
  },
  {
    code: 'SP',
    name: 'Special Leave (SP)',
    description: 'Special / advanced leave, max 7 days per year (borrow logic handled in backend rules).',
    requiresBalance: false,
    yearlyEntitlement: 0,
    accrualPerMonth: 0,
    yearlyLimit: 7,
    fixedDurationDays: 0,
    allowNegative: false,
    isSystem: true,
    isActive: true,
    systemLocked: true,
    order: 4,
  },
  {
    code: 'UL',
    name: 'Unpaid Leave (UL)',
    description: 'Unpaid leave – no balance, no yearly limit.',
    requiresBalance: false,
    yearlyEntitlement: 0,
    accrualPerMonth: 0,
    yearlyLimit: 0,
    fixedDurationDays: 0,
    allowNegative: false,
    isSystem: true,
    isActive: true,
    systemLocked: true,
    order: 5,
  },
]

module.exports = { SYSTEM_LEAVE_TYPES }
