/* COPIA MONTATA da APP_LED/web/audio-assistant.js (strumenti/monta_led.py): non modificarla a mano. */
/* ==========================================================
   AUDIO TIMELINE ASSISTANT — Frontend
   Carica un MP3, piazza marker a orecchio, interpola tra due
   marker, esporta un XLSX identico al flusso manuale (colonna A
   piena, effetti vuoti). Vanilla JS, nessun framework.

   Si auto-inizializza al caricamento (lazy da app.js).
   Riusa toast() / downloadBlob() definiti in app.js.
   ========================================================== */
(function () {
  "use strict";

  const root = document.getElementById("audio-assistant-root");
  if (!root || root.dataset.ready === "1") return;
  root.dataset.ready = "1";

  // ---- helper locali (toast/downloadBlob arrivano da app.js) ----
  const t = (m, k, ms) => (typeof toast === "function" ? toast(m, k, ms) : console.log(m));
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const ZOOM_MIN_MS = 1000;   // zoom massimo: 1 secondo su tutta la larghezza
  const MINI_H = 26;          // altezza barra panoramica
  // tempo per il righello: con lo zoom mostra decimi/centesimi di secondo
  const fmtPreciso = (ms, tick) => {
    if (tick >= 1000) return fmtTime(ms);
    const s = Math.max(0, ms) / 1000, m = Math.floor(s / 60), r = s - m * 60;
    return `${m}:${r.toFixed(tick >= 100 ? 1 : 2).padStart(tick >= 100 ? 4 : 5, "0")}`;
  };
  const fmtTime = (ms) => {
    const s = Math.max(0, ms) / 1000;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  // Palette sezioni — deve combaciare con SECTION_COLORS in app.py
  const SECTION_COLORS = ["D6E4F0", "D6F0DD", "F0E4D6", "E4D6F0", "F0F0D6", "F0D6E4"];
  // primo e ultimo marker di ogni Interpola: sempre questo colore (non blu = waveform,
  // non rosso = linea, non giallo = selezionati)
  const COLORE_BORDO_SEZIONE = "#3ddc84";

  // ============================================================
  // MARKUP
  // ============================================================
  root.innerHTML = `
    <section class="aa">
      <div class="aa-head">
        <div class="aa-tag">// AUDIO TIMELINE ASSISTANT</div>
        <p class="aa-intro">Carica un MP3, ascolta e premi <kbd>M</kbd> sui colpi.
        Seleziona due marker e premi <kbd>I</kbd> per riempire in mezzo. Esporta l'XLSX,
        compila gli effetti in Excel, poi <strong>LOAD → GENERATE</strong>.</p>
      </div>

      <div class="aa-card aa-drop" id="aa-drop">
        <input type="file" id="aa-file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac" hidden>
        <div class="aa-drop-inner">
          <button class="aa-btn aa-btn-primary" id="aa-choose">Scegli file audio</button>
          <span class="aa-drop-hint">o trascina qui</span>
          <div class="aa-file-info" id="aa-file-info">nessun brano caricato</div>
        </div>
      </div>

      <div class="aa-card">
        <div class="aa-setup">
          <label>Titolo <input type="text" id="aa-titolo" placeholder="es. BRANO"></label>
          <label>Racchette <input type="number" id="aa-racchette" min="1" max="99" value="14"></label>
          <label>Master N° <input type="number" id="aa-master" min="1" max="99" value="1"></label>
          <label class="aa-tel" title="il master e' un telecomando a parte, non una racchetta: non compare sul palco e resta sempre buio. Il suo numero e' fisso per tutti gli show">
            <span><input type="checkbox" id="aa-tel"> Telecomando N°</span>
            <input type="number" id="aa-tel-num" min="2" max="99" value="37" disabled></label>
        </div>
      </div>

      <div id="aa-wave-sentinella"></div>
      <div class="aa-card aa-wave-card" id="aa-wave-card" style="display:none;">
        <div class="aa-zoom-bar">
          <canvas id="aa-mini" title="tutta la canzone: clicca o trascina per spostarti"></canvas>
          <div class="aa-zoom-btns">
            <button class="aa-btn aa-zoom-b" id="aa-zoom-out" title="allontana">－</button>
            <button class="aa-btn aa-zoom-b" id="aa-zoom-in" title="avvicina">＋</button>
            <button class="aa-btn aa-zoom-b" id="aa-zoom-tutto" title="tutta la canzone">TUTTO</button>
            <span class="aa-zoom-lbl" id="aa-zoom-lbl">canzone intera</span>
          </div>
        </div>
        <div class="aa-canvas-wrap" id="aa-canvas-wrap">
          <canvas id="aa-canvas"></canvas>
        </div>
        <div class="aa-controls">
          <div class="aa-ctl-group">
            <button class="aa-btn" id="aa-play">▶ Play</button>
            <button class="aa-btn" id="aa-stop">■ Stop</button>
            <span class="aa-time" id="aa-time">0:00 / 0:00</span>
          </div>
          <div class="aa-ctl-group">
            <button class="aa-btn" id="aa-interp" disabled>Interpola</button>
            <button class="aa-btn" id="aa-remove" disabled>Rimuovi selez.</button>
            <span class="aa-count"><b id="aa-marker-count">1</b> marker · <b id="aa-sel-count">0</b> selez.</span>
          </div>
          <div class="aa-ctl-group">
            <button class="aa-btn aa-btn-primary" id="aa-export">ESPORTA XLSX</button>
          </div>
          <div class="aa-sec-note">Il marker a 0 non viene esportato: da 0 al primo marker
            sara' la fase di buio + sincronizzazione nel codice generato.</div>
        </div>
      </div>

      <div class="aa-card aa-sections" id="aa-sections-card" style="display:none;">
        <div class="aa-sec-title">// SEZIONI CREATE</div>
        <div class="aa-sec-list" id="aa-sec-list"></div>
        <div class="aa-sec-note">Le righe di queste sezioni appariranno colorate nell'XLSX.</div>
      </div>

      <!-- Editor COREOGRAFIA (web/coreografia.js) — riempito lazy -->
      <div id="coreografia-root"></div>

      <div class="aa-shortcuts">
        <span><kbd>Spazio</kbd> play/pausa</span>
        <span><kbd>M</kbd> marker</span>
        <span><kbd>I</kbd> interpola</span>
        <span><kbd>Canc</kbd> rimuovi</span>
        <span><kbd>⌘Z</kbd> undo</span>
        <span><kbd>← →</kbd> nudge 10ms</span>
        <span><kbd>trascina</kbd> seleziona marker</span>
        <span><kbd>⌥ ← →</kbd> sposta selezionati</span>
        <span><kbd>pizzico</kbd> zoom</span>
        <span><kbd>2 dita ← →</kbd> scorri</span>
      </div>

      <!-- popover interpolazione -->
      <div class="aa-popover" id="aa-interp-pop" style="display:none;">
        <div class="aa-pop-box">
          <div class="aa-pop-title" id="aa-pop-range">Da 0ms a 0ms</div>
          <label>Marker da aggiungere in mezzo:
            <input type="number" id="aa-interp-n" min="1" max="500" value="7">
          </label>
          <div class="aa-pop-actions">
            <button class="aa-btn" id="aa-interp-cancel">Annulla</button>
            <button class="aa-btn aa-btn-primary" id="aa-interp-apply">Applica</button>
          </div>
        </div>
      </div>
    </section>`;

  // ============================================================
  // WAVEFORM CANVAS
  // ============================================================
  class WaveformCanvas {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.cssW = 0; this.cssH = 0;

      this.waveform = [];
      this.beats = [0];          // ms, sempre ordinati
      this.durationMs = 0;
      this.playheadMs = 0;

      this.selected = new Set(); // ms selezionati
      this.dragMs = null;        // ms del marker in drag (rimosso temporaneamente da beats)
      this.dragWasSelected = false;

      this.sections = [];        // [{start_ms, end_ms, color}]
      this.nextColorIndex = 0;

      // ZOOM: finestra visibile [viewStart, viewStart + vd()]; viewDur 0 = canzone intera
      this.viewStart = 0;
      this.viewDur = 0;
      this.dettaglio = [];       // picchi per lo zoom
      this.dettMs = 5;           // durata esatta (ms) di un punto del dettaglio
      this.waveMs = 0;           // durata esatta (ms) di un punto della waveform intera (0 = proporzionale)
      this.mini = null;          // canvas della barra panoramica
      this.rubber = null;        // selezione a rettangolo in corso: {a, b} in pixel
      this.gruppo = null;        // spostamento di gruppo in corso: {set: Set(ms), delta}
      this.correnteMs = null;    // marker su cui sta lavorando l'editor COREOGRAFIA (evidenziato)
    }

    vd() { return this.viewDur || this.durationMs || 1; }
    zoomato() { return this.viewDur > 0 && this.viewDur < this.durationMs; }
    msToX(ms) { return this.durationMs ? ((ms - this.viewStart) / this.vd()) * this.cssW : 0; }
    xToMs(x)  { return this.durationMs ? this.viewStart + (x / this.cssW) * this.vd() : 0; }

    setView(start, dur) {
      const tot = this.durationMs;
      if (!tot) return;
      dur = Math.max(ZOOM_MIN_MS, Math.min(tot, dur));
      if (dur >= tot) { this.viewStart = 0; this.viewDur = 0; return; }
      this.viewDur = dur;
      this.viewStart = Math.max(0, Math.min(tot - dur, start));
    }
    zoomAt(x, fattore) {                         // fattore > 1 = avvicina, tenendo fermo il punto sotto il cursore
      const ms = this.xToMs(x), dur = this.vd() / fattore;
      this.setView(ms - (x / this.cssW) * dur, dur);
    }
    mostra(ms) {                                  // se il punto e' fuori dalla vista zoomata, la sposta
      if (!this.zoomato()) return;
      const d = this.vd();
      if (ms < this.viewStart || ms > this.viewStart + d * 0.92) this.setView(ms - d * 0.08, d);
    }

    resize() {
      const wrap = this.canvas.parentElement;
      const dpr = window.devicePixelRatio || 1;
      this.cssW = wrap.clientWidth;
      this.cssH = this.altezza || 160;
      this.canvas.style.height = this.cssH + "px";
      this.canvas.width = Math.round(this.cssW * dpr);
      this.canvas.height = Math.round(this.cssH * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.render();
    }

    findMarkerAt(px, py) {
      const DITO = window.MiniTouch ? 1.6 : 1;   // [mini app] zona di presa più ampia col dito
      if (py > 30 * DITO) return -1;
      let best = -1, bestD = 10 * DITO;
      for (let i = 0; i < this.beats.length; i++) {
        const d = Math.abs(px - this.msToX(this.beats[i]));
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }

    addMarkerAt(ms) {
      const r = Math.max(0, Math.min(this.durationMs, Math.round(ms)));
      if (!this.beats.includes(r)) {
        this.beats.push(r);
        this.beats.sort((a, b) => a - b);
      }
      return r;
    }

    removeSelected() {
      if (!this.selected.size) return;
      this.beats = this.beats.filter(ms => !this.selected.has(ms));
      this.selected.clear();
    }

    interpolate(msA, msB, n) {
      const a = Math.min(msA, msB), b = Math.max(msA, msB);
      const step = (b - a) / (n + 1);
      // rimuovi i marker strettamente tra a e b
      this.beats = this.beats.filter(ms => ms <= a || ms >= b);
      for (let i = 1; i <= n; i++) {
        const ms = Math.round(a + step * i);
        if (!this.beats.includes(ms)) this.beats.push(ms);
      }
      this.beats.sort((x, y) => x - y);
      const color = SECTION_COLORS[this.nextColorIndex % SECTION_COLORS.length];
      this.nextColorIndex++;
      this.sections.push({ start_ms: a, end_ms: b, color });
    }

    snapshot() {
      return {
        beats: this.beats.slice(),
        sections: JSON.parse(JSON.stringify(this.sections)),
        selected: Array.from(this.selected),
        nextColorIndex: this.nextColorIndex,
      };
    }
    restore(s) {
      this.beats = s.beats.slice();
      this.sections = JSON.parse(JSON.stringify(s.sections));
      this.selected = new Set(s.selected);
      this.nextColorIndex = s.nextColorIndex || 0;
    }

    render() {
      const { ctx } = this;
      const w = this.cssW, h = this.cssH;
      if (!w) return;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#0d1117";
      ctx.fillRect(0, 0, w, h);

      // sezioni (sfondo tenue)
      for (const s of this.sections) {
        const x1 = this.msToX(s.start_ms), x2 = this.msToX(s.end_ms);
        ctx.fillStyle = "#" + s.color + "22";
        ctx.fillRect(x1, 14, x2 - x1, h - 14);
      }

      // waveform
      // canzone intera: waveform "media" di sempre; zoomato: picchi dettagliati (si vedono i colpi)
      const usaDett = this.zoomato() && this.dettaglio.length;
      const wf = usaDett ? this.dettaglio : this.waveform;
      if (wf.length && this.durationMs) {
        const perMs = usaDett ? 1 / this.dettMs : (this.waveMs ? 1 / this.waveMs : wf.length / this.durationMs);
        ctx.strokeStyle = "#58a6ff";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let px = 0; px < w; px++) {
          const start = Math.floor(this.xToMs(px) * perMs);
          const end = Math.max(start + 1, Math.floor(this.xToMs(px + 1) * perMs));
          let sum = 0, cnt = 0, max = 0;
          for (let i = start; i < end && i < wf.length; i++) { if (i >= 0) { sum += wf[i]; cnt++; if (wf[i] > max) max = wf[i]; } }
          const amp = usaDett ? max : (cnt ? sum / cnt : 0);
          const barH = amp * (h - 40);
          const y = 20 + (h - 40) / 2 - barH / 2;
          ctx.moveTo(px + 0.5, y);
          ctx.lineTo(px + 0.5, y + barH);
        }
        ctx.stroke();
      }

      // ruler
      const dur = this.durationMs, vis = this.vd();
      const tick = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000].find((t) => vis / t <= 12) || 60000;
      ctx.font = '10px "JetBrains Mono", monospace';
      for (let ms = Math.ceil(this.viewStart / tick) * tick; ms <= Math.min(dur, this.viewStart + vis); ms += tick) {
        const x = this.msToX(ms);
        ctx.fillStyle = "#8b949e";
        ctx.fillText(fmtPreciso(ms, tick), x + 2, 10);
        ctx.strokeStyle = "#21262d";
        ctx.beginPath(); ctx.moveTo(x, 14); ctx.lineTo(x, h); ctx.stroke();
      }

      // marker
      const drawMarker = (ms, color, pieno) => {
        const x = this.msToX(ms);
        ctx.setLineDash(pieno ? [] : [4, 8]);
        ctx.strokeStyle = color; ctx.lineWidth = pieno ? 2 : 1;
        ctx.beginPath(); ctx.moveTo(x, 14); ctx.lineTo(x, h); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.beginPath();
        const r = pieno ? 7 : 5;
        ctx.moveTo(x, 0); ctx.lineTo(x - r, 13); ctx.lineTo(x + r, 13);
        ctx.closePath(); ctx.fill();
      };
      // primo e ultimo marker di ogni INTERPOLA: colore della sezione, linea piena
      const bordi = new Set();
      for (const sz of this.sections) { bordi.add(sz.start_ms); bordi.add(sz.end_ms); }
      for (const ms of this.beats) {
        if (this.gruppo && this.gruppo.set.has(ms)) continue;
        if (this.selected.has(ms)) drawMarker(ms, "#f0c040", bordi.has(ms));
        else if (bordi.has(ms)) drawMarker(ms, COLORE_BORDO_SEZIONE, true);
        else drawMarker(ms, "rgba(255,255,255,0.35)", false);
      }
      if (this.correnteMs !== null && this.beats.includes(this.correnteMs) && !(this.gruppo && this.gruppo.set.has(this.correnteMs))) {
        const ms = this.correnteMs, x = this.msToX(ms);
        drawMarker(ms, "#00f0ff", true);
        const num = String(this.beats.filter((b) => b > 0 && b <= ms).length);      // numero del marker (lo 0 non conta)
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        const larg = ctx.measureText(num).width + 8, lx = Math.max(0, Math.min(w - larg, x + 9));
        ctx.fillStyle = "#00f0ff"; ctx.fillRect(lx, 1, larg, 13);
        ctx.fillStyle = "#05060a"; ctx.fillText(num, lx + 4, 11);
      }
      // marker che hanno una FORMAZIONE salvata (lo dice l'editor): rombo fucsia ai piedi del marker
      if (this.formazioniMs && this.formazioniMs.size) {
        ctx.fillStyle = "#ff2bd6"; ctx.strokeStyle = "#05060a"; ctx.lineWidth = 1;
        for (const ms of this.beats) {
          if (!this.formazioniMs.has(ms)) continue;
          const x = this.msToX(ms);
          if (x < -8 || x > w + 8) continue;
          ctx.beginPath(); ctx.moveTo(x, h - 13); ctx.lineTo(x + 6, h - 7); ctx.lineTo(x, h - 1); ctx.lineTo(x - 6, h - 7); ctx.closePath();
          ctx.fill(); ctx.stroke();
        }
      }
      if (this.dragMs !== null) drawMarker(this.dragMs, "#58a6ff");
      if (this.gruppo) for (const ms of this.gruppo.set) drawMarker(ms + this.gruppo.delta, "#58a6ff", bordi.has(ms));

      // selezione a rettangolo
      if (this.rubber) {
        const x1 = Math.min(this.rubber.a, this.rubber.b), x2 = Math.max(this.rubber.a, this.rubber.b);
        ctx.fillStyle = "rgba(240,192,64,0.14)"; ctx.fillRect(x1, 0, x2 - x1, h);
        ctx.strokeStyle = "rgba(240,192,64,0.8)"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.strokeRect(x1 + 0.5, 0.5, x2 - x1 - 1, h - 1); ctx.setLineDash([]);
      }

      // playhead
      const px = this.msToX(this.playheadMs);
      ctx.strokeStyle = "#ff4444"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
      this.renderMini();
    }

    // barra panoramica: tutta la canzone + riquadro della parte che stai guardando
    renderMini() {
      const c = this.mini;
      if (!c || !this.cssW) return;
      const dpr = window.devicePixelRatio || 1, w = this.cssW, h = MINI_H;
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.height = h + "px"; }
      const g = c.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#0d1117"; g.fillRect(0, 0, w, h);
      const wf = this.waveform, tot = this.durationMs;
      if (wf.length && tot) {
        g.strokeStyle = "#2f4f7a"; g.beginPath();
        const perMsMini = this.waveMs ? 1 / this.waveMs : wf.length / tot;
        for (let x = 0; x < w; x++) {
          const a = Math.floor(x / w * tot * perMsMini), b = Math.max(a + 1, Math.floor((x + 1) / w * tot * perMsMini));
          let m = 0; for (let i = a; i < b && i < wf.length; i++) m = Math.max(m, wf[i]);
          g.moveTo(x + 0.5, h / 2 - m * h * 0.42); g.lineTo(x + 0.5, h / 2 + m * h * 0.42);
        }
        g.stroke();
        g.fillStyle = "rgba(255,255,255,0.35)";
        for (const ms of this.beats) g.fillRect(Math.round(ms / tot * w), 0, 1, 4);
        const x1 = this.viewStart / tot * w, x2 = (this.viewStart + this.vd()) / tot * w;
        g.fillStyle = "rgba(88,166,255,0.16)"; g.fillRect(x1, 0, Math.max(2, x2 - x1), h);
        g.strokeStyle = "#58a6ff"; g.lineWidth = 1; g.strokeRect(x1 + 0.5, 0.5, Math.max(2, x2 - x1) - 1, h - 1);
        g.fillStyle = "#ff4444"; g.fillRect(Math.round(this.playheadMs / tot * w), 0, 2, h);
      }
    }
  }

  // ============================================================
  // UNDO MANAGER
  // ============================================================
  class UndoManager {
    constructor() { this.stack = []; this.pos = -1; }
    push(snap) {
      this.stack = this.stack.slice(0, this.pos + 1);
      // dopo un annulla lo stato attuale e' gia' in cima: non duplicarlo
      if (this.stack.length && JSON.stringify(this.stack[this.stack.length - 1]) === JSON.stringify(snap)) {
        this.pos = this.stack.length - 1;
        return;
      }
      this.stack.push(snap);
      if (this.stack.length > 100) this.stack.shift();
      this.pos = this.stack.length - 1;
    }
    undo() { return this.pos > 0 ? this.stack[--this.pos] : null; }
    redo() { return this.pos < this.stack.length - 1 ? this.stack[++this.pos] : null; }
  }

  // ============================================================
  // STATO E DOM
  // ============================================================
  const canvas = document.getElementById("aa-canvas");
  const wc = new WaveformCanvas(canvas);
  const undoMgr = new UndoManager();
  let audioId = null;
  let audioEl = null;
  let audioNome = "";          // nome del file audio caricato (per riprendere una coreografia)
  let isPlaying = false;

  const el = (id) => document.getElementById(id);
  const waveCard = el("aa-wave-card");
  const secCard = el("aa-sections-card");

  function pushUndo() { undoMgr.push(wc.snapshot()); }

  function refresh() {
    wc.render();
    el("aa-marker-count").textContent = wc.beats.length;
    el("aa-sel-count").textContent = wc.selected.size;
    el("aa-interp").disabled = wc.selected.size !== 2;
    el("aa-remove").disabled = wc.selected.size === 0;
    renderSections();
    CoreoBridge._notify();
  }

  // ============================================================
  // PONTE per l'editor COREOGRAFIA (web/coreografia.js).
  // Additivo: se coreografia.js non c'e', non succede nulla.
  // L'editor si riallinea ai marker via _notify() -> state().
  // ============================================================
  const CoreoBridge = (window.CoreoBridge = {
    _subs: [],
    subscribe(fn) {
      this._subs.push(fn);
      try { fn(this.state()); } catch (e) { console.error(e); }
    },
    state() {
      return {
        beats: wc.beats.slice(),
        sections: JSON.parse(JSON.stringify(wc.sections)),
        durationMs: wc.durationMs,
        hasAudio: !!audioEl,
        audioNome,
        focusMs: this.focusMs,      // marker appena cliccato: l'editor mostra la sua formazione
        selezionati: Array.from(wc.selected).sort((a, b) => a - b),   // marker selezionati sulla waveform
      };
    },
    focusMs: null,
    // l'editor dice su quale marker sta lavorando: viene evidenziato sulla waveform
    setCorrente(ms) {
      if (wc.correnteMs === ms) return;
      wc.correnteMs = ms;
      wc.mostra(ms == null ? wc.playheadMs : ms);
      wc.render();
    },
    // l'editor COREOGRAFIA registra qui una funzione che restituisce i SUOI marker salvati
    // ({beats, sections, audioNome}) se ha del lavoro in corso, altrimenti null
    fornitore: null,
    // rimette sulla waveform i marker di una coreografia (APRI PROGETTO con l'audio gia' caricato)
    impostaMarker(beats, sections) {
      if (!audioEl) return false;
      wc.beats = Array.from(new Set([0, ...beats])).sort((a, b) => a - b);
      wc.sections = JSON.parse(JSON.stringify(sections || []));
      wc.selected.clear();
      undoMgr.stack = []; undoMgr.pos = -1; pushUndo();
      refresh();
      return true;
    },
    _notify() {
      const s = this.state();
      this.focusMs = null;
      for (const fn of this._subs) { try { fn(s); } catch (e) { console.error(e); } }
    },
    seek(ms) { seek(ms); },
    // --- per i progetti salvati e gli strumenti dell'editor (CANONE, INCOLLA TRATTO...) ---
    // carica un file audio come se lo avessi scelto tu (APRI PROGETTO rimette la musica da solo)
    caricaAudio(file, daProgetto) { return uploadAudio(file, daProgetto); },
    // l'editor registra qui una funzione chiamata quando TU carichi una musica nuova (la copia nel progetto)
    suAudio: null,
    // aggiunge marker in questi istanti (ms); restituisce quelli che ci sono davvero dopo (arrotondati)
    aggiungiMarker(lista) {
      if (!audioEl) return [];
      pushUndo();
      const messi = lista.map((ms) => wc.addMarkerAt(ms));
      refresh();
      return messi;
    },
    // ⌘Z unico dell'editor: rimette i marker e le sezioni di una "fotografia" precedente
    ripristinaMarker(beats, sections) {
      if (!audioEl) return false;
      wc.beats = Array.from(new Set([0, ...beats])).sort((a, b) => a - b);
      wc.sections = JSON.parse(JSON.stringify(sections || []));
      wc.selected = new Set(Array.from(wc.selected).filter((ms) => wc.beats.includes(ms)));
      refresh();
      return true;
    },
    annulla: null, ripeti: null,     // li mette l'editor COREOGRAFIA (annulla unico)
    // l'editor dice su quali marker c'e' una formazione salvata: sulla waveform hanno un rombo fucsia
    setFormazioni(lista) { wc.formazioniMs = new Set(lista); wc.render(); },
    // da chiamare DENTRO il clic: il browser lascia partire l'audio solo nell'istante di un clic
    sbloccaAudio() { try { const c = ctxAudio(); if (c.state !== "running") c.resume(); } catch (e) {} },
    // per SCARICA VIDEO: la posizione della musica cosi' come viene REGISTRATA nel file (orologio
    // dell'audio, senza il ritardo delle casse). Con le casse Bluetooth quel ritardo arriva a 0,2 s:
    // usando l'altra posizione, nel video le luci finivano in ritardo rispetto alla musica.
    posizioneRegistrata() {
      if (!(isPlaying && motore.src)) return wc.playheadMs;
      const ms = motore.daMs + (motore.ctx.currentTime - motore.inizioCtx) * 1000;
      return Math.max(motore.daMs, Math.min(wc.durationMs, ms));
    },
    // per GUARDA LO SHOW (anteprima animata): stesso motore audio della waveform
    posizioneOra() { return isPlaying && motore.src ? posizioneSentita() : (isPlaying && audioEl && !motore.buf ? audioEl.currentTime * 1000 : wc.playheadMs); },
    inRiproduzione() { return isPlaying; },
    playPausa() { togglePlay(); },
    // SCARICA VIDEO dell'anteprima: la musica come "flusso" da registrare (null se non disponibile)
    flussoAudio() {
      if (!motore.buf) return null;
      try {
        const c = ctxAudio();
        if (c.state === "suspended") c.resume();
        motore.dest = c.createMediaStreamDestination();
        // SILENZIO CONTINUO verso la registrazione: senza, la traccia audio del video cominciava solo
        // quando partiva la musica (dopo l'immagine) e nel file finiva ANTICIPATA di ~0,4 s rispetto
        // alle luci. Cosi' audio e immagine cominciano insieme e restano allineati.
        const muto = c.createGain(); muto.gain.value = 0;
        const osc = c.createOscillator(); osc.connect(muto); muto.connect(motore.dest); osc.start();
        motore.destOsc = osc;
        return motore.dest.stream;
      } catch (e) { motore.dest = null; return null; }
    },
    fineFlusso() {
      try { if (motore.destOsc) { motore.destOsc.stop(); motore.destOsc.disconnect(); } } catch (e) {}
      motore.destOsc = null; motore.dest = null;
    },
    selezionaMarker(lista) {
      wc.selected = new Set(lista.filter((ms) => wc.beats.includes(ms)));
      refresh();
    },
  });

  function renderSections() {
    const list = el("aa-sec-list");
    // riquadro "SEZIONI CREATE" nascosto (scelta dell'utente: non gli serve). Le sezioni
    // esistono ancora: colorano le righe nell'XLSX e i marker di inizio/fine restano verdi.
    secCard.style.display = "none";
    return;
    list.innerHTML = wc.sections.map((s, i) => {
      const n = wc.beats.filter(ms => ms >= s.start_ms && ms <= s.end_ms).length;
      return `<span class="aa-sec-item">
        <span class="aa-sec-sw" style="background:#${s.color}"></span>
        ${fmtTime(s.start_ms)} → ${fmtTime(s.end_ms)} (${n})
        <button class="aa-sec-rm" data-sec="${i}">×</button>
      </span>`;
    }).join("");
    list.querySelectorAll("[data-sec]").forEach(b =>
      b.addEventListener("click", () => {
        pushUndo();
        wc.sections.splice(parseInt(b.dataset.sec), 1);
        refresh();
      }));
  }

  // ============================================================
  // UPLOAD
  // ============================================================
  const drop = el("aa-drop");
  el("aa-choose").addEventListener("click", () => el("aa-file").click());
  el("aa-file").addEventListener("change", (e) => { if (e.target.files[0]) uploadAudio(e.target.files[0]); });
  ["dragover", "dragenter"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("dragover"); }));
  drop.addEventListener("drop", e => { if (e.dataTransfer.files[0]) uploadAudio(e.dataTransfer.files[0]); });

  async function uploadAudio(file, daProgetto) {
    // pulisci l'eventuale brano precedente
    if (audioId) cleanupAudio(audioId);
    if (audioEl) { audioEl.pause(); audioEl = null; }
    fermaSorgente(); motore.buf = null; isPlaying = false; el("aa-play").textContent = "▶ Play";

    t("Caricamento e analisi waveform…", "info", 2000);
    el("aa-file-info").textContent = "caricamento…";
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/carica-audio", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 501) showDependencyWarning(data.error);
        throw new Error(data.error || "errore");
      }
      audioId = data.audio_id;
      wc.waveform = data.waveform || [];
      wc.durationMs = data.durata_ms || 0;
      wc.beats = (data.beats && data.beats.length) ? data.beats.slice() : [0];
      wc.sections = [];
      wc.dettaglio = data.dettaglio || [];
      wc.dettMs = data.dettaglio_ms || 5;
      wc.waveMs = data.waveform_ms || 0;
      wc.viewStart = 0; wc.viewDur = 0;
      // RIPRESA DEL LAVORO: se l'editor ha una coreografia in corso, rimette i SUOI marker
      // (e le sezioni) invece di quelli automatici -> niente effetti persi
      let salvato = null;
      try { salvato = CoreoBridge.fornitore ? CoreoBridge.fornitore() : null; } catch (e) { console.error(e); }
      if (salvato && salvato.beats && salvato.beats.length) {
        wc.beats = Array.from(new Set([0, ...salvato.beats])).sort((a, b) => a - b);
        wc.sections = JSON.parse(JSON.stringify(salvato.sections || []));
        // (dopo il messaggio "Brano caricato", altrimenti lo coprirebbe)
        const diverso = salvato.audioNome && salvato.audioNome !== data.filename;
        setTimeout(() => diverso
          ? t(`Attenzione: la coreografia era fatta con "${salvato.audioNome}", hai caricato "${data.filename}". ` +
              `Ho rimesso i suoi marker lo stesso. Per uno show nuovo: premi NUOVO e ricarica l'audio.`, "err", 12000)
          : t("Coreografia ripresa: marker ed effetti come li avevi lasciati", "ok", 5000), 1500);
      }
      audioNome = data.filename || "";
      wc.selected.clear();
      wc.nextColorIndex = 0;
      wc.playheadMs = 0;

      audioEl = new Audio(`/api/audio/${audioId}`);   // riserva, se il motore preciso non riesce a leggere il file
      audioEl.preload = "auto";
      audioEl.addEventListener("ended", () => { isPlaying = false; el("aa-play").textContent = "▶ Play"; });
      el("aa-file-info").textContent = "preparo l'audio…";
      try {
        motore.buf = await decodifica(`/api/audio/${audioId}`);
      } catch (err) {
        motore.buf = null;
        console.warn("motore audio preciso non disponibile, uso il lettore del browser", err);
      }

      waveCard.style.display = "";
      if (!el("aa-titolo").value.trim()) {
        el("aa-titolo").value = (data.filename || "").replace(/\.[^.]+$/, "").toUpperCase().slice(0, 40);
      }
      el("aa-file-info").textContent = `${data.filename} · ${fmtTime(wc.durationMs)}`;
      undoMgr.stack = []; undoMgr.pos = -1; pushUndo();
      wc.resize();
      refresh();
      updateTime();
      aggiornaZoomLbl();
      t("Brano caricato", "ok");
      if (!daProgetto && CoreoBridge.suAudio) { try { CoreoBridge.suAudio(file); } catch (e) { console.error(e); } }
      return true;
    } catch (e) {
      el("aa-file-info").textContent = "errore caricamento";
      t(e.message, "err", 5000);
    }
  }

  function showDependencyWarning(msg) {
    root.querySelector(".aa").insertAdjacentHTML("afterbegin",
      `<div class="aa-warn">⚠ ${esc(msg || "soundfile richiesto. Esegui: pip install soundfile")}</div>`);
  }

  async function cleanupAudio(id) {
    try {
      await fetch("/api/pulisci-audio", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio_id: id }),
      });
    } catch { /* best-effort */ }
  }

  // ============================================================
  // PLAYBACK
  // ============================================================
  // MOTORE AUDIO PRECISO (Web Audio): il brano e' decodificato in memoria e suonato con
  // l'orologio audio; la linea rossa segue l'istante che esce DAVVERO dalle casse (ritardo
  // dell'uscita compreso). Il lettore <audio> del browser partiva in ritardo rispetto alla linea
  // e con gli MP3 sbagliava i salti. Se la decodifica fallisce si usa il lettore di prima.
  const motore = { ctx: null, buf: null, src: null, inizioCtx: 0, daMs: 0 };
  // ANTICIPO: compensa il ritardo con cui Safari (Mac dell'utente, altoparlanti MacBook) fa
  // arrivare il suono rispetto all'orologio audio. I 120 ms tarati prima compensavano in realta'
  // l'errore della waveform dettagliata (corretto con dettaglio_ms): ora il ritardo vero e' minimo.
  const ANTICIPO_MS = 0;
  // posizione che si sta SENTENDO adesso: usata per la linea rossa, la pausa e il tasto M
  const posizioneSentita = () => Math.min(wc.durationMs, Math.max(motore.daMs, posizioneMs() + ANTICIPO_MS));
  function ctxAudio() {
    if (!motore.ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      motore.ctx = new C({ latencyHint: "interactive" });
    }
    return motore.ctx;
  }
  async function decodifica(url) {
    const dati = await (await fetch(url)).arrayBuffer();
    const c = ctxAudio();
    return await new Promise((ok, ko) => c.decodeAudioData(dati, ok, ko));
  }
  function oraUdibile() {
    // orologio audio cosi' com'e': il piccolo ritardo delle casse (pochi ms) e' compensato dal
    // ritardo con cui lo schermo disegna la linea. La stima del ritardo di Safari
    // (getOutputTimestamp) era troppo grande: la linea arrivava DOPO il suono.
    const c = motore.ctx;
    return c.currentTime - (c.outputLatency || 0);
  }
  function posizioneMs() {
    if (!motore.src) return wc.playheadMs;
    const ms = motore.daMs + (oraUdibile() - motore.inizioCtx) * 1000;
    return Math.max(motore.daMs, Math.min(wc.durationMs, ms));   // la linea aspetta il suono vero
  }
  function fermaSorgente() {
    if (!motore.src) return;
    motore.src.onended = null;
    try { motore.src.stop(); } catch {}
    motore.src.disconnect();
    motore.src = null;
  }
  function avviaDa(ms) {
    const c = ctxAudio();
    if (c.state === "suspended") c.resume();
    fermaSorgente();
    const s = c.createBufferSource();
    s.buffer = motore.buf;
    s.connect(c.destination);
    if (motore.dest) s.connect(motore.dest);          // SCARICA VIDEO: la musica va anche nella registrazione
    s.onended = () => {
      if (motore.src !== s) return;
      motore.src = null; isPlaying = false;
      el("aa-play").textContent = "▶ Play";
      wc.playheadMs = wc.durationMs; wc.render(); updateTime();
    };
    motore.daMs = ms;
    motore.inizioCtx = c.currentTime;
    s.start(0, ms / 1000);
    motore.src = s;
  }

  function play() {
    if (!audioEl) return;
    if (motore.buf) avviaDa(wc.playheadMs >= wc.durationMs - 5 ? 0 : wc.playheadMs);
    else audioEl.play();
    isPlaying = true;
    el("aa-play").textContent = "⏸ Pausa";
    syncLoop();
  }
  function pause() {
    if (!audioEl) return;
    if (motore.buf) { wc.playheadMs = motore.src ? posizioneSentita() : wc.playheadMs; fermaSorgente(); }
    else audioEl.pause();
    isPlaying = false;
    el("aa-play").textContent = "▶ Play";
    wc.render(); updateTime();
  }
  function togglePlay() { isPlaying ? pause() : play(); }
  function stop() {
    if (!audioEl) return;
    pause();
    audioEl.currentTime = 0;
    wc.playheadMs = 0;
    wc.render(); updateTime();
  }
  function syncLoop() {
    if (!audioEl || !isPlaying) return;
    if (!motore.buf && audioEl.paused) return;
    wc.playheadMs = motore.buf ? posizioneSentita() : audioEl.currentTime * 1000;
    wc.mostra(wc.playheadMs);
    wc.render(); updateTime(); aggiornaZoomLbl();
    requestAnimationFrame(syncLoop);
  }
  function updateTime() {
    el("aa-time").textContent = `${fmtTime(wc.playheadMs)} / ${fmtTime(wc.durationMs)}`;
  }
  function seek(ms) {
    ms = Math.max(0, Math.min(wc.durationMs, ms));
    if (motore.buf) { if (isPlaying) avviaDa(ms); }
    else if (audioEl) audioEl.currentTime = ms / 1000;
    wc.playheadMs = ms;
    wc.mostra(ms);
    wc.render(); updateTime(); aggiornaZoomLbl();
  }

  // ============================================================
  // ZOOM: pizzico trackpad, due dita per scorrere, pulsanti, barra panoramica
  // ============================================================
  wc.mini = el("aa-mini");
  // WAVEFORM AGGANCIATA: scorrendo giu' verso il palco resta in alto (piu' compatta), risalendo torna normale
  if (false && "IntersectionObserver" in window) {   // [mini app] aggancio disattivato
    new IntersectionObserver(([v]) => {
      const agganciata = !v.isIntersecting && v.boundingClientRect.top < 0;
      if (waveCard.classList.contains("pinned") === agganciata) return;
      waveCard.classList.toggle("pinned", agganciata);
      wc.altezza = agganciata ? 96 : 160;
      if (waveCard.style.display !== "none") wc.resize();
    }, { threshold: 0 }).observe(el("aa-wave-sentinella"));
  }
  function aggiornaZoomLbl() {
    const l = el("aa-zoom-lbl");
    if (!l) return;
    l.textContent = wc.zoomato()
      ? `zoom ${Math.round(wc.durationMs / wc.vd())}× · vedi ${(wc.vd() / 1000).toFixed(wc.vd() < 10000 ? 1 : 0)} s`
      : "canzone intera · due dita per lo zoom";
  }
  function zoomCentro(f) {
    if (!wc.durationMs) return;
    const x = wc.playheadMs >= wc.viewStart && wc.playheadMs <= wc.viewStart + wc.vd() ? wc.msToX(wc.playheadMs) : wc.cssW / 2;
    wc.zoomAt(x, f); wc.render(); aggiornaZoomLbl();
  }
  el("aa-zoom-in").addEventListener("click", () => zoomCentro(2));
  el("aa-zoom-out").addEventListener("click", () => zoomCentro(0.5));
  el("aa-zoom-tutto").addEventListener("click", () => { wc.setView(0, wc.durationMs); wc.render(); aggiornaZoomLbl(); });

  const wrapZoom = el("aa-canvas-wrap");
  wrapZoom.addEventListener("wheel", (e) => {
    if (!wc.durationMs) return;
    const { x } = canvasXY(e);
    if (e.ctrlKey) {                                   // pizzico del trackpad (Chrome/Firefox)
      e.preventDefault();
      wc.zoomAt(x, Math.exp(-e.deltaY * 0.012));
    } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && wc.zoomato()) {   // due dita a destra/sinistra
      e.preventDefault();
      wc.setView(wc.viewStart + (e.deltaX / wc.cssW) * wc.vd(), wc.vd());
    } else {
      return;                                          // su/giu': scorre la pagina come sempre
    }
    wc.render(); aggiornaZoomLbl();
  }, { passive: false });
  // Safari: il pizzico arriva come "gesture"
  let gesto = null;
  wrapZoom.addEventListener("gesturestart", (e) => {
    e.preventDefault();
    gesto = { start: wc.viewStart, dur: wc.vd(), x: canvasXY(e).x };
  });
  wrapZoom.addEventListener("gesturechange", (e) => {
    if (!gesto) return;
    e.preventDefault();
    const ms = gesto.start + (gesto.x / wc.cssW) * gesto.dur, dur = gesto.dur / e.scale;
    wc.setView(ms - (gesto.x / wc.cssW) * dur, dur);
    wc.render(); aggiornaZoomLbl();
  });
  wrapZoom.addEventListener("gestureend", (e) => { e.preventDefault(); gesto = null; });

  // barra panoramica: clic o trascinamento = sposta la vista (centrata sul punto)
  let miniDrag = false;
  const miniVai = (e) => {
    const r = wc.mini.getBoundingClientRect();
    const ms = ((e.clientX - r.left) / r.width) * wc.durationMs;
    if (wc.zoomato()) wc.setView(ms - wc.vd() / 2, wc.vd());
    else seek(ms);
    wc.render(); aggiornaZoomLbl();
  };
  wc.mini.addEventListener("mousedown", (e) => { miniDrag = true; miniVai(e); });
  window.addEventListener("mousemove", (e) => { if (miniDrag) miniVai(e); });
  window.addEventListener("mouseup", () => { miniDrag = false; });

  el("aa-play").addEventListener("click", togglePlay);
  el("aa-stop").addEventListener("click", stop);

  // ============================================================
  // POINTER: seek / select / drag
  // ============================================================
  let pointer = null;
  const DRAG_THRESH = 4;

  function canvasXY(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener("mousedown", (e) => {
    const { x, y } = canvasXY(e);
    const idx = wc.findMarkerAt(x, y);
    pointer = { startX: x, startY: y, moved: false, idx, shift: e.shiftKey, meta: e.metaKey || e.ctrlKey, dragging: false };
  });

  window.addEventListener("mousemove", (e) => {
    if (!pointer) return;
    const { x } = canvasXY(e);
    if (!pointer.moved && Math.abs(x - pointer.startX) > DRAG_THRESH) pointer.moved = true;

    // avvia drag di un marker
    if (pointer.moved && pointer.idx >= 0 && !pointer.dragging && !pointer.gruppo) {
      const ms0 = wc.beats[pointer.idx];
      const sel = [...wc.selected].filter((m) => m > 0);
      if (ms0 > 0 && wc.selected.has(ms0) && sel.length > 1) {
        pointer.gruppo = true;                    // trascino UNO dei selezionati: si muovono tutti
        pointer.startMs = ms0;
        wc.gruppo = { set: new Set(sel), delta: 0 };
      }
    }
    if (pointer.gruppo) {
      wc.gruppo.delta = limitaDelta([...wc.gruppo.set], Math.round(wc.xToMs(x)) - pointer.startMs);
      wc.render();
      return;
    }
    if (pointer.moved && pointer.idx >= 0 && !pointer.dragging) {
      pushUndo();
      pointer.dragging = true;
      const ms = wc.beats[pointer.idx];
      pointer.dragWasSelected = wc.selected.has(ms);
      wc.selected.delete(ms);
      wc.beats.splice(pointer.idx, 1);
      wc.dragMs = ms;
    }
    if (pointer.dragging) {
      wc.dragMs = Math.max(0, Math.min(wc.durationMs, Math.round(wc.xToMs(x))));
      wc.render();
    }
    // trascinamento su una zona senza marker = selezione a rettangolo
    if (pointer.moved && pointer.idx < 0) {
      pointer.rubber = true;
      wc.rubber = { a: pointer.startX, b: Math.max(0, Math.min(wc.cssW, x)) };
      wc.render();
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (!pointer) return;
    const p = pointer; pointer = null;

    if (p.gruppo) {
      const d = wc.gruppo.delta;
      wc.gruppo = null;
      if (!spostaSelezionati(d)) wc.render();
      return;
    }
    if (p.rubber) {
      const a = wc.xToMs(Math.min(wc.rubber.a, wc.rubber.b)), b = wc.xToMs(Math.max(wc.rubber.a, wc.rubber.b));
      wc.rubber = null;
      if (!(p.shift || p.meta)) wc.selected.clear();     // con ⇧ o ⌘ aggiunge alla selezione
      for (const ms of wc.beats) if (ms >= a && ms <= b) wc.selected.add(ms);
      refresh();
      return;
    }
    if (p.dragging) {
      const ms = wc.addMarkerAt(wc.dragMs);
      wc.dragMs = null;
      if (p.dragWasSelected) wc.selected.add(ms);
      refresh();
      return;
    }

    if (p.idx >= 0) {
      // click su marker → selezione
      const ms = wc.beats[p.idx];
      if (p.shift || p.meta) {
        wc.selected.has(ms) ? wc.selected.delete(ms) : wc.selected.add(ms);
      } else {
        wc.selected.clear();
        wc.selected.add(ms);
      }
      CoreoBridge.focusMs = ms;                    // il palco dell'editor va a questo marker
      refresh();
    } else if (!p.moved) {
      // click sul vuoto → seek + deseleziona
      const { x } = canvasXY(e);
      wc.selected.clear();
      seek(wc.xToMs(x));
      refresh();
    }
  });

  // ============================================================
  // MARKER / INTERPOLAZIONE / RIMOZIONE
  // ============================================================
  // ---- spostamento di gruppo dei marker selezionati (il marker a 0 resta fermo) ----
  function limitaDelta(grp, delta) {
    if (!grp.length) return 0;
    const min = Math.min(...grp), max = Math.max(...grp);
    return Math.max(1 - min, Math.min(wc.durationMs - max, delta));
  }
  function spostaSelezionati(delta) {
    const grp = [...wc.selected].filter((ms) => ms > 0).sort((a, b) => a - b);
    delta = limitaDelta(grp, Math.round(delta));
    if (!grp.length || !delta) return false;
    const nuovi = grp.map((ms) => ms + delta);
    const fermi = new Set(wc.beats.filter((ms) => !wc.selected.has(ms) || ms === 0));
    if (nuovi.some((ms) => fermi.has(ms))) { t("Non si può: un marker finirebbe sopra un altro", "err"); return false; }
    pushUndo();
    const mossa = new Map(grp.map((ms, i) => [ms, nuovi[i]]));
    wc.beats = [...fermi, ...nuovi].sort((a, b) => a - b);
    wc.selected = new Set(nuovi.concat(wc.selected.has(0) ? [0] : []));
    for (const s of wc.sections) {                // le sezioni (Interpola) seguono i loro marker
      if (mossa.has(s.start_ms)) s.start_ms = mossa.get(s.start_ms);
      if (mossa.has(s.end_ms)) s.end_ms = mossa.get(s.end_ms);
    }
    refresh();
    return true;
  }

  function addMarkerAtPlayhead() {
    pushUndo();
    const ms = wc.addMarkerAt(isPlaying && motore.src ? posizioneSentita() : wc.playheadMs);
    wc.selected.clear(); wc.selected.add(ms);
    refresh();
  }

  function removeSelected() {
    if (!wc.selected.size) return;
    pushUndo();
    wc.removeSelected();
    refresh();
  }
  el("aa-remove").addEventListener("click", removeSelected);

  const pop = el("aa-interp-pop");
  function openInterp() {
    const sel = Array.from(wc.selected).sort((a, b) => a - b);
    if (sel.length !== 2) return;
    el("aa-pop-range").textContent = `Da ${sel[0]}ms a ${sel[1]}ms (${sel[1] - sel[0]}ms)`;
    pop.dataset.a = sel[0]; pop.dataset.b = sel[1];
    pop.style.display = "";
    const inp = el("aa-interp-n"); inp.focus(); inp.select();
  }
  function closeInterp() { pop.style.display = "none"; }
  el("aa-interp").addEventListener("click", openInterp);
  el("aa-interp-cancel").addEventListener("click", closeInterp);
  pop.addEventListener("click", (e) => { if (e.target === pop) closeInterp(); });
  el("aa-interp-apply").addEventListener("click", applyInterp);
  el("aa-interp-n").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); applyInterp(); }
    if (e.key === "Escape") { e.preventDefault(); closeInterp(); }
  });
  function applyInterp() {
    const a = parseInt(pop.dataset.a), b = parseInt(pop.dataset.b);
    const n = parseInt(el("aa-interp-n").value);
    if (!n || n < 1) return t("Numero marker non valido", "err");
    pushUndo();
    wc.interpolate(a, b, n);
    wc.selected = new Set([Math.min(a, b), Math.max(a, b)]);
    closeInterp();
    refresh();
    t(`${n} marker aggiunti`, "ok");
  }

  // ============================================================
  // EXPORT XLSX
  // ============================================================
  el("aa-export").addEventListener("click", async () => {
    if (!wc.beats.length) return t("Nessun marker da esportare", "err");
    const titolo = el("aa-titolo").value.trim();
    const racchette = parseInt(el("aa-racchette").value);
    const master = parseInt(el("aa-master").value);
    if (!titolo) return t("Inserisci il titolo dello show", "err");
    if (!racchette || racchette < 1) return t("Numero racchette non valido", "err");
    if (!master || master < 1 || master > racchette) return t(`Master deve essere tra 1 e ${racchette}`, "err");

    try {
      const res = await fetch("/api/esporta-xlsx-da-audio", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titolo, racchette, master, beats: wc.beats, sections: wc.sections }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "errore"); }
      const blob = await res.blob();
      const fname = (titolo.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") || "show") + ".xlsx";
      if (typeof downloadBlob === "function") downloadBlob(blob, fname);
      t("XLSX esportato: " + fname + " — ora compila gli effetti in Excel (da 0 al primo marker: sync)", "ok", 5000);
    } catch (e) { t(e.message, "err", 5000); }
  });

  // ============================================================
  // KEYBOARD
  // ============================================================
  function audioTabVisible() {
    const tab = document.getElementById("tab-audio");
    return tab && tab.style.display !== "none";
  }
  document.addEventListener("keydown", (e) => {
    if (!audioTabVisible()) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (pop.style.display !== "none") return;

    if (e.key === " " || e.code === "Space") { e.preventDefault(); togglePlay(); }
    else if (e.key === "Escape") { e.preventDefault(); stop(); }
    else if (e.key === "m" || e.key === "M") { e.preventDefault(); if (audioEl) addMarkerAtPlayhead(); }
    else if (e.key === "i" || e.key === "I") { e.preventDefault(); if (wc.selected.size === 2) openInterp(); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeSelected(); }
    else if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      // ANNULLA UNICO: se c'e' l'editor COREOGRAFIA, ⌘Z annulla l'ultima azione qualunque sia
      // (marker, effetto, spostamento, canone...). Senza editor resta l'annulla dei soli marker.
      if (CoreoBridge.annulla) { e.shiftKey ? CoreoBridge.ripeti() : CoreoBridge.annulla(); return; }
      // le istantanee sono salvate PRIMA di ogni modifica: al primo annulla si salva anche lo stato
      // attuale (cosi' ⇧⌘Z lo ritrova) e si torna esattamente a prima dell'ultima azione
      if (!e.shiftKey && undoMgr.pos === undoMgr.stack.length - 1) undoMgr.push(wc.snapshot());
      const snap = e.shiftKey ? undoMgr.redo() : undoMgr.undo();
      if (snap) { wc.restore(snap); refresh(); }
    }
    else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && wc.selected.size) {
      e.preventDefault();                          // Option + frecce: sposta i marker selezionati
      spostaSelezionati((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 100 : 10));
    }
    else if (e.key === "ArrowLeft") { e.preventDefault(); seek(wc.playheadMs - (e.shiftKey ? 100 : 10)); }
    else if (e.key === "ArrowRight") { e.preventDefault(); seek(wc.playheadMs + (e.shiftKey ? 100 : 10)); }
  });

  // ============================================================
  // RESIZE + CLEANUP
  // ============================================================
  if (window.ResizeObserver) {
    new ResizeObserver(() => { if (waveCard.style.display !== "none") wc.resize(); })
      .observe(el("aa-canvas-wrap"));
  } else {
    window.addEventListener("resize", () => { if (waveCard.style.display !== "none") wc.resize(); });
  }
  window.addEventListener("beforeunload", () => {
    if (audioId) navigator.sendBeacon &&
      navigator.sendBeacon("/api/pulisci-audio", new Blob([JSON.stringify({ audio_id: audioId })], { type: "application/json" }));
  });

  // Carica l'editor COREOGRAFIA (il ponte CoreoBridge e il contenitore sono pronti)
  if (!document.getElementById("coreografia-script")) {
    const cs = document.createElement("script");
    cs.id = "coreografia-script";
    cs.src = "editor/coreografia.js";
    cs.onerror = () => t("Errore caricamento editor coreografia", "err");
    document.body.appendChild(cs);
  }
})();
