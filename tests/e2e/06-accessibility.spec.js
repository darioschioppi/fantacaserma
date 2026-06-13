/**
 * 06 - Accessibilità & Qualità UI
 * Verifica attributi essenziali di accessibilità e stabilità visiva:
 * - Titolo pagina corretto
 * - Meta viewport presente
 * - Errori console bloccanti assenti
 * - Caricamento sotto un tempo ragionevole
 */
const { test, expect } = require('@playwright/test');
const { BASE_URL, waitForLoginScreen } = require('./helpers');

test.describe('Qualità e Performance', () => {
  test('il titolo della pagina è FANTACASERMA', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForLoginScreen(page);
    const title = await page.title();
    expect(title.toUpperCase()).toContain('FANTACASERMA');
  });

  test('la pagina ha il meta viewport corretto', async ({ page }) => {
    await page.goto(BASE_URL);
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('width=device-width');
    expect(viewport).toContain('initial-scale=1');
  });

  test('la login screen appare entro 10 secondi', async ({ page }) => {
    const start = Date.now();
    await page.goto(BASE_URL);
    await waitForLoginScreen(page);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10_000);
  });

  test('non ci sono errori JavaScript critici al caricamento', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(BASE_URL);
    await waitForLoginScreen(page);

    // Filtra solo gli errori critici (non avvisi Firebase minori)
    const criticalErrors = errors.filter(e =>
      !e.includes('Firebase') &&
      !e.includes('permission') &&
      !e.includes('PERMISSION_DENIED') &&
      !e.includes('network') &&
      !e.includes('404')
    );

    expect(criticalErrors).toHaveLength(0);
  });

  test('il CSS carica correttamente (sfondo scuro applicato)', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForLoginScreen(page);

    const bgColor = await page.evaluate(() => {
      return getComputedStyle(document.body).backgroundColor;
    });
    // Il tema è scuro: --bg è #0a0f1e o simile
    // Il colore non deve essere bianco (rgb(255, 255, 255))
    expect(bgColor).not.toBe('rgb(255, 255, 255)');
  });
});

test.describe('Struttura DOM - Elementi chiave', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForLoginScreen(page);
  });

  test('il loader è presente nel DOM', async ({ page }) => {
    await expect(page.locator('#loader')).toBeAttached();
  });

  test('tutte e 3 le schermate principali sono nel DOM', async ({ page }) => {
    await expect(page.locator('#screen-login')).toBeAttached();
    await expect(page.locator('#screen-participant')).toBeAttached();
    await expect(page.locator('#screen-admin')).toBeAttached();
  });

  test('il toast container è presente', async ({ page }) => {
    await expect(page.locator('#toastContainer')).toBeAttached();
  });

  test('il poker area è nel DOM', async ({ page }) => {
    await expect(page.locator('#pokerArea')).toBeAttached();
  });

  test('il poker table è nel DOM', async ({ page }) => {
    await expect(page.locator('#pokerTable')).toBeAttached();
  });
});
