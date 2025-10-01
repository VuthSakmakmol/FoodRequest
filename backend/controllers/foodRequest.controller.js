// backend/controllers/foodRequest.controller.js
const mongoose = require('mongoose');
const FoodRequest = require('../models/FoodRequest');
const EmployeeDirectory = require('../models/EmployeeDirectory');
const { emitCounterpart } = require('../utils/realtime');

// 🔔 Telegram notify (optional; keep if wired)
const { sendToAll } = require('../services/telegram.service');
const { newRequestMsg, acceptedMsg, cookingMsg, readyMsg, deliveredMsg, cancelMsg } = require('../services/telegram.messages');

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);
const normDate = (d) => { const v = new Date(d); return isNaN(v.getTime()) ? null : v };

/* ───────── constants ───────── */
const MENU_ENUM = ['Standard','Vegetarian','Vegan','No pork','No beef'];
const BASE_MENU = 'Standard';

/* ───────── helpers ───────── */
/**
 * Normalize/validate menu counts for a given quantity.
 * - Treat "Standard" as BASE bucket = qty - sum(specials)
 * - Ignore any user-entered Standard (overwrite it)
 * - Return { ok:false } if specials > qty
 * - Accepts array or object
 */
function coerceMenuCounts(input, qty) {
  let items = [];

  if (Array.isArray(input)) {
    // [{ choice, count }]
    items = input
      .map(x => ({ choice: x?.choice, count: Number(x?.count || 0) }))
      .filter(x => MENU_ENUM.includes(x.choice) && x.count > 0);
  } else if (input && typeof input === 'object') {
    // { "Vegan": 2, "Standard": 8 }
    items = Object.entries(input)
      .map(([choice, cnt]) => ({ choice, count: Number(cnt || 0) }))
      .filter(x => MENU_ENUM.includes(x.choice) && x.count > 0);
  }

  // merge duplicates
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

  // ✅ overwrite Standard (do NOT +=)
  const iStd = items.findIndex(x => x.choice === BASE_MENU);
  if (iStd === -1) items.push({ choice: BASE_MENU, count: standard });
  else items[iStd].count = standard;

  // keep only positive counts
  items = items.filter(x => x.count > 0);

  const total = items.reduce((s, x) => s + x.count, 0);
  return { ok: total === q, reason: null, counts: items, total, delta: total - q };
}

/**
 * Normalize dietary counts into [{ allergen, count, menu }]
 * - Accepts array or object
 * - Merges by {menu, allergen}
 */
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

  // merge by {menu, allergen}
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

/* Inclusive date range builder for list endpoint */
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
    // inclusive end-of-day
    const t = new Date(`${to}T23:59:59.999Z`);
    if (!isNaN(t.getTime())) range.$lte = t;
  }
  return Object.keys(range).length ? range : null;
}

/* ───────── CREATE (public) ───────── */
exports.createRequest = async (req, res, next) => {
  try {
    const body = req.body;
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

    // Normalize menu counts (fixes the "Standard stays 4" bug)
    const normMenus = coerceMenuCounts(body.menuCounts, qty);
    if (!normMenus.ok) {
      return res.status(400).json({
        message: 'Menu counts invalid',
        reason: normMenus.reason,
        detail: { total: normMenus.total, delta: normMenus.delta, counts: normMenus.counts }
      });
    }

    const dietaryCounts = coerceDietaryCounts(body.dietaryCounts);

    const payload = {
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
      recurring: body.recurring || {},

      status: 'NEW',
      statusHistory: [{ status: 'NEW', at: new Date() }],
      notified: { deliveredAt: null },
    };

    const doc = await FoodRequest.create(payload);

    try { await sendToAll(newRequestMsg(doc)); }
    catch (e) { console.warn('[Telegram] new request notify failed:', e?.message); }

    emitCounterpart(req.io, 'foodRequest:created', doc);
    return res.status(201).json(doc);
  } catch (err) { next(err); }
};

/* ───────── LIST (public/employee/admin) ───────── */
exports.listRequests = async (req, res, next) => {
  try {
    const q = {};

    // status & employee
    if (req.query.status) q.status = req.query.status;
    if (req.query.employeeId) q['employee.employeeId'] = req.query.employeeId;

    // free text search
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

    // 🔹 date filter on eatDate (supports from/to OR dateStart/dateEnd), inclusive
    const range = buildEatDateRange(req.query);
    if (range) q.eatDate = range;

    // pagination
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

/* ───────── UPDATE STATUS (admin/chef) ───────── */
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
    if (status === 'ACCEPTED') {
      try { await sendToAll(acceptedMsg(doc)); }
      catch (e) { console.warn('[Telegram] accepted notify failed:', e?.message); }
    }

    if (status === 'COOKING') {
      try { await sendToAll(cookingMsg(doc)); }
      catch (e) { console.warn('[Telegram] cooking notify failed:' , e?.message); }
    }

    if (status === 'READY') {
      try {
        await sendToAll(readyMsg(doc));
      } catch (e) {
        console.warn('[Telegram] ready notify failed:', e?.message);
      }
    }

    if (status === 'DELIVERED') {
      const alreadyNotified = !!doc?.notified?.deliveredAt;
      if (!alreadyNotified) {
        try { await sendToAll(deliveredMsg(doc)); }
        catch (e) { console.warn('[Telegram] delivered notify failed:', e?.message); }
        doc.notified = doc.notified || {};
        doc.notified.deliveredAt = new Date();
        await doc.save();
      }
    }

    if (status === 'CANCELED') {
      doc.cancelReason = reason || '';
      await doc.save();
      try { await sendToAll(cancelMsg(doc)); }
      catch (e) { console.warn('[Telegram] cancel notify failed:', e?.message); }
    }

    emitCounterpart(req.io, 'foodRequest:statusChanged', doc);
    res.json(doc);
  } catch (err) { next(err); }
};

/* ───────── GENERAL EDIT (admin/chef) ───────── */
exports.updateRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ message: 'Invalid ID' });

    // fetch current doc to know quantity if client doesn't send it
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
    if (recurring !== undefined)       $set.recurring = recurring;

    const doc = await FoodRequest.findByIdAndUpdate(id, { $set }, { new: true, runValidators: true });
    if (!doc) return res.status(404).json({ message: 'Not found' });

    emitCounterpart(req.io, 'foodRequest:updated', doc);
    res.json(doc);
  } catch (err) { next(err); }
};

/* ───────── DELETE (admin/chef) ───────── */
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

/* ───────── DASHBOARD ───────── */
exports.dashboard = async (req, res, next) => {
  try {
    const countsAgg = await FoodRequest.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);
    const counts = countsAgg.reduce((a, x) => { a[x._id] = x.count; return a }, {});

    const perDay = await FoodRequest.aggregate([
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$eatDate" } },
          count: { $sum: 1 }
        }
      },
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
