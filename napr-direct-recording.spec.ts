import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://napr.gov.ge/');
  await page.getByRole('button', { name: 'სამეწარმეო რეესტრი' }).click();
  const page1Promise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'მოძებნე სუბიექტი/განცხადება' }).click();
  const page1 = await page1Promise;
  await page1.locator('#main-routing-container iframe').contentFrame().getByRole('textbox', { name: 'ორგ. დასახელება' }).click();
  await page1.locator('#main-routing-container iframe').contentFrame().getByRole('textbox', { name: 'ორგ. დასახელება' }).fill('მილენიო');
  await page1.locator('#main-routing-container iframe').contentFrame().getByRole('button', { name: 'ძებნა' }).click();
  await page1.locator('#main-routing-container iframe').contentFrame().getByRole('row', { name: '404670272' }).getByRole('link').click();
  await page1.locator('#main-routing-container iframe').contentFrame().getByRole('link').filter({ hasText: /^$/ }).first().click();
  const page2Promise = page1.waitForEvent('popup');
  await page1.locator('#main-routing-container iframe').contentFrame().getByRole('link', { name: 'SIGNED' }).first().click();
  const page2 = await page2Promise;
  await page1.locator('#main-routing-container iframe').contentFrame().getByRole('link', { name: 'განცხადების ძებნა' }).click();
  await page1.locator('#main-routing-container iframe').contentFrame().getByRole('textbox', { name: 'ორგ. დასახელება' }).click();
  await page1.locator('#main-routing-container iframe').contentFrame().getByRole('textbox', { name: 'ორგ. დასახელება' }).fill('მილენიო');
  await page1.locator('#main-routing-container iframe').contentFrame().getByRole('button', { name: 'ძებნა' }).click();
  await page1.locator('#main-routing-container iframe').contentFrame().getByRole('row', { name: '404703380' }).getByRole('link').click();
  await page1.locator('#main-routing-container iframe').contentFrame().getByRole('link').filter({ hasText: /^$/ }).first().click();
  const page3Promise = page1.waitForEvent('popup');
  await page1.locator('#main-routing-container iframe').contentFrame().getByRole('link', { name: 'SIGNED' }).first().click();
  const page3 = await page3Promise;
});