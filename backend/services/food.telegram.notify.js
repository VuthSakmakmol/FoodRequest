// backend/services/food.telegram.notify.js
/* eslint-disable no-console */
const FoodRequest = require('../models/FoodRequest')
const { sendToAll } = require('./telegram.sender')              // your group broadcast (TELEGRAM_ADMIN_CHAT_IDS or FOOD group)
const { sendDM } = require('./transport.telegram.service')      // reuse DM sender
const msg = require('./telegram.messages')                      // the file you showed
const { listChefChatIds } = require('./food.telegram.recipients')

const DEBUG = String(process.env.TELEGRAM_DEBUG || 'false').toLowerCase() === 'true'
const ENABLE_CHEF_DM = String(process.env.TELEGRAM_NOTIFY_CHEF_DM || 'true').toLowerCase() === 'true'

async function notifyFood(event, payload) {
  if (DEBUG) console.log('[food.notify]', event, payload)

  const getReq = async () => {
    const doc = await FoodRequest.findById(payload.requestId).lean()
    if (!doc) console.warn('[food.notify] request not found', { event, requestId: payload.requestId })
    return doc
  }

  switch (event) {
    // 🍽 NEW FOOD REQUEST CREATED
    case 'FOOD_REQUEST_CREATED': {
      const doc = await getReq(); if (!doc) return

      const text = msg.newRequestMsg(doc)

      // 1) Group alert (what you already do)
      await sendToAll(text)

      // 2) DM all chefs
      if (ENABLE_CHEF_DM) {
        const chefs = await listChefChatIds()
        if (DEBUG) console.log('[food.notify] chef chatIds', chefs)

        await Promise.allSettled(
          chefs.map((c) =>
            sendDM(c.chatId, text)
          )
        )
      }

      return
    }

    // (optional) You can also DM chefs on status updates if you want:
    case 'FOOD_STATUS_UPDATED': {
      const doc = await getReq(); if (!doc) return

      const text = msg.statusUpdateMsg(doc)

      // group
      await sendToAll(text)

      // DM chefs
      if (ENABLE_CHEF_DM) {
        const chefs = await listChefChatIds()
        await Promise.allSettled(chefs.map((c) => sendDM(c.chatId, text)))
      }
      return
    }

    default:
      if (DEBUG) console.log('[food.notify] unhandled event', event)
      return
  }
}

module.exports = { notifyFood }
