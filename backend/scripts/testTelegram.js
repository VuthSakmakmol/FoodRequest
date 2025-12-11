/* eslint-disable no-console */
require('dotenv').config()
const https = require('https')

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHAT_ID   = process.env.TELEGRAM_LEAVE_FALLBACK_CHAT_ID || '7163451169' // 👈 put your own chat id here if you want

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN missing in .env')
  process.exit(1)
}

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data)
    const u = new URL(url)

    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }

    const req = https.request(options, (res) => {
      let chunks = ''
      res.on('data', (d) => { chunks += d })
      res.on('end', () => {
        try {
          const json = chunks ? JSON.parse(chunks) : null
          console.log('✅ Telegram response:', json)
          resolve(json)
        } catch (e) {
          console.log('⚠️ Could not parse response:', chunks)
          resolve(null)
        }
      })
    })

    req.on('error', (err) => {
      console.error('❌ Request error:', err)
      reject(err)
    })

    req.write(body)
    req.end()
  })
}

async function run() {
  console.log('BOT_TOKEN exists?', !!BOT_TOKEN)
  console.log('Sending test message to CHAT_ID:', CHAT_ID)

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`
  const payload = {
    chat_id: CHAT_ID,
    text: '👋 HRSS Leave test message from Node.js',
    parse_mode: 'HTML',
  }

  await postJson(url, payload)
}

run().catch(err => {
  console.error('❌ Test failed:', err)
})
