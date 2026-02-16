#!/usr/bin/env node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Level } from 'level'

const apiBase = process.env.RESTORE_API_BASE_URL || 'http://localhost:4000'
const sourcePath =
  process.env.CHROME_LOCALSTORAGE_LEVELDB_PATH ||
  path.join(os.homedir(), 'Library/Application Support/Google/Chrome/Default/Local Storage/leveldb')
const copyPath = path.join(os.tmpdir(), `chrome-ls-restore-${Date.now()}`)

const decodeValue = (buf) => {
  if (!buf || buf.length === 0) {
    return ''
  }

  const type = buf[0]
  if (type === 0) {
    return buf.subarray(1).toString('utf16le')
  }
  if (type === 1) {
    return buf.subarray(1).toString('utf8')
  }

  return buf.toString('utf8')
}

const keyFor = (name) => Buffer.from(`_http://localhost:5173\u0000\u0001${name}`, 'utf8')

const loadLocalDashboard = async () => {
  await fs.cp(sourcePath, copyPath, { recursive: true })
  const db = new Level(copyPath, { keyEncoding: 'buffer', valueEncoding: 'buffer' })
  await db.open()

  const read = async (name) => {
    try {
      return await db.get(keyFor(name))
    } catch {
      return null
    }
  }

  const cardsRaw = await read('github_cards_v1')
  const notesRaw = await read('github_notes_v1')
  const categoriesRaw = await read('github_categories_v1')
  const selectedRaw = await read('github_selected_category_v1')
  await db.close()

  if (!cardsRaw) {
    throw new Error('Chrome localStorage에서 github_cards_v1 키를 찾지 못했습니다.')
  }

  return {
    cards: JSON.parse(decodeValue(cardsRaw)),
    notesByRepo: notesRaw ? JSON.parse(decodeValue(notesRaw)) : {},
    categories: categoriesRaw
      ? JSON.parse(decodeValue(categoriesRaw))
      : [
          { id: 'main', name: '메인', isSystem: true, createdAt: new Date().toISOString() },
          { id: 'warehouse', name: '창고', isSystem: true, createdAt: new Date().toISOString() },
        ],
    selectedCategoryId: selectedRaw ? decodeValue(selectedRaw).trim() || 'main' : 'main',
  }
}

const restore = async () => {
  try {
    const dashboard = await loadLocalDashboard()

    const response = await fetch(`${apiBase}/api/github/dashboard`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dashboard }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`복구 API 실패 (${response.status}): ${body}`)
    }

    const verify = await fetch(`${apiBase}/api/providers/github/items?limit=2000`).then((r) => r.json())
    const noteCount = Object.values(dashboard.notesByRepo).reduce(
      (sum, notes) => sum + (Array.isArray(notes) ? notes.length : 0),
      0,
    )

    console.log(
      JSON.stringify(
        {
          ok: true,
          restoredCards: dashboard.cards.length,
          restoredNotes: noteCount,
          dbItems: verify.items?.length ?? 0,
          apiBase,
        },
        null,
        2,
      ),
    )
  } finally {
    await fs.rm(copyPath, { recursive: true, force: true })
  }
}

await restore()
