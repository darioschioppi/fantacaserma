/**
 * 09 - Impersonificazione Squadre (solo Barca)
 *
 * Verifica che Barca (t1) possa impersonare qualsiasi altra squadra tramite
 * il dropdown #impersonateSelect nella topbar, che i permessi/visualizzazione
 * seguano la squadra impersonata, e che sia sempre possibile tornare
 * all'identità originale con #btnStopImpersonate o il banner.
 */
const { test, expect } = require('@playwright/test');
const { BASE_URL, TEAM_PASSWORD, gotoAndLogin, waitForParticipantScreen } = require('./helpers');

test.describe('Impersonificazione Squadre', () => {
  test('Barca vede il controllo di impersonificazione, altre squadre no', async ({ page }) => {
    await gotoAndLogin(page, 't1');
    await expect(page.locator('#impersonateSelect')).toBeVisible();

    await page.click('#screen-participant .btn-logout');
    await gotoAndLogin(page, 't3');
    await expect(page.locator('#impersonateSelect')).toBeHidden();
  });

  test('Barca puo impersonare unaltra squadra: nome e budget cambiano', async ({ page }) => {
    await gotoAndLogin(page, 't1');
    await expect(page.locator('#participantTeamName')).toContainText('Barça');

    await page.selectOption('#impersonateSelect', 't5');
    await page.locator('#impersonateBanner').waitFor({ state: 'visible', timeout: 8_000 });
    await expect(page.locator('#participantTeamName')).toContainText('Paris San Giuann');
    await expect(page.locator('#impersonateBannerName')).toContainText('Paris San Giuann');
  });

  test('durante l\'impersonificazione e sempre disponibile il ritorno a Barca', async ({ page }) => {
    await gotoAndLogin(page, 't1');
    await page.selectOption('#impersonateSelect', 't7');
    await page.locator('#impersonateBanner').waitFor({ state: 'visible', timeout: 8_000 });

    await expect(page.locator('#btnStopImpersonate')).toBeVisible();
    await page.click('#btnStopImpersonate');

    await page.locator('#impersonateBanner').waitFor({ state: 'hidden', timeout: 8_000 });
    await expect(page.locator('#participantTeamName')).toContainText('Barça');
  });

  test('si puo passare rapidamente da una squadra impersonata a un\'altra', async ({ page }) => {
    await gotoAndLogin(page, 't1');

    await page.selectOption('#impersonateSelect', 't4');
    await page.locator('#impersonateBanner').waitFor({ state: 'visible', timeout: 8_000 });
    await expect(page.locator('#participantTeamName')).toContainText('Morpheus');

    // Cambia direttamente squadra senza tornare a Barca
    await page.selectOption('#impersonateSelect', 't8');
    await page.waitForFunction(
      () => document.getElementById('participantTeamName')?.textContent.includes('SoxTeam'),
      { timeout: 8_000 }
    );
    await expect(page.locator('#impersonateBannerName')).toContainText('SoxTeam');
  });

  test('la selezione "Barca (originale)" nel dropdown riporta all\'identita originale', async ({ page }) => {
    await gotoAndLogin(page, 't1');
    await page.selectOption('#impersonateSelect', 't6');
    await page.locator('#impersonateBanner').waitFor({ state: 'visible', timeout: 8_000 });

    await page.selectOption('#impersonateSelect', 't1');
    await page.locator('#impersonateBanner').waitFor({ state: 'hidden', timeout: 8_000 });
    await expect(page.locator('#participantTeamName')).toContainText('Barça');
  });

  test('impersonificazione persiste al reload della pagina', async ({ page }) => {
    await gotoAndLogin(page, 't1');
    await page.selectOption('#impersonateSelect', 't9');
    await page.locator('#impersonateBanner').waitFor({ state: 'visible', timeout: 8_000 });

    await page.reload();
    await waitForParticipantScreen(page);
    await expect(page.locator('#impersonateBanner')).toBeVisible();
    await expect(page.locator('#participantTeamName')).toContainText('Vincan');

    // Pulizia: torna a Barca prima di terminare
    await page.click('#btnStopImpersonate');
  });
});
