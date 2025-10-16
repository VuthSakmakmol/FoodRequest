// backend/services/recurring.engine.js
const dayjs = require('dayjs');
const FoodRequest = require('../models/food/FoodRequest');
const RecurringTemplate = require('../models/food/RecurringTemplate');
const { sendToAll } = require('./telegram.service');
const { newRequestMsg } = require('./telegram.messages');

// Holidays from .env (YYYY-MM-DD, comma-separated)
const HOLIDAY_SET = new Set(
  String(process.env.HOLIDAYS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

// Khmer rule: Sundays are holidays; Saturdays are NOT
const isSunday = (dateStr) => dayjs(dateStr).day() === 0;
const isHolidayCore = (dateStr) => isSunday(dateStr) || HOLIDAY_SET.has(dateStr);

// Default time when none provided
const DEFAULT_MORNING_ALERT = String(process.env.DEFAULT_MORNING_ALERT || '07:00');

// safe HH:mm
function hhmm(s) {
  const [h='07', m='00'] = String(s || '').split(':');
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// next local day 00:00:00Z (we rely on process.env.TZ for Node's local time)
function nextDayStart(dateStr) {
  return dayjs(dateStr).add(1, 'day').startOf('day').toDate();
}

async function createOccurrenceIfNeeded(tpl, todayStr) {
  // 0) User skips / holidays
  const isSkippedByUser = Array.isArray(tpl.skipDates) && tpl.skipDates.includes(todayStr);
  const isHoliday = tpl.skipHolidays ? isHolidayCore(todayStr) : false;
  if (isSkippedByUser || isHoliday) return null;

  // 1) Already exists? (idempotency)
  const exists = await FoodRequest.findOne({
    'recurring.templateId': tpl._id,
    'recurring.occurrenceDate': todayStr
  }).lean();
  if (exists) return null;

  // 2) Build linked occurrence
  const eatDate = new Date(`${todayStr}T00:00:00.000Z`);
  const payload = {
    orderDate: new Date(),
    eatDate,
    eatTimeStart: tpl.eatTimeStart || null,
    eatTimeEnd:   tpl.eatTimeEnd   || null,

    employee: {
      employeeId: tpl.owner.employeeId,
      name: tpl.owner.name || '',
      department: tpl.owner.department || ''
    },

    orderType: tpl.orderType,
    meals: tpl.meals,
    quantity: tpl.quantity,
    location: tpl.location,

    menuChoices: tpl.menuChoices,
    menuCounts: tpl.menuCounts,

    dietary: tpl.dietary,
    dietaryCounts: tpl.dietaryCounts,
    dietaryOther: tpl.dietaryOther,

    specialInstructions: tpl.specialInstructions || '',

    // Mark as RECURRING linked instance
    recurring: {
      enabled: true,
      frequency: tpl.frequency || 'Daily',
      endDate: tpl.endDate,
      skipHolidays: !!tpl.skipHolidays,
      parentId: null,
      source: 'RECURRING',
      templateId: tpl._id,
      occurrenceDate: todayStr // 'YYYY-MM-DD'
    },

    status: 'NEW',
    statusHistory: [{ status: 'NEW', at: new Date() }],
    notified: { deliveredAt: null, reminderSentAt: null },
  };

  try {
    const doc = await FoodRequest.create(payload);
    try { await sendToAll(newRequestMsg(doc)); }
    catch (e) { console.warn('[Recurring] Telegram notify failed:', e?.message); }
    return doc;
  } catch (e) {
    // Backstop for races: unique index on (templateId, occurrenceDate)
    if (e?.code === 11000) return null;
    throw e;
  }
}

async function tick(io) {
  // We assume Node process runs with correct TZ via process.env.TZ
  const now = dayjs();
  const todayStr = now.format('YYYY-MM-DD');
  const currentHHmm = hhmm(now.format('HH:mm'));
  const startOfToday = new Date(`${todayStr}T00:00:00.000Z`);

  // Fetch ACTIVE templates whose window covers today
  const templates = await RecurringTemplate.find({
    status: 'ACTIVE',
    startDate: { $lte: startOfToday },
    endDate: { $gte: startOfToday }
  }).lean();

  for (const tpl of templates) {
    const trigger = hhmm(tpl.eatTimeStart || DEFAULT_MORNING_ALERT);

    // 1) Respect trigger time (run once at/after trigger)
    if (currentHHmm < trigger) continue;

    // 2) Create if needed
    const created = await createOccurrenceIfNeeded(tpl, todayStr);

    // 3) Advance nextRunAt → tomorrow (even if nothing created due to skip/exists)
    //    so the engine doesn't keep re-checking and spamming logs in the same day
    const newNext = nextDayStart(todayStr);
    if (!tpl.nextRunAt || dayjs(tpl.nextRunAt).isBefore(newNext)) {
      await RecurringTemplate.updateOne(
        { _id: tpl._id },
        { $set: { nextRunAt: newNext } }
      );
    }

    // 4) Emit socket if we actually created a row
    if (created && io) io.emit('foodRequest:created', created);
  }
}

function startRecurringEngine(io) {
  const everyMs = Number(process.env.RECURRING_TICK_MS || 60_000); // default 1 min
  console.log(`[recurring] engine started. interval=${everyMs}ms`);
  const handle = setInterval(() => tick(io).catch(e => console.error('[recurring] tick error', e)), everyMs);
  return () => clearInterval(handle);
}

module.exports = { startRecurringEngine, tick };
