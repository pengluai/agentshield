import { test, expect } from '@playwright/test';

test('core desktop pages render and navigate in the browser shell', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agentshield-onboarding-completed', 'true');
  });
  await page.goto('/');
  const nav = page.locator('nav');
  const navButtons = nav.locator('button');

  await expect(navButtons.nth(3)).toBeVisible();

  await navButtons.nth(3).click();
  await expect(page.getByRole('heading', { name: 'Skill Store' })).toBeVisible();
  await expect(page.getByPlaceholder('Search secure extensions...')).toBeVisible();

  await navButtons.nth(4).click();
  await expect(page.getByRole('heading', { name: 'Installed' })).toBeVisible();

  await navButtons.nth(6).click();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();

  await navButtons.nth(8).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'General Settings', exact: true })).toBeVisible();
});

test('browser shell gracefully degrades desktop-only actions', async ({ page }) => {
  const errors: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('agentshield-onboarding-completed', 'true');
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });

  await page.goto('/');
  const nav = page.locator('nav');
  const navButtons = nav.locator('button');

  await page.getByRole('main').getByRole('button', { name: 'Scan', exact: true }).click();
  await expect(page.getByText('Preview Mode Notice')).toBeVisible();
  await expect(page.getByText(/browser preview mode/i)).toBeVisible();

  await navButtons.nth(3).click();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText(/Skill Store is only available|No matching items/i)).toBeVisible();

  await navButtons.nth(5).click();
  await page.getByRole('button', { name: 'Add Key' }).click();
  await page.getByPlaceholder('Key name (e.g. OpenAI API Key)').fill('Preview Key');
  await page.getByPlaceholder('Service (e.g. GPT-4)').fill('GPT-4');
  await page.getByPlaceholder('Key value (e.g. sk-proj-...)').fill('sk-preview');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText(/browser preview mode/i)).toBeVisible();

  await navButtons.nth(7).click();
  await page.getByRole('button', { name: /Free Trial|试用/i }).click();
  await expect(page.getByText(/browser preview mode/i)).toBeVisible();

  expect(errors).toEqual([]);
});
