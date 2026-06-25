/**
 * 05 - Benfiga (Presidente)
 * Testa il login di Benfiga e i suoi tab/pannelli presidente nella schermata partecipante.
 * Il login admin separato è stato eliminato: Benfiga accede con credenziali squadra.
 */
const { test, expect } = require('@playwright/test');
const { BASE_URL, TEAM_PASSWORD, waitForLoginScreen, waitForParticipantScreen } = require('./helpers');

async function loginAsBenfiga(page) {
  await page.goto(BASE_URL);
  await waitForLoginScreen(page);
  await page.selectOption('#teamSelect', 't2');
  await page.fill('#teamPassword', TEAM_PASSWORD);
  await page.click('button:has-text("Entra →")');
  await page.locator('#screen-participant.active').waitFor({ state: 'attached', timeout: 10_000 });
}

test.describe('Benfiga — Schermata Partecipante con Pannelli Presidente', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsBenfiga(page);
  });

  test('la schermata partecipante è attiva dopo il login di Benfiga', async ({ page }) => {
    await expect(page.locator('#screen-participant')).toHaveClass(/active/);
    await expect(page.locator('#screen-login')).not.toHaveClass(/active/);
  });

  test('i tab presidente sono visibili (Asta, Assegn., Rosa, Storico)', async ({ page }) => {
    await expect(page.locator('#tabAstaBtn')).not.toHaveClass(/hidden/);
    await expect(page.locator('#tabAssignBtn')).not.toHaveClass(/hidden/);
    await expect(page.locator('#tabRosaBtn')).not.toHaveClass(/hidden/);
    await expect(page.locator('#tabStorBtn')).not.toHaveClass(/hidden/);
  });

  test('ha un pulsante logout', async ({ page }) => {
    await expect(page.locator('#screen-participant .btn-logout')).toBeVisible();
  });

  test('logout riporta alla login screen', async ({ page }) => {
    await page.click('#screen-participant .btn-logout');
    await page.locator('#screen-login.active').waitFor({ state: 'attached', timeout: 8_000 });
  });
});

test.describe('Benfiga — Tab Storico', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('clic sul tab Storico mostra il pannello storico', async ({ page }) => {
    await loginAsBenfiga(page);
    await page.click('#tabStorBtn');
    await expect(page.locator('#presidentStorPanel')).toBeVisible();
  });
});
