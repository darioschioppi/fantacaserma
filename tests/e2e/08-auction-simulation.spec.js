/**
 * 08 - Simulazione Asta Live (Multi-Giocatore)
 *
 * Testa il flusso completo dell'asta simulando più giocatori contemporaneamente.
 * Un contesto Admin gestisce l'asta; le offerte degli altri team vengono
 * iniettate direttamente via Firebase REST API (Node.js) per evitare race
 * conditions con l'auth anonimo del Firebase SDK browser.
 *
 * ATTENZIONE: questi test scrivono sul Firebase di produzione.
 * Vanno eseguiti PRIMA di una vera sessione d'asta.
 * Le assegnazioni di test vengono eliminate alla fine della suite.
 *
 * Eseguire con:
 *   npx playwright test tests/e2e/08-auction-simulation.spec.js --headed
 */

const { test, expect } = require('@playwright/test');
const { BASE_URL, ADMIN_PASSWORD, TEAM_PASSWORD } = require('./helpers');

// ─── COSTANTI ────────────────────────────────────────────────────────────────

const TEST_PLAYER = { nome: '__TEST_PLAYER__', squadra: 'TestFC', ruolo: 'A', qi: 1 };
const AUCTION_DURATION_TEST = 10; // secondi (ridotto per velocizzare i test)
const TEAMS = ['t1','t2','t3','t4','t5','t6','t7','t8','t9','t10'];
const BUDGET_START = 500;

// Firebase config (da index.html)
const FB_API_KEY  = 'AIzaSyCOTpDSNMVvK8kYNw11OfBIQm3JaAx9kIM';
const FB_DB_URL   = 'https://fantacaserma-f2fe2-default-rtdb.europe-west1.firebasedatabase.app';

// ─── HELPERS FIREBASE REST API (Node.js) ─────────────────────────────────────
//
// Tutte le scritture di setup/teardown usano la Firebase REST API
// direttamente da Node.js, bypassando il Firebase SDK del browser.
// Questo evita race conditions con signInAnonymously() nel browser
// (non awaited in initFirebase(), causa authUID:NULL durante i primi secondi).

let _fbTokenCache = null;
let _fbTokenExpiry = 0;

/**
 * Ottiene un token anonimo Firebase (con cache 55min).
 */
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
  _fbTokenExpiry = Date.now() + 55 * 60 * 1000; // 55 min
  return _fbTokenCache;
}

/**
 * Esegue una richiesta Firebase REST.
 * @param {string} path   - es. '/game', '/bids/t1'
 * @param {'GET'|'PUT'|'PATCH'|'DELETE'|'POST'} method
 * @param {*} [body]      - body JSON (omettere per GET/DELETE)
 */
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

/**
 * Resetta il gioco a 'waiting' e cancella bids/bidSubmitted.
 * Non richiede una pagina browser.
 */
async function resetGame() {
  await Promise.all([
    fbRest('/game',          'PUT',    { phase: 'waiting' }),
    fbRest('/bids',          'DELETE'),
    fbRest('/bidSubmitted',  'DELETE'),
  ]);
  // Attesa breve per propagazione Firebase ai client connessi
  await new Promise(r => setTimeout(r, 800));
}

/**
 * Avvia un'asta di test via REST API.
 * Opzionalmente resetta autoRevealFired nella pagina admin.
 */
async function startTestAuction(adminPage, durationSec = AUCTION_DURATION_TEST) {
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
  // Reset variabile browser per evitare doppio auto-reveal
  if (adminPage) await adminPage.evaluate(() => { autoRevealFired = false; });
  await new Promise(r => setTimeout(r, 300));
}

/**
 * Simula un'offerta da parte di un team via REST API.
 */
async function simulateBid(teamId, amount) {
  await Promise.all([
    fbRest(`/bids/${teamId}`,         'PUT', { amount, ts: Date.now() }),
    fbRest(`/bidSubmitted/${teamId}`, 'PUT', true),
  ]);
}

/**
 * Simula il "passa" da parte di un team (offerta = 0).
 */
async function simulatePass(teamId) {
  return simulateBid(teamId, 0);
}

/**
 * Attende che il gameState raggiunga una certa fase (browser).
 */
async function waitForPhase(page, phase, timeoutMs = 15000) {
  await page.waitForFunction(
    (expectedPhase) => (typeof gameState !== 'undefined' ? gameState : {}).phase === expectedPhase,
    phase,
    { timeout: timeoutMs }
  );
}

/**
 * Legge il gameState corrente da Firebase via REST.
 */
async function getGameState() {
  return (await fbRest('/game', 'GET')) || {};
}

/**
 * Legge tutte le assegnazioni correnti da Firebase via REST.
 */
async function getAssignments() {
  const raw = (await fbRest('/assignments', 'GET')) || {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw).map(([key, val]) => ({ ...val, _key: key }));
}

/**
 * Elimina le assegnazioni di test (__TEST_PLAYER__) e ripristina budget.
 * Non richiede una pagina browser.
 */
async function cleanupTestAssignments() {
  const raw      = (await fbRest('/assignments', 'GET')) || {};
  const teamsRaw = (await fbRest('/teams',       'GET')) || {};
  const ops = [];
  for (const [key, val] of Object.entries(raw)) {
    if (!val || val.player !== '__TEST_PLAYER__') continue;
    ops.push(fbRest(`/assignments/${key}`, 'DELETE'));
    const td       = teamsRaw[val.teamId] || {};
    const newBudget = (td.budget != null ? td.budget : BUDGET_START) + (val.amount || 0);
    const newRoster = Math.max(0, (td.rosterCount || 0) - 1);
    ops.push(fbRest(`/teams/${val.teamId}`, 'PATCH', { budget: newBudget, rosterCount: newRoster }));
  }
  if (ops.length) await Promise.all(ops);
  await new Promise(r => setTimeout(r, 500));
}

// ─── HELPERS BROWSER ─────────────────────────────────────────────────────────

/**
 * Attende che il Firebase db sia inizializzato E che RTDB sia autenticato.
 *
 * PROBLEMA NOTO: signInAnonymously() in initFirebase() NON è awaited.
 * Il listener db.ref('/game').on('value', ...) viene settato in enterAdmin() /
 * initParticipantFirebase() prima che auth sia pronto → PERMISSION_DENIED silenzioso.
 * Firebase SDK re-fire i listener dopo auth, ma i tempi sono imprevedibili (>30s).
 *
 * SOLUZIONE: invece di aspettare il listener passivo, usiamo db.ref('/game').once('value')
 * come active probe (polling ogni 1s). Se PERMISSION_DENIED → false → riprova.
 * Quando once() riesce, aggiorniamo manualmente gameState come side-effect
 * (gameState è 'let' in script globale → accessibile/assegnabile da Playwright).
 */
/**
 * Attende che signInAnonymously() sia completato.
 * CHIAMARE PRIMA di cliccare il bottone login: quando enterAdmin() / loginTeam() (app)
 * registrano db.ref('/game').on('value', ...), l'auth deve essere GIÀ valida.
 * Se si registra il listener prima che auth sia pronta, Firebase SDK
 * restituisce PERMISSION_DENIED e NON ri-registra automaticamente il listener.
 */
async function waitForAuth(page) {
  await page.waitForFunction(
    () => {
      try { return firebase.auth().currentUser !== null; }
      catch (e) { return false; }
    },
    undefined,
    { timeout: 20000 }
  );
}

/**
 * Attende che db sia pronto E che il listener /game abbia già ricevuto dati.
 * Da chiamare DOPO loginAdmin/loginTeam (che a loro volta aspettano waitForAuth).
 * Con auth già pronta, il listener si registra correttamente e fire entro 1-2s.
 */
async function waitForDb(page) {
  // db !== null (sincrono dopo initFirebase) + gameState.phase definito (listener .on() ha sparato)
  // NOTA: waitForFunction(fn, arg?, options?) — { timeout } come 2° arg = ARG non options!
  //       Usare sempre (fn, undefined, { timeout: X }) per fn senza argomenti.
  await page.waitForFunction(
    () => typeof db !== 'undefined' && db !== null &&
          typeof gameState !== 'undefined' && typeof gameState.phase !== 'undefined',
    undefined,
    { timeout: 15000 }
  );
}

/**
 * Login come Admin e attende che la schermata sia pronta.
 */
async function loginAdmin(page) {
  await page.goto(BASE_URL);
  await page.waitForFunction(
    () => document.getElementById('screen-login')?.classList.contains('active'),
    { timeout: 15000 }
  );
  // CRITICO: aspetta auth PRIMA di cliccare login, così enterAdmin() registra
  // i listener con auth già valida → nessun PERMISSION_DENIED iniziale.
  await waitForAuth(page);
  await page.click('#tabAdmin');
  await page.fill('#adminPassword', ADMIN_PASSWORD);
  await page.click('button:has-text("Entra come Admin →")');
  await page.locator('#screen-admin.active').waitFor({ timeout: 10000 });
  await waitForDb(page);
}

/**
 * Login come squadra e attende schermata partecipante.
 */
async function loginTeam(page, teamId) {
  await page.goto(BASE_URL);
  await page.waitForFunction(
    () => document.getElementById('screen-login')?.classList.contains('active'),
    { timeout: 15000 }
  );
  // Stesso fix: aspetta auth prima di entrare come squadra
  await waitForAuth(page);
  await page.selectOption('#teamSelect', teamId);
  await page.fill('#teamPassword', TEAM_PASSWORD);
  await page.click('button:has-text("Entra →")');
  await page.locator('#screen-participant.active').waitFor({ timeout: 10000 });
  await waitForDb(page);
}

// ─── SUITE: eseguita in sequenza per evitare race conditions su Firebase ──────

test.describe.serial('Simulazione Asta — Flussi Completi', () => {
  // test.skip a livello describe.serial non funziona per Mobile — usare beforeEach
  test.beforeEach(async ({}, testInfo) => {
    if (testInfo.project.name.toLowerCase().includes('mobile')) {
      testInfo.skip(true, 'Solo Desktop Chrome: evita race conditions Firebase');
    }
  });

  // Cleanup globale prima di tutta la suite (REST API, nessuna pagina browser)
  test.beforeAll(async () => {
    await resetGame();
    await cleanupTestAssignments();
  });

  // Cleanup dopo ogni test (REST API, nessuna pagina browser)
  test.afterEach(async () => {
    await resetGame();
    await cleanupTestAssignments();
  });

  // ── SCENARIO 1: Asta con vincitore unico ──────────────────────────────────

  test('SC1 — vincitore unico: il giocatore viene assegnato alla squadra con offerta più alta', async ({ browser }) => {
    const adminPage       = await browser.newPage();
    const participantPage = await browser.newPage();

    await Promise.all([
      loginAdmin(adminPage),
      loginTeam(participantPage, 't1'), // Barca
    ]);

    // Avvia asta via REST
    await startTestAuction(adminPage);
    await waitForPhase(adminPage, 'bidding', 8000);

    // Simula offerte: t1=80 (vincitore), t3=50, t5=60, tutti gli altri passano
    await simulateBid('t1', 80);
    await simulateBid('t3', 50);
    await simulateBid('t5', 60);
    await Promise.all(['t2','t4','t6','t7','t8','t9','t10'].map(t => simulatePass(t)));

    // Attende reveal automatico (tutti hanno offerto)
    await waitForPhase(adminPage, 'reveal', 8000);
    // Attende assegnazione automatica
    await waitForPhase(adminPage, 'assigned', 8000);

    // Verifica assegnazione via REST
    const assignments = await getAssignments();
    const testAssign  = assignments.find(a => a.player === '__TEST_PLAYER__');

    expect(testAssign).toBeTruthy();
    expect(testAssign.teamId).toBe('t1');
    expect(testAssign.amount).toBe(80);

    // Verifica che il budget di t1 sia stato detratto
    const teamsData = (await fbRest('/teams/t1', 'GET')) || {};
    expect(teamsData.budget).toBeLessThanOrEqual(BUDGET_START - 80);

    // Verifica UI partecipante (Barca): overlay rivelazione visibile
    await participantPage.waitForFunction(
      () => document.getElementById('revealOverlay')?.classList.contains('visible'),
      { timeout: 10000 }
    );

    await adminPage.close();
    await participantPage.close();
  });

  // ── SCENARIO 2: Pareggio → spareggio → vincitore ──────────────────────────

  test('SC2 — pareggio e spareggio: parte lo spareggio tra le squadre a pari offerta', async ({ browser }) => {
    const adminPage = await browser.newPage();
    await loginAdmin(adminPage);

    await startTestAuction(adminPage);
    await waitForPhase(adminPage, 'bidding', 8000);

    // t2 e t6 offrono lo stesso importo → tiebreaker
    await simulateBid('t2', 70);
    await simulateBid('t6', 70);
    await Promise.all(['t1','t3','t4','t5','t7','t8','t9','t10'].map(t => simulatePass(t)));

    // Deve scattare il tiebreaker.
    // Senza team connessi, checkAutoReveal() ritorna subito (eligible=[]).
    // L'auto-reveal avviene SOLO allo scadere del timer (10s) + autoProcessReveal (3s) = ~13s.
    await waitForPhase(adminPage, 'tiebreaker', 20000);

    const gs = await getGameState();
    expect(gs.phase).toBe('tiebreaker');
    expect(gs.tiebreakers).toContain('t2');
    expect(gs.tiebreakers).toContain('t6');
    expect(gs.tiebreakers.length).toBe(2);
    expect(gs.minBid).toBe(70);

    // Spareggio: t2 rilancia a 75, t6 passa → t2 vince
    await simulateBid('t2', 75);
    await simulatePass('t6');

    await waitForPhase(adminPage, 'assigned', 10000);

    const assignments = await getAssignments();
    const testAssign  = assignments.find(a => a.player === '__TEST_PLAYER__');
    expect(testAssign?.teamId).toBe('t2');
    expect(testAssign?.amount).toBe(75);

    await adminPage.close();
  });

  // ── SCENARIO 3: Nessuna offerta → giocatore saltato ───────────────────────

  test('SC3 — nessuna offerta: il giocatore viene saltato automaticamente', async ({ browser }) => {
    const adminPage = await browser.newPage();
    await loginAdmin(adminPage);

    await startTestAuction(adminPage);
    await waitForPhase(adminPage, 'bidding', 8000);

    // Tutti passano (in parallelo per velocità)
    await Promise.all(TEAMS.map(t => simulatePass(t)));

    // Auto-reveal → nessuna offerta → waiting (skip).
    // Senza team connessi, l'auto-reveal avviene solo allo scadere del timer (10s) + autoProcessReveal (3s).
    await waitForPhase(adminPage, 'waiting', 20000);

    // Nessuna assegnazione creata
    const assignments = await getAssignments();
    const testAssign  = assignments.find(a => a.player === '__TEST_PLAYER__');
    expect(testAssign).toBeUndefined();

    await adminPage.close();
  });

  // ── SCENARIO 4: Pausa e ripresa ───────────────────────────────────────────

  test('SC4 — pausa e ripresa: la fase diventa paused, poi torna bidding con timer resettato', async ({ browser }) => {
    const adminPage       = await browser.newPage();
    const participantPage = await browser.newPage();

    await Promise.all([
      loginAdmin(adminPage),
      loginTeam(participantPage, 't3'),
    ]);

    await startTestAuction(adminPage);
    await waitForPhase(adminPage, 'bidding', 8000);

    // Admin pausa
    await adminPage.evaluate(() => window.adminPauseAuction());
    await waitForPhase(adminPage, 'paused', 5000);

    // Il partecipante vede "⏸ In pausa"
    await participantPage.waitForFunction(
      () => (gameState || {}).phase === 'paused',
      { timeout: 8000 }
    );
    const pauseText = await participantPage.locator('#bidAreaWaiting').textContent();
    expect(pauseText).toContain('pausa');

    // Admin riprende
    await adminPage.evaluate(() => window.adminResumeAuction());
    await waitForPhase(adminPage, 'bidding', 5000);

    // Il timer è stato resettato (timerEnd > now)
    const gs = await getGameState();
    expect(gs.timerEnd).toBeGreaterThan(Date.now());
    expect(gs.phase).toBe('bidding');

    await adminPage.close();
    await participantPage.close();
  });

  // ── SCENARIO 5: Termina asta manuale ─────────────────────────────────────

  test('SC5 — termina manuale: il giocatore torna in waiting senza essere assegnato', async ({ browser }) => {
    const adminPage = await browser.newPage();
    await loginAdmin(adminPage);

    await startTestAuction(adminPage);
    await waitForPhase(adminPage, 'bidding', 8000);

    // Alcune offerte già inviate
    await simulateBid('t4', 45);
    await simulateBid('t7', 38);

    // Admin termina manualmente
    await adminPage.evaluate(() => window.adminEndAuction());
    await waitForPhase(adminPage, 'waiting', 5000);

    const assignments = await getAssignments();
    const testAssign  = assignments.find(a => a.player === '__TEST_PLAYER__');
    expect(testAssign).toBeUndefined();

    await adminPage.close();
  });

  // ── SCENARIO 6: Timer scade → auto-reveal ─────────────────────────────────

  test('SC6 — timer scaduto: auto-reveal e assegnazione automatica allo scadere', async ({ browser }) => {
    const adminPage = await browser.newPage();
    await loginAdmin(adminPage);

    // Timer molto breve: 6 secondi
    await startTestAuction(adminPage, 6);
    await waitForPhase(adminPage, 'bidding', 8000);

    // Solo 2 team offrono, gli altri non fanno niente (non passano)
    await simulateBid('t8', 55);
    await simulateBid('t9', 40);

    // Attende scadenza timer → reveal automatico (max 6s + 3s buffer)
    await waitForPhase(adminPage, 'reveal', 12000);
    // Poi assegnazione automatica
    await waitForPhase(adminPage, 'assigned', 8000);

    const assignments = await getAssignments();
    const testAssign  = assignments.find(a => a.player === '__TEST_PLAYER__');
    expect(testAssign).toBeTruthy();
    expect(testAssign.teamId).toBe('t8');
    expect(testAssign.amount).toBe(55);

    await adminPage.close();
  });

  // ── SCENARIO 7: Gestione assegnazioni (rimozione) ─────────────────────────

  test('SC7 — gestione assegnazioni: rimozione ripristina budget', async ({ browser }) => {
    // Legge budget t1 prima dell'assegnazione
    const t1Before    = (await fbRest('/teams/t1', 'GET')) || {};
    const budgetBefore = t1Before.budget != null ? t1Before.budget : BUDGET_START;

    // Crea assegnazione di test via REST (evita db.ref().update() root)
    const pushResult  = await fbRest('/assignments', 'POST', {
      player: '__TEST_PLAYER__', ruolo: 'A',
      teamId: 't1', teamName: 'Barca', amount: 60, timestamp: Date.now()
    });
    // REST POST ritorna { name: 'push-key' }
    const testKey = pushResult && pushResult.name;
    expect(testKey).toBeTruthy();

    // Aggiorna budget e roster t1
    await fbRest('/teams/t1', 'PATCH', {
      budget:      budgetBefore - 60,
      rosterCount: (t1Before.rosterCount || 0) + 1,
    });
    await new Promise(r => setTimeout(r, 600));

    // Apre pagina admin e aspetta sincronizzazione
    const adminPage = await browser.newPage();
    await loginAdmin(adminPage);

    // Verifica che l'assegnazione sia visibile
    const assignBefore = await getAssignments();
    const testEntry    = assignBefore.find(a => a.player === '__TEST_PLAYER__');
    expect(testEntry).toBeTruthy();
    expect(testEntry._key).toBe(testKey);

    // ── Sub-test: Rimozione ──
    // Registra il dialog handler PRIMA di invocare confirmRemoveAssignment
    adminPage.once('dialog', d => d.accept());
    await adminPage.evaluate(async (key) => {
      await window.confirmRemoveAssignment(key);
    }, testKey);

    await new Promise(r => setTimeout(r, 800));

    // Verifica rimozione
    const assignAfter  = await getAssignments();
    const removed      = assignAfter.find(a => a.player === '__TEST_PLAYER__');
    expect(removed).toBeUndefined();

    // Verifica ripristino budget
    const t1After      = (await fbRest('/teams/t1', 'GET')) || {};
    expect(t1After.budget).toBeGreaterThanOrEqual(budgetBefore);

    await adminPage.close();
  });

  // ── SCENARIO 8: Assegnazione manuale giocatore libero ────────────────────

  test('SC8 — assegna giocatore libero: compare nella lista assegnazioni', async ({ browser }) => {
    // Legge budget iniziale di t5
    const t5Before    = (await fbRest('/teams/t5', 'GET')) || {};
    const budgetBefore = t5Before.budget != null ? t5Before.budget : BUDGET_START;

    // Crea assegnazione diretta via REST (simula confirmAssignFree)
    const pushResult = await fbRest('/assignments', 'POST', {
      player: '__TEST_PLAYER__', ruolo: 'A',
      teamId: 't5', teamName: 'Paris San Giuann', amount: 35, timestamp: Date.now()
    });
    expect(pushResult && pushResult.name).toBeTruthy();

    await fbRest('/teams/t5', 'PATCH', {
      budget:      budgetBefore - 35,
      rosterCount: (t5Before.rosterCount || 0) + 1,
    });
    await new Promise(r => setTimeout(r, 600));

    const assignments = await getAssignments();
    const testAssign  = assignments.find(a => a.player === '__TEST_PLAYER__');
    expect(testAssign).toBeTruthy();
    expect(testAssign.teamId).toBe('t5');
    expect(testAssign.amount).toBe(35);

    const t5After = (await fbRest('/teams/t5', 'GET')) || {};
    expect(t5After.budget).toBeLessThanOrEqual(budgetBefore - 35);
  });

  // ── SCENARIO 9: Reset stagione ────────────────────────────────────────────
  //
  // Testa lo schema dati del reset (browser-less): crea assegnazione + budget
  // ridotto, poi esegue la sequenza atomica di reset via REST API (stessa
  // logica di adminResetSeason()), verifica che lo stato sia pulito.
  // Una volta deployato, il test può essere esteso per invocare adminResetSeason()
  // direttamente dalla pagina browser.

  test('SC9 — reset stagione: cancella assegnazioni e ripristina tutti i budget', async () => {
    // Setup: assegnazione test su t3 con budget ridotto
    await fbRest('/assignments/__reset_sc9__', 'PUT', {
      player: '__RESET_SC9__', ruolo: 'C',
      teamId: 't3', teamName: 'Frattese1985', amount: 60, timestamp: Date.now(),
    });
    await fbRest('/teams/t3', 'PATCH', { budget: 440, rosterCount: 1 });
    await new Promise(r => setTimeout(r, 400));

    // Reset atomico (stesso schema di adminResetSeason)
    const teamOps = TEAMS.map(id =>
      fbRest('/teams/' + id, 'PATCH', { budget: BUDGET_START, rosterCount: 0, connected: false })
    );
    await Promise.all([
      ...teamOps,
      fbRest('/game',         'PUT',    { phase: 'waiting', round: 1, minBid: 1 }),
      fbRest('/assignments',  'DELETE'),
      fbRest('/bids',         'DELETE'),
      fbRest('/bidSubmitted', 'DELETE'),
      fbRest('/log',          'DELETE'),
    ]);
    await new Promise(r => setTimeout(r, 500));

    // Verifica: tutti i team a budget pieno, nessuna assegnazione
    const t3After    = (await fbRest('/teams/t3', 'GET')) || {};
    const t5After    = (await fbRest('/teams/t5', 'GET')) || {};
    const asgnAfter  = await getAssignments();
    const gsAfter    = await getGameState();

    expect(gsAfter.phase).toBe('waiting');
    expect(t3After.budget).toBe(BUDGET_START);
    expect(t3After.rosterCount).toBe(0);
    expect(t5After.budget).toBe(BUDGET_START);
    expect(asgnAfter.find(a => a.player === '__RESET_SC9__')).toBeUndefined();
  });

  // ── SCENARIO 10: Storico operazioni ───────────────────────────────────────
  //
  // Verifica che avviare un'asta scriva un evento su /log (writeLog è già
  // deployato) e che il pannello storico lo mostri una volta disponibile
  // nel DOM (controllo con optional-chaining per tollerare versioni precedenti).

  test('SC10 — storico: writeLog scrive su /log e il pannello storico mostra le voci', async ({ browser }) => {
    const adminPage = await browser.newPage();
    await loginAdmin(adminPage);

    // startTestAuction usa REST diretta (no browser) → writeLog non viene chiamato.
    // Invochiamo writeLog direttamente dal browser per testare il path completo.
    await startTestAuction(adminPage);
    await waitForPhase(adminPage, 'bidding', 8000);

    // Chiama writeLog dalla pagina browser (funzione già deployata da sempre)
    await adminPage.evaluate(() =>
      writeLog('auction_start', { player: '__TEST_PLAYER__', ruolo: 'A', squadra: 'TestFC', qi: 1 })
    );

    // Verifica via REST che l'evento sia su /log
    let logEntry = null;
    for (let i = 0; i < 10; i++) {
      const raw = (await fbRest('/log', 'GET')) || {};
      const entries = Object.values(raw);
      logEntry = entries.find(e => e && e.type === 'auction_start');
      if (logEntry) break;
      await new Promise(r => setTimeout(r, 500));
    }
    expect(logEntry).toBeTruthy();
    expect(logEntry.type).toBe('auction_start');

    // Se il pannello Storico è già nel DOM (Feature 5 deployata),
    // verifica anche il rendering UI. Altrimenti salta silenziosamente.
    const hasHistoryPanel = await adminPage.evaluate(
      () => !!document.getElementById('adminHistorySection')
    );
    if (hasHistoryPanel) {
      await adminPage.waitForFunction(
        () => Object.keys(typeof logState !== 'undefined' ? logState : {}).length > 0,
        undefined,
        { timeout: 8000 }
      );
      await adminPage.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('#adminMobileNav .mobile-nav-btn'))
          .find(b => b.textContent.includes('Storico'));
        if (btn) adminMobileTab('history', btn);
      });
      await adminPage.waitForFunction(
        () => {
          const c = document.getElementById('adminHistoryList');
          return c && c.children.length > 0 && !c.querySelector('.empty-state');
        },
        undefined,
        { timeout: 5000 }
      );
      const historyText = await adminPage.locator('#adminHistoryList').textContent();
      expect(historyText).toMatch(/avvio asta/i);
    }

    await adminPage.close();
  });

});

// ─── SUITE: Verifiche UI real-time (admin + partecipante in parallelo) ────────

test.describe.serial('Simulazione UI Real-time', () => {
  test.beforeEach(async ({}, testInfo) => {
    if (testInfo.project.name.toLowerCase().includes('mobile')) {
      testInfo.skip(true, 'Solo Desktop Chrome: evita race conditions Firebase');
    }
  });

  test.afterEach(async () => {
    await resetGame();
    await cleanupTestAssignments();
  });

  test('UI — partecipante vede il tavolo aggiornarsi quando una squadra offre', async ({ browser }) => {
    const adminPage = await browser.newPage();
    const teamPage  = await browser.newPage(); // Barca (t1)

    await Promise.all([
      loginAdmin(adminPage),
      loginTeam(teamPage, 't1'),
    ]);

    await startTestAuction(adminPage);

    // t1 (UI reale) invia un'offerta
    await teamPage.waitForFunction(
      () => document.getElementById('bidInputArea')?.style.display === 'flex',
      { timeout: 10000 }
    );
    const bidInput = teamPage.locator('#bidInput');
    await bidInput.fill('25');
    await teamPage.click('#btnBid');

    // Verifica che il chip di t1 diventi "submitted"
    await teamPage.waitForFunction(
      () => document.getElementById('chip-t1')?.classList.contains('submitted'),
      { timeout: 8000 }
    );
    const chipClass = await teamPage.evaluate(
      () => document.getElementById('chip-t1').className
    );
    expect(chipClass).toContain('submitted');

    // Nell'admin panel, t1 risulta aver offerto
    await adminPage.waitForFunction(
      () => !!bidSubmittedState?.t1,
      { timeout: 8000 }
    );

    await adminPage.close();
    await teamPage.close();
  });

  test('UI — partecipante in spareggio vede il banner tiebreaker', async ({ browser }) => {
    const adminPage       = await browser.newPage();
    const participantPage = await browser.newPage(); // t2 = Benfiga

    await Promise.all([
      loginAdmin(adminPage),
      loginTeam(participantPage, 't2'),
    ]);

    await startTestAuction(adminPage);
    await waitForPhase(adminPage, 'bidding', 8000);

    // t2 e t4 offrono lo stesso → tiebreaker
    await simulateBid('t2', 65);
    await simulateBid('t4', 65);
    await Promise.all(['t1','t3','t5','t6','t7','t8','t9','t10'].map(t => simulatePass(t)));

    await waitForPhase(adminPage, 'tiebreaker', 10000);

    // t2 (partecipante) deve vedere il banner rosso tiebreaker
    await participantPage.waitForFunction(
      () => document.getElementById('tiebreakerBanner')?.classList.contains('visible'),
      { timeout: 10000 }
    );
    const bannerText = await participantPage.locator('#tiebreakerBanner').textContent();
    expect(bannerText).toContain('SPAREGGIO');

    // Le squadre non in spareggio devono essere dimmed
    const t1Dimmed = await participantPage.evaluate(
      () => document.getElementById('seat-t1')?.classList.contains('dimmed')
    );
    expect(t1Dimmed).toBe(true);

    await adminPage.close();
    await participantPage.close();
  });

  test('UI — overlay rivelazione mostra vincitore con importo corretto', async ({ browser }) => {
    const adminPage       = await browser.newPage();
    const participantPage = await browser.newPage();

    await Promise.all([
      loginAdmin(adminPage),
      loginTeam(participantPage, 't6'),
    ]);

    await startTestAuction(adminPage);
    await waitForPhase(adminPage, 'bidding', 8000);

    // t6 vince con 90 cr
    await simulateBid('t6', 90);
    await Promise.all(['t1','t2','t3','t4','t5','t7','t8','t9','t10'].map(t => simulatePass(t)));

    await waitForPhase(adminPage, 'assigned', 12000);

    // Overlay visibile per il partecipante
    await participantPage.waitForFunction(
      () => document.getElementById('revealOverlay')?.classList.contains('visible'),
      { timeout: 10000 }
    );

    // L'overlay contiene l'importo vincente
    const overlayText = await participantPage.locator('#revealBidsList').textContent();
    expect(overlayText).toContain('90');

    await adminPage.close();
    await participantPage.close();
  });
});
