// backend/utils/gridfs.js
const mongoose = require('mongoose')
const { GridFSBucket, ObjectId } = require('mongodb')

// cache bucket by dbName (safe even if you add more connections later)
const buckets = new Map()

function pickReadyConnection() {
  const conns = Array.isArray(mongoose.connections) ? mongoose.connections : []
  const ready = conns.find((c) => c && c.readyState === 1 && c.db)
  if (ready) return ready

  const c = mongoose.connection
  if (c && c.readyState === 1 && c.db) return c

  return null
}

function getBucket() {
  const conn = pickReadyConnection()
  if (!conn?.db) {
    throw new Error(
      `MongoDB not ready for GridFS. readyStates=[${(mongoose.connections || [])
        .map((c) => c?.readyState)
        .join(',')}]`
    )
  }

  const dbName = conn.db.databaseName || 'default'
  if (!buckets.has(dbName)) {
    buckets.set(dbName, new GridFSBucket(conn.db, { bucketName: 'signatures' }))
  }
  return buckets.get(dbName)
}

function toObjectId(id) {
  if (!id) return null
  if (id instanceof ObjectId) return id
  try {
    return new ObjectId(String(id))
  } catch {
    return null
  }
}

// ✅ IMPORTANT: return the actual file document (with uploadDate/length/etc.)
async function uploadBuffer({ buffer, filename, contentType, metadata }) {
  const b = getBucket()

  const fileId = await new Promise((resolve, reject) => {
    const stream = b.openUploadStream(filename, {
      contentType,
      metadata: metadata || {},
    })
    stream.on('error', reject)
    stream.on('finish', () => resolve(stream.id)) // finish has no args → use stream.id
    stream.end(buffer)
  })

  // fetch the stored file doc so controller can read uploadDate, length, contentType...
  const doc = await b.find({ _id: fileId }).limit(1).toArray()
  return doc?.[0] || { _id: fileId, filename, contentType, metadata }
}

async function deleteFile(fileId) {
  const oid = toObjectId(fileId)
  if (!oid) return
  const b = getBucket()
  await b.delete(oid)
}

module.exports = { getBucket, uploadBuffer, deleteFile, toObjectId }
