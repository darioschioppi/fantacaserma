# 🏆 Fantacaserma — Asta a Busta Chiusa

Web app per gestire l'asta live a busta chiusa del fantacalcio della Caserma.

## 📲 Scarica / Installa

| Piattaforma | Link |
|-------------|------|
| 🤖 **Android** | [⬇️ Scarica APK](https://github.com/darioschioppi/fantacaserma/releases/latest/download/FantaCaserma.apk) |
| 🍎 **iPhone / iPad** | [Guida installazione PWA](https://darioschioppi.github.io/fantacaserma/install-ios.html) |
| 🌐 **Web** | [darioschioppi.github.io/fantacaserma](https://darioschioppi.github.io/fantacaserma/) |

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

### Admin / Presidente
- Ricerca e selezione giocatori da liste ufficiali (Fantacalcio Classic / Mantra)
- Avvio asta con timer configurabile (10–120 secondi, default 30s)
- Pausa e ripresa asta
- Terminazione manuale asta (giocatore rimesso in attesa)
- Gestione assegnazioni: rimuovi, riassegna a squadra diversa con prezzo custom
- Assegnazione manuale di giocatori liberi
- Audit log su Firebase per ogni operazione amministrativa
- Visualizzazione budget e rosa di tutte le squadre

---

## 🔄 Flusso asta

1. Admin seleziona un giocatore e avvia l'asta
2. Tutte le squadre hanno N secondi per inviare l'offerta (timer configurabile)
3. Il tavolo poker mostra chi ha offerto (senza importo)
4. Alla scadenza le buste si aprono: chi ha offerto di più vince
5. In caso di parità → spareggio inline nella stessa schermata
6. Il giocatore viene assegnato, budget detratto, rosa aggiornata

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
