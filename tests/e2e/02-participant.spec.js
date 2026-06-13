/**
 * 02 - Schermata Partecipante
 * Testa la schermata partecipante dopo il login: layout, bid area, poker table,
 * connected bar, navigazione tab, logout.
 */
const { test, expect } = require('@playwright/test');
const { gotoAndLogin, BASE_URL } = require('./helpers');

test.describe('Schermata Partecipante', () => {
  // ── Stato iniziale dopo login ─────────────────────────────────────────────

  test.describe('Stato iniziale (Barca - t1)', () => {
    test.beforeEach(async ({ page }) => {
      await gotoAndLogin(page, 't1');
    });

    test('schermata login è nascosta dopo il login', async ({ page }) => {
      await expect(page.locator('#screen-login')).not.toHaveClass(/active/);
    });

    test('poker table è visibile', async ({ page }) => {
      await expect(page.locator('#pokerTable')).toBeVisible();
    });

    test('bid area è visibile', async ({ page }) => {
      await expect(page.locator('#bidArea')).toBeVisible();
    });

    test('messaggio "In attesa dell\'asta" è visibile quando non c\'è asta', async ({ page }) => {
      const waiting = page.locator('#bidAreaWaiting');
      await expect(waiting).toBeVisible();
      await expect(waiting).toContainText('In attesa dell\'asta');
    });

    test('bid input è nascosto quando non c\'è asta in corso', async ({ page }) => {
      await expect(page.locator('#bidInputArea')).toBeHidden();
    });

    test('auction header è nascosto fuori dall\'asta', async ({ page }) => {
      const header = page.locator('#auctionHeader');
      // L'header ha display:none inizialmente
      const isVisible = await header.isVisible();
      expect(isVisible).toBe(false);
    });

    test('timer asta mostra "—" quando nessuna asta è attiva', async ({ page }) => {
      const timerEl = page.locator('#auctionHeaderTimer');
      const text = await timerEl.textContent();
      expect(text?.trim()).toBe('—');
    });

    test('overlay di rivelazione non è attivo', async ({ page }) => {
      const overlay = page.locator('#revealOverlay');
      await expect(overlay).not.toHaveClass(/visible/);
    });

    test('connected bar è visibile', async ({ page }) => {
      await expect(page.locator('#connectedBar')).toBeVisible();
    });

    test('la connected bar contiene il simbolo utenti', async ({ page }) => {
      const bar = page.locator('#connectedBar');
      const text = await bar.textContent();
      expect(text).toMatch(/👥|utent|connett|Caricamento/);
    });

    test('pulsante Esci (logout) è visibile', async ({ page }) => {
      await expect(page.locator('#screen-participant .btn-logout')).toBeVisible();
    });

    test('logout riporta alla schermata di login', async ({ page }) => {
      await page.click('#screen-participant .btn-logout');
      await page.locator('#screen-login.active').waitFor({ state: 'attached', timeout: 8_000 });
    });
  });

  // ── Navigazione Tab Mobile ────────────────────────────────────────────────

  test.describe('Navigazione Tab Mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } }); // iPhone 14

    test.beforeEach(async ({ page }) => {
      await gotoAndLogin(page, 't1');
    });

    test('barra di navigazione mobile è visibile', async ({ page }) => {
      await expect(page.locator('#participantMobileNav')).toBeVisible();
    });

    test('la nav contiene le tab Tavolo, Rosa, Acquisti', async ({ page }) => {
      const nav = page.locator('#participantMobileNav');
      await expect(nav.locator('button:has-text("Tavolo")')).toBeVisible();
      await expect(nav.locator('button:has-text("Rosa")')).toBeVisible();
      await expect(nav.locator('button:has-text("Acquisti")')).toBeVisible();
    });

    test('tab Asta è nascosta per un partecipante normale', async ({ page }) => {
      // tabAstaBtn ha classe "hidden" per i non-presidenti
      await expect(page.locator('#tabAstaBtn')).toHaveClass(/hidden/);
    });

    test('tab Tavolo è attiva di default', async ({ page }) => {
      const tavoloBtn = page.locator('#participantMobileNav button:has-text("Tavolo")');
      await expect(tavoloBtn).toHaveClass(/active/);
    });

    test('clic su Rosa mostra il pannello giocatori', async ({ page }) => {
      await page.click('#participantMobileNav button:has-text("Rosa")');
      await expect(page.locator('#playersPanel')).toBeVisible();
    });

    test('clic su Acquisti mostra il pannello recenti', async ({ page }) => {
      await page.click('#participantMobileNav button:has-text("Acquisti")');
      const recents = page.locator('.recent-sidebar');
      await expect(recents).toBeVisible();
    });

    test('clic su Tavolo ripristina il poker area', async ({ page }) => {
      // Vai su Rosa
      await page.click('#participantMobileNav button:has-text("Rosa")');
      await expect(page.locator('#playersPanel')).toBeVisible();
      // Torna su Tavolo
      await page.click('#participantMobileNav button:has-text("Tavolo")');
      await expect(page.locator('#pokerArea')).toBeVisible();
    });
  });

  // ── Tab Asta per il Presidente ────────────────────────────────────────────

  test.describe('Presidente (Benfiga - t2)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test.beforeEach(async ({ page }) => {
      await gotoAndLogin(page, 't2');
    });

    test('tab Asta è visibile per il presidente', async ({ page }) => {
      await expect(page.locator('#tabAstaBtn')).not.toHaveClass(/hidden/);
    });

    test('clic su Asta mostra il pannello asta presidente', async ({ page }) => {
      await page.click('#tabAstaBtn');
      await expect(page.locator('#presidentAstaPanel')).toBeVisible();
    });
  });
});
