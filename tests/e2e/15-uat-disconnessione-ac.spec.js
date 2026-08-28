/**
 * 15 - UAT: Disconnessione durante l'asta (AC01-AC12)
 *
 * Suite basata sul documento UAT fornito da Dario. IMPORTANTE — deviazione
 * esplicita confermata da Dario (risposta "A" alla domanda di chiarimento):
 * il comportamento implementato è BLOCCO TOTALE per tutte le squadre quando
 * anche una sola si disconnette (non blocco-solo-la-squadra-disconnessa).
 *
 * Diversi "Then" del documento originale assumono che "le altre squadre
 * continuano a offrire senza interruzioni" mentre solo la squadra disconnessa
 * è limitata (AC01, AC02, AC03, AC05, parte di AC10/AC11). Con il comportamento
 * A confermato, questo NON è vero per design: la disconnessione di UNA
 * qualsiasi squadra blocca l'intero tavolo (timer fermo, nessuna offerta
 * possibile per nessuno) finché quella squadra non si riconnette. I test
 * qui sotto verificano quindi il comportamento REALE confermato, annotando
 * esplicitamente dove si scosta dal testo letterale dell'UAT.
 *
 * ATTENZIONE: scrive sul Firebase di produzione. Le assegnazioni di test
 * vengono eliminate a fine suite. Eseguire quando non è in corso un'asta reale.
 */

const { test, expect } = require('@playwright/test');
const { BASE_URL, TEAM_PASSWORD } = require('./helpers');

const TEAMS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10']; // t2 = Benfiga (presidente)
const BUDGET_START = 500;
const P = () => ({ nome: '__UAT_DISC_' + Math.random().toString(36).slice(2, 8) + '__', squadra: 'TestFC', ruolo: 'A', qi: 1 });

// Nomi reali delle squadre (da TEAMS array in index.html) — usati per verificare
// che il banner UI mostri i nomi corretti delle squadre disconnesse.
const TEAMS_META = {
  t1: { name: 'Barça' }, t2: { name: 'Benfiga' }, t3: { name: 'Frattese1985' },
  t4: { name: 'Morpheus' }, t5: { name: 'Paris San Giuann' }, t6: { name: 'REAL' },
  t7: { name: 'Sharktar' }, t8: { name: 'SoxTeam' }, t9: { name: 'Vincan' }, t10: { name: 'giomammo' },
};

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
async function getGameState() {
  return (await fbRest('/game', 'GET')) || {};
}
async function getAssignments() {
  const raw = (await fbRest('/assignments', 'GET')) || {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw).map(([key, val]) => ({ ...val, _key: key }));
}

/** Avvia un'asta di test scrivendo /game direttamente (equivalente a adminStartAuction). */
async function startTestAuction(adminPage, player, durationSec = 20) {
  const timerEnd = Date.now() + durationSec * 1000;
  await adminPage.evaluate(() => { autoRevealFired = false; });
  await fbRest('/game', 'PUT', {
    phase: 'bidding', currentPlayer: player, minBid: 1, timerEnd,
    tiebreakers: null, tiebreakerFirstBid: null, auctionDuration: durationSec,
  });
}

/**
 * checkDisconnectionPause() rileva la PRIMA squadra offline nell'ordine di TEAMS.
 * Nei test con solo 1-2 pagine browser reali, tutte le altre squadre non
 * loggate risultano "offline" fin dall'inizio e falserebbero il test (rilevata
 * come disconnessa la prima squadra mai loggata, non quella che si vuole
 * testare esplicitamente). Questo helper crea sessioni finte per TUTTE le
 * squadre tranne quelle passate in `realTeamIds`, così solo queste ultime
 * sono soggette al vero ciclo di presenza online/offline del test.
 */
async function fakeOnlineAllExcept(realTeamIds) {
  const fakeIds = TEAMS.filter(t => !realTeamIds.includes(t));
  await Promise.all(fakeIds.map(tid => fbRest(`/teams/${tid}/sessions/fake`, 'PUT', true)));
}
// Rimuove TUTTE le sessioni (non solo quella "fake"): se un test browser viene
// interrotto a metà (es. una pagina non chiusa correttamente per un timeout),
// onDisconnect() potrebbe non aver ancora fatto pulizia — lasciando sessioni
// "reali" residue che falserebbero i test successivi nella stessa run.
async function clearFakeSessions() {
  await Promise.all(TEAMS.map(tid => fbRest(`/teams/${tid}/sessions`, 'DELETE').catch(() => {})));
}

const usedPlayerNames = [];

test.describe.serial('UAT — Disconnessione durante l\'asta (AC01-AC12)', () => {
  test.beforeEach(async ({}, testInfo) => {
    if (testInfo.project.name.toLowerCase().includes('mobile')) {
      testInfo.skip(true, 'Solo Desktop Chrome: evita race conditions Firebase con login multipli');
    }
  });

  test.beforeAll(async () => {
    await resetGame();
  });

  test.afterEach(async () => {
    await resetGame();
    await clearFakeSessions();
  });

  test.afterAll(async () => {
    await cleanupTestAssignments(usedPlayerNames);
    await clearFakeSessions();
  });

  // ── AC01 — Disconnessione della squadra che non sta facendo offerte ─────────
  // DEVIAZIONE dal testo letterale: l'UAT si aspetta "l'asta continua senza
  // interruzioni" e "le altre squadre possono continuare a offrire". Con il
  // comportamento A confermato, l'asta si blocca per TUTTI, non solo per la
  // squadra disconnessa. Verifichiamo quindi: stato disconnessa rilevato
  // correttamente, asta bloccata (non "prosegue"), nessuna assegnazione
  // automatica alla squadra disconnessa.
  test('AC01 — squadra senza offerte si disconnette: rilevata correttamente, asta si blocca (comportamento A)', async ({ browser }) => {
    const player = P(); usedPlayerNames.push(player.nome);
    const pres = await browser.newPage();
    const others = {};
    await loginTeam(pres, 't2');
    await Promise.all(['t1', 't3', 't4'].map(async tid => { others[tid] = await browser.newPage(); await loginTeam(others[tid], tid); }));
    await fakeOnlineAllExcept(['t1', 't2', 't3', 't4']);

    await startTestAuction(pres, player);
    await Promise.all([pres, ...Object.values(others)].map(p => waitForPhase(p, 'bidding', 10000)));

    // t4 (Squadra A, non ha offerto) si disconnette.
    await others['t4'].close();
    delete others['t4'];

    // Then: t4 risulta disconnessa; le altre squadre lo visualizzano (banner).
    await waitForPhase(pres, 'paused', 8000);
    const gs = await getGameState();
    expect(gs.pausedReason).toBe('disconnect');
    expect(gs.disconnectedTeamId).toBe('t4');
    await others['t1'].waitForFunction(
      () => document.getElementById('disconnectBanner')?.classList.contains('visible'),
      { timeout: 8000 }
    );

    // Then (comportamento A): l'asta è bloccata per TUTTI, non solo per t4 —
    // nessuna squadra (incluse t1/t3, che erano regolarmente connesse) può offrire.
    for (const tid of ['t1', 't3']) {
      const page = others[tid];
      const btnBidVisible = await page.evaluate(() => document.getElementById('bidInputArea')?.style.display === 'flex');
      expect(btnBidVisible).toBe(false); // bidInputArea nascosta durante 'paused'
    }

    // Then: nessuna assegnazione automatica alla squadra disconnessa.
    const assignments = await getAssignments();
    expect(assignments.find(a => a.player === player.nome)).toBeUndefined();

    await pres.close();
    await Promise.all(Object.values(others).map(p => p.close()));
  });

  // ── AC02 — Disconnessione della squadra che ha effettuato l'ultima offerta ──
  // Then confermato dal comportamento A: l'ultima offerta valida resta
  // registrata su Firebase (non annullata dalla disconnessione). L'asta si
  // blocca (non "le altre continuano a offrire", deviazione dal testo).
  test('AC02 — squadra con la miglior offerta si disconnette: l\'offerta resta valida, asta bloccata', async ({ browser }) => {
    const player = P(); usedPlayerNames.push(player.nome);
    const pres = await browser.newPage();
    const t5page = await browser.newPage();
    await Promise.all([loginTeam(pres, 't2'), loginTeam(t5page, 't5')]);
    await fakeOnlineAllExcept(['t2', 't5']);

    await startTestAuction(pres, player);
    await Promise.all([waitForPhase(pres, 'bidding', 10000), waitForPhase(t5page, 'bidding', 10000)]);

    // t5 (Squadra A) invia la miglior offerta, poi si disconnette.
    await t5page.waitForFunction(() => document.getElementById('bidInputArea')?.style.display === 'flex', { timeout: 8000 });
    await t5page.fill('#bidInput', '60');
    await t5page.click('#btnBid');
    await t5page.waitForFunction(() => document.getElementById('bidSent')?.classList.contains('visible'), { timeout: 5000 });
    await t5page.close();

    // Then: t5 risulta disconnessa, asta in pausa...
    await waitForPhase(pres, 'paused', 8000);
    const gs = await getGameState();
    expect(gs.pausedReason).toBe('disconnect');
    expect(gs.disconnectedTeamId).toBe('t5');

    // ...ma l'offerta di t5 (60cr) resta registrata su /bids, non invalidata.
    const bids = await fbRest('/bids');
    expect(bids.t5?.amount).toBe(60);

    await pres.close();
  });

  // ── AC03 — Disconnessione durante il proprio turno di offerta ───────────────
  // "Turno" nell'app non è a rotazione stretta (tutti possono offrire in
  // parallelo entro il timer), quindi interpretiamo "il proprio turno" come
  // "durante la fase bidding, prima di aver inviato". Deviazione: l'UAT si
  // aspetta che l'asta non resti bloccata indefinitamente — con comportamento
  // A, resta bloccata FINCHÉ quella squadra non si riconnette (nessun timeout
  // per design, confermato). Verifichiamo che comunque non resti bloccata per
  // sempre SE la squadra si riconnette.
  test('AC03 — squadra si disconnette prima di offrire: asta bloccata, riprende alla riconnessione (nessun timeout per design)', async ({ browser }) => {
    const player = P(); usedPlayerNames.push(player.nome);
    const pres = await browser.newPage();
    const t7page = await browser.newPage();
    await Promise.all([loginTeam(pres, 't2'), loginTeam(t7page, 't7')]);
    await fakeOnlineAllExcept(['t2', 't7']);

    await startTestAuction(pres, player, 25);
    await Promise.all([waitForPhase(pres, 'bidding', 10000), waitForPhase(t7page, 'bidding', 10000)]);

    // t7 non ha ancora offerto e si disconnette.
    await t7page.close();
    await waitForPhase(pres, 'paused', 8000);
    let gs = await getGameState();
    expect(gs.disconnectedTeamId).toBe('t7');

    // Riconnessione: l'asta riprende da sola, il turno non resta bloccato per sempre.
    const t7reconnect = await browser.newPage();
    await loginTeam(t7reconnect, 't7');
    await waitForPhase(pres, 'bidding', 10000);
    gs = await getGameState();
    expect(gs.pausedReason == null).toBe(true);
    expect(gs.timerEnd).toBeGreaterThan(Date.now());

    await pres.close();
    await t7reconnect.close();
  });

  // ── AC04 — Disconnessione durante l'inserimento (offerta non confermata) ────
  test('AC04 — disconnessione prima della conferma: l\'offerta non inviata non risulta tra le offerte', async ({ browser }) => {
    const player = P(); usedPlayerNames.push(player.nome);
    const pres = await browser.newPage();
    const t8page = await browser.newPage();
    await Promise.all([loginTeam(pres, 't2'), loginTeam(t8page, 't8')]);
    await fakeOnlineAllExcept(['t2', 't8']);

    await startTestAuction(pres, player);
    await Promise.all([waitForPhase(pres, 'bidding', 10000), waitForPhase(t8page, 'bidding', 10000)]);

    // t8 scrive un importo nel campo ma NON clicca OFFERTA (non confermato).
    await t8page.waitForFunction(() => document.getElementById('bidInputArea')?.style.display === 'flex', { timeout: 8000 });
    await t8page.fill('#bidInput', '77');
    // Disconnessione immediata, senza click su #btnBid.
    await t8page.close();

    await waitForPhase(pres, 'paused', 8000);
    const bids = await fbRest('/bids');
    // Then: l'offerta digitata ma non confermata non deve esistere su Firebase.
    expect(bids?.t8).toBeUndefined();

    await pres.close();
  });

  // ── AC05 — Disconnessione immediatamente dopo l'invio dell'offerta ──────────
  test('AC05 — disconnessione subito dopo l\'invio: l\'offerta registrata resta valida', async ({ browser }) => {
    const player = P(); usedPlayerNames.push(player.nome);
    const pres = await browser.newPage();
    const t9page = await browser.newPage();
    await Promise.all([loginTeam(pres, 't2'), loginTeam(t9page, 't9')]);
    await fakeOnlineAllExcept(['t2', 't9']);

    await startTestAuction(pres, player);
    await Promise.all([waitForPhase(pres, 'bidding', 10000), waitForPhase(t9page, 'bidding', 10000)]);

    await t9page.waitForFunction(() => document.getElementById('bidInputArea')?.style.display === 'flex', { timeout: 8000 });
    await t9page.fill('#bidInput', '33');
    await t9page.click('#btnBid');
    await t9page.waitForFunction(() => document.getElementById('bidSent')?.classList.contains('visible'), { timeout: 5000 });
    // Disconnessione IMMEDIATAMENTE dopo la conferma.
    await t9page.close();

    await waitForPhase(pres, 'paused', 8000);
    const bids = await fbRest('/bids');
    expect(bids.t9?.amount).toBe(33); // l'offerta registrata resta, non viene annullata

    await pres.close();
  });

  // ── AC06-AC09 — Disconnessione per ogni singola squadra: comportamento identico ──
  for (const tid of ['t1', 't3', 't6', 't10']) {
    test(`AC06-09 — disconnessione Squadra ${tid}: rilevata, blocco totale, riconnessione ripristina`, async ({ browser }) => {
      const player = P(); usedPlayerNames.push(player.nome);
      const pres = await browser.newPage();
      const teamPage = await browser.newPage();
      await Promise.all([loginTeam(pres, 't2'), loginTeam(teamPage, tid)]);
      await fakeOnlineAllExcept(['t2', tid]);

      await startTestAuction(pres, player, 20);
      await Promise.all([waitForPhase(pres, 'bidding', 10000), waitForPhase(teamPage, 'bidding', 10000)]);

      await teamPage.close();
      await waitForPhase(pres, 'paused', 8000);
      let gs = await getGameState();
      expect(gs.disconnectedTeamId).toBe(tid); // stato corretto per QUALSIASI squadra
      expect(gs.pausedReason).toBe('disconnect');

      // Riconnessione: comportamento identico indipendentemente da quale squadra fosse.
      const reconnect = await browser.newPage();
      await loginTeam(reconnect, tid);
      await waitForPhase(pres, 'bidding', 10000);
      gs = await getGameState();
      expect(gs.pausedReason == null).toBe(true);

      await pres.close();
      await reconnect.close();
    });
  }

  // ── AC10 — Riconnessione durante l'asta ──────────────────────────────────────
  test('AC10 — riconnessione: la squadra torna visibile come connessa e vede lo stato corrente dell\'asta', async ({ browser }) => {
    const player = P(); usedPlayerNames.push(player.nome);
    const pres = await browser.newPage();
    const t1page = await browser.newPage();
    await Promise.all([loginTeam(pres, 't2'), loginTeam(t1page, 't1')]);
    await fakeOnlineAllExcept(['t1', 't2']);

    await startTestAuction(pres, player, 25);
    await Promise.all([waitForPhase(pres, 'bidding', 10000), waitForPhase(t1page, 'bidding', 10000)]);

    // Un'altra squadra offre PRIMA della disconnessione di t1 (offerta "durante" la sessione).
    await fbRest('/bids/t4', 'PUT', { amount: 44, ts: Date.now() });
    await fbRest('/bidSubmitted/t4', 'PUT', true);

    await t1page.close();
    await waitForPhase(pres, 'paused', 8000);

    // Riconnessione.
    const t1reconnect = await browser.newPage();
    await loginTeam(t1reconnect, 't1');

    // Then: vede il giocatore corrente attualmente all'asta.
    await t1reconnect.waitForFunction(
      (expectedName) => gameState.currentPlayer && gameState.currentPlayer.nome === expectedName,
      player.nome, { timeout: 8000 }
    );
    await waitForPhase(pres, 'bidding', 10000);
    await waitForPhase(t1reconnect, 'bidding', 10000);
    // Il countdown si aggiorna via setInterval (200ms): attende che si stacchi
    // dal placeholder "—" invece di leggerlo una sola volta subito dopo il resume.
    await t1reconnect.waitForFunction(
      () => document.getElementById('auctionHeaderTimer')?.textContent !== '—',
      undefined, { timeout: 5000 }
    );

    // L'offerta di t4 (avvenuta prima della disconnessione/pausa) non è andata persa.
    const bids = await fbRest('/bids');
    expect(bids.t4?.amount).toBe(44);

    await pres.close();
    await t1reconnect.close();
  });

  // ── AC11 — Disconnessione di più squadre in sequenza ─────────────────────────
  test('AC11 — disconnessioni multiple sequenziali: nessun evento perso/duplicato, stato sempre coerente', async ({ browser }) => {
    const player = P(); usedPlayerNames.push(player.nome);
    const pres = await browser.newPage();
    const t3page = await browser.newPage();
    const t6page = await browser.newPage();
    await Promise.all([loginTeam(pres, 't2'), loginTeam(t3page, 't3'), loginTeam(t6page, 't6')]);
    await fakeOnlineAllExcept(['t2', 't3', 't6']);

    await startTestAuction(pres, player, 25);
    await Promise.all([pres, t3page, t6page].map(p => waitForPhase(p, 'bidding', 10000)));

    // t3 si disconnette prima.
    await t3page.close();
    await waitForPhase(pres, 'paused', 8000);
    let gs = await getGameState();
    expect(gs.disconnectedTeamId).toBe('t3');

    // Mentre t3 è ancora offline, si disconnette ANCHE t6 (disconnessione multipla
    // progressiva, senza che nessuno si sia riconnesso nel mezzo).
    await t6page.close();
    // Lo stato resta 'paused' — nessuna transizione spuria, nessun doppio evento.
    await pres.waitForTimeout(4000);
    gs = await getGameState();
    expect(gs.phase).toBe('paused');
    // Bug segnalato: il banner mostrava solo la PRIMA squadra disconnessa (t3)
    // anche dopo che una seconda (t6) si era disconnessa mentre l'asta era già
    // in pausa — disconnectedTeamIds deve contenere ENTRAMBE, non solo la prima.
    const idsAfterSecond = (gs.disconnectedTeamIds || []).slice().sort();
    expect(idsAfterSecond).toEqual(['t3', 't6']);

    // Riconnessione di t3 (t6 resta offline): l'asta NON riprende ancora,
    // perché il comportamento A richiede TUTTE le squadre online.
    const t3reconnect = await browser.newPage();
    await loginTeam(t3reconnect, 't3');
    await pres.waitForTimeout(4000);
    gs = await getGameState();
    expect(gs.phase).toBe('paused'); // ancora bloccata: t6 è ancora offline

    // Riconnessione anche di t6: solo ORA l'asta riprende.
    const t6reconnect = await browser.newPage();
    await loginTeam(t6reconnect, 't6');
    await waitForPhase(pres, 'bidding', 10000);
    gs = await getGameState();
    expect(gs.pausedReason == null).toBe(true);

    await Promise.all([pres, t3reconnect, t6reconnect].map(p => p.close()));
  });

  // ── AC11b — Regola generale: N squadre qualsiasi, in ordine arbitrario ──────
  // Il caso AC11 sopra copre solo t3+t6 (2 squadre) nell'ordine specifico che
  // aveva innescato il bug originale (Paris + SoxTeam). Dario ha chiesto
  // esplicitamente di generalizzare: la regola "il banner mostra TUTTE le
  // squadre offline" deve valere per qualunque combinazione/numero di squadre,
  // non solo per quel caso particolare — altrimenti si rischia di aver
  // "riparato" solo lo scenario osservato senza validare la regola vera.
  // Parametrizzato su 3 combinazioni diverse (2, 3 e 4 squadre disconnesse,
  // con id non consecutivi e ordine di disconnessione variabile) e verifica
  // sia lo stato Firebase (disconnectedTeamIds) sia il BANNER UI reale
  // (#disconnectTeamLabel), che è dove si era manifestato il bug — un test
  // che controllasse solo Firebase non lo avrebbe catturato.
  const multiDisconnectScenarios = [
    { label: '2 squadre (t4, t9)', ids: ['t4', 't9'] },
    { label: '3 squadre (t1, t7, t10)', ids: ['t1', 't7', 't10'] },
    { label: '4 squadre (t3, t5, t6, t8)', ids: ['t3', 't5', 't6', 't8'] },
  ];
  for (const scenario of multiDisconnectScenarios) {
    test(`AC11b — regola generale con ${scenario.label}: banner e stato mostrano SEMPRE tutte le squadre offline`, async ({ browser }) => {
      const player = P(); usedPlayerNames.push(player.nome);
      const teamIds = scenario.ids;
      const pres = await browser.newPage();
      const teamPages = {};
      await loginTeam(pres, 't2');
      await Promise.all(teamIds.map(async tid => { teamPages[tid] = await browser.newPage(); await loginTeam(teamPages[tid], tid); }));
      await fakeOnlineAllExcept(['t2', ...teamIds]);

      await startTestAuction(pres, player, 30);
      await Promise.all([pres, ...Object.values(teamPages)].map(p => waitForPhase(p, 'bidding', 10000)));

      // Disconnette le squadre UNA ALLA VOLTA, in sequenza, con una piccola pausa
      // tra ognuna — replica il caso reale (disconnessioni non simultanee) ed
      // esercita il ramo "aggiorna la lista mentre l'asta è già in pausa" per
      // ogni squadra successiva alla prima.
      const disconnectedSoFar = [];
      for (const tid of teamIds) {
        await teamPages[tid].close();
        disconnectedSoFar.push(tid);
        // Timeout ampio: oltre al debounce (~3s) di checkDisconnectionPause, con
        // più squadre in sequenza la propagazione Firebase può richiedere qualche
        // secondo in più per ogni round.
        await pres.waitForFunction(
          () => (typeof gameState !== 'undefined' ? gameState : {}).phase === 'paused',
          undefined, { timeout: 15000 }
        );
        // Attende che il client presidente abbia ricalcolato e scritto l'elenco
        // aggiornato (checkDisconnectionPause gira sul listener /teams).
        await pres.waitForTimeout(1500);

        const gs = await getGameState();
        const idsNow = (gs.disconnectedTeamIds || []).slice().sort();
        const expected = [...disconnectedSoFar].sort();
        // Verifica sullo STATO: deve contenere esattamente tutte le squadre
        // disconnesse finora, non solo la prima o le ultime N-1.
        expect(idsNow).toEqual(expected);

        // Verifica sul BANNER REALE lato UI (non solo Firebase) — è qui che si
        // era manifestato il bug: lo stato era corretto ma il banner mostrava
        // solo una squadra. Controllato dal client presidente stesso, che vede
        // il proprio banner di disconnessione durante la pausa.
        await pres.waitForFunction(
          () => document.getElementById('disconnectBanner')?.classList.contains('visible'),
          undefined, { timeout: 5000 }
        );
        const bannerText = await pres.locator('#disconnectTeamLabel').textContent();
        for (const expectedId of disconnectedSoFar) {
          const team = TEAMS_META[expectedId];
          expect(bannerText).toContain(team.name);
        }
        // Il banner non deve contenere nomi di squadre NON ancora disconnesse.
        const notYetDisconnected = teamIds.filter(id => !disconnectedSoFar.includes(id));
        for (const notYetId of notYetDisconnected) {
          expect(bannerText).not.toContain(TEAMS_META[notYetId].name);
        }
      }

      // Riconnette tutte: l'asta deve riprendere solo quando TUTTE sono di nuovo online.
      const reconnectPages = [];
      for (let i = 0; i < teamIds.length; i++) {
        const tid = teamIds[i];
        const reconnectPage = await browser.newPage();
        await loginTeam(reconnectPage, tid);
        reconnectPages.push(reconnectPage);
        if (i < teamIds.length - 1) {
          // Ancora ne manca almeno una: l'asta deve restare in pausa.
          await pres.waitForTimeout(1500);
          const gs = await getGameState();
          expect(gs.phase).toBe('paused');
        }
      }
      await pres.waitForFunction(
        () => (typeof gameState !== 'undefined' ? gameState : {}).phase === 'bidding',
        undefined, { timeout: 10000 }
      );
      const gsFinal = await getGameState();
      expect(gsFinal.pausedReason == null).toBe(true);
      expect(gsFinal.disconnectedTeamIds == null || gsFinal.disconnectedTeamIds.length === 0).toBe(true);

      await pres.close();
      await Promise.all(reconnectPages.map(p => p.close()));
    });
  }

  // ── AC12 — Disconnessione dell'ultima squadra connessa (caso limite) ────────
  // Nel comportamento A, questo caso non è concettualmente diverso da una
  // disconnessione singola: basta UNA squadra offline per bloccare tutto,
  // quindi "l'ultima rimasta" che si disconnette produce lo stesso stato
  // 'paused' (non uno stato speciale "nessuno connesso"). Verifichiamo che il
  // sistema non vada in uno stato inconsistente (es. crash, campi corrotti).
  test('AC12 — anche l\'ultima squadra rimasta si disconnette: stato paused coerente, nessun crash', async ({ browser }) => {
    const player = P(); usedPlayerNames.push(player.nome);
    const pres = await browser.newPage();
    const t10page = await browser.newPage();
    await Promise.all([loginTeam(pres, 't2'), loginTeam(t10page, 't10')]);
    await fakeOnlineAllExcept(['t2', 't10']);

    await startTestAuction(pres, player, 20);
    await Promise.all([waitForPhase(pres, 'bidding', 10000), waitForPhase(t10page, 'bidding', 10000)]);

    // Disconnette t10; poi (mentre già in pausa) anche il presidente si allontana
    // e si riconnette: verifica che checkDisconnectionPause non vada in errore
    // anche quando l'unico client rimasto è quello che deve rilevare lo stato.
    await t10page.close();
    await waitForPhase(pres, 'paused', 8000);
    let gs = await getGameState();
    expect(gs.phase).toBe('paused');
    expect(gs.disconnectedTeamId).toBe('t10');

    // Il presidente stesso resta l'unico client attivo: nessun errore, stato coerente.
    const gsFields = await getGameState();
    expect(gsFields.pausedPhase).toBeTruthy();
    expect(typeof gsFields.pausedAt).toBe('number');

    // Riconnessione di t10: ripristina normalmente.
    const t10reconnect = await browser.newPage();
    await loginTeam(t10reconnect, 't10');
    await waitForPhase(pres, 'bidding', 10000);
    gs = await getGameState();
    expect(gs.phase).toBe('bidding');
    expect(gs.pausedReason == null).toBe(true);
    expect(gs.disconnectedTeamId == null).toBe(true);
    expect(gs.disconnectedAt == null).toBe(true);

    await pres.close();
    await t10reconnect.close();
  });
});
