# Requisiti — FantaCaserma

Questo documento raccoglie, in linguaggio non tecnico, **cosa deve fare** il software e **perché**. Non descrive *come* è costruito (per quello vedi il [Solution Design](SOLUTION_DESIGN.md)), ma le esigenze reali che hanno portato alle scelte fatte.

## 1. Contesto

FantaCaserma serve a gestire l'asta del fantacalcio di una lega privata di 10 squadre fisse ("la Caserma": Barça, Benfiga, Frattese1985, Morpheus, Paris San Giuann, REAL, Sharktar, SoxTeam, Vincan, giomammo), condotta **live** durante una sessione in cui tutti i partecipanti sono collegati contemporaneamente, ciascuno dal proprio telefono o computer. Una squadra — Benfiga — ha il ruolo di presidente/banditore: sceglie i giocatori da mettere all'asta e supervisiona l'andamento generale, ma non ha vantaggi di visibilità sulle offerte altrui durante il bidding.

L'asta è **a busta chiusa** (sealed bid): ogni squadra invia il proprio importo senza vedere quello degli altri finché il tempo non scade. Questo è il vincolo di equità più importante del sistema ed è alla base di molte scelte tecniche successive (es. perché la dashboard admin nasconde gli importi durante il bidding).

## 2. Requisiti funzionali

### 2.1 Identità e accesso

- Ogni squadra accede con un nome squadra e una password condivisa; non è richiesta una registrazione formale.
- Una squadra può essere collegata da **più dispositivi contemporaneamente** (es. due persone della stessa squadra, una da telefono e una da PC, oppure la stessa persona che cambia dispositivo a metà sessione). Il sistema deve trattarla sempre come *una* squadra, non come partecipanti distinti, e le sue offerte/il suo stato di connessione devono essere coerenti su tutti i dispositivi.
- Benfiga (una delle 10 squadre) ha in più i permessi di gestione dell'asta: scegliere il giocatore, avviare/pausare/terminare, gestire timer e assegnazioni. Non ha un login separato: si autentica come squadra normale e i permessi extra sono legati alla sua identità.

### 2.2 Svolgimento dell'asta

- Il presidente scieglie un giocatore da una lista ufficiale (con ruolo, squadra di Serie A, quotazione) e avvia l'asta impostando una durata (tra 10 e 120 secondi).
- Ogni squadra ha la finestra di tempo per inserire un'offerta o passare. Le offerte sono nascoste alle altre squadre finché il tempo non scade — nessuna squadra deve poter vedere quanto hanno offerto le altre prima della rivelazione, incluso il presidente.
- Alla scadenza (o quando tutte le squadre hanno risposto, se accade prima), le offerte si rivelano tutte insieme: vince chi ha offerto di più.
- In caso di parità tra due o più squadre, si passa a un turno di spareggio automatico tra le sole squadre in parità: rilanciano allo stesso importo o più alto. Se nessuna rilancia, vince chi tra le pari aveva offerto per primo nel turno precedente.
- Se nessuna squadra offre per un giocatore, questo viene semplicemente saltato (nessuna assegnazione), non assegnato a un prezzo simbolico.
- Il prezzo base di partenza per qualunque giocatore è 1 credito, non 0.
- Ogni squadra parte con un budget di **500 crediti** e un numero massimo di giocatori acquistabili per ruolo: **3 portieri, 8 difensori, 8 centrocampisti, 6 attaccanti** (25 giocatori in totale a rosa completa). Una squadra che ha già raggiunto il tetto per un ruolo non deve poter fare offerte per quel ruolo — anzi, l'app deve evitarle anche di doversi preoccupare di passare manualmente: se la sua rosa in quel ruolo è già piena, viene esclusa automaticamente dal turno, senza dover interagire con controlli inutili.
- Una squadra può pianificare in anticipo un importo per un giocatore specifico che le interessa: quando l'asta di quel giocatore si apre, l'importo pianificato precompila il proprio campo offerta (resta comunque modificabile).

### 2.3 Gestione delle disconnessioni — requisito critico

Questo è stato il requisito più delicato del progetto, formalizzato in due documenti UAT dedicati durante lo sviluppo (si veda il [Test Book](TEST_BOOK.md) per il dettaglio dei casi verificati).

- **Una squadra è considerata "connessa" se almeno uno dei suoi dispositivi collegati è online.** È "disconnessa" solo quando *tutti* i suoi dispositivi cadono contemporaneamente. Un singolo telefono che perde la connessione non deve mai far apparire la squadra come disconnessa se ha anche un PC collegato.
- **Se anche una sola delle 10 squadre risulta completamente disconnessa** durante un'asta in corso (fase di offerta o di spareggio), **l'intera asta si sospende per tutte le squadre**, non solo per quella disconnessa. Nessuna offerta è più accettata da nessuno, il conto alla rovescia si ferma.
- Durante la sospensione: il giocatore in asta non cambia, l'offerta eventualmente già inviata da qualcuno resta valida e non viene persa, nessuna assegnazione automatica può avvenire.
- L'asta riprende **automaticamente**, senza bisogno che il presidente faccia nulla, esclusivamente nel momento in cui *tutte* le 10 squadre sono di nuovo connesse (anche una sola ancora offline impedisce la ripresa). Alla ripresa, il tempo rimanente riparte da dove si era fermato, non dall'inizio.
- Questa regola vale indipendentemente da quale squadra si disconnette (anche il presidente stesso, se la sua connessione cade), da quante squadre si disconnettono contemporaneamente, dall'ordine con cui si disconnettono/riconnettono, e anche se succede più volte di seguito (una squadra che si disconnette e riconnette ripetutamente non deve causare doppie riprese, timer resettati o offerte perse).
- Se il presidente ricarica la pagina o non ha l'app aperta nel momento esatto in cui tutte le squadre tornano online, la ripresa deve comunque avvenire — non deve dipendere dal fatto che uno specifico dispositivo sia acceso in quel momento.

### 2.4 Trasparenza e coerenza

- Ogni operazione amministrativa (avvio asta, assegnazione, rimozione, riassegnazione, reset stagione) deve essere registrata in un log consultabile, con dettagli su cosa è cambiato.
- Tutte le squadre devono vedere sempre lo stesso stato dell'asta (stesso giocatore, stesso timer, stesso esito) indipendentemente dal dispositivo o dal momento in cui si collegano — anche una squadra che si riconnette dopo essere stata offline per un po' deve ricevere lo stato reale e aggiornato, non una versione vecchia rimasta in memoria sul proprio dispositivo.
- Il presidente deve poter correggere errori: rimuovere un'assegnazione, riassegnarla a un'altra squadra con un prezzo diverso, assegnare manualmente un giocatore rimasto libero.
- In caso di errore grave o necessità di ripartire da zero, deve esistere un'azione di reset completo della stagione (cancella tutte le assegnazioni, ripristina i budget, azzera il log) — riservata solo al presidente, ed esplicitamente segnalata come irreversibile.

### 2.5 Accessibilità multipiattaforma

- L'app deve funzionare da browser web, come app installabile su iPhone/iPad (senza passare da un negozio applicazioni) e come app Android installabile direttamente (senza passare dal Play Store).
- Deve aggiornarsi automaticamente a ogni modifica: chi usa la versione web/PWA non deve fare nulla, e anche l'app Android deve scaricare sempre l'ultima versione del contenuto ad ogni apertura.
- Deve restare leggibile e usabile sia su schermi di telefono piccoli sia su desktop, con particolare attenzione a non far sparire pulsanti importanti (es. "Passa") fuori dallo schermo su dispositivi con poco spazio verticale.

### 2.6 Esportazione e reportistica

- Le rose di tutte le squadre (giocatori acquistati, prezzo, budget residuo) devono poter essere esportate in un file Excel con un solo click, funzionante sia da desktop che da smartphone Android (dove il salvataggio file richiede un percorso diverso da quello desktop per funzionare in modo affidabile).
- Deve esistere una vista di consultazione, separata dal pannello operativo, che mostri lo stato generale dell'asta (chi è connesso, budget, storico) sia in forma pubblica (per essere condivisa/proiettata) sia in forma riservata al presidente.

## 3. Requisiti non funzionali

- **Tempo reale**: ogni cambiamento di stato (offerta, connessione, avvio asta) deve propagarsi a tutti i dispositivi collegati in pochi secondi, senza bisogno di ricaricare la pagina.
- **Resilienza alle interruzioni di rete**: connessioni instabili, passaggi da Wi-Fi a rete mobile, app in background sul telefono, chiusura e riapertura del browser, non devono corrompere lo stato dell'asta né causare comportamenti incoerenti tra dispositivi.
- **Nessuna perdita di dati economici**: un budget scalato o un'offerta registrata non deve mai sparire per un problema tecnico (disconnessione, race condition tra più client che scrivono nello stesso momento).
- **Equità**: nessun meccanismo tecnico deve permettere a una squadra (incluso il presidente) di vedere le offerte altrui prima della rivelazione.
- **Semplicità d'uso**: nessuna registrazione, nessuna installazione obbligatoria di app esterne per usare la versione web; il flusso di login deve essere immediato (nome squadra + password condivisa).

## 4. Fuori perimetro (esplicitamente non richiesto)

- Non è richiesta un'architettura multi-lega: il sistema è pensato per una singola lega di 10 squadre fisse, con nomi e regole di rosa hardcoded.
- Non è richiesto un sistema di pagamento reale: i "crediti" sono un budget virtuale interno al gioco.
- Non è richiesta una gestione granulare dei permessi oltre alla distinzione "squadra normale" / "presidente": non ci sono ruoli intermedi.
