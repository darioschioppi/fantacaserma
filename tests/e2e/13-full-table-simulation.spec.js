/**
 * 13 - Simulazione tavolo completo: tutte le 10 squadre, asta dall'inizio alla fine
 *
 * A differenza di 08-auction-simulation.spec.js (che usa perlopiù REST API per le
 * offerte, con solo 1-2 pagine browser reali), questo file apre TUTTE le 10 squadre
 * come pagine browser reali con login vero via UI, e fa scorrere un'asta completa
 * su più giocatori consecutivi usando i bottoni reali dell'app (stepper, OFFERTA,
 * Passa) — il test più fedele possibile a una sessione d'asta reale con tutti i
 * partecipanti collegati.
 *
 * Copre anche il caso critico introdotto in questa sessione: una squadra che si
 * disconnette a metà turno blocca l'asta, e la riconnessione la fa ripartire da sola.
 *
 * ATTENZIONE: scrive sul Firebase di produzione. Le assegnazioni di test vengono
 * eliminate a fine suite. Eseguire quando non è in corso un'asta reale.
 */

const { test, expect } = require('@playwright/test');
const { BASE_URL, TEAM_PASSWORD } = require('./helpers');

const TEAMS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10']; // t2 = Benfiga (presidente)
const BUDGET_START = 500;
const TEST_PLAYERS = [
  { nome: '__FULLTABLE_P1__', squadra: 'TestFC', ruolo: 'A', qi: 1 },
  { nome: '__FULLTABLE_P2__', squadra: 'TestFC', ruolo: 'D', qi: 1 },
];

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

/** Rimuove le assegnazioni di test e ripristina i budget delle squadre coinvolte. */
async function cleanupTestAssignments() {
  const raw = (await fbRest('/assignments', 'GET')) || {};
  const teamsRaw = (await fbRest('/teams', 'GET')) || {};
  const testNames = TEST_PLAYERS.map(p => p.nome);
  const ops = [];
  for (const [key, val] of Object.entries(raw)) {
    if (!val || !testNames.includes(val.player)) continue;
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
async function waitForPhase(page, phase, timeoutMs = 15000) {
  await page.waitForFunction(
    (expectedPhase) => (typeof gameState !== 'undefined' ? gameState : {}).phase === expectedPhase,
    phase, { timeout: timeoutMs }
  );
}
async function getAssignments() {
  const raw = (await fbRest('/assignments', 'GET')) || {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw).map(([key, val]) => ({ ...val, _key: key }));
}
async function getGameState() {
  return (await fbRest('/game', 'GET')) || {};
}

test.describe.serial('Simulazione tavolo completo — tutte le squadre, asta reale end-to-end', () => {
  test.beforeEach(async ({}, testInfo) => {
    if (testInfo.project.name.toLowerCase().includes('mobile')) {
      testInfo.skip(true, 'Solo Desktop Chrome: evita race conditions Firebase con 10 login simultanei');
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

  test('FT1 — 10 squadre collegate, due giocatori messi all\'asta in sequenza, assegnazione corretta ad ogni turno', async ({ browser }) => {
    // Login reale di tutte le 10 squadre (Benfiga = t2 è il presidente/admin).
    const pages = {};
    await Promise.all(TEAMS.map(async (tid) => {
      const p = await browser.newPage();
      await loginTeam(p, tid);
      pages[tid] = p;
    }));
    const admin = pages['t2'];

    // Tutte le squadre risultano online lato server (contatore sessioni multi-device,
    // presence check reale — non un mock — su tutte le 10 squadre connesse).
    await admin.waitForFunction(
      () => TEAMS.every(t => isTeamOnline(t.id)),
      undefined, { timeout: 10000 }
    );

    // ── Turno 1: giocatore __FULLTABLE_P1__, vincitore netto t3 ──────────────
    const p1 = TEST_PLAYERS[0];
    await admin.evaluate((player) => {
      autoRevealFired = false; // stesso reset che fa adminStartAuction() in produzione
      db.ref('/game').update({
        phase: 'bidding', currentPlayer: player, minBid: 1,
        timerEnd: Date.now() + 20000, tiebreakers: null, tiebreakerFirstBid: null,
        auctionDuration: 20,
      });
    }, p1);
    await Promise.all(TEAMS.map(tid => waitForPhase(pages[tid], 'bidding', 10000)));

    // Ogni squadra usa i controlli REALI della UI: t3 offre 70, gli altri passano.
    for (const tid of TEAMS) {
      const page = pages[tid];
      await page.waitForFunction(() => document.getElementById('bidInputArea')?.style.display === 'flex', { timeout: 8000 });
      if (tid === 't3') {
        await page.fill('#bidInput', '70');
        await page.click('#btnBid');
      } else {
        await page.click('#btnPass');
      }
    }

    // Auto-reveal (tutti hanno risposto) → assegnazione automatica a t3.
    await waitForPhase(admin, 'assigned', 15000);
    let assignments = await getAssignments();
    let assign1 = assignments.find(a => a.player === p1.nome);
    expect(assign1?.teamId).toBe('t3');
    expect(assign1?.amount).toBe(70);

    // Torna a 'waiting' da sola dopo l'overlay di assegnazione.
    await waitForPhase(admin, 'waiting', 10000);

    // ── Turno 2: secondo giocatore, pareggio tra due squadre → spareggio ─────
    const p2 = TEST_PLAYERS[1];
    await admin.evaluate((player) => {
      autoRevealFired = false;
      db.ref('/game').update({
        phase: 'bidding', currentPlayer: player, minBid: 1,
        timerEnd: Date.now() + 20000, tiebreakers: null, tiebreakerFirstBid: null,
        auctionDuration: 20,
      });
    }, p2);
    await Promise.all(TEAMS.map(tid => waitForPhase(pages[tid], 'bidding', 10000)));

    for (const tid of TEAMS) {
      const page = pages[tid];
      await page.waitForFunction(() => document.getElementById('bidInputArea')?.style.display === 'flex', { timeout: 8000 });
      if (tid === 't5' || tid === 't8') {
        await page.fill('#bidInput', '55');
        await page.click('#btnBid');
      } else {
        await page.click('#btnPass');
      }
    }

    // Reveal → pareggio → tiebreaker tra t5 e t8.
    await waitForPhase(admin, 'tiebreaker', 15000);
    let gs = await getGameState();
    expect(gs.tiebreakers).toContain('t5');
    expect(gs.tiebreakers).toContain('t8');
    expect(gs.tiebreakers.length).toBe(2);

    // Solo t5/t8 sono coinvolti nello spareggio: durante il tiebreaker non si può
    // passare (si DEVE rilanciare, vedi banner "non puoi passare"), quindi entrambe
    // rioffrono ma t5 rilancia più alto per ottenere un vincitore netto.
    const t5page = pages['t5'];
    const t8page = pages['t8'];
    await t5page.waitForFunction(() => document.getElementById('bidInputArea')?.style.display === 'flex', { timeout: 8000 });
    await t8page.waitForFunction(() => document.getElementById('bidInputArea')?.style.display === 'flex', { timeout: 8000 });
    await t8page.fill('#bidInput', '55');
    await t8page.click('#btnBid');
    await t5page.fill('#bidInput', '60');
    await t5page.click('#btnBid');

    await waitForPhase(admin, 'assigned', 15000);
    assignments = await getAssignments();
    const assign2 = assignments.find(a => a.player === p2.nome);
    expect(assign2?.teamId).toBe('t5');
    expect(assign2?.amount).toBe(60);

    await Promise.all(Object.values(pages).map(p => p.close()));
  });

  test('FT2 — disconnessione a metà turno blocca l\'asta con TUTTE le squadre collegate, riconnessione la fa ripartire', async ({ browser }) => {
    const pages = {};
    await Promise.all(TEAMS.map(async (tid) => {
      const p = await browser.newPage();
      await loginTeam(p, tid);
      pages[tid] = p;
    }));
    const admin = pages['t2'];

    const player = TEST_PLAYERS[0];
    await admin.evaluate((p) => {
      autoRevealFired = false;
      db.ref('/game').update({
        phase: 'bidding', currentPlayer: p, minBid: 1,
        timerEnd: Date.now() + 30000, tiebreakers: null, tiebreakerFirstBid: null,
        auctionDuration: 30,
      });
    }, player);
    await Promise.all(TEAMS.map(tid => waitForPhase(pages[tid], 'bidding', 10000)));

    // Alcune squadre offrono, ma t9 si disconnette (chiusura pagina) senza aver
    // risposto: la sua sessione di presenza viene rimossa via onDisconnect().
    for (const tid of ['t1', 't3', 't4']) {
      const page = pages[tid];
      await page.waitForFunction(() => document.getElementById('bidInputArea')?.style.display === 'flex', { timeout: 8000 });
      await page.click('#btnPass');
    }
    await pages['t9'].close();
    delete pages['t9'];

    // Dopo il debounce (~3s), l'asta va in pausa per disconnessione anche con
    // tutte le altre 9 squadre ancora regolarmente connesse.
    await waitForPhase(admin, 'paused', 8000);
    let gs = await getGameState();
    expect(gs.pausedReason).toBe('disconnect');
    expect(gs.disconnectedTeamId).toBe('t9');

    // Un partecipante vede il banner rosso di disconnessione.
    const observer = pages['t4'];
    await observer.waitForFunction(
      () => document.getElementById('disconnectBanner')?.classList.contains('visible'),
      { timeout: 8000 }
    );
    const bannerText = await observer.locator('#disconnectBanner').textContent();
    expect(bannerText).toContain('disconnessa');

    // t9 si riconnette (nuovo login): l'asta riprende automaticamente da sola,
    // senza alcuna azione del presidente né timeout — appena tutti sono online.
    const t9page = await browser.newPage();
    await loginTeam(t9page, 't9');
    pages['t9'] = t9page;

    await waitForPhase(admin, 'bidding', 10000);
    gs = await getGameState();
    expect(gs.pausedReason == null).toBe(true);
    expect(gs.disconnectedTeamId == null).toBe(true);
    expect(gs.timerEnd).toBeGreaterThan(Date.now());

    await Promise.all(Object.values(pages).map(p => p.close()));
  });
});
