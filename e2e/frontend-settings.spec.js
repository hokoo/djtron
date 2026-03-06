const { test, expect } = require('@playwright/test');
const {
  assertNoClientErrors,
  bootstrapHostPage,
  localStorageValue,
  setCheckboxValue,
  setNumberInputAndCommit,
  setSelectValueAndCommit,
  setupClientErrorCapture,
} = require('./support/frontend-helpers');

test('settings defaults are editable and persisted across reloads', async ({ page, request }) => {
  const capture = setupClientErrorCapture(page);
  await bootstrapHostPage(page, request, { resetBeforeLoad: true, clearStorage: true });

  await setNumberInputAndCommit(page, '#overlayTime', '1.2');
  await setNumberInputAndCommit(page, '#stopFadeTime', '0.8');
  await setSelectValueAndCommit(page, '#overlayCurve', 'ease-in-out');
  await setCheckboxValue(page, '#overlayEnabled', false);
  await setCheckboxValue(page, '#stopFadeEnabled', false);
  await setCheckboxValue(page, '#showVolumePresets', true);
  await setCheckboxValue(page, '#liveSeekEnabled', true);

  await expect(page.locator('#dapEnabled')).toBeEnabled();
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/layout') && response.request().method() === 'POST' && response.ok()),
    setCheckboxValue(page, '#dapEnabled', true),
  ]);

  await expect(page.locator('#dapVolumePercent')).toBeEnabled();
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/layout') && response.request().method() === 'POST' && response.ok()),
    setNumberInputAndCommit(page, '#dapVolumePercent', '17'),
  ]);

  expect(await localStorageValue(page, 'player:overlayTime')).toBe('1.2');
  expect(await localStorageValue(page, 'player:stopFade')).toBe('0.8');
  expect(await localStorageValue(page, 'player:overlayCurve')).toBe('ease-in-out');
  expect(await localStorageValue(page, 'player:overlayEnabled')).toBe('false');
  expect(await localStorageValue(page, 'player:stopFadeEnabled')).toBe('false');
  expect(await localStorageValue(page, 'player:showVolumePresets')).toBe('true');
  expect(await localStorageValue(page, 'player:liveSeekEnabled')).toBe('true');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#overlayTime')).toHaveValue('1.2');
  await expect(page.locator('#stopFadeTime')).toHaveValue('0.8');
  await expect(page.locator('#overlayCurve')).toHaveValue('ease-in-out');
  await expect(page.locator('#overlayEnabled')).not.toBeChecked();
  await expect(page.locator('#stopFadeEnabled')).not.toBeChecked();
  await expect(page.locator('#showVolumePresets')).toBeChecked();
  await expect(page.locator('#liveSeekEnabled')).toBeChecked();
  await expect(page.locator('#dapEnabled')).toBeChecked();
  await expect(page.locator('#dapVolumePercent')).toHaveValue('17');

  assertNoClientErrors(capture);
});
