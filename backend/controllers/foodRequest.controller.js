// backend/controllers/foodRequest.controller.js
const mongoose = require('mongoose');
const FoodRequest = require('../models/FoodRequest');
const EmployeeDirectory = require('../models/EmployeeDirectory');
const { emitCounterpart } = require('../utils/realtime');

// 🔔 Telegram notify
const { sendToAll } = require('../services/telegram.service');
const { newRequestMsg, deliveredMsg, cancelMsg } = require('../services/telegram.messages');

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);
const normDate = (d) => { const v = new Date(d); return isNaN(v.getTime()) ? null : v };

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

    const serveDate = normDate(body.serveDate);
    if (!serveDate) return res.status(400).json({ message: 'Serve date is required/invalid' });

    if (!body.menuType) return res.status(400).json({ message: 'Menu type is required' });
    if (!body?.location?.kind) return res.status(400).json({ message: 'Location.kind is required' });

    const payload = {
      ...body,
      serveDate,
      employee: { employeeId: emp.employeeId, name: emp.name, department: emp.department },
      status: 'NEW',
      statusHistory: [{ status: 'NEW', at: new Date() }],
      // Guard field to mark that "delivered" was already notified
      notified: { deliveredAt: null },
    };

    const doc = await FoodRequest.create(payload);

    // 🔔 Telegram: New request
    try {
      await sendToAll(newRequestMsg(doc));
    } catch (e) {
      console.warn('[Telegram] new request notify failed:', e?.message);
    }

    emitCounterpart(req.io, 'foodRequest:created', doc);
    return res.status(201).json(doc);
  } catch (err) { next(err); }
};

/* ───────── LIST (public/employee) ───────── */
exports.listRequests = async (req, res, next) => {
  try {
    const q = {};
    if (req.query.status) q.status = req.query.status;
    if (req.query.employeeId) q['employee.employeeId'] = req.query.employeeId;
    if (req.query.q) {
      const rx = new RegExp(req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      q.$or = [
        { orderType: rx },
        { menuType: rx },
        { 'location.kind': rx },
        { specialInstructions: rx }
      ];
    }

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      FoodRequest.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit),
      FoodRequest.countDocuments(q),
    ]);
    res.json({ rows, page, limit, total });
  } catch (err) { next(err); }
};

/* ───────── UPDATE STATUS (admin/chef) ───────── */
exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    console.log('[PATCH status] id =', id);
    if (!isObjectId(id)) return res.status(400).json({ message: 'Invalid ID' });

    const { status, reason } = req.body || {};
    const allowed = ['NEW', 'ACCEPTED', 'COOKING', 'READY', 'DELIVERED', 'CANCELED'];
    if (!allowed.includes(status)) return res.status(400).json({ message: 'Invalid status' });

    // Update status and push to history
    let doc = await FoodRequest.findByIdAndUpdate(
      id,
      {
        $set: { status },
        $push: { statusHistory: { status, by: req.user?.id || req.user?.loginId || 'admin', at: new Date() } }
      },
      { new: true, runValidators: true }
    );
    if (!doc) return res.status(404).json({ message: 'Not found' });

    console.log('[PATCH status] updated:', id, '=>', status);

    // 🔔 Notify depending on status
    if (status === 'DELIVERED') {
      const alreadyNotified = !!doc?.notified?.deliveredAt;
      if (!alreadyNotified) {
        try {
          await sendToAll(deliveredMsg(doc));
        } catch (e) {
          console.warn('[Telegram] delivered notify failed:', e?.message);
        }

        doc.notified = doc.notified || {};
        doc.notified.deliveredAt = new Date();
        await doc.save();
      }
    }

    if (status === 'CANCELED') {
      doc.cancelReason = reason || '';
      await doc.save();

      try {
        await sendToAll(cancelMsg(doc));
      } catch (e) {
        console.warn('[Telegram] cancel notify failed:', e?.message);
      }
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

    const {
      orderType, meals, serveDate, timeStart, timeEnd,
      quantity, location, menuType, dietary, dietaryOther,
      specialInstructions, recurring
    } = req.body || {};

    const $set = {};
    if (orderType !== undefined)       $set.orderType = orderType;
    if (Array.isArray(meals))          $set.meals = meals;
    if (serveDate !== undefined)       $set.serveDate = normDate(serveDate);
    if (timeStart !== undefined)       $set.timeStart = timeStart;
    if (timeEnd !== undefined)         $set.timeEnd = timeEnd;
    if (quantity !== undefined)        $set.quantity = quantity;
    if (location !== undefined)        $set.location = location;
    if (menuType !== undefined)        $set.menuType = menuType;
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


exports.dashboard = async (req, res, next) => {
  try {
    // ✅ Counts by status
    const countsAgg = await FoodRequest.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ])
    const counts = countsAgg.reduce((a, x) => {
      a[x._id] = x.count
      return a
    }, {})

    // ✅ Per day (group by serveDate as YYYY-MM-DD)
    const perDay = await FoodRequest.aggregate([
      { $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$serveDate" } },
          count: { $sum: 1 }
      }},
      { $sort: { _id: 1 } }
    ])

    // ✅ Meals breakdown
    const meals = await FoodRequest.aggregate([
      { $unwind: "$meals" },
      { $group: { _id: "$meals", count: { $sum: "$quantity" } } },
      { $sort: { count: -1 } }
    ])

    // ✅ Menu Types
    const menuTypes = await FoodRequest.aggregate([
      { $group: { _id: "$menuType", count: { $sum: "$quantity" } } }
    ])

    // ✅ Recent requests
    const recent = await FoodRequest.find({})
      .sort({ createdAt: -1 })
      .limit(10)

    res.json({
      counts,
      perDay,
      meals,
      menuTypes,
      recent
    })
  } catch (err) {
    next(err)
  }
}

