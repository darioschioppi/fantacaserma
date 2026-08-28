/**
 * 16 - UAT completo: Gestione disconnessioni durante l'asta (documento Dario)
 *
 * Copre gli scenari del documento UAT "Gestione disconnessioni durante l'asta
 * del Fantacalcio" NON già coperti da 15-uat-disconnessione-ac.spec.js (AC01-AC12):
 *
 *   - TC-UAT-014  Riconnessione non ordinata
 *   - TC-UAT-015  Disconnessione durante una sospensione già attiva
 *   - TC-UAT-016  Disconnessione/riconnessione ripetuta della stessa squadra
 *   - TC-UAT-019  Timer congelato durante la sospensione (valore esatto)
 *   - TC-UAT-020  Tentativo di offerta rifiutato durante la sospensione
 *   - TC-UAT-021  Nessuna assegnazione anche oltre la scadenza teorica del timer
 *   - TC-UAT-022  Disconnessione durante la ripresa (race tra pausa/ripresa)
 *   - TC-UAT-023  Sequenza casuale — invariante verificato ad ogni passo
 *   - Matrice di copertura per cardinalità 5-10 squadre disconnesse (sezione 27
 *     del documento; le cardinalità 1-4 sono già coperte da AC01-AC12/AC11b)
 *
 * Le cardinalità 1-13 (TC-UAT-001..013) e la disconnessione del miglior
 * offerente/di chi non ha offerto (TC-UAT-002, TC-UAT-018) sono già verificate
 * da AC01-AC12 e non vengono duplicate qui.
 *
 * DEVIAZIONE CONFERMATA (comportamento A, risposta esplicita di Dario): il
 * blocco è TOTALE per tutte le squadre appena UNA sola è offline, non solo
 * per la squadra disconnessa — coerente con la regola di business del
 * documento stesso ("la sospensione deve dipendere dallo stato complessivo
 * delle 10 squadre").
 *
 * Per minimizzare le sign-in anonime reali (causa nota di rate-limit Firebase
 * Auth osservato in sessione), la suite usa SOLO 2 pagine browser reali
 * (Presidente t2 + osservatore t1), mantenute aperte per tutta la suite.
 * Le altre 8 squadre sono simulate esclusivamente via scrittura REST diretta
 * su /teams/{id}/sessions/fake (online = sessione presente, offline = sessione
 * rimossa) — è esattamente il meccanismo di presenza reale letto da
 * isTeamOnline()/checkDisconnectionPause(), quindi il test esercita la stessa
 * logica di produzione senza dover aprire 8 browser aggiuntivi.
 *
 * ATTENZIONE: scrive sul Firebase di produzione. Eseguire solo quando non è
 * in corso un'asta reale (verificare /game e /teams prima del lancio).
 */

const { test, expect } = require('@playwright/test');
const { BASE_URL, TEAM_PASSWORD } = require('./helpers');

const TEAMS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10'];
const REAL_TEAMS = ['t1', 't2']; // t2 = Benfiga (presidente), t1 = osservatore
const FAKE_TEAMS = TEAMS.filter(t => !REAL_TEAMS.includes(t));
const BUDGET_START = 500;
const P = () => ({ nome: '__UAT16_' + Math.random().toString(36).slice(2, 8) + '__', squadra: 'TestFC', ruolo: 'A', qi: 1 });

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
async function getGameState() {
  return (await fbRest('/game', 'GET')) || {};
}
async function startTestAuction(adminPage, player, durationSec = 20) {
  const timerEnd = Date.now() + durationSec * 1000;
  await adminPage.evaluate(() => { autoRevealFired = false; });
  await fbRest('/game', 'PUT', {
    phase: 'bidding', currentPlayer: player, minBid: 1, timerEnd,
    tiebreakers: null, tiebreakerFirstBid: null, auctionDuration: durationSec,
  });
}

/** Ripristina la baseline: le due squadre reali già online via login; le 8
 * squadre "finte" tutte online con una sessione fake. */
async function setAllOnlineBaseline() {
  await Promise.all(FAKE_TEAMS.map(tid => fbRest(`/teams/${tid}/sessions/fake`, 'PUT', true)));
}
/** Simula la disconnessione di una squadra finta rimuovendo la sua sessione. */
async function fakeDisconnect(tid) {
  await fbRest(`/teams/${tid}/sessions/fake`, 'DELETE');
}
/** Simula la riconnessione di una squadra finta. */
async function fakeReconnect(tid) {
  await fbRest(`/teams/${tid}/sessions/fake`, 'PUT', true);
}
async function clearAllSessions() {
  await Promise.all(TEAMS.filter(t => !REAL_TEAMS.includes(t)).map(tid =>
    fbRest(`/teams/${tid}/sessions`, 'DELETE').catch(() => {})
  ));
}

const usedPlayerNames = [];

test.describe.serial('UAT completo — Disconnessioni (TC-UAT-014..023 + matrice cardinalità)', () => {
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
    await cleanupTestAssignments(usedPlayerNames);
    await clearAllSessions();
    await Promise.all([pres?.close(), obs?.close()]);
  });

  // ── TC-UAT-014 — Riconnessione non ordinata ──────────────────────────────
  test('TC-UAT-014 — riconnessione non ordinata (S9→S2→S4): riprende solo dopo l\'ultima', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 30);
    await Promise.all([waitForPhase(pres, 'bidding', 10000), waitForPhase(obs, 'bidding', 10000)]);

    // Disconnette tre squadre finte (t9, t3, t4 — t1/t2 sono le pagine reali
    // e restano sempre online in questo test), rappresentando S9/S2/S4 del
    // documento con id adattati alle squadre effettivamente disponibili.
    await fakeDisconnect('t9');
    await fakeDisconnect('t3');
    await fakeDisconnect('t4');
    await waitForPhase(pres, 'paused', 8000);
    let gs = await getGameState();
    expect(new Set(gs.disconnectedTeamIds)).toEqual(new Set(['t9', 't3', 't4']));

    // Riconnette in ordine casuale: t9 → t3 → t4 (l'ultima riportata online).
    await fakeReconnect('t9');
    await pres.waitForTimeout(1200);
    gs = await getGameState();
    expect(gs.phase).toBe('paused'); // ancora 2 mancanti

    await fakeReconnect('t3');
    await pres.waitForTimeout(1200);
    gs = await getGameState();
    expect(gs.phase).toBe('paused'); // ancora 1 mancante (t4)

    await fakeReconnect('t4');
    await waitForPhase(pres, 'bidding', 10000);
    gs = await getGameState();
    expect(gs.pausedReason == null).toBe(true);
    expect((gs.disconnectedTeamIds || []).length).toBe(0);
  });

  // ── TC-UAT-015 — Disconnessione durante una sospensione già attiva ───────
  test('TC-UAT-015 — nuova disconnessione mentre già sospesa: stato determinato dall\'insieme, riprende solo a zero disconnessi', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 25);
    await Promise.all([waitForPhase(pres, 'bidding', 10000), waitForPhase(obs, 'bidding', 10000)]);

    await fakeDisconnect('t3'); // "S2" del documento
    await waitForPhase(pres, 'paused', 8000);
    let gs = await getGameState();
    expect(gs.disconnectedTeamIds).toEqual(['t3']);

    await fakeDisconnect('t8'); // "S7" del documento, si disconnette DURANTE la pausa
    await pres.waitForTimeout(1500);
    gs = await getGameState();
    expect(gs.phase).toBe('paused');
    expect(new Set(gs.disconnectedTeamIds)).toEqual(new Set(['t3', 't8']));

    await fakeReconnect('t3');
    await pres.waitForTimeout(1200);
    gs = await getGameState();
    expect(gs.phase).toBe('paused'); // t8 ancora offline: non basta la riconnessione di t3

    await fakeReconnect('t8');
    await waitForPhase(pres, 'bidding', 10000);
    gs = await getGameState();
    expect(gs.pausedReason == null).toBe(true);
  });

  // ── TC-UAT-016 — Disconnessione/riconnessione ripetuta della stessa squadra ─
  test('TC-UAT-016 — flapping ripetuto di una squadra: nessuna doppia ripresa, nessun reset timer, nessuna offerta persa', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 30);
    await Promise.all([waitForPhase(pres, 'bidding', 10000), waitForPhase(obs, 'bidding', 10000)]);

    // Un'offerta valida prima del flapping, deve sopravvivere a tutto il ciclo.
    await fbRest('/bids/t1', 'PUT', { amount: 42, ts: Date.now() });
    await fbRest('/bidSubmitted/t1', 'PUT', true);

    for (let i = 0; i < 3; i++) {
      // Rilegge il timer PRIMA di ogni disconnessione: ad ogni ripresa
      // adminResumeAuction() ricalcola timerEnd dal tempo residuo (per design,
      // vedi TC-UAT-019), quindi il valore di riferimento cambia ad ogni giro
      // e va confrontato con quello immediatamente precedente alla pausa, non
      // con quello dell'inizio asta.
      const timerEndBefore = (await getGameState()).timerEnd;
      await fakeDisconnect('t6');
      await waitForPhase(pres, 'paused', 8000);
      const gsP = await getGameState();
      expect(gsP.disconnectedTeamIds).toEqual(['t6']);
      // Il timer congelato in Firebase non deve cambiare durante la pausa
      // rispetto al valore immediatamente precedente (pauseAuction non tocca
      // timerEnd — la piccola differenza di orologio tra client/server è
      // irrilevante, qui verifichiamo solo che NON sia stato resettato/esteso).
      expect(Math.abs(gsP.timerEnd - timerEndBefore)).toBeLessThan(2000);

      await fakeReconnect('t6');
      await waitForPhase(pres, 'bidding', 10000);
      const gsR = await getGameState();
      expect(gsR.pausedReason == null).toBe(true);
    }

    // L'offerta piazzata prima del flapping è ancora quella registrata.
    const bids = await fbRest('/bids');
    expect(bids.t1?.amount).toBe(42);
    // Nessuna assegnazione prematura per il flapping.
    const assignments = (await fbRest('/assignments')) || {};
    expect(Object.values(assignments).some(a => a && a.player === player.nome)).toBe(false);
  });

  // ── TC-UAT-019 — Timer congelato durante la sospensione (valore esatto) ──
  test('TC-UAT-019 — il campo timerEnd resta immutato per tutta la sospensione', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 30);
    await Promise.all([waitForPhase(pres, 'bidding', 10000), waitForPhase(obs, 'bidding', 10000)]);

    const gsBefore = await getGameState();
    const timerEndBefore = gsBefore.timerEnd;

    await fakeDisconnect('t5');
    await waitForPhase(pres, 'paused', 8000);
    const gsAtPause = await getGameState();
    expect(gsAtPause.timerEnd).toBe(timerEndBefore); // pauseAuction non tocca timerEnd

    // Attende un intervallo reale: il valore deve restare identico bit-per-bit.
    await pres.waitForTimeout(4000);
    const gsAfterWait = await getGameState();
    expect(gsAfterWait.phase).toBe('paused');
    expect(gsAfterWait.timerEnd).toBe(timerEndBefore);

    // Alla ripresa, il nuovo timerEnd è calcolato dal tempo RESIDUO al momento
    // della pausa (adminResumeAuction: remaining = frozenEnd - pausedAt), non
    // dall'intera durata configurata — verifichiamo che sia coerente.
    await fakeReconnect('t5');
    await waitForPhase(pres, 'bidding', 10000);
    const gsResumed = await getGameState();
    const expectedRemaining = Math.max(5000, timerEndBefore - gsAtPause.pausedAt);
    const actualRemaining = gsResumed.timerEnd - Date.now();
    // Tolleranza di qualche secondo per il tempo trascorso nell'esecuzione del test.
    expect(Math.abs(actualRemaining - expectedRemaining)).toBeLessThan(6000);
  });

  // ── TC-UAT-020 — Tentativo di offerta rifiutato durante la sospensione ───
  test('TC-UAT-020 — un\'offerta tentata durante la sospensione non viene registrata', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 25);
    await Promise.all([waitForPhase(pres, 'bidding', 10000), waitForPhase(obs, 'bidding', 10000)]);

    await fakeDisconnect('t7');
    await waitForPhase(obs, 'paused', 8000);

    // L'osservatore (t1) è ancora regolarmente connesso ma l'input è nascosto
    // e submitBid() stesso rifiuta di scrivere fuori da bidding/tiebreaker.
    const bidAreaHidden = await obs.evaluate(() => document.getElementById('bidInputArea')?.style.display !== 'flex');
    expect(bidAreaHidden).toBe(true);
    await obs.evaluate(() => {
      const inp = document.getElementById('bidInput');
      if (inp) inp.value = '999';
      submitBid(); // chiamata diretta: submitBid() controlla la fase e ritorna subito
    });
    await obs.waitForTimeout(1000);
    const bids = await fbRest('/bids');
    expect(bids?.t1).toBeUndefined();

    await fakeReconnect('t7');
    await waitForPhase(pres, 'bidding', 10000);
  });

  // ── TC-UAT-021 — Nessuna assegnazione anche oltre la scadenza teorica ────
  test('TC-UAT-021 — nessuna assegnazione durante la sospensione anche dopo la scadenza teorica del timer', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 5); // timer molto breve

    await Promise.all([waitForPhase(pres, 'bidding', 10000), waitForPhase(obs, 'bidding', 10000)]);
    await fbRest('/bids/t1', 'PUT', { amount: 20, ts: Date.now() });
    await fbRest('/bidSubmitted/t1', 'PUT', true);

    await fakeDisconnect('t9');
    await waitForPhase(pres, 'paused', 8000);

    // Attende ben oltre la durata configurata (5s): se il sistema avesse
    // continuato a far scorrere il timer, l'asta sarebbe già stata rivelata
    // e assegnata. Deve invece restare 'paused'.
    await pres.waitForTimeout(8000);
    const gs = await getGameState();
    expect(gs.phase).toBe('paused');
    const assignments = (await fbRest('/assignments')) || {};
    expect(Object.values(assignments).some(a => a && a.player === player.nome)).toBe(false);

    await fakeReconnect('t9');
    await waitForPhase(pres, 'bidding', 10000);
  });

  // ── TC-UAT-022 — Disconnessione durante la ripresa (race pausa/ripresa) ──
  test('TC-UAT-022 — nuova disconnessione proprio mentre l\'asta sta riprendendo: nessuno stato incoerente', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 30);
    await Promise.all([waitForPhase(pres, 'bidding', 10000), waitForPhase(obs, 'bidding', 10000)]);

    await fakeDisconnect('t4');
    await fakeDisconnect('t8');
    await waitForPhase(pres, 'paused', 8000);

    await fakeReconnect('t4');
    await pres.waitForTimeout(1200);
    let gs = await getGameState();
    expect(gs.phase).toBe('paused'); // t8 ancora offline

    await fakeReconnect('t8');
    await waitForPhase(pres, 'bidding', 10000);

    // Subito dopo la ripresa, t4 si disconnette di nuovo: deve tornare in pausa,
    // senza restare in un limbo (fase sempre uno tra 'bidding'/'paused', mai
    // valori corrotti/misti).
    await fakeDisconnect('t4');
    await waitForPhase(pres, 'paused', 8000);
    gs = await getGameState();
    expect(['bidding', 'paused']).toContain(gs.phase);
    expect(gs.disconnectedTeamIds).toEqual(['t4']);

    await fakeReconnect('t4');
    await waitForPhase(pres, 'bidding', 10000);
  });

  // ── TC-UAT-023 — Sequenza casuale: invariante verificato ad ogni passo ───
  test('TC-UAT-023 — sequenza non deterministica: attiva SOLO quando tutte online, in ogni istante osservato', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 40);
    await Promise.all([waitForPhase(pres, 'bidding', 10000), waitForPhase(obs, 'bidding', 10000)]);

    // Sequenza dall'esempio del documento (sezione 26), adattata a 3 squadre finte.
    const steps = [
      { tid: 't3', action: 'down' },
      { tid: 't8', action: 'down' },
      { tid: 't3', action: 'up' },
      { tid: 't5', action: 'down' },
      { tid: 't8', action: 'up' },
      { tid: 't3', action: 'down' },
      { tid: 't5', action: 'up' },
      { tid: 't3', action: 'up' },
    ];
    const offline = new Set();
    for (const step of steps) {
      if (step.action === 'down') { await fakeDisconnect(step.tid); offline.add(step.tid); }
      else { await fakeReconnect(step.tid); offline.delete(step.tid); }
      // Attende la propagazione (debounce ~3s alla prima disconnessione, più
      // rapida per gli aggiornamenti successivi mentre già in pausa).
      await pres.waitForTimeout(3200);
      const gs = await getGameState();
      if (offline.size === 0) {
        expect(gs.phase, `dopo ${step.tid} ${step.action}: tutte online → deve essere 'bidding'`).toBe('bidding');
      } else {
        expect(gs.phase, `dopo ${step.tid} ${step.action}: ${offline.size} offline → deve essere 'paused'`).toBe('paused');
        expect(new Set(gs.disconnectedTeamIds)).toEqual(offline);
      }
    }
  });

  // ── Matrice di copertura — cardinalità 5-10 squadre disconnesse ──────────
  // Le cardinalità 1-4 sono già verificate da AC01-AC12/AC11b in 15-*.spec.js.
  // Qui copriamo il resto della matrice del documento (sezione 27): la
  // sospensione e la mancata ripresa parziale devono valere per QUALSIASI
  // cardinalità, non solo per i casi piccoli già testati altrove.
  const cardinalityScenarios = [
    { n: 5, ids: ['t3', 't4', 't5', 't6', 't7'] },
    { n: 6, ids: ['t3', 't4', 't5', 't6', 't7', 't8'] },
    { n: 7, ids: ['t3', 't4', 't5', 't6', 't7', 't8', 't9'] },
    { n: 8, ids: FAKE_TEAMS.slice(), n8check: true }, // tutte le 8 squadre finte offline
  ];
  for (const scenario of cardinalityScenarios) {
    test(`Matrice cardinalità — ${scenario.n} squadre disconnesse: sospesa, ripresa solo a zero disconnessi`, async () => {
      const player = P(); usedPlayerNames.push(player.nome);
      await startTestAuction(pres, player, 30);
      await Promise.all([waitForPhase(pres, 'bidding', 10000), waitForPhase(obs, 'bidding', 10000)]);

      for (const tid of scenario.ids) await fakeDisconnect(tid);
      await waitForPhase(pres, 'paused', 10000);
      let gs = await getGameState();
      expect(new Set(gs.disconnectedTeamIds)).toEqual(new Set(scenario.ids));

      // Riconnette tutte tranne l'ultima: deve restare sospesa.
      for (let i = 0; i < scenario.ids.length - 1; i++) await fakeReconnect(scenario.ids[i]);
      await pres.waitForTimeout(1500);
      gs = await getGameState();
      expect(gs.phase).toBe('paused');

      // Riconnette l'ultima: riprende.
      await fakeReconnect(scenario.ids[scenario.ids.length - 1]);
      await waitForPhase(pres, 'bidding', 10000);
      gs = await getGameState();
      expect(gs.pausedReason == null).toBe(true);
    });
  }

  // Cardinalità 9 (tutte le finte + t1, che però è reale — usiamo la chiusura
  // reale della pagina osservatore) e 10 (anche il presidente, caso limite
  // "nessuno può rilevare lo stato": verifichiamo solo che non vada in crash,
  // riusando una nuova pagina per riconnettere).
  test('Matrice cardinalità — 9 squadre disconnesse (tutte le finte + osservatore reale)', async ({ browser }) => {
    const player = P(); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 25);
    await waitForPhase(pres, 'bidding', 10000);

    for (const tid of FAKE_TEAMS) await fakeDisconnect(tid);
    await obs.close(); // t1 disconnessa realmente
    await waitForPhase(pres, 'paused', 10000);
    let gs = await getGameState();
    expect((gs.disconnectedTeamIds || []).length).toBe(9);

    // Riconnette le 8 finte: resta sospesa (manca ancora t1).
    for (const tid of FAKE_TEAMS) await fakeReconnect(tid);
    await pres.waitForTimeout(1500);
    gs = await getGameState();
    expect(gs.phase).toBe('paused');

    // Riconnette t1 con una nuova pagina reale.
    obs = await browser.newPage();
    await loginTeam(obs, 't1');
    await waitForPhase(pres, 'bidding', 10000);
    gs = await getGameState();
    expect(gs.pausedReason == null).toBe(true);
  });

  test('Matrice cardinalità — 10 squadre disconnesse (caso limite totale): stato coerente, nessun crash', async ({ browser }) => {
    const player = P(); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 20);
    await waitForPhase(pres, 'bidding', 10000);

    for (const tid of FAKE_TEAMS) await fakeDisconnect(tid);
    await obs.close();
    // L'unico client rimasto è il presidente stesso: verifichiamo che riesca
    // comunque a rilevare e scrivere lo stato di pausa (nessun gate isPresident
    // su checkDisconnectionPause, quindi anche lui solo può farlo).
    await waitForPhase(pres, 'paused', 10000);
    let gs = await getGameState();
    expect(typeof gs.pausedAt).toBe('number');
    expect(gs.pausedPhase).toBeTruthy();

    // Il presidente stesso si disconnette e riconnette (nuova pagina): il
    // sistema non deve andare in crash anche con zero client attivi nel mezzo.
    await pres.close();
    await new Promise(r => setTimeout(r, 1000));

    pres = await browser.newPage();
    await loginTeam(pres, 't2');
    for (const tid of FAKE_TEAMS) await fakeReconnect(tid);
    obs = await browser.newPage();
    await loginTeam(obs, 't1');
    await waitForPhase(pres, 'bidding', 10000);
    gs = await getGameState();
    expect(gs.pausedReason == null).toBe(true);
    expect(gs.phase).toBe('bidding');
  });
});
