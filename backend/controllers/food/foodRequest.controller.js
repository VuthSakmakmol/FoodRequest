// backend/controllers/food/foodRequest.controller.js
const mongoose = require('mongoose');
const dayjs = require('dayjs');
const FoodRequest = require('../../models/food/FoodRequest');
const EmployeeDirectory = require('../../models/EmployeeDirectory');
const { emitCounterpart } = require('../../utils/realtime');

// 🔔 Telegram notify (optional)
const { sendToAll } = require('../../services/telegram.service');
const {
  newRequestMsg, acceptedMsg, cookingMsg, readyMsg, deliveredMsg, cancelMsg
} = require('../../services/telegram.messages');

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);
const normDate = (d) => { const v = new Date(d); return isNaN(v.getTime()) ? null : v };

// ───────── constants ─────────
const MENU_ENUM = ['Standard','Vegetarian','Vegan','No pork','No beef'];
const BASE_MENU = 'Standard';

// Limits
const MAX_RECURRING_DAYS = Number(process.env.MAX_RECURRING_DAYS || 30);

// Holidays: comma-separated YYYY-MM-DD (e.g., 2025-01-01,2025-04-14)
const HOLIDAY_SET = new Set(
  String(process.env.HOLIDAYS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

// Khmer rule: Sunday = holiday; Saturday is NOT
const isSunday = (dateStr) => dayjs(dateStr).day() === 0;
const isHoliday = (dateStr) => isSunday(dateStr) || HOLIDAY_SET.has(dateStr);

// ───────── helpers ─────────
function coerceMenuCounts(input, qty) {
  let items = [];

  if (Array.isArray(input)) {
    items = input
      .map(x => ({ choice: x?.choice, count: Number(x?.count || 0) }))
      .filter(x => MENU_ENUM.includes(x.choice) && x.count > 0);
  } else if (input && typeof input === 'object') {
    items = Object.entries(input)
      .map(([choice, cnt]) => ({ choice, count: Number(cnt || 0) }))
      .filter(x => MENU_ENUM.includes(x.choice) && x.count > 0);
  }

  const map = new Map();
  for (const it of items) map.set(it.choice, (map.get(it.choice) || 0) + it.count);
  items = Array.from(map, ([choice, count]) => ({ choice, count }));

  const q = Number(qty || 0);
  const specials = items
    .filter(x => x.choice !== BASE_MENU)
    .reduce((s, x) => s + x.count, 0);

  if (specials > q) {
    return {
      ok: false,
      reason: 'SPECIALS_EXCEED_QTY',
      counts: items.filter(x => x.choice !== BASE_MENU),
      total: specials,
      delta: specials - q
    };
  }

  const standard = q - specials;
  const iStd = items.findIndex(x => x.choice === BASE_MENU);
  if (iStd === -1) items.push({ choice: BASE_MENU, count: standard });
  else items[iStd].count = standard;

  items = items.filter(x => x.count > 0);
  const total = items.reduce((s, x) => s + x.count, 0);
  return { ok: total === q, reason: null, counts: items, total, delta: total - q };
}

function coerceDietaryCounts(input) {
  let arr = [];
  if (Array.isArray(input)) {
    arr = input
      .map(x => ({
        allergen: x?.allergen,
        count: Number(x?.count || 0),
        menu: x?.menu || BASE_MENU,
      }))
      .filter(x => x.allergen && x.count > 0 && MENU_ENUM.includes(x.menu));
  } else if (input && typeof input === 'object') {
    arr = Object.entries(input)
      .map(([allergen, v]) => ({
        allergen,
        count: Number(v?.count || 0),
        menu: v?.menu || BASE_MENU,
      }))
      .filter(x => x.allergen && x.count > 0 && MENU_ENUM.includes(x.menu));
  }

  const key = (x) => `${x.menu}__${x.allergen}`;
  const map = new Map();
  for (const it of arr) {
    const k = key(it);
    map.set(k, {
      allergen: it.allergen,
      menu: it.menu,
      count: (map.get(k)?.count || 0) + it.count
    });
  }
  return Array.from(map.values());
}

function buildEatDateRange(query) {
  const from = query.from || query.dateStart;
  const to   = query.to   || query.dateEnd;
  if (!from && !to) return null;

  const range = {};
  if (from) {
    const f = new Date(`${from}T00:00:00.000Z`);
    if (!isNaN(f.getTime())) range.$gte = f;
  }
  if (to) {
    const t = new Date(`${to}T23:59:59.999Z`);
    if (!isNaN(t.getTime())) range.$lte = t;
  }
  return Object.keys(range).length ? range : null;
}

function clampEndDate(eatDate, endDate) {
  const s = dayjs(eatDate).startOf('day');
  let e = dayjs(endDate).startOf('day');
  if (!e.isValid() || e.isBefore(s)) e = s;
  const maxE = s.add(Math.max(MAX_RECURRING_DAYS - 1, 0), 'day');
  if (e.isAfter(maxE)) e = maxE;
  return e.format('YYYY-MM-DD');
}

// ───────── CREATE (public) ─────────
exports.createRequest = async (req, res, next) => {
  try {
    const body = req.body;

    // ---- validations (unchanged) ----
    const employeeId = body?.employee?.employeeId || body.employeeId;
    if (!employeeId) return res.status(400).json({ message: 'Invalid Employee ID' });

    const emp = await EmployeeDirectory.findOne({ employeeId, isActive: true });
    if (!emp) return res.status(400).json({ message: 'Invalid Employee ID' });

    if (!Array.isArray(body.meals) || body.meals.length === 0)
      return res.status(400).json({ message: 'At least one meal is required' });

    const eatDate = normDate(body.eatDate);
    if (!eatDate) return res.status(400).json({ message: 'Eat date is required/invalid' });

    if (!Array.isArray(body.menuChoices) || body.menuChoices.length === 0)
      return res.status(400).json({ message: 'At least one menu choice is required' });

    if (!body?.location?.kind) return res.status(400).json({ message: 'Location.kind is required' });

    const qty = Number(body.quantity || 0);
    if (!qty || qty < 1) return res.status(400).json({ message: 'Quantity must be >= 1' });

    const normMenus = coerceMenuCounts(body.menuCounts, qty);
    if (!normMenus.ok) {
      return res.status(400).json({
        message: 'Menu counts invalid',
        reason: normMenus.reason,
        detail: { total: normMenus.total, delta: normMenus.delta, counts: normMenus.counts }
      });
    }

    const dietaryCounts = coerceDietaryCounts(body.dietaryCounts);

    // Common payload bits
    const baseDoc = {
      orderDate: new Date(),
      eatDate,
      eatTimeStart: body.eatTimeStart || null,
      eatTimeEnd: body.eatTimeEnd || null,

      employee: { employeeId: emp.employeeId, name: emp.name, department: emp.department },
      orderType: body.orderType,
      meals: body.meals,
      quantity: qty,
      location: body.location,

      menuChoices: body.menuChoices,
      menuCounts: normMenus.counts,

      dietary: Array.isArray(body.dietary) ? body.dietary : [],
      dietaryCounts,
      dietaryOther: body.dietaryOther || '',

      specialInstructions: body.specialInstructions || '',

      status: 'NEW',
      statusHistory: [{ status: 'NEW', at: new Date() }],
      notified: { deliveredAt: null, reminderSentAt: null },
    };

    // ─────────────────────────────────────────────────────────────
    // RECURRING FLOW: link the first occurrence to a template
    // ─────────────────────────────────────────────────────────────
    if (body?.recurring?.enabled) {
      if (!body.endDate && !body.recurring.endDate) {
        return res.status(400).json({ message: 'End Date is required when Recurring = Yes' });
      }

      // clamp end date to max allowed, ensure ISO
      const eatISO = dayjs(eatDate).format('YYYY-MM-DD');
      const endDateISO = clampEndDate(eatISO, body.recurring.endDate || body.endDate);
      const endDateObj = new Date(`${endDateISO}T00:00:00.000Z`);
      const skipHolidays = !!body.recurring.skipHolidays;

      // 1) Create a template for this recurring schedule
      const tpl = await RecurringTemplate.create({
        owner: {
          employeeId: emp.employeeId,
          name: emp.name,
          department: emp.department
        },
        orderType: body.orderType,
        meals: body.meals,
        quantity: qty,

        location: body.location,
        menuChoices: body.menuChoices,
        menuCounts: normMenus.counts,

        dietary: Array.isArray(body.dietary) ? body.dietary : [],
        dietaryCounts,
        dietaryOther: body.dietaryOther || '',

        frequency: 'Daily',
        startDate: new Date(dayjs(eatDate).format('YYYY-MM-DD') + 'T00:00:00.000Z'),
        endDate: endDateObj,
        skipHolidays,

        eatTimeStart: body.eatTimeStart || null,
        eatTimeEnd: body.eatTimeEnd || null,

        timezone: 'Asia/Phnom_Penh',
        status: 'ACTIVE',
        // move engine to tomorrow (prevent double-create today)
        nextRunAt: dayjs(eatDate).add(1, 'day').startOf('day').toDate(),
        skipDates: []
      });

      // 2) If today's occurrence already exists (race), reuse it
      const occurrenceDate = eatISO; // keep as 'YYYY-MM-DD' string per your schema
      const existing = await FoodRequest.findOne({
        'recurring.templateId': tpl._id,
        'recurring.occurrenceDate': occurrenceDate
      }).lean();

      if (existing) {
        try { await sendToAll(newRequestMsg(existing)); } catch (e) { console.warn('[Telegram] notify failed:', e?.message); }
        emitCounterpart(req.io, 'foodRequest:created', existing);
        return res.status(200).json(existing);
      }

      // 3) Create today's **linked** occurrence
      const payload = {
        ...baseDoc,
        recurring: {
          enabled: true,
          frequency: 'Daily',
          endDate: endDateObj,
          skipHolidays,
          parentId: null,
          source: 'RECURRING',
          templateId: tpl._id,
          occurrenceDate // 'YYYY-MM-DD'
        }
      };

      const doc = await FoodRequest.create(payload);

      try { await sendToAll(newRequestMsg(doc)); }
      catch (e) { console.warn('[Telegram] new request notify failed:', e?.message); }

      emitCounterpart(req.io, 'foodRequest:created', doc);
      return res.status(201).json(doc);
    }

    // ─────────────────────────────────────────────────────────────
    // NON-RECURRING FLOW: manual one-off (no linkage fields)
    // ─────────────────────────────────────────────────────────────
    const doc = await FoodRequest.create({
      ...baseDoc,
      recurring: { enabled: false, frequency: null, endDate: null, skipHolidays: false, parentId: null, source: 'MANUAL' }
      // NOTE: do NOT set templateId / occurrenceDate here
    });

    try { await sendToAll(newRequestMsg(doc)); }
    catch (e) { console.warn('[Telegram] new request notify failed:', e?.message); }

    emitCounterpart(req.io, 'foodRequest:created', doc);
    return res.status(201).json(doc);

  } catch (err) {
    next(err);
  }
};


// ───────── LIST (public/employee/admin) ─────────
exports.listRequests = async (req, res, next) => {
  try {
    const q = {};
    if (req.query.status) q.status = req.query.status;
    if (req.query.employeeId) q['employee.employeeId'] = req.query.employeeId;

    if (req.query.q) {
      const rx = new RegExp(req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      q.$or = [
        { orderType: rx },
        { menuChoices: rx },
        { 'location.kind': rx },
        { specialInstructions: rx },
        { requestId: rx }
      ];
    }

    const range = buildEatDateRange(req.query);
    if (range) q.eatDate = range;

    const page  = Math.max(parseInt(req.query.page  || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);
    const skip  = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      FoodRequest.find(q).sort({ eatDate: 1, createdAt: -1 }).skip(skip).limit(limit),
      FoodRequest.countDocuments(q),
    ]);

    res.json({ rows, page, limit, total });
  } catch (err) { next(err); }
};

// ───────── UPDATE STATUS (admin/chef) ─────────
exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ message: 'Invalid ID' });

    const { status, reason } = req.body || {};
    const allowed = ['NEW', 'ACCEPTED', 'COOKING', 'READY', 'DELIVERED', 'CANCELED'];
    if (!allowed.includes(status)) return res.status(400).json({ message: 'Invalid status' });

    let doc = await FoodRequest.findByIdAndUpdate(
      id,
      {
        $set: { status },
        $push: { statusHistory: { status, by: req.user?.id || req.user?.loginId || 'admin', at: new Date() } }
      },
      { new: true, runValidators: true }
    );
    if (!doc) return res.status(404).json({ message: 'Not found' });

    // 🔔 Notify depending on status
    try {
      if (status === 'ACCEPTED') await sendToAll(acceptedMsg(doc));
      if (status === 'COOKING')  await sendToAll(cookingMsg(doc));
      if (status === 'READY')    await sendToAll(readyMsg(doc));
      if (status === 'DELIVERED') {
        const alreadyNotified = !!doc?.notified?.deliveredAt;
        if (!alreadyNotified) {
          await sendToAll(deliveredMsg(doc));
          doc.notified = doc.notified || {};
          doc.notified.deliveredAt = new Date();
          await doc.save();
        }
      }
      if (status === 'CANCELED') {
        doc.cancelReason = reason || '';
        await doc.save();
        await sendToAll(cancelMsg(doc));
      }
    } catch (e) {
      console.warn('[Telegram] notify failed:', e?.message);
    }

    emitCounterpart(req.io, 'foodRequest:statusChanged', doc);
    res.json(doc);
  } catch (err) { next(err); }
};

// ───────── GENERAL EDIT (admin/chef) ─────────
exports.updateRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ message: 'Invalid ID' });

    const current = await FoodRequest.findById(id);
    if (!current) return res.status(404).json({ message: 'Not found' });

    const body = req.body || {};
    const {
      orderType, meals, eatDate, eatTimeStart, eatTimeEnd,
      quantity, location,
      menuChoices, menuCounts,
      dietary, dietaryCounts, dietaryOther,
      specialInstructions, recurring
    } = body;

    const nextQty = (quantity !== undefined) ? Number(quantity) : Number(current.quantity);
    if (!nextQty || nextQty < 1) return res.status(400).json({ message: 'Quantity must be >= 1' });

    const $set = {};
    if (orderType !== undefined)       $set.orderType = orderType;
    if (Array.isArray(meals))          $set.meals = meals;
    if (eatDate !== undefined)         $set.eatDate = normDate(eatDate);
    if (eatTimeStart !== undefined)    $set.eatTimeStart = eatTimeStart;
    if (eatTimeEnd !== undefined)      $set.eatTimeEnd = eatTimeEnd;
    if (quantity !== undefined)        $set.quantity = nextQty;
    if (location !== undefined)        $set.location = location;
    if (Array.isArray(menuChoices))    $set.menuChoices = menuChoices;

    if (menuCounts !== undefined) {
      const normMenus = coerceMenuCounts(menuCounts, nextQty);
      if (!normMenus.ok) {
        return res.status(400).json({
          message: 'Menu counts invalid',
          reason: normMenus.reason,
          detail: { total: normMenus.total, delta: normMenus.delta, counts: normMenus.counts }
        });
      }
      $set.menuCounts = normMenus.counts;
    }

    if (dietaryCounts !== undefined)   $set.dietaryCounts = coerceDietaryCounts(dietaryCounts);

    if (Array.isArray(dietary))        $set.dietary = dietary;
    if (dietaryOther !== undefined)    $set.dietaryOther = dietaryOther;
    if (specialInstructions !== undefined) $set.specialInstructions = specialInstructions;

    // Recurring edit (UI provides endDate + skipHolidays only)
    if (recurring !== undefined) {
      if (recurring?.enabled) {
        const eatStr = dayjs($set.eatDate || current.eatDate).format('YYYY-MM-DD');
        const endStr = clampEndDate(eatStr, recurring.endDate || eatStr);
        $set.recurring = {
          enabled: true,
          frequency: 'Daily',
          endDate: new Date(`${endStr}T00:00:00.000Z`),
          skipHolidays: !!recurring.skipHolidays,
          parentId: current.recurring?.parentId || null
        };
      } else {
        $set.recurring = {
          enabled: false, frequency: null, endDate: null, skipHolidays: false, parentId: null
        };
      }
    }

    const doc = await FoodRequest.findByIdAndUpdate(id, { $set }, { new: true, runValidators: true });
    if (!doc) return res.status(404).json({ message: 'Not found' });

    emitCounterpart(req.io, 'foodRequest:updated', doc);
    res.json(doc);
  } catch (err) { next(err); }
};

// ───────── DELETE (admin/chef) ─────────
exports.deleteRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ message: 'Invalid ID' });

    const doc = await FoodRequest.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ message: 'Not found' });

    emitCounterpart(req.io, 'foodRequest:deleted', { _id: id, employee: doc.employee });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

// ───────── DASHBOARD ─────────
exports.dashboard = async (_req, res, next) => {
  try {
    const countsAgg = await FoodRequest.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);
    const counts = countsAgg.reduce((a, x) => { a[x._id] = x.count; return a }, {});

    const perDay = await FoodRequest.aggregate([
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$eatDate" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    const meals = await FoodRequest.aggregate([
      { $unwind: "$meals" },
      { $group: { _id: "$meals", count: { $sum: "$quantity" } } },
      { $sort: { count: -1 } }
    ]);

    const menuTypes = await FoodRequest.aggregate([
      { $unwind: "$menuCounts" },
      { $group: { _id: "$menuCounts.choice", count: { $sum: "$menuCounts.count" } } }
    ]);

    const recent = await FoodRequest.find({}).sort({ createdAt: -1 }).limit(10);

    res.json({ counts, perDay, meals, menuTypes, recent });
  } catch (err) { next(err); }
};
