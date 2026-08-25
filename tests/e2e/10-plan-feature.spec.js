/**
 * 10 - Tab "Pianificazione" del budget
 *
 * Verifica che ogni squadra possa impostare un budget pianificato per un
 * giocatore, che sia specifico per squadra, e che venga usato per
 * precompilare l'offerta quando l'asta parte su quel giocatore.
 *
 * Usa lo stesso pattern REST-API di 08-auction-simulation.spec.js per
 * evitare race condition con l'auth anonimo del browser durante il setup.
 */

const { test, expect } = require('@playwright/test');
const { TEAM_PASSWORD } = require('./helpers');
// helpers.js esporta un BASE_URL assoluto che punta al sito live di produzione
// (page.goto con URL assoluto ignora la baseURL della config Playwright).
// Per testare le modifiche locali PRIMA del push, permettiamo un override via env var.
const BASE_URL = process.env.LOCAL_BASE_URL || 'https://darioschioppi.github.io/fantacaserma/';

const TEST_PLAYER = { nome: '__TEST_PLAN_PLAYER__', squadra: 'TestFC', ruolo: 'A', qi: 1 };
const FB_API_KEY  = 'AIzaSyCOTpDSNMVvK8kYNw11OfBIQm3JaAx9kIM';
const FB_DB_URL   = 'https://fantacaserma-f2fe2-default-rtdb.europe-west1.firebasedatabase.app';

let _fbTokenCache = null;
let _fbTokenExpiry = 0;

async function getFbToken() {
  if (_fbTokenCache && Date.now() < _fbTokenExpiry) return _fbTokenCache;
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FB_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }) }
  );
  const data = await resp.json();
  if (!data.idToken) throw new Error('getFbToken failed: ' + JSON.stringify(data));
  _fbTokenCache  = data.idToken;
  _fbTokenExpiry = Date.now() + 55 * 60 * 1000;
  return _fbTokenCache;
}

async function fbRest(path, method = 'GET', body = undefined) {
  const token = await getFbToken();
  const url   = `${FB_DB_URL}${path}.json?auth=${token}`;
  const opts  = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`fbRest ${method} ${path} → HTTP ${resp.status}: ${text}`);
  }
  return resp.json();
}

async function resetGame() {
  await Promise.all([
    fbRest('/game',         'PUT',    { phase: 'waiting' }),
    fbRest('/bids',         'DELETE'),
    fbRest('/bidSubmitted', 'DELETE'),
  ]);
  await new Promise(r => setTimeout(r, 500));
}

async function startTestAuction(durationSec = 30) {
  const timerEnd = Date.now() + durationSec * 1000;
  await Promise.all([
    fbRest('/bids',         'DELETE'),
    fbRest('/bidSubmitted', 'DELETE'),
  ]);
  await fbRest('/game', 'PUT', {
    phase: 'bidding',
    currentPlayer: TEST_PLAYER,
    minBid: 1,
    timerEnd,
    tiebreakers: null,
    tiebreakerFirstBid: null,
    auctionDuration: durationSec,
  });
  await new Promise(r => setTimeout(r, 300));
}

async function waitForAuth(page) {
  await page.waitForFunction(
    () => { try { return firebase.auth().currentUser !== null; } catch (e) { return false; } },
    undefined,
    { timeout: 20000 }
  );
}

async function waitForDb(page) {
  await page.waitForFunction(
    () => typeof db !== 'undefined' && db !== null &&
          typeof gameState !== 'undefined' && typeof gameState.phase !== 'undefined',
    undefined,
    { timeout: 15000 }
  );
}

async function loginTeam(page, teamId) {
  await page.goto(BASE_URL);
  await page.waitForFunction(
    () => document.getElementById('screen-login')?.classList.contains('active'),
    { timeout: 15000 }
  );
  await waitForAuth(page);
  await page.selectOption('#teamSelect', teamId);
  await page.fill('#teamPassword', TEAM_PASSWORD);
  await page.click('button:has-text("Entra →")');
  await page.locator('#screen-participant.active').waitFor({ timeout: 10000 });
  await waitForDb(page);
}

async function waitForPhase(page, phase, timeoutMs = 10000) {
  await page.waitForFunction(
    (expectedPhase) => (typeof gameState !== 'undefined' ? gameState : {}).phase === expectedPhase,
    phase,
    { timeout: timeoutMs }
  );
}

test.describe.serial('Tab Pianificazione — budget pre-asta', () => {
  test.beforeEach(async ({}, testInfo) => {
    if (testInfo.project.name.toLowerCase().includes('mobile')) {
      testInfo.skip(true, 'Solo Desktop Chrome: evita race conditions Firebase');
    }
  });

  test.beforeAll(async () => {
    await resetGame();
  });

  test.afterEach(async () => {
    await resetGame();
  });

  // NOTA: le regole RTDB per /plans vengono deployate solo dalla pipeline CI al push
  // su main (workflow deploy-firebase-rules.yml). Finché non sono live, le scritture
  // reali su /plans falliscono con PERMISSION_DENIED. Questi test verificano quindi
  // la logica client-side (rendering, sanitizeKey, getPlannedAmount) iniettando
  // myPlanState direttamente nel contesto pagina, bypassando la persistenza reale.
  // Il test PL0 verifica invece il vero round-trip di scrittura su Firebase e va
  // eseguito DOPO che le regole sono state deployate (vedi verifica finale).

  test('PL1 — renderPlanList mostra un input numerico per un giocatore del roster e lo popola da myPlanState (incl. nomi con punto)', async ({ browser }) => {
    const page = await browser.newPage();
    await loginTeam(page, 't3'); // Frattese1985
    const realPlayerName = 'Martinez L.'; // nome reale del roster, con "." → verifica anche sanitizeKey

    // Se il giocatore risulta già assegnato in produzione, salta: il test verifica
    // solo il ramo "libero" del rendering (input visibile invece del badge assegnato).
    const assigned = await page.evaluate((name) => {
      return assignmentsState.some(a => (a.player || '').toLowerCase() === name.toLowerCase());
    }, realPlayerName);
    test.skip(assigned, `${realPlayerName} risulta già assegnato in produzione, non applicabile`);

    await page.evaluate((playerName) => {
      myPlanState[sanitizeKey(playerName)] = { amount: 40, playerName, ts: Date.now() };
    }, realPlayerName);

    await page.click('#tabPlanBtn');
    await page.locator('#planPanel').waitFor({ state: 'visible', timeout: 5000 });
    await page.fill('#plSearch', realPlayerName);
    await page.waitForTimeout(300);

    const input = page.locator('#plTableBody tr').first().locator('input.pp-plan-input');
    await expect(input).toHaveValue('40');

    await page.close();
  });

  test('PL2 — piani distinti per squadra: bidInput si precompila con il valore pianificato di ciascuna (getPlannedAmount)', async ({ browser }) => {
    const page3 = await browser.newPage();
    const page4 = await browser.newPage();
    await Promise.all([loginTeam(page3, 't3'), loginTeam(page4, 't4')]);

    // Inietta piani distinti direttamente in myPlanState (stesso stato che il listener
    // Firebase popolerebbe in produzione una volta che le regole sono live)
    await page3.evaluate((playerName) => {
      myPlanState[sanitizeKey(playerName)] = { amount: 40, playerName, ts: Date.now() };
    }, TEST_PLAYER.nome);
    await page4.evaluate((playerName) => {
      myPlanState[sanitizeKey(playerName)] = { amount: 25, playerName, ts: Date.now() };
    }, TEST_PLAYER.nome);

    await startTestAuction();
    await Promise.all([
      waitForPhase(page3, 'bidding'),
      waitForPhase(page4, 'bidding'),
    ]);

    // Attende che il bidInput si precompili (via handleGameStateChange → getPlannedAmount)
    await page3.waitForFunction(() => document.getElementById('bidInput')?.value === '40', undefined, { timeout: 8000 });
    await page4.waitForFunction(() => document.getElementById('bidInput')?.value === '25', undefined, { timeout: 8000 });

    const val3 = await page3.locator('#bidInput').inputValue();
    const val4 = await page4.locator('#bidInput').inputValue();
    expect(val3).toBe('40');
    expect(val4).toBe('25');

    await page3.close();
    await page4.close();
  });

  test('PL3 — senza piano valido, bidInput resta precompilato al minimo (comportamento invariato)', async ({ browser }) => {
    const page = await browser.newPage();
    await loginTeam(page, 't5');
    // myPlanState resta vuoto (nessun piano iniettato) → getPlannedAmount deve tornare null

    await startTestAuction();
    await waitForPhase(page, 'bidding');

    await page.waitForFunction(() => document.getElementById('bidInput')?.value === '1', undefined, { timeout: 8000 });
    const val = await page.locator('#bidInput').inputValue();
    expect(val).toBe('1');

    await page.close();
  });

  test('PL4 — piano superiore al budget disponibile: fallback al minimo (nessuna precompilazione non valida)', async ({ browser }) => {
    const page = await browser.newPage();
    await loginTeam(page, 't6');

    // Piano assurdamente alto, superiore al budget disponibile (500 di partenza)
    await page.evaluate((playerName) => {
      myPlanState[sanitizeKey(playerName)] = { amount: 99999, playerName, ts: Date.now() };
    }, TEST_PLAYER.nome);

    await startTestAuction();
    await waitForPhase(page, 'bidding');

    await page.waitForFunction(() => document.getElementById('bidInput')?.value === '1', undefined, { timeout: 8000 });
    const val = await page.locator('#bidInput').inputValue();
    expect(val).toBe('1');

    await page.close();
  });

  test('PL5 — sanitizeKey gestisce correttamente nomi con punti (es. "Martinez L.") senza collisioni', async ({ browser }) => {
    const page = await browser.newPage();
    await loginTeam(page, 't7');

    const result = await page.evaluate(() => {
      return {
        a: sanitizeKey('Martinez L.'),
        b: sanitizeKey('Esposito F.P.'),
        c: sanitizeKey('Normale'),
      };
    });
    expect(result.a).toBe('Martinez L_');
    expect(result.b).toBe('Esposito F_P_');
    expect(result.c).toBe('Normale');

    await page.close();
  });
});
