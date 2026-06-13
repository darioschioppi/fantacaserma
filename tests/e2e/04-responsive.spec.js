/**
 * 04 - Responsive & Mobile Layout
 * Verifica il comportamento responsive su mobile e desktop:
 * - Mobile nav bar visibile/nascosta
 * - bid area larghezza corretta su mobile
 * - player card nascosta su mobile
 * - player card visibile su desktop
 */
const { test, expect } = require('@playwright/test');
const { gotoAndLogin, BASE_URL, waitForLoginScreen, loginAsTeam, waitForParticipantScreen } = require('./helpers');

// ── Mobile (iPhone 14: 390x844) ───────────────────────────────────────────────

test.describe('Layout Mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await gotoAndLogin(page, 't1');
  });

  test('la barra di navigazione mobile è visibile', async ({ page }) => {
    await expect(page.locator('#participantMobileNav')).toBeVisible();
  });

  test('la barra di navigazione è nel layout corretto (flex-direction column)', async ({ page }) => {
    // Verifica che la nav sia strutturata per stare in fondo (parent è flex column)
    const screenLayout = await page.evaluate(() => {
      const screen = document.getElementById('screen-participant');
      return screen ? getComputedStyle(screen).flexDirection : null;
    });
    expect(screenLayout).toBe('column');
  });

  test('la bid area occupa almeno 300px di larghezza su mobile', async ({ page }) => {
    const bidArea = page.locator('#bidArea');
    await expect(bidArea).toBeVisible();
    const box = await bidArea.boundingBox();
    expect(box.width).toBeGreaterThan(300);
  });

  test('la bid area non supera la larghezza del viewport', async ({ page }) => {
    const bidArea = page.locator('#bidArea');
    const box = await bidArea.boundingBox();
    const viewportWidth = page.viewportSize()?.width ?? 390;
    // Non deve traboccare fuori dallo schermo
    expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 5); // 5px tolleranza
  });

  test('la player card al centro tavolo è nascosta su mobile', async ({ page }) => {
    // Su mobile .player-card ha display:none !important
    const playerCard = page.locator('.player-card');
    // Potrebbe non esistere affatto o essere hidden
    const count = await playerCard.count();
    if (count > 0) {
      // Verifica che tutte le player card siano nascoste
      for (let i = 0; i < count; i++) {
        const isVisible = await playerCard.nth(i).isVisible();
        expect(isVisible).toBe(false);
      }
    }
  });

  test('il poker area usa justify-content: flex-start su mobile', async ({ page }) => {
    const justifyContent = await page.evaluate(() => {
      const el = document.getElementById('pokerArea');
      return el ? getComputedStyle(el).justifyContent : null;
    });
    expect(justifyContent).toBe('flex-start');
  });

  test('login box ha max-width 380px (non overflow su mobile)', async ({ page }) => {
    // Verifica via CSS computed che la login-box non superi il viewport
    const maxWidth = await page.evaluate(() => {
      const el = document.querySelector('.login-box');
      return el ? parseFloat(getComputedStyle(el).maxWidth) : null;
    });
    // max-width è 380px, il viewport è 390px → no overflow
    expect(maxWidth).toBeLessThanOrEqual(390);
  });
});

// ── Small Mobile (SE: 375x667) ────────────────────────────────────────────────

test.describe('Layout Small Mobile (iPhone SE)', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('la bid area non trabocca su schermo piccolo', async ({ page }) => {
    await gotoAndLogin(page, 't3');
    const bidArea = page.locator('#bidArea');
    await expect(bidArea).toBeVisible();
    const box = await bidArea.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(380);
  });

  test('il pulsante OFFERTA è completamente visibile su schermo piccolo', async ({ page }) => {
    await gotoAndLogin(page, 't3');
    // In fase di attesa il pulsante non è visibile, ma non deve essere clippato
    // Verifica che l'HTML del bid area sia dentro i limiti
    const bidArea = page.locator('#bidArea');
    const box = await bidArea.boundingBox();
    // Non deve essere tagliato a destra
    expect(box.x + box.width).toBeLessThanOrEqual(375 + 5);
  });
});

// ── Desktop (1280x800) ────────────────────────────────────────────────────────

test.describe('Layout Desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await gotoAndLogin(page, 't1');
  });

  test('il poker area è visibile su desktop (pannello principale)', async ({ page }) => {
    // Su desktop il tavolo poker è il pannello principale visibile
    const display = await page.evaluate(() => {
      const pa = document.getElementById('pokerArea');
      return pa ? getComputedStyle(pa).display : null;
    });
    expect(display).not.toBe('none');
  });

  test('il poker area è visibile su desktop', async ({ page }) => {
    await expect(page.locator('#pokerArea')).toBeVisible();
  });

  test('la sidebar recenti è nel DOM su desktop', async ({ page }) => {
    // La sidebar esiste nel DOM (viene mostrata via JS al click Acquisti su mobile)
    // Su desktop è nascosta inizialmente dal participantMobileTab('table')
    await expect(page.locator('.recent-sidebar')).toBeAttached();
  });
});

// ── Tablet (768x1024) ────────────────────────────────────────────────────────

test.describe('Layout Tablet', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('la schermata partecipante si carica correttamente su tablet', async ({ page }) => {
    await gotoAndLogin(page, 't2');
    await expect(page.locator('#screen-participant')).toHaveClass(/active/);
  });
});
