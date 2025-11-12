// backend/controllers/carBooking.controller.js
const createError = require('http-errors');
const CarBooking = require('../../models/transportation/CarBooking');

let User = null;
try { User = require('../../models/User'); } catch { User = null; }

let Employee = null;
try { Employee = require('../models/Employee'); } catch {
  try { Employee = require('../../models/EmployeeDirectory'); } catch { Employee = null; }
}

const { ROOMS, emitToRoom } = require('../../utils/realtime');
const { toMinutes, overlaps, isValidDate } = require('../../utils/time');
const { notify } = require('../../services/transport.telegram.notify');

const { io } = require('../../utils/realtime')

const MAX_CAR  = 3;
const MAX_MSGR = 1;

const FORWARD = {
  PENDING:   new Set(['ACCEPTED','CANCELLED']),
  ACCEPTED:  new Set(['ON_ROAD','DELAYED','CANCELLED']),
  ON_ROAD:   new Set(['ARRIVING','DELAYED','CANCELLED']),
  ARRIVING:  new Set(['COMPLETED','DELAYED','CANCELLED']),
  DELAYED:   new Set(['ON_ROAD','ARRIVING','CANCELLED']),
  COMPLETED: new Set([]),
  CANCELLED: new Set([]),
};

/* ───────── assignment helpers ───────── */
function hasAssignee(doc) {
  // Car uses driverId; Messenger uses messengerId
  if (!doc?.assignment) return false
  if (doc.category === 'Messenger') return !!doc.assignment.messengerId
  return !!doc.assignment.driverId
}
function assigneeIdOf(doc) {
  return doc?.category === 'Messenger'
    ? (doc?.assignment?.messengerId || '')
    : (doc?.assignment?.driverId || '')
}

/* ───────── helpers ───────── */
function parsePayload(req) {
  if (req.file) {
    if (!req.body?.data) throw createError(400, 'Missing "data" field in multipart form.');
    try { return JSON.parse(req.body.data); } catch { throw createError(400, 'Invalid JSON in "data".'); }
  }
  return req.body || {};
}

/* ───────────── Helper: pick identity safely ───────────── */
function pickIdentityFrom(req) {
  const loginId =
    req.headers['x-login-id'] ||
    req.user?.loginId ||
    req.query.loginId ||
    req.session?.user?.loginId ||
    req.cookies?.loginId ||
    ''
  const role =
    (
      req.headers['x-role'] ||
      req.user?.role ||
      req.query.role ||
      req.session?.user?.role ||
      req.cookies?.role ||
      ''
    )
      .toString()
      .toUpperCase()

  return { loginId: String(loginId || ''), role }
}

/** Minimal delta payloads */
const shape = {
  created: (doc) => ({
    _id: String(doc._id),
    employeeId: doc.employeeId,
    category: doc.category,
    tripDate: doc.tripDate,
    timeStart: doc.timeStart,
    timeEnd: doc.timeEnd,
    status: doc.status,
  }),
  status: (doc) => ({
    bookingId: String(doc._id),
    status: doc.status,
  }),
  assigned: (doc) => ({
    bookingId: String(doc._id),
    driverId: doc.assignment?.driverId || '',
    driverName: doc.assignment?.driverName || '',
    vehicleId: doc.assignment?.vehicleId || '',
    vehicleName: doc.assignment?.vehicleName || '',
    tripDate: doc.tripDate,
    timeStart: doc.timeStart,
    timeEnd: doc.timeEnd,
    status: doc.status,
  }),
  driverAck: (doc) => ({
    bookingId: String(doc._id),
    response: doc.assignment?.driverAck || 'PENDING',
    at: doc.assignment?.driverAckAt || null,
  }),
  updated: (doc) => ({
    bookingId: String(doc._id),
    patch: {
      category: doc.category,
      tripDate: doc.tripDate,
      timeStart: doc.timeStart,
      timeEnd: doc.timeEnd,
      passengers: doc.passengers,
      customerContact: doc.customerContact,
      stops: doc.stops || [],
      purpose: doc.purpose || '',
      notes: doc.notes || '',
      ticketUrl: doc.ticketUrl || '',
    }
  }),
  deleted: (doc) => ({
    bookingId: String(doc._id),
  }),
};

/* ───────────── Helper: real-time broadcast ───────────── */
function broadcast(io, doc, event, payload) {
  if (!io || !doc) return
  const empId = String(doc.employeeId || doc.employee?.employeeId || '')
  const rooms = new Set([
    ROOMS.ADMINS,
    empId && ROOMS.EMPLOYEE(empId),
    ROOMS.BOOKING(String(doc._id))
  ])
  for (const r of rooms) if (r) emitToRoom(io, r, event, payload)
}


/* ───────── public ───────── */
async function checkAvailability(req, res, next) {
  try {
    const { date, start, end, category } = req.query;
    if (!isValidDate(date)) throw createError(400, 'Invalid date (YYYY-MM-DD).');
    if (!start || !end) throw createError(400, 'start and end are required (HH:MM).');
    if (!['Car','Messenger'].includes(category)) throw createError(400, 'Invalid category.');
    const s = toMinutes(start), e = toMinutes(end);
    if (e <= s) throw createError(400, 'End must be after Start.');

    const docs = await CarBooking.find({ tripDate: date, category, status: { $nin: ['CANCELLED'] } }).lean();
    const busy = docs.filter(b => overlaps(s, e, toMinutes(b.timeStart), toMinutes(b.timeEnd))).length;
    const max = category === 'Car' ? MAX_CAR : MAX_MSGR;
    res.json({ date, start, end, category, busy, max, available: Math.max(0, max - busy) });
  } catch (err) { next(err); }
}

/** PUBLIC: read-only day schedule for timelines/calendars
 *  GET /api/public/transport/schedule?date=YYYY-MM-DD&category=Car|Messenger&status=PENDING&driverId=loginId
 */
async function listSchedulePublic(req, res, next) {
  try {
    const { date, category, status, driverId } = req.query;

    const filter = {};
    if (date) { if (!isValidDate(date)) throw createError(400, 'Invalid date (YYYY-MM-DD).'); filter.tripDate = date; }
    if (category && (category === 'Car' || category === 'Messenger')) filter.category = category;
    if (status && status !== 'ALL') filter.status = status;
    if (driverId) filter['assignment.driverId'] = String(driverId);

    const list = await CarBooking
      .find(filter)
      .sort({ tripDate: 1, timeStart: 1 })
      .lean();

    res.json(list);
  } catch (err) { next(err); }
}


async function createBooking(req, res, next) {
  try {
    const io = req.io;
    const payload = parsePayload(req);
    const { employeeId, category, tripDate, timeStart, timeEnd, passengers, customerContact, stops, purpose, notes } = payload;

    if (!employeeId) throw createError(400, 'employeeId is required.');
    if (!['Car','Messenger'].includes(category)) throw createError(400, 'Invalid category.');
    if (!isValidDate(tripDate)) throw createError(400, 'Invalid tripDate (YYYY-MM-DD).');
    if (!timeStart || !timeEnd) throw createError(400, 'timeStart and timeEnd are required (HH:MM).');

    const s = toMinutes(timeStart), e = toMinutes(timeEnd);
    if (e <= s) throw createError(400, 'End must be after Start.');

    if (!Array.isArray(stops) || stops.length === 0) throw createError(400, 'At least one destination (stop) is required.');
    for (let i = 0; i < stops.length; i++) {
      const st = stops[i];
      if (!st?.destination) throw createError(400, `Stop ${i+1}: destination is required.`);
      if (st.destination === 'Other' && !st.destinationOther) throw createError(400, `Stop ${i+1}: destinationOther is required for "Other".`);
    }

    const hasAirport = stops.some(st => st.destination === 'Airport');
    let ticketUrl = '';
    if (hasAirport) {
      if (!req.file) throw createError(400, 'Airplane ticket is required for Airport destination.');
      ticketUrl = `/uploads/${req.file.filename}`;
    } else if (req.file) {
      ticketUrl = `/uploads/${req.file.filename}`;
    }

    const active = await CarBooking.find({ tripDate, category, status: { $nin: ['CANCELLED'] } }).lean();
    const overlapping = active.filter(b => overlaps(s, e, toMinutes(b.timeStart), toMinutes(b.timeEnd))).length;
    const max = category === 'Car' ? MAX_CAR : MAX_MSGR;
    if (overlapping >= max) {
      return res.status(409).json({ message: `No ${category.toLowerCase()} available for ${tripDate} ${timeStart}-${timeEnd}.` });
    }

    let employeeSnapshot = { employeeId, name:'', department:'', contactNumber:'' };
    if (Employee) {
      const emp = await Employee.findOne({ employeeId }).lean();
      if (emp) employeeSnapshot = {
        employeeId: emp.employeeId, name: emp.name || '', department: emp.department || '', contactNumber: emp.contactNumber || ''
      };
    }

    const doc = await CarBooking.create({
      employeeId,
      employee: employeeSnapshot,
      category, tripDate, timeStart, timeEnd,
      passengers: Number(passengers || 1),
      customerContact: customerContact || '',
      stops, purpose: purpose || '', notes: notes || '',
      ticketUrl
    });

    // SOCKET (scoped)
    broadcast(io, doc, 'carBooking:created', shape.created(doc));

    // TELEGRAM
    try {
      console.log('[notify] REQUEST_CREATED', { bookingId: String(doc._id) });
      await notify('REQUEST_CREATED', { bookingId: doc._id, employeeName: employeeSnapshot?.name });
    } catch (e) {
      console.error('[notify error] REQUEST_CREATED', e?.message || e);
    }

    res.status(201).json(doc);
  } catch (err) { next(err); }
}

async function listMyBookings(req, res, next) {
  try {
    const { employeeId } = req.query;
    if (!employeeId) throw createError(400, 'employeeId is required.');
    const list = await CarBooking.find({ employeeId }).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (err) { next(err); }
}

/* ───────── admin ───────── */
async function updateStatus(req, res, next) {
  try {
    const io = req.io;
    const { id } = req.params;
    const { status } = req.body || {};
    const allowed = ['PENDING','ACCEPTED','ON_ROAD','ARRIVING','COMPLETED','DELAYED','CANCELLED'];
    if (!allowed.includes(status)) throw createError(400, 'Invalid status.');

    const doc = await CarBooking.findById(id);
    if (!doc) throw createError(404, 'Booking not found.');

    const from = doc.status || 'PENDING';
    if (!FORWARD[from] || !FORWARD[from].has(status)) {
      throw createError(400, `Cannot change from ${from} to ${status}`);
    }

    // 🚧 Hard rule: must be assigned before any non-CANCELLED status
    if (status !== 'CANCELLED' && !hasAssignee(doc)) {
      throw createError(400, 'You must assign a Driver/Messenger before changing status.');
    }

    doc.status = status;
    await doc.save();

    // SOCKET (delta to all relevant rooms)
    broadcast(io, doc, 'carBooking:status', shape.status(doc));

    console.log('[status] updated', { bookingId: String(doc._id), newStatus: doc.status });

    // TELEGRAM
    try {
      console.log('[notify] STATUS_CHANGED', { bookingId: String(doc._id), newStatus: doc.status });
      await notify('STATUS_CHANGED', { bookingId: doc._id, newStatus: doc.status, byName: req.user?.name });
    } catch (e) {
      console.error('[notify error] STATUS_CHANGED', e?.message || e);
    }

    res.json(doc);
  } catch (err) { next(err); }
}

/* ───────── admin assign booking ───────── */
async function assignBooking(req, res, next) {
  try {
    const io = req.io;
    const { id } = req.params;
    let {
      driverId = '',
      driverName = '',
      vehicleId = '',
      vehicleName = '',
      notes = '',
      assignedById = '',
      assignedByName = '',
      autoAccept = true,
      role = 'DRIVER' // <── NEW: explicit role from frontend tab
    } = req.body || {};

    if (!driverId) throw createError(400, 'driverId (loginId) is required.');
    role = String(role).toUpperCase();
    if (!['DRIVER', 'MESSENGER'].includes(role)) {
      throw createError(400, 'role must be DRIVER or MESSENGER');
    }

    // Normalize loginId
    driverId = String(driverId).trim().toLowerCase();

    const doc = await CarBooking.findById(id);
    if (!doc) throw createError(404, 'Booking not found.');

    // Resolve display name if not given
    let resolvedName = driverName;
    if (!resolvedName && User) {
      const u = await User.findOne({ loginId: driverId }).lean();
      if (u?.name) resolvedName = u.name;
    }

    // ───────── Prevent overlapping assignments for the chosen role ─────────
    const s = toMinutes(doc.timeStart), e = toMinutes(doc.timeEnd);
    const conflictField = role === 'MESSENGER' ? 'assignment.messengerId' : 'assignment.driverId';

    const conflictQuery = {
      _id: { $ne: doc._id },
      tripDate: doc.tripDate,
      status: { $nin: ['CANCELLED'] },
      [conflictField]: driverId
    };

    const others = await CarBooking.find(conflictQuery).lean();
    const hasConflict = others.some(b => overlaps(s, e, toMinutes(b.timeStart), toMinutes(b.timeEnd)));
    if (hasConflict) {
      const label = role === 'MESSENGER' ? 'Messenger' : 'Driver';
      return res.status(409).json({ message: `${label} already assigned during this time.` });
    }

    // ───────── Apply assignment ─────────
    // Always keep both fields in shape but only one is active depending on role
    const baseAssign = {
      vehicleId: vehicleId || '',
      vehicleName: vehicleName || '',
      notes: notes || '',
      assignedById: assignedById || '',
      assignedByName: assignedByName || '',
      assignedAt: new Date(),
      driverAck: 'PENDING',
      messengerAck: 'PENDING',
      driverAckAt: undefined,
      messengerAckAt: undefined
    };

    if (role === 'MESSENGER') {
      // Flip category to Messenger so UI/logic downstream stay consistent
      doc.category = 'Messenger';
      doc.assignment = {
        ...baseAssign,
        messengerId: driverId,
        messengerName: resolvedName || driverName || '',
        driverId: '',
        driverName: ''
      };
    } else {
      // DRIVER role
      doc.category = 'Car';
      doc.assignment = {
        ...baseAssign,
        driverId: driverId,
        driverName: resolvedName || driverName || '',
        messengerId: '',
        messengerName: ''
      };
    }

    // Auto-accept → move to ACCEPTED if workflow allows
    if (autoAccept) {
      const from = doc.status || 'PENDING';
      if (!FORWARD[from] || !FORWARD[from].has('ACCEPTED')) {
        throw createError(400, `Cannot change from ${from} to ACCEPTED`);
      }
      doc.status = 'ACCEPTED';
    }

    await doc.save();

    // Realtime
    broadcast(io, doc, 'carBooking:assigned', shape.assigned(doc));
    broadcast(io, doc, 'carBooking:status', shape.status(doc));

    // Telegram
    try {
      await notify('ADMIN_ACCEPTED_ASSIGNED', {
        bookingId: doc._id,
        byName: req.user?.name || assignedByName || 'System'
      });
    } catch (e) {
      console.error('[notify error] ADMIN_ACCEPTED_ASSIGNED', e?.message || e);
    }

    res.json(doc);
  } catch (err) {
    console.error('[assignBooking error]', err);
    next(err);
  }
}



async function listAdmin(req, res, next) {
  try {
    const { date, status } = req.query;
    const filter = {};
    if (date) { if (!isValidDate(date)) throw createError(400, 'Invalid date.'); filter.tripDate = date; }
    if (status && status !== 'ALL') filter.status = status;
    const list = await CarBooking.find(filter).sort({ tripDate: 1, timeStart: 1 }).lean();
    res.json(list);
  } catch (err) { next(err); }
}

/* ───────────── LIST FOR ASSIGNEE ───────────── */
async function listForAssignee(req, res, next) {
  try {
    const { loginId, role } = pickIdentityFrom(req)
    const driverId = req.query.driverId || loginId
    if (!driverId) return res.json([])

    const { date, status } = req.query
    const filter = {}

    if (role === 'DRIVER') {
      filter.category = 'Car'
      filter['assignment.driverId'] = driverId
    } else if (role === 'MESSENGER') {
      filter.$or = [
        { category: 'Messenger', 'assignment.messengerId': driverId },
        { category: 'Car', 'assignment.messengerId': driverId }
      ]
    } else {
      filter.employeeId = driverId
    }

    if (date) filter.tripDate = date
    if (status && status !== 'ALL') filter.status = status

    // 🧠 Add debug log
    console.log('[ListForAssignee]', JSON.stringify({ role, loginId, driverId, filter }, null, 2))

    const list = await CarBooking.find(filter)
      .sort({ tripDate: -1, timeStart: 1 })
      .lean()

    res.json(list)
  } catch (err) {
    console.error('[ListForAssignee error]', err)
    next(err)
  }
}




/* ───────────── DRIVER ACKNOWLEDGE ───────────── */
async function driverAcknowledge(req, res, next) {
  try {
    const io = req.io
    const { id } = req.params
    const { response } = req.body || {}
    const { loginId } = pickIdentityFrom(req)
    const normalized = (response || '').toUpperCase()

    const doc = await CarBooking.findById(id)
    if (!doc) throw createError(404, 'Booking not found')
    if (String(doc.assignment?.driverId) !== String(loginId))
      throw createError(403, 'Not allowed: not your booking')

    doc.assignment.driverAck = normalized
    doc.assignment.driverAckAt = new Date()
    await doc.save()

    broadcast(io, doc, 'carBooking:driverAck', {
      bookingId: String(doc._id),
      response: normalized
    })
    res.json(doc)
  } catch (err) {
    next(err)
  }
}


/* ───────────── DRIVER STATUS UPDATE ───────────── */
async function driverUpdateStatus(req, res, next) {
  try {
    const io = req.io
    const { id } = req.params
    const { status } = req.body || {}
    const { loginId } = pickIdentityFrom(req)

    if (!status) throw createError(400, 'Status is required.')

    const doc = await CarBooking.findById(id)
    if (!doc) throw createError(404, 'Booking not found.')

    // Must be the assigned driver
    if (String(doc.assignment?.driverId) !== String(loginId)) {
      throw createError(403, 'Not allowed: not your assigned booking.')
    }

    // Enforce workflow
    const from = doc.status || 'PENDING'
    const next = (status || '').toUpperCase()
    if (!FORWARD[from] || !FORWARD[from].has(next)) {
      throw createError(400, `Cannot change from ${from} to ${next}`)
    }

    // Defensive: ensure booking is assigned
    if (!hasAssignee(doc)) throw createError(400, 'Booking is not assigned.')

    doc.status = next
    doc.updatedAt = new Date()
    await doc.save()

    // Real-time broadcast
    if (io) io.to(`booking:${id}`).emit('carBooking:status', { bookingId: id, status: next })
    broadcast(io, doc, 'carBooking:status', { bookingId: id, status: next })

    console.log(`[driverUpdateStatus] ${loginId} → ${next} for ${id}`)

    // Telegram notify
    try {
      await notify('STATUS_CHANGED', { bookingId: doc._id, newStatus: next, byName: loginId })
    } catch (err) {
      console.error('[notify error] STATUS_CHANGED', err?.message || err)
    }

    res.json({ ok: true, message: 'Status updated', status: next })
  } catch (err) {
    console.error('Update status error', err)
    next(err)
  }
}


/* ───────── NEW: update (CRUD → U) ─────────
   Allows editing core fields; keeps your validations light and simple. */
async function updateBooking(req, res, next) {
  try {
    const io = req.io;
    const { id } = req.params;
    const payload = parsePayload(req);

    // never allow status/assignment changes via this endpoint
    if ('status' in payload || 'assignment' in payload) {
      throw createError(400, 'Not allowed to modify status/assignment here.')
    }

    const doc = await CarBooking.findById(id);
    if (!doc) throw createError(404, 'Booking not found.');

    // Editable fields (keep simple)
    const editable = [
      'category','tripDate','timeStart','timeEnd','passengers',
      'customerContact','stops','purpose','notes','ticketUrl'
    ];
    for (const k of editable) {
      if (payload[k] !== undefined) doc[k] = payload[k];
    }

    // basic time validity when both present
    if (doc.timeStart && doc.timeEnd) {
      const s = toMinutes(doc.timeStart), e = toMinutes(doc.timeEnd);
      if (e <= s) throw createError(400, 'End must be after Start.');
    }

    await doc.save();

    // Realtime
    broadcast(io, doc, 'carBooking:updated', shape.updated(doc));

    // Optional telegram (comment out if noisy)
    try {
      await notify('REQUEST_UPDATED', { bookingId: doc._id });
    } catch {}

    res.json(doc);
  } catch (err) { next(err); }
}



/* ───────── NEW: delete (CRUD → D) ─────────
   Hard delete. If you prefer soft delete, replace with doc.status='CANCELLED' + save. */
async function deleteBooking(req, res, next) {
  try {
    const io = req.io;
    const { id } = req.params;
    const doc = await CarBooking.findById(id);
    if (!doc) throw createError(404, 'Booking not found.');

    await CarBooking.deleteOne({ _id: id });

    // Realtime
    broadcast(io, doc, 'carBooking:deleted', shape.deleted(doc));

    // Optional telegram (comment out if noisy)
    try {
      await notify('REQUEST_DELETED', { bookingId: doc._id });
    } catch {}

    res.json({ ok: true });
  } catch (err) { next(err); }
}

/* ───────────── MESSENGER ACKNOWLEDGE ───────────── */
async function messengerAcknowledge(req, res, next) {
  try {
    const io = req.io
    const { id } = req.params
    const { response } = req.body || {}
    const { loginId } = pickIdentityFrom(req)
    const normalized = (response || '').toUpperCase()

    const doc = await CarBooking.findById(id)
    if (!doc) throw createError(404, 'Booking not found')
    if (String(doc.assignment?.messengerId) !== String(loginId))
      throw createError(403, 'Not allowed: not your booking')

    doc.assignment.messengerAck = normalized
    doc.assignment.messengerAckAt = new Date()
    await doc.save()

    broadcast(io, doc, 'carBooking:messengerAck', {
      bookingId: String(doc._id),
      response: normalized
    })
    res.json(doc)
  } catch (err) {
    next(err)
  }
}


/* ───────────── MESSENGER STATUS UPDATE ───────────── */
async function messengerUpdateStatus(req, res, next) {
  try {
    const io = req.io
    const { id } = req.params
    const { status } = req.body || {}
    const { loginId } = pickIdentityFrom(req)
    const nextStatus = (status || '').toUpperCase()

    const doc = await CarBooking.findById(id)
    if (!doc) throw createError(404, 'Booking not found')
    if (String(doc.assignment?.messengerId) !== String(loginId))
      throw createError(403, 'Not allowed')

    const from = doc.status || 'PENDING'
    if (!FORWARD[from] || !FORWARD[from].has(nextStatus)) {
      throw createError(400, `Cannot change from ${from} to ${nextStatus}`)
    }
    if (!hasAssignee(doc)) throw createError(400, 'Booking is not assigned.')

    doc.status = nextStatus
    await doc.save()
    broadcast(io, doc, 'carBooking:status', { bookingId: String(doc._id), status: nextStatus })

    // Telegram notify
    try {
      await notify('STATUS_CHANGED', {
        bookingId: doc._id,
        newStatus: nextStatus,
        byName: loginId
      })
    } catch (e) {
      console.error('[notify error] STATUS_CHANGED', e?.message || e)
    }

    res.json(doc)
  } catch (err) {
    next(err)
  }
}


// ─────────────────────────────
// LIST all assigned messenger tasks
// ─────────────────────────────
async function listMessengerTasks(req, res) {
  try {
    const messengerId = req.query.messengerId || req.headers['x-login-id']
    if (!messengerId) return res.status(400).json({ message: 'messengerId missing' })

    const filter = {
      $or: [
        { category: 'Messenger', 'assignment.messengerId': messengerId },
        { category: 'Car', 'assignment.messengerId': messengerId }
      ]
    }

    if (req.query.date) filter.tripDate = req.query.date
    if (req.query.status && req.query.status !== 'ALL') filter.status = req.query.status

    const rows = await CarBooking.find(filter)
      .sort({ tripDate: -1, timeStart: 1 })
      .lean()

    if (!rows.length) return res.status(404).json({ message: 'Not found' })
    res.json(rows)
  } catch (err) {
    console.error('listMessengerTasks error', err)
    res.status(500).json({ message: err.message || 'Internal error' })
  }
}


module.exports = {
  checkAvailability,
  createBooking,
  listMyBookings,
  updateStatus,
  assignBooking,
  listAdmin,
  listForAssignee,
  driverAcknowledge,
  driverUpdateStatus,
  messengerAcknowledge,
  messengerUpdateStatus,
  updateBooking,
  deleteBooking,
  listSchedulePublic,
  listMessengerTasks
}
