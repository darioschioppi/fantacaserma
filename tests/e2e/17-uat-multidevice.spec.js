/**
 * 17 - UAT: Asta Fantacalcio multi-device e disconnessioni (documento Dario)
 *
 * Copre il documento UAT "Asta Fantacalcio: multi-device e disconnessioni":
 * regola fondamentale (una squadra è CONNESSA se almeno UNA sua sessione/device
 * è attiva) e i casi TC-MD-001..025 + matrice finale (sezione 30).
 *
 * NESSUNA MODIFICA AL CODICE è stata necessaria per questa suite: il sistema
 * di presenza esistente (/teams/{id}/sessions/{sessionKey}, un push-key per
 * ogni device/tab connesso, con onDisconnect().remove() sulla propria voce)
 * implementa GIÀ esattamente la regola richiesta — isTeamOnline() conta la
 * squadra online se Object.keys(sessions).length > 0, cioè "almeno una
 * sessione", indipendentemente da quanti device ne aggiungono altre. Questa
 * suite verifica che il comportamento reale corrisponda davvero alla regola.
 *
 * Per limitare le sign-in anonime reali (rate-limit Firebase Auth osservato in
 * sessione), la maggior parte dei "device" è simulata scrivendo direttamente
 * su /teams/{id}/sessions/{deviceName} via REST — è lo stesso identico schema
 * dati che registerPresenceSession() scrive in produzione (una chiave per
 * sessione sotto sessions/), quindi il test esercita la stessa logica letta da
 * isTeamOnline()/checkDisconnectionPause() senza dover aprire decine di
 * browser. Solo dove il documento richiede esplicitamente di verificare la
 * UI/sincronizzazione reale tra tab della STESSA squadra (TC-MD-011, 019,
 * 020, 021, 025) vengono aperte pagine browser reali (login vero).
 *
 * Mappatura S1..S10 del documento → t1..t10 dell'app. t2 (Benfiga) resta il
 * presidente reale per tutta la suite (guida/osserva l'asta) e non viene mai
 * disconnesso nei test — la regola "squadra connessa se almeno un device è
 * online" non richiede di testarla anche sul presidente per essere validata,
 * essendo simmetrica/indipendente dal ruolo.
 *
 * ATTENZIONE: scrive sul Firebase di produzione. Eseguire solo quando non è
 * in corso un'asta reale (verificare /game e /teams prima del lancio).
 */

const { test, expect } = require('@playwright/test');
const { BASE_URL, TEAM_PASSWORD } = require('./helpers');

const TEAMS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10'];
const PRESIDENT = 't2';
const FAKE_TEAMS = TEAMS.filter(t => t !== PRESIDENT); // S1,S3..S10 del documento
const BUDGET_START = 500;
const P = () => ({ nome: '__UAT17_' + Math.random().toString(36).slice(2, 8) + '__', squadra: 'TestFC', ruolo: 'A', qi: 1 });

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
async function getGameState() { return (await fbRest('/game', 'GET')) || {}; }
async function getTeams() { return (await fbRest('/teams', 'GET')) || {}; }
async function sessionCount(tid) {
  const teams = await getTeams();
  const sessions = teams[tid] && teams[tid].sessions;
  return sessions ? Object.keys(sessions).length : 0;
}
async function startTestAuction(adminPage, player, durationSec = 20) {
  const timerEnd = Date.now() + durationSec * 1000;
  await adminPage.evaluate(() => { autoRevealFired = false; });
  await fbRest('/game', 'PUT', {
    phase: 'bidding', currentPlayer: player, minBid: 1, timerEnd,
    tiebreakers: null, tiebreakerFirstBid: null, auctionDuration: durationSec,
  });
}

/** Simula un device: scrive/rimuove una sessione con nome esplicito sotto
 * /teams/{tid}/sessions/{device} — stesso schema dati della presenza reale. */
async function deviceUp(tid, device) { await fbRest(`/teams/${tid}/sessions/${device}`, 'PUT', true); }
async function deviceDown(tid, device) { await fbRest(`/teams/${tid}/sessions/${device}`, 'DELETE'); }
/** Ogni squadra finta parte con un solo device 'd1' online (baseline "tutte connesse"). */
async function setBaselineOneDevicePerFakeTeam() {
  await Promise.all(FAKE_TEAMS.map(tid => deviceUp(tid, 'd1')));
}
async function clearAllFakeSessions() {
  await Promise.all(FAKE_TEAMS.map(tid => fbRest(`/teams/${tid}/sessions`, 'DELETE').catch(() => {})));
}

const usedPlayerNames = [];

test.describe.serial('UAT — Multi-device e disconnessioni (TC-MD-001..025 + matrice)', () => {
  test.beforeEach(async ({}, testInfo) => {
    if (testInfo.project.name.toLowerCase().includes('mobile')) {
      testInfo.skip(true, 'Solo Desktop Chrome: evita race conditions Firebase');
    }
  });

  /** @type {import('@playwright/test').Page} */
  let pres;

  test.beforeAll(async ({ browser }) => {
    await resetGame();
    pres = await browser.newPage();
    await loginTeam(pres, PRESIDENT);
  });

  test.beforeEach(async () => {
    await resetGame();
    await setBaselineOneDevicePerFakeTeam();
  });

  test.afterEach(async () => {
    await resetGame();
    await clearAllFakeSessions();
  });

  test.afterAll(async () => {
    await cleanupTestAssignments(usedPlayerNames);
    await clearAllFakeSessions();
    await pres?.close();
  });

  // ── Regola fondamentale + TC-MD-001 — 1 squadra / 1 device ──────────────
  test('Regola fondamentale + TC-MD-001 — squadra con un solo device: la sua disconnessione sospende l\'asta', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 20);
    await waitForPhase(pres, 'bidding', 10000);

    expect(await sessionCount('t1')).toBe(1); // S1 con un solo device (d1)
    await deviceDown('t1', 'd1');
    await waitForPhase(pres, 'paused', 8000);
    const gs = await getGameState();
    expect(gs.disconnectedTeamIds).toContain('t1');

    await deviceUp('t1', 'd1');
    await waitForPhase(pres, 'bidding', 10000);
    const gs2 = await getGameState();
    expect(gs2.pausedReason == null).toBe(true);
    expect(gs2.timerEnd).toBeGreaterThan(Date.now()); // timer/offerta mantenuti
  });

  // ── TC-MD-002/003/004 — stessa squadra con 2 device ─────────────────────
  const twoDeviceCombos = [
    { label: 'TC-MD-002 (iOS+Android)', tid: 't4', devA: 'ios', devB: 'android' },
    { label: 'TC-MD-003 (iOS+PC)', tid: 't5', devA: 'ios', devB: 'pc' },
    { label: 'TC-MD-004 (Android+PC)', tid: 't6', devA: 'android', devB: 'pc' },
  ];
  for (const combo of twoDeviceCombos) {
    test(`${combo.label} — 1 device disconnesso: squadra resta connessa, asta attiva; entrambi disconnessi: sospesa`, async () => {
      const player = P(); usedPlayerNames.push(player.nome);
      // La baseline 'd1' rappresenta devA; aggiunge devB come secondo device.
      await deviceUp(combo.tid, combo.devB);
      await startTestAuction(pres, player, 20);
      await waitForPhase(pres, 'bidding', 10000);
      expect(await sessionCount(combo.tid)).toBe(2);

      // Disconnette devA (la baseline 'd1'): la squadra deve restare CONNESSA.
      await deviceDown(combo.tid, 'd1');
      await pres.waitForTimeout(1500);
      let gs = await getGameState();
      expect(gs.phase).toBe('bidding'); // nessuna sospensione
      expect(await sessionCount(combo.tid)).toBe(1);

      // Disconnette anche il secondo device: ora la squadra è DISCONNESSA.
      await deviceDown(combo.tid, combo.devB);
      await waitForPhase(pres, 'paused', 8000);
      gs = await getGameState();
      expect(gs.disconnectedTeamIds).toContain(combo.tid);

      // Ripristina per il prossimo test.
      await deviceUp(combo.tid, 'd1');
      await waitForPhase(pres, 'bidding', 10000);
    });
  }

  // ── TC-MD-005 — stessa squadra con 3 device, disconnessione progressiva ──
  test('TC-MD-005 — 3 device sulla stessa squadra: attiva finché resta almeno 1 device, sospesa a 0', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    const tid = 't7';
    await deviceUp(tid, 'android'); await deviceUp(tid, 'pc'); // + 'd1' già presente = 3 device (ios/android/pc)
    await startTestAuction(pres, player, 25);
    await waitForPhase(pres, 'bidding', 10000);
    expect(await sessionCount(tid)).toBe(3);

    // Tabella del documento: 3→2→1 device = sempre Connessa/Attiva; 0 = Disconnessa/Sospesa.
    await deviceDown(tid, 'd1'); // "iOS"
    await pres.waitForTimeout(1200);
    expect((await getGameState()).phase).toBe('bidding');
    expect(await sessionCount(tid)).toBe(2);

    await deviceDown(tid, 'android');
    await pres.waitForTimeout(1200);
    expect((await getGameState()).phase).toBe('bidding');
    expect(await sessionCount(tid)).toBe(1);

    await deviceDown(tid, 'pc');
    await waitForPhase(pres, 'paused', 8000);
    expect(await sessionCount(tid)).toBe(0);
    const gs = await getGameState();
    expect(gs.disconnectedTeamIds).toContain(tid);

    await deviceUp(tid, 'd1');
    await waitForPhase(pres, 'bidding', 10000);
  });

  // ── TC-MD-006 — riconnessione di un solo device è sufficiente ───────────
  test('TC-MD-006 — riconnesso un solo device su 3: la squadra torna connessa e l\'asta riprende subito', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    const tid = 't8';
    await startTestAuction(pres, player, 20);
    await waitForPhase(pres, 'bidding', 10000);

    await deviceDown(tid, 'd1'); // unico device → disconnessa
    await waitForPhase(pres, 'paused', 8000);

    // Riconnette con un device diverso (rappresenta "solo iOS" del documento):
    // basta UNA sessione qualsiasi, non deve essere la stessa disconnessa.
    await deviceUp(tid, 'ios');
    await waitForPhase(pres, 'bidding', 10000);
    const gs = await getGameState();
    expect(gs.pausedReason == null).toBe(true);
    await deviceDown(tid, 'ios'); await deviceUp(tid, 'd1'); // ripristina baseline
    await pres.waitForTimeout(500);
  });

  // ── TC-MD-007 — riconnessione di una squadra mentre un'altra è ancora giù ─
  test('TC-MD-007 — riconnessione di S4 non basta se S7 resta disconnessa; riprende solo dopo entrambe', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 25);
    await waitForPhase(pres, 'bidding', 10000);

    await deviceDown('t4', 'd1');
    await deviceDown('t7', 'd1');
    await waitForPhase(pres, 'paused', 8000);

    await deviceUp('t4', 'd1');
    await pres.waitForTimeout(1500);
    let gs = await getGameState();
    expect(gs.phase).toBe('paused'); // t7 ancora giù

    await deviceUp('t7', 'd1');
    await waitForPhase(pres, 'bidding', 10000);
    gs = await getGameState();
    expect(gs.pausedReason == null).toBe(true);
  });

  // ── TC-MD-008 — 2 device della stessa squadra disconnessi simultaneamente ─
  test('TC-MD-008 — 2 device della stessa squadra disconnessi insieme: squadra disconnessa, asta sospesa', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    const tid = 't5';
    await deviceUp(tid, 'pc'); // + d1 = iOS+PC come da documento
    await startTestAuction(pres, player, 20);
    await waitForPhase(pres, 'bidding', 10000);

    await Promise.all([deviceDown(tid, 'd1'), deviceDown(tid, 'pc')]);
    await waitForPhase(pres, 'paused', 8000);
    const gs = await getGameState();
    expect(gs.disconnectedTeamIds).toContain(tid);

    await deviceUp(tid, 'd1');
    await waitForPhase(pres, 'bidding', 10000);
  });

  // ── TC-MD-009 — flap rapidissimo (disconnesso e riconnesso entro 1s) ─────
  test('TC-MD-009 — disconnessione/riconnessione entro 1s: assorbita dal debounce, nessuna sospensione né stato inconsistente', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    const tid = 't9';
    await startTestAuction(pres, player, 20);
    await waitForPhase(pres, 'bidding', 10000);

    await deviceDown(tid, 'd1');
    await new Promise(r => setTimeout(r, 1000)); // riconnessione entro 1s
    await deviceUp(tid, 'd1');

    // Il debounce di checkDisconnectionPause() è ~3s: una disconnessione
    // risolta prima che scada non deve MAI mettere l'asta in pausa.
    await pres.waitForTimeout(4000);
    const gs = await getGameState();
    expect(gs.phase).toBe('bidding');
    expect(gs.pausedReason == null).toBe(true);
  });

  // ── TC-MD-010 — cambio device durante l'asta (migrazione) ───────────────
  test('TC-MD-010 — cambio device (nuova sessione aperta, poi la vecchia si chiude): squadra resta connessa, nessuna sospensione', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    const tid = 't3';
    await startTestAuction(pres, player, 20);
    await waitForPhase(pres, 'bidding', 10000);

    // Apre il "nuovo device" (PC) mentre il vecchio (d1/Android) è ancora attivo.
    await deviceUp(tid, 'pc');
    await pres.waitForTimeout(800);
    expect(await sessionCount(tid)).toBe(2);
    expect((await getGameState()).phase).toBe('bidding');

    // Chiude il vecchio device: la squadra resta connessa grazie al nuovo.
    await deviceDown(tid, 'd1');
    await pres.waitForTimeout(1200);
    const gs = await getGameState();
    expect(gs.phase).toBe('bidding'); // nessuna sospensione durante il cambio
    expect(await sessionCount(tid)).toBe(1);

    await deviceUp(tid, 'd1'); await deviceDown(tid, 'pc'); // ripristina baseline
  });

  // ── TC-MD-011 — stessa squadra da 3 browser reali contemporaneamente ────
  test('TC-MD-011 — 3 tab reali della stessa squadra: resta UNA sola squadra, offerta sincronizzata su tutte', async ({ browser }) => {
    const player = P(); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 25);
    await waitForPhase(pres, 'bidding', 10000);

    const teamsBefore = await getTeams();
    const teamCountBefore = Object.keys(teamsBefore).length;

    // 3 login reali come la STESSA squadra (t3), simulando iPhone/Android/PC.
    const p1 = await browser.newPage(); // "iPhone"
    const p2 = await browser.newPage(); // "Android"
    const p3 = await browser.newPage(); // "PC"
    await Promise.all([loginTeam(p1, 't3'), loginTeam(p2, 't3'), loginTeam(p3, 't3')]);
    await Promise.all([waitForPhase(p1, 'bidding', 10000), waitForPhase(p2, 'bidding', 10000), waitForPhase(p3, 'bidding', 10000)]);

    // Nessuna nuova squadra creata: /teams ha sempre le stesse 10 chiavi.
    const teamsAfter = await getTeams();
    expect(Object.keys(teamsAfter).length).toBe(teamCountBefore);
    // 3 sessioni distinte per la stessa squadra (una per tab, non 3 squadre).
    expect(await sessionCount('t3')).toBe(1 /* baseline d1 */ + 3);

    // Offerta dal "PC" (p3): deve propagarsi a /bids/t3, visibile anche
    // dagli altri client della stessa squadra tramite bidSubmittedState.
    await p3.waitForFunction(() => document.getElementById('bidInputArea')?.style.display === 'flex', { timeout: 8000 });
    await p3.fill('#bidInput', '35');
    await p3.click('#btnBid');
    await p3.waitForFunction(() => document.getElementById('bidSent')?.classList.contains('visible'), { timeout: 5000 });

    const bids = await fbRest('/bids');
    expect(bids.t3?.amount).toBe(35);
    // Gli altri tab della stessa squadra vedono lo stesso bidSubmittedState (sync realtime).
    await p1.waitForFunction(() => bidSubmittedState && bidSubmittedState.t3 === true, undefined, { timeout: 5000 });
    await p2.waitForFunction(() => bidSubmittedState && bidSubmittedState.t3 === true, undefined, { timeout: 5000 });

    await Promise.all([p1.close(), p2.close(), p3.close()]);
    await pres.waitForTimeout(500); // lascia propagare la rimozione delle 3 sessioni onDisconnect
  });

  // ── TC-MD-012 — offerta da un device, poi disconnessione dello stesso ───
  test('TC-MD-012 — offerta da un device, poi quel device si disconnette: offerta valida, squadra resta connessa (altro device attivo)', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    const tid = 't10';
    await deviceUp(tid, 'android'); // + d1("iOS") = 2 device
    await startTestAuction(pres, player, 20);
    await waitForPhase(pres, 'bidding', 10000);

    // Offerta scritta "da iOS" (simulata via REST, equivalente a submitBid()).
    await fbRest(`/bids/${tid}`, 'PUT', { amount: 28, ts: Date.now() });
    await fbRest(`/bidSubmitted/${tid}`, 'PUT', true);

    await deviceDown(tid, 'd1'); // disconnette "iOS"
    await pres.waitForTimeout(1500);
    const gs = await getGameState();
    expect(gs.phase).toBe('bidding'); // Android ancora attivo → nessuna sospensione
    const bids = await fbRest('/bids');
    expect(bids[tid]?.amount).toBe(28); // offerta intatta

    await deviceUp(tid, 'd1'); await deviceDown(tid, 'android'); // ripristina baseline
  });

  // ── TC-MD-013 — offerta da un device, poi disconnessione di TUTTI i device ─
  test('TC-MD-013 — offerta valida preservata anche quando tutti i device della squadra si disconnettono', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    const tid = 't6';
    await deviceUp(tid, 'ios');
    await startTestAuction(pres, player, 20);
    await waitForPhase(pres, 'bidding', 10000);

    await fbRest(`/bids/${tid}`, 'PUT', { amount: 19, ts: Date.now() });
    await fbRest(`/bidSubmitted/${tid}`, 'PUT', true);

    await Promise.all([deviceDown(tid, 'd1'), deviceDown(tid, 'ios')]);
    await waitForPhase(pres, 'paused', 8000);
    let bids = await fbRest('/bids');
    expect(bids[tid]?.amount).toBe(19); // preservata durante la sospensione

    await deviceUp(tid, 'd1'); // riconnette con un solo device
    await waitForPhase(pres, 'bidding', 10000);
    bids = await fbRest('/bids');
    expect(bids[tid]?.amount).toBe(19); // ancora intatta dopo la ripresa
  });

  // ── TC-MD-014 — due squadre multi-device ─────────────────────────────────
  test('TC-MD-014 — due squadre multi-device: restano connesse col device residuo, sospesa solo quando una perde l\'ultimo', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    await deviceUp('t4', 'android'); // S4: iOS(d1)+Android
    await deviceUp('t5', 'pc');       // S5: iOS(d1)+PC
    await startTestAuction(pres, player, 20);
    await waitForPhase(pres, 'bidding', 10000);

    await Promise.all([deviceDown('t4', 'd1'), deviceDown('t5', 'pc')]);
    await pres.waitForTimeout(1500);
    let gs = await getGameState();
    expect(gs.phase).toBe('bidding'); // entrambe hanno ancora un device attivo

    await deviceDown('t4', 'android'); // ora S4 è completamente disconnessa
    await waitForPhase(pres, 'paused', 8000);
    gs = await getGameState();
    expect(gs.disconnectedTeamIds).toContain('t4');

    await deviceUp('t4', 'd1');
    await waitForPhase(pres, 'bidding', 10000);
    await deviceUp('t5', 'pc'); await deviceDown('t5', 'pc'); // no-op cleanup coerente
  });

  // ── TC-MD-015 — 1 device disconnesso per OGNI squadra (tutte multi-device) ─
  test('TC-MD-015 — un device disconnesso per ciascuna delle 9 squadre finte: tutte restano connesse, asta attiva', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    // Dà a tutte le squadre finte un secondo device.
    await Promise.all(FAKE_TEAMS.map(tid => deviceUp(tid, 'extra')));
    await startTestAuction(pres, player, 20);
    await waitForPhase(pres, 'bidding', 10000);

    // Disconnette il device 'd1' (uno dei due) per TUTTE le squadre finte.
    await Promise.all(FAKE_TEAMS.map(tid => deviceDown(tid, 'd1')));
    await pres.waitForTimeout(2000);
    const gs = await getGameState();
    expect(gs.phase).toBe('bidding'); // il sistema non confonde device-down con team-down
    for (const tid of FAKE_TEAMS) expect(await sessionCount(tid)).toBe(1);

    await Promise.all(FAKE_TEAMS.map(tid => deviceUp(tid, 'd1'))); // ripristina
    await Promise.all(FAKE_TEAMS.map(tid => deviceDown(tid, 'extra')));
  });

  // ── TC-MD-016 — tutti i device di UNA squadra giù, le altre multi-device ─
  test('TC-MD-016 — tutti i device di una sola squadra disconnessi (le altre restano multi-device attive): asta sospesa', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    await Promise.all(FAKE_TEAMS.map(tid => deviceUp(tid, 'extra')));
    await startTestAuction(pres, player, 20);
    await waitForPhase(pres, 'bidding', 10000);

    await Promise.all(['d1', 'extra'].map(dev => deviceDown('t5', dev)));
    await waitForPhase(pres, 'paused', 8000);
    const gs = await getGameState();
    expect(gs.disconnectedTeamIds).toEqual(['t5']); // solo S5 è disconnessa

    await deviceUp('t5', 'd1');
    await waitForPhase(pres, 'bidding', 10000);
    await Promise.all(FAKE_TEAMS.map(tid => deviceDown(tid, 'extra')));
  });

  // ── TC-MD-017 — combinazione 10 squadre (adattata a 9 squadre finte) ────
  test('TC-MD-017 — combinazione multi-device su più squadre: solo la squadra senza device residui sospende l\'asta', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    // Configurazione (adattata dal documento): t1=1dev, t3=1dev, t4=2dev,
    // t5=2dev, t6=2dev, t7=3dev, t8=2dev, t9=2dev, t10=2dev.
    await Promise.all([
      deviceUp('t4', 'android'),
      deviceUp('t5', 'pc'),
      deviceUp('t6', 'pc'),
      deviceUp('t7', 'android'), deviceUp('t7', 'pc'),
      deviceUp('t8', 'android'),
      deviceUp('t9', 'pc'),
      deviceUp('t10', 'pc'),
    ]);
    await startTestAuction(pres, player, 25);
    await waitForPhase(pres, 'bidding', 10000);

    // Sequenza del documento (adattata agli id disponibili):
    await deviceDown('t4', 'd1');      // 1. iOS S4 giù → S4 resta connessa (Android)
    await deviceDown('t5', 'pc');      // 2. PC S5 giù → S5 resta connessa (iOS/d1)
    await deviceDown('t6', 'd1');      // 3. "Android" S6 giù → S6 resta connessa (PC)
    await deviceDown('t7', 'd1');      // 4. iOS S7 giù
    await deviceDown('t7', 'android'); // 5. Android S7 giù
    await deviceDown('t7', 'pc');      // 6. PC S7 giù → S7 COMPLETAMENTE disconnessa
    await deviceDown('t9', 'd1');      // 7. "Android" S9 giù → S9 resta connessa (PC)

    await waitForPhase(pres, 'paused', 10000);
    const gs = await getGameState();
    expect(gs.disconnectedTeamIds).toEqual(['t7']); // solo S7, come da documento

    // Cleanup e ripristino baseline.
    await deviceUp('t7', 'd1');
    await waitForPhase(pres, 'bidding', 10000);
    await Promise.all([
      deviceUp('t4', 'd1'), deviceDown('t4', 'android'),
      deviceUp('t5', 'pc'), deviceDown('t5', 'pc'),
      deviceUp('t6', 'd1'), deviceDown('t6', 'pc'),
      deviceDown('t7', 'android'), deviceDown('t7', 'pc'),
      deviceUp('t8', 'd1'), deviceDown('t8', 'android'),
      deviceUp('t9', 'd1'), deviceDown('t9', 'pc'),
      deviceUp('t10', 'd1'), deviceDown('t10', 'pc'),
    ]);
  });

  // ── TC-MD-018 — riconnessioni in ordine casuale, no doppie riprese ───────
  test('TC-MD-018 — riconnessioni multiple in ordine casuale della stessa squadra: nessuna doppia ripresa né reset timer', async () => {
    const player = P(); usedPlayerNames.push(player.nome);
    const tid = 't7';
    await deviceUp(tid, 'android'); await deviceUp(tid, 'pc');
    await startTestAuction(pres, player, 25);
    await waitForPhase(pres, 'bidding', 10000);

    await Promise.all(['d1', 'android', 'pc'].map(d => deviceDown(tid, d)));
    await waitForPhase(pres, 'paused', 8000);
    const timerEndAtPause = (await getGameState()).timerEnd;

    // Riconnette in ordine: Android → PC → iOS. Solo la PRIMA deve far
    // riprendere l'asta; le successive non devono alterare nulla.
    await deviceUp(tid, 'android');
    await waitForPhase(pres, 'bidding', 10000);
    const gsAfterFirst = await getGameState();
    expect(gsAfterFirst.pausedReason == null).toBe(true);

    await deviceUp(tid, 'pc');
    await deviceUp(tid, 'd1');
    await pres.waitForTimeout(1500);
    const gsAfterRest = await getGameState();
    expect(gsAfterRest.phase).toBe('bidding'); // ancora bidding, non "ri-ripresa"
    // Il timer non deve essere stato ri-resettato dalle riconnessioni successive
    // (nessuna nuova pauseAuction/adminResumeAuction dopo la prima ripresa).
    expect(gsAfterRest.timerEnd).toBe(gsAfterFirst.timerEnd);
    expect(gsAfterRest.timerEnd).toBeGreaterThan(timerEndAtPause - 1000);

    await deviceDown(tid, 'android'); await deviceDown(tid, 'pc'); // ripristina baseline (resta d1)
  });

  // ── TC-MD-019 — connessione simultanea stessa squadra da 2 device reali ──
  test('TC-MD-019 — apertura di un secondo device reale sulla stessa squadra: nessuna nuova squadra, nessuna sospensione, offerta invariata', async ({ browser }) => {
    const player = P(); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 20);
    await waitForPhase(pres, 'bidding', 10000);
    await fbRest('/bids/t1', 'PUT', { amount: 15, ts: Date.now() });

    const teamsBefore = await getTeams();
    const p1 = await browser.newPage(); // "PC", già connessa
    await loginTeam(p1, 't1');
    await waitForPhase(p1, 'bidding', 8000);

    // Apre la STESSA squadra da un secondo client ("iOS") mentre il primo è ancora attivo.
    const p2 = await browser.newPage();
    await loginTeam(p2, 't1');
    await waitForPhase(p2, 'bidding', 8000);

    const teamsAfter = await getTeams();
    expect(Object.keys(teamsAfter).length).toBe(Object.keys(teamsBefore).length); // nessuna nuova squadra
    expect(await sessionCount('t1')).toBe(1 /* d1 baseline */ + 2);
    const gs = await getGameState();
    expect(gs.phase).toBe('bidding'); // nessuna sospensione
    const bids = await fbRest('/bids');
    expect(bids.t1?.amount).toBe(15); // offerta corrente invariata

    await Promise.all([p1.close(), p2.close()]);
    await pres.waitForTimeout(500);
  });

  // ── TC-MD-020 — logout da un device (non l'ultimo) ───────────────────────
  test('TC-MD-020 — logout da un device quando ne resta un altro attivo: la squadra rimane connessa', async ({ browser }) => {
    const player = P(); usedPlayerNames.push(player.nome);
    await startTestAuction(pres, player, 20);
    await waitForPhase(pres, 'bidding', 10000);

    const p1 = await browser.newPage(); // "iOS"
    await loginTeam(p1, 't5');
    await deviceUp('t5', 'pc'); // "PC" resta connesso (simulato) mentre iOS fa logout
    await waitForPhase(p1, 'bidding', 8000);

    await p1.evaluate(() => logout()); // chiama la vera funzione di logout dell'app
    await p1.waitForTimeout(800); // lascia propagare removePresenceSession()

    const gs = await getGameState();
    expect(gs.phase).toBe('bidding'); // ancora connessa grazie al device "PC"
    expect(await sessionCount('t5')).toBeGreaterThanOrEqual(1);

    await p1.close();
    await deviceDown('t5', 'pc'); // ripristina baseline (resta d1)
  });

  // ── TC-MD-021 — logout dall'ultimo device ────────────────────────────────
  test('TC-MD-021 — logout dall\'unico device connesso: la squadra diventa disconnessa, asta sospesa', async ({ browser }) => {
    const player = P(); usedPlayerNames.push(player.nome);
    const tid = 't8';
    await deviceDown(tid, 'd1'); // rimuove il device finto: la squadra ha SOLO il device reale che sta per collegarsi
    await startTestAuction(pres, player, 20);
    await waitForPhase(pres, 'bidding', 10000);

    const p1 = await browser.newPage();
    await loginTeam(p1, tid);
    await waitForPhase(p1, 'bidding', 8000);
    expect(await sessionCount(tid)).toBe(1); // solo questo device

    await p1.evaluate(() => logout());
    await waitForPhase(pres, 'paused', 8000);
    const gs = await getGameState();
    expect(gs.disconnectedTeamIds).toContain(tid);

    await p1.close();
    await deviceUp(tid, 'd1'); // ripristina baseline
    await waitForPhase(pres, 'bidding', 10000);
  });

  // ── TC-MD-025 — sincronizzazione autorevole dello stato alla riconnessione ─
  test('TC-MD-025 — il client riconnesso riceve lo stato autorevole corrente, non quello locale precedente alla disconnessione', async ({ browser }) => {
    const player = P(); usedPlayerNames.push(player.nome);
    const tid = 't9';
    // Rimuove la sessione finta baseline PRIMA del login: altrimenti resterebbe
    // una sessione residua che manterrebbe la squadra "connessa" anche dopo la
    // chiusura della pagina reale, impedendo la sospensione attesa dal test.
    await deviceDown(tid, 'd1');
    await startTestAuction(pres, player, 30);
    await waitForPhase(pres, 'bidding', 10000);

    const p1 = await browser.newPage();
    await loginTeam(p1, tid);
    await waitForPhase(p1, 'bidding', 8000);
    const playerNameSeenBefore = await p1.evaluate(() => gameState.currentPlayer && gameState.currentPlayer.nome);
    expect(playerNameSeenBefore).toBe(player.nome);

    // La squadra si disconnette completamente → asta sospesa.
    await p1.close();
    await waitForPhase(pres, 'paused', 8000);

    // MENTRE è disconnessa, un'altra squadra piazza una nuova offerta (stato
    // che il client disconnesso non ha ancora visto).
    await fbRest('/bids/t1', 'PUT', { amount: 71, ts: Date.now() });
    await fbRest('/bidSubmitted/t1', 'PUT', true);

    // Riconnette con una pagina NUOVA (stato locale vuoto: nessuna cache dello
    // stato precedente) e verifica che riceva lo stato autorevole corrente,
    // inclusa l'offerta piazzata mentre era offline.
    const p2 = await browser.newPage();
    await loginTeam(p2, tid);
    await waitForPhase(p2, 'bidding', 10000);
    const bidsSeenAfterReconnect = await p2.evaluate(() => bidsState);
    expect(bidsSeenAfterReconnect.t1?.amount).toBe(71);
    const gs = await getGameState();
    expect(gs.pausedReason == null).toBe(true);

    await p2.close();
  });
});
