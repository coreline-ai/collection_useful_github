import { closePool, query, readSchemaSql } from './db.js'

export const migrate = async () => {
  const schemaSql = readSchemaSql()
  await query(schemaSql)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => {
      console.log('[migrate] schema applied')
      return closePool()
    })
    .catch(async (error) => {
      console.error('[migrate] failed', error)
      await closePool()
      process.exitCode = 1
    })
}
