/**
 * 14 - UAT: inserimento prezzo Benfiga e scadenza del timer
 *
 * User Story (Dario): come squadra Benfiga, quando inserisco un prezzo durante
 * un'asta, l'asta deve rimanere attiva fino al completamento del timer e NON
 * deve essere terminata/rivelata automaticamente prima della sua scadenza.
 *
 * Riproduce esattamente lo scenario del bug corretto in questa sessione
 * (checkAutoReveal chiudeva l'asta all'istante se solo Benfiga era online,
 * perché considerava "eligible" solo le squadre connesse — vedi commit
 * "Fix: asta chiusa istantaneamente se poche squadre sono online").
 *
 * Passi UAT seguiti alla lettera:
 *  1. Avvia un'asta.
 *  2. Verifica che il timer sia attivo.
 *  3. Accedi come Benfiga.
 *  4. Inserisci un prezzo valido.
 *  5. Confermalo (bottone OFFERTA).
 *  6. Verifica che l'asta resti IN CORSO (phase: 'bidding') subito dopo.
 *  7. Attendi il completamento naturale del timer.
 *  8. Verifica lo stato dell'asta al termine del timer.
 *  9. Verifica che solo a quel punto l'asta venga rivelata/terminata.
 *
 * ATTENZIONE: scrive sul Firebase di produzione. Le assegnazioni di test
 * vengono eliminate a fine suite.
 */

const { test, expect } = require('@playwright/test');
const { BASE_URL, TEAM_PASSWORD } = require('./helpers');

const TEST_PLAYER = { nome: '__UAT_BENFIGA_TIMER__', squadra: 'TestFC', ruolo: 'A', qi: 1 };
const BUDGET_START = 500;
const AUCTION_DURATION_SEC = 12; // timer breve ma sufficiente a osservare la fase intermedia

const FB_API_KEY = 'AIzaSyCOTpDSNMVvK8kYNw11OfBIQm3JaAx9kIM';
const FB_DB_URL  = 'https://fantacaserma-f2fe2-default-rtdb.europe-west1.firebasedatabase.app';

let _fbTokenCache = null;
let _fbTokenExpiry = 0;
async function getFbToken() {
  if (_fbTokenCache && Date.now() < _fbTokenExpiry) return _fbTokenCache;
  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FB_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const data = await resp.json();
  if (!data.idToken) throw new Error('getFbToken failed: ' + JSON.stringify(data));
  _fbTokenCache = data.idToken;
  _fbTokenExpiry = Date.now() + 55 * 60 * 1000;
  return _fbTokenCache;
}
async function fbRest(path, method = 'GET', body) {
  const token = await getFbToken();
  const url = `${FB_DB_URL}${path}.json?auth=${token}`;
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  if (!resp.ok) throw new Error(`fbRest ${method} ${path} → HTTP ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function resetGame() {
  await Promise.all([
    fbRest('/game', 'PUT', { phase: 'waiting' }),
    fbRest('/bids', 'DELETE'),
    fbRest('/bidSubmitted', 'DELETE'),
  ]);
  await new Promise(r => setTimeout(r, 500));
}

async function cleanupTestAssignments() {
  const raw = (await fbRest('/assignments', 'GET')) || {};
  const teamsRaw = (await fbRest('/teams', 'GET')) || {};
  const ops = [];
  for (const [key, val] of Object.entries(raw)) {
    if (!val || val.player !== TEST_PLAYER.nome) continue;
    ops.push(fbRest(`/assignments/${key}`, 'DELETE'));
    const td = teamsRaw[val.teamId] || {};
    const newBudget = (td.budget != null ? td.budget : BUDGET_START) + (val.amount || 0);
    const newRoster = Math.max(0, (td.rosterCount || 0) - 1);
    ops.push(fbRest(`/teams/${val.teamId}`, 'PATCH', { budget: newBudget, rosterCount: newRoster }));
  }
  if (ops.length) await Promise.all(ops);
  await new Promise(r => setTimeout(r, 500));
}

async function waitForAuth(page) {
  await page.waitForFunction(
    () => { try { return firebase.auth().currentUser !== null; } catch (e) { return false; } },
    undefined, { timeout: 20000 }
  );
}
async function waitForDb(page) {
  await page.waitForFunction(
    () => typeof db !== 'undefined' && db !== null &&
          typeof gameState !== 'undefined' && typeof gameState.phase !== 'undefined',
    undefined, { timeout: 15000 }
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
async function getGameState() {
  return (await fbRest('/game', 'GET')) || {};
}

test.describe.serial('UAT — Asta: inserimento prezzo Benfiga e scadenza del timer', () => {
  test.beforeEach(async ({}, testInfo) => {
    if (testInfo.project.name.toLowerCase().includes('mobile')) {
      testInfo.skip(true, 'Solo Desktop Chrome: evita race conditions Firebase');
    }
  });

  test.beforeAll(async () => {
    await resetGame();
    await cleanupTestAssignments();
  });

  test.afterEach(async () => {
    await resetGame();
  });

  test.afterAll(async () => {
    await cleanupTestAssignments();
  });

  test('UAT — il prezzo di Benfiga non chiude l\'asta prima dello scadere del timer', async ({ browser }) => {
    // Passo 3: accedi come Benfiga (t2, presidente/admin)
    const benfiga = await browser.newPage();
    await loginTeam(benfiga, 't2');

    // Passo 1: avvia un'asta (equivalente a adminStartAuction, via scrittura diretta
    // di /game come fa il pannello presidente — stesso schema campi).
    const timerEnd = Date.now() + AUCTION_DURATION_SEC * 1000;
    await benfiga.evaluate((p) => { autoRevealFired = false; }, TEST_PLAYER);
    await fbRest('/game', 'PUT', {
      phase: 'bidding',
      currentPlayer: TEST_PLAYER,
      minBid: 1,
      timerEnd,
      tiebreakers: null,
      tiebreakerFirstBid: null,
      auctionDuration: AUCTION_DURATION_SEC,
    });
    await benfiga.waitForFunction(() => gameState.phase === 'bidding', undefined, { timeout: 10000 });

    // Passo 2: verifica che il timer sia attivo (timerEnd nel futuro, visibile in UI).
    const gsAfterStart = await getGameState();
    expect(gsAfterStart.timerEnd).toBeGreaterThan(Date.now());
    await benfiga.waitForFunction(() => document.getElementById('bidInputArea')?.style.display === 'flex', { timeout: 8000 });
    // Il countdown si aggiorna via setInterval (200ms): attende che si stacchi dal
    // placeholder "—" (usato solo fuori asta) per confermare che il timer sia attivo.
    await benfiga.waitForFunction(
      () => document.getElementById('auctionHeaderTimer')?.textContent !== '—',
      undefined, { timeout: 5000 }
    );
    const timerLabelBefore = await benfiga.locator('#auctionHeaderTimer').textContent();
    expect(timerLabelBefore).toMatch(/^\d+s$/);

    // Passo 4-5: Benfiga inserisce un prezzo valido e lo confermA con il bottone reale.
    await benfiga.fill('#bidInput', '42');
    await benfiga.click('#btnBid');

    // Il flag "Offerta inviata!" deve comparire (conferma UI dell'inserimento).
    await benfiga.waitForFunction(
      () => document.getElementById('bidSent')?.classList.contains('visible'),
      { timeout: 5000 }
    );

    // Passo 6: subito dopo l'inserimento, l'asta deve restare IN CORSO — non deve
    // saltare a 'reveal'/'assigned' solo perché Benfiga (unica squadra online in
    // questo scenario) ha offerto. Attesa breve deliberata per dare tempo a un
    // eventuale bug di manifestarsi, poi verifica che la fase sia ancora 'bidding'.
    await benfiga.waitForTimeout(2000);
    const gsRightAfterBid = await getGameState();
    expect(gsRightAfterBid.phase).toBe('bidding');
    const clientPhaseRightAfter = await benfiga.evaluate(() => gameState.phase);
    expect(clientPhaseRightAfter).toBe('bidding');

    // Ancora in corso qualche secondo dopo, prima che il timer scada.
    await benfiga.waitForTimeout(Math.max(0, timerEnd - Date.now() - 3000));
    const gsStillBidding = await getGameState();
    expect(gsStillBidding.phase).toBe('bidding');

    // Passo 7: attende il completamento naturale del timer (nessuna azione manuale).
    // Passo 8-9: solo allo scadere l'asta passa a 'reveal' e poi viene assegnata.
    await benfiga.waitForFunction(
      () => gameState.phase === 'reveal' || gameState.phase === 'assigned',
      undefined, { timeout: 8000 }
    );
    const gsAfterTimeout = await getGameState();
    expect(['reveal', 'assigned']).toContain(gsAfterTimeout.phase);

    await benfiga.waitForFunction(() => gameState.phase === 'assigned', undefined, { timeout: 15000 });
    const gsFinal = await getGameState();
    expect(gsFinal.phase).toBe('assigned');

    await benfiga.close();
  });
});
