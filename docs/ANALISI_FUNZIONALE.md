# Analisi Funzionale — FantaCaserma

Questo documento descrive **chi usa l'app e come**, passo per passo, per ciascun scenario significativo. È il ponte tra i [Requisiti](REQUISITI.md) (cosa e perché) e il [Solution Design](SOLUTION_DESIGN.md) (come è costruito tecnicamente).

## 1. Attori

| Attore | Descrizione |
|---|---|
| **Squadra partecipante** | Una delle 10 squadre della lega. Accede con nome squadra + password condivisa. Può offrire durante le aste, consultare la propria rosa, gli acquisti recenti, pianificare importi futuri. |
| **Presidente (Benfiga)** | Una squadra speciale con permessi aggiuntivi di gestione dell'asta: sceglie i giocatori, avvia/pausa/termina le aste, corregge assegnazioni, vede le rose di tutte le squadre, può fare reset stagione. È anche una squadra partecipante normale ai fini delle proprie offerte. |
| **Spettatore** | Chiunque abbia il link della dashboard pubblica live, senza bisogno di credenziali. Vede lo stato generale dell'asta ma non può interagire. |
| **Dispositivo** | Non è un attore umano, ma un concetto ricorrente: la stessa squadra può avere più dispositivi collegati insieme (telefono, PC, un secondo telefono). Il sistema traccia ogni dispositivo separatamente ma li aggrega sempre a livello di squadra. |

## 2. Casi d'uso principali

### UC1 — Accesso all'app

**Attore**: Squadra partecipante (incluso il Presidente)

1. L'utente apre l'app (web, PWA installata, o app Android) e vede la schermata di login.
2. Seleziona la propria squadra da un elenco a discesa e inserisce la password condivisa.
3. Se le credenziali sono corrette, entra nella schermata operativa della propria squadra.
4. Se aveva già una sessione attiva salvata (es. ha chiuso e riaperto l'app di recente), rientra automaticamente senza dover ripetere il login.
5. Se è il Presidente, oltre ai pannelli comuni vede tab aggiuntive per la gestione dell'asta (scelta giocatore, rose di tutte le squadre, storico, assegnazioni manuali).

Una stessa squadra può ripetere questo caso d'uso da più dispositivi in parallelo: ogni dispositivo registra una propria "sessione" indipendente, ma tutte contano come la stessa squadra collegata (vedi UC6).

### UC2 — Avvio e svolgimento di un'asta (visione Presidente)

**Attore**: Presidente

1. Il Presidente cerca un giocatore nell'elenco ufficiale (filtrabile per ruolo, ordinabile per quotazione), tra quelli non ancora assegnati.
2. Sceglie un tempo per il turno (o usa quello già impostato) e avvia l'asta.
3. Da questo momento, tutte le squadre vedono lo stesso giocatore comparire con lo stesso conto alla rovescia.
4. Il Presidente osserva chi ha già inviato un'offerta (senza vederne l'importo) tramite indicatori sul tavolo virtuale.
5. Se tutte le squadre hanno risposto prima dello scadere del tempo, la rivelazione avviene subito; altrimenti attende la scadenza.
6. Alla rivelazione, il sistema mostra tutti gli importi e determina il vincitore (o apre uno spareggio, vedi UC4).
7. Il giocatore vinto viene assegnato automaticamente: budget scalato, rosa aggiornata, evento registrato nello storico.
8. Il Presidente passa al giocatore successivo ripetendo il ciclo, oppure lo salta se nessuno ha offerto.

### UC3 — Invio di un'offerta (visione Squadra)

**Attore**: Squadra partecipante

1. Quando un'asta è in corso, la squadra vede il nome del giocatore, il proprio budget residuo, gli slot ancora liberi per quel ruolo, e un conto alla rovescia.
2. Se la propria rosa è già completa per quel ruolo, la squadra non vede nemmeno i controlli di offerta: viene automaticamente considerata come "passata" e vede solo un messaggio informativo (vedi anche REQUISITI §2.2).
3. Altrimenti, inserisce un importo (minimo 1 credito, o l'importo minimo di rilancio se in spareggio) usando uno stepper o digitandolo, e conferma con "Offerta".
4. In alternativa può scegliere "Passa" per non partecipare a quel giro (equivale a un'offerta di 0).
5. Una volta inviata, l'offerta resta nascosta a tutte le altre squadre — la propria interfaccia mostra solo la conferma "Offerta inviata", non permette più modifiche per quel turno.
6. Alla rivelazione, la squadra vede tutti gli importi e se ha vinto o perso.

Se la squadra aveva impostato in anticipo un importo pianificato per quel giocatore (UC7), il campo offerta si presenta già precompilato con quel valore al passo 3.

### UC4 — Spareggio (parità tra offerte)

**Attore**: Le squadre coinvolte nella parità + Presidente (osservatore)

1. Se due o più squadre hanno offerto lo stesso importo massimo, il sistema apre automaticamente un turno di spareggio, limitato alle sole squadre in parità.
2. Le squadre coinvolte devono rilanciare (non possono passare): offrire lo stesso importo o uno più alto. Le squadre non coinvolte vedono solo un banner informativo e restano in attesa.
3. Se una squadra rilancia più alta delle altre, vince nettamente e l'asta si chiude.
4. Se nessuna rilancia entro il tempo, vince chi tra le squadre in parità aveva inviato la propria offerta per primo nel turno precedente (registrato internamente al momento della prima offerta).
5. Se le squadre in parità rilanciano di nuovo tutte allo stesso importo, il ciclo si ripete con un nuovo turno di spareggio.

### UC5 — Sospensione e ripresa per disconnessione

Questo è il caso d'uso più elaborato del sistema, verificato in dettaglio con decine di scenari (vedi [Test Book](TEST_BOOK.md)).

**Attore**: Il sistema stesso (nessuna azione umana richiesta per la ripresa)

1. Durante un'asta in corso (fase di offerta o spareggio), una squadra perde la connessione da tutti i suoi dispositivi contemporaneamente (es. chiude l'app, il telefono va offline, il browser si blocca).
2. Dopo una breve finestra di tolleranza (qualche secondo, per non reagire a un semplice sfarfallio di rete), il sistema rileva la disconnessione e sospende l'asta per **tutte** le squadre, non solo per quella coinvolta.
3. Tutte le squadre ancora connesse vedono un banner che indica chi è offline; il conto alla rovescia si ferma; nessuno può più inviare offerte, nemmeno chi era regolarmente connesso.
4. Se durante la sospensione un'altra squadra si disconnette a sua volta, la lista di squadre offline si aggiorna, ma lo stato resta "sospeso" — non cambia nulla di sostanziale, se non l'elenco visualizzato.
5. Quando *tutte* le squadre disconnesse tornano online (anche una sola ancora offline blocca la ripresa), l'asta riprende automaticamente: il conto alla rovescia continua dal tempo che restava al momento della sospensione (non riparte da capo), l'eventuale offerta già inviata resta valida.
6. Se una squadra si riconnette e si disconnette più volte di seguito prima che tutte siano stabilmente online, il sistema non genera riprese doppie né perde offerte: la ripresa avviene una sola volta, quando la condizione "tutti online" è davvero soddisfatta.

### UC6 — Stessa squadra da più dispositivi

**Attore**: Squadra partecipante con più dispositivi

1. Una squadra può accedere da un secondo dispositivo (es. telefono di un compagno di squadra) senza fare logout dal primo: entrambi restano collegati alla stessa identità squadra.
2. Il sistema non crea una squadra separata né conta due partecipanti: resta sempre "una" squadra, con tante sessioni quanti dispositivi.
3. Un'offerta inviata da un dispositivo è visibile (come stato "inviata", non come importo) anche sugli altri dispositivi della stessa squadra.
4. Se un dispositivo si disconnette ma un altro della stessa squadra resta online, la squadra continua a essere considerata connessa: nessuna sospensione dell'asta.
5. Solo quando l'ultimo dispositivo rimasto online si disconnette, la squadra passa realmente a "disconnessa" e si applica UC5.
6. Se un dispositivo si riconnette con una sessione completamente nuova (es. dopo aver perso del tutto lo stato locale), riceve comunque lo stato corretto e aggiornato dell'asta, non una versione vecchia.

### UC7 — Pianificazione di un budget per un giocatore

**Attore**: Squadra partecipante

1. Fuori da un'asta attiva, la squadra consulta l'elenco giocatori e sceglie uno che le interessa in prospettiva.
2. Imposta un importo che intende offrire quando (e se) quel giocatore verrà messo all'asta.
3. Il valore è privato per quella squadra: nessun'altra squadra, incluso il Presidente, lo vede.
4. Quando il Presidente avvia effettivamente l'asta per quel giocatore, il campo offerta della squadra si presenta precompilato con l'importo pianificato — la squadra può comunque modificarlo prima di confermare.

### UC8 — Correzione manuale di un'assegnazione

**Attore**: Presidente

1. Il Presidente individua un'assegnazione da correggere (es. prezzo sbagliato, squadra sbagliata per errore di battitura durante un'asta manuale).
2. Può rimuoverla (il budget viene restituito alla squadra, il giocatore torna disponibile) oppure riassegnarla a un'altra squadra con un prezzo diverso.
3. Può anche assegnare manualmente un giocatore rimasto libero (mai messo all'asta, o saltato) a una squadra specifica con un prezzo scelto.
4. Ogni correzione viene registrata nello storico con dettagli su cosa è cambiato.

### UC9 — Esportazione delle rose

**Attore**: Presidente

1. Dal pannello "Rose Squadre", il Presidente preme "Esporta Excel".
2. Il sistema genera un file con un foglio per ciascuna delle 10 squadre: ruolo, nome giocatore, squadra di Serie A, prezzo pagato, più una riga di riepilogo con budget residuo e totale spesi.
3. Su computer, il file si scarica direttamente. Su Android, si apre il menu di condivisione del telefono (per compatibilità con le app PWA, dove il download diretto non è sempre affidabile), da cui si può scegliere "Salva in File" o un'altra destinazione.

### UC10 — Consultazione pubblica live

**Attore**: Spettatore (nessuna credenziale)

1. Chiunque abbia il link della dashboard pubblica vede in tempo reale: quali squadre sono online, il giocatore attualmente all'asta con il timer, gli importi delle offerte (anche prima della piena rivelazione — questa vista non è vincolata alla segretezza operativa, essendo pensata come "tabellone" informativo), lo storico degli ultimi acquisti, e alcune statistiche aggregate (giocatori venduti, budget totale speso, prezzo medio).
2. Non può inviare offerte né in alcun modo interagire con l'asta.

### UC11 — Reset stagione

**Attore**: Presidente

1. Il Presidente, dal pannello Rose Squadre, preme "Reset Stagione" — azione segnalata esplicitamente come irreversibile.
2. Tutte le assegnazioni vengono cancellate, i budget di tutte le squadre tornano al valore iniziale, il log storico viene azzerato.
3. Usato tipicamente per iniziare una nuova stagione/campionato con lo stesso gruppo di squadre.

## 3. Regole di business trasversali

Queste regole valgono in più casi d'uso e sono ripetute qui per chiarezza:

- **Segretezza delle offerte**: nessuna squadra (incluso il Presidente) può vedere l'importo offerto da un'altra squadra prima della rivelazione ufficiale.
- **Rosa piena → esclusione automatica**: una squadra che ha già il numero massimo di giocatori per un ruolo non partecipa più alle aste di quel ruolo, senza dover fare nulla.
- **Nessun timeout sulla sospensione**: a differenza del timer dell'asta, la sospensione per disconnessione non ha un tempo massimo — dura fino a quando tutte le squadre non sono di nuovo online, anche se ciò richiede molti minuti.
- **Il tempo residuo si conserva**: sia in caso di pausa manuale del Presidente sia in caso di sospensione per disconnessione, alla ripresa il conto alla rovescia riparte dal tempo che restava, non dall'intera durata configurata.
