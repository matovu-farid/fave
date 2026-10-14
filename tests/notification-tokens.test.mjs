import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'
import ts from 'typescript'

const sourcePath = fileURLToPath(new URL('../fave-worker/src/notifications.ts', import.meta.url))
const migrationPath = fileURLToPath(new URL('../fave-worker/migrations/0016_notification_push_tokens.sql', import.meta.url))

function loadNotifications({ user = { id: 'user-1', name: 'User' } } = {}) {
  const exports = {}
  const routes = new Map()
  class CapturingHono {
    get(path, handler) { routes.set(`GET ${path}`, handler); return this }
    post(path, handler) { routes.set(`POST ${path}`, handler); return this }
    delete(path, handler) { routes.set(`DELETE ${path}`, handler); return this }
  }
  const code = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(code, {
    exports,
    require: name => {
      if (name === 'hono') return { Hono: CapturingHono }
      if (name === './marketplace-auth') return {
        apiError: (code, message) => ({ error: { code, message } }),
        getSignedInUser: async () => user,
      }
      if (name === './notification-store') return {
        listNotifications: async () => ({ items: [], unreadCount: 0, nextCursor: null }),
        markAllNotificationsRead: async () => 0,
        markNotificationRead: async () => false,
      }
      if (name === './notification-delivery') return {
        safeNotificationCopy: () => ({ title: '', body: '' }),
      }
      throw new Error(`Unexpected module: ${name}`)
    },
    Date,
    crypto: { randomUUID: () => 'push-token-row-1' },
  })
  return { routes, exports }
}

function createDb() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE user (id TEXT PRIMARY KEY);')
  db.exec(readFileSync(migrationPath, 'utf8'))
  db.prepare('INSERT INTO user (id) VALUES (?)').run('user-1')
  db.prepare('INSERT INTO user (id) VALUES (?)').run('user-2')
  return db
}

function context(db, { method = 'POST', path = '/push-tokens', body = null } = {}) {
  const d1 = {
    prepare(sql) {
      let bindings = []
      return {
        bind(...values) { bindings = values; return this },
        async run() { return db.prepare(sql).run(...bindings) },
      }
    },
  }
  return {
    env: { DB: d1 },
    req: {
      raw: new Request(`https://fave.test${path}`, { method }),
      json: async () => body,
    },
    json: (value, status = 200) => ({ body: value, status }),
    body: (value, status = 200) => ({ body: value, status }),
  }
}

test('registering a push token links it only to the signed-in user and never returns the token', async () => {
  const db = createDb()
  try {
    const { routes } = loadNotifications()
    const response = await routes.get('POST /push-tokens')(context(db, {
      body: { token: 'ExponentPushToken[device-1]', platform: 'ios' },
    }))

    assert.equal(response.status, 200)
    assert.equal(response.body.registered, true)
    assert.equal(Object.keys(response.body).length, 1)
    assert.equal(db.prepare('SELECT user_id FROM notification_push_tokens WHERE token = ?')
      .get('ExponentPushToken[device-1]').user_id, 'user-1')
    assert.equal(JSON.stringify(response.body).includes('ExponentPushToken'), false)
  } finally {
    db.close()
  }
})

test('refreshing a token moves its unique registration to the current account without duplicating it', async () => {
  const db = createDb()
  try {
    const first = loadNotifications({ user: { id: 'user-1', name: 'First' } })
    const second = loadNotifications({ user: { id: 'user-2', name: 'Second' } })
    const payload = { token: 'ExponentPushToken[shared-device]', platform: 'android' }
    await first.routes.get('POST /push-tokens')(context(db, { body: payload }))
    await second.routes.get('POST /push-tokens')(context(db, { body: payload }))

    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notification_push_tokens WHERE token = ?')
      .get(payload.token).count, 1)
    assert.equal(db.prepare('SELECT user_id FROM notification_push_tokens WHERE token = ?')
      .get(payload.token).user_id, 'user-2')
  } finally {
    db.close()
  }
})

test('invalid token formats are rejected before they can be stored', async () => {
  const db = createDb()
  try {
    const { routes } = loadNotifications()
    const response = await routes.get('POST /push-tokens')(context(db, {
      body: { token: 'not-a-push-token', platform: 'ios' },
    }))

    assert.equal(response.status, 400)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notification_push_tokens').get().count, 0)
  } finally {
    db.close()
  }
})

test('deleting a push token only removes the signed-in user’s registration', async () => {
  const db = createDb()
  try {
    const { routes } = loadNotifications()
    db.prepare(`INSERT INTO notification_push_tokens (id, user_id, token, platform, created_at, last_registered_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run('row-1', 'user-2', 'ExponentPushToken[device-1]', 'ios', 1, 1)
    const response = await routes.get('DELETE /push-tokens')(context(db, {
      method: 'DELETE',
      body: { token: 'ExponentPushToken[device-1]' },
    }))

    assert.equal(response.status, 204)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notification_push_tokens').get().count, 1)
  } finally {
    db.close()
  }
})

test('unauthenticated users cannot register push tokens', async () => {
  const db = createDb()
  try {
    const { routes } = loadNotifications({ user: null })
    const response = await routes.get('POST /push-tokens')(context(db, {
      body: { token: 'ExponentPushToken[device-1]', platform: 'ios' },
    }))

    assert.equal(response.status, 401)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notification_push_tokens').get().count, 0)
  } finally {
    db.close()
  }
})
