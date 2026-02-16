import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { Pool } from 'pg'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '../.env') })
dotenv.config()

const parseBoolean = (value, fallback = false) => {
  if (typeof value !== 'string') {
    return fallback
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') {
    return true
  }
  if (normalized === 'false') {
    return false
  }

  return fallback
}

const sslEnabled = parseBoolean(process.env.PGSSL, false)

const pool = (() => {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
      max: 10,
    })
  }

  return new Pool({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'useful_git_info',
    ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
    max: 10,
  })
})()

export const query = (text, params = []) => pool.query(text, params)
export const getClient = () => pool.connect()
export const closePool = () => pool.end()

export const readSchemaSql = () => {
  const schemaPath = path.resolve(__dirname, '../db/schema.sql')
  return fs.readFileSync(schemaPath, 'utf8')
}
