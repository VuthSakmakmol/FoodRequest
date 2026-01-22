// backend/services/food.telegram.notify.js
/* eslint-disable no-console */

const FoodRequest = require('../models/food/FoodRequest')

// ✅ use your existing sender service (this file already has sendToAll + sendDM)
const { sendToAll, sendDM } = require('./telegram.service')

const msg = require('./telegram.messages')
const { listChefChatIds } = require('./food.telegram.recipients')

const DEBUG = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'
const ENABLE_CHEF_DM =
  String(process.env.TELEGRAM_NOTIFY_CHEF_DM || 'true').toLowerCase() === 'true'

async function notifyFood(event, payload) {
  if (DEBUG) console.log('[food.notify]', event, payload)

  const getReq = async () => {
    const reqId = payload?.requestId
    if (!reqId) {
      console.warn('[food.notify] requestId missing', { event, payload })
      return null
    }

    const doc = await FoodRequest.findById(reqId).lean()
    if (!doc) console.warn('[food.notify] request not found', { event, requestId: reqId })
    return doc
  }

  const sendChefDMsKh = async (doc) => {
    if (!ENABLE_CHEF_DM) return
    const chefs = await listChefChatIds()
    if (DEBUG) console.log('[food.notify] chef chatIds', chefs)

    // ✅ CHEF DM must be Khmer
    const s = String(doc?.status || 'NEW').toUpperCase()
    let textKh = null

    // Keep only your real statuses: NEW, ACCEPTED, CANCELED
    if (s === 'NEW') textKh = msg.chefNewRequestDM(doc)
    else if (s === 'ACCEPTED') textKh = msg.chefAcceptedDM(doc)
    else if (s === 'CANCELED') textKh = msg.chefCancelDM(doc)
    else textKh = msg.chefNewRequestDM(doc) // fallback safe

    await Promise.allSettled(chefs.map((c) => sendDM(c.chatId, textKh)))
  }

  switch (event) {
    // 🍽 NEW FOOD REQUEST CREATED
    case 'FOOD_REQUEST_CREATED': {
      const doc = await getReq()
      if (!doc) return

      // ✅ group message (EN)
      const groupText = msg.newRequestMsg(doc)
      await sendToAll(groupText)

      // ✅ chef DM (KH)
      await sendChefDMsKh(doc)
      return
    }

    // ✅ Status updated (only send ONE message per status change)
    case 'FOOD_STATUS_UPDATED': {
      const doc = await getReq()
      if (!doc) return

      // ✅ group message (EN) - reflects NEW/ACCEPTED/CANCELED
      const groupText = msg.statusUpdateMsg(doc)
      await sendToAll(groupText)

      // ✅ chef DM (KH)
      await sendChefDMsKh(doc)
      return
    }

    default:
      if (DEBUG) console.log('[food.notify] unhandled event', event)
      return
  }
}

module.exports = { notifyFood }
