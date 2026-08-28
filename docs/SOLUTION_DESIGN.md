# Solution Design — FantaCaserma

Questo documento descrive **come è costruito** il software: architettura, stack tecnico, modello dati, componenti e le decisioni di design più importanti (con il "perché" dietro alle scelte più delicate, in particolare sulla gestione delle disconnessioni).

## 1. Vista d'insieme

FantaCaserma è una **applicazione web statica** (nessun server applicativo in produzione) che si appoggia a **Firebase Realtime Database** come unica fonte di verità condivisa tra tutti i client. Non esiste un backend proprietario che orchestri la logica di gioco: ogni client (browser/app) esegue la stessa logica JavaScript e coordina lo stato tramite letture/scritture sincronizzate in tempo reale sul database.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Browser    │     │  PWA        │     │  App Android│
│  (Squadra)  │     │  (installata)│    │  (WebView)  │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                            │ HTTPS / WebSocket
                            ▼
              ┌─────────────────────────┐
              │ Firebase Realtime DB    │  ← unica fonte di verità
              │ (fantacaserma-f2fe2)    │
              └─────────────────────────┘
                            ▲
                            │
              ┌─────────────────────────┐
              │ GitHub Pages            │  ← hosting statico di index.html
              └─────────────────────────┘
```

Tutti i client (la squadra sul telefono, il Presidente sul PC, la dashboard pubblica proiettata in sala) leggono e scrivono lo stesso database in tempo reale: non serve un server che "spinga" gli aggiornamenti, è Firebase stesso a notificare ogni client sottoscritto a un percorso quando quel percorso cambia.

## 2. Stack tecnico

| Livello | Tecnologia | Note |
|---|---|---|
| Frontend | HTML/CSS/JavaScript vanilla, single-page application | Un solo file `index.html` (~3370 righe), nessun framework (React/Vue/ecc.), nessun bundler/build step |
| Database e sincronizzazione | Firebase Realtime Database | Region `europe-west1`, progetto `fantacaserma-f2fe2` |
| Autenticazione | Firebase Auth, **sign-in anonimo** | Non autentica "chi" sei (nome squadra/password sono un controllo applicativo separato, non Firebase Auth) ma dà un token valido per soddisfare le regole di sicurezza del database (`auth != null`) |
| Hosting web | GitHub Pages | Serve `index.html` e asset statici direttamente dal branch `main` |
| PWA | Web App Manifest + Service Worker (`sw.js`) | Rende l'app installabile su iOS/desktop, con caching per funzionamento offline parziale |
| App Android | WebView nativa (Java, Gradle) | Non è una Trusted Web Activity: è un'Activity Android che incorpora una WebView puntata sull'URL di produzione |
| CI/CD | GitHub Actions | Tre workflow: test E2E, build/release APK Android, deploy regole Firebase |
| Test automatici | Playwright | 15 file di test end-to-end, eseguiti contro l'ambiente reale (GitHub Pages + Firebase) |

### Perché nessun framework e nessun backend applicativo

Il progetto è nato come prototipo Node.js/Express + Socket.io con stato in memoria sul server (file `server.js`, ancora presente nel repository come riferimento storico ma non più eseguito in produzione). È stato poi migrato a un'architettura interamente client-side con Firebase come backend-as-a-service: questo elimina la necessità di mantenere un server sempre acceso, semplifica il deploy (basta pubblicare file statici) e sposta la responsabilità di sincronizzazione in tempo reale su un servizio gestito, pensato apposta per questo caso d'uso.

## 3. Modello dati (Firebase Realtime Database)

Il database è organizzato in pochi percorsi principali, tutti sotto la radice:

```
/game                  → stato corrente dell'asta (singolo oggetto)
/teams/{teamId}         → dati di ciascuna delle 10 squadre
/teams/{teamId}/sessions/{sessionKey} → presenza multi-dispositivo
/bids/{teamId}          → offerta corrente della squadra nel turno in corso
/bidSubmitted/{teamId}  → flag booleano "ha già inviato" per il turno corrente
/assignments/{key}      → storico di tutte le assegnazioni effettuate
/avatars/{teamId}       → foto profilo/stemma della squadra (immagine base64)
/log/{key}              → audit log di tutte le operazioni amministrative
/plans/{teamId}/{playerKey} → importi pianificati in anticipo per giocatore
```

### `/game` — stato dell'asta

Campo | Significato
---|---
`phase` | `waiting` \| `bidding` \| `tiebreaker` \| `reveal` \| `assigned` \| `paused`
`currentPlayer` | oggetto con nome, ruolo, squadra Serie A, quotazione del giocatore in asta
`minBid` | importo minimo accettabile per l'offerta corrente (1, o l'importo di parità durante uno spareggio)
`timerEnd` | timestamp assoluto di scadenza del turno — **non** una durata relativa, così tutti i client calcolano lo stesso conto alla rovescia indipendentemente da quando si sono collegati
`tiebreakers` | elenco degli id delle squadre coinvolte in uno spareggio in corso (null fuori spareggio)
`tiebreakerFirstBid` | mappa `teamId → timestamp` di chi ha offerto per primo nel turno di parità, usata come criterio di risoluzione se nessuno rilancia
`pausedReason`, `pausedAt`, `pausedPhase` | presenti solo durante `phase === 'paused'`: motivo (`manual` o `disconnect`), istante e fase da cui si è sospesi (per sapere dove riprendere)
`disconnectedTeamIds` | elenco delle squadre attualmente offline, aggiornato in tempo reale mentre l'asta è sospesa per disconnessione
`revealEnd` | timestamp di fine della schermata di rivelazione (durata configurabile)
`auctionDuration` | durata in secondi impostata dal Presidente per i turni di offerta

### `/teams/{teamId}` — presenza multi-dispositivo

Ogni squadra ha un sotto-percorso `sessions`, dove ogni dispositivo/tab collegato registra una propria chiave univoca (generata da Firebase) con valore `true`, rimossa automaticamente da Firebase stesso quando quella connessione WebSocket si interrompe (funzione `onDisconnect()`). Una squadra è considerata online se e solo se `sessions` contiene almeno una chiave:

```
teams/t3/sessions/
  -NxAbc123: true   ← dispositivo 1 (es. telefono)
  -NxDef456: true   ← dispositivo 2 (es. PC), collegato in parallelo
```

Questo schema — non un semplice booleano `connected: true/false` — è la base tecnica di tutta la gestione multi-dispositivo (vedi §5).

### `/bids` e `/bidSubmitted`

Durante un turno, ogni squadra scrive il proprio importo (o 0 se passa) sotto `/bids/{teamId}` e imposta `/bidSubmitted/{teamId} = true`. Questi due percorsi vengono azzerati (`null`) ad ogni nuovo turno. La separazione tra "ha inviato" e "importo" permette a tutti i client di sapere *chi* ha già risposto (per mostrare gli indicatori sul tavolo) senza dover leggere gli importi — che restano comunque protetti dalle stesse regole di sicurezza, ma la UI dei client evita semplicemente di mostrarli prima della fase di rivelazione, per rispettare la segretezza della busta chiusa.

### L'elenco giocatori (`data/players.json`)

L'elenco dei giocatori acquistabili **non vive su Firebase**: è un file JSON statico nel repository, caricato dal client via `fetch()` all'avvio dell'app. Contiene 539 giocatori (nome, squadra di Serie A, ruolo, quotazioni), usato per popolare la ricerca del Presidente. La schermata di login mostra il testo "663 giocatori", un valore probabilmente riferito a una versione precedente o più ampia del dataset — il file attualmente pubblicato ne contiene 539; è una piccola incongruenza esistente nel prodotto, segnalata qui per completezza.

## 4. Componenti del sistema

### 4.1 `index.html` — applicazione principale

È il cuore del sistema: contiene sia la schermata di login sia tutta l'interfaccia operativa (partecipante e Presidente), sia tutta la logica applicativa in JavaScript. Le sezioni principali del codice:

- **Stato locale e sincronizzazione**: variabili globali (`gameState`, `teamsState`, `bidsState`, `bidSubmittedState`, `assignmentsState`) mantenute sempre allineate ai rispettivi percorsi Firebase tramite listener `on('value', ...)`.
- **Rendering**: funzioni che, ad ogni cambiamento di stato, aggiornano il DOM (es. `handleGameStateChange()`, `renderPresidentAuction()`, `renderRevealOverlay()`) — non c'è un framework a componenti, ogni funzione sa quali elementi HTML toccare.
- **Logica di gioco**: funzioni che scrivono su Firebase in risposta ad azioni utente (`submitBid()`, `passAuction()`, `adminStartAuction()`, `adminReveal()`, `adminAssign()`) o a eventi automatici (`checkAutoReveal()`, `autoProcessReveal()`, `checkDisconnectionPause()`).
- **Presenza e disconnessioni**: `registerPresenceSession()`, `removePresenceSession()`, `isTeamOnline()`, `checkDisconnectionPause()` — vedi §5 per il dettaglio.
- **Impersonificazione (solo Barça)**: un piccolo strumento di supporto pensato per facilitare i test manuali con più squadre, che permette alla squadra Barça di "vestire i panni" di qualsiasi altra squadra senza doversi disconnettere e rifare il login — utile a chi verifica il comportamento dell'app da un solo dispositivo. Non è pensato per l'uso operativo durante un'asta reale.

### 4.2 `live.html` — dashboard pubblica

Pagina indipendente, senza autenticazione applicativa (solo il sign-in anonimo Firebase richiesto dalle regole del database), pensata per essere condivisa o proiettata durante l'asta. Mostra lo stato delle squadre, il giocatore in asta con timer, gli importi delle offerte (senza restrizioni di segretezza, essendo una vista informativa e non operativa), lo storico acquisti e alcune statistiche aggregate. Si collega agli stessi percorsi Firebase di `index.html` in sola lettura.

### 4.3 `dashboard.html` — dashboard amministrativa

Graficamente simile a `live.html`, ma protetta da una password amministrativa e con una differenza funzionale importante: **nasconde gli importi delle offerte durante il bidding** (mostra solo "Inviata / In attesa" per squadra), rivelandoli solo dopo la fase di rivelazione — coerente con la regola di segretezza della busta chiusa. Pensata come "secondo schermo" di controllo per il Presidente, complementare al pannello dentro `index.html`.

### 4.4 App Android (`android/`)

Non è una Trusted Web Activity (il file `twa-manifest.json` presente nel repository è un residuo di un tentativo precedente, abbandonato): è una **WebView nativa** scritta in Java. `MainActivity` carica sempre l'URL di produzione (`https://darioschioppi.github.io/fantacaserma/`), con cache disabilitata e pulizia forzata ad ogni avvio, in modo che l'app mostri sempre l'ultima versione pubblicata — non ci sono asset web incorporati nell'APK. Compilata e firmata automaticamente da CI ad ogni push (vedi §6).

### 4.5 Service Worker (`sw.js`) e PWA

Implementa una strategia di caching a due livelli:
- **Network-first per l'HTML**: ad ogni caricamento tenta prima la rete (per avere sempre l'ultima versione), e usa la cache solo come fallback se offline.
- **Cache-first per asset statici** (icone, manifest): risponde dalla cache se presente, aggiornandola in background.
- **Non intercetta mai le richieste verso Firebase** o altri domini esterni: solo le richieste verso lo stesso hostname dell'app passano dalla cache.

Questo combina "l'app si aggiorna sempre" (requisito esplicito) con la possibilità di apparire più velocemente e funzionare parzialmente offline per gli asset non critici.

### 4.6 File non più in uso (mantenuti per riferimento storico)

- `server.js` — il backend Node.js/Express + Socket.io della primissima versione del progetto. Conserva la logica originale (stato in memoria, eventi socket per login/offerte/reveal) ma **non viene eseguito in produzione**: l'hosting attuale è statico (GitHub Pages), quindi questo file non ha alcun effetto sul funzionamento reale dell'app.
- `public/index.html` — la vecchia interfaccia collegata a `server.js`.
- `render.yaml` — configurazione per un deploy su Render.com del vecchio server, mai attivata nell'architettura attuale.
- `twa-manifest.json` — configurazione generata da Bubblewrap per un wrapper Android "Trusted Web Activity", sostituito dalla WebView nativa.

## 5. Decisione di design: gestione delle disconnessioni e multi-dispositivo

Questa è la parte più delicata del sistema e merita una spiegazione a parte, perché nasce da un requisito esplicito e da diverse iterazioni.

### Perché una sessione per dispositivo, e non un booleano

Un semplice campo `connected: true/false` per squadra non basta a rappresentare correttamente "la stessa squadra collegata da due telefoni": se il primo telefono si disconnette, quel booleano andrebbe messo a `false`, anche se il secondo telefono è ancora perfettamente online. La soluzione adottata è che **ogni dispositivo/tab registra una propria voce indipendente** sotto `sessions`, con rimozione automatica gestita da Firebase stesso quando la connessione WebSocket di quel dispositivo cade (`onDisconnect().remove()`). La squadra è online se quell'insieme non è vuoto:

```js
function isTeamOnline(teamId) {
  const sessions = (teamsState[teamId] || {}).sessions;
  return !!(sessions && Object.keys(sessions).length > 0);
}
```

Questo risolve automaticamente tutti i casi multi-dispositivo (accesso simultaneo, cambio dispositivo, logout da un dispositivo mentre un altro resta attivo) senza bisogno di logica speciale: è una diretta conseguenza dello schema dati.

### Perché il blocco è totale e non "solo per la squadra disconnessa"

Una prima ipotesi di design prevedeva che, in caso di disconnessione di una squadra, solo quella specifica squadra venisse bloccata mentre le altre continuavano a offrire normalmente. Questa impostazione è stata **esplicitamente scartata** a favore del blocco totale: se una qualsiasi delle 10 squadre è offline, l'intera asta si sospende per tutti, perché altrimenti si rischierebbe che l'asta di un giocatore si concluda mentre una squadra interessata non ha potuto partecipare per un problema tecnico non suo. Questa scelta è stata confermata esplicitamente dal cliente dopo una domanda di chiarimento diretta, ed è la base di tutti gli scenari di test relativi.

### Perché la sospensione/ripresa gira su ogni client, non solo sul Presidente

Il Presidente ha i permessi di scrittura su `/game` per le azioni manuali (avvio, pausa, fine asta), ma la funzione che rileva le disconnessioni e decide sospensione/ripresa (`checkDisconnectionPause()`) **gira su ogni client connesso**, non solo su quello del Presidente. Se questa logica dipendesse esclusivamente dal dispositivo di Benfiga, e quel dispositivo non fosse aperto nell'esatto momento in cui l'ultima squadra si riconnette, l'asta resterebbe bloccata per sempre nonostante la situazione di rete fosse già del tutto risolta. Le regole di sicurezza del database permettono la scrittura su `/game` a qualunque utente autenticato (anche anonimamente), quindi non serve un ruolo speciale per eseguire questa parte della logica — e la scrittura di ripresa è comunque idempotente (non ha effetto se qualcun altro l'ha già eseguita un istante prima).

### Come si evitano le scritture duplicate tra client concorrenti

Se più client rilevano la stessa disconnessione nello stesso istante (uno per ogni squadra ancora online), rischierebbero di scrivere tutti insieme lo stesso cambiamento di stato, producendo righe di log duplicate o sovrascritture parziali. La soluzione è una **transazione Firebase** (`transaction()`) sul nodo `/game`: solo il primo client che la esegue trova ancora lo stato "attivo" (bidding/tiebreaker) e applica il cambiamento; tutti gli altri, eseguendo la transazione un istante dopo, trovano già lo stato "sospeso" e abortiscono senza scrivere nulla.

### Perché un debounce di qualche secondo prima di sospendere

Una disconnessione istantanea (es. un brevissimo sfarfallio di rete) non deve mettere in pausa l'intera asta per un problema che si risolve da solo in una frazione di secondo. Prima di dichiarare una squadra effettivamente offline, il sistema attende una breve finestra di tolleranza (alcuni secondi); se la squadra si riconnette prima che questa finestra scada, non succede nulla di visibile agli altri partecipanti.

## 6. CI/CD

Tre workflow GitHub Actions automatizzano il ciclo di vita del progetto:

1. **Test end-to-end** (`ci.yml`) — ad ogni push o pull request su `main`, esegue l'intera suite di test Playwright contro l'ambiente reale (GitHub Pages + Firebase), su Chrome desktop.
2. **Build e release Android** (`build-android.yml`) — ad ogni push che toccail frontend o il progetto Android, compila e firma un nuovo APK con Gradle, lo pubblica come allegato di una GitHub Release fissa (tag `latest`) — lo stesso link di download indicato nel README non cambia mai, punta sempre all'ultima build.
3. **Deploy regole database** (`deploy-firebase-rules.yml`) — ad ogni modifica del file delle regole di sicurezza Firebase, le pubblica automaticamente sul progetto in produzione.

Non esiste un workflow dedicato al deploy del sito web: GitHub Pages serve direttamente i file dalla configurazione del repository, quindi ogni push su `main` è già di per sé una pubblicazione immediata.

## 7. Sicurezza (stato attuale e limiti noti)

- L'autenticazione applicativa (nome squadra + password) è un controllo lato client, non enforced dalle regole del database: chiunque conosca l'endpoint Firebase e abbia un token di sign-in anonimo (ottenibile da chiunque visiti l'app) potrebbe in teoria leggere/scrivere qualunque percorso. Le regole attuali (`auth != null`) verificano solo che l'utente sia autenticato in qualche modo, non che abbia i permessi corretti per quella specifica squadra o azione.
- Questo è un compromesso accettato per un progetto a uso privato tra persone conosciute, non una piattaforma pubblica: non sono previste al momento regole di validazione granulari per squadra/ruolo.
- La password della dashboard amministrativa (`dashboard.html`) è scritta in chiaro nel codice JavaScript lato client — visibile a chiunque ispezioni il codice della pagina.
