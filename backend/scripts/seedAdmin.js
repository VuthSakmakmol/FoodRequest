// scripts/seedUsers.js
require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const User = require('../models/User');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {})

    /* ---------- helpers ---------- */
    const hash = (pwd) => bcrypt.hash(pwd, 10)

    // upsert a single user (set telegramChatId if provided)
    async function upsertUser({ loginId, name, role, password, telegramChatId, isActive = true }) {
      const doc = await User.findOne({ loginId })
      if (!doc) {
        const passwordHash = await hash(password)
        await User.create({
          loginId,
          name,
          role,
          passwordHash,
          isActive,
          ...(telegramChatId ? { telegramChatId: String(telegramChatId) } : {}),
        })
        console.log(`🆕 Created ${role}: ${loginId}${telegramChatId ? ` (tg:${telegramChatId})` : ''}`)
        return
      }

      // Update fields if changed (including telegramChatId)
      let changed = false
      if (name && doc.name !== name) { doc.name = name; changed = true }
      if (typeof isActive === 'boolean' && doc.isActive !== isActive) { doc.isActive = isActive; changed = true }
      if (telegramChatId && String(doc.telegramChatId || '') !== String(telegramChatId)) {
        doc.telegramChatId = String(telegramChatId)
        changed = true
      }
      if (changed) {
        await doc.save()
        console.log(`✏️  Updated ${role}: ${loginId}${telegramChatId ? ` (tg:${telegramChatId})` : ''}`)
      } else {
        console.log(`✅ Exists ${role}: ${loginId}${doc.telegramChatId ? ` (tg:${doc.telegramChatId})` : ''}`)
      }
    }

    async function ensureAdmin() {
      const loginId  = process.env.ADMIN_LOGIN || 'admin'
      const name     = process.env.ADMIN_NAME || 'Admin'
      const password = process.env.ADMIN_PASSWORD || 'Passw0rd!'

      const exists = await User.findOne({ loginId })
      if (exists) {
        // optionally keep admin’s telegramChatId in ENV ADMIN_TG_CHAT_ID
        if (process.env.ADMIN_TG_CHAT_ID && String(exists.telegramChatId || '') !== String(process.env.ADMIN_TG_CHAT_ID)) {
          exists.telegramChatId = String(process.env.ADMIN_TG_CHAT_ID)
          await exists.save()
          console.log(`✏️  Updated ADMIN tg:${exists.telegramChatId}`)
        } else {
          console.log('✅ Admin exists:', loginId)
        }
        return
      }

      const passwordHash = await hash(password)
      await User.create({ loginId, name, passwordHash, role: 'ADMIN' })
      console.log('🆕 Admin created:', loginId)
    }

    async function seedUsers(role, list) {
      for (const u of list) {
        const loginId = String(u.loginId).trim()
        if (!loginId) continue
        await upsertUser({
          loginId,
          name: u.name,
          role,
          password: u.password,
          telegramChatId: u.telegramChatId, // ← will be set/updated if provided
          isActive: true,
        })
      }
    }

    /* ---------- data ---------- */
    const defaultPwd = process.env.USER_DEFAULT_PASSWORD || '123456'

    // Example chefs
    const chefs = [
      { loginId: '001', name: 'Chef One', password: defaultPwd, telegramChatId: '7163451169' },
      { loginId: '002', name: 'Chef Two', password: defaultPwd },
    ]

    // 👉 Put driver/messenger chat IDs here when you have them.
    // You said one driver(messenger) chat ID is 537250678 — attach it to the right user(s).
    // If that’s driver01, do this:
    const drivers = [
      { loginId: '010', name: 'Prius',   password: defaultPwd, telegramChatId: '1893892841' },
      { loginId: '020', name: 'Staria',   password: defaultPwd, telegramChatId: '871865728' },
      { loginId: '030', name: 'New Van', password: defaultPwd, telegramChatId: '5534785017' },
      { loginId: '040', name: 'Test car', password: defaultPwd, telegramChatId: '7163451169' },
    ]

    // bong nith  1055055243 
    // bong rida  661186113
    // Ah Mab 1102968377
    // Bro Ant 7163451169
    // Bong Cheat 5534785017
    // Kakvey 899957340
    // Bong Hong 1893892841
    // bong Por 635269035

    // If that same ID is for messenger01 instead, move it here (and remove from driver01):
    const messengers = [
      { loginId: '111', name: 'Messenger One',   password: defaultPwd  , telegramChatId: '7163451169' },
    ]

    /* ---------- run ---------- */
    await ensureAdmin()
    await seedUsers('CHEF', chefs)
    await seedUsers('DRIVER', drivers)
    await seedUsers('MESSENGER', messengers)

    console.log('✅ Seeding complete')
    process.exit(0)
  } catch (e) {
    console.error('❌ Seeding error:', e)
    process.exit(1)
  }
})()


/*
{
  "ok": true,
  "result": [
    {
      "update_id": 66280439,
      "message": {
        "message_id": 1603,
        "from": {
          "id": 1893892841,
          "is_bot": false,
          "first_name": "Seng",
          "last_name": "Hong",
          "language_code": "km"
        },
        "chat": {
          "id": 1893892841,
          "first_name": "Seng",
          "last_name": "Hong",
          "type": "private"
        },
        "date": 1765761248,
        "text": "/start",
        "entities": [
          {
            "offset": 0,
            "length": 6,
            "type": "bot_command"
          }
        ]
      }
    },
    {
      "update_id": 66280440,
      "message": {
        "message_id": 1635,
        "from": {
          "id": 328458629,
          "is_bot": false,
          "first_name": "Seang",
          "last_name": "Rachana",
          "language_code": "en"
        },
        "chat": {
          "id": 328458629,
          "first_name": "Seang",
          "last_name": "Rachana",
          "type": "private"
        },
        "date": 1765763234,
        "text": "/start",
        "entities": [
          {
            "offset": 0,
            "length": 6,
            "type": "bot_command"
          }
        ]
      }
    },
    {
      "update_id": 66280441,
      "message": {
        "message_id": 1636,
        "from": {
          "id": 1894826858,
          "is_bot": false,
          "first_name": "Kris",
          "last_name": "Dino",
          "language_code": "en"
        },
        "chat": {
          "id": 1894826858,
          "first_name": "Kris",
          "last_name": "Dino",
          "type": "private"
        },
        "date": 1765763415,
        "text": "/start",
        "entities": [
          {
            "offset": 0,
            "length": 6,
            "type": "bot_command"
          }
        ]
      }
    },
    {
      "update_id": 66280442,
      "message": {
        "message_id": 1637,
        "from": {
          "id": 1894826858,
          "is_bot": false,
          "first_name": "Kris",
          "last_name": "Dino",
          "language_code": "en"
        },
        "chat": {
          "id": 1894826858,
          "first_name": "Kris",
          "last_name": "Dino",
          "type": "private"
        },
        "date": 1765763446,
        "text": "/start",
        "entities": [
          {
            "offset": 0,
            "length": 6,
            "type": "bot_command"
          }
        ]
      }
    },
    {
      "update_id": 66280443,
      "message": {
        "message_id": 1638,
        "from": {
          "id": 1894826858,
          "is_bot": false,
          "first_name": "Kris",
          "last_name": "Dino",
          "language_code": "en"
        },
        "chat": {
          "id": 1894826858,
          "first_name": "Kris",
          "last_name": "Dino",
          "type": "private"
        },
        "date": 1765763448,
        "text": "/start",
        "entities": [
          {
            "offset": 0,
            "length": 6,
            "type": "bot_command"
          }
        ]
      }
    },
    {
      "update_id": 66280444,
      "message": {
        "message_id": 1640,
        "from": {
          "id": 5075400953,
          "is_bot": false,
          "first_name": "mala",
          "last_name": "pisiao",
          "language_code": "en"
        },
        "chat": {
          "id": 5075400953,
          "first_name": "mala",
          "last_name": "pisiao",
          "type": "private"
        },
        "date": 1765771093,
        "text": "/start",
        "entities": [
          {
            "offset": 0,
            "length": 6,
            "type": "bot_command"
          }
        ]
      }
    },
    {
      "update_id": 66280445,
      "message": {
        "message_id": 1641,
        "from": {
          "id": 8586270804,
          "is_bot": false,
          "first_name": "Lara",
          "last_name": "Hernal",
          "username": "lrjdhrnl",
          "language_code": "en"
        },
        "chat": {
          "id": 8586270804,
          "first_name": "Lara",
          "last_name": "Hernal",
          "username": "lrjdhrnl",
          "type": "private"
        },
        "date": 1765771119,
        "text": "/start",
        "entities": [
          {
            "offset": 0,
            "length": 6,
            "type": "bot_command"
          }
        ]
      }
    },
    {
      "update_id": 66280446,
      "message": {
        "message_id": 1642,
        "from": {
          "id": 8586270804,
          "is_bot": false,
          "first_name": "Lara",
          "last_name": "Hernal",
          "username": "lrjdhrnl",
          "language_code": "en"
        },
        "chat": {
          "id": 8586270804,
          "first_name": "Lara",
          "last_name": "Hernal",
          "username": "lrjdhrnl",
          "type": "private"
        },
        "date": 1765771174,
        "text": "/start",
        "entities": [
          {
            "offset": 0,
            "length": 6,
            "type": "bot_command"
          }
        ]
      }
    },
    {
      "update_id": 66280447,
      "message": {
        "message_id": 1643,
        "from": {
          "id": 8586270804,
          "is_bot": false,
          "first_name": "Lara",
          "last_name": "Hernal",
          "username": "lrjdhrnl",
          "language_code": "en"
        },
        "chat": {
          "id": 8586270804,
          "first_name": "Lara",
          "last_name": "Hernal",
          "username": "lrjdhrnl",
          "type": "private"
        },
        "date": 1765771201,
        "text": "send"
      }
    },
    {
      "update_id": 66280448,
      "message": {
        "message_id": 1650,
        "from": {
          "id": 635269035,
          "is_bot": false,
          "first_name": "𝔄𝔫 𝔠𝔥𝔥𝔢𝔫𝔤𝔭𝔬𝔯",
          "username": "Por_chheng_an",
          "language_code": "en"
        },
        "chat": {
          "id": 635269035,
          "first_name": "𝔄𝔫 𝔠𝔥𝔥𝔢𝔫𝔤𝔭𝔬𝔯",
          "username": "Por_chheng_an",
          "type": "private"
        },
        "date": 1765779251,
        "text": "/start",
        "entities": [
          {
            "offset": 0,
            "length": 6,
            "type": "bot_command"
          }
        ]
      }
    },
    {
      "update_id": 66280449,
      "message": {
        "message_id": 1668,
        "from": {
          "id": 6457848091,
          "is_bot": false,
          "first_name": "Koontip",
          "last_name": "Kumwong",
          "username": "Koontip",
          "language_code": "en"
        },
        "chat": {
          "id": 6457848091,
          "first_name": "Koontip",
          "last_name": "Kumwong",
          "username": "Koontip",
          "type": "private"
        },
        "date": 1765779858,
        "text": "/start",
        "entities": [
          {
            "offset": 0,
            "length": 6,
            "type": "bot_command"
          }
        ]
      }
    },
    {
      "update_id": 66280450,
      "message": {
        "message_id": 1669,
        "from": {
          "id": 6457848091,
          "is_bot": false,
          "first_name": "Koontip",
          "last_name": "Kumwong",
          "username": "Koontip",
          "language_code": "en"
        },
        "chat": {
          "id": 6457848091,
          "first_name": "Koontip",
          "last_name": "Kumwong",
          "username": "Koontip",
          "type": "private"
        },
        "date": 1765779961,
        "text": "👍"
      }
    },
    {
      "update_id": 66280451,
      "message": {
        "message_id": 1672,
        "from": {
          "id": 1098217402,
          "is_bot": false,
          "first_name": "Chhay✨",
          "username": "O_sml_3",
          "language_code": "en"
        },
        "chat": {
          "id": 1098217402,
          "first_name": "Chhay✨",
          "username": "O_sml_3",
          "type": "private"
        },
        "date": 1765781474,
        "text": "/start",
        "entities": [
          {
            "offset": 0,
            "length": 6,
            "type": "bot_command"
          }
        ]
      }
    },
    {
      "update_id": 66280452,
      "message": {
        "message_id": 1673,
        "from": {
          "id": 1212888135,
          "is_bot": false,
          "first_name": "សិទ្ធ",
          "username": "Zea_Seth168",
          "language_code": "en"
        },
        "chat": {
          "id": 1212888135,
          "first_name": "សិទ្ធ",
          "username": "Zea_Seth168",
          "type": "private"
        },
        "date": 1765781534,
        "text": "/start",
        "entities": [
          {
            "offset": 0,
            "length": 6,
            "type": "bot_command"
          }
        ]
      }
    },
    {
      "update_id": 66280453,
      "message": {
        "message_id": 1674,
        "from": {
          "id": 6467962794,
          "is_bot": false,
          "first_name": "Lekena",
          "language_code": "en"
        },
        "chat": {
          "id": 6467962794,
          "first_name": "Lekena",
          "type": "private"
        },
        "date": 1765781538,
        "text": "/start",
        "entities": [
          {
            "offset": 0,
            "length": 6,
            "type": "bot_command"
          }
        ]
      }
    },
    {
      "update_id": 66280454,
      "message": {
        "message_id": 1675,
        "from": {
          "id": 1278119141,
          "is_bot": false,
          "first_name": "Srun",
          "last_name": "Socheat",
          "username": "Socheat_sr",
          "language_code": "en"
        },
        "chat": {
          "id": 1278119141,
          "first_name": "Srun",
          "last_name": "Socheat",
          "username": "Socheat_sr",
          "type": "private"
        },
        "date": 1765781642,
        "text": "/start",
        "entities": [
          {
            "offset": 0,
            "length": 6,
            "type": "bot_command"
          }
        ]
      }
    },
    {
      "update_id": 66280455,
      "message": {
        "message_id": 1676,
        "from": {
          "id": 1212888135,
          "is_bot": false,
          "first_name": "សិទ្ធ",
          "username": "Zea_Seth168",
          "language_code": "en"
        },
        "chat": {
          "id": 1212888135,
          "first_name": "សិទ្ធ",
          "username": "Zea_Seth168",
          "type": "private"
        },
        "date": 1765781699,
        "text": "Hi Nit \nI would like to book car on tmr\nTime 8:00am\nBack 10:00am\nPurpose : pick up parcel\nPlace : Khainam\nDept : account\nThank you"
      }
    },
    {
      "update_id": 66280456,
      "message": {
        "message_id": 1677,
        "from": {
          "id": 1098217402,
          "is_bot": false,
          "first_name": "Chhay✨",
          "username": "O_sml_3",
          "language_code": "en"
        },
        "chat": {
          "id": 1098217402,
          "first_name": "Chhay✨",
          "username": "O_sml_3",
          "type": "private"
        },
        "date": 1765781720,
        "text": "/start",
        "entities": [
          {
            "offset": 0,
            "length": 6,
            "type": "bot_command"
          }
        ]
      }
    },
    {
      "update_id": 66280457,
      "message": {
        "message_id": 1687,
        "from": {
          "id": 1447485727,
          "is_bot": false,
          "first_name": "Ako",
          "last_name": "si yobs",
          "username": "akosiyobs",
          "language_code": "en"
        },
        "chat": {
          "id": 1447485727,
          "first_name": "Ako",
          "last_name": "si yobs",
          "username": "akosiyobs",
          "type": "private"
        },
        "date": 1765789774,
        "text": "/start",
        "entities": [
          {
            "offset": 0,
            "length": 6,
            "type": "bot_command"
          }
        ]
      }
    },
    {
      "update_id": 66280458,
      "message": {
        "message_id": 1688,
        "from": {
          "id": 1447485727,
          "is_bot": false,
          "first_name": "Ako",
          "last_name": "si yobs",
          "username": "akosiyobs",
          "language_code": "en"
        },
        "chat": {
          "id": 1447485727,
          "first_name": "Ako",
          "last_name": "si yobs",
          "username": "akosiyobs",
          "type": "private"
        },
        "date": 1765789816,
        "text": "Can i book a car this saturday night around 8pm send me to takmaw airport"
      }
    },
    {
      "update_id": 66280459,
      "message": {
        "message_id": 1689,
        "from": {
          "id": 8271477569,
          "is_bot": false,
          "first_name": "Joel",
          "last_name": "Arcayan",
          "language_code": "en"
        },
        "chat": {
          "id": 8271477569,
          "first_name": "Joel",
          "last_name": "Arcayan",
          "type": "private"
        },
        "date": 1765790303,
        "text": "/start",
        "entities": [
          {
            "offset": 0,
            "length": 6,
            "type": "bot_command"
          }
        ]
      }
    }
  ]
}
*/