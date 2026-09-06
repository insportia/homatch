import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://www.rs.ge/TaxpayersRegistry');
  await page.locator('#tin').click();
  await page.locator('#tin').press('ControlOrMeta+ვ');
  await page.locator('#tin').fill('404670272');
  await page.locator('iframe[name="a-gl6rp5lm1wkr"]').contentFrame().getByRole('checkbox', { name: 'მე არ ვარ რობოტი' }).click();
  await page.locator('iframe[name="c-gl6rp5lm1wkr"]').contentFrame().locator('[id="2"]').click();
  await page.locator('iframe[name="c-gl6rp5lm1wkr"]').contentFrame().locator('[id="8"]').click();
  await page.locator('iframe[name="c-gl6rp5lm1wkr"]').contentFrame().locator('[id="6"]').click();
  await page.locator('iframe[name="c-gl6rp5lm1wkr"]').contentFrame().getByRole('button', { name: 'დადასტურება' }).click();
  await page.locator('iframe[name="c-gl6rp5lm1wkr"]').contentFrame().locator('[id="2"]').click();
  await page.locator('iframe[name="c-gl6rp5lm1wkr"]').contentFrame().getByRole('button', { name: 'დადასტურება' }).click();
  await page.getByRole('button', { name: 'ძებნა' }).click();
});