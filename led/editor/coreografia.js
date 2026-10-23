/* COPIA MONTATA da APP_LED/web/coreografia.js (strumenti/monta_led.py): non modificarla a mano. */
/* ==========================================================
   EDITOR COREOGRAFIA — Frontend (aggiunta 2026-10-06)
   Palco con pallini numerati (una racchetta per pallino).
   Per ogni marker: sposti i pallini (formazione) e assegni a
   ogni racchetta un comando (BUIO / ACCESO+colore / effetto).
   "Resta finche' non cambio": si salvano solo i cambiamenti,
   le celle vuote ripetono la precedente (come la tabella).
   Esporta l'XLSX gia' compilato -> LOAD -> anteprima -> GENERATE.

   Additivo: vive tutto qui + 2 endpoint nuovi in app.py.
   Legge i marker dal ponte window.CoreoBridge (audio-assistant.js).
   Vanilla JS, nessun framework. Riusa toast()/downloadBlob() di app.js.
   ========================================================== */
(function () {
  "use strict";

  const root = document.getElementById("coreografia-root");
  if (!root || root.dataset.ready === "1") return;
  if (!window.CoreoBridge) return;
  root.dataset.ready = "1";

  const t = (m, k, ms) => (typeof toast === "function" ? toast(m, k, ms) : console.log(m));
  const uid = () => "k" + Math.random().toString(36).slice(2, 9);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const fmt = (ms) => {
    const s = Math.max(0, ms) / 1000;
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  };

  // ============================================================
  // REGISTRO (colori + effetti attivi)
  // ============================================================
  let REG = { colori: {}, effetti: {} };
  async function caricaRegistro() {
    const res = await fetch("/api/registro");
    if (!res.ok) throw new Error("registro non caricato");
    REG = await res.json();
  }
  const coloriAttivi = () => Object.keys(REG.colori || {});
  const effettiAttivi = () =>
    Object.entries(REG.effetti || {})
      .filter(([, d]) => d.attivo !== false)
      .map(([n]) => n);
  const cssColore = (nome) => (REG.colori[nome] && REG.colori[nome].css) || "#888";

  // "pseudo-effetti" sempre presenti: BUIO e ACCESO (colore fisso)
  function vociMenu() {
    return [
      { key: "BUIO", label: "BUIO", params: [] },
      { key: "ACCESO", label: "ACCESO", params: [{ name: "colore", type: "color" }] },
      ...effettiAttivi().map((n) => ({
        key: n,
        label: n.replace(/_/g, " "),
        // TRANSIZIONE ha una sintassi speciale (direzione + lettera opzionale + colore)
        params: n === "TRANSIZIONE"
          ? [{ name: "direzione", type: "dir" },
             { name: "lettera", type: "optchar" },
             { name: "colore", type: "color" }]
          : n === "HIT"   // HIT: solo il colore. E' un colpo secco sempre uguale (per la coda c'e' FADE)
          ? [{ name: "colore", type: "color" }]
          : (REG.effetti[n].params || []),
      })),
    ];
  }

  // Costruisce la stringa-cella che il generatore capisce gia'
  function buildCella(key, vals) {
    if (key === "BUIO") return "BUIO";
    if (key === "ACCESO") return (vals.colore || coloriAttivi()[0] || "BIANCO");
    if (key === "TRANSIZIONE") {
      const dir = vals.direzione || "DX";
      const col = vals.colore || coloriAttivi()[0];
      const lett = (vals.lettera || "").trim().toUpperCase();
      if (!col) return "";
      if (lett && !/^[A-Z]$/.test(lett)) return "";
      return lett ? `TRANSIZIONE ${dir} LETTERA ${lett} ${col}` : `TRANSIZIONE ${dir} ${col}`;
    }
    if (key === "HIT") {
      const col = vals.colore || coloriAttivi()[0];
      if (!col) return "";
      const f = (vals.fade || "").trim();
      return f ? `HIT ${col} ${f}` : `HIT ${col}`;
    }
    const def = REG.effetti[key];
    if (!def) return "";
    const parts = [key];
    for (const p of def.params) {
      let v = vals[p.name];
      if (v === undefined || v === "") return ""; // parametro mancante
      parts.push(String(v).toUpperCase());
    }
    return parts.join(" ");
  }

  // Interpreta una cella per la resa grafica (colore + etichetta)
  function leggiCella(cella) {
    if (!cella) return { tipo: "vuoto" };
    const up = cella.trim().toUpperCase();
    const tok = up.replace(/[(),]/g, " ").split(/\s+/).filter(Boolean);
    if (tok[0] === "BUIO") return { tipo: "buio" };
    if (REG.colori[tok[0]] && tok.length === 1) return { tipo: "colore", colore: tok[0] };
    // effetto: trova il colore tra i token (se presente) per la tinta
    const col = tok.find((x) => REG.colori[x]);
    const nome = tok[0].replace(/_/g, "");
    // LETTERA A / TRANSIZIONE DX LETTERA A: al posto della sigla si mostra la lettera vera
    const iL = tok.indexOf("LETTERA");
    const lettera = iL >= 0 && /^[A-Z]$/.test(tok[iL + 1] || "") ? tok[iL + 1] : null;
    const tag = lettera ? (tok[0] === "TRANSIZIONE" ? "›" + lettera : lettera) : nome.slice(0, 3);
    return { tipo: "effetto", nome: tok[0], colore: col || null, tag, lettera };
  }

  // ============================================================
  // STATO
  // ============================================================
  // markers: [{id, ms}] (riallineati dal ponte). Keyframe = ms>0.
  // commands[id][racchetta] = "CELLA"   (solo dove cambia)
  // positions[id][racchetta] = [x,y] 0..1 (solo dove cambia)
  const M = { markers: [], commands: {}, positions: {}, groups: {}, sezioni: [], audioNome: "" };
  // il salvataggio automatico parte solo DOPO aver riletto il lavoro salvato (all'avvio
  // un salvataggio dell'editor ancora vuoto cancellerebbe il lavoro del giorno prima)
  let autosavePronto = false;
  let currentId = null;        // keyframe selezionato
  let selected = new Set();    // racchette selezionate (1-based)
  let brush = { key: "ACCESO", vals: { colore: null } }; // effetto fissato in alto
  let mostraFantasmi = false;
  let grigliaOn = false;
  let effettoCopiato = "";      // ⌘C / ⌘V: effetto copiato da una racchetta
  let formazioneCopiata = null; // COPIA/INCOLLA FORMAZIONE: solo posizioni {n: [x, y]}
  const STAGE_RAPP_C = 16 / 9;
  // COPPIE: ogni ballerino tiene due racchette (1-2, 3-4, ...). Acceso: si spostano insieme e
  // DISPONI/ALLINEA lavorano per ballerino. Guardando dal pubblico: dispari a sinistra, pari a destra.
  let coppieOn = true;
  try { if (localStorage.getItem("coreo_coppie") === "0") coppieOn = false; } catch {}
  const QUADRETTI = 32;                         // griglia di riferimento: 32 x 18 quadretti (palco 16:9)
  const DX_COPPIA = 1 / QUADRETTI;              // distanza tra le due racchette (un quadretto della griglia)
  const compagna = (n) => {
    const tot = parseInt(document.getElementById("aa-racchette")?.value) || 0;
    const c = n % 2 ? n + 1 : n - 1;
    return c >= 1 && c <= tot ? c : null;
  };
  const espandiCoppie = (insieme) => {
    const out = new Set(insieme);
    if (coppieOn) for (const n of insieme) { const c = compagna(n); if (c) out.add(c); }
    return out;
  };
  let celleInvalide = {};      // cella -> messaggio errore (validazione live)
  // CANONE / SCRIVI aperto: { racchetta: "3" } = numero del passo (o lettera) mostrato sul pallino
  let passiSuiPallini = null, calcolaPassiPannello = null;

  const telOn = () => !!document.getElementById("aa-tel")?.checked;
  const setup = () => ({
    titolo: (document.getElementById("aa-titolo")?.value || "").trim(),
    racchette: parseInt(document.getElementById("aa-racchette")?.value) || 0,
    // TELECOMANDO acceso: il master non e' una racchetta del palco (master = 0) ma il telecomando n. X
    master: telOn() ? 0 : (parseInt(document.getElementById("aa-master")?.value) || 0),
    telecomando: telOn() ? (parseInt(document.getElementById("aa-tel-num")?.value) || 0) : 0,
  });

  let bridgeState = { beats: [], sections: [], durationMs: 0, hasAudio: false };
  const keyframes = () => M.markers.filter((m) => m.ms > 0);
  const markerById = (id) => M.markers.find((m) => m.id === id);

  // ---- ANNULLA unico (⌘Z o ↶): torna a prima dell'ULTIMA azione, qualunque sia ----
  // Dopo ogni azione si fotografa TUTTO (marker, effetti, formazioni, sezioni): annullare rimette
  // l'ultima fotografia. Cosi' un solo ⌘Z disfa un effetto assegnato, un marker aggiunto o tolto
  // (con i suoi effetti), un Interpola, oppure un CANONE intero (marker creati + effetti).
  const storia = { stati: [], pos: -1 };
  let storiaSospesa = false;      // strumento in corso (marker + effetti): una sola fotografia alla fine
  let applicandoStoria = false;   // sto rimettendo una fotografia: non va registrata come azione nuova
  const statoOra = () => JSON.stringify({ m: M.markers, c: M.commands, p: M.positions, g: M.groups, z: M.sezioni });
  function registraStoria() {
    if (storiaSospesa || applicandoStoria || !autosavePronto) return;
    const s = statoOra();
    if (storia.pos >= 0 && storia.stati[storia.pos] === s) return;          // niente di cambiato (es. solo selezione)
    storia.stati = storia.stati.slice(0, storia.pos + 1);
    storia.stati.push(s);
    if (storia.stati.length > 80) storia.stati.shift();
    storia.pos = storia.stati.length - 1;
  }
  function azzeraStoria() { storia.stati = []; storia.pos = -1; registraStoria(); }
  function vaiAStoria(pos) {
    const o = JSON.parse(storia.stati[pos]);
    applicandoStoria = true;
    try {
      M.markers = o.m; M.commands = o.c; M.positions = o.p; M.groups = o.g || {}; M.sezioni = o.z || [];
      storia.pos = pos;
      if (!markerById(currentId) || markerById(currentId).ms <= 0) currentId = (keyframes()[0] || {}).id || null;
      // la waveform segue: stessi marker (stessi tempi -> l'editor ritrova gli stessi, con i loro effetti)
      if (bridgeState.hasAudio && window.CoreoBridge.ripristinaMarker)
        window.CoreoBridge.ripristinaMarker(M.markers.map((m) => m.ms), M.sezioni);
      validaLive(); renderAll();
    } finally { applicandoStoria = false; }
  }
  function doUndo() { if (storia.pos > 0) vaiAStoria(storia.pos - 1); else t("Niente da annullare", "info", 1500); }
  function doRedo() { if (storia.pos < storia.stati.length - 1) vaiAStoria(storia.pos + 1); }
  // un'azione fatta di piu' pezzi (strumento che crea marker E assegna effetti) = un solo passo di ⌘Z
  function azioneUnica(fn) {
    storiaSospesa = true;
    try { return fn(); } finally { storiaSospesa = false; registraStoria(); }
  }
  // SEGNALE "EDITOR PRONTO": l'avvio (init, in fondo al file) ripristina in modo ASINCRONO il
  // lavoro salvato nel browser e la musica. Chi arriva da fuori (APRI COME SHOW dalla HOME) deve
  // aspettare questo segnale, altrimenti il ripristino sovrascrive quello che ha appena importato.
  let segnalaPronto;
  window.CoreoBridge.pronto = new Promise((r) => { segnalaPronto = r; });
  window.CoreoBridge.annulla = doUndo;
  window.CoreoBridge.ripeti = doRedo;
  function snap() { autosave(); }   // (prima fotografava lo stato per l'annulla: ora lo fa registraStoria dopo ogni azione)

  // ============================================================
  // POSIZIONI (default a griglia ordinata per numero)
  // ============================================================
  function defaultPos(n, tot) {
    if (coppieOn && tot > 1) {
      // formazione di partenza A COPPIE: ogni ballerino (1-2, 3-4...) con le due racchette affiancate,
      // dispari a sinistra (guardando dal pubblico); ballerini in griglia centrata sul palco
      const ball = Math.ceil(tot / 2), u = Math.floor((n - 1) / 2);
      const bc = Math.max(1, Math.ceil(Math.sqrt(ball * 1.4))), br = Math.ceil(ball / bc);
      const r = Math.floor(u / bc), c = u % bc;
      const inRiga = r === br - 1 ? ball - bc * (br - 1) : bc;             // ultima riga incompleta: centrata
      const nx = bc === 1 ? 0.5 : (c + (bc - inRiga) / 2) / (bc - 1);
      const ny = br === 1 ? 0.5 : r / (br - 1);
      const ux = 0.12 + nx * 0.76, uy = 0.14 + ny * 0.64;
      const solo = n === tot && tot % 2 === 1;                               // racchetta senza compagna
      return [solo ? ux : ux + (n % 2 ? -DX_COPPIA / 2 : DX_COPPIA / 2), uy];
    }
    const cols = Math.max(1, Math.ceil(Math.sqrt(tot * 1.6)));
    const rows = Math.ceil(tot / cols);
    const i = n - 1, r = Math.floor(i / cols), c = i % cols;
    const nx = cols === 1 ? 0.5 : c / (cols - 1);
    const ny = rows === 1 ? 0.5 : r / (rows - 1);
    return [0.12 + nx * 0.76, 0.12 + ny * 0.66];
  }
  // stato effettivo (forward-fill sui keyframe fino a currentId incluso)
  function effettivo(racchetta) {
    let cella = null, pos = null;
    for (const m of keyframes()) {
      const c = M.commands[m.id] && M.commands[m.id][racchetta];
      const p = M.positions[m.id] && M.positions[m.id][racchetta];
      if (c !== undefined && c !== null) cella = c;
      if (p !== undefined && p !== null) pos = p;
      if (m.id === currentId) break;
    }
    return { cella, pos };
  }
  function posAlPrecedente(racchetta) {
    let pos = null;
    for (const m of keyframes()) {
      if (m.id === currentId) break;
      const p = M.positions[m.id] && M.positions[m.id][racchetta];
      if (p) pos = p;
    }
    return pos;
  }
  const cambiaQui = (r) =>
    currentId &&
    ((M.commands[currentId] && M.commands[currentId][r] !== undefined) ||
     (M.positions[currentId] && M.positions[currentId][r] !== undefined));

  // ============================================================
  // MARKUP
  // ============================================================
  root.innerHTML = `
    <section class="co">
      <div class="co-head">
        <div class="co-tag">// COREOGRAFIA</div>
        <p class="co-intro">Carica l'audio e piazza i marker qui sopra. Poi, per ogni marker,
          sposta i pallini (formazione) e assegna a ogni racchetta cosa fa. Salva con <strong>SALVA PROGETTO</strong>;
          quando e' pronto premi <strong>CARICA SHOW</strong>.</p>
      </div>

      <div class="co-toolbar">
        <div class="co-mk">
          <button class="co-btn" id="co-prev" title="marker precedente [">‹</button>
          <span class="co-mk-lbl" id="co-mk-lbl">—</span>
          <button class="co-btn" id="co-next" title="marker successivo ]">›</button>
        </div>

        <div class="co-brush">
          <span class="co-brush-lbl">EFFETTO</span>
          <select class="co-sel" id="co-eff"></select>
          <span id="co-params"></span>
          <button class="co-btn co-btn-primary" id="co-assign" title="Invio">ASSEGNA</button>
        </div>
      </div>

      <!-- BARRE DEGLI STRUMENTI: tre righe, ognuna con la sua etichetta -->
      <div class="co-barre">
        <div class="co-riga">
          <span class="co-et">SELEZIONA</span>
          <button class="co-btn co-chip" data-sel="tutti">TUTTI</button>
          <button class="co-btn co-chip" data-sel="pari">PARI</button>
          <button class="co-btn co-chip" data-sel="dispari">DISPARI</button>
          <button class="co-btn co-chip" data-sel="inverti">INVERTI</button>
          <button class="co-btn co-chip" data-sel="nessuno">NESSUNO</button>
          <span class="co-divider"></span>
          <span class="co-et co-et-s">GRUPPI</span>
          <span class="co-lib" id="co-gruppi"></span>
          <button class="co-btn co-chip" id="co-gruppo-salva" title="da' un nome alle racchette selezionate (ricorda anche l'ordine in cui le hai scelte)">+ GRUPPO</button>
          <span class="co-spinta"></span>
          <span class="co-sel-info" id="co-sel-info">0 selezionate</span>
        </div>
        <div class="co-riga">
          <span class="co-et">PALCO</span>
          <button class="co-btn co-chip" id="co-formaz-btn" title="formazioni pronte (righe, file, cerchio, piramide...) e quelle salvate da te">FORMAZIONI ▾</button>
          <button class="co-btn co-chip" id="co-allinea" title="come sul desktop: porta ognuna sul punto della griglia piu' vicino">ALLINEA</button>
          <button class="co-btn co-chip" id="co-scambia" title="ballerino di schiena o racchette incrociate: inverte di posto le due racchette della coppia (selezionate, o tutte)">SCAMBIA</button>
          <span class="co-divider"></span>
          <button class="co-btn co-chip" id="co-copia-form" title="copia SOLO le posizioni di questo marker (non gli effetti) — ⇧⌘C">COPIA FORM.</button>
          <button class="co-btn co-chip" id="co-incolla-form" title="mette le posizioni copiate su questo marker, senza toccare gli effetti — ⇧⌘V" disabled>INCOLLA FORM.</button>
          <span class="co-spinta"></span>
          <button class="co-btn co-chip" id="co-grid" title="mostra una griglia di riferimento (g)">GRIGLIA</button>
          <button class="co-btn co-chip" id="co-coppie-btn" title="ogni ballerino ha due racchette (1-2, 3-4...): una linea le unisce (trascina la linea = si spostano insieme), DISPONI le mette in coppia"></button>
        </div>
      <div class="co-pannello" id="co-formaz-pan" style="display:none;">
        <div class="co-pan-h">FORMAZIONI <small id="co-disp-chi">(tutte)</small>
          <label class="co-pan-o co-pan-vicino" title="ogni ballerino va nel posto libero piu' vicino a dove si trova adesso: meno strada e meno incroci. Spento: i posti si riempiono in ordine di numero">
            <input type="checkbox" id="co-vicino" checked> ognuno va al posto più vicino</label></div>
        <div class="co-pan-r"><span class="co-pan-l">RIGHE</span>
          <button class="co-chip2" data-disp="riga" title="tutti uno accanto all'altro">1 RIGA</button>
          <button class="co-chip2" data-righe="2" title="sfalsate: ognuno nei buchi della riga dietro">2 RIGHE</button><button class="co-chip2" data-righe="3" title="sfalsate: ognuno nei buchi della riga dietro">3 RIGHE</button><button class="co-chip2" data-righe="4" title="sfalsate: ognuno nei buchi della riga dietro">4 RIGHE</button>
          <span class="co-pan-l co-pan-l2">FILE</span>
          <button class="co-chip2" data-disp="fila" title="tutti uno dietro l'altro, il primo davanti">1 FILA</button>
          <button class="co-chip2" data-file="2">2 FILE</button><button class="co-chip2" data-file="3">3 FILE</button><button class="co-chip2" data-file="4">4 FILE</button></div>
        <div class="co-pan-r"><span class="co-pan-l">ALTRE</span>
          <button class="co-chip2" data-disp="cerchio">CERCHIO</button>
          <button class="co-chip2" data-disp="v" title="a V, con la punta verso il pubblico">V</button>
          <button class="co-chip2" data-disp="v-r" title="a V rovesciata, con la punta dietro">V ROVESCIA</button>
          <button class="co-chip2" data-disp="cuore" title="a cuore, con la punta verso il pubblico">CUORE</button>
          <button class="co-chip2" id="co-disp-griglia-btn" title="file e colonne: scegli tu la forma">GRIGLIA…</button></div>
        <div class="co-forme" id="co-forme" style="display:none;"></div>
        <div class="co-pan-r"><span class="co-pan-l">LE TUE</span>
          <span class="co-lib" id="co-formaz"></span>
          <button class="co-chip2" id="co-formaz-salva" title="salva le posizioni di questo marker con un nome, per riusarle in questo e negli altri show">+ SALVA QUESTA</button></div>
      </div>
        <div class="co-riga">
          <span class="co-et">STRUMENTI</span>
          <button class="co-btn co-chip" id="co-canone-btn" title="le racchette partono una dopo l'altra: scegli ordine, effetto e tempo, i marker li crea lui">CANONE</button>
          <button class="co-btn co-chip" id="co-scrivi-btn" title="scrivi una parola o una frase: una lettera per racchetta">SCRIVI</button>
          <span class="co-divider"></span>
          <button class="co-btn co-chip" id="co-tratto-copia" title="copia effetti (e formazioni) di tutti i marker tra il primo e l'ultimo selezionato sulla waveform">COPIA TRATTO</button>
          <button class="co-btn co-chip" id="co-tratto-incolla" title="incolla il tratto copiato a partire da questo marker, anche cambiando colore" disabled>INCOLLA TRATTO</button>
          <button class="co-btn co-chip" id="co-multi" style="display:none;"
                title="quando e' acceso, l'effetto che assegni va su TUTTI i marker selezionati sulla waveform"></button>
          <span class="co-spinta"></span>
          <button class="co-btn co-chip" id="co-undo" title="annulla l'ultima azione, qualunque sia: effetto, spostamento, marker, canone (⌘Z)">↶ ANNULLA</button>
          <button class="co-btn co-chip" id="co-redo" title="rifai quello che hai annullato (⇧⌘Z)">↷</button>
        </div>
      </div>
      <div class="co-pannello" id="co-pannello" style="display:none;"></div>

      <div class="co-stage-wrap">
        <div class="co-stage" id="co-stage">
          <div class="co-rubber" id="co-rubber" style="display:none;"></div>
        </div>
        <div class="co-stage-foot">PUBBLICO</div>
      </div>

      <div class="co-scrub">
        <span class="co-scrub-lbl">ANTEPRIMA ▸</span>
        <input type="range" id="co-scrub" min="0" max="0" value="0" step="1"
               title="scorri i marker e guarda come cambia la formazione">
        <span class="co-scrub-time" id="co-scrub-time">—</span>
      </div>

      <div class="co-lanes-card">
        <div class="co-lanes-head">
          <span class="co-sec-title">// VISIONE D'INSIEME (una riga per racchetta)</span>
        </div>
        <div class="co-lanes" id="co-lanes"></div>
      </div>

      <div class="co-foot">
        <div class="co-foot-l">
          <button class="co-btn co-btn-primary co-export" id="co-anteprima-btn" title="guarda lo show a tempo di musica: spostamenti, colori ed effetti. Parte dal marker su cui sei">▶ GUARDA LO SHOW</button>
          <button class="co-btn co-chip" id="co-mappa-btn" title="mappa della formazione (stampabile)">MAPPA</button>
          <button class="co-btn co-chip" id="co-verifica-btn" title="controlla lo show prima di esportare">VERIFICA</button>
          <span class="co-divider"></span>
          <button class="co-btn co-chip" id="co-new" title="comincia uno show nuovo (quello di adesso resta salvato)">NUOVO</button>
          <button class="co-btn co-chip" id="co-save" title="salva lo show col titolo scritto in alto: stesso titolo = sovrascrive, titolo diverso = un altro show (⌘S)">SALVA PROGETTO</button>
          <button class="co-btn co-chip" id="co-open" title="gli show che hai salvato tu: apri, rinomina, duplica">APRI PROGETTO</button>
          <button class="co-btn co-chip" id="co-ripristina" style="display:none;"
                  title="torna alla copia salvata prima dell'ultimo cambiamento grosso">RIPRISTINA COPIA</button>
          <input type="file" id="co-file" accept=".json,.ledshow.json,application/json" hidden>
        </div>
        <div class="co-foot-r">
          <span class="co-prog-info" id="co-prog-info"></span>
          <button class="co-btn co-chip" id="co-export" title="scarica la tabella Excel (serve solo se la vuoi vedere o tenere)">ESPORTA XLSX</button>
          <button class="co-btn co-btn-primary co-export" id="co-manda" title="prepara la tabella e la porta in CARICA SHOW: li' premi PREPARA">CARICA SHOW ➜</button>
        </div>
      </div>
      <div class="aa-shortcuts co-shortcuts">
        <span><kbd>Invio</kbd> assegna</span>
        <span><kbd>1</kbd>–<kbd>8</kbd> colore</span>
        <span><kbd>A</kbd> tutte</span>
        <span><kbd>B</kbd> buio</span>
        <span><kbd>⌘S</kbd> salva</span>
        <span><kbd>⌘Z</kbd> annulla l'ultima azione · <kbd>⇧⌘Z</kbd> la rifà</span>
        <span><kbd>⌘C</kbd> <kbd>⌘V</kbd> copia / incolla effetto</span>
        <span><kbd>⇧⌘C</kbd> <kbd>⇧⌘V</kbd> copia / incolla formazione</span>
        <span><kbd>X</kbd> togli effetto</span>
        <span><kbd>G</kbd> griglia</span>
        <span><kbd>↑</kbd> marker successivo · <kbd>↓</kbd> precedente</span>
        <span><kbd>doppio clic</kbd> su una racchetta: menu</span>
        <span><kbd>MAIUSC+clic</kbd> scegli le racchette in ordine (per CANONE e SCRIVI)</span>
      </div>

      <div class="co-overlay" id="co-overlay" style="display:none;"></div>
      <div class="co-menu" id="co-menu" style="display:none;"></div>
    </section>`;

  const $ = (id) => document.getElementById(id);
  const stage = $("co-stage");
  const rubber = $("co-rubber");
  const menu = $("co-menu");
  const overlay = $("co-overlay");

  // ============================================================
  // TOP: effetto fissato + parametri dinamici
  // ============================================================
  function renderEffSelect() {
    const sel = $("co-eff");
    sel.innerHTML = vociMenu()
      .map((v) => `<option value="${v.key}">${v.label}</option>`)
      .join("");
    sel.value = brush.key;
    renderParams();
  }
  function paramsHTML(key, prefix, vals) {
    const voce = vociMenu().find((v) => v.key === key);
    if (!voce || !voce.params.length) return "";
    return voce.params
      .map((p) => {
        const cur = (vals && vals[p.name]) || "";
        if (p.type === "color") {
          const opts = (key === "SFUMATURA" ? ["BUIO"] : []).concat(coloriAttivi())
            .map((c) => `<option value="${c}" ${c === cur ? "selected" : ""}>${c}</option>`)
            .join("");
          return `<select class="co-sel" data-p="${p.name}" id="${prefix}-${p.name}">${opts}</select>`;
        }
        if (p.type === "int")
          return `<input class="co-num" type="number" min="1" max="999" placeholder="${p.name}"
                    data-p="${p.name}" id="${prefix}-${p.name}" value="${cur}">`;
        if (p.type === "char")
          return `<input class="co-num co-char" type="text" maxlength="1" placeholder="A-Z"
                    data-p="${p.name}" id="${prefix}-${p.name}" value="${cur}">`;
        if (p.type === "dir") {
          const opts = [["DX", "← da destra"], ["SX", "→ da sinistra"]]   // la freccia = verso in cui corre l'onda
            .map(([v, lab]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${v} ${lab}</option>`)
            .join("");
          return `<select class="co-sel" data-p="${p.name}" id="${prefix}-${p.name}">${opts}</select>`;
        }
        if (p.type === "fade") {
          const opts = [["", "fade fino al comando dopo"],
                        ...["0.2", "0.3", "0.5", "0.75", "1", "1.5", "2", "3", "4", "5"].map((v) => [v, `fade ${v} s`])]
            .map(([v, lab]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${lab}</option>`)
            .join("");
          return `<select class="co-sel" data-p="${p.name}" id="${prefix}-${p.name}"
                    title="quanto dura la sfumatura a buio dopo il colpo">${opts}</select>`;
        }
        if (p.type === "optchar")
          return `<input class="co-num co-char" type="text" maxlength="1" placeholder="lett."
                    title="lettera opzionale (A-Z): lascia vuoto per nessuna lettera"
                    data-p="${p.name}" id="${prefix}-${p.name}" value="${cur}">`;
        return "";
      })
      .join("");
  }
  function readParams(container) {
    const vals = {};
    container.querySelectorAll("[data-p]").forEach((e) => {
      vals[e.dataset.p] = (e.value || "").toUpperCase();
    });
    return vals;
  }
  function renderParams() {
    const box = $("co-params");
    box.innerHTML = paramsHTML(brush.key, "co-bp", brush.vals);
    box.querySelectorAll("[data-p]").forEach((e) =>
      e.addEventListener("change", () => (brush.vals = readParams(box))));
  }
  $("co-eff").addEventListener("change", (e) => {
    brush.key = e.target.value;
    brush.vals = {};
    renderParams();
  });

  // ============================================================
  // STAGE: render pallini
  // ============================================================
  function renderStage() {
    const { racchette, master } = setup();
    stage.classList.toggle("griglia", grigliaOn);
    // via i vecchi pallini/fantasmi, tengo il rubber
    stage.querySelectorAll(".co-dot, .co-ghost, .co-coppie, .co-link").forEach((e) => e.remove());

    if (!racchette) {
      if (!stage.querySelector(".co-empty"))
        stage.insertAdjacentHTML("beforeend",
          `<div class="co-empty">Imposta <b>Racchette</b> qui sopra per vedere il palco.</div>`);
      return;
    }
    const emptyEl = stage.querySelector(".co-empty");
    if (emptyEl) emptyEl.remove();

    if (!currentId && keyframes().length) currentId = keyframes()[0].id;

    const larghPalco = stage.getBoundingClientRect().width || 1000;
    stage.style.setProperty("--dot", Math.round(Math.max(window.MiniTouch ? 30 : 20, Math.min(40, (larghPalco / QUADRETTI) * 0.88, (larghPalco * 0.94) / (racchette * 1.45)))) + "px");
    const posTutte = {};
    for (let n = 1; n <= racchette; n++) {
      const { cella, pos } = effettivo(n);
      const p = pos || defaultPos(n, racchette);
      posTutte[n] = p;

      if (mostraFantasmi) {
        const pp = posAlPrecedente(n);
        if (pp && (pp[0] !== p[0] || pp[1] !== p[1])) {
          const g = document.createElement("div");
          g.className = "co-ghost";
          g.style.left = pp[0] * 100 + "%";
          g.style.top = pp[1] * 100 + "%";
          g.textContent = n;
          stage.appendChild(g);
        }
      }

      const info = leggiCella(cella);
      const dot = document.createElement("div");
      dot.className = "co-dot";
      if (n === master) dot.classList.add("master");
      if (selected.has(n)) dot.classList.add("sel");
      if (cambiaQui(n)) dot.classList.add("cambia");
      if (cella && celleInvalide[cella]) dot.classList.add("invalid");
      dot.style.left = p[0] * 100 + "%";
      dot.style.top = p[1] * 100 + "%";
      dot.dataset.n = n;

      let fill = "transparent", label = "";
      if (info.tipo === "colore") { fill = cssColore(info.colore); }
      else if (info.tipo === "effetto") {
        fill = info.colore ? cssColore(info.colore) : "transparent";
        label = info.tag;
      }
      dot.style.setProperty("--fill", fill);
      if (info.tipo === "buio" || info.tipo === "vuoto") dot.classList.add("spento");
      dot.innerHTML =
        `<span class="co-dot-n">${n}</span>` +
        (label ? `<span class="co-dot-fx${info.lettera ? " let" : ""}">${label}</span>` : "") +
        // CANONE / SCRIVI aperto: su ogni racchetta il numero del passo (o la lettera) che le tocca
        (passiSuiPallini && passiSuiPallini[n] != null ? `<span class="co-dot-passo">${esc(passiSuiPallini[n])}</span>` : "");
      if (passiSuiPallini && passiSuiPallini[n] == null) dot.classList.add("fuori-passo");
      stage.appendChild(dot);
    }
    if (coppieOn) {                            // ogni ballerino: una linea unisce le sue due racchette
      const R = stage.getBoundingClientRect();   // (trascinando la linea si muovono insieme)
      let linee = "";
      for (let n = 1; n < racchette; n += 2) {
        const a = posTutte[n], b = posTutte[n + 1];
        const dx = (b[0] - a[0]) * R.width, dy = (b[1] - a[1]) * R.height;
        const sel = selected.has(n) && selected.has(n + 1) ? " sel" : "";
        linee += `<div class="co-link${sel}" data-coppia="${n}" title="ballerino ${n}-${n + 1}: trascina per spostarli insieme"
          style="left:${a[0] * 100}%;top:${a[1] * 100}%;width:${Math.hypot(dx, dy)}px;transform:rotate(${Math.atan2(dy, dx)}rad)"></div>`;
      }
      stage.insertAdjacentHTML("afterbegin", linee);
    }
    $("co-sel-info").textContent =
      selected.size ? `${selected.size} selezionate: ${[...selected].sort((a, b) => a - b).join(", ")}` : "0 selezionate";
    $("co-sel-info").title = $("co-sel-info").textContent;      // se l'elenco e' lungo viene troncato: qui c'e' tutto
    $("co-disp-chi").textContent = selected.size >= 2 ? `(le ${selected.size} selezionate)` : "(tutte)";
  }

  // ============================================================
  // LANES: visione d'insieme (segmenti per racchetta)
  // ============================================================
  // VELOCITA': la visione d'insieme si ridisegna SOLO se sono cambiati effetti o marker.
  // Cambiare marker o selezione sposta soltanto la lineetta del "sei qui". Ogni racchetta ha un
  // pezzetto per ogni COMANDO (non per ogni marker): con 390 marker x 36 racchette erano 14.000
  // pezzetti rifatti a ogni clic, ora sono qualche migliaio e solo quando serve.
  let lanesChiave = "";
  function renderLanes() {
    const { racchette, master } = setup();
    const lanes = $("co-lanes");
    const kf = keyframes();
    const dur = bridgeState.durationMs || (kf.length ? kf[kf.length - 1].ms + 1000 : 1000);
    if (!racchette || !kf.length) {
      lanesChiave = "";
      lanes.innerHTML = `<div class="co-lanes-empty">Nessun marker: piazzane qualcuno sulla waveform.</div>`;
      return;
    }
    const cur = currentId && markerById(currentId);
    const cx = cur ? (cur.ms / dur) * 100 : -1;
    const chiave = JSON.stringify([racchette, master, dur, M.markers, M.commands, Object.keys(celleInvalide)]);
    if (chiave === lanesChiave) {               // niente di nuovo da disegnare: sposto solo il cursore
      lanes.querySelectorAll(".co-lane-cursor").forEach((c) => { c.style.left = cx + "%"; c.style.display = cx >= 0 ? "" : "none"; });
      return;
    }
    lanesChiave = chiave;
    let html = "";
    for (let n = 1; n <= racchette; n++) {
      // un pezzetto per ogni comando scritto (i marker senza comando continuano quello di prima)
      const segs = [];
      for (const m of kf) {
        const c = M.commands[m.id] && M.commands[m.id][n];
        if (c !== undefined && c !== null) segs.push({ ms: m.ms, cella: c });
        else if (!segs.length) segs.push({ ms: m.ms, cella: null });
      }
      let bars = "";
      for (let i = 0; i < segs.length; i++) {
        const a = segs[i].ms;
        const b = i + 1 < segs.length ? segs[i + 1].ms : dur;
        const info = leggiCella(segs[i].cella);
        let col = "#0c0c12";
        if (info.tipo === "colore") col = cssColore(info.colore);
        else if (info.tipo === "effetto" && info.colore) col = cssColore(info.colore);
        const w = ((b - a) / dur) * 100;
        const bad = segs[i].cella && celleInvalide[segs[i].cella];
        bars += `<span class="co-seg ${info.tipo} ${bad ? "bad" : ""}" style="left:${(a / dur) * 100}%;width:${w}%;--c:${col}"
                   title="${esc(segs[i].cella || "—")} @ ${fmt(a)}">${info.tag || ""}</span>`;
      }
      html += `<div class="co-lane" data-n="${n}">
          <span class="co-lane-n ${n === master ? "master" : ""}">${n}${n === master ? "★" : ""}</span>
          <span class="co-lane-track">${bars}
            <span class="co-lane-cursor" style="left:${cx}%;${cx >= 0 ? "" : "display:none"}"></span></span>
        </div>`;
    }
    lanes.innerHTML = html;
  }
  // clic sulla visione d'insieme: va al marker che c'e' in quel punto e seleziona quella racchetta
  // (un solo ascoltatore per tutto il riquadro, invece di uno per ogni pezzetto)
  $("co-lanes").addEventListener("click", (e) => {
    const track = e.target.closest(".co-lane-track"), lane = e.target.closest(".co-lane");
    if (!track || !lane) return;
    const kf = keyframes(); if (!kf.length) return;
    const dur = bridgeState.durationMs || kf[kf.length - 1].ms + 1000;
    const r = track.getBoundingClientRect();
    const ms = ((e.clientX - r.left) / r.width) * dur;
    let kfm = kf[0];
    for (const m of kf) { if (m.ms <= ms + 0.5) kfm = m; else break; }
    currentId = kfm.id;
    selected = new Set([parseInt(lane.dataset.n)]);
    renderAll();
  });

  function renderMarkerLabel() {
    const kf = keyframes();
    const lbl = $("co-mk-lbl");
    if (!kf.length) { lbl.textContent = "nessun marker"; return; }
    const idx = kf.findIndex((m) => m.id === currentId);
    const m = kf[idx] || kf[0];
    // su questo marker c'e' una formazione salvata? (posizioni scritte QUI, non ereditate da prima)
    const qui = Object.keys(M.positions[m.id] || {}).length, { racchette } = setup();
    lbl.innerHTML = `marker ${idx + 1}/${kf.length} · ${fmt(m.ms)} ` + (qui
      ? `<span class="co-mk-form si" title="su questo marker hai salvato delle posizioni: sulla waveform ha il rombo fucsia">◆ ${qui >= racchette ? "formazione salvata qui" : (qui === 1 ? "qui si sposta 1 racchetta" : "qui si spostano " + qui + " racchette")}</span>`
      : `<span class="co-mk-form" title="nessuna posizione salvata su questo marker: le racchette restano dove le ha lasciate l'ultima formazione">formazione di prima</span>`);
  }
  // dice alla waveform quali marker hanno una formazione (rombo fucsia): solo quando l'elenco cambia
  let formazioniChiave = "";
  function segnaFormazioni() {
    if (!window.CoreoBridge.setFormazioni) return;
    const lista = M.markers.filter((m) => m.ms > 0 && Object.keys(M.positions[m.id] || {}).length).map((m) => m.ms);
    const chiave = lista.join(",");
    if (chiave === formazioniChiave) return;
    formazioniChiave = chiave;
    window.CoreoBridge.setFormazioni(lista);
  }

  function renderScrub() {
    const kf = keyframes();
    const s = $("co-scrub");
    s.max = Math.max(0, kf.length - 1);
    const idx = kf.findIndex((m) => m.id === currentId);
    s.value = idx < 0 ? 0 : idx;
    $("co-scrub-time").textContent = kf.length ? fmt((kf[idx < 0 ? 0 : idx] || kf[0]).ms) : "—";
  }

  function renderAll() {
    if (calcolaPassiPannello) { try { calcolaPassiPannello(); } catch (e) { console.error(e); } }   // selezione cambiata: aggiorna i numeri
    renderStage();
    renderLanes();
    renderMarkerLabel();
    segnaFormazioni();
    renderScrub();
    aggiornaMulti();
    if (window.CoreoBridge.setCorrente) {           // evidenzia sulla waveform il marker su cui si lavora
      const mc = markerById(currentId);
      window.CoreoBridge.setCorrente(mc && mc.ms > 0 ? mc.ms : null);
    }
    registraStoria();   // fotografia per ⌘Z (solo se e' cambiato qualcosa)
    autosave();   // salva DOPO ogni cambiamento (snap() salvava lo stato di prima: l'ultima azione si perdeva)
  }

  // ---- ANTEPRIMA a scorrimento: trascini e guardi la formazione a ogni marker ----
  $("co-scrub").addEventListener("input", () => {
    const kf = keyframes();
    if (!kf.length) return;
    const idx = Math.max(0, Math.min(kf.length - 1, parseInt($("co-scrub").value)));
    currentId = kf[idx].id;
    renderAll();
  });

  // ============================================================
  // MAPPA FORMAZIONI (stampabile): tutte le formazioni dello show,
  // senza doppioni, impaginate su A4 (1 / 4 / 8 / 15 per foglio)
  // ============================================================
  // Una "formazione" nasce quando cambia la posizione di almeno una racchetta.
  function raccogliFormazioni() {
    const { racchette } = setup();
    const kf = keyframes();
    const durata = bridgeState.durationMs || (kf.length ? kf[kf.length - 1].ms + 5000 : 0);
    const pos = {};
    for (let n = 1; n <= racchette; n++) pos[n] = defaultPos(n, racchette);
    const copia = () => Object.fromEntries(Object.entries(pos).map(([k, v]) => [k, [+v[0].toFixed(4), +v[1].toFixed(4)]]));
    const out = [];
    if (!kf.length) return [{ da: 0, a: durata, m1: 0, m2: 0, pos: copia(), prev: null }];
    let chiave = null;
    kf.forEach((m, i) => {
      for (let n = 1; n <= racchette; n++) {
        const pp = M.positions[m.id] && M.positions[m.id][n];
        if (pp) pos[n] = pp;
      }
      // formazione nuova solo se almeno una racchetta si e' spostata DAVVERO (piu' di ~mezzo quadretto):
      // un pallino toccato per sbaglio di pochissimo non crea una formazione in piu'
      const ora = copia(), ult = out.length ? out[out.length - 1].pos : null;
      const cambiata = !ult || Object.keys(ora).some((n) =>
        Math.hypot(ora[n][0] - ult[n][0], (ora[n][1] - ult[n][1]) * 9 / 16) > 0.014);
      const k = cambiata ? JSON.stringify(ora) : chiave;
      if (k !== chiave) {
        if (out.length) out[out.length - 1].a = m.ms;
        out.push({ da: m.ms, a: durata, m1: i + 1, m2: i + 1, pos: copia(),
                   prev: out.length ? out[out.length - 1].pos : null });
        chiave = k;
      } else {
        out[out.length - 1].m2 = i + 1;
      }
    });
    return out;
  }

  // MAPPA COLORI: un "passaggio" per ogni marker in cui cambia qualcosa (una posizione, un colore
  // o un effetto). col[n] = [colore css, sigla effetto, 1 se il colore e' scuro]; assente = spenta.
  function raccogliPassi() {
    const { racchette } = setup();
    const kf = keyframes();
    const durata = bridgeState.durationMs || (kf.length ? kf[kf.length - 1].ms + 5000 : 0);
    const pos = {}, cur = {};
    for (let n = 1; n <= racchette; n++) pos[n] = defaultPos(n, racchette);
    const copia = () => Object.fromEntries(Object.entries(pos).map(([k, v]) => [k, [+v[0].toFixed(4), +v[1].toFixed(4)]]));
    const scuro = (css) => {
      const h = /^#([0-9a-f]{6})$/i.exec(css || "");
      if (!h) return 0;
      const v = parseInt(h[1], 16);
      return (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) < 140 ? 1 : 0;
    };
    const out = [];
    let firma = null;
    kf.forEach((m, i) => {
      let colpo = false;                          // un HIT riscritto e' un colpo nuovo anche se uguale
      for (let n = 1; n <= racchette; n++) {
        const pp = M.positions[m.id] && M.positions[m.id][n];
        if (pp) pos[n] = pp;
        const c = M.commands[m.id] && M.commands[m.id][n];
        if (c !== undefined && c !== null) { if (/^\s*HIT\b/i.test(c)) colpo = true; cur[n] = c; }
      }
      const col = {};
      for (let n = 1; n <= racchette; n++) {
        const info = cur[n] ? leggiCella(cur[n]) : { tipo: "vuoto" };
        if (info.tipo === "colore") { const c = cssColore(info.colore); col[n] = [c, "", scuro(c)]; }
        else if (info.tipo === "effetto") { const c = info.colore ? cssColore(info.colore) : ""; col[n] = [c, info.tag || "", scuro(c)]; }
      }
      const ora = copia(), ult = out.length ? out[out.length - 1] : null;
      const mossa = !ult || Object.keys(ora).some((n) =>
        Math.hypot(ora[n][0] - ult.pos[n][0], (ora[n][1] - ult.pos[n][1]) * 9 / 16) > 0.014);
      const f = JSON.stringify(col);
      if (mossa || f !== firma || colpo) {
        if (ult) ult.a = m.ms;
        out.push({ da: m.ms, a: durata, m1: i + 1, m2: i + 1, pos: mossa ? ora : ult.pos, col,
                   prev: ult ? ult.pos : null });
        firma = f;
      } else {
        ult.m2 = i + 1;
      }
    });
    return out;
  }

  $("co-mappa-btn").addEventListener("click", () => {
    const { racchette, titolo } = setup();
    if (!racchette) return t("Imposta prima il numero di racchette", "err");
    const forms = raccogliFormazioni().map((f, i) => ({ ...f, n: i + 1, daT: fmt(f.da), aT: fmt(f.a) }));
    const passi = raccogliPassi().map((f, i) => ({ ...f, n: i + 1, daT: fmt(f.da), aT: fmt(f.a) }));
    const dati = { titolo: titolo || "SHOW", racchette, forms, passi, coppie: coppieOn };
    const json = JSON.stringify(dati).replace(/</g, "\\u003c");
    const html = `<!doctype html><html lang="it"><head><meta charset="utf-8">
<title>Mappa formazioni — ${esc(dati.titolo)}</title>
<style id="pg">@page{size:A4 portrait;margin:10mm}</style>
<style>
  *{box-sizing:border-box} body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#111;background:#e9e9ee}
  .ctl{position:sticky;top:0;z-index:5;background:#20222a;color:#eee;padding:10px 16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;font-size:14px}
  .ctl button{font-size:14px;padding:6px 12px;border-radius:6px;border:1px solid #666;background:#333;color:#eee;cursor:pointer}
  .ctl button.on{background:#ffd34d;color:#111;border-color:#ffd34d;font-weight:bold}
  .ctl .stampa{background:#2d7;color:#111;border-color:#2d7;font-weight:bold}
  .scegli{background:#2b2e38;color:#ddd;padding:10px 16px;font-size:13px}
  .scegli .tit{display:flex;gap:12px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
  .scegli .tit button{font-size:12px;padding:4px 10px;border-radius:6px;border:1px solid #666;background:#333;color:#eee;cursor:pointer}
  .scegli .lista{display:flex;gap:8px;flex-wrap:wrap}
  .mini{user-select:none;-webkit-user-select:none;width:118px;background:#fff;border:2px solid #2d7;border-radius:6px;padding:3px;cursor:pointer;color:#111;text-align:left}
  .mini svg{position:static;display:block;width:100%;height:auto;aspect-ratio:16/9;border:1px solid #999;border-radius:3px}
  .mini span{display:block;font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden}
  .mini.off{border-color:#777;background:#55585f;color:#bbb;opacity:.75}
  .mini.off svg{opacity:.35}
  @media print{.scegli{display:none}}
  .ctl label{display:flex;gap:6px;align-items:center;cursor:pointer}
  .pagina{background:#fff;margin:14px auto;box-shadow:0 2px 12px rgba(0,0,0,.25);padding:10mm;display:flex;flex-direction:column;gap:3mm;overflow:hidden}
  .pagina.portrait{width:210mm;height:297mm} .pagina.landscape{width:297mm;height:210mm}
  .testa{display:flex;justify-content:space-between;align-items:baseline;font-size:3.4mm;border-bottom:.3mm solid #111;padding-bottom:1.5mm}
  .testa b{font-size:4.2mm} .leg{font-size:2.8mm;color:#444}
  .griglia{display:grid;gap:4mm 5mm;align-content:start}
  .cella{display:flex;flex-direction:column;gap:1mm}
  .cap{display:flex;justify-content:space-between;align-items:baseline;font-size:var(--capf)}
  .cap b{font-size:calc(var(--capf) * 1.15)} .cap span{color:#444}
  .stage{position:relative;width:100%;aspect-ratio:16/9;border:.4mm solid #111;border-radius:2mm;overflow:hidden}
  .pub{text-align:center;font-size:calc(var(--capf) * .75);letter-spacing:.25em;color:#555}
  .d.coppia{width:calc(var(--dot) * 1.75);height:calc(var(--dot) * .85);border-radius:calc(var(--dot) / 2);justify-content:space-evenly;padding:0 .3mm;font-size:calc(var(--num) * .92)}
  .d.coppia i{display:block;width:0;height:62%;border-left:.3mm solid #111}
  .d{position:absolute;transform:translate(-50%,-50%);width:var(--dot);height:var(--dot);border:.5mm solid #111;border-radius:50%;
     background:#fff;color:#000;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:var(--num);line-height:1;z-index:2}
  svg{position:absolute;inset:0;width:100%;height:100%;z-index:1}
  /* MAPPA COLORI: i colori dei pallini si stampano davvero; sigla dell'effetto sotto al pallino */
  .d,.mini svg{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .d.spenta{border:.3mm solid #aaa;color:#999}
  .d.coppia span.spenta{color:#999}
  .d em{position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:.15mm;font-style:normal;font-weight:700;
        font-size:calc(var(--num) * .72);line-height:1;color:#111;background:rgba(255,255,255,.85);white-space:nowrap;padding:0 .2mm}
  .d.coppia em.l{left:25%} .d.coppia em.r{left:75%}
  @media print{body{background:#fff}.ctl{display:none}
    .pagina{margin:0;box-shadow:none;padding:0;width:auto !important;height:auto !important;overflow:visible;page-break-after:always;break-after:page}
    .pagina:last-child{page-break-after:auto;break-after:auto}
    .cella{break-inside:avoid;page-break-inside:avoid}}
</style></head><body>
<div class="ctl">
  <span>Formazioni per foglio:</span>
  <span id="scelte"></span>
  <label><input type="checkbox" id="frecce" checked> frecce (da dove arriva)</label>
  <label title="un riquadro per ogni cambio di colore, effetto o posizione"><input type="checkbox" id="colori"> COLORI (tutti i passaggi)</label>
  <span id="conto"></span>
  <button class="stampa" id="pdf" style="display:none">SCARICA PDF</button>
  <button onclick="window.print()">STAMPA</button>
</div>
<form id="pdfform" method="post" action="/api/mappa-pdf" style="display:none"><textarea name="html"></textarea><input name="or"><input name="nome"></form>
<div class="scegli" id="scegli"></div>
<div id="pagine"></div>
<script>
const DATI = ${json};
// larghezza palco in mm per ogni impaginazione (A4, margini 10mm)
const LAYOUT = {
  1:  {or:"landscape", cols:1, rows:1, w:277, nome:"1 (enorme)"},
  4:  {or:"landscape", cols:2, rows:2, w:112, nome:"4 (grandi)"},   // 112: due righe stanno nel foglio (134 usciva sotto)
  8:  {or:"portrait",  cols:2, rows:4, w:92,  nome:"8 (medie)"},
  15: {or:"portrait",  cols:3, rows:5, w:60,  nome:"15 (piccole)"}
};
let per = 8;
try { const v = parseInt(localStorage.getItem("mappa_per")); if (LAYOUT[v]) per = v; } catch(e) {}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
// COPPIE: due racchette affiancate dello stesso ballerino -> una sola "pillola" con i due numeri
function vicine(a, b){ return a && b && Math.hypot(a[0]-b[0], (a[1]-b[1]) * 9/16) < 0.06; }
function coppieDi(pos){
  const c = {};
  if (!DATI.coppie || !pos) return c;
  for (let n = 1; n < DATI.racchette; n += 2) if (vicine(pos[n], pos[n+1])) { c[n] = n + 1; c[n+1] = n; }
  return c;
}
function cella(f, L, frecce){
  const coppiaDi = coppieDi(f.pos), coppiaPrima = coppieDi(f.prev);
  // con le coppie ogni ballerino e' una pillola larga quasi il doppio: pallini un po' piu' piccoli
  let dot = Math.max(4.2, Math.min(15, L.w * (DATI.coppie ? 0.056 : 0.07))) * (DATI.racchette > 20 ? 0.85 : 1);
  let svg = "";
  const mezzo = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  if (frecce && f.prev) {
    for (const n in f.pos) {
      const k = +n;
      let a = f.prev[n], b = f.pos[n];
      if (coppiaDi[k]) {                      // ballerino: una sola freccia, dal suo centro
        if (k > coppiaDi[k]) continue;
        b = mezzo(f.pos[k], f.pos[coppiaDi[k]]);
        a = f.prev[k] && f.prev[coppiaDi[k]] ? (coppiaPrima[k] === coppiaDi[k] ? mezzo(f.prev[k], f.prev[coppiaDi[k]]) : f.prev[k]) : f.prev[k];
      }
      if (!a || Math.hypot(a[0]-b[0], a[1]-b[1]) < 0.015) continue;
      svg += '<circle cx="'+(a[0]*160)+'" cy="'+(a[1]*90)+'" r="1.1" fill="none" stroke="#c4c4c4" stroke-width=".3"/>'
           + '<line x1="'+(a[0]*160)+'" y1="'+(a[1]*90)+'" x2="'+(b[0]*160)+'" y2="'+(b[1]*90)+'" stroke="#b4b4b4" stroke-width=".25" marker-end="url(#fr)"/>';
    }
  }
  if (DATI.coppie) {                          // coppia separata (diagonale, una sopra l'altra...): linea sottile
    for (let n = 1; n < DATI.racchette; n += 2) {
      const a = f.pos[n], b = f.pos[n + 1];
      if (a && b && !coppiaDi[n])
        svg += '<line x1="'+(a[0]*160)+'" y1="'+(a[1]*90)+'" x2="'+(b[0]*160)+'" y2="'+(b[1]*90)+'" stroke="#333" stroke-width=".45"/>';
    }
  }
  let dots = "";
  // MAPPA COLORI (f.col presente): pallino riempito col colore della racchetta, spenta = bianca
  // col bordo grigio sottile, sigla dell'effetto sotto. Senza f.col = mappa formazioni di sempre.
  const C = f.col || null;
  const fondo = n => (C && C[n] && C[n][0]) || "#fff";
  const testo = n => !C ? "" : !C[n] ? "#999" : (C[n][2] ? "#fff" : "#000");
  const sigla = (n, cl) => C && C[n] && C[n][1] ? '<em'+(cl ? ' class="'+cl+'"' : '')+'>'+esc(C[n][1])+'</em>' : '';
  for (const n in f.pos) {
    if (coppiaDi[n]) continue;                 // disegnata come pillola qui sotto
    const p = f.pos[n];
    dots += '<div class="d'+(C && !C[n] ? ' spenta' : '')+'" style="left:'+(p[0]*100)+'%;top:'+(p[1]*100)+'%'
          + (C && C[n] ? ';background:'+fondo(n)+';color:'+testo(n) : '')+'">' + n + sigla(n) + '</div>';
  }
  for (const n in coppiaDi) {
    const k = +n, c = coppiaDi[k];
    if (k > c) continue;
    const sx = f.pos[k][0] <= f.pos[c][0] ? k : c, dx = sx === k ? c : k;     // nell'ordine in cui stanno sul palco
    const m = mezzo(f.pos[k], f.pos[c]);
    if (C)                                     // meta' sinistra e meta' destra ognuna col suo colore
      dots += '<div class="d coppia" style="left:'+(m[0]*100)+'%;top:'+(m[1]*100)+'%;background:linear-gradient(90deg,'+fondo(sx)+' 50%,'+fondo(dx)+' 50%)">'
            + '<span style="color:'+testo(sx)+'">'+sx+'</span><i></i><span style="color:'+testo(dx)+'">'+dx+'</span>'+sigla(sx, "l")+sigla(dx, "r")+'</div>';
    else
    dots += '<div class="d coppia" style="left:'+(m[0]*100)+'%;top:'+(m[1]*100)+'%"><span>'+sx+'</span><i></i><span>'+dx+'</span></div>';
  }
  const marker = f.m1 ? (f.m1 === f.m2 ? 'marker '+f.m1 : 'marker '+f.m1+'–'+f.m2) : '';
  return '<div class="cella" style="--dot:'+dot+'mm;--num:'+(dot*0.5)+'mm;--capf:'+Math.max(2.6, Math.min(4.5, L.w*0.035))+'mm">'
    + '<div class="cap"><b>'+(C ? 'PASSAGGIO ' : 'FORMAZIONE ')+f.n+'</b><span>'+esc(f.daT)+' → '+esc(f.aT)+(marker ? ' · '+marker : '')+'</span></div>'
    + '<div class="stage"><svg viewBox="0 0 160 90" preserveAspectRatio="none"><defs><marker id="fr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#9a9a9a"/></marker></defs>'+svg+'</svg>'+dots+'</div>'
    + '<div class="pub">PUBBLICO</div></div>';
}
// SCELTA DELLE FORMAZIONI DA STAMPARE: quelle spente non si stampano; le altre vengono
// rinumerate, e frecce e orari si adattano come se quelle escluse non esistessero
// La casella COLORI cambia l'elenco: formazioni (come sempre) oppure tutti i passaggi coi colori.
const conColori = () => document.getElementById("colori").checked;
const sorgente = () => conColori() ? DATI.passi : DATI.forms;
let CHIAVE_ESCL = "", escluse = new Set();
function caricaEscluse(){
  CHIAVE_ESCL = (conColori() ? "mappa_escluse_colori:" : "mappa_escluse:") + DATI.titolo;
  escluse = new Set();
  try { escluse = new Set(JSON.parse(localStorage.getItem(CHIAVE_ESCL) || "[]")); } catch(e) {}
  escluse = new Set([...escluse].filter(da => sorgente().some(f => f.da === da)));
  if (escluse.size >= sorgente().length) escluse = new Set();
}
function scelte(){
  const tutte = sorgente(), ok = tutte.filter(f => !escluse.has(f.da)), fine = tutte[tutte.length - 1];
  return ok.map((f, i) => {
    const dopo = ok[i + 1];
    return Object.assign({}, f, { n: i + 1, prev: i ? ok[i - 1].pos : null,
      aT: dopo ? dopo.daT : fine.aT, m2: dopo ? Math.max(f.m1, dopo.m1 - 1) : fine.m2 });
  });
}
let pennello = null, ultimoClic = null;      // trascinamento in corso (true = toglie, false = rimette)
window.addEventListener("mouseup", () => { pennello = null; });
function metti(da, togli, quante){
  if (!togli) escluse.delete(da);
  else if (escluse.size < quante - 1) escluse.add(da);                      // almeno una resta
}
function salvaEscluse(){ try { localStorage.setItem(CHIAVE_ESCL, JSON.stringify([...escluse])); } catch(e) {} }
function disegnaScelta(){
  const tutte = sorgente(), box = document.getElementById("scegli"), col = conColori();
  if (tutte.length < 2) { box.style.display = "none"; return; }
  box.style.display = "";
  const nOk = tutte.length - escluse.size;
  box.innerHTML = '<div class="tit"><b>'+(col ? 'SCEGLI I PASSAGGI DA STAMPARE' : 'SCEGLI LE FORMAZIONI DA STAMPARE')+'</b><span>clicca per togliere o rimettere · tieni premuto e TRASCINA per farne tante insieme (o MAIUSC+clic) · stampo '+nOk+' su '+tutte.length+'</span>'
    + '<button id="tutteOn">TUTTE</button><button id="tutteOff">NESSUNA</button></div><div class="lista">'
    + tutte.map((f, i) => {
        let c = "";
        for (const n in f.pos) c += '<circle cx="'+(f.pos[n][0]*160)+'" cy="'+(f.pos[n][1]*90)+'" r="2.6" '
          + (!f.col ? 'fill="#111"' : f.col[n] ? 'fill="'+(f.col[n][0] || "#fff")+'" stroke="#111" stroke-width=".5"' : 'fill="#fff" stroke="#bbb" stroke-width=".5"')+'/>';
        return '<div class="mini'+(escluse.has(f.da) ? ' off' : '')+'" data-da="'+f.da+'" title="'+(escluse.has(f.da) ? 'esclusa: clicca per stamparla' : 'clicca per NON stamparla')+'">'
          + '<svg viewBox="0 0 160 90" preserveAspectRatio="none">'+c+'</svg><span>'+(escluse.has(f.da) ? '✕ ' : '✓ ')+esc(f.daT)+' · marker '+f.m1+'</span></div>';
      }).join("") + '</div>';
  // PIU' RIQUADRI INSIEME: tieni premuto e TRASCINA sopra le miniature (tutte prendono lo stato
  // della prima), oppure clic su una e MAIUSC+clic su un'altra (tutte quelle in mezzo).
  box.querySelectorAll(".mini").forEach(m => {
    m.onmousedown = (e) => {
      e.preventDefault();
      const da = +m.dataset.da, i = tutte.findIndex(f => f.da === da);
      if (e.shiftKey && ultimoClic !== null && ultimoClic !== i) {
        const togli = !escluse.has(tutte[ultimoClic].da) ? false : true;   // come quella cliccata prima
        for (let k = Math.min(i, ultimoClic); k <= Math.max(i, ultimoClic); k++) metti(tutte[k].da, togli, tutte.length);
      } else {
        pennello = !escluse.has(da);                                        // true = sto togliendo
        metti(da, pennello, tutte.length);
      }
      ultimoClic = i;
      salvaEscluse(); disegna();
    };
    m.onmouseenter = () => {
      if (pennello === null) return;
      const da = +m.dataset.da;
      if (escluse.has(da) === pennello) return;
      metti(da, pennello, tutte.length);
      ultimoClic = tutte.findIndex(f => f.da === da);
      salvaEscluse(); disegna();
    };
  });
  document.getElementById("tutteOn").onclick = () => { escluse = new Set(); try { localStorage.removeItem(CHIAVE_ESCL); } catch(e) {} disegna(); };
  document.getElementById("tutteOff").onclick = () => {                     // resta solo la prima
    escluse = new Set(tutte.slice(1).map(f => f.da)); salvaEscluse(); disegna();
  };
}
function disegna(){
  disegnaScelta();
  const L = LAYOUT[per], frecce = document.getElementById("frecce").checked, col = conColori();
  document.getElementById("pg").textContent = "@page{size:A4 "+L.or+";margin:10mm}";
  const perPag = L.cols * L.rows, F = scelte(), tot = Math.max(1, Math.ceil(F.length / perPag));
  let html = "";
  for (let p = 0; p < tot; p++) {
    const fette = F.slice(p*perPag, (p+1)*perPag);
    html += '<div class="pagina '+L.or+'"><div class="testa"><span><b>'+(col ? 'MAPPA COLORI' : 'MAPPA FORMAZIONI')+' — '+esc(DATI.titolo)+'</b>  ·  '+DATI.racchette+' racchette</span>'
         + '<span>foglio '+(p+1)+' di '+tot+'</span></div>'
         + (frecce || col ? '<div class="leg">'+[col ? 'pallino colorato = colore della racchetta · bianco col bordo grigio = spenta · scritta sotto = effetto' : '', frecce ? 'freccia grigia = da dove arriva' : ''].filter(Boolean).join(' · ')+'</div>' : '')
         + '<div class="griglia" style="grid-template-columns:repeat('+L.cols+','+L.w+'mm)">'+fette.map(f => cella(f, L, frecce)).join("")+'</div></div>';
  }
  document.getElementById("pagine").innerHTML = html;
  document.getElementById("conto").textContent = F.length + (col ? (F.length === 1 ? " passaggio" : " passaggi") : (F.length === 1 ? " formazione" : " formazioni")) + " → " + tot + (tot === 1 ? " foglio" : " fogli");
  document.getElementById("scelte").innerHTML = Object.keys(LAYOUT).map(k => '<button class="'+(+k===per?'on':'')+'" data-k="'+k+'">'+LAYOUT[k].nome+'</button>').join(" ");
  document.querySelectorAll("#scelte button").forEach(b => b.onclick = () => { per = +b.dataset.k; try { localStorage.setItem("mappa_per", per); } catch(e) {} disegna(); });
}
document.getElementById("frecce").onchange = disegna;
// SCARICA PDF: manda all'app i fogli cosi' come sono adesso; il PDF arriva nei Download
document.getElementById("pdf").onclick = () => {
  const f = document.getElementById("pdfform"), stili = [...document.querySelectorAll("style")].map(s => s.outerHTML).join("");
  f.html.value = '<!doctype html><html lang="it"><head><meta charset="utf-8">' + stili + '</head><body>' + document.getElementById("pagine").innerHTML + '</body></html>';
  f.or.value = LAYOUT[per].or;
  f.nome.value = (conColori() ? "Mappa colori " : "Mappa formazioni ") + DATI.titolo;
  f.submit();
};
try { document.getElementById("colori").checked = localStorage.getItem("mappa_colori") === "1"; } catch(e) {}
document.getElementById("colori").onchange = () => {
  try { localStorage.setItem("mappa_colori", conColori() ? "1" : "0"); } catch(e) {}
  ultimoClic = null; caricaEscluse(); disegna();
};
caricaEscluse();
disegna();
<\/script></body></html>`;
    // La mappa si apre in una scheda INDIPENDENTE (rel=noopener) con un indirizzo VERO.
    // Come finestra "figlia" dell'app (window.open) Safari la faceva girare nello stesso processo
    // dell'app: alla stampa quel processo veniva chiuso -> mappa vuota e app reinizializzata.
    // La richiesta e' sincrona per restare dentro il clic (se no Safari blocca la nuova scheda).
    // [mini app] niente server del Mac: la mappa si apre dentro la app (STAMPA = salva PDF)
    window.MiniApp.apriPagina(html, "MAPPA FORMAZIONI");
  });

  // ============================================================
  // VERIFICA (check pre-volo, non bloccante)
  // ============================================================
  $("co-verifica-btn").addEventListener("click", verifica);
  async function verifica() {
    const { racchette } = setup();
    const kf = keyframes();
    const problemi = [];
    if (!racchette) problemi.push(["errore", "Numero racchette non impostato."]);
    if (!kf.length) problemi.push(["errore", "Nessun marker: non c'è nulla da esportare."]);

    // 1. celle non valide (validazione fresca dal backend)
    const celle = new Set();
    for (const id in M.commands) for (const n in M.commands[id]) if (M.commands[id][n]) celle.add(M.commands[id][n]);
    let invalidi = {};
    if (celle.size) {
      try {
        const res = await fetch("/api/valida-celle", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ celle: [...celle] }),
        });
        if (res.ok) invalidi = (await res.json()).errori || {};
      } catch { /* best-effort */ }
    }
    celleInvalide = invalidi;
    for (const cella in invalidi) {
      let dove = "";
      for (const m of kf) { for (let n = 1; n <= racchette; n++) { if (M.commands[m.id] && M.commands[m.id][n] === cella) { dove = `racchetta ${n}, marker ${fmt(m.ms)}`; break; } } if (dove) break; }
      problemi.push(["errore", `Comando non valido "${cella}"${dove ? " (" + dove + ")" : ""}: ${invalidi[cella]}`]);
    }

    // 2. racchette spente per tutto lo show  3. HIT su marker consecutivi (un solo colpo)
    for (let n = 1; n <= racchette; n++) {
      let cur = null, accesaMai = false, prevHit = false, hitDup = false;
      for (const m of kf) {
        const c = M.commands[m.id] && M.commands[m.id][n];
        if (c !== undefined && c !== null) cur = c;
        const info = cur ? leggiCella(cur) : { tipo: "vuoto" };
        if (info.tipo === "colore" || info.tipo === "effetto") accesaMai = true;
        const isHit = /^HIT\b/.test((cur || "").toUpperCase());
        if (isHit && prevHit) hitDup = true;
        prevHit = isHit;
      }
      if (!accesaMai) problemi.push(["info", `Racchetta ${n}: spenta per tutto lo show.`]);
      // (due HIT di fila ora fanno due colpi: il primo sfuma a buio e riparte il secondo)
    }

    renderAll();
    mostraVerifica(problemi);
  }

  function mostraVerifica(problemi) {
    const cnt = (k) => problemi.filter((p) => p[0] === k).length;
    const ic = { errore: "✕", avviso: "!", info: "i" };
    const rows = problemi.length
      ? problemi.map(([k, msg]) => `<div class="co-ov-row ${k}"><span class="co-ov-ic">${ic[k]}</span><span>${esc(msg)}</span></div>`).join("")
      : `<div class="co-ov-row ok"><span class="co-ov-ic">✓</span><span>Tutto a posto: nessun problema rilevato.</span></div>`;
    overlay.innerHTML = `<div class="co-ov-box">
        <div class="co-ov-h">// VERIFICA SHOW <button class="co-ov-x" id="co-ov-x">×</button></div>
        <div class="co-ov-sum">${cnt("errore")} errori · ${cnt("avviso")} avvisi · ${cnt("info")} note</div>
        <div class="co-ov-list">${rows}</div>
      </div>`;
    overlay.style.display = "";
    $("co-ov-x").addEventListener("click", () => (overlay.style.display = "none"));
  }
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.style.display = "none"; });

  // ============================================================
  // ASSEGNAZIONE
  // ============================================================
  function assegnaAiSelezionati(cella) {
    if (!currentId) return t("Prima piazza almeno un marker", "err");
    if (!selected.size) return t("Seleziona almeno una racchetta", "err");
    if (!cella) return t("Comando incompleto (manca un parametro?)", "err");
    snap();
    const dove = markerBersaglio();
    for (const id of dove) {
      if (!M.commands[id]) M.commands[id] = {};
      for (const n of selected) M.commands[id][n] = cella;
    }
    ultimaCella = cella;
    validaLive();
    renderAll();
    if (dove.length > 1) t(`${cella} assegnato su ${dove.length} marker`, "ok");
  }
  // SU PIU' MARKER: se il pulsante e' acceso, il comando va su tutti i marker selezionati sulla waveform
  let multiOn = false, multiChiave = "";
  const markerSelezionati = () => (bridgeState.selezionati || []).filter((ms) => ms > 0)
    .map((ms) => M.markers.find((m) => m.ms === ms)).filter(Boolean);
  function markerBersaglio() {
    const sel = multiOn ? markerSelezionati() : [];
    return sel.length >= 2 ? sel.map((m) => m.id) : [currentId];
  }
  function aggiornaMulti() {
    const b = $("co-multi"); if (!b) return;
    const sel = markerSelezionati(), chiave = sel.map((m) => m.ms).join(",");
    if (chiave !== multiChiave) {                                              // selezione cambiata: si spegne da solo
      multiChiave = chiave; multiOn = false;
      if (typeof pannelloRiapri === "function") pannelloRiapri();              // CANONE/SCRIVI: aggiorna la riga TEMPO
    }
    b.style.display = sel.length >= 2 ? "" : "none";
    b.textContent = multiOn ? `ASSEGNO SU ${sel.length} MARKER: SÌ` : `ASSEGNA SU ${sel.length} MARKER: NO`;
    b.classList.toggle("on", multiOn);
  }
  $("co-assign").addEventListener("click", () => {
    const vals = readParams($("co-params"));
    brush.vals = vals;
    assegnaAiSelezionati(buildCella(brush.key, vals));
  });

  // ---- barra selezione ----
  function setSel(fn) { const { racchette } = setup(); selected = new Set(); for (let n = 1; n <= racchette; n++) if (fn(n)) selected.add(n); renderAll(); }
  document.querySelectorAll("[data-sel]").forEach((b) =>
    b.addEventListener("click", () => {
      const k = b.dataset.sel, { racchette } = setup();
      if (k === "tutti") setSel(() => true);
      else if (k === "pari") setSel((n) => n % 2 === 0);
      else if (k === "dispari") setSel((n) => n % 2 === 1);
      else if (k === "nessuno") selected = new Set();
      else if (k === "inverti") { const s = new Set(); for (let n = 1; n <= racchette; n++) if (!selected.has(n)) s.add(n); selected = s; }
      renderAll();
    }));

  // togli comando ai selezionati su questo marker (tornano a ereditare) — tasto x
  function eraseSelezionati() {
    if (!currentId || !selected.size) return;
    snap();
    for (const id of markerBersaglio()) if (M.commands[id]) for (const n of selected) delete M.commands[id][n];
    validaLive(); renderAll();
  }
  $("co-grid").addEventListener("click", () => { grigliaOn = !grigliaOn; renderStage(); });

  // ============================================================
  // DISPONI: cerchio / riga / fila / griglia (selezionate, o tutte se nessuna selezione)
  // ============================================================
  const STAGE_RAPP = STAGE_RAPP_C;              // il palco disegnato e' 16:9 (x e y vanno da 0 a 1)
  function formeGriglia(n, rapp) {
    // tutte le coppie colonne x righe che contengono n con meno di una riga vuota, ordinate per
    // quanto la forma assomiglia all'area disponibile (prima quelle senza buchi)
    const out = [];
    for (let rows = 1; rows <= n; rows++) {
      const cols = Math.ceil(n / rows);
      if ((rows - 1) * cols >= n) continue;
      const buchi = cols * rows - n;
      const forma = Math.abs(Math.log((cols / rows) / rapp));
      out.push({ cols, rows, voto: forma + (buchi ? 0.35 + buchi / n : 0) });
    }
    return out.sort((a, b) => a.voto - b.voto);
  }
  // area occupata dalle racchette interessate: tutto il palco, o attorno a dove sono le selezionate
  function chiEArea() {
    const { racchette } = setup();
    const scelte = espandiCoppie(selected);
    const chi = scelte.size >= 2 ? [...scelte].sort((a, b) => a - b) : Array.from({ length: racchette }, (_, i) => i + 1);
    // unita' da disporre: i ballerini (coppie) o le singole racchette
    const unita = [], viste = new Set(), inChi = new Set(chi);
    for (const k of chi) {
      if (viste.has(k)) continue;
      const c = coppieOn ? compagna(k) : null;
      if (c && inChi.has(c)) { const u = [Math.min(k, c), Math.max(k, c)]; unita.push(u); viste.add(u[0]); viste.add(u[1]); }
      else { unita.push([k]); viste.add(k); }
    }
    const n = unita.length;
    let cx = 0.5, cy = 0.5, w = 0.84, h = 0.72;
    if (chi.length < racchette) {                  // solo alcune (non: meno ballerini che racchette)
      const base = capturePos();
      cx = chi.reduce((s, k) => s + base[k][0], 0) / n;
      cy = chi.reduce((s, k) => s + base[k][1], 0) / n;
      w = Math.min(0.84, 0.05 + n * 0.07);
      h = Math.min(0.72, (0.05 + n * 0.07) * STAGE_RAPP * 0.6);
      cx = Math.min(1 - w / 2 - 0.04, Math.max(w / 2 + 0.04, cx));
      cy = Math.min(1 - h / 2 - 0.06, Math.max(h / 2 + 0.06, cy));
    }
    return { chi, unita, n, cx, cy, w, h };
  }
  // ASSEGNAZIONE PIU' CORTA (metodo ungherese): riga i -> colonna con la somma dei costi minima.
  // Serve a mandare ogni ballerino nel posto piu' vicino della formazione nuova.
  function assegnaMinimo(costo) {
    const n = costo.length, u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0), pp = new Array(n + 1).fill(0), via = new Array(n + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      pp[0] = i; let j0 = 0;
      const minv = new Array(n + 1).fill(Infinity), usato = new Array(n + 1).fill(false);
      do {
        usato[j0] = true;
        const i0 = pp[j0]; let delta = Infinity, j1 = 0;
        for (let j = 1; j <= n; j++) if (!usato[j]) {
          const cur = costo[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; via[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= n; j++) { if (usato[j]) { u[pp[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
        j0 = j1;
      } while (pp[j0] !== 0);
      do { const j1 = via[j0]; pp[j0] = pp[j1]; j0 = j1; } while (j0);
    }
    const perm = new Array(n);
    for (let j = 1; j <= n; j++) perm[pp[j] - 1] = j - 1;
    return perm;
  }
  let vicinoOn = true;
  try { if (localStorage.getItem("coreo_vicino") === "0") vicinoOn = false; } catch {}
  // unita[i] (ballerino o racchetta) ha i posti[i] (uno per racchetta): li ridistribuisce cosi' che
  // ognuno vada nel posto piu' vicino a dove sta ADESSO. Restituisce {racchetta: [x, y]}.
  function alPiuVicino(unita, posti) {
    // "dove sta adesso" = da dove ARRIVA: la formazione del marker precedente (non quella che stai
    // provando su questo marker: cosi' puoi provarne tante di fila e il conto resta giusto)
    const { racchette } = setup(), base = {};
    for (let n = 1; n <= racchette; n++) base[n] = posAlPrecedente(n) || defaultPos(n, racchette);
    const centro = (pp) => [pp.reduce((a, q) => a + q[0], 0) / pp.length, pp.reduce((a, q) => a + q[1], 0) / pp.length];
    const cb = posti.map(centro);
    const costo = unita.map((un) => {
      const c = centro(un.map((k) => base[k]));
      return posti.map((b, j) => b.length !== un.length ? 1e9 : ((c[0] - cb[j][0]) * 16) ** 2 + ((c[1] - cb[j][1]) * 9) ** 2);
    });
    const perm = assegnaMinimo(costo), out = {};
    unita.forEach((un, i) => {
      // dentro la coppia: chi e' a sinistra adesso resta a sinistra
      const ord = un.slice().sort((a, c) => base[a][0] - base[c][0] || a - c);
      const pst = posti[perm[i]].slice().sort((a, c) => a[0] - c[0]);
      ord.forEach((k, j) => { out[k] = pst[j]; });
    });
    return out;
  }
  function disponi(tipo, forma) {
    const { racchette } = setup();
    if (!racchette) return t("Imposta prima il numero di racchette", "err");
    if (!currentId) return t("Piazza prima un marker: la disposizione vale per la formazione del marker corrente", "err");
    const { chi, unita, n, cx, cy, w: w0, h } = chiEArea();
    // con le coppie la riga ha bisogno di piu' spazio (ogni ballerino e' largo due racchette)
    const conCoppie = unita.some((u) => u.length === 2);
    let w = tipo === "riga" && conCoppie ? Math.min(0.94, Math.max(w0, (n - 1) * DX_COPPIA * 2.2)) : w0;
    if (conCoppie) w = Math.min(w, 0.94 - DX_COPPIA);   // i centri dei ballerini: la coppia sporge di mezza racchetta per lato
    const pos = {};
    const lin = (i, tot) => (tot === 1 ? 0.5 : i / (tot - 1));
    const centri = [];                                 // un punto per ogni unita' (ballerino)
    if (tipo === "riga") {
      unita.forEach((u, i) => { centri.push([cx - w / 2 + w * lin(i, n), cy]); });
    } else if (tipo === "fila") {
      unita.forEach((u, i) => { centri.push([cx, cy + h / 2 - h * lin(i, n)]); });   // il primo davanti
    } else if (tipo === "cerchio") {
      // tondo vero sul palco 16:9; se i ballerini non ci stanno (coppie larghe) diventa un ovale
      // largo quanto serve, coi ballerini a distanza uguale lungo il bordo
      const r = Math.min(w / 2, (h / 2) / STAGE_RAPP);
      const largh = conCoppie ? DX_COPPIA * 2.6 : DX_COPPIA * 1.1;              // spazio per ogni unita'
      const rx = Math.min(w / 2, Math.max(r, (n * largh) / (2 * Math.PI)));
      const ry = rx > r ? h / 2 : r * STAGE_RAPP;
      // punti a passo costante lungo l'ellisse (lunghezza d'arco), partendo da dietro al centro
      const N = 720, lung = [0];
      const pt = (a) => [cx + rx * Math.sin(a), cy - ry * Math.cos(a)];
      for (let j = 1; j <= N; j++) {
        const p1 = pt((2 * Math.PI * (j - 1)) / N), p2 = pt((2 * Math.PI * j) / N);
        lung.push(lung[j - 1] + Math.hypot(p2[0] - p1[0], (p2[1] - p1[1]) / STAGE_RAPP));
      }
      unita.forEach((u, i) => {
        const obiettivo = (lung[N] * i) / n;
        let j = 0; while (j < N && lung[j + 1] < obiettivo) j++;
        centri.push(pt((2 * Math.PI * j) / N));
      });
    } else if (tipo === "cuore") {
      // CUORE: i ballerini a distanza uguale lungo il contorno, la punta verso il pubblico
      const N = 900, grezzi = [];
      for (let j = 0; j <= N; j++) {
        const a = Math.PI + (2 * Math.PI * j) / N;                        // si parte dalla punta
        grezzi.push([16 * Math.sin(a) ** 3, 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)]);
      }
      const ys = grezzi.map((q) => q[1]), yMin = Math.min(...ys), yMax = Math.max(...ys);
      const largo = Math.min(w, (h / STAGE_RAPP) * 1.35);                 // un po' piu' largo che alto
      const punti = grezzi.map(([x, y]) => [cx + (x / 16) * (largo / 2), cy + h / 2 - ((y - yMin) / (yMax - yMin)) * h]);
      const lung = [0];
      for (let j = 1; j <= N; j++) lung.push(lung[j - 1] + Math.hypot(punti[j][0] - punti[j - 1][0], (punti[j][1] - punti[j - 1][1]) / STAGE_RAPP));
      unita.forEach((u, i) => {
        const obiettivo = (lung[N] * i) / n;
        let j = 0; while (j < N && lung[j + 1] < obiettivo) j++;
        centri.push(punti[j]);
      });
    } else if (tipo === "v" || tipo === "v-r") {
      // "V": due bracci che si aprono dalla punta. Punta verso il pubblico (o dietro, se rovescia).
      // dispari: uno sulla punta e gli altri sui due bracci (-2 -1 0 +1 +2). Pari: nessuno sulla punta,
      // i due piu' vicini stanno a un passo dal centro (-2 -1 +1 +2), cosi' non si sovrappongono.
      const pari = n % 2 === 0;
      const prof = h * 0.8, mezzi = Math.max(1, pari ? n / 2 : (n - 1) / 2);
      const punta = tipo === "v" ? cy + prof / 2 : cy - prof / 2, verso = tipo === "v" ? -1 : 1;
      for (let k = 0; k < n; k++) {
        const i = pari ? (k < n / 2 ? k - n / 2 : k - n / 2 + 1) : k - (n - 1) / 2;
        centri.push([cx + (n === 1 ? 0 : (i / mezzi) * (w / 2)), punta + verso * prof * (Math.abs(i) / mezzi)]);
      }
    } else if (tipo === "righe") {
      // RIGHE SFALSATE: nessuno sta esattamente dietro a un altro (altrimenti sarebbero file).
      const R = Math.max(1, Math.min(forma.rows, n));
      const gh = Math.min(h, (R - 1) * 0.2);
      const yDi = (r) => (R === 1 ? cy : cy - gh / 2 + gh * (r / (R - 1)));
      const k = (n + Math.floor(R / 2)) / R;
      if (R > 1 && Number.isInteger(k) && k >= 2) {
        // i numeri tornano (es. 14 = 5 + 4 + 5): le righe pari hanno un ballerino in meno e stanno nei BUCHI
        const dx = w / (k - 1);
        for (let r = 0; r < R; r++) { const q = r % 2 ? k - 1 : k; for (let c = 0; c < q; c++) centri.push([cx + (c - (q - 1) / 2) * dx, yDi(r)]); }
      } else {
        // righe uguali (es. 18 = 6 + 6 + 6): una riga si' e una no spostata di mezzo passo
        const cols = Math.ceil(n / R), dx = cols > 1 ? w / (cols - 0.5) : 0;
        let fatti = 0;
        for (let r = 0; r < R && fatti < n; r++) {
          const q = Math.min(cols, n - fatti), sf = (r % 2 ? 1 : -1) * dx / 4;
          for (let c = 0; c < q; c++) centri.push([cx + (c - (q - 1) / 2) * dx + sf, yDi(r)]);
          fatti += q;
        }
      }
    } else if (tipo === "griglia") {
      const { cols, rows } = forma;
      // N RIGHE: le righe stanno vicine tra loro (non una in fondo e una davanti); N FILE: le file vicine
      const gw = forma.passoX ? Math.min(w, (cols - 1) * forma.passoX) : w;
      const gh = forma.passoY ? Math.min(h, (rows - 1) * forma.passoY) : h;
      unita.forEach((u, i) => {
        const r = Math.floor(i / cols), c = i % cols;
        const inRiga = r === rows - 1 ? n - cols * (rows - 1) : cols;           // ultima riga incompleta: centrata
        const off = (cols - inRiga) / 2;
        centri.push([cx - gw / 2 + gw * lin(c + off, cols), cy - gh / 2 + gh * lin(r, rows)]);
      });
    }
    if (tipo === "riga") {
      // tutte le racchette in fila sulla larghezza, a passo regolare (niente sovrapposizioni),
      // con mezzo passo in piu' tra un ballerino e l'altro
      const W = chi.length < setup().racchette ? w : 0.94;
      const slot = []; let sx = 0;
      unita.forEach((u, i) => { if (i) sx += 0.6; u.forEach((k) => { slot.push([k, sx]); sx += 1; }); });
      const tot = Math.max(1, sx - 1);
      for (const [k, v] of slot) pos[k] = [cx - W / 2 + W * (v / tot), cy];
    } else {
      // ogni ballerino: dispari a sinistra, pari a destra (guardando dal pubblico)
      unita.forEach((u, i) => {
        const [ux, uy] = centri[i];
        if (u.length === 2) { pos[u[0]] = [ux - DX_COPPIA / 2, uy]; pos[u[1]] = [ux + DX_COPPIA / 2, uy]; }
        else pos[u[0]] = [ux, uy];
      });
    }
    // ognuno al posto piu' vicino: stessi posti, ma distribuiti per fare meno strada possibile
    if (vicinoOn) Object.assign(pos, alPiuVicino(unita, unita.map((un) => un.map((k) => pos[k]))));
    snap();
    if (!M.positions[currentId]) M.positions[currentId] = {};
    for (const k of chi) M.positions[currentId][k] = [Math.min(0.97, Math.max(0.03, pos[k][0])), Math.min(0.97, Math.max(0.03, pos[k][1]))];
    renderAll();
  }
  document.querySelectorAll("[data-disp]").forEach((b) => b.addEventListener("click", () => { $("co-forme").style.display = "none"; disponi(b.dataset.disp); }));
  // N RIGHE / N FILE: una griglia con quel numero di righe (o di file)
  const disponiRigheFile = (righe, file) => {
    $("co-forme").style.display = "none";
    if (!setup().racchette) return t("Imposta prima il numero di racchette", "err");
    const { n } = chiEArea();
    if (righe) disponi("righe", { rows: righe });                                       // sfalsate, nei buchi
    else disponi("griglia", { cols: Math.min(file, n), rows: Math.ceil(n / Math.min(file, n)), passoX: 0.21 });
  };
  document.querySelectorAll("[data-righe]").forEach((b) => b.addEventListener("click", () => disponiRigheFile(+b.dataset.righe, 0)));
  document.querySelectorAll("[data-file]").forEach((b) => b.addEventListener("click", () => disponiRigheFile(0, +b.dataset.file)));
  // l'area FORMAZIONI si apre solo quando serve
  $("co-formaz-btn").addEventListener("click", () => {
    const pan = $("co-formaz-pan"), apri = pan.style.display === "none";
    pan.style.display = apri ? "" : "none";
    $("co-formaz-btn").textContent = apri ? "FORMAZIONI ▴" : "FORMAZIONI ▾";
    $("co-formaz-btn").classList.toggle("on", apri);
  });
  $("co-vicino").checked = vicinoOn;
  $("co-vicino").addEventListener("change", () => {
    vicinoOn = $("co-vicino").checked;
    try { localStorage.setItem("coreo_vicino", vicinoOn ? "1" : "0"); } catch {}
  });
  // GRIGLIA: mostra le forme possibili (la migliore per prima) e applica quella scelta
  $("co-disp-griglia-btn").addEventListener("click", () => {
    const box = $("co-forme");
    if (box.style.display !== "none") { box.style.display = "none"; return; }
    if (!setup().racchette) return t("Imposta prima il numero di racchette", "err");
    const { n, w, h } = chiEArea();
    const forme = formeGriglia(n, (w * STAGE_RAPP) / h).slice(0, 8);
    box.innerHTML = `<small>${n} ${coppieOn ? "ballerini" : "racchette"} in:</small>` + forme.map((f, i) =>
      `<button class="co-btn co-chip" data-cols="${f.cols}" data-rows="${f.rows}">${f.cols} × ${f.rows}${f.cols * f.rows > n ? ` <small>(${f.cols * f.rows - n} vuoti)</small>` : ""}</button>`).join("");
    box.style.display = "";
    box.querySelectorAll("[data-cols]").forEach((b) => b.addEventListener("click", () =>
      disponi("griglia", { cols: +b.dataset.cols, rows: +b.dataset.rows })));
  });

  // ALLINEA (come le icone sul desktop): ognuna sul punto della griglia piu' vicino, senza doppioni
  const PASSO_X = 1 / QUADRETTI, PASSO_Y = STAGE_RAPP / QUADRETTI;   // quadretti della griglia di riferimento
  function allinea() {
    const { racchette } = setup();
    if (!racchette) return t("Imposta prima il numero di racchette", "err");
    if (!currentId) return t("Piazza prima un marker", "err");
    const chi = selected.size >= 1 ? [...espandiCoppie(selected)] : Array.from({ length: racchette }, (_, i) => i + 1);
    const base = capturePos();
    const punto = (x, y) => `${x},${y}`;
    const occupati = new Set();
    // le racchette che NON si allineano e sono gia' su un punto lo tengono occupato
    for (let k = 1; k <= racchette; k++) if (!chi.includes(k)) {
      const gx = Math.round(base[k][0] / PASSO_X), gy = Math.round(base[k][1] / PASSO_Y);
      if (Math.abs(gx * PASSO_X - base[k][0]) < 1e-6 && Math.abs(gy * PASSO_Y - base[k][1]) < 1e-6) occupati.add(punto(gx, gy));
    }
    const maxX = Math.round(1 / PASSO_X) - 1, maxY = Math.round(1 / PASSO_Y) - 1;   // mai sul bordo del palco
    // unita': ballerini (coppia = due punti affiancati della griglia) o racchette singole
    const inChi = new Set(chi), viste = new Set(), unita = [];
    for (const k of chi.sort((a, b) => a - b)) {
      if (viste.has(k)) continue;
      const c = null;   // ALLINEA: ogni racchetta per conto suo (diagonali e coppie larghe restano come le hai fatte)
      // tiene il verso attuale della coppia (es. SCAMBIA per ballerino di schiena): a sinistra chi e' gia' a sinistra
      if (c && inChi.has(c)) { const u = base[k][0] <= base[c][0] ? [k, c] : [c, k]; unita.push(u); viste.add(k); viste.add(c); }
      else { unita.push([k]); viste.add(k); }
    }
    const centro = (u) => u.length === 2 ? [(base[u[0]][0] + base[u[1]][0]) / 2, (base[u[0]][1] + base[u[1]][1]) / 2] : base[u[0]];
    // posizione (in punti griglia) dell'unita': per la coppia, il punto della racchetta di sinistra
    const xIdeale = (u, x) => u.length === 2 ? x / PASSO_X - 0.5 : x / PASSO_X;
    // prima chi e' gia' piu' vicino al suo punto: cosi' si sposta il meno possibile
    const ordine = unita.map((u) => {
      const [x, y] = centro(u), gx = Math.round(xIdeale(u, x)), gy = Math.round(y / PASSO_Y);
      return { u, d: Math.hypot((gx - xIdeale(u, x)) * PASSO_X, (gy * PASSO_Y - y) / STAGE_RAPP) };
    }).sort((a, b) => a.d - b.d);
    const nuovo = {};
    for (const { u } of ordine) {
      const [x, y] = centro(u), largo = u.length;
      let best = null, bd = Infinity;
      const cx0 = Math.round(xIdeale(u, x)), cy0 = Math.round(y / PASSO_Y);
      for (let r = 0; r <= 30 && !best; r++) {          // cerca il posto libero piu' vicino, ad anelli
        for (let gx = cx0 - r; gx <= cx0 + r; gx++) for (let gy = cy0 - r; gy <= cy0 + r; gy++) {
          if (gx < 1 || gx + largo - 1 > maxX || gy < 1 || gy > maxY) continue;
          if (occupati.has(punto(gx, gy)) || (largo === 2 && occupati.has(punto(gx + 1, gy)))) continue;
          const d = Math.hypot((gx - xIdeale(u, x)) * PASSO_X, (gy * PASSO_Y - y) / STAGE_RAPP);
          if (d < bd) { bd = d; best = [gx, gy]; }
        }
      }
      if (!best) continue;
      u.forEach((k, j) => { occupati.add(punto(best[0] + j, best[1])); nuovo[k] = [(best[0] + j) * PASSO_X, best[1] * PASSO_Y]; });
    }
    snap();
    if (!M.positions[currentId]) M.positions[currentId] = {};
    Object.assign(M.positions[currentId], nuovo);
    grigliaOn = true;                                        // mostra la griglia: si vede l'allineamento
    renderAll();
  }
  $("co-allinea").addEventListener("click", allinea);
  // COPIA / INCOLLA FORMAZIONE: solo le posizioni, gli effetti non si toccano
  function copiaFormazione() {
    if (!setup().racchette) return t("Imposta prima il numero di racchette", "err");
    formazioneCopiata = JSON.parse(JSON.stringify(capturePos()));
    $("co-incolla-form").disabled = false;
    const kf = keyframes(), i = kf.findIndex((m) => m.id === currentId);
    t(`Formazione copiata${i >= 0 ? " dal marker " + (i + 1) : ""} (solo posizioni, senza effetti)`, "ok");
  }
  function incollaFormazione() {
    if (!formazioneCopiata) return t("Prima copia una formazione", "err");
    if (!currentId) return t("Piazza prima un marker", "err");
    const { racchette } = setup();
    snap();
    if (!M.positions[currentId]) M.positions[currentId] = {};
    for (let n = 1; n <= racchette; n++) if (formazioneCopiata[n]) M.positions[currentId][n] = formazioneCopiata[n].slice();
    renderAll();
    const kf = keyframes(), i = kf.findIndex((m) => m.id === currentId);
    t(`Formazione incollata${i >= 0 ? " sul marker " + (i + 1) : ""}: effetti invariati`, "ok");
  }
  $("co-copia-form").addEventListener("click", copiaFormazione);
  $("co-incolla-form").addEventListener("click", incollaFormazione);
  window.addEventListener("resize", () => { if (coppieOn) renderStage(); });
  function mostraCoppie() { $("co-coppie-btn").textContent = coppieOn ? "COPPIE: SÌ" : "COPPIE: NO"; $("co-coppie-btn").classList.toggle("on", coppieOn); }
  $("co-coppie-btn").addEventListener("click", () => {
    coppieOn = !coppieOn;
    try { localStorage.setItem("coreo_coppie", coppieOn ? "1" : "0"); } catch {}
    mostraCoppie(); renderAll();
    t(coppieOn ? "Coppie attive: 1-2, 3-4... si spostano e si dispongono insieme" : "Coppie disattivate: ogni racchetta si muove da sola", "ok");
  });
  mostraCoppie();
  // SCAMBIA: le due racchette di ogni coppia si scambiano di posto (di schiena / incrociate)
  $("co-scambia").addEventListener("click", () => {
    const { racchette } = setup();
    if (!racchette) return t("Imposta prima il numero di racchette", "err");
    if (!currentId) return t("Piazza prima un marker", "err");
    const quali = selected.size ? espandiCoppie(selected) : new Set(Array.from({ length: racchette }, (_, i) => i + 1));
    const base = capturePos();
    const coppie = [];
    for (let n = 1; n < racchette; n += 2) if (quali.has(n) && quali.has(n + 1)) coppie.push(n);
    if (!coppie.length) return t("Seleziona almeno un ballerino (le sue due racchette)", "err");
    snap();
    if (!M.positions[currentId]) M.positions[currentId] = {};
    for (const n of coppie) {
      M.positions[currentId][n] = base[n + 1].slice();
      M.positions[currentId][n + 1] = base[n].slice();
    }
    renderAll();
    t(`Scambiate ${coppie.length} ${coppie.length === 1 ? "coppia" : "coppie"} in questa formazione`, "ok");
  });
  $("co-undo").addEventListener("click", doUndo);
  $("co-redo").addEventListener("click", doRedo);
  $("co-prev").addEventListener("click", () => navMarker(-1));
  $("co-next").addEventListener("click", () => navMarker(+1));
  function navMarker(d) {
    const kf = keyframes(); if (!kf.length) return;
    let idx = kf.findIndex((m) => m.id === currentId);
    idx = Math.max(0, Math.min(kf.length - 1, (idx < 0 ? 0 : idx) + d));
    currentId = kf[idx].id;
    if (bridgeState.hasAudio) try { window.CoreoBridge.seek(kf[idx].ms); } catch {}
    renderAll();
  }

  // ============================================================
  // STAGE: selezione, drag, doppio click
  // ============================================================
  let drag = null;
  const stageXY = (e) => {
    const r = stage.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height), rect: r };
  };

  // doppio clic riconosciuto a mano: al primo clic il palco viene ridisegnato e il
  // "dblclick" del browser non arriva (il pallino cliccato non esiste piu')
  let ultimoClic = { n: null, t: 0 };
  stage.addEventListener("mousedown", (e) => {
    const dotEl = e.target.closest(".co-dot");
    const { x, y } = stageXY(e);
    const lineaEl = !dotEl && e.target.closest(".co-link");
    if (lineaEl) {                               // linea della coppia: seleziona e muove il ballerino
      const n = +lineaEl.dataset.coppia, coppia = [n, n + 1];
      if (e.shiftKey) coppia.forEach((k) => selected.add(k));
      else if (!(selected.has(n) && selected.has(n + 1))) selected = new Set(coppia);
      drag = { mode: "move", n, startX: x, startY: y, moved: false, base: capturePos(), chi: new Set(selected) };
      renderAll();
      return;
    }
    if (dotEl) {
      const n = parseInt(dotEl.dataset.n);
      const ora = Date.now();
      if (!e.shiftKey && ultimoClic.n === n && ora - ultimoClic.t < 450) {
        ultimoClic = { n: null, t: 0 };
        drag = null;
        apriMenu(n, e.clientX, e.clientY);
        renderAll();
        return;
      }
      ultimoClic = { n, t: ora };
      if (e.shiftKey) { selected.has(n) ? selected.delete(n) : selected.add(n); renderAll(); drag = null; return; }
      if (!selected.has(n)) selected = new Set([n]);
      drag = { mode: "move", n, startX: x, startY: y, moved: false, base: capturePos(), chi: new Set(selected) };
    } else {
      drag = { mode: "rubber", startX: x, startY: y, add: e.shiftKey };
      if (!e.shiftKey) selected = new Set();
      rubber.style.display = "";
      updateRubber(x, y, x, y);
    }
    renderAll();
  });

  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const { x, y } = stageXY(e);
    if (drag.mode === "move") {
      if (!drag.moved && (Math.abs(x - drag.startX) > 0.005 || Math.abs(y - drag.startY) > 0.005)) {
        drag.moved = true; snap();
      }
      if (drag.moved) {
        const dx = x - drag.startX, dy = y - drag.startY;
        if (!M.positions[currentId]) M.positions[currentId] = {};
        for (const n of drag.chi || selected) {
          const b = drag.base[n] || defaultPos(n, setup().racchette);
          M.positions[currentId][n] = [clamp01(b[0] + dx), clamp01(b[1] + dy)];
        }
        renderStage();
      }
    } else if (drag.mode === "rubber") {
      updateRubber(drag.startX, drag.startY, x, y);
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (!drag) return;
    if (drag.mode === "rubber") {
      const { x, y } = stageXY(e);
      const x1 = Math.min(drag.startX, x), x2 = Math.max(drag.startX, x);
      const y1 = Math.min(drag.startY, y), y2 = Math.max(drag.startY, y);
      const { racchette } = setup();
      if (!drag.add) selected = new Set();
      for (let n = 1; n <= racchette; n++) {
        const p = effettivo(n).pos || defaultPos(n, racchette);
        if (p[0] >= x1 && p[0] <= x2 && p[1] >= y1 && p[1] <= y2) selected.add(n);
      }
      rubber.style.display = "none";
    }
    if (drag.mode === "move" && drag.moved) autosave();
    drag = null;
    renderAll();
  });

  stage.addEventListener("dblclick", (e) => {
    const dotEl = e.target.closest(".co-dot");
    if (!dotEl || menu.style.display !== "none") return;   // gia' aperto dal mousedown
    const n = parseInt(dotEl.dataset.n);
    apriMenu(n, e.clientX, e.clientY);
    renderAll();
  });

  function capturePos() {
    const { racchette } = setup(), base = {};
    for (let n = 1; n <= racchette; n++) base[n] = effettivo(n).pos || defaultPos(n, racchette);
    return base;
  }
  function updateRubber(x1, y1, x2, y2) {
    const L = Math.min(x1, x2), T = Math.min(y1, y2), W = Math.abs(x2 - x1), H = Math.abs(y2 - y1);
    rubber.style.left = L * 100 + "%"; rubber.style.top = T * 100 + "%";
    rubber.style.width = W * 100 + "%"; rubber.style.height = H * 100 + "%";
  }

  // ============================================================
  // MENU singola racchetta (doppio click)
  // ============================================================
  // Menu a tessere: 1) scegli l'effetto  2) scegli i dettagli e clicca il COLORE = assegnato.
  // Vale per la racchetta cliccata o, se fa parte della selezione, per tutte le selezionate.
  const FX_ICONA = { ACCESO: "■", BUIO: "□", HIT: "✺", STROBO: "≋", FADE: "◐", BRILLANTINI: "✦", BPM: "♪",
    GLITCH: "⚡", LETTERA: "A", TRANSIZIONE: "➜", SPIRALE: "🌀", ASTERISCO: "✳", STELLA_ROTANTE: "✴",
    ARCOBALENO: "🌈", BRILLANTINI_MULTI: "✧", SFUMATURA: "▤" };
  const FX_GRUPPI = [
    ["FISSI", ["ACCESO", "BUIO"]],
    ["COLPI", ["HIT", "STROBO", "FADE"]],
    ["MOVIMENTO", ["BRILLANTINI", "BPM", "GLITCH", "SPIRALE", "ASTERISCO", "STELLA_ROTANTE", "ARCOBALENO", "BRILLANTINI_MULTI", "SFUMATURA"]],
    ["LETTERE", ["LETTERA", "TRANSIZIONE"]],
  ];
  // cosa fa ogni effetto, in due parole (si legge nel menu mentre scegli)
  const FX_NOTA = { ACCESO: "luce fissa", BUIO: "spenta", HIT: "colpo secco", STROBO: "lampeggia veloce",
    FADE: "si accende e si spegne piano", SFUMATURA: "cambia colore piano", BRILLANTINI: "puntini che saltano",
    LETTERA: "una lettera ferma", TRANSIZIONE: "onda che passa", GLITCH: "luce difettosa", BPM: "onde a tempo" };
  let ultimaCella = "";
  let menuDest = [];          // racchette a cui va il comando
  let menuXY = [0, 0];

  function apriMenu(n, cx, cy) {
    menuDest = selected.has(n) && selected.size > 1 ? [...selected] : [n];
    selected = new Set(menuDest);
    menuXY = [cx, cy];
    menuPasso1();
  }
  function titoloMenu() {
    return menuDest.length > 1 ? `${menuDest.length} racchette selezionate` : `Racchetta ${menuDest[0]}`;
  }
  function posizionaMenu() {
    menu.style.display = "";
    const mw = menu.offsetWidth || 330, mh = menu.offsetHeight || 300;
    menu.style.left = Math.max(10, Math.min(menuXY[0], window.innerWidth - mw - 10)) + "px";
    menu.style.top = Math.max(10, Math.min(menuXY[1], window.innerHeight - mh - 10)) + "px";
  }
  function applicaMenu(cella) {
    if (!cella) return t("Comando incompleto", "err");
    selected = new Set(menuDest);
    assegnaAiSelezionati(cella);
    chiudiMenu();
  }

  // PASSO 1: tessere degli effetti
  function menuPasso1() {
    const voci = vociMenu();
    const usate = new Set();
    const tessera = (v) => {
      usate.add(v.key);
      return `<button class="co-fx" data-k="${v.key}" title="${esc(FX_NOTA[v.key] || "")}"><span class="co-fx-i">${FX_ICONA[v.key] || "◆"}</span><span class="co-fx-t">${esc(v.key === "ACCESO" ? "COLORE" : v.label)}${FX_NOTA[v.key] ? `<small>${esc(FX_NOTA[v.key])}</small>` : ""}</span></button>`;
    };
    let html = `<div class="co-menu-h">${titoloMenu()}</div>`;
    if (ultimaCella) html += `<button class="co-ripeti" id="co-ripeti">↻ RIPETI: ${esc(ultimaCella)}</button>`;
    for (const [nome, chiavi] of FX_GRUPPI) {
      const vv = chiavi.map((k) => voci.find((v) => v.key === k)).filter(Boolean);
      if (vv.length) html += `<div class="co-fx-g"><span class="co-fx-gl">${nome}</span><div class="co-fx-row">${vv.map(tessera).join("")}</div></div>`;
    }
    const altri = voci.filter((v) => !usate.has(v.key));
    if (altri.length) html += `<div class="co-fx-g"><span class="co-fx-gl">ALTRI</span><div class="co-fx-row">${altri.map(tessera).join("")}</div></div>`;
    menu.innerHTML = html;
    posizionaMenu();
    const rip = $("co-ripeti");
    if (rip) rip.addEventListener("click", () => applicaMenu(ultimaCella));
    menu.querySelectorAll(".co-fx").forEach((b) => b.addEventListener("click", () => {
      const v = voci.find((x) => x.key === b.dataset.k);
      if (!v.params.length) return applicaMenu(buildCella(v.key, {}));   // BUIO & co: 1 clic
      menuPasso2(v);
    }));
  }

  // PASSO 2: dettagli (pulsanti) + colori (clic = assegna)
  function menuPasso2(v) {
    const vals = {};
    const chip = (p, val, lab, attivo) =>
      `<button class="co-chip2 ${attivo ? "on" : ""}" data-p="${p}" data-v="${esc(val)}">${esc(lab)}</button>`;
    let righe = "";
    for (const p of v.params) {
      if (p.type === "fade") {
        vals.fade = "";
        righe += `<div class="co-m2-r"><span class="co-m2-l">fade</span>` +
          [["", "fino al prossimo"], ["0.2", "0.2"], ["0.3", "0.3"], ["0.5", "0.5"], ["1", "1"], ["2", "2"], ["3", "3"]]
            .map(([val, lab]) => chip("fade", val, lab + (val ? " s" : ""), val === "")).join("") + `</div>`;
      } else if (p.type === "int") {
        vals[p.name] = "120";
        righe += `<div class="co-m2-r"><span class="co-m2-l">${esc(p.name)}</span>` +
          ["90", "100", "110", "120", "128", "140", "160"].map((x) => chip(p.name, x, x, x === "120")).join("") +
          `<input class="co-num co-m2-num" type="number" min="1" max="600" placeholder="altro" data-num="${p.name}"></div>`;
      } else if (p.type === "dir") {
        vals[p.name] = "DX";
        righe += `<div class="co-m2-r"><span class="co-m2-l">direzione</span>` +
          chip(p.name, "SX", "→ da sinistra", false) + chip(p.name, "DX", "← da destra", true) + `</div>`;
      } else if (p.type === "char" || p.type === "optchar") {
        vals[p.name] = "";
        righe += `<div class="co-m2-r co-m2-lett"><span class="co-m2-l">lettera${p.type === "optchar" ? " (facolt.)" : ""}</span>` +
          (p.type === "optchar" ? chip(p.name, "", "nessuna", true) : "") +
          "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) => chip(p.name, c, c, false)).join("") + `</div>`;
      }
    }
    const haColore = v.params.some((p) => p.type === "color");
    const colori = haColore
      ? `<div class="co-m2-r"><span class="co-m2-l">colore → assegna</span><div class="co-dots">` +
        (v.key === "SFUMATURA" ? `<button class="co-cdot" data-c="BUIO" title="BUIO" style="background:#000;border-color:#666"></button>` : "") +
        coloriAttivi().map((c) => `<button class="co-cdot" data-c="${c}" title="${c}" style="background:${cssColore(c)}"></button>`).join("") +
        `</div></div>`
      : `<button class="co-mini" id="co-m2-ok">ASSEGNA</button>`;
    menu.innerHTML = `<div class="co-menu-h"><button class="co-m2-back" id="co-m2-back">‹</button>
        ${FX_ICONA[v.key] || "◆"} ${esc(v.key === "ACCESO" ? "COLORE" : v.label)} · ${titoloMenu()}</div>` + righe + colori;
    posizionaMenu();
    $("co-m2-back").addEventListener("click", menuPasso1);
    menu.querySelectorAll(".co-chip2").forEach((b) => b.addEventListener("click", () => {
      vals[b.dataset.p] = b.dataset.v;
      menu.querySelectorAll(`.co-chip2[data-p="${b.dataset.p}"]`).forEach((x) => x.classList.toggle("on", x === b));
      const num = menu.querySelector(`[data-num="${b.dataset.p}"]`); if (num) num.value = "";
    }));
    menu.querySelectorAll("[data-num]").forEach((inp) => inp.addEventListener("input", () => {
      if (inp.value) { vals[inp.dataset.num] = inp.value; menu.querySelectorAll(`.co-chip2[data-p="${inp.dataset.num}"]`).forEach((x) => x.classList.remove("on")); }
    }));
    const manca = () => {
      const p = v.params.find((q) => q.type === "char" && !vals[q.name]);
      return p ? "Scegli prima la lettera" : "";
    };
    menu.querySelectorAll(".co-cdot").forEach((b) => b.addEventListener("click", () => {
      const m = manca(); if (m) return t(m, "err");
      applicaMenu(buildCella(v.key, { ...vals, colore: b.dataset.c }));
    }));
    const ok = $("co-m2-ok");
    if (ok) ok.addEventListener("click", () => { const m = manca(); if (m) return t(m, "err"); applicaMenu(buildCella(v.key, vals)); });
  }
  function chiudiMenu() { menu.style.display = "none"; menu.innerHTML = ""; }
  document.addEventListener("mousedown", (e) => {
    if (menu.style.display !== "none" && !menu.contains(e.target) && !e.target.closest(".co-dot")) chiudiMenu();
  });

  // ============================================================
  // VALIDAZIONE LIVE (non bloccante)
  // ============================================================
  let valTimer = null;
  function validaLive() {
    clearTimeout(valTimer);
    valTimer = setTimeout(async () => {
      const celle = new Set();
      for (const id in M.commands) for (const n in M.commands[id]) if (M.commands[id][n]) celle.add(M.commands[id][n]);
      if (!celle.size) { celleInvalide = {}; return; }
      try {
        const res = await fetch("/api/valida-celle", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ celle: [...celle] }),
        });
        if (res.ok) {
          const nuovi = (await res.json()).errori || {};
          const cambiato = JSON.stringify(nuovi) !== JSON.stringify(celleInvalide);
          celleInvalide = nuovi;
          if (cambiato) renderAll();            // (quasi sempre non cambia: niente ridisegno inutile)
        }
      } catch { /* best-effort */ }
    }, 400);
  }

  // ============================================================
  // EXPORT
  // ============================================================
  // costruisce la tabella compilata: restituisce { blob, fname } oppure null (errore gia' mostrato)
  async function tabellaCompilata() {
    const { titolo, racchette, master, telecomando } = setup();
    const kf = keyframes();
    if (!titolo) return t("Inserisci il titolo dello show (campo qui sopra)", "err"), null;
    if (!racchette) return t("Imposta il numero di racchette", "err"), null;
    if (telOn()) {
      if (!(telecomando > racchette && telecomando <= 99))
        return t(`Il numero del telecomando deve essere piu' alto del numero di racchette (${racchette}) e al massimo 99`, "err", 7000), null;
    } else if (!master || master < 1 || master > racchette) return t(`Master deve essere tra 1 e ${racchette}`, "err"), null;
    if (!kf.length) return t("Nessun marker oltre allo 0: piazzane qualcuno sulla waveform", "err"), null;

    const timecodes = kf.map((m) => m.ms);
    const righe = kf.map((m, i) => {
      const riga = [];
      for (let n = 1; n <= racchette; n++) {
        let v = (M.commands[m.id] && M.commands[m.id][n]) || "";
        if (i === 0 && !v) v = effettivo0(n) || "BUIO"; // prima riga sempre piena
        riga.push(v);
      }
      return riga;
    });

    try {
      const res = await fetch("/api/esporta-xlsx-coreografia", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titolo, racchette, master, telecomando, timecodes, righe, sections: bridgeState.sections, progetto: progNome || "" }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "errore"); }
      const blob = await res.blob();
      const fname = (titolo.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") || "show") + ".xlsx";
      return { blob, fname };
    } catch (e) { t(e.message, "err", 6000); return null; }
  }
  $("co-export").addEventListener("click", async () => {
    const r = await tabellaCompilata();
    if (!r) return;
    if (typeof downloadBlob === "function") downloadBlob(r.blob, r.fname);
    t("Tabella scaricata: " + r.fname + (progNome ? " (una copia e' anche nella cartella del progetto)" : ""), "ok", 5000);
  });
  // MANDA A CARICA SHOW: niente file da cercare, la tabella arriva gia' pronta nella scheda CARICA SHOW
  $("co-manda").addEventListener("click", async () => {
    salvaEmergenza();
    const r = await tabellaCompilata();
    if (!r) return;
    try { CURRENT_FILE = new File([r.blob], r.fname); } catch (e) { return t("Non riesco a passare la tabella: usa ESPORTA XLSX", "err"); }
    const tab = document.querySelector('.tab[data-tab="carica"]');
    if (tab) tab.click();
    window.dispatchEvent(new CustomEvent("ledshow-file"));
    setTimeout(() => window.dispatchEvent(new CustomEvent("ledshow-file")), 600);   // se CARICA SHOW si stava ancora aprendo
    t("Tabella pronta in CARICA SHOW: ora premi PREPARA CARICAMENTO", "ok", 6000);
  });
  // valore effettivo al primo keyframe (per riempire la prima riga)
  function effettivo0(n) {
    const first = keyframes()[0];
    return first && M.commands[first.id] && M.commands[first.id][n];
  }

  // ============================================================
  // SALVA / APRI / NUOVO + AUTOSAVE
  // ============================================================
  const AUTOSAVE_KEY = "coreo_autosave_v1";
  function progetto() {
    const s = setup();
    return {
      versione: 1, titolo: s.titolo, racchette: s.racchette,
      master: parseInt(document.getElementById("aa-master")?.value) || 1, telecomando: s.telecomando,
      markers: M.markers, commands: M.commands, positions: M.positions, groups: M.groups,
      sections: M.sezioni, audioNome: M.audioNome,
    };
  }
  // c'e' del lavoro? (almeno un effetto assegnato)
  const haLavoro = () => Object.values(M.commands).some((o) => o && Object.keys(o).length);
  // il ponte chiede i NOSTRI marker quando si carica l'audio (ripresa del lavoro)
  window.CoreoBridge.fornitore = () => haLavoro()
    ? { beats: M.markers.map((m) => m.ms), sections: M.sezioni, audioNome: M.audioNome } : null;
  // copia di sicurezza prima di cambiamenti grossi (si recupera con RIPRISTINA COPIA)
  const BACKUP_KEY = "coreo_backup_v1";
  function salvaCopia() {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(progetto())); } catch {}
    aggiornaBtnCopia();
  }
  function aggiornaBtnCopia() {
    let c = null;
    try { c = localStorage.getItem(BACKUP_KEY); } catch {}
    const b = document.getElementById("co-ripristina");
    if (b) b.style.display = c ? "" : "none";
  }
  function autosave() {
    if (!autosavePronto) return;
    clearTimeout(timerLocale);
    timerLocale = setTimeout(salvaLocale, 120);
    // copia di emergenza su file: al massimo 15 s dopo una modifica, anche se non ti fermi mai
    if (!timerDisco) timerDisco = setTimeout(salvaEmergenza, 15000);
  }

  // salvataggio nel browser (immediato per l'utente, ma fuori dal clic: non rallenta l'azione)
  let timerLocale = null, ultimoLocale = "";
  function salvaLocale() {
    clearTimeout(timerLocale); timerLocale = null;
    if (!autosavePronto) return;
    const testo = JSON.stringify(progetto());
    if (testo === ultimoLocale) return;
    try { localStorage.setItem(AUTOSAVE_KEY, testo); ultimoLocale = testo; } catch {}
    aggiornaProgInfo(testo);        // "modifiche non salvate" / "salvato"
  }
  window.addEventListener("pagehide", salvaLocale);
  document.addEventListener("visibilitychange", () => { if (document.hidden) salvaLocale(); });

  // ---- PROGETTO SU FILE (cartella APP_LED/PROGETTI) ----
  // Lo show lo salvi TU con SALVA PROGETTO: sovrascrive quello con lo stesso titolo; se hai cambiato
  // titolo diventa un ALTRO show (quello di prima resta com'era). Niente versioni.
  // Mentre lavori parte da sola solo una copia di EMERGENZA, in una cartella a parte
  // (_SALVATAGGI AUTOMATICI): non tocca mai lo show salvato e non compare in APRI PROGETTO.
  const PROG_KEY = "coreo_progetto_nome";
  let progNome = null;            // lo show salvato a cui appartiene il lavoro (null = mai salvato)
  let timerDisco = null, ultimoSalvato = "", ultimaEmergenza = "", salvando = false, oraSalvato = "", erroreDisco = "";
  let audioFile = null, audioInviatoA = null;   // la musica in uso e il progetto che ne ha gia' la copia
  try { progNome = localStorage.getItem(PROG_KEY) || null; } catch {}
  function ricordaProgNome(n) {
    progNome = n || null;
    try { n ? localStorage.setItem(PROG_KEY, n) : localStorage.removeItem(PROG_KEY); } catch {}
    aggiornaProgInfo();
  }
  const daSalvare = (testo) => haLavoro() && (testo || JSON.stringify(progetto())) !== ultimoSalvato;
  function aggiornaProgInfo(testo) {
    const e = $("co-prog-info"); if (!e) return;
    const sporco = daSalvare(testo);
    e.classList.toggle("err", !!erroreDisco);
    e.classList.toggle("da", !erroreDisco && sporco);
    e.textContent = erroreDisco ? "⚠ non salvato: " + erroreDisco
      : progNome ? `📁 ${progNome} · ` + (sporco ? "modifiche non salvate" : "salvato" + (oraSalvato ? " " + oraSalvato : ""))
      : haLavoro() ? "non ancora salvato: premi SALVA PROGETTO" : "";
  }
  const apiJ = async (url, opt) => {
    const res = await fetch(url, opt);
    let d = {}; try { d = await res.json(); } catch {}
    if (!res.ok) throw new Error(d.error || (res.status === 404 ? "chiudi e riapri l'app (serve la versione nuova)" : "errore " + res.status));
    return d;
  };
  // SALVA PROGETTO (anche ⌘S): scrive lo show col titolo di adesso
  async function salvaProgetto() {
    if (salvando) return false;
    if (!haLavoro()) { t("Non c'e' ancora niente da salvare", "err"); return false; }
    const titolo = setup().titolo;
    if (!titolo) { t("Scrivi prima il titolo dello show (campo in alto): diventa il nome con cui lo salvo", "err", 6000); return false; }
    const prima = progNome;
    if (titolo !== prima) {
      // titolo nuovo: e' un altro show. Se ne esiste gia' uno con quel nome, chiedo prima di scriverci sopra
      try {
        const d = await apiJ("/api/progetti");
        if (d.progetti.some((x) => x.nome.toLowerCase() === titolo.toLowerCase()) &&
            !confirm(`Esiste gia' uno show salvato come "${titolo}".\nLo sovrascrivo con questo?`)) return false;
      } catch {}
    }
    const testo = JSON.stringify(progetto());
    salvando = true;
    try {
      const r = await apiJ("/api/progetti/" + encodeURIComponent(titolo), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: testo });
      erroreDisco = "";
      oraSalvato = new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
      ricordaProgNome(r.nome);
      if (r.nome !== titolo && $("aa-titolo")) $("aa-titolo").value = r.nome;        // nome ripulito dai caratteri strani
      ultimoSalvato = r.nome !== titolo ? JSON.stringify(progetto()) : testo;
      aggiornaProgInfo();
      t(prima && prima !== r.nome ? `Salvato come show nuovo: "${r.nome}" ("${prima}" resta com'era)` : `Salvato: "${r.nome}"`, "ok", 5000);
      inviaAudio();
      return true;
    } catch (e) {
      erroreDisco = e.message; aggiornaProgInfo();
      t("Non salvato: " + e.message, "err", 7000);
      return false;
    } finally { salvando = false; }
  }
  // prima di lasciare lo show di adesso (APRI un altro, NUOVO): se ci sono modifiche, chiede se salvarle
  async function chiediSeSalvare() {
    if (!daSalvare()) return;
    const nome = setup().titolo || progNome;
    if (!nome) return;
    if (confirm(`Hai modifiche non salvate in "${nome}".\n\nOK = le salvo prima · Annulla = vado avanti senza salvarle`)) await salvaProgetto();
  }
  // COPIA DI EMERGENZA: parte da sola al massimo ogni 15 s mentre lavori; non tocca lo show salvato
  async function salvaEmergenza() {
    clearTimeout(timerDisco); timerDisco = null;
    if (!autosavePronto || !haLavoro()) return;
    const testo = JSON.stringify(progetto());
    if (testo === ultimaEmergenza || testo === ultimoSalvato) return;
    try {
      await apiJ("/api/emergenza/" + encodeURIComponent(progNome || setup().titolo || "SENZA TITOLO"), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: testo });
      ultimaEmergenza = testo;
    } catch (e) { console.warn("copia di emergenza non salvata:", e.message); }
  }
  // la musica viene copiata nella cartella dello show quando lo salvi: riaprendolo torna da sola
  async function inviaAudio() {
    if (!audioFile || !progNome || audioInviatoA === progNome) return;
    const f = audioFile, dest = progNome;
    audioInviatoA = dest;
    try {
      const fd = new FormData(); fd.append("file", f, f.name);
      await apiJ("/api/progetti/" + encodeURIComponent(dest) + "/audio", { method: "POST", body: fd });
    } catch (e) { if (audioInviatoA === dest) audioInviatoA = null; console.warn("musica non copiata nel progetto:", e.message); }
  }
  window.CoreoBridge.suAudio = (file) => { audioFile = file; audioInviatoA = null; inviaAudio(); };
  // chiusura o cambio scheda: manda subito la copia di emergenza
  const salvaAlVolo = () => {
    if (!autosavePronto || !haLavoro()) return;
    const testo = JSON.stringify(progetto());
    if (testo === ultimaEmergenza || testo === ultimoSalvato) return;
    try {
      if (navigator.sendBeacon("/api/emergenza/" + encodeURIComponent(progNome || setup().titolo || "SENZA TITOLO"),
                               new Blob([testo], { type: "application/json" }))) ultimaEmergenza = testo;
    } catch {}
  };
  window.addEventListener("pagehide", salvaAlVolo);
  document.addEventListener("visibilitychange", () => { if (document.hidden) salvaAlVolo(); });
  // ⌘S = SALVA PROGETTO (anche mentre scrivi il titolo)
  document.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || (e.key !== "s" && e.key !== "S")) return;
    const tab = document.getElementById("tab-audio");
    if (!tab || tab.style.display === "none") return;
    e.preventDefault();
    salvaProgetto();
  });
  function caricaProgetto(o, silenzioso) {
    if (!o || o.versione !== 1) return;
    M.markers = o.markers || [];
    M.commands = o.commands || {};
    M.positions = o.positions || {};
    M.groups = o.groups || {};
    M.sezioni = o.sections || [];
    M.audioNome = o.audioNome || "";
    // APRI PROGETTO: il titolo e' quello del progetto aperto (prima restava quello vecchio e l'export
    // usciva col nome sbagliato). Al riavvio (silenzioso) si tiene quello gia' scritto, se c'e'.
    if (o.titolo && $("aa-titolo") && (!silenzioso || !$("aa-titolo").value)) $("aa-titolo").value = o.titolo;
    if (o.racchette && $("aa-racchette")) $("aa-racchette").value = o.racchette;
    if (o.master && $("aa-master")) $("aa-master").value = o.master;
    // telecomando: fa parte dello show (uno show vecchio senza questa voce = master sulla racchetta)
    if ($("aa-tel")) { $("aa-tel").checked = !!o.telecomando; if (o.telecomando) $("aa-tel-num").value = o.telecomando; aggiornaTel(); }
    currentId = (keyframes()[0] || {}).id || null;
    // audio gia' caricato: rimette sulla waveform i marker del progetto (stessi ms -> stessi effetti)
    if (bridgeState.hasAudio) window.CoreoBridge.impostaMarker(M.markers.map((m) => m.ms), M.sezioni);
    validaLive(); renderAll();
    azzeraStoria();                 // progetto aperto: ⌘Z non deve tornare a quello di prima
    if (!silenzioso) t("Progetto caricato" + (bridgeState.hasAudio || !M.audioNome ? ""
      : ` — ora carica l'audio "${M.audioNome}": i marker tornano da soli`), "ok", 6000);
  }
  $("co-save").addEventListener("click", salvaProgetto);
  function scaricaCopia() {
    const blob = new Blob([JSON.stringify(progetto(), null, 2)], { type: "application/json" });
    const nome = ((progNome || setup().titolo).replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") || "progetto") + ".ledshow.json";
    if (typeof downloadBlob === "function") downloadBlob(blob, nome);
    t("Copia scaricata nei Download: " + nome, "ok");
  }

  // ---- APRI PROGETTO: elenco degli show salvati ----
  const quando = (sec) => {
    const d = new Date(sec * 1000), oggi = new Date();
    const ora = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    return d.toDateString() === oggi.toDateString() ? "oggi " + ora
      : d.toLocaleDateString("it-IT", { day: "numeric", month: "short", year: d.getFullYear() === oggi.getFullYear() ? undefined : "numeric" }) + " " + ora;
  };
  async function mostraProgetti() {
    let d;
    try { d = await apiJ("/api/progetti"); } catch (e) { return t("Elenco progetti non disponibile: " + e.message + " (riavvia l'app)", "err", 7000); }
    const righe = d.progetti.length ? d.progetti.map((p) => `
        <div class="co-pr ${p.nome === progNome ? "qui" : ""}" data-n="${esc(p.nome)}">
          <button class="co-pr-apri" data-az="apri" title="apri questo show">
            <b>${esc(p.nome)}</b>
            <small>${quando(p.modificato)} · ${p.racchette || "?"} racchette · ${p.marker || 0} marker${p.audio ? " · ♪ musica" : " · senza musica"}${p.nome === progNome ? " · APERTO ORA" : ""}</small>
          </button>
          <button class="co-btn co-chip" data-az="rinomina">RINOMINA</button>
          <button class="co-btn co-chip" data-az="duplica" title="copia da cui partire per uno show simile">DUPLICA</button>
          <button class="co-btn co-chip" data-az="cartella" title="crea lo zip di questo show da rimettere sul Mac, nella cartella PROGETTI">⬇ PER IL MAC</button>
          <button class="co-btn co-chip co-pr-del" data-az="elimina" title="sposta nel cestino dei progetti">✕</button>
        </div>`).join("")
      : `<div class="co-ov-row info"><span class="co-ov-ic">i</span><span>Nessuno show salvato ancora. Scrivi il titolo in alto e premi SALVA PROGETTO.</span></div>`;
    overlay.innerHTML = `<div class="co-ov-box co-ov-largo">
        <div class="co-ov-h">// I TUOI SHOW <button class="co-ov-x" id="co-ov-x">×</button></div>
        <div class="co-ov-sum">Qui trovi solo gli show che hai salvato tu con SALVA PROGETTO. Cartella: ${esc(d.cartella)}<br>
          Le copie automatiche di emergenza stanno a parte, nella cartella _SALVATAGGI AUTOMATICI.</div>
        <div class="co-ov-list">${righe}</div>
        <div class="co-pr-piede">
          <button class="co-btn co-chip" id="co-pr-file" title="un progetto .ledshow.json salvato con la versione vecchia dell'app">APRI DA FILE…</button>
          <button class="co-btn co-chip" id="co-pr-scarica" title="scarica una copia del progetto aperto (per mandarlo a qualcuno o tenerlo altrove)">SCARICA COPIA</button>
          <button class="co-btn co-chip" id="co-pr-finder" title="apri uno zip di show preparato sul Mac">⬆ IMPORTA DAL MAC (.zip)</button>
        </div>
      </div>`;
    overlay.style.display = "";
    $("co-ov-x").addEventListener("click", () => (overlay.style.display = "none"));
    $("co-pr-file").addEventListener("click", () => { overlay.style.display = "none"; $("co-file").click(); });
    $("co-pr-scarica").addEventListener("click", scaricaCopia);
    $("co-pr-finder").addEventListener("click", () => apiJ("/api/progetti-cartella", { method: "POST" }).catch((e) => t(e.message, "err")));
    overlay.querySelectorAll(".co-pr [data-az]").forEach((b) => b.addEventListener("click", () => azioneProgetto(b.closest(".co-pr").dataset.n, b.dataset.az)));
  }
  async function azioneProgetto(nome, az) {
    const url = "/api/progetti/" + encodeURIComponent(nome);
    const manda = (corpo) => apiJ(url + "/azione", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    try {
      if (az === "apri") { overlay.style.display = "none"; return apriDaDisco(nome); }
      if (az === "cartella") return void (await manda({ cosa: "cartella" }));
      if (az === "rinomina" || az === "duplica") {
        const nuovo = prompt(az === "rinomina" ? `Nuovo nome per "${nome}":` : `Nome della copia di "${nome}":`, az === "rinomina" ? nome : nome + " 2");
        if (!nuovo || !nuovo.trim() || nuovo.trim() === nome) return;
        const eraPulito = !daSalvare();
        const r = await manda({ cosa: az, nuovo: nuovo.trim() });
        if (az === "rinomina" && nome === progNome) {            // e' quello aperto: segue il nome nuovo
          if (audioInviatoA === nome) audioInviatoA = r.nome;
          if ($("aa-titolo")) $("aa-titolo").value = r.nome;
          ricordaProgNome(r.nome);
          if (eraPulito) ultimoSalvato = JSON.stringify(progetto());
          autosave(); aggiornaProgInfo();
        }
        t(az === "rinomina" ? `Rinominato in "${r.nome}"` : `Copia creata: "${r.nome}"`, "ok");
        return mostraProgetti();
      }
      if (az === "elimina") {
        if (!confirm(`Eliminare lo show "${nome}"?\n(Finisce nella cartella _cestino dentro PROGETTI: si puo' recuperare dal Finder.)`)) return;
        await manda({ cosa: "elimina" });
        if (nome === progNome) { ultimoSalvato = ""; ricordaProgNome(null); }
        return mostraProgetti();
      }
    } catch (e) { t(e.message, "err", 6000); }
  }
  // apre uno show salvato: progetto + (se c'e') la sua musica
  async function apriDaDisco(nome, silenzioso) {
    let d;
    try { d = await apiJ("/api/progetti/" + encodeURIComponent(nome)); } catch (e) { t(e.message, "err", 6000); return false; }
    if (nome !== progNome) await chiediSeSalvare();               // modifiche allo show di prima: le salvo?
    if (haLavoro()) salvaCopia();
    ricordaProgNome(nome);
    caricaProgetto(d.progetto, true);
    if ($("aa-titolo")) $("aa-titolo").value = nome;
    ultimoSalvato = JSON.stringify(progetto()); oraSalvato = ""; erroreDisco = ""; aggiornaProgInfo();
    autosave();
    if (!d.audio) { if (!silenzioso) t(`Aperto "${nome}". La musica non era salvata: caricala tu${M.audioNome ? ' ("' + M.audioNome + '")' : ""}, i marker tornano da soli`, "ok", 8000); return true; }
    try {
      if (!silenzioso) t(`Apro "${nome}" e la sua musica…`, "info", 3000);
      const blob = await (await fetch("/api/progetti/" + encodeURIComponent(nome) + "/audio")).blob();
      const f = new File([blob], M.audioNome || "musica.mp3", { type: blob.type });
      audioFile = f; audioInviatoA = nome;
      await window.CoreoBridge.caricaAudio(f, true);
    } catch (e) { t("Progetto aperto, ma la musica non si e' caricata: caricala tu", "err", 7000); }
    return true;
  }
  $("co-open").addEventListener("click", mostraProgetti);
  window.CoreoBridge.apriShow = (nome) => apriDaDisco(nome);    // per la scorciatoia RIPRENDI ULTIMO SHOW della HOME
  $("co-ripristina").addEventListener("click", () => {
    let o = null;
    try { o = JSON.parse(localStorage.getItem(BACKUP_KEY)); } catch {}
    if (!o) return t("Nessuna copia di sicurezza", "err");
    if (!confirm("Tornare alla copia di sicurezza? (la situazione attuale viene salvata come nuova copia)")) return;
    const ora = progetto();
    caricaProgetto(o);
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(ora)); } catch {}
  });
  $("co-file").addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      let o = null;
      try { o = JSON.parse(rd.result); } catch {}
      if (!o || o.versione !== 1) return t("File progetto non valido", "err");
      if (haLavoro()) salvaCopia();   // il lavoro che c'era prima non si perde: RIPRISTINA COPIA
      chiediSeSalvare().then(() => {
        ultimoSalvato = "";
        ricordaProgNome(null);        // viene da un file: diventa uno show salvato quando premi SALVA PROGETTO
        caricaProgetto(o);
        autosave();
      });
    };
    rd.readAsText(f);
    e.target.value = "";
  });
  // IMPORTA TABELLA: da un .xlsx gia' compilato riporta nell'editor marker ed effetti.
  // Le FORMAZIONI non stanno nella tabella: le posizioni partono da quelle di default.
  // La chiama la HOME col pulsante APRI COME SHOW dell'anteprima (window.CoreoBridge.importaTabella).
  async function importaTabella(f) {
    if (!f) return false;
    t("Leggo la tabella…", "info", 3000);
    let d;
    try {
      const fd = new FormData(); fd.append("file", f);
      fd.append("nomefile", f.name || "");      // titolo di riserva se la tabella non ha la riga del titolo
      const res = await fetch("/api/importa-tabella", { method: "POST", body: fd });
      d = await res.json();
      if (!res.ok) throw new Error(d.error || "errore");
    } catch (err) { t(err.message, "err", 9000); return false; }
    if (haLavoro()) salvaCopia();                 // il lavoro di prima non si perde: RIPRISTINA COPIA
    await chiediSeSalvare();
    ultimoSalvato = "";
    ricordaProgNome(null);                        // diventa uno show salvato quando premi SALVA PROGETTO
    caricaProgetto(d.progetto, true);
    // il titolo della tabella deve vincere: caricaProgetto in modo "silenzioso" lo cambia solo
    // se il campo e' vuoto (serve alla ripresa all'avvio), ma qui stiamo aprendo un altro show
    if ($("aa-titolo") && d.progetto.titolo) $("aa-titolo").value = d.progetto.titolo;
    autosave(); aggiornaProgInfo();
    // il messaggio arriva con un attimo di ritardo: venendo dalla HOME l'editor si carica adesso
    // e il suo saluto ("Coreografia ripresa...") coprirebbe questo, che e' quello che serve leggere
    setTimeout(() => t(`Tabella importata: ${d.racchette} racchette, ${d.marker} marker, ${d.celle} effetti` +
      (d.telecomando ? ` (master = telecomando ${d.telecomando})` : "") +
      ". Le FORMAZIONI non c'erano nella tabella: sono da fare. Ora carica la musica e premi SALVA PROGETTO.", "ok", 12000), 700);
    return true;
  }
  window.CoreoBridge.importaTabella = importaTabella;
  $("co-new").addEventListener("click", async () => {
    if (!confirm("Cominciare uno show NUOVO?\n" + (progNome ? `"${progNome}" resta salvato tra i tuoi show.` : "La coreografia di adesso viene svuotata.") + "\n(i marker sulla waveform restano)")) return;
    await chiediSeSalvare();                      // modifiche non salvate: le salvo prima?
    snap();
    if (haLavoro()) salvaCopia();   // ripensamento: RIPRISTINA COPIA
    M.commands = {}; M.positions = {}; M.groups = {};
    if (progNome) {                 // da qui in poi e' un altro progetto: non deve scrivere sopra a quello di prima
      const nuovo = prompt("Titolo del nuovo show:", "");
      ultimoSalvato = ""; oraSalvato = ""; ricordaProgNome(null);
      if ($("aa-titolo")) $("aa-titolo").value = (nuovo || "").trim().toUpperCase();
    }
    renderAll(); autosave(); aggiornaProgInfo();
    t("Show nuovo: coreografia vuota" + (document.getElementById("co-ripristina").style.display === "" ? " (copia di sicurezza salvata)" : ""), "ok");
  });

  // ============================================================
  // RIALLINEAMENTO MARKER (dal ponte) — riconciliazione per diff
  // ============================================================
  function reconcile(beats) {
    const incoming = beats.slice().sort((a, b) => a - b);
    const known = M.markers.slice();
    const usedIn = new Array(incoming.length).fill(false);
    const matched = [];
    for (const k of known) {
      const idx = incoming.findIndex((ms, i) => !usedIn[i] && ms === k.ms);
      if (idx >= 0) { usedIn[idx] = true; matched.push(k); }
    }
    const removed = known.filter((k) => !matched.includes(k));
    const addedMs = incoming.filter((ms, i) => !usedIn[i]);
    // piu' marker spostati tutti della stessa quantita' (spostamento di gruppo, o il suo ⌘Z):
    // sono gli STESSI marker -> tengono id, effetti e posizioni
    const rs = removed.slice().sort((a, b) => a.ms - b.ms), as = addedMs.slice().sort((a, b) => a - b);
    const gruppo = rs.length > 1 && rs.length === as.length && rs.every((k, i) => as[i] - k.ms === as[0] - rs[0].ms);
    // stanno per sparire piu' marker con effetti: prima una copia di sicurezza
    if (!gruppo && removed.length > 1 && removed.some((r) => M.commands[r.id] && Object.keys(M.commands[r.id]).length)) {
      salvaCopia();
      t("Hai tolto piu' marker che avevano effetti: se non volevi, ⌘Z li rimette con i loro effetti", "info", 6000);
    }
    if (gruppo) {
      rs.forEach((k, i) => { k.ms = as[i]; matched.push(k); });
    } else if (removed.length === 1 && addedMs.length === 1) {
      removed[0].ms = addedMs[0]; matched.push(removed[0]); // spostamento: tiene id + dati
    } else {
      for (const r of removed) { delete M.commands[r.id]; delete M.positions[r.id]; }
      for (const ms of addedMs) matched.push({ id: uid(), ms });
    }
    matched.sort((a, b) => a.ms - b.ms);
    M.markers = matched;
    if (!markerById(currentId)) currentId = (keyframes()[0] || {}).id || null;
  }

  window.CoreoBridge.subscribe((s) => {
    const cambioAudio = s.hasAudio && (!bridgeState.hasAudio || (s.audioNome || "") !== (bridgeState.audioNome || ""));
    bridgeState = s;
    // senza audio la waveform e' vuota: non toccare i marker della coreografia (verrebbero cancellati)
    if (!s.hasAudio) { renderAll(); return; }
    M.sezioni = s.sections || [];
    M.audioNome = s.audioNome || M.audioNome;
    reconcile(s.beats);
    if (s.focusMs != null) {                     // clic su un marker della waveform: mostra la sua formazione
      const m = M.markers.find((k) => k.ms === s.focusMs && k.ms > 0);
      if (m) currentId = m.id;
    }
    renderAll();
    if (cambioAudio) azzeraStoria();          // musica appena caricata: ⌘Z riparte da qui
    autosave();
  });

  // TELECOMANDO: casella + numero (il numero si ricorda per gli show nuovi)
  function aggiornaTel() {
    if (!$("aa-tel")) return;
    $("aa-master").disabled = telOn();
    $("aa-tel-num").disabled = !telOn();
  }
  if ($("aa-tel")) {
    try {
      const ric = JSON.parse(localStorage.getItem("coreo_telecomando") || "null");
      if (ric) { $("aa-tel").checked = !!ric.on; if (ric.numero) $("aa-tel-num").value = ric.numero; }
    } catch {}
    aggiornaTel();
    ["aa-tel", "aa-tel-num"].forEach((id) => $(id).addEventListener("input", () => {
      try { localStorage.setItem("coreo_telecomando", JSON.stringify({ on: telOn(), numero: parseInt($("aa-tel-num").value) || 37 })); } catch {}
      aggiornaTel(); renderAll();
    }));
  }
  // reazioni ai campi setup (racchette / master / titolo)
  ["aa-racchette", "aa-master", "aa-titolo"].forEach((id) => {
    const e = $(id);
    if (e) e.addEventListener("input", () => renderAll());
  });

  // ============================================================
  // STRUMENTI per comporre in fretta: CANONE, SCRIVI, COPIA/INCOLLA TRATTO,
  // GRUPPI e FORMAZIONI salvati (libreria comune a tutti gli show)
  // ============================================================
  const pannello = $("co-pannello");
  let pannelloAperto = "";
  function chiudiPannello() {
    pannello.style.display = "none"; pannello.innerHTML = ""; pannelloAperto = "";
    calcolaPassiPannello = null;
    if (passiSuiPallini) { passiSuiPallini = null; renderStage(); }
  }
  // i marker selezionati sulla waveform sono cambiati mentre CANONE o SCRIVI e' aperto: lo ridisegno
  function pannelloRiapri() {
    const quale = pannelloAperto;
    if (quale !== "canone" && quale !== "scrivi") return;
    pannelloAperto = "";
    quale === "canone" ? apriCanone(true) : apriScrivi();
  }
  function apriPannello(nome, html) {
    calcolaPassiPannello = null; passiSuiPallini = null;
    pannello.innerHTML = `<button class="co-ov-x co-pan-x" id="co-pan-x" title="chiudi">×</button>` + html;
    pannello.style.display = ""; pannelloAperto = nome;
    $("co-pan-x").addEventListener("click", chiudiPannello);
  }
  $("co-multi").addEventListener("click", () => { multiOn = !multiOn; aggiornaMulti(); });

  // ---- LIBRERIA: gruppi (liste ordinate di racchette) e formazioni (posizioni) ----
  let LIB = { gruppi: {}, formazioni: {} };
  async function caricaLibreria() {
    try { const d = await apiJ("/api/libreria"); LIB = { gruppi: d.gruppi || {}, formazioni: d.formazioni || {} }; } catch {}
    renderLibreria();
  }
  async function salvaLibreria() {
    renderLibreria();
    try { await apiJ("/api/libreria", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(LIB) }); }
    catch (e) { t("Libreria non salvata: " + e.message, "err", 6000); }
  }
  function renderLibreria() {
    const { racchette } = setup();
    const chip = (tipo, nome, extra) => `<span class="co-libchip" data-t="${tipo}" data-n="${esc(nome)}" title="${esc(extra)}">${esc(nome)}<i data-x="1" title="elimina">×</i></span>`;
    const g = Object.keys(LIB.gruppi), f = Object.keys(LIB.formazioni);
    $("co-gruppi").innerHTML = g.length ? g.map((n) => chip("g", n, `racchette ${LIB.gruppi[n].join(", ")} — clic: seleziona (MAIUSC: aggiunge)`)).join("") : `<small>nessuno</small>`;
    $("co-formaz").innerHTML = f.length ? f.map((n) => chip("f", n, `${LIB.formazioni[n].racchette} racchette — clic: mette questa formazione sul marker di adesso`)).join("") : `<small>nessuna</small>`;
    document.querySelectorAll(".co-libchip").forEach((c) => c.addEventListener("click", (e) => {
      const nome = c.dataset.n, gruppo = c.dataset.t === "g";
      if (e.target.dataset.x) {
        if (!confirm(`Eliminare ${gruppo ? "il gruppo" : "la formazione"} "${nome}" dalla libreria?`)) return;
        delete (gruppo ? LIB.gruppi : LIB.formazioni)[nome];
        return salvaLibreria();
      }
      if (gruppo) {
        const lista = LIB.gruppi[nome].filter((n) => n <= racchette);
        selected = e.shiftKey ? new Set([...selected, ...lista]) : new Set(lista);    // l'ordine salvato resta
        renderAll();
      } else applicaFormazione(nome);
    }));
  }
  $("co-gruppo-salva").addEventListener("click", () => {
    if (!selected.size) return t("Seleziona prima le racchette del gruppo", "err");
    const nome = (prompt(`Nome del gruppo (${selected.size} racchette: ${[...selected].join(", ")}):`, "") || "").trim().toUpperCase().slice(0, 24);
    if (!nome) return;
    if (LIB.gruppi[nome] && !confirm(`Esiste gia' un gruppo "${nome}": lo sostituisco?`)) return;
    LIB.gruppi[nome] = [...selected];
    salvaLibreria(); t(`Gruppo "${nome}" salvato (vale per tutti gli show)`, "ok");
  });
  $("co-formaz-salva").addEventListener("click", () => {
    const { racchette } = setup();
    if (!racchette) return t("Imposta prima il numero di racchette", "err");
    const nome = (prompt("Nome della formazione (es. RIGA LARGA, CERCHIO, V):", "") || "").trim().toUpperCase().slice(0, 24);
    if (!nome) return;
    if (LIB.formazioni[nome] && !confirm(`Esiste gia' una formazione "${nome}": la sostituisco?`)) return;
    const pos = capturePos();
    LIB.formazioni[nome] = { racchette, pos: Object.fromEntries(Object.entries(pos).map(([k, v]) => [k, [+v[0].toFixed(4), +v[1].toFixed(4)]])) };
    salvaLibreria(); t(`Formazione "${nome}" salvata (vale per tutti gli show)`, "ok");
  });
  function applicaFormazione(nome) {
    const f = LIB.formazioni[nome]; if (!f) return;
    if (!currentId) return t("Piazza prima un marker", "err");
    const { racchette } = setup();
    // i posti della formazione salvata (a coppie se COPPIE e' attivo); "al posto piu' vicino" li ridistribuisce
    const nuove = {}, unita = [], viste = new Set();
    for (let n = 1; n <= racchette; n++) {
      if (!f.pos[n] || viste.has(n)) continue;
      const c = coppieOn ? compagna(n) : null;
      if (c && f.pos[c] && !viste.has(c)) { unita.push([n, c]); viste.add(n); viste.add(c); } else { unita.push([n]); viste.add(n); }
    }
    if (vicinoOn && unita.length > 1) Object.assign(nuove, alPiuVicino(unita, unita.map((un) => un.map((k) => f.pos[k]))));
    else for (const un of unita) for (const k of un) nuove[k] = f.pos[k];
    snap();
    if (!M.positions[currentId]) M.positions[currentId] = {};
    let messe = 0;
    for (const k in nuove) { M.positions[currentId][k] = nuove[k].slice(); messe++; }
    renderAll();
    t(`Formazione "${nome}" messa su questo marker` + (messe < racchette ? ` (aveva ${f.racchette} racchette: le altre restano dov'erano)` : ""), "ok");
  }

  // ---- ORDINE: in che ordine partono le racchette ----
  const ORDINI = [["sx", "→ da sinistra"], ["dx", "← da destra"], ["centro", "dal centro"], ["lati", "dai lati"],
    ["dietro", "da dietro"], ["davanti", "da davanti"], ["num", "1 → N"], ["numinv", "N → 1"], ["sel", "come le ho scelte"]];
  // restituisce i PASSI: lista di liste di racchette. perBallerino = le coppie restano unite.
  function passiOrdinati(chi, ordine, perVolta, perBallerino) {
    const pos = capturePos(), inChi = new Set(chi), viste = new Set(), unita = [];
    for (const k of chi) {
      if (viste.has(k)) continue;
      const c = perBallerino && coppieOn ? compagna(k) : null;
      if (c && inChi.has(c)) { unita.push([Math.min(k, c), Math.max(k, c)]); viste.add(k); viste.add(c); }
      else { unita.push([k]); viste.add(k); }
    }
    const cx = (u) => u.reduce((a, k) => a + pos[k][0], 0) / u.length, cy = (u) => u.reduce((a, k) => a + pos[k][1], 0) / u.length;
    const chiave = { sx: (u) => cx(u), dx: (u) => -cx(u), centro: (u) => Math.abs(cx(u) - 0.5), lati: (u) => -Math.abs(cx(u) - 0.5),
      dietro: (u) => cy(u), davanti: (u) => -cy(u), num: (u) => u[0], numinv: (u) => -u[0] }[ordine];
    let passi;
    if (!chiave) passi = unita.map((u) => u.slice());                       // "sel": l'ordine in cui le hai scelte
    else {
      const ord = unita.map((u, i) => ({ u, k: chiave(u), i })).sort((a, b) => a.k - b.k || a.i - b.i);
      const diPosizione = !ordine.startsWith("num");
      passi = [];
      for (const o of ord) {
        const ult = passi[passi.length - 1];
        // stessa posizione (entro un terzo di quadretto) = partono insieme (es. le due meta' simmetriche)
        if (diPosizione && ult && Math.abs(o.k - ult.k) < 0.011) { ult.r.push(...o.u); ult.k = o.k; }
        else passi.push({ r: o.u.slice(), k: o.k });
      }
      passi = passi.map((x) => x.r);
    }
    if (perVolta > 1) {                                                     // a gruppi di N passi per volta
      const out = [];
      for (let i = 0; i < passi.length; i += perVolta) out.push([].concat(...passi.slice(i, i + perVolta)));
      passi = out;
    }
    return passi;
  }
  // ---- TEMPO: dove cadono i passi ----
  // modo "tra": tra i due marker selezionati sulla waveform · "ogni": uno ogni N ms da questo marker
  // "marker": sui marker che ci sono gia', da questo in avanti. Restituisce {tempi} o {errore}.
  // giri = quante volte si ripete il giro (uno per colore): i giri dopo il primo continuano
  // con lo stesso passo, subito dopo (come tre Interpola uguali uno dietro l'altro).
  function tempiPassi(n, modo, ogniMs, finoAllUltimo, giri) {
    const kf = keyframes(), cur = markerById(currentId), tot = n * Math.max(1, giri || 1);
    if (modo === "tra") {
      const sel = (bridgeState.selezionati || []).filter((ms) => ms > 0);
      if (sel.length !== 2) return { errore: "Seleziona sulla waveform i DUE marker di inizio e fine (come per Interpola)" };
      const [a, b] = sel, div = finoAllUltimo ? Math.max(1, n - 1) : n;
      return { tempi: Array.from({ length: tot }, (_, k) => Math.round(a + (k * (b - a)) / div)) };
    }
    if (!cur) return { errore: "Piazza prima un marker" };
    if (modo === "marker") {
      const i = kf.findIndex((m) => m.id === cur.id);
      if (kf.length - i < tot) return { errore: `Servono ${tot} marker da qui in avanti: ce ne sono ${kf.length - i}. Usa "uno ogni … ms" (li crea lui)` };
      return { tempi: kf.slice(i, i + tot).map((m) => m.ms) };
    }
    if (!(ogniMs >= 20)) return { errore: "Il tempo tra un passo e l'altro deve essere almeno 20 ms" };
    return { tempi: Array.from({ length: tot }, (_, k) => cur.ms + k * ogniMs) };
  }
  // crea i marker che mancano e restituisce gli id dei marker a quei tempi (o null se non si puo')
  function markerAi(tempi) {
    const dur = bridgeState.durationMs || 0;
    if (!bridgeState.hasAudio) { t("Carica prima la musica: i marker stanno sulla waveform", "err"); return null; }
    if (tempi.some((ms) => ms <= 0 || (dur && ms > dur))) { t("Qualche passo cadrebbe fuori dalla musica: accorcia il tempo o parti prima", "err", 6000); return null; }
    for (let i = 1; i < tempi.length; i++) if (tempi[i] - tempi[i - 1] < 20) { t("Passi troppo fitti (meno di 20 ms): allarga il tratto o fai gruppi piu' grandi", "err", 6000); return null; }
    const esistenti = new Set(M.markers.map((m) => m.ms));
    const mancanti = tempi.filter((ms) => !esistenti.has(ms));
    if (mancanti.length) window.CoreoBridge.aggiungiMarker(mancanti);       // (il ponte riallinea subito M.markers)
    const ids = tempi.map((ms) => (M.markers.find((m) => m.ms === ms) || {}).id);
    if (ids.some((x) => !x)) { t("Non sono riuscito a creare tutti i marker", "err"); return null; }
    return { ids, nuovi: mancanti.length };
  }
  // scrive una sequenza: passi[k] = { celle: {racchetta: cella} } al marker ids[k]
  function scriviSequenza(ids, passi) {
    snap();
    passi.forEach((p, k) => {
      if (!M.commands[ids[k]]) M.commands[ids[k]] = {};
      Object.assign(M.commands[ids[k]], p);
    });
    validaLive();
    currentId = ids[0];
    renderAll();
  }
  const cellaBrush = () => { const v = readParams($("co-params")); brush.vals = v; return buildCella(brush.key, v); };
  const chiLavora = () => {
    const { racchette } = setup();
    return selected.size >= 2 ? [...selected] : Array.from({ length: racchette }, (_, i) => i + 1);
  };
  const tempoHTML = (pref) => {
    const sel = (bridgeState.selezionati || []).filter((ms) => ms > 0);
    return `<div class="co-pan-r"><span class="co-pan-l">TEMPO</span>
        <label class="co-pan-o"><input type="radio" name="${pref}-tempo" value="tra" ${sel.length === 2 ? "checked" : "disabled"}>
          tra i 2 marker selezionati sulla waveform ${sel.length === 2 ? `(${fmt(sel[0])} → ${fmt(sel[1])})` : "<small>(selezionane due, come per Interpola)</small>"}</label>
        <label class="co-pan-o"><input type="radio" name="${pref}-tempo" value="ogni" ${sel.length === 2 ? "" : "checked"}>
          da questo marker, uno ogni <input class="co-num" id="${pref}-ms" type="number" min="20" max="5000" step="10" value="100"> ms</label>
        <label class="co-pan-o"><input type="radio" name="${pref}-tempo" value="marker"> sui marker che ci sono gia' da qui in avanti</label>
        <label class="co-pan-o co-pan-sub"><input type="checkbox" id="${pref}-fino"> l'ultimo arriva proprio sul marker finale</label>
      </div>`;
  };
  const leggiTempo = (pref, n, giri) => tempiPassi(n, (pannello.querySelector(`[name="${pref}-tempo"]:checked`) || {}).value || "ogni",
    parseInt($(`${pref}-ms`).value), $(`${pref}-fino`).checked, giri);
  const chipsHTML = (nome, voci, attivo) => voci.map(([v, lab]) =>
    `<button class="co-chip2 ${v === attivo ? "on" : ""}" data-g="${nome}" data-v="${v}">${lab}</button>`).join("");
  function attivaChips(stato, dopo) {
    pannello.querySelectorAll(".co-chip2[data-g]").forEach((b) => b.addEventListener("click", () => {
      stato[b.dataset.g] = b.dataset.v;
      pannello.querySelectorAll(`.co-chip2[data-g="${b.dataset.g}"]`).forEach((x) => x.classList.toggle("on", x === b));
      dopo();
    }));
    pannello.querySelectorAll("input").forEach((i) => i.addEventListener("input", dopo));
  }
  const descriviPassi = (passi) => passi.slice(0, 14).map((p) => `[${p.join(",")}]`).join(" ") + (passi.length > 14 ? ` … (${passi.length} passi)` : "");

  // ---- CANONE ----
  // effetto e colori si scelgono NEL pannello; piu' colori = lo stesso giro ripetuto, uno per colore
  // (VERDE, BLU, ROSSO = tre onde una dietro l'altra). "come in alto" usa l'effetto della riga EFFETTO.
  const statoCanone = { ordine: "sx", volta: "1", unita: "ballerino", dopo: "resta", fx: "ACCESO", colori: [] };
  const fxCanone = () => vociMenu().filter((v) => v.key !== "BUIO" && v.params.length &&
    v.params.every((p) => p.type === "color" || p.type === "fade")).map((v) => [v.key, v.key === "ACCESO" ? "COLORE fisso" : v.label]);
  const cellaCanone = (fx, colore) => fx === "ACCESO" ? colore : `${fx} ${colore}`;
  function apriCanone(tieni) {
    if (pannelloAperto === "canone") return chiudiPannello();
    if (!setup().racchette) return t("Imposta prima il numero di racchette", "err");
    const elenco = fxCanone();
    if (tieni !== true) {                       // all'apertura parte dall'effetto e dal colore scelti in alto
      const v = readParams($("co-params")); brush.vals = v;
      statoCanone.fx = elenco.some(([k]) => k === brush.key) ? brush.key : "alto";
      statoCanone.colori = [v.colore && REG.colori[v.colore] ? v.colore : (coloriAttivi()[0] || "BIANCO")];
    }
    const chi = chiLavora();
    apriPannello("canone", `
      <div class="co-pan-h">CANONE — le racchette partono una dopo l'altra <small>(${selected.size >= 2 ? "le " + chi.length + " selezionate" : "tutte: per usarne solo alcune selezionale prima"} · sui pallini vedi l'ordine)</small></div>
      <div class="co-pan-r"><span class="co-pan-l">ORDINE</span>${chipsHTML("ordine", ORDINI, statoCanone.ordine)}</div>
      <div class="co-pan-r"><span class="co-pan-l">INSIEME</span>${chipsHTML("unita", [["ballerino", "le 2 racchette del ballerino"], ["singola", "una racchetta per volta"]], statoCanone.unita)}
        <span class="co-pan-l co-pan-l2">PER PASSO</span>${chipsHTML("volta", [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]], statoCanone.volta)}</div>
      <div class="co-pan-r"><span class="co-pan-l">DOPO</span>${chipsHTML("dopo", [["resta", "resta accesa (si riempie)"], ["corre", "si spegne al passo dopo (la luce corre)"]], statoCanone.dopo)}</div>
      ${tempoHTML("cn")}
      <div class="co-pan-r"><span class="co-pan-l">EFFETTO</span>${chipsHTML("fx", elenco.concat([["alto", "come in alto (EFFETTO)"]]), statoCanone.fx)}</div>
      <div class="co-pan-r" id="cn-col-r"><span class="co-pan-l">COLORI</span>
        <span class="co-dots">${coloriAttivi().map((c) => `<button class="co-cdot co-cdot-p" data-agg="${c}" title="aggiungi ${c}" style="background:${cssColore(c)}"></button>`).join("")}</span>
        <span class="co-pan-l co-pan-l2">→ IN FILA</span><span id="cn-fila"></span></div>
      <div class="co-pan-prev" id="cn-prev"></div>
      <div class="co-pan-r"><button class="co-btn co-btn-primary" id="cn-ok">APPLICA IL CANONE</button></div>`);
    const passiOra = () => passiOrdinati(chiLavora(), statoCanone.ordine, +statoCanone.volta, statoCanone.unita === "ballerino");
    // le celle da scrivere, una per giro: [cella del 1° colore, cella del 2°, ...]
    const celleGiri = () => statoCanone.fx === "alto" ? [cellaBrush()].filter(Boolean) : statoCanone.colori.map((c) => cellaCanone(statoCanone.fx, c));
    const disegnaFila = () => {
      const alto = statoCanone.fx === "alto";
      $("cn-col-r").style.display = alto ? "none" : "";
      $("cn-fila").innerHTML = statoCanone.colori.map((c, i) =>
        `<span class="co-libchip" data-togli="${i}" title="clic per toglierlo"><span class="co-cdot co-cdot-p" style="background:${cssColore(c)}"></span>${c}<i>×</i></span>`).join(" → ") ||
        `<small>clicca un colore</small>`;
      $("cn-fila").querySelectorAll("[data-togli]").forEach((b) => b.addEventListener("click", () => {
        if (statoCanone.colori.length > 1) statoCanone.colori.splice(+b.dataset.togli, 1);
        disegnaFila(); anteprima();
      }));
    };
    const calcola = () => {
      const passi = passiOra();
      passiSuiPallini = {};
      passi.forEach((p, k) => p.forEach((n) => { passiSuiPallini[n] = k + 1; }));
      return passi;
    };
    const anteprima = () => {
      const passi = calcola(), celle = celleGiri();
      const tt = leggiTempo("cn", passi.length, celle.length);
      const passo = tt.tempi && tt.tempi.length > 1 ? tt.tempi[1] - tt.tempi[0] : 0;
      $("cn-prev").textContent = (celle.length ? celle.join("  →  ") : "scegli l'effetto in alto") + `  ·  ${passi.length} passi` +
        (celle.length > 1 ? ` × ${celle.length} colori` : "") +
        (tt.tempi && passo ? ` · uno ogni ${passo} ms · da ${fmt(tt.tempi[0])}, dura ${((tt.tempi[tt.tempi.length - 1] - tt.tempi[0] + passo) / 1000).toFixed(2)} s` : tt.errore ? " · " + tt.errore : "");
      renderStage();
    };
    calcolaPassiPannello = calcola;
    attivaChips(statoCanone, () => { disegnaFila(); anteprima(); });
    pannello.querySelectorAll("[data-agg]").forEach((b) => b.addEventListener("click", () => {
      if (statoCanone.colori.length < 8) statoCanone.colori.push(b.dataset.agg);
      disegnaFila(); anteprima();
    }));
    disegnaFila(); anteprima();
    $("cn-ok").addEventListener("click", () => {
      const celle = celleGiri();
      if (!celle.length) return t(statoCanone.fx === "alto" ? "Scegli prima l'effetto in alto (EFFETTO)" : "Scegli almeno un colore", "err");
      const passi = passiOra();
      if (passi.length < 2) return t("Servono almeno 2 passi: seleziona piu' racchette", "err");
      const tt = leggiTempo("cn", passi.length, celle.length);
      if (tt.errore) return t(tt.errore, "err", 7000);
      const mk = azioneUnica(() => {
        const mk = markerAi(tt.tempi); if (!mk) return null;
        const seq = [];
        celle.forEach((cella, g) => passi.forEach((p, k) => {
          const dati = {}, i = g * passi.length + k;
          // la luce corre: si spegne il passo prima (anche l'ultimo del giro precedente)
          if (statoCanone.dopo === "corre" && i > 0) for (const n of passi[(k || passi.length) - 1]) dati[n] = "BUIO";
          for (const n of p) dati[n] = cella;
          seq.push(dati);
        }));
        scriviSequenza(mk.ids, seq);
        return mk;
      });
      if (!mk) return;
      t(`Canone fatto: ${passi.length} passi` + (celle.length > 1 ? ` × ${celle.length} colori` : "") + (mk.nuovi ? `, ${mk.nuovi} marker creati` : "") + " — ⌘Z lo annulla tutto", "ok", 6000);
      chiudiPannello();
    });
  }
  $("co-canone-btn").addEventListener("click", () => apriCanone());

  // ---- SCRIVI ----
  const statoScrivi = { ordine: "lettura", fx: "LETTERA", quando: "insieme", testo: "" };
  function racchettePerScritta(ordine) {
    const chi = chiLavora();
    if (ordine === "sel") return chi;
    if (ordine === "num") return chi.slice().sort((a, b) => a - b);
    // "lettura": come si legge dal pubblico, riga per riga (dietro prima), da sinistra a destra
    const pos = capturePos();
    const righe = [];
    for (const k of chi.slice().sort((a, b) => pos[a][1] - pos[b][1])) {
      const r = righe[righe.length - 1];
      if (r && Math.abs(pos[k][1] - r.y) < 0.05) r.k.push(k); else righe.push({ y: pos[k][1], k: [k] });
    }
    return [].concat(...righe.map((r) => r.k.sort((a, b) => pos[a][0] - pos[b][0])));
  }
  function apriScrivi() {
    if (pannelloAperto === "scrivi") return chiudiPannello();
    if (!setup().racchette) return t("Imposta prima il numero di racchette", "err");
    const colori = coloriAttivi().map((c) => `<option value="${c}" ${c === (statoScrivi.colore || "BIANCO") ? "selected" : ""}>${c}</option>`).join("");
    apriPannello("scrivi", `
      <div class="co-pan-h">SCRIVI — una lettera per racchetta <small>(${selected.size >= 2 ? "sulle " + selected.size + " selezionate" : "su tutte: per usarne solo alcune selezionale prima"})</small></div>
      <div class="co-pan-r"><span class="co-pan-l">TESTO</span><input class="co-pan-txt" id="sc-testo" type="text" maxlength="99" placeholder="es. RUN TO THE FUTURE" autocomplete="off">
        <label class="co-pan-o"><input type="checkbox" id="sc-spazi"> lo spazio lascia una racchetta spenta</label></div>
      <div class="co-pan-r"><span class="co-pan-l">ORDINE</span>${chipsHTML("ordine", [["lettura", "come si legge (da sinistra)"], ["sel", "come le ho scelte"], ["num", "1 → N"]], statoScrivi.ordine)}</div>
      <div class="co-pan-r"><span class="co-pan-l">EFFETTO</span>${chipsHTML("fx", [["LETTERA", "LETTERA ferma"], ["SX", "TRANSIZIONE → da sinistra"], ["DX", "TRANSIZIONE ← da destra"]], statoScrivi.fx)}
        <select class="co-sel" id="sc-colore">${colori}</select></div>
      <div class="co-pan-r"><span class="co-pan-l">QUANDO</span>${chipsHTML("quando", [["insieme", "tutte insieme su questo marker"], ["canone", "una dopo l'altra"]], statoScrivi.quando)}</div>
      <div id="sc-tempo" style="display:none">${tempoHTML("sc")}</div>
      <div class="co-pan-prev" id="sc-prev"></div>
      <div class="co-pan-r"><button class="co-btn co-btn-primary" id="sc-ok">SCRIVI</button></div>`);
    const calcola = () => {
      const grezzo = $("sc-testo").value.toUpperCase();
      const lettere = ($("sc-spazi").checked ? grezzo.trim().replace(/\s+/g, " ") : grezzo.replace(/\s+/g, "")).split("");
      if (lettere.some((c) => c !== " " && !/^[A-Z]$/.test(c))) return { errore: "Solo lettere dalla A alla Z (niente numeri, accenti o punteggiatura)" };
      const rk = racchettePerScritta(statoScrivi.ordine);
      if (!lettere.length) return { errore: "Scrivi il testo" };
      if (lettere.length > rk.length) return { errore: `Servono ${lettere.length} racchette, ne hai ${rk.length}: selezionane di piu' o accorcia` };
      const col = $("sc-colore").value;
      const cella = (c) => statoScrivi.fx === "LETTERA" ? `LETTERA ${c} ${col}` : `TRANSIZIONE ${statoScrivi.fx} LETTERA ${c} ${col}`;
      return { coppie: lettere.map((c, i) => [rk[i], c === " " ? "BUIO" : cella(c), c]) };
    };
    const suiPallini = () => {
      const r = calcola();
      passiSuiPallini = {};
      if (!r.errore) r.coppie.forEach(([n, , c]) => { passiSuiPallini[n] = c === " " ? "·" : c; });
      return r;
    };
    const anteprima = () => {
      $("sc-tempo").style.display = statoScrivi.quando === "canone" ? "" : "none";
      const r = suiPallini();
      $("sc-prev").textContent = r.errore || r.coppie.map(([n, , c]) => `${c === " " ? "·" : c}→${n}`).join("  ");
      renderStage();
    };
    calcolaPassiPannello = suiPallini;
    attivaChips(statoScrivi, anteprima);
    $("sc-colore").addEventListener("change", () => { statoScrivi.colore = $("sc-colore").value; anteprima(); });
    $("sc-testo").value = statoScrivi.testo;
    $("sc-testo").addEventListener("input", () => { statoScrivi.testo = $("sc-testo").value; });
    anteprima(); $("sc-testo").focus();
    $("sc-ok").addEventListener("click", () => {
      const r = calcola();
      if (r.errore) return t(r.errore, "err", 6000);
      if (!currentId) return t("Piazza prima un marker", "err");
      if (statoScrivi.quando === "insieme") {
        scriviSequenza([currentId], [Object.fromEntries(r.coppie.map(([n, cella]) => [n, cella]))]);
        t(`Scritto su ${r.coppie.length} racchette`, "ok");
      } else {
        const passi = r.coppie.filter(([, , c]) => c !== " ");
        const tt = leggiTempo("sc", passi.length);
        if (tt.errore) return t(tt.errore, "err", 7000);
        const mk = azioneUnica(() => {
          const mk = markerAi(tt.tempi); if (!mk) return null;
          scriviSequenza(mk.ids, passi.map(([n, cella]) => ({ [n]: cella })));
          return mk;
        });
        if (!mk) return;
        t(`Scritto: ${passi.length} lettere una dopo l'altra` + (mk.nuovi ? `, ${mk.nuovi} marker creati` : ""), "ok", 6000);
      }
      chiudiPannello();
    });
  }
  $("co-scrivi-btn").addEventListener("click", () => apriScrivi());

  // ---- COPIA / INCOLLA TRATTO (ripeti una parte, anche con un altro colore) ----
  let tratto = null;       // { passi: [{d, c:{}, p:{}}], durata, marker }
  $("co-tratto-copia").addEventListener("click", () => {
    const sel = (bridgeState.selezionati || []).filter((ms) => ms > 0);
    if (sel.length < 2) return t("Seleziona sulla waveform il PRIMO e l'ULTIMO marker del tratto da copiare (o tutti quelli che vuoi)", "err", 7000);
    const a = sel[0], b = sel[sel.length - 1];
    const dentro = keyframes().filter((m) => m.ms >= a && m.ms <= b);
    tratto = { durata: b - a, marker: dentro.length, passi: dentro.map((m) => ({ d: m.ms - a,
      c: JSON.parse(JSON.stringify(M.commands[m.id] || {})), p: JSON.parse(JSON.stringify(M.positions[m.id] || {})) })) };
    $("co-tratto-incolla").disabled = false;
    t(`Tratto copiato: ${dentro.length} marker, ${(tratto.durata / 1000).toFixed(2)} s. Vai sul marker dove deve ripartire e premi INCOLLA TRATTO`, "ok", 7000);
  });
  function apriIncolla() {
    if (pannelloAperto === "incolla") return chiudiPannello();
    if (!tratto) return t("Prima copia un tratto", "err");
    const cur = markerById(currentId);
    if (!cur || cur.ms <= 0) return t("Vai prima sul marker da cui il tratto deve ripartire", "err");
    const usati = new Set();
    for (const p of tratto.passi) for (const n in p.c) for (const tok of p.c[n].split(/\s+/)) if (REG.colori[tok]) usati.add(tok);
    const scelta = (da) => `<label class="co-pan-o"><span class="co-cdot" style="background:${cssColore(da)}"></span>${da} →
        <select class="co-sel" data-da="${da}">${coloriAttivi().map((c) => `<option value="${c}" ${c === da ? "selected" : ""}>${c}</option>`).join("")}</select></label>`;
    apriPannello("incolla", `
      <div class="co-pan-h">INCOLLA TRATTO — ${tratto.marker} marker, ${(tratto.durata / 1000).toFixed(2)} s, a partire da ${fmt(cur.ms)} <small>(i marker che mancano li crea lui, con gli stessi tempi)</small></div>
      <div class="co-pan-r"><span class="co-pan-l">COLORI</span>${usati.size ? [...usati].map(scelta).join("") : "<small>il tratto non ha colori</small>"}</div>
      <div class="co-pan-r"><span class="co-pan-l">FORMAZIONI</span><label class="co-pan-o"><input type="checkbox" id="in-pos"> incolla anche le posizioni sul palco</label></div>
      <div class="co-pan-r"><button class="co-btn co-btn-primary" id="in-ok">INCOLLA</button></div>`);
    $("in-ok").addEventListener("click", () => {
      const cambia = {};
      pannello.querySelectorAll("[data-da]").forEach((s) => { if (s.value !== s.dataset.da) cambia[s.dataset.da] = s.value; });
      const ricolora = (cella) => cella.split(/\s+/).map((tok) => cambia[tok] || tok).join(" ");
      const partenza = markerById(currentId); if (!partenza) return;
      const conPos = $("in-pos").checked;
      const mk = azioneUnica(() => {
        const mk = markerAi(tratto.passi.map((p) => partenza.ms + p.d)); if (!mk) return null;
        tratto.passi.forEach((p, k) => {
          const id = mk.ids[k];
          if (Object.keys(p.c).length) { if (!M.commands[id]) M.commands[id] = {}; for (const n in p.c) M.commands[id][n] = ricolora(p.c[n]); }
          if (conPos && Object.keys(p.p).length) { if (!M.positions[id]) M.positions[id] = {}; for (const n in p.p) M.positions[id][n] = p.p[n].slice(); }
        });
        validaLive(); currentId = mk.ids[0]; renderAll();
        return mk;
      });
      if (!mk) return;
      t(`Tratto incollato: ${tratto.marker} marker` + (mk.nuovi ? `, ${mk.nuovi} creati` : "") + (Object.keys(cambia).length ? " · " + Object.entries(cambia).map(([a, b]) => `${a}→${b}`).join(", ") : ""), "ok", 6000);
      chiudiPannello();
    });
  }
  $("co-tratto-incolla").addEventListener("click", apriIncolla);
  caricaLibreria();

  // ============================================================
  // GUARDA LO SHOW: anteprima animata a tempo di musica
  // (spostamenti tra le formazioni, colori ed effetti). Lavora SOLO quando e' aperta:
  // a editor aperto non costa niente. E' una simulazione: tempi e colori sono quelli veri,
  // l'aspetto degli effetti e' approssimato (un pallino non e' una racchetta con 241 LED).
  // ============================================================
  const AP_MOVIMENTO_MS = 2500;      // uno spostamento dura al massimo 2,5 s e ARRIVA sul marker
  let ap = null;                     // stato dell'anteprima aperta (null = chiusa)
  const apRgb = (nome) => {
    const h = /^#([0-9a-f]{6})$/i.exec(cssColore(nome) || "");
    const v = h ? parseInt(h[1], 16) : 0x888888;
    return [v >> 16, (v >> 8) & 255, v & 255];
  };
  // numero "a caso" ma sempre uguale per la stessa racchetta nello stesso istante (niente sfarfallio diverso a ogni ridisegno)
  const apCaso = (a, b) => { let x = (a * 73856093) ^ (b * 19349663); x = (x ^ (x >>> 13)) * 1274126177; return ((x ^ (x >>> 16)) >>> 0) / 4294967295; };
  function apPrepara() {
    const { racchette } = setup();
    const kf = keyframes();
    const durata = bridgeState.durationMs || (kf.length ? kf[kf.length - 1].ms + 4000 : 4000);
    const tracce = {}, mosse = {};
    for (let n = 1; n <= racchette; n++) {
      // effetti: un tratto per ogni comando scritto
      const segs = [];
      for (const m of kf) {
        const c = M.commands[m.id] && M.commands[m.id][n];
        if (c === undefined || c === null) continue;
        const tok = c.trim().toUpperCase().replace(/[(),]/g, " ").split(/\s+/).filter(Boolean);
        const col = tok.find((x) => REG.colori[x]);
        const iL = tok.indexOf("LETTERA");
        const num = tok.map((x) => parseFloat(x.replace(",", "."))).filter((x) => !isNaN(x));
        const tipo = tok[0] === "BUIO" ? "BUIO" : (REG.colori[tok[0]] && tok.length === 1) ? "FISSO" : tok[0];
        segs.push({ t0: m.ms, t1: durata, tipo, rgb: col ? apRgb(col) : (tipo === "SFUMATURA" ? [0, 0, 0] : null),
          lettera: iL >= 0 && /^[A-Z]$/.test(tok[iL + 1] || "") ? tok[iL + 1] : "", dir: tok[1] === "SX" ? 1 : -1,
          num: num.length ? num[num.length - 1] : null });
      }
      segs.forEach((s, i) => { if (segs[i + 1]) { s.t1 = segs[i + 1].t0; s.verso = segs[i + 1].tipo === "BUIO" ? [0, 0, 0] : segs[i + 1].rgb; } });
      tracce[n] = segs;
      // posizioni: OGNI marker in cui la posizione e' scritta conta, anche se e' uguale a quella di
      // prima. Una formazione ripetuta uguale vuol dire "fin qui sta ferma": lo spostamento verso la
      // formazione dopo parte da li', non prima. (Prima i marker uguali venivano saltati e la
      // racchetta partiva in anticipo: cambiando le posizioni l'anteprima sembrava non seguirle.)
      const pp = [{ t: 0, p: defaultPos(n, racchette) }];
      for (const m of kf) {
        const p = M.positions[m.id] && M.positions[m.id][n];
        if (!p) continue;
        if (pp.length === 1 && pp[0].t === 0 && m === kf[0]) pp[0].p = p; else pp.push({ t: m.ms, p });
      }
      mosse[n] = pp;
    }
    return { racchette, kf, durata, tracce, mosse };
  }
  function apPosizione(pp, t) {
    let i = 0;
    while (i + 1 < pp.length && pp[i + 1].t <= t) i++;
    const a = pp[i], b = pp[i + 1];
    if (!b) return a.p;
    const parte = Math.max(a.t, b.t - AP_MOVIMENTO_MS);
    if (t <= parte) return a.p;
    let k = (t - parte) / (b.t - parte); k = k * k * (3 - 2 * k);              // parte e arriva dolce
    return [a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k];
  }
  // cosa mostra la racchetta n all'istante t: { rgb, b (luminosita' 0..1), lettera, tipo, fase }
  function apLuce(segs, t, n) {
    let s = null;
    for (const x of segs) { if (x.t0 <= t) s = x; else break; }
    if (!s || s.tipo === "BUIO") return { b: 0 };
    const dt = t - s.t0, lungo = Math.max(1, s.t1 - s.t0), rgb = s.rgb || [255, 255, 255];
    switch (s.tipo) {
      case "FISSO": return { rgb, b: 1 };
      case "HIT": {
        const fade = s.num != null ? Math.max(50, s.num * 1000) : 300;      // colpo secco (come generate.py: HIT_FADE_MS)
        if (dt < 90) return { rgb, b: 1, colpo: 1 - dt / 90 };
        const x = Math.min(1, (dt - 90) / fade);
        return { rgb, b: Math.max(0, (Math.exp(-3 * x) - 0.0498) / 0.9502) };
      }
      case "STROBO": return { rgb, b: Math.floor(dt / 50) % 2 === 0 ? 1 : 0 };
      case "FADE": return { rgb, b: Math.max(0, 1 - dt / lungo) };
      case "BPM": { const giro = 60000 / Math.max(1, s.num || 120); return { rgb, b: 0.25 + 0.75 * (1 - ((dt % giro) / giro)) }; }
      case "BRILLANTINI": return { rgb, b: 0.18, scintille: 1 };
      case "BRILLANTINI_MULTI": return { rgb: [255, 255, 255], b: 0.18, scintille: 2 };
      case "GLITCH": return { rgb, b: apCaso(n, Math.floor(t / 70)) < 0.55 ? 1 : 0.08 };
      case "LETTERA": return { rgb, b: 0.22, lettera: s.lettera };
      case "TRANSIZIONE":
        if (dt < 180) return { rgb, b: 0.22, onda: dt / 180, dir: s.dir, lettera: s.lettera };   // come DURATA nei template
        return s.lettera ? { rgb, b: 0.22, lettera: s.lettera } : { b: 0 };
      case "SFUMATURA": {
        if (!s.verso) return { rgb, b: 1 };
        const k = Math.min(1, dt / lungo);
        return { rgb: [0, 1, 2].map((i) => Math.round(rgb[i] + (s.verso[i] - rgb[i]) * k)), b: 1, sfuma: 1 };
      }
      case "ARCOBALENO": return { hue: (t / 8) % 360, b: 1 };
      default: return { rgb, b: 0.55, gira: (t / 400) % 1 };                  // SPIRALE, ASTERISCO, STELLA ROTANTE...
    }
  }
  const apScrivi = (elemento, testo) => { if (elemento.textContent !== testo) elemento.textContent = testo; };
  function apDisegna() {
    if (!ap) return;
    const cv = ap.canvas, c = ap.ctx, d = ap.dati;
    const W = cv.width, H = cv.height, t = ap.tempo();
    c.fillStyle = "#05060a"; c.fillRect(0, 0, W, H);
    const m = W * 0.03, pw = W - 2 * m, ph = H - 2 * m;                       // palco dentro al riquadro
    c.strokeStyle = "rgba(255,255,255,0.12)"; c.lineWidth = Math.max(1, W / 900);
    c.strokeRect(m, m, pw, ph);
    c.fillStyle = "rgba(255,255,255,0.28)"; c.font = `${Math.round(W / 85)}px Arial`; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("P U B B L I C O", W / 2, H - m / 2);
    const r = Math.max(7, Math.min(pw / 34, (pw * 0.94) / (d.racchette * 1.45) / 1.15));
    const P = {};
    for (let n = 1; n <= d.racchette; n++) { const p = apPosizione(d.mosse[n], t); P[n] = [m + p[0] * pw, m + p[1] * ph]; }
    if (coppieOn) {                                                            // la linea che unisce le due racchette del ballerino
      c.strokeStyle = "rgba(255,255,255,0.16)"; c.lineWidth = Math.max(1, r / 6);
      for (let n = 1; n < d.racchette; n += 2) { c.beginPath(); c.moveTo(P[n][0], P[n][1]); c.lineTo(P[n + 1][0], P[n + 1][1]); c.stroke(); }
    }
    for (let n = 1; n <= d.racchette; n++) {
      const [x, y] = P[n], L = apLuce(d.tracce[n], t, n);
      const rgb = L.hue != null ? null : (L.rgb || [255, 255, 255]);
      const colore = (a) => L.hue != null ? `hsla(${L.hue},100%,55%,${a})` : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
      if (L.b > 0.3 && !(rgb && rgb[0] + rgb[1] + rgb[2] < 40)) {              // alone: piu' forte nel colpo dell'HIT
        const R = r * (1.9 + (L.colpo || 0) * 1.3);
        const g = c.createRadialGradient(x, y, r * 0.6, x, y, R);
        g.addColorStop(0, colore(0.55 * L.b)); g.addColorStop(1, colore(0));
        c.fillStyle = g; c.beginPath(); c.arc(x, y, R, 0, 6.2832); c.fill();
      }
      c.fillStyle = "#0b0c12"; c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
      if (L.b > 0) { c.fillStyle = colore(L.b); c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill(); }
      if (L.scintille) {                                                       // brillantini: puntini che saltano
        for (let k = 0; k < 3; k++) {
          const q = Math.floor(t / 45) + k * 7, a = apCaso(n + k * 31, q) * 6.2832, rr = Math.sqrt(apCaso(n + k * 17, q + 3)) * r * 0.8;
          c.fillStyle = L.scintille === 2 ? `hsl(${Math.floor(apCaso(n + k, q + 9) * 360)},100%,60%)` : colore(1);
          c.beginPath(); c.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, Math.max(1.2, r * 0.17), 0, 6.2832); c.fill();
        }
      }
      if (L.gira != null) {                                                    // effetti che girano: uno spicchio luminoso
        c.fillStyle = colore(1); c.beginPath(); c.moveTo(x, y); c.arc(x, y, r, L.gira * 6.2832, L.gira * 6.2832 + 1.3); c.closePath(); c.fill();
      }
      if (L.onda != null) {                                                    // TRANSIZIONE: l'onda che attraversa la racchetta
        const fx = L.dir > 0 ? x - r + L.onda * 2 * r : x + r - L.onda * 2 * r;
        c.save(); c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.clip();
        c.fillStyle = colore(0.95); c.fillRect(fx - r * 0.35, y - r, r * 0.7, 2 * r); c.restore();
      }
      c.strokeStyle = L.b > 0 ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.22)"; c.lineWidth = Math.max(1, r / 11);
      c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.stroke();
      const letteraVisibile = L.lettera && !(L.onda != null && L.onda < 0.5);
      if (letteraVisibile) {                                                   // la lettera, del colore dell'effetto
        c.fillStyle = colore(1); c.font = `800 ${Math.round(r * 1.45)}px Arial`; c.fillText(L.lettera, x, y + r * 0.06);
      }
      // numero della racchetta: dentro se c'e' posto, piccolo sotto se c'e' la lettera
      const chiaro = L.b > 0.5 && (L.hue != null || rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 150);
      c.font = `700 ${Math.round(r * (letteraVisibile ? 0.55 : 0.8))}px Arial`;
      c.fillStyle = letteraVisibile ? "rgba(255,255,255,0.7)" : chiaro ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.85)";
      c.fillText(String(n), x, letteraVisibile ? y + r * 1.5 : y + r * 0.04);
    }
    // barra in basso: tempo e marker
    const ki = (() => { let i = -1; for (let j = 0; j < d.kf.length; j++) { if (d.kf[j].ms <= t) i = j; else break; } return i; })();
    // le scritte si toccano SOLO quando cambiano: in Safari, riscrivere il testo di un pulsante
    // mentre lo stai premendo fa perdere il clic (e qui si ridisegna 60 volte al secondo)
    apScrivi(ap.tempoEl, `${fmt(t)} / ${fmt(d.durata)}` + (ki >= 0 ? `  ·  marker ${ki + 1}` : ""));
    if (!ap.trascino) ap.barra.value = Math.round(t);
    apScrivi(ap.playEl, ap.suona() ? "⏸ PAUSA" : "▶ PLAY");
  }
  // ---- SCARICA VIDEO: il browser registra l'anteprima (immagine + musica) mentre lo show suona
  //      dall'inizio alla fine. Niente programmi da installare; ci mette quanto dura la musica. ----
  function apVideo() {
    if (!ap) return;
    if (ap.reg) { ap.reg.annullato = true; try { ap.reg.rec.stop(); } catch {} return; }      // secondo clic = annulla
    const cv = ap.canvas;
    const tipo = (cv.captureStream && window.MediaRecorder)
      ? ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((x) => MediaRecorder.isTypeSupported(x)) : null;
    if (!tipo) return t("Questo browser non riesce a registrare il video dell'anteprima", "err", 7000);
    // niente domanda di conferma: tutto deve partire NELL'ISTANTE del clic, altrimenti il browser
    // blocca la musica (succedeva se prima non si era mai premuto PLAY) e il video non partiva
    const B = window.CoreoBridge, pezzi = [];
    if (B.sbloccaAudio) B.sbloccaAudio();
    if (ap.suona()) ap.playPausa();
    ap.vai(0);
    let rec;
    try {
      cv.width = 1280; cv.height = 720;                                        // misura fissa del video
      const flusso = cv.captureStream(30);
      const audio = bridgeState.hasAudio && B.flussoAudio ? B.flussoAudio() : null;
      if (audio) audio.getAudioTracks().forEach((tr) => flusso.addTrack(tr));
      rec = new MediaRecorder(flusso, { mimeType: tipo, videoBitsPerSecond: 5000000 });
      ap.reg = { rec, annullato: false, partito: 0, conAudio: !!audio };
    } catch (e) { ap.reg = null; ap.misura(); return t("Registrazione non riuscita: " + e.message, "err", 7000); }
    rec.ondataavailable = (e) => { if (e.data && e.data.size) pezzi.push(e.data); };
    rec.onstop = () => {
      const r = ap && ap.reg;
      if (B.fineFlusso) B.fineFlusso();
      if (ap) { if (ap.suona()) ap.playPausa(); ap.reg = null; ap.misura(); ap.videoEl.textContent = "⬇ SCARICA VIDEO"; }
      if (!r || r.annullato) return r && r.motivo ? t(r.motivo, "err", 9000) : t("Registrazione del video interrotta", "info");
      const est = tipo.startsWith("video/mp4") ? "mp4" : "webm";
      const nome = ((progNome || setup().titolo || "show").replace(/[^\w\s-]/g, "").trim() || "show") + " anteprima." + est;
      const grezzo = new Blob(pezzi, { type: tipo.split(";")[0] });
      const scarica = (b) => {
        if (typeof downloadBlob === "function") downloadBlob(b, nome);
        t(`Video scaricato nei Download: ${nome}` + (r.conAudio ? "" : " (senza musica)"), "ok", 8000);
      };
      if (est !== "mp4") return scarica(grezzo);
      // MP4 normale (quello di Safari e' "a pezzi" e WhatsApp non lo accetta); se non riesce, l'originale
      t("Preparo il file del video…", "info", 6000);
      fetch("/api/video-standard", { method: "POST", body: grezzo })
        .then((res) => (res.ok ? res.blob() : Promise.reject()))
        .then((b) => scarica(b.size > 1000 ? b : grezzo))
        .catch(() => scarica(grezzo));
    };
    rec.start(1000);
    ap.playPausa();                                  // subito, dentro al clic (immagine e audio partono insieme)
    ap.reg.partito = performance.now();
    t(`Registro il video di tutto lo show: ci mette ${fmt(ap.dati.durata)}. Lascia questa finestra aperta e in primo piano. Per interrompere premi di nuovo il pulsante`, "info", 9000);
    // se dopo 2 secondi la musica non e' partita davvero, lo dico invece di registrare un video fermo
    const inizio = ap.tempo();
    setTimeout(() => {
      if (!ap || !ap.reg || ap.reg.rec.state !== "recording") return;
      if (ap.tempo() - inizio < 500) {
        ap.reg.annullato = true;
        ap.reg.motivo = "La musica non e' partita: premi una volta PLAY, poi di nuovo SCARICA VIDEO";
        try { ap.reg.rec.stop(); } catch {}
      }
    }, 2000);
  }
  // chiamata a ogni fotogramma: aggiorna il pulsante e ferma la registrazione quando lo show e' finito
  function apVideoControlla() {
    if (!ap || !ap.reg || !ap.reg.partito) return;
    const tt = ap.tempo();
    apScrivi(ap.videoEl, `● REGISTRO ${fmt(tt)} / ${fmt(ap.dati.durata)} — clic per interrompere`);
    const finito = tt >= ap.dati.durata - 60 || (!ap.suona() && performance.now() - ap.reg.partito > 1500);
    if (finito && ap.reg.rec.state === "recording") { ap.reg.partito = 0; try { ap.reg.rec.stop(); } catch {} }
  }
  function apChiudi() {
    if (!ap) return;
    if (ap.reg) { ap.reg.annullato = true; try { ap.reg.rec.stop(); } catch {} }          // chiudi durante la registrazione = interrompe
    cancelAnimationFrame(ap.raf);
    if (ap.suona()) ap.playPausa();
    window.removeEventListener("keydown", ap.tasti, true);
    window.removeEventListener("resize", ap.misura);
    ap.el.remove();
    ap = null;
  }
  function apApri() {
    if (ap) return;
    if (!setup().racchette) return t("Imposta prima il numero di racchette", "err");
    if (!keyframes().length) return t("Non c'e' ancora niente da guardare: piazza almeno un marker", "err");
    const dati = apPrepara();
    const B = window.CoreoBridge, conAudio = bridgeState.hasAudio && B.posizioneOra;
    const el = document.createElement("div");
    el.className = "co-ap";
    el.innerHTML = `<canvas class="co-ap-cv"></canvas>
      <div class="co-ap-bar">
        <button class="co-btn co-btn-primary" id="co-ap-play">▶ PLAY</button>
        <button class="co-btn co-chip" id="co-ap-inizio" title="torna all'inizio">⏮</button>
        <input type="range" id="co-ap-barra" min="0" max="${Math.round(dati.durata)}" value="0" step="10">
        <span class="co-ap-tempo" id="co-ap-tempo"></span>
        <span class="co-ap-nota">${conAudio ? "" : "senza musica · "}spazio = play/pausa · ← → = 2 secondi · Esc = chiudi</span>
        <button class="co-btn co-chip" id="co-ap-video" title="registra tutto lo show e scarica il video (ci mette quanto dura la musica)">⬇ SCARICA VIDEO</button>
        <button class="co-btn co-chip" id="co-ap-x">✕ CHIUDI</button>
      </div>`;
    document.body.appendChild(el);
    const canvas = el.querySelector("canvas");
    // senza musica caricata: orologio interno (si guarda lo stesso, in silenzio)
    const orologio = { ms: Math.max(0, (markerById(currentId) || {}).ms || 0), via: 0, da: 0 };
    ap = { el, canvas, ctx: canvas.getContext("2d"), dati, raf: 0, trascino: false,
      tempoEl: el.querySelector("#co-ap-tempo"), barra: el.querySelector("#co-ap-barra"), playEl: el.querySelector("#co-ap-play"),
      videoEl: el.querySelector("#co-ap-video"), reg: null,
      // mentre si registra il video l'immagine segue la musica come finisce NEL FILE (non come esce dalle casse)
      tempo: () => conAudio ? ((ap && ap.reg && B.posizioneRegistrata) ? B.posizioneRegistrata() : B.posizioneOra())
                            : (orologio.via ? Math.min(dati.durata, orologio.da + performance.now() - orologio.via) : orologio.ms),
      suona: () => conAudio ? B.inRiproduzione() : !!orologio.via,
      playPausa: () => {
        if (conAudio) return B.playPausa();
        if (orologio.via) { orologio.ms = ap.tempo(); orologio.via = 0; }
        else { if (orologio.ms >= dati.durata - 5) orologio.ms = 0; orologio.da = orologio.ms; orologio.via = performance.now(); }
      },
      vai: (ms) => {
        ms = Math.max(0, Math.min(dati.durata, ms));
        if (conAudio) B.seek(ms); else { orologio.ms = ms; if (orologio.via) { orologio.da = ms; orologio.via = performance.now(); } }
      },
      misura: () => {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const maxW = window.innerWidth - 24, maxH = window.innerHeight - 78;
        const w = Math.min(maxW, maxH * 16 / 9), h = w * 9 / 16;
        canvas.style.width = w + "px"; canvas.style.height = h + "px";
        if (ap && ap.reg) return;                                              // mentre registra il video la misura resta 1280x720
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      },
      tasti: (e) => {                                                          // mentre e' aperta, i tasti sono solo suoi
        e.stopImmediatePropagation();
        if (e.key === "Escape") { e.preventDefault(); apChiudi(); }
        else if (ap.reg) { e.preventDefault(); }                               // registrazione in corso: niente salti
        else if (e.key === " " || e.code === "Space") { e.preventDefault(); ap.playPausa(); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); ap.vai(ap.tempo() - 2000); }
        else if (e.key === "ArrowRight") { e.preventDefault(); ap.vai(ap.tempo() + 2000); }
      } };
    if (conAudio) { const mc = markerById(currentId); if (!B.inRiproduzione() && mc && mc.ms > 0) B.seek(mc.ms); }   // parte dal marker su cui sei
    ap.misura();
    window.addEventListener("resize", ap.misura);
    window.addEventListener("keydown", ap.tasti, true);
    const premuto = (bottone, fai) => bottone.addEventListener("mousedown", (e) => { if (e.button === 0) { e.preventDefault(); fai(); } });
    premuto(ap.playEl, () => { if (!ap.reg) ap.playPausa(); });
    premuto(el.querySelector("#co-ap-inizio"), () => { if (!ap.reg) ap.vai(0); });
    premuto(ap.videoEl, apVideo);
    premuto(el.querySelector("#co-ap-x"), apChiudi);
    // barra del tempo: mentre la trascini l'anteprima non la sposta sotto il dito
    ap.barra.addEventListener("mousedown", () => { if (!ap.reg) ap.trascino = true; });
    ap.barra.addEventListener("input", () => { if (ap.reg) return; ap.trascino = true; ap.vai(+ap.barra.value); });
    const lascia = () => { if (ap) ap.trascino = false; };
    ap.barra.addEventListener("change", lascia);
    ap.barra.addEventListener("mouseup", lascia);
    window.CoreoBridge._anteprimaPos = (n, t) => (ap ? apPosizione(ap.dati.mosse[n], t) : null);   // (serve alle prove automatiche)
    const giro = () => { if (!ap) return; apDisegna(); apVideoControlla(); ap.raf = requestAnimationFrame(giro); };
    giro();
  }
  $("co-anteprima-btn").addEventListener("click", apApri);

  // ============================================================
  // TASTIERA (solo tasti che NON collidono con l'Audio Assistant)
  // ============================================================
  document.addEventListener("keydown", (e) => {
    const tab = document.getElementById("tab-audio");
    if (!tab || tab.style.display === "none") return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (menu.style.display !== "none") { if (e.key === "Escape") chiudiMenu(); return; }
    if (e.key === "Escape" && pannelloAperto) { chiudiPannello(); return; }

    if (e.key === "[" || e.key === "ArrowDown") { e.preventDefault(); navMarker(-1); }
    else if (e.key === "]" || e.key === "ArrowUp") { e.preventDefault(); navMarker(+1); }
    else if (e.key === "a" || e.key === "A") { e.preventDefault(); setSel(() => true); }
    else if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "c" || e.key === "C")) { e.preventDefault(); copiaFormazione(); }
    else if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "v" || e.key === "V")) { e.preventDefault(); incollaFormazione(); }
    else if ((e.metaKey || e.ctrlKey) && (e.key === "c" || e.key === "C")) {     // copia l'effetto della racchetta selezionata
      if (!selected.size) return;
      e.preventDefault();
      const da = Math.min(...selected), cella = effettivo(da).cella;
      if (!cella) return t(`La racchetta ${da} non ha ancora un effetto da copiare`, "err");
      effettoCopiato = cella;
      t(`Copiato dalla racchetta ${da}: ${cella}`, "ok");
    }
    else if ((e.metaKey || e.ctrlKey) && (e.key === "v" || e.key === "V")) {     // incolla sulle selezionate
      if (!effettoCopiato) return;
      e.preventDefault();
      assegnaAiSelezionati(effettoCopiato);
    }
    else if (e.metaKey || e.ctrlKey) return;                                    // altri ⌘/Ctrl: lasciali al browser
    else if (e.key === "b" || e.key === "B") { e.preventDefault(); assegnaAiSelezionati("BUIO"); }
    else if (e.key === "x" || e.key === "X") { e.preventDefault(); eraseSelezionati(); }
    else if (e.key === "g" || e.key === "G") { e.preventDefault(); grigliaOn = !grigliaOn; renderStage(); }
    else if (e.key === "Enter") { e.preventDefault(); $("co-assign").click(); }
    else if (/^[1-8]$/.test(e.key)) {
      const col = coloriAttivi()[parseInt(e.key) - 1];
      if (col) {
        const voce = vociMenu().find((v) => v.key === brush.key);
        if (!(voce && voce.params.some((p) => p.type === "color"))) brush.key = "ACCESO";
        brush.vals.colore = col;
        renderEffSelect();
        const cs = $("co-params").querySelector('[data-p="colore"]');
        if (cs) cs.value = col;
      }
    }
  });

  // ============================================================
  // AVVIO
  // ============================================================
  (async function init() {
    try { await caricaRegistro(); } catch (e) { t("Registro non caricato: " + e.message, "err"); }
    brush.vals.colore = coloriAttivi()[0] || "BIANCO";
    renderEffSelect();
    // ripristino autosave (silenzioso) se presente e se non ci sono gia' comandi
    aggiornaBtnCopia();
    let ripreso = false;
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (raw) { const o = JSON.parse(raw); if (o && Object.keys(o.commands || {}).length) { caricaProgetto(o, true); ripreso = true; } }
    } catch {}
    autosavePronto = true;
    renderAll();
    azzeraStoria();
    aggiornaProgInfo();
    if (!ripreso) {
      // niente nel browser (dati cancellati, o primo avvio): riprende l'ultimo lavoro dalla cartella,
      // cioe' lo show salvato piu' recente oppure, se e' piu' nuova, la copia di emergenza
      try {
        const d = await apiJ("/api/progetti");
        let em = null; try { em = await apiJ("/api/emergenza"); } catch {}
        const ultimo = d.progetti[0];
        if (em && em.progetto && (!ultimo || em.quando > ultimo.modificato + 2) && !haLavoro()) {
          const salvato = d.progetti.find((x) => x.nome === em.nome);
          if (salvato) await apriDaDisco(salvato.nome, true);            // base + musica dello show salvato
          caricaProgetto(em.progetto, true);
          if ($("aa-titolo") && em.progetto.titolo) $("aa-titolo").value = em.progetto.titolo;
          autosave(); aggiornaProgInfo();
          t(`Ripreso dalla copia automatica di emergenza di "${em.nome}": ci sono modifiche non salvate`, "ok", 8000);
        } else if (ultimo && !haLavoro()) {
          await apriDaDisco(ultimo.nome, true);
          t(`Ripreso l'ultimo show salvato: "${ultimo.nome}"`, "ok", 6000);
        }
      } catch {}
    } else if (progNome) {
      // lo show aperto esiste ancora nella cartella? (potresti averlo spostato dal Finder)
      let d = null;
      try { d = await apiJ("/api/progetti/" + encodeURIComponent(progNome)); } catch { ricordaProgNome(null); }
      if (d) { ultimoSalvato = JSON.stringify(d.progetto); aggiornaProgInfo(); }   // per sapere se ci sono modifiche non salvate
      // riaprendo l'app torna anche la musica, senza andarla a cercare
      if (d && d.audio && !bridgeState.hasAudio) {
        try {
          const blob = await (await fetch("/api/progetti/" + encodeURIComponent(progNome) + "/audio")).blob();
          const f = new File([blob], M.audioNome || "musica.mp3", { type: blob.type });
          audioFile = f; audioInviatoA = progNome;
          if (!bridgeState.hasAudio) await window.CoreoBridge.caricaAudio(f, true);
        } catch (e) { console.warn("musica del progetto non caricata:", e.message); }
      }
    }
    segnalaPronto();        // da qui in poi l'editor non sovrascrive piu' da solo: vedi CoreoBridge.pronto
  })();
})();
