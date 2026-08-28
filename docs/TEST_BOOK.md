# Test Book — FantaCaserma

Questo documento descrive **cosa viene verificato automaticamente** dai test del progetto e come, organizzato per area funzionale. I test sono scritti con [Playwright](https://playwright.dev/) e vivono in `tests/e2e/`; vengono eseguiti automaticamente ad ogni push/pull request su `main` tramite GitHub Actions (`.github/workflows/ci.yml`), e possono anche essere eseguiti manualmente in locale.

**Nota importante**: quasi tutti i test scrivono realmente sul database Firebase di produzione (lo stesso usato durante le aste vere), inserendo dati fittizi che vengono puliti automaticamente a fine test. Per questo motivo la convenzione del progetto è **non eseguire la suite mentre è in corso un'asta reale** — i test verificano sempre lo stato del gioco prima di partire e ripristinano `phase: 'waiting'` al termine.

## 1. Come sono organizzati

| File | Area | Test |
|---|---|---|
| `01-login.spec.js` | Accesso | 14 |
| `02-participant.spec.js` | Schermata partecipante | 21 |
| `03-bid-ui.spec.js` | Interfaccia di offerta | 18 |
| `04-responsive.spec.js` | Responsive/mobile | 13 |
| `05-admin.spec.js` | Presidente — accesso e pannelli | 5 |
| `06-accessibility.spec.js` | Accessibilità e qualità UI | 10 |
| `07-president-features.spec.js` | Funzionalità Presidente (timer, pausa, assegnazioni) | 42 |
| `08-auction-simulation.spec.js` | Simulazione asta multi-giocatore | 16 |
| `09-impersonation.spec.js` | Impersonificazione squadre (solo Barça) | 6 |
| `10-plan-feature.spec.js` | Pianificazione budget | 6 |
| `13-full-table-simulation.spec.js` | Tavolo completo, 10 squadre reali | 2 |
| `14-uat-benfiga-timer.spec.js` | UAT: timer non anticipato dall'offerta del Presidente | 1 |
| `15-uat-disconnessione-ac.spec.js` | UAT disconnessioni — casi base (AC01–AC12) | 10 (+3 parametrizzati) |
| `16-uat-completo-disconnessioni.spec.js` | UAT disconnessioni — casi avanzati + matrice cardinalità | 11 (+4 parametrizzati) |
| `17-uat-multidevice.spec.js` | UAT multi-dispositivo | 20 |

Totale: 195 verifiche automatiche, distribuite su 15 file (la numerazione dei file arriva a 17, ma i numeri 11 e 12 non sono mai stati usati).

## 2. Test per area funzionale

### 2.1 Accesso e schermata iniziale

Verifica che la schermata di login mostri correttamente l'elenco delle 10 squadre, che il campo password funzioni, che le credenziali sbagliate vengano rifiutate con un messaggio chiaro, e che l'accesso corretto porti alla schermata operativa giusta (partecipante o Presidente in base alla squadra).

### 2.2 Schermata partecipante

Copre il layout generale dopo il login: intestazione con nome squadra e budget, tavolo virtuale con le sedute delle 10 squadre, barra di navigazione mobile, comportamento del logout. Verifica anche che gli elementi corretti siano visibili/nascosti in base allo stato dell'asta (in attesa, in corso, ecc.).

### 2.3 Interfaccia di offerta

Verifica i controlli con cui una squadra invia un'offerta: stepper +/-, campo numerico, etichette di budget e slot disponibili per ruolo, comportamento a busta chiusa (l'offerta inviata non è visibile alle altre squadre). Include verifiche specifiche su modifiche di interfaccia richieste nel tempo: rimozione dei vecchi pulsanti di offerta rapida (+1/+5/+10/+25), testo dei pulsanti "OFFERTA"/"PASSA" senza emoji e in maiuscolo.

### 2.4 Responsive e mobile

Verifica che l'interfaccia resti utilizzabile su schermi piccoli: la barra di navigazione mobile compare solo sotto una certa larghezza, l'area di offerta si adatta alla larghezza disponibile, elementi secondari (come la card giocatore nel tavolo) si comportano correttamente nel passaggio da desktop a mobile.

### 2.5 Presidente — accesso e funzionalità

Il Presidente (Benfiga) accede con le stesse credenziali di una squadra normale, ma vede pannelli aggiuntivi. I test verificano:
- La presenza dei tab esclusivi (scelta giocatore, rose di tutte le squadre, storico, assegnazioni manuali) solo per questa squadra.
- Lo stepper per la durata del timer d'asta (10–120 secondi) e per la durata della schermata di rivelazione.
- I pulsanti Pausa/Riprendi/Termina asta, incluso il comportamento di ripresa con il tempo residuo corretto (non ripartire da zero).
- La gestione delle assegnazioni: rimozione, riassegnazione a un'altra squadra con prezzo diverso, assegnazione manuale di un giocatore libero.
- Che un'offerta inserita dal Presidente non chiuda l'asta prima dello scadere naturale del timer, anche se momentaneamente è l'unica squadra online (bug reale corretto e da allora sempre verificato: `14-uat-benfiga-timer.spec.js`).

### 2.6 Simulazione asta completa

Due livelli di realismo:
- `08-auction-simulation.spec.js`: simula un'asta con più squadre usando in parte chiamate dirette a Firebase (per velocità), verificando l'intero ciclo — avvio, offerte, rivelazione, spareggio, assegnazione.
- `13-full-table-simulation.spec.js`: apre **tutte le 10 squadre come vere pagine browser con login reale**, il test più fedele a una sessione d'asta con tutti i partecipanti collegati, incluso un turno con vincitore netto e un turno con parità che genera spareggio.

### 2.7 Impersonificazione (solo Barça)

Una funzionalità di supporto ai test manuali: la squadra Barça può "impersonare" temporaneamente qualsiasi altra squadra per verificarne il comportamento senza dover rifare il login. I test verificano che i permessi e la visualizzazione seguano correttamente la squadra impersonata, e che si possa sempre tornare alla propria identità originale.

### 2.8 Pianificazione budget

Verifica che ogni squadra possa impostare un importo pianificato per un giocatore specifico, che questo valore sia privato per squadra (non condiviso con le altre), e che venga usato per precompilare automaticamente il campo offerta quando l'asta di quel giocatore parte davvero.

### 2.9 Accessibilità e qualità

Controlli di base ma importanti: titolo pagina corretto, meta viewport presente (per il rendering mobile), assenza di errori bloccanti in console, stabilità visiva generale.

## 3. UAT — Gestione delle disconnessioni

Questa è l'area più estesa e più importante della suite, perché copre il requisito più delicato del sistema (si veda [REQUISITI §2.3](REQUISITI.md#23-gestione-delle-disconnessioni--requisito-critico) e [SOLUTION_DESIGN §5](SOLUTION_DESIGN.md#5-decisione-di-design-gestione-delle-disconnessioni-e-multi-dispositivo)). Nasce da due documenti UAT (User Acceptance Test) forniti direttamente dal cliente durante lo sviluppo, poi tradotti in test automatici.

### 3.1 Comportamento confermato: blocco totale, non solo della squadra disconnessa

Il documento UAT originale ipotizzava che, alla disconnessione di una squadra, solo quella specifica restasse bloccata mentre le altre continuavano a offrire. Dopo una domanda di chiarimento diretta, il cliente ha confermato che il comportamento corretto è invece il **blocco totale**: se anche una sola squadra si disconnette, l'intera asta si sospende per tutti. I test in `15-uat-disconnessione-ac.spec.js` sono scritti e commentati esplicitamente per riflettere questa deviazione dal testo letterale del documento originale, verificando il comportamento realmente confermato.

### 3.2 Casi base (file `15-uat-disconnessione-ac.spec.js`, AC01–AC12)

- Disconnessione di una squadra che non ha ancora offerto → l'asta si blocca per tutti, non solo per lei.
- Disconnessione della squadra con l'offerta più alta → l'offerta resta registrata e valida, non viene annullata dalla disconnessione.
- Disconnessione prima di inviare un'offerta, con ripresa automatica alla riconnessione (nessun timeout previsto per design: la sospensione dura fino a quando serve, senza limite massimo).
- Disconnessione durante la digitazione, prima della conferma → l'offerta non confermata non esiste, correttamente, su Firebase.
- Disconnessione immediatamente dopo l'invio di un'offerta → l'offerta registrata resta valida.
- Ripetizione dello stesso scenario per ciascuna delle 10 squadre singolarmente, per verificare che il comportamento non dipenda da quale squadra si disconnette.
- Riconnessione: la squadra torna visibile come online e riceve lo stato corrente dell'asta (giocatore, timer), non uno stato vecchio.
- Disconnessioni multiple in sequenza, con un test **parametrizzato** su combinazioni di 2, 3 e 4 squadre disconnesse contemporaneamente, verificando sia lo stato interno sia il testo del banner mostrato all'utente (nato da un bug reale: il banner mostrava solo la prima squadra disconnessa anche quando ne erano offline diverse).
- Caso limite: anche l'ultima squadra rimasta connessa si disconnette — il sistema non deve andare in crash né in uno stato incoerente.

### 3.3 Casi avanzati e matrice di cardinalità (file `16-uat-completo-disconnessioni.spec.js`)

Completa la copertura richiesta dal documento UAT con gli scenari non ancora testati:

- Riconnessione di più squadre in un ordine non prevedibile (non nell'ordine in cui si erano disconnesse).
- Una nuova disconnessione che avviene mentre l'asta è già sospesa per un'altra squadra — lo stato resta determinato dall'insieme di tutte le squadre offline, non dalla prima rilevata.
- Una squadra che si disconnette e riconnette ripetutamente in rapida sequenza ("flapping"): nessuna doppia ripresa, nessun reset del timer, nessuna offerta persa.
- Il timer, durante la sospensione, resta congelato al valore esatto che aveva al momento della pausa — verificato numericamente, non solo "si è fermato genericamente".
- Un tentativo di offerta durante la sospensione viene rifiutato e non registrato su Firebase.
- Anche molto oltre la scadenza teorica del timer, nessuna assegnazione avviene mentre l'asta è sospesa.
- Una disconnessione che avviene esattamente mentre l'asta sta riprendendo (race condition tra pausa e ripresa) non produce stati incoerenti.
- Una sequenza casuale e non deterministica di disconnessioni/riconnessioni (basata su un esempio concreto fornito nel documento originale) verificata passo per passo: l'asta è attiva se e solo se tutte le squadre sono online in quell'istante.
- **Matrice di cardinalità**: lo stesso comportamento (sospensione, nessuna ripresa parziale) verificato esplicitamente per 5, 6, 7, 8, 9 e 10 squadre disconnesse contemporaneamente — le cardinalità più piccole (1–4) sono già coperte dai test del punto 3.2.

## 4. UAT — Multi-dispositivo

File `17-uat-multidevice.spec.js`, basato su un secondo documento UAT dedicato interamente allo scenario "la stessa squadra collegata da più dispositivi contemporaneamente" (iOS, Android, PC).

**Regola fondamentale verificata**: una squadra è connessa se almeno uno dei suoi dispositivi è online; è disconnessa solo quando tutti i dispositivi cadono insieme. Nessuna modifica al codice applicativo è stata necessaria per questa suite: il sistema di presenza già esistente implementava esattamente questa regola, e i test lo dimostrano empiricamente.

Scenari verificati:

- Una squadra con un solo dispositivo: la sua disconnessione sospende l'asta (comportamento base).
- Squadre con due dispositivi in tutte le combinazioni rilevanti (es. telefono+PC): la perdita di uno solo dei due non sospende nulla; solo la perdita di entrambi lo fa.
- Una squadra con tre dispositivi: l'asta resta attiva finché resta anche un solo dispositivo online, si sospende solo a zero dispositivi.
- Riconnessione con un dispositivo qualsiasi (non necessariamente quello che si era disconnesso) è sufficiente a far tornare online la squadra.
- La riconnessione di una squadra non basta a far riprendere l'asta se un'altra squadra è ancora completamente offline.
- Disconnessione simultanea di entrambi i dispositivi di una squadra multi-device.
- Disconnessione e riconnessione molto rapide (entro un secondo): assorbite dalla finestra di tolleranza, senza generare sospensioni per un problema di rete trascurabile.
- Cambio di dispositivo durante l'asta (si apre un nuovo dispositivo, poi si chiude il vecchio): nessuna interruzione percepita.
- Tre browser reali collegati contemporaneamente come la stessa identità squadra: il sistema non crea tre squadre né conta tre partecipanti distinti, e un'offerta inviata da uno si sincronizza correttamente sugli altri.
- Un'offerta valida piazzata da un dispositivo resta valida anche se quel dispositivo si disconnette subito dopo (che l'altro dispositivo della stessa squadra resti connesso o non conta: l'offerta è della squadra, non del dispositivo).
- Scenari con più squadre multi-dispositivo contemporaneamente, incluso un adattamento diretto della configurazione a 10 squadre descritta nel documento originale.
- Logout esplicito da un dispositivo (tramite la funzione reale di logout dell'app, non solo chiusura della pagina): se resta un altro dispositivo attivo la squadra rimane connessa; se era l'unico, la squadra passa a disconnessa e l'asta si sospende.
- Un client che si riconnette con uno stato locale completamente vuoto (nessuna cache) riceve comunque lo stato aggiornato e corretto dell'asta, incluse eventuali offerte piazzate da altre squadre nel frattempo — non uno stato "vecchio" rimasto in memoria.

Non testati con automazione (richiederebbero hardware/condizioni di rete reali non riproducibili in modo significativo in un test automatico): passaggio da Wi-Fi a rete mobile, perdita di rete fisica temporanea. Questi scenari, presenti nel documento UAT originale, sono da verificare manualmente su dispositivo reale se necessario.

## 5. Come eseguire i test

```bash
npm ci                      # installa le dipendenze
npx playwright install      # installa i browser necessari (solo la prima volta)
npx playwright test         # esegue tutta la suite
npx playwright test tests/e2e/17-uat-multidevice.spec.js   # esegue solo un file
```

I test sono configurati (`playwright.config.js`) per girare principalmente su Desktop Chrome; molti file relativi a scenari con disconnessioni multiple saltano esplicitamente il progetto "Mobile Chrome" per evitare race condition da login multipli in parallelo, non essendo quell'aspetto specifico dell'emulazione mobile rilevante per la logica testata.

**Prima di lanciare la suite**, verificare che non sia in corso un'asta reale (controllare lo stato di `/game` su Firebase) — i test scrivono e cancellano dati sullo stesso database usato in produzione.
