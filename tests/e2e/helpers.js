/**
 * Test helpers condivisi per la suite E2E di Fantacaserma
 */

const BASE_URL = 'https://darioschioppi.github.io/fantacaserma/';
const TEAM_PASSWORD = 'caserma1';
const LOADER_TIMEOUT = 15_000;
const SCREEN_TIMEOUT = 12_000;

/**
 * Attende che il loader iniziale sparisca e la login screen sia visibile.
 * Il loader si nasconde dopo il caricamento dei giocatori da Firebase.
 */
async function waitForLoginScreen(page) {
  // Attende che il loader acquisisca la classe "hidden"
  await page.waitForFunction(
    () => {
      const loader = document.getElementById('loader');
      const login = document.getElementById('screen-login');
      return (
        (loader && loader.classList.contains('hidden')) ||
        (login && login.classList.contains('active'))
      );
    },
    { timeout: LOADER_TIMEOUT }
  );
  // Verifica esplicita che la login sia visibile
  await page.locator('#screen-login.active').waitFor({ state: 'attached', timeout: SCREEN_TIMEOUT });
}

/**
 * Esegue il login come una squadra specifica.
 * @param {import('@playwright/test').Page} page
 * @param {string} teamId - es. 't1', 't2'
 * @param {string} [password]
 */
async function loginAsTeam(page, teamId, password = TEAM_PASSWORD) {
  await waitForLoginScreen(page);
  // Assicura che la tab squadra sia attiva
  await page.locator('#formSquadra').waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {
    // Potrebbe già essere visibile
  });
  await page.selectOption('#teamSelect', teamId);
  await page.fill('#teamPassword', password);
  await page.click('button:has-text("Entra →")');
}

/**
 * Attende che la schermata partecipante sia attiva.
 */
async function waitForParticipantScreen(page) {
  await page.locator('#screen-participant.active').waitFor({ state: 'attached', timeout: SCREEN_TIMEOUT });
}

/**
 * Navigazione completa: goto + login + attesa schermata partecipante.
 */
async function gotoAndLogin(page, teamId, password = TEAM_PASSWORD) {
  await page.goto(BASE_URL);
  await loginAsTeam(page, teamId, password);
  await waitForParticipantScreen(page);
}

module.exports = {
  BASE_URL,
  TEAM_PASSWORD,
  waitForLoginScreen,
  loginAsTeam,
  waitForParticipantScreen,
  gotoAndLogin,
};
