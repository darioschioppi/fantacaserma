/**
 * 18 - Feature: Gestione disconnessione durante l'asta — squadra con reparto
 * già completo (rosa piena per il ruolo del calciatore corrente)
 *
 * Requisito (Dario): una squadra che ha già completato il reparto del
 * calciatore attualmente all'asta non può più fare offerte per lui — la sua
 * disconnessione, quindi, NON deve influire sul normale svolgimento dell'asta
 * (né bloccarla, né impedirne la ripresa). La verifica va fatta sul reparto
 * del calciatore CORRENTE, non sul numero totale di giocatori acquistati.
 *
 * Comportamento per le squadre che possono ancora offrire resta quello già
 * verificato in 15-uat-disconnessione-ac.spec.js/16-uat-completo-disconnessioni.
 * spec.js (blocco totale se anche una sola squadra "rilevante" è offline).
 *
 * Implementazione verificata: canTeamBidForCurrentPlayer(teamId) in index.html
 * (usa isRosterFull() sul ruolo di gameState.currentPlayer), applicata dentro
 * checkDisconnectionPause() sia al rilevamento di nuova disconnessione sia al
 * calcolo della ripresa.
 *
 * Per limitare le sign-in anonime reali (rate-limit Firebase Auth), la suite
 * usa 2 pagine browser reali (Presidente t2 + osservatore t1) e simula le
 * altre squadre via scrittura REST diretta su /teams/{id}/sessions.
 *
 * ATTENZIONE: scrive sul Firebase di produzione. Eseguire solo quando non è
 * in corso un'asta reale.
 */

const { test, expect } = require('@playwright/test');
const { BASE_URL, TEAM_PASSWORD } = require('./helpers');

const TEAMS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10'];
const REAL_TEAMS = ['t1', 't2'];
const FAKE_TEAMS = TEAMS.filter(t => !REAL_TEAMS.includes(t));
const BUDGET_START = 500;
const ROSTER_MAX = { P: 3, D: 8, C: 8, A: 6 };
const P = (ruolo) => ({ nome: '__UAT18_' + Math.random().toString(36).slice(2, 8) + '__', squadra: 'TestFC', ruolo: ruolo || 'A', qi: 1 });

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
  await new Promise(r => setTimeout(r, 400));
}

/** Riempie artificialmente il reparto `ruolo` di `teamId` con assegnazioni
 * fittizie fino al massimo consentito, così isRosterFull() diventa vera.
 * Attende poi che il client del presidente (che legge assignmentsState via
 * listener realtime, la stessa fonte usata da checkDisconnectionPause()) abbia
 * effettivamente recepito l'aggiornamento — altrimenti un disconnect subito
 * dopo la sola scrittura server-side rischia una race condition nel TEST
 * (isRosterFull ancora falsa lato client per qualche centinaio di ms). */
async function fillRoster(teamId, ruolo, presPage) {
  const max = ROSTER_MAX[ruolo];
  const raw = (await fbRest('/assignments', 'GET')) || {};
  const already = Object.values(raw).filter(a => a && a.teamId === teamId && (a.ruolo || '').charAt(0) === ruolo).length;
  const toAdd = Math.max(0, max - already);
  const names = [];
  const ops = [];
  for (let i = 0; i < toAdd; i++) {
    const name = '__UAT18_FILLER_' + teamId + '_' + ruolo + '_' + i + '__';
    names.push(name);
    ops.push(fbRest('/assignments', 'POST', {
      player: name, ruolo, teamId, teamName: teamId, amount: 1, timestamp: Date.now(),
    }));
  }
  if (ops.length) await Promise.all(ops);
  if (presPage) {
    await presPage.waitForFunction(
      ([tid, r, m]) => typeof isRosterFull === 'function' && isRosterFull(tid, r) === true,
      [teamId, ruolo, max], { timeout: 10000 }
    );
  }
  return names; // per pulizia
}
async function cleanupTestAssignments(playerNames) {
  const raw = (await fbRest('/assignments', 'GET')) || {};
  const teamsRaw = (await fbRest('/teams', 'GET')) || {};
  const ops = [];
  for (const [key, val] of Object.entries(raw)) {
    if (!val || !playerNames.includes(val.player)) continue;
    ops.push(fbRest(`/assignments/${key}`, 'DELETE'));
    const td = teamsRaw[val.teamId] || {};
    const newBudget = (td.budget != null ? td.budget : BUDGET_START) + (val.amount || 0);
    const newRoster = Math.max(0, (td.rosterCount || 0) - 1);
    ops.push(fbRest(`/teams/${val.teamId}`, 'PATCH', { budget: newBudget, rosterCount: newRoster }));
  }
  if (ops.length) await Promise.all(ops);
  await new Promise(r => setTimeout(r, 400));
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
async function waitForPhase(page, phase, timeoutMs = 15000) {
  await page.waitForFunction(
    (expectedPhase) => (typeof gameState !== 'undefined' ? gameState : {}).phase === expectedPhase,
    phase, { timeout: timeoutMs }
  );
}
async function getGameState() { return (await fbRest('/game', 'GET')) || {}; }
async function startTestAuction(adminPage, player, durationSec = 20) {
  const timerEnd = Date.now() + durationSec * 1000;
  await adminPage.evaluate(() => { autoRevealFired = false; });
  await fbRest('/game', 'PUT', {
    phase: 'bidding', currentPlayer: player, minBid: 1, timerEnd,
    tiebreakers: null, tiebreakerFirstBid: null, auctionDuration: durationSec,
  });
}
async function setAllOnlineBaseline() {
  await Promise.all(FAKE_TEAMS.map(tid => fbRest(`/teams/${tid}/sessions/fake`, 'PUT', true)));
}
async function fakeDisconnect(tid) { await fbRest(`/teams/${tid}/sessions/fake`, 'DELETE'); }
async function fakeReconnect(tid) { await fbRest(`/teams/${tid}/sessions/fake`, 'PUT', true); }
async function clearAllSessions() {
  await Promise.all(TEAMS.filter(t => !REAL_TEAMS.includes(t)).map(tid =>
    fbRest(`/teams/${tid}/sessions`, 'DELETE').catch(() => {})
  ));
}

const allFillerNames = [];
const usedPlayerNames = [];

test.describe.serial('Feature — disconnessione ignorata per squadra con reparto già completo', () => {
  test.beforeEach(async ({}, testInfo) => {
    if (testInfo.project.name.toLowerCase().includes('mobile')) {
      testInfo.skip(true, 'Solo Desktop Chrome: evita race conditions Firebase');
    }
  });

  /** @type {import('@playwright/test').Page} */
  let pres, obs;

  test.beforeAll(async ({ browser }) => {
    await resetGame();
    pres = await browser.newPage();
    obs = await browser.newPage();
    await Promise.all([loginTeam(pres, 't2'), loginTeam(obs, 't1')]);
  });

  test.beforeEach(async () => {
    await resetGame();
    await setAllOnlineBaseline();
  });

  test.afterEach(async () => {
    await resetGame();
  });

  test.afterAll(async () => {
    await cleanupTestAssignments(allFillerNames.concat(usedPlayerNames));
    await clearAllSessions();
    await Promise.all([pres?.close(), obs?.close()]);
  });

  test('AC1 — squadra con reparto Portiere pieno che si disconnette: NON sospende l\'asta durante un\'asta di un Portiere', async () => {
    // t5 ha già 3/3 portieri: riempie il reparto artificialmente.
    const fillers = await fillRoster('t5', 'P', pres);
    allFillerNames.push(...fillers);

    const player = P('P'); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 20);
    await waitForPhase(pres, 'bidding', 10000);

    await fakeDisconnect('t5');
    // Attesa oltre il debounce (~3s): l'asta NON deve andare in pausa.
    await pres.waitForTimeout(4500);
    const gs = await getGameState();
    expect(gs.phase).toBe('bidding');
    expect(gs.pausedReason == null).toBe(true);

    await fakeReconnect('t5');
  });

  test('AC2 — la STESSA squadra (reparto Portiere pieno) che si disconnette DURANTE un\'asta di un Attaccante: sospende normalmente', async () => {
    // t5 ha ancora 3/3 portieri (dal test precedente/fillRoster), ma il
    // reparto rilevante ORA è Attaccante — la verifica deve essere sul ruolo
    // del calciatore CORRENTE, non sul totale giocatori acquistati.
    const player = P('A'); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 20);
    await waitForPhase(pres, 'bidding', 10000);

    await fakeDisconnect('t5');
    await waitForPhase(pres, 'paused', 8000);
    const gs = await getGameState();
    expect(gs.disconnectedTeamIds).toContain('t5');

    await fakeReconnect('t5');
    await waitForPhase(pres, 'bidding', 10000);
  });

  test('AC3 — due squadre disconnesse: una con reparto pieno (ignorata) e una normale (blocca): l\'asta si sospende solo per quella normale', async () => {
    const fillers = await fillRoster('t6', 'P', pres);
    allFillerNames.push(...fillers);

    const player = P('P'); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 25);
    await waitForPhase(pres, 'bidding', 10000);

    // t6 (reparto P pieno, ignorata) e t7 (normale, blocca) si disconnettono insieme.
    await Promise.all([fakeDisconnect('t6'), fakeDisconnect('t7')]);
    await waitForPhase(pres, 'paused', 8000);
    const gs = await getGameState();
    // Solo t7 compare come causa della sospensione, non t6.
    expect(gs.disconnectedTeamIds).toEqual(['t7']);

    await fakeReconnect('t6');
    await pres.waitForTimeout(1200);
    // t6 non era comunque "rilevante": la riconnessione di t6 non cambia nulla,
    // resta sospesa perché t7 è ancora offline.
    let gs2 = await getGameState();
    expect(gs2.phase).toBe('paused');

    await fakeReconnect('t7');
    await waitForPhase(pres, 'bidding', 10000);
    gs2 = await getGameState();
    expect(gs2.pausedReason == null).toBe(true);
  });

  test('AC4 — riconnessione ignorata: quando l\'unica squadra offline ha il reparto pieno, la ripresa avviene comunque per le altre', async () => {
    const fillers = await fillRoster('t8', 'D', pres);
    allFillerNames.push(...fillers);

    const player = P('D'); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 20);
    await waitForPhase(pres, 'bidding', 10000);

    // t9 (normale) si disconnette → sospende.
    await fakeDisconnect('t9');
    await waitForPhase(pres, 'paused', 8000);

    // t8 (reparto D pieno) si disconnette a sua volta MENTRE già sospesa: non
    // deve comparire nell'elenco delle squadre bloccanti.
    await fakeDisconnect('t8');
    await pres.waitForTimeout(1500);
    let gs = await getGameState();
    expect(gs.disconnectedTeamIds).toEqual(['t9']); // t8 non compare

    // La riconnessione di t9 (l'unica rilevante) fa riprendere l'asta, anche
    // se t8 resta offline (irrilevante per il reparto D già completo).
    await fakeReconnect('t9');
    await waitForPhase(pres, 'bidding', 10000);
    gs = await getGameState();
    expect(gs.pausedReason == null).toBe(true);

    await fakeReconnect('t8');
  });

  test('AC5 — comportamento invariato per squadre normali: nessuna regressione sul blocco totale già verificato', async () => {
    const player = P('C'); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 20);
    await waitForPhase(pres, 'bidding', 10000);

    // Nessun reparto pieno coinvolto: comportamento invariato (blocco totale).
    await fakeDisconnect('t3');
    await waitForPhase(pres, 'paused', 8000);
    const gs = await getGameState();
    expect(gs.disconnectedTeamIds).toEqual(['t3']);

    await fakeReconnect('t3');
    await waitForPhase(pres, 'bidding', 10000);
    const gs2 = await getGameState();
    expect(gs2.pausedReason == null).toBe(true);
  });
});
