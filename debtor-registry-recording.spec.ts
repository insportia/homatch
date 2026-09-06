import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://my.gov.ge/ka-ge/services/38/searchdebtorinfo');
  await page.locator('input[name="debtorIdNumber"]').click();
  await page.locator('input[name="debtorIdNumber"]').press('ControlOrMeta+ვ');
  await page.locator('input[name="debtorIdNumber"]').fill('404670272');
  await page.getByRole('button', { name: 'ძიება' }).click();
});