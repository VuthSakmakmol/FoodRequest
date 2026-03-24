/* eslint-disable no-console */
// backend/jobs/leave.balanceRecalculate.job.js

const { recalculateAllProfiles } = require('../services/leave/leave.recalculate.service')

let timer = null
let running = false

function getNowInPhnomPenhParts() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Phnom_Penh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value])
  )

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

function msUntilNextMidnightPhnomPenh() {
  const now = getNowInPhnomPenhParts()
  const secondsToday = now.hour * 3600 + now.minute * 60 + now.second
  const secondsUntilMidnight = 24 * 3600 - secondsToday
  return Math.max(5_000, secondsUntilMidnight * 1000)
}

async function runLeaveBalanceRecalculateJob() {
  if (running) {
    console.log('ℹ️ Leave balance recalculate job skipped: already running')
    return
  }

  running = true
  try {
    console.log('🕛 Leave balance recalculate job started')
    const result = await recalculateAllProfiles({
      filter: { isActive: true },
      asOfDate: new Date(),
      log: true,
    })
    console.log(
      `✅ Leave balance recalculate job finished | total=${result.total} fixed=${result.fixed} failed=${result.failed}`
    )
  } catch (err) {
    console.error('❌ Leave balance recalculate job error:', err)
  } finally {
    running = false
  }
}

function scheduleNextRun() {
  const waitMs = msUntilNextMidnightPhnomPenh()
  timer = setTimeout(async () => {
    await runLeaveBalanceRecalculateJob()
    scheduleNextRun()
  }, waitMs)

  if (typeof timer.unref === 'function') timer.unref()
  console.log(`⏰ Leave balance recalculate job scheduled in ${Math.round(waitMs / 1000)}s`)
}

function startLeaveBalanceRecalculateJob() {
  if (timer) return
  scheduleNextRun()
}

function stopLeaveBalanceRecalculateJob() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

module.exports = {
  startLeaveBalanceRecalculateJob,
  stopLeaveBalanceRecalculateJob,
  runLeaveBalanceRecalculateJob,
}