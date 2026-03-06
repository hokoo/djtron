const { expect } = require('@playwright/test');

function setupClientErrorCapture(page, { allowConsole = [] } = {}) {
  const runtimeErrors = [];
  const consoleErrors = [];
  const requestFailures = [];

  page.on('pageerror', (error) => {
    runtimeErrors.push(error && error.message ? error.message : String(error));
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (allowConsole.some((pattern) => pattern.test(text))) return;
    consoleErrors.push(text);
  });

  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText || 'request failed';
    if (errorText.includes('ERR_ABORTED')) return;
    requestFailures.push(`${request.method()} ${request.url()} => ${errorText}`);
  });

  return {
    runtimeErrors,
    consoleErrors,
    requestFailures,
  };
}

function assertNoClientErrors(capture) {
  expect(capture.runtimeErrors, `pageerror:\n${capture.runtimeErrors.join('\n')}`).toEqual([]);
  expect(capture.consoleErrors, `console.error:\n${capture.consoleErrors.join('\n')}`).toEqual([]);
  expect(capture.requestFailures, `requestfailed:\n${capture.requestFailures.join('\n')}`).toEqual([]);
}

async function resetLayout(request) {
  const response = await request.post('/api/layout/reset');
  expect(response.ok()).toBeTruthy();
}

async function bootstrapHostPage(page, request, { resetBeforeLoad = true, clearStorage = true } = {}) {
  if (resetBeforeLoad) {
    await resetLayout(request);
  }

  if (clearStorage) {
    await page.addInitScript(() => {
      const marker = '__djtron_e2e_storage_cleared__';
      if (sessionStorage.getItem(marker) === '1') return;
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem(marker, '1');
    });
  }

  // App keeps an open SSE stream (/api/layout/stream), so networkidle can hang forever.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#authOverlay')).toBeHidden();
  await expect.poll(() => page.locator('.zone').count()).toBeGreaterThan(0);
  await expect
    .poll(async () => ((await page.locator('#appVersion').textContent()) || '').trim().length)
    .toBeGreaterThan(0);
}

async function setNumberInputAndCommit(page, selector, value) {
  await page.fill(selector, String(value));
  await page.dispatchEvent(selector, 'change');
}

async function setSelectValueAndCommit(page, selector, value) {
  await page.selectOption(selector, value);
  await page.dispatchEvent(selector, 'change');
}

async function setCheckboxValue(page, selector, checked) {
  const checkbox = page.locator(selector);
  await expect(checkbox).toBeVisible();
  const current = await checkbox.isChecked();
  if (current !== checked) {
    await checkbox.click();
  }
}

async function localStorageValue(page, key) {
  return page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
}

module.exports = {
  assertNoClientErrors,
  bootstrapHostPage,
  localStorageValue,
  resetLayout,
  setCheckboxValue,
  setNumberInputAndCommit,
  setSelectValueAndCommit,
  setupClientErrorCapture,
};
