import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'

const screen = readFileSync(new URL('../src/components/account-screen.tsx', import.meta.url), 'utf8')
const home = readFileSync(new URL('../src/app/(tabs)/index.tsx', import.meta.url), 'utf8')
const rootLayout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8')
const tabsLayoutPath = new URL('../src/app/(tabs)/_layout.tsx', import.meta.url)
const accountRoutePath = new URL('../src/app/account.tsx', import.meta.url)

test('Account is a root stack route next to the existing tab group', () => {
  assert.match(rootLayout, /<Stack/u)
  assert.match(rootLayout, /name="\(tabs\)"/u)
  assert.match(rootLayout, /name="account"/u)
  assert.equal(existsSync(tabsLayoutPath), true)
  assert.equal(existsSync(accountRoutePath), true)
  assert.match(readFileSync(tabsLayoutPath, 'utf8'), /<AppTabs\s*\/>/u)
  assert.match(readFileSync(accountRoutePath, 'utf8'), /<AccountScreen/u)
})

test('Home opens the Account route and preserves separate client and driver profiles', () => {
  assert.match(home, /title="Account" onPress=\{\(\) => router\.push\('\/account'/u)
  assert.match(screen, /Use the same Fave sign-in for both your client and driver profiles\./u)
  assert.match(screen, /Client profile/u)
  assert.match(screen, /Driver profile/u)
  assert.match(screen, /getClientPrerequisites/u)
  assert.match(screen, /updateClientProfile/u)
  assert.match(screen, /getDriverApplication/u)
  assert.match(screen, /router\.push\('\/driver'/u)
  assert.match(screen, /title="Back to home" onPress=\{onClose\}/u)
})

test('client profile saves require current policy acknowledgement and do not expose driver identity evidence', () => {
  assert.match(screen, /client\.documents\.map\(\(document\) => document\.id\)/u)
  assert.match(screen, /accepted/u)
  assert.doesNotMatch(screen, /nationalIdNumber|privateFile|document\.objectKey/u)
})

test('Account returns to Home even when opened as a direct URL', () => {
  const route = readFileSync(accountRoutePath, 'utf8')
  assert.match(route, /onClose=\{\(\) => router\.replace\('\/'\)\}/u)
})
