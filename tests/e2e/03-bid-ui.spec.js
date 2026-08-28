/**
 * 03 - Bid Area UI
 * Testa i componenti dell'area di offerta: stepper, input numerico,
 * label budget/slot, comportamento sealed-bid. (I pulsanti "quick bid"
 * +1/+5/+10/+25 sono stati rimossi dal front-end su richiesta esplicita.)
 */
const { test, expect } = require('@playwright/test');
const { gotoAndLogin } = require('./helpers');

test.describe('Bid Area - Componenti UI (fuori asta)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndLogin(page, 't4'); // Morpheus
  });

  test('il bid input non è visibile fuori dall\'asta', async ({ page }) => {
    await expect(page.locator('#bidInputArea')).toBeHidden();
  });

  test('la label budget non è visibile fuori dall\'asta', async ({ page }) => {
    // Il budget label è dentro bidInputArea che è nascosta
    await expect(page.locator('#bidBudgetLabel')).toBeHidden();
  });

  test('i pulsanti stepper +/- non sono visibili fuori dall\'asta', async ({ page }) => {
    await expect(page.locator('.btn-stepper').first()).toBeHidden();
  });

  test('i pulsanti quick bid non esistono più (rimossi dal front-end)', async ({ page }) => {
    // Rimossi su richiesta esplicita: il campo prezzo usa solo lo stepper +/-.
    await expect(page.locator('.btn-quick')).toHaveCount(0);
  });

  test('il pulsante OFFERTA non è visibile fuori dall\'asta', async ({ page }) => {
    await expect(page.locator('#btnBid')).toBeHidden();
  });

  test('il pulsante Passa non è visibile fuori dall\'asta', async ({ page }) => {
    await expect(page.locator('#btnPass')).toBeHidden();
  });

  test('bid-sent message è nascosto di default', async ({ page }) => {
    await expect(page.locator('#bidSent')).toBeHidden();
  });
});

test.describe('Bid Area - Struttura HTML', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndLogin(page, 't5'); // Paris San Giuann
  });

  test('la bid area contiene il pulsante OFFERTA con testo corretto', async ({ page }) => {
    // Il pulsante esiste nell'HTML anche se nascosto
    const btn = page.locator('#btnBid');
    const text = await btn.textContent();
    expect(text).toContain('OFFERTA');
    // Non deve contenere il testo lungo "INVIA OFFERTA" (fix precedente)
    expect(text).not.toContain('INVIA');
  });

  test('la bid area contiene il pulsante PASSA (senza emoji, maiuscolo)', async ({ page }) => {
    const btn = page.locator('#btnPass');
    const text = await btn.textContent();
    // Fix: emoji rimosse dai bottoni OFFERTA/PASSA su richiesta esplicita, testo tutto maiuscolo.
    expect(text?.trim()).toBe('PASSA');
  });

  test('esistono 2 pulsanti stepper (+ e -)', async ({ page }) => {
    const steppers = page.locator('.btn-stepper');
    await expect(steppers).toHaveCount(2);
    const texts = await steppers.allTextContents();
    expect(texts).toContain('−');
    expect(texts).toContain('+');
  });

  test('il campo bid-input è di tipo number', async ({ page }) => {
    const input = page.locator('#bidInput');
    const type = await input.getAttribute('type');
    expect(type).toBe('number');
  });

  test('la label min crediti è presente', async ({ page }) => {
    await expect(page.locator('#bidMinLabel')).toBeAttached();
  });

  test('il display budget è presente', async ({ page }) => {
    await expect(page.locator('#bidBudgetLabel')).toBeAttached();
  });

  test('il contatore slot ruolo è presente', async ({ page }) => {
    await expect(page.locator('#bidRoleSlotsVal')).toBeAttached();
  });
});

test.describe('Sealed Bid - Visibilità offerte', () => {
  test('il poker table è visibile dopo il login', async ({ page }) => {
    await gotoAndLogin(page, 't6'); // REAL
    await expect(page.locator('#pokerTable')).toBeVisible();
  });

  test('il tiebreaker banner esiste nel DOM', async ({ page }) => {
    await gotoAndLogin(page, 't7'); // Sharktar
    // Il banner esiste ma è nascosto finché non c\'è un tiebreaker
    await expect(page.locator('#tiebreakerBanner')).toBeAttached();
  });

  test('l\'overlay di rivelazione contiene la sezione azioni presidente', async ({ page }) => {
    await gotoAndLogin(page, 't8'); // SoxTeam
    await expect(page.locator('#revealPresActions')).toBeAttached();
    // Fuori dall\'asta deve essere nascosto
    await expect(page.locator('#revealPresActions')).toBeHidden();
  });

  test('il pulsante "Prossima asta" esiste nell\'overlay', async ({ page }) => {
    await gotoAndLogin(page, 't9'); // Vincan
    await expect(page.locator('#btnRevealNext')).toBeAttached();
  });
});
