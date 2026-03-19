/* eslint-disable no-console */
// backend/jobs/leave.contractReminder.job.js

const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')

const { runLeaveContractReminderJob } = require('../services/leave/leave.contractReminder.service')

dayjs.extend(utc)
dayjs.extend(timezone)

function s(v) {
  return String(v ?? '').trim()
}

function num(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const JOB_ENABLED =
  String(process.env.LEAVE_CONTRACT_REMINDER_ENABLED || 'true').toLowerCase() === 'true'

const JOB_TIMEZONE = s(process.env.LEAVE_CONTRACT_REMINDER_TIMEZONE || 'Asia/Phnom_Penh')
const JOB_HOUR = num(process.env.LEAVE_CONTRACT_REMINDER_HOUR, 8)
const JOB_MINUTE = num(process.env.LEAVE_CONTRACT_REMINDER_MINUTE, 0)

let started = false
let timer = null
let running = false
let lastRunKey = ''

function getNowTz() {
  return dayjs().tz(JOB_TIMEZONE)
}

function getTodayRunKey() {
  return getNowTz().format('YYYY-MM-DD')
}

function shouldRunNow() {
  const now = getNowTz()
  return now.hour() === JOB_HOUR && now.minute() === JOB_MINUTE
}

async function executeOnce(reason = 'manual') {
  if (running) {
    console.log('[leave.contractReminder.job] skipped: already running')
    return
  }

  running = true
  try {
    console.log(`[leave.contractReminder.job] running (${reason})...`)
    const result = await runLeaveContractReminderJob()
    console.log('[leave.contractReminder.job] result:', result)

    if (reason === 'schedule') {
      lastRunKey = getTodayRunKey()
    }
  } catch (err) {
    console.error('[leave.contractReminder.job] failed:', err?.message)
  } finally {
    running = false
  }
}

function tick() {
  if (!JOB_ENABLED) return

  const now = getNowTz()
  const todayKey = now.format('YYYY-MM-DD')

  if (!shouldRunNow()) return
  if (lastRunKey === todayKey) return

  executeOnce('schedule').catch(() => {})
}

function startLeaveContractReminderJob() {
  if (started) return
  started = true

  console.log('[leave.contractReminder.job] started with config:', {
    enabled: JOB_ENABLED,
    timezone: JOB_TIMEZONE,
    hour: JOB_HOUR,
    minute: JOB_MINUTE,
  })

  if (!JOB_ENABLED) {
    console.log('[leave.contractReminder.job] disabled by env')
    return
  }

  // optional startup info only (does not send)
  const now = getNowTz()
  console.log(
    `[leave.contractReminder.job] current time in ${JOB_TIMEZONE}: ${now.format('YYYY-MM-DD HH:mm:ss')}`
  )

  // check every minute
  timer = setInterval(() => {
    tick()
  }, 60 * 1000)

  // also check shortly after startup
  setTimeout(() => {
    tick()
  }, 5000)
}

function stopLeaveContractReminderJob() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  started = false
  running = false
}

module.exports = {
  startLeaveContractReminderJob,
  stopLeaveContractReminderJob,
  executeOnce,
}