/**
 * 01 - Login Screen
 * Testa la schermata di login: rendering, selezione squadra, validazione, tab admin.
 */
const { test, expect } = require('@playwright/test');
const { BASE_URL, TEAM_PASSWORD, waitForLoginScreen, waitForParticipantScreen } = require('./helpers');

test.describe('Login Screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForLoginScreen(page);
  });

  // ── Rendering ────────────────────────────────────────────────────────────────

  test('visualizza titolo FANTACASERMA e logo', async ({ page }) => {
    await expect(page.locator('.login-title')).toContainText('FANTACASERMA');
    await expect(page.locator('.login-logo')).toContainText('🏆');
  });

  test('visualizza sottotitolo con info asta', async ({ page }) => {
    const sub = page.locator('.login-sub');
    await expect(sub).toContainText('Asta alla cieca');
    await expect(sub).toContainText('10 squadre');
  });

  test('il dropdown squadra è visibile e ha il placeholder corretto', async ({ page }) => {
    const sel = page.locator('#teamSelect');
    await expect(sel).toBeVisible();
    const placeholder = await sel.locator('option[value=""]').textContent();
    expect(placeholder).toContain('scegli');
  });

  test('il dropdown contiene esattamente 10 squadre (+ placeholder)', async ({ page }) => {
    const options = page.locator('#teamSelect option');
    await expect(options).toHaveCount(11); // 1 placeholder + 10 squadre
  });

  test('le squadre sono tutte presenti nel dropdown', async ({ page }) => {
    const expectedTeams = [
      { value: 't1', text: 'Barca' },
      { value: 't2', text: 'Benfiga' },
      { value: 't3', text: 'Frattese1985' },
      { value: 't4', text: 'Morpheus' },
      { value: 't5', text: 'Paris San Giuann' },
      { value: 't6', text: 'REAL' },
      { value: 't7', text: 'Sharktar' },
      { value: 't8', text: 'SoxTeam' },
      { value: 't9', text: 'Vincan' },
      { value: 't10', text: 'giomammo' },
    ];

    for (const team of expectedTeams) {
      const opt = page.locator(`#teamSelect option[value="${team.value}"]`);
      await expect(opt).toContainText(team.text);
    }
  });

  test('il campo password è di tipo password (oscurato)', async ({ page }) => {
    const pwdInput = page.locator('#teamPassword');
    await expect(pwdInput).toBeVisible();
    const type = await pwdInput.getAttribute('type');
    expect(type).toBe('password');
  });

  test('il pulsante Entra → è visibile', async ({ page }) => {
    await expect(page.locator('button:has-text("Entra →")')).toBeVisible();
  });

  // ── Validazione errori ────────────────────────────────────────────────────────

  test('mostra errore se la password è sbagliata', async ({ page }) => {
    await page.selectOption('#teamSelect', 't1');
    await page.fill('#teamPassword', 'passworderrata');
    await page.click('button:has-text("Entra →")');

    const err = page.locator('#teamError');
    await expect(err).toBeVisible();
    await expect(err).toContainText('Password errata');
  });

  test('mostra errore se nessuna squadra è selezionata', async ({ page }) => {
    await page.fill('#teamPassword', TEAM_PASSWORD);
    await page.click('button:has-text("Entra →")');

    const err = page.locator('#teamError');
    await expect(err).toBeVisible();
  });

  test('nasconde il messaggio di errore dopo una selezione corretta', async ({ page }) => {
    // Prima sbagliamo per far apparire l'errore
    await page.selectOption('#teamSelect', 't1');
    await page.fill('#teamPassword', 'wrong');
    await page.click('button:has-text("Entra →")');
    await expect(page.locator('#teamError')).toBeVisible();

    // Poi inseriamo la password corretta
    await page.fill('#teamPassword', TEAM_PASSWORD);
    await page.click('button:has-text("Entra →")');

    // Dobbiamo arrivare alla schermata partecipante (errore non visibile)
    await waitForParticipantScreen(page);
  });

  // ── Login corretto ────────────────────────────────────────────────────────────

  test('login corretto come Barca (t1) → schermata partecipante', async ({ page }) => {
    await page.selectOption('#teamSelect', 't1');
    await page.fill('#teamPassword', TEAM_PASSWORD);
    await page.click('button:has-text("Entra →")');
    await waitForParticipantScreen(page);
    await expect(page.locator('#screen-login.active')).toHaveCount(0);
  });

  test('login con tasto Invio sul campo password', async ({ page }) => {
    await page.selectOption('#teamSelect', 't3');
    await page.fill('#teamPassword', TEAM_PASSWORD);
    await page.press('#teamPassword', 'Enter');
    await waitForParticipantScreen(page);
  });

  test('login come Benfiga (t2, presidente) → schermata partecipante con tab presidente', async ({ page }) => {
    await page.selectOption('#teamSelect', 't2');
    await page.fill('#teamPassword', TEAM_PASSWORD);
    await page.click('button:has-text("Entra →")');
    await waitForParticipantScreen(page);
    // I tab presidente devono essere visibili
    await expect(page.locator('#tabAstaBtn')).not.toHaveClass(/hidden/);
    await expect(page.locator('#tabStorBtn')).not.toHaveClass(/hidden/);
  });

  test('non esiste più il tab Admin separato nella login', async ({ page }) => {
    await expect(page.locator('#tabAdmin')).toHaveCount(0);
    await expect(page.locator('#formAdmin')).toHaveCount(0);
  });
});
