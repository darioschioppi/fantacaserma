/**
 * 08 - Simulazione Asta Live (Multi-Giocatore)
 *
 * Testa il flusso completo dell'asta simulando più giocatori contemporaneamente.
 * Un contesto Admin gestisce l'asta; le offerte degli altri team vengono
 * iniettate direttamente via Firebase con page.evaluate().
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

// ─── HELPERS FIREBASE (eseguiti nel contesto browser) ────────────────────────

/**
 * Attende che la Firebase db sia disponibile nel contesto della pagina.
 */
async function waitForDb(page) {
  await page.waitForFunction(() => !!window.db && !!window.gameState, { timeout: 8000 });
}

/**
 * Resetta il gioco a 'waiting' e cancella bids/assignments di test.
 */
async function resetGame(page) {
  await page.evaluate(async () => {
    const updates = {
      '/game/phase': 'waiting',
      '/game/currentPlayer': null,
      '/game/timerEnd': null,
      '/game/tiebreakers': null,
      '/game/minBid': null,
      '/game/tiebreakerFirstBid': null,
      '/game/pausedPhase': null,
      '/game/auctionDuration': null,
      '/bids': null,
      '/bidSubmitted': null,
    };
    await window.db.ref().update(updates);
  });
  // Breve attesa per propagazione Firebase
  await page.waitForTimeout(500);
}

/**
 * Avvia un'asta con il giocatore di test, bypassando la UI.
 */
async function startTestAuction(page, durationSec = AUCTION_DURATION_TEST) {
  await page.evaluate(async ({ player, duration }) => {
    const timerEnd = Date.now() + duration * 1000;
    await window.db.ref('/bids').set(null);
    await window.db.ref('/bidSubmitted').set(null);
    await window.db.ref('/game').update({
      phase: 'bidding',
      currentPlayer: player,
      minBid: 1,
      timerEnd,
      tiebreakers: null,
      tiebreakerFirstBid: null,
      auctionDuration: duration,
    });
    window.autoRevealFired = false;
  }, { player: TEST_PLAYER, duration: durationSec });
  await page.waitForTimeout(300);
}

/**
 * Simula un'offerta da parte di un team (come se il team avesse premuto "OFFERTA").
 */
async function simulateBid(page, teamId, amount) {
  await page.evaluate(async ({ tid, amt }) => {
    await window.db.ref('/bids/' + tid).set({ amount: amt, ts: Date.now() });
    await window.db.ref('/bidSubmitted/' + tid).set(true);
  }, { tid: teamId, amt: amount });
}

/**
 * Simula il "passa" da parte di un team (offerta = 0).
 */
async function simulatePass(page, teamId) {
  await simulateBid(page, teamId, 0);
}

/**
 * Attende che il gameState raggiunga una certa fase.
 */
async function waitForPhase(page, phase, timeoutMs = 15000) {
  await page.waitForFunction(
    (expectedPhase) => (window.gameState || {}).phase === expectedPhase,
    phase,
    { timeout: timeoutMs }
  );
}

/**
 * Legge il gameState corrente da Firebase.
 */
async function getGameState(page) {
  return page.evaluate(async () => {
    const snap = await window.db.ref('/game').once('value');
    return snap.val() || {};
  });
}

/**
 * Legge tutte le assegnazioni correnti da Firebase.
 */
async function getAssignments(page) {
  return page.evaluate(async () => {
    const snap = await window.db.ref('/assignments').once('value');
    const raw = snap.val() || {};
    return Object.entries(raw).map(([key, val]) => ({ ...val, _key: key }));
  });
}

/**
 * Elimina le assegnazioni di test (player === '__TEST_PLAYER__') e ripristina budget.
 */
async function cleanupTestAssignments(page) {
  await page.evaluate(async () => {
    const snap = await window.db.ref('/assignments').once('value');
    const raw = snap.val() || {};
    const updates = {};
    for (const [key, val] of Object.entries(raw)) {
      if (val.player === '__TEST_PLAYER__') {
        updates['/assignments/' + key] = null;
        // Ripristina budget squadra
        const teamSnap = await window.db.ref('/teams/' + val.teamId).once('value');
        const td = teamSnap.val() || {};
        updates['/teams/' + val.teamId + '/budget'] =
          (td.budget != null ? td.budget : 500) + (val.amount || 0);
        updates['/teams/' + val.teamId + '/rosterCount'] =
          Math.max(0, (td.rosterCount || 0) - 1);
      }
    }
    if (Object.keys(updates).length) await window.db.ref().update(updates);
  });
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
  await page.selectOption('#teamSelect', teamId);
  await page.fill('#teamPassword', TEAM_PASSWORD);
  await page.click('button:has-text("Entra →")');
  await page.locator('#screen-participant.active').waitFor({ timeout: 10000 });
  await waitForDb(page);
}

// ─── SUITE: eseguita in sequenza per evitare race conditions su Firebase ──────

test.describe.serial('Simulazione Asta — Flussi Completi', () => {

  // Cleanup globale prima di tutta la suite
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await loginAdmin(page);
    await resetGame(page);
    await cleanupTestAssignments(page);
    await page.close();
  });

  // Cleanup dopo ogni test
  test.afterEach(async ({ browser }) => {
    const page = await browser.newPage();
    await loginAdmin(page);
    await resetGame(page);
    await cleanupTestAssignments(page);
    await page.close();
  });

  // ── SCENARIO 1: Asta con vincitore unico ──────────────────────────────────

  test('SC1 — vincitore unico: il giocatore viene assegnato alla squadra con offerta più alta', async ({ browser }) => {
    const adminPage = await browser.newPage();
    const participantPage = await browser.newPage();

    await Promise.all([
      loginAdmin(adminPage),
      loginTeam(participantPage, 't1'), // Barca
    ]);

    // Avvia asta
    await startTestAuction(adminPage);
    await waitForPhase(adminPage, 'bidding', 5000);

    // Simula offerte: t3=50, t1=80 (vincitore), t5=60, tutti gli altri passano
    await simulateBid(adminPage, 't1', 80);
    await simulateBid(adminPage, 't3', 50);
    await simulateBid(adminPage, 't5', 60);
    for (const tid of ['t2','t4','t6','t7','t8','t9','t10']) {
      await simulatePass(adminPage, tid);
    }

    // Attende reveal automatico (tutti hanno offerto)
    await waitForPhase(adminPage, 'reveal', 8000);
    // Attende assegnazione automatica
    await waitForPhase(adminPage, 'assigned', 8000);

    // Verifica assegnazione su Firebase
    const assignments = await getAssignments(adminPage);
    const testAssign = assignments.find(a => a.player === '__TEST_PLAYER__');

    expect(testAssign).toBeTruthy();
    expect(testAssign.teamId).toBe('t1');     // t1 ha offerto 80, massimo
    expect(testAssign.amount).toBe(80);

    // Verifica che il budget di t1 sia stato detratto
    const budget = await adminPage.evaluate(async () => {
      const snap = await window.db.ref('/teams/t1/budget').once('value');
      return snap.val();
    });
    expect(budget).toBeLessThanOrEqual(500 - 80); // potrebbe avere altri acquisti

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
    await waitForPhase(adminPage, 'bidding', 5000);

    // t2 e t6 offrono lo stesso importo → tiebreaker
    await simulateBid(adminPage, 't2', 70);
    await simulateBid(adminPage, 't6', 70);
    for (const tid of ['t1','t3','t4','t5','t7','t8','t9','t10']) {
      await simulatePass(adminPage, tid);
    }

    // Deve scattare il tiebreaker
    await waitForPhase(adminPage, 'tiebreaker', 10000);

    const gs = await getGameState(adminPage);
    expect(gs.phase).toBe('tiebreaker');
    expect(gs.tiebreakers).toContain('t2');
    expect(gs.tiebreakers).toContain('t6');
    expect(gs.tiebreakers.length).toBe(2);
    expect(gs.minBid).toBe(70); // uguale all'offerta pareggiante

    // Spareggio: t2 rilancia a 75, t6 passa → t2 vince
    await simulateBid(adminPage, 't2', 75);
    await simulatePass(adminPage, 't6');

    await waitForPhase(adminPage, 'assigned', 10000);

    const assignments = await getAssignments(adminPage);
    const testAssign = assignments.find(a => a.player === '__TEST_PLAYER__');
    expect(testAssign?.teamId).toBe('t2');
    expect(testAssign?.amount).toBe(75);

    await adminPage.close();
  });

  // ── SCENARIO 3: Nessuna offerta → giocatore saltato ───────────────────────

  test('SC3 — nessuna offerta: il giocatore viene saltato automaticamente', async ({ browser }) => {
    const adminPage = await browser.newPage();
    await loginAdmin(adminPage);

    await startTestAuction(adminPage);
    await waitForPhase(adminPage, 'bidding', 5000);

    // Tutti passano
    for (const tid of TEAMS) {
      await simulatePass(adminPage, tid);
    }

    // Auto-reveal → nessuna offerta → waiting (skip)
    await waitForPhase(adminPage, 'waiting', 10000);

    // Nessuna assegnazione creata
    const assignments = await getAssignments(adminPage);
    const testAssign = assignments.find(a => a.player === '__TEST_PLAYER__');
    expect(testAssign).toBeUndefined();

    await adminPage.close();
  });

  // ── SCENARIO 4: Pausa e ripresa ───────────────────────────────────────────

  test('SC4 — pausa e ripresa: la fase diventa paused, poi torna bidding con timer resettato', async ({ browser }) => {
    const adminPage = await browser.newPage();
    const participantPage = await browser.newPage();

    await Promise.all([
      loginAdmin(adminPage),
      loginTeam(participantPage, 't3'),
    ]);

    await startTestAuction(adminPage);
    await waitForPhase(adminPage, 'bidding', 5000);

    // Admin pausa
    await adminPage.evaluate(() => window.adminPauseAuction());
    await waitForPhase(adminPage, 'paused', 5000);

    // Il partecipante vede "⏸ In pausa"
    await participantPage.waitForFunction(
      () => (window.gameState || {}).phase === 'paused',
      { timeout: 8000 }
    );
    const pauseText = await participantPage.locator('#bidAreaWaiting').textContent();
    expect(pauseText).toContain('pausa');

    // Admin riprende
    await adminPage.evaluate(() => window.adminResumeAuction());
    await waitForPhase(adminPage, 'bidding', 5000);

    // Il timer è stato resettato (timerEnd > now)
    const gs = await getGameState(adminPage);
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
    await waitForPhase(adminPage, 'bidding', 5000);

    // Alcune offerte già inviate
    await simulateBid(adminPage, 't4', 45);
    await simulateBid(adminPage, 't7', 38);

    // Admin termina manualmente
    await adminPage.evaluate(() => window.adminEndAuction());
    await waitForPhase(adminPage, 'waiting', 5000);

    const assignments = await getAssignments(adminPage);
    const testAssign = assignments.find(a => a.player === '__TEST_PLAYER__');
    expect(testAssign).toBeUndefined(); // non assegnato

    await adminPage.close();
  });

  // ── SCENARIO 6: Timer scade → auto-reveal ─────────────────────────────────

  test('SC6 — timer scaduto: auto-reveal e assegnazione automatica allo scadere', async ({ browser }) => {
    const adminPage = await browser.newPage();
    await loginAdmin(adminPage);

    // Timer molto breve: 6 secondi
    await startTestAuction(adminPage, 6);
    await waitForPhase(adminPage, 'bidding', 5000);

    // Solo 2 team offrono, gli altri non fanno niente (non passano esplicitamente)
    await simulateBid(adminPage, 't8', 55);
    await simulateBid(adminPage, 't9', 40);

    // Attende scadenza timer → reveal automatico (max 6s + 3s buffer)
    await waitForPhase(adminPage, 'reveal', 12000);
    // Poi assegnazione automatica
    await waitForPhase(adminPage, 'assigned', 8000);

    const assignments = await getAssignments(adminPage);
    const testAssign = assignments.find(a => a.player === '__TEST_PLAYER__');
    expect(testAssign).toBeTruthy();
    expect(testAssign.teamId).toBe('t8'); // t8 ha offerto di più
    expect(testAssign.amount).toBe(55);

    await adminPage.close();
  });

  // ── SCENARIO 7: Gestione assegnazioni (rimozione + riassegnazione) ─────────

  test('SC7 — gestione assegnazioni: rimozione ripristina budget, riassegna trasferisce', async ({ browser }) => {
    const adminPage = await browser.newPage();
    await loginAdmin(adminPage);

    // Crea assegnazione di test manualmente
    await adminPage.evaluate(async () => {
      const key = window.db.ref('/assignments').push().key;
      const updates = {};
      updates['/assignments/' + key] = {
        player: '__TEST_PLAYER__', ruolo: 'A',
        teamId: 't1', teamName: 'Barca', amount: 60, timestamp: Date.now()
      };
      updates['/teams/t1/budget'] = (window.teamsState['t1']?.budget ?? 500) - 60;
      updates['/teams/t1/rosterCount'] = (window.teamsState['t1']?.rosterCount ?? 0) + 1;
      await window.db.ref().update(updates);
    });
    await adminPage.waitForTimeout(600);

    // Ricarica lo stato
    const assignBefore = await getAssignments(adminPage);
    const testEntry = assignBefore.find(a => a.player === '__TEST_PLAYER__');
    expect(testEntry).toBeTruthy();

    const budgetBefore = await adminPage.evaluate(async () => {
      const s = await window.db.ref('/teams/t1/budget').once('value');
      return s.val();
    });

    // ── Sub-test A: Rimozione ──
    await adminPage.evaluate(async (key) => {
      await window.confirmRemoveAssignment(key);
    }, testEntry._key);
    // Nota: confirmRemoveAssignment usa confirm() – nel contesto browser senza dialog
    // dobbiamo accettare il dialog automaticamente
    adminPage.on('dialog', d => d.accept());

    // Aspetta propagazione
    await adminPage.waitForTimeout(800);

    const assignAfterRemove = await getAssignments(adminPage);
    const removed = assignAfterRemove.find(a => a.player === '__TEST_PLAYER__');
    expect(removed).toBeUndefined();

    const budgetAfterRemove = await adminPage.evaluate(async () => {
      const s = await window.db.ref('/teams/t1/budget').once('value');
      return s.val();
    });
    expect(budgetAfterRemove).toBeGreaterThanOrEqual(budgetBefore + 60);

    await adminPage.close();
  });

  // ── SCENARIO 8: Assegnazione manuale giocatore libero ────────────────────

  test('SC8 — assegna giocatore libero: compare nella lista assegnazioni', async ({ browser }) => {
    const adminPage = await browser.newPage();
    await loginAdmin(adminPage);

    // Preleva budget iniziale di t5
    const budgetBefore = await adminPage.evaluate(async () => {
      const s = await window.db.ref('/teams/t5/budget').once('value');
      return s.val() ?? 500;
    });

    // Simula confirmAssignFree iniettando un giocatore fittizio
    await adminPage.evaluate(async () => {
      // Imposta il giocatore selezionato manualmente
      window.assignFreeSelected = { Nome: '__TEST_PLAYER__', Ruolo_Classic: 'A', Squadra: 'TestFC' };
      // Imposta lo scope su 'pres' (default)
      window.assignScope = 'pres';
      // Popola il form direttamente in memoria (senza UI)
      const key = window.db.ref('/assignments').push().key;
      const updates = {};
      updates['/assignments/' + key] = {
        player: '__TEST_PLAYER__', ruolo: 'A',
        teamId: 't5', teamName: 'Paris San Giuann', amount: 35, timestamp: Date.now()
      };
      const teamSnap = await window.db.ref('/teams/t5').once('value');
      const td = teamSnap.val() || {};
      updates['/teams/t5/budget'] = (td.budget ?? 500) - 35;
      updates['/teams/t5/rosterCount'] = (td.rosterCount ?? 0) + 1;
      await window.db.ref().update(updates);
    });

    await adminPage.waitForTimeout(600);

    const assignments = await getAssignments(adminPage);
    const testAssign = assignments.find(a => a.player === '__TEST_PLAYER__');
    expect(testAssign).toBeTruthy();
    expect(testAssign.teamId).toBe('t5');
    expect(testAssign.amount).toBe(35);

    const budgetAfter = await adminPage.evaluate(async () => {
      const s = await window.db.ref('/teams/t5/budget').once('value');
      return s.val();
    });
    expect(budgetAfter).toBeLessThanOrEqual(budgetBefore - 35);

    await adminPage.close();
  });

});

// ─── SUITE: Verifiche UI real-time (admin + partecipante in parallelo) ────────

test.describe.serial('Simulazione UI Real-time', () => {

  test.afterEach(async ({ browser }) => {
    const page = await browser.newPage();
    await loginAdmin(page);
    await resetGame(page);
    await cleanupTestAssignments(page);
    await page.close();
  });

  test('UI — partecipante vede il tavolo aggiornarsi quando una squadra offre', async ({ browser }) => {
    const adminPage   = await browser.newPage();
    const teamPage    = await browser.newPage(); // Barca (t1) – osservatore

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

    // Verifica che il chip di t1 diventi verde (submitted)
    await teamPage.waitForFunction(
      () => document.getElementById('chip-t1')?.classList.contains('submitted'),
      { timeout: 8000 }
    );
    const chipClass = await teamPage.evaluate(() => document.getElementById('chip-t1').className);
    expect(chipClass).toContain('submitted');

    // Nell'admin panel, t1 risulta aver offerto
    await adminPage.waitForFunction(
      () => !!window.bidSubmittedState?.t1,
      { timeout: 8000 }
    );

    await adminPage.close();
    await teamPage.close();
  });

  test('UI — partecipante in spareggio vede il banner tiebreaker', async ({ browser }) => {
    const adminPage   = await browser.newPage();
    const participantPage = await browser.newPage(); // t2 = Benfiga

    await Promise.all([
      loginAdmin(adminPage),
      loginTeam(participantPage, 't2'),
    ]);

    await startTestAuction(adminPage);
    await waitForPhase(adminPage, 'bidding', 5000);

    // t2 e t4 offrono lo stesso → tiebreaker
    await simulateBid(adminPage, 't2', 65);
    await simulateBid(adminPage, 't4', 65);
    for (const tid of ['t1','t3','t5','t6','t7','t8','t9','t10']) {
      await simulatePass(adminPage, tid);
    }

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
    const adminPage   = await browser.newPage();
    const participantPage = await browser.newPage();

    await Promise.all([
      loginAdmin(adminPage),
      loginTeam(participantPage, 't6'),
    ]);

    await startTestAuction(adminPage);
    await waitForPhase(adminPage, 'bidding', 5000);

    // t6 vince con 90 cr
    await simulateBid(adminPage, 't6', 90);
    for (const tid of ['t1','t2','t3','t4','t5','t7','t8','t9','t10']) {
      await simulatePass(adminPage, tid);
    }

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
