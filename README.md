# 🏆 Fantacaserma — Asta a Busta Chiusa

Web app per gestire l'asta live a busta chiusa del fantacalcio della Caserma.

## 📲 Scarica / Installa

| Piattaforma | Link |
|-------------|------|
| 🤖 **Android** | [⬇️ Scarica APK](https://github.com/darioschioppi/fantacaserma/releases/latest/download/FantaCaserma.apk) |
| 🍎 **iPhone / iPad** | [Guida installazione PWA](https://darioschioppi.github.io/fantacaserma/install-ios.html) |
| 🌐 **Web** | [darioschioppi.github.io/fantacaserma](https://darioschioppi.github.io/fantacaserma/) |
| 📖 **Regolamento 2026/27** | [darioschioppi.github.io/fantacaserma/regolamento](https://darioschioppi.github.io/fantacaserma/regolamento/) |

### Android
1. Apri il link APK **in Chrome** (non nel browser di Telegram)
2. Scarica e installa — se richiesto, abilita *"Installa da fonti sconosciute"*
3. Ad ogni build del repository, la **Release viene aggiornata automaticamente** con il nuovo APK

### iPhone / iPad
Segui la [guida illustrata](https://darioschioppi.github.io/fantacaserma/install-ios.html): apri l'app in Safari → condividi → *"Aggiungi a schermata Home"*

### Aggiornamenti automatici
- **Web & PWA**: si aggiorna ad ogni push su `main` grazie al Service Worker (network-first per HTML)
- **Android**: GitHub Actions compila e pubblica un nuovo APK ad ogni push su `main`; l'app WebView scarica sempre la versione più recente al lancio

---

## ⚙️ Funzionalità

### Partecipanti (squadre)
- Login con password squadra
- Visualizzazione asta in corso con timer live
- Invio offerta a busta chiusa
- Visualizzazione tavolo poker (chi ha già offerto, senza importo)
- Spareggio inline in caso di parità
- Storico assegnazioni proprie
- Classifica budget e rosa
- Pianificazione: importo "preparato" in anticipo per un giocatore, usato per precompilare l'offerta quando la sua asta parte
- Accesso multi-dispositivo: la stessa squadra può stare collegata da più telefoni/PC contemporaneamente (es. più persone della stessa squadra); conta come "connessa" finché almeno un dispositivo è online
- Esportazione delle rose di tutte le squadre in un file Excel, con un click

### Admin / Presidente (Benfiga)
- Ricerca e selezione giocatori da un elenco ufficiale (Fantacalcio Classic — 539 giocatori con ruolo, squadra Serie A e quotazione)
- Avvio asta con timer configurabile (10–120 secondi, default 30s) e durata configurabile della rivelazione prezzi
- Pausa e ripresa asta (manuale, o automatica in caso di disconnessione)
- Terminazione manuale asta (giocatore rimesso in attesa)
- Gestione assegnazioni: rimuovi, riassegna a squadra diversa con prezzo custom
- Assegnazione manuale di giocatori liberi
- Audit log su Firebase per ogni operazione amministrativa
- Visualizzazione budget e rosa di tutte le squadre, esportabili in Excel
- Reset stagione (azzera assegnazioni, budget e log — irreversibile)

---

## 🔄 Flusso asta

1. Admin seleziona un giocatore e avvia l'asta
2. Tutte le squadre hanno N secondi per inviare l'offerta (timer configurabile)
3. Il tavolo poker mostra chi ha offerto (senza importo)
4. Alla scadenza le buste si aprono: chi ha offerto di più vince
5. In caso di parità → spareggio inline nella stessa schermata (si rilancia allo stesso importo o più alto)
6. Il giocatore viene assegnato, budget detratto, rosa aggiornata

### Gestione delle disconnessioni

Regola di base: **una squadra è "connessa" se almeno uno dei suoi dispositivi/tab è online**; è "disconnessa" solo quando *tutte* le sue sessioni sono cadute. Se anche una sola delle 10 squadre risulta completamente disconnessa durante un'asta in corso, l'asta si sospende immediatamente per tutti (timer fermo, offerte bloccate, giocatore e offerta corrente preservati) e riprende automaticamente solo quando tutte le squadre sono di nuovo online — senza bisogno di alcuna azione manuale del presidente. Il comportamento è documentato e verificato nel dettaglio nel [Test Book](docs/TEST_BOOK.md).

---

## 📚 Documentazione

| Documento | Contenuto |
|---|---|
| [`docs/REQUISITI.md`](docs/REQUISITI.md) | Cosa deve fare il software e perché, in linguaggio non tecnico |
| [`docs/ANALISI_FUNZIONALE.md`](docs/ANALISI_FUNZIONALE.md) | Chi usa l'app e come, passo per passo, per ogni scenario |
| [`docs/SOLUTION_DESIGN.md`](docs/SOLUTION_DESIGN.md) | Come è costruito tecnicamente: architettura, dati, componenti |
| [`docs/TEST_BOOK.md`](docs/TEST_BOOK.md) | Cosa viene verificato dai test automatici e come |

---

## 🛠️ Stack tecnico

| Componente | Tecnologia |
|------------|------------|
| Frontend | HTML/CSS/JS single-page app |
| Hosting web | GitHub Pages |
| Database realtime | Firebase Realtime Database |
| Auth | Firebase custom (password teams) |
| Android | WebView nativa (Java), compilata con Gradle |
| CI/CD | GitHub Actions → APK firmato → GitHub Release |
| PWA | Service Worker (network-first HTML, cache-first assets) |
| iOS install | PWA "Add to Home Screen" via Safari |

---

## 🏗️ Build Android

Il workflow `.github/workflows/build-android.yml` si attiva ad ogni push su `main` che tocca file rilevanti (`index.html`, `sw.js`, `manifest.json`, `android/**`).

Secrets necessari nel repository:
- `KEYSTORE_BASE64` — keystore firmato in base64
- `KEYSTORE_STORE_PASSWORD` — password keystore
- `KEYSTORE_KEY_PASSWORD` — password chiave

Il numero di build corrisponde a `github.run_number` (versionCode auto-incrementale).
