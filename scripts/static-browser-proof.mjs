import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const origin = process.env.STATIC_TEST_ORIGIN || 'http://127.0.0.1:4173'
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))

  const first = await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  assert.equal(first?.status(), 200, 'Homepage must serve successfully')
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor({ timeout: 20000 })
  assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= window.innerWidth + 2), true, 'Mobile login page must not overflow horizontally')
  console.log('PASS: mobile login loads, renders client JS, and has no horizontal overflow')

  const health = await page.goto(origin + '/health/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  assert.equal(health?.status(), 200, 'Browser health page must serve successfully')
  await page.getByRole('heading', { name: 'GH Procurement — Connection Check' }).waitFor({ timeout: 10000 })
  await page.waitForFunction(() => {
    const text = document.body.innerText
    return text.includes('Check status: healthy') || text.includes('Check status: unavailable')
  }, { timeout: 20000 })
  const healthText = await page.locator('body').innerText()
  console.log('PASS: browser health page executed Supabase connectivity check; result:', healthText.includes('Check status: healthy') ? 'healthy' : 'unavailable')

  assert.deepEqual(pageErrors, [], 'Pages must not produce uncaught JS errors')
  console.log('PASS: no uncaught browser JS errors')
} finally {
  await browser.close()
}
