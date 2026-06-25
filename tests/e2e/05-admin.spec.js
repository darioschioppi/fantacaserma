/**
 * 05 - Schermata Admin
 * Testa la schermata admin: accesso, ricerca giocatori, visualizzazione squadre.
 */
const { test, expect } = require('@playwright/test');
const { BASE_URL, TEAM_PASSWORD, waitForLoginScreen } = require('./helpers');

/**
 * Login come Admin (Benfiga, t2).
 * Non esiste più un tab Admin separato: Benfiga usa il login squadra
 * e viene instradata automaticamente allo screen-admin.
 */
async function loginAsAdmin(page) {
  await page.goto(BASE_URL);
  await waitForLoginScreen(page);
  await page.selectOption('#teamSelect', 't2');
  await page.fill('#teamPassword', TEAM_PASSWORD);
  await page.click('button:has-text("Entra →")');
  await page.locator('#screen-admin.active').waitFor({ state: 'attached', timeout: 10_000 });
}

test.describe('Schermata Admin', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('la schermata admin è attiva dopo il login admin', async ({ page }) => {
    await expect(page.locator('#screen-admin')).toHaveClass(/active/);
    await expect(page.locator('#screen-login')).not.toHaveClass(/active/);
  });

  test('la sezione ricerca giocatori è visibile', async ({ page }) => {
    await expect(page.locator('#adminSearch, #searchSection, [id*="search"]').first()).toBeAttached();
  });

  test('ha un pulsante logout', async ({ page }) => {
    await expect(page.locator('#screen-admin .btn-logout')).toBeVisible();
  });

  test('logout admin riporta alla login screen', async ({ page }) => {
    await page.click('#screen-admin .btn-logout');
    await page.locator('#screen-login.active').waitFor({ state: 'attached', timeout: 8_000 });
  });
});

test.describe('Admin Mobile Navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('la nav mobile admin è visibile su mobile', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.locator('#adminMobileNav')).toBeVisible();
  });

  test('la nav admin contiene Ricerca, Squadre, Asta', async ({ page }) => {
    await loginAsAdmin(page);
    const nav = page.locator('#adminMobileNav');
    await expect(nav.locator('button:has-text("Ricerca")')).toBeVisible();
    await expect(nav.locator('button:has-text("Squadre")')).toBeVisible();
    await expect(nav.locator('button:has-text("Asta")')).toBeVisible();
  });
});
