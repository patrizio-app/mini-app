/* =====================================================================
   MINI APP LED — MOTORE INTERNO (fa le veci del server dell'app LED del Mac)
   L'editor COREOGRAFIA (copiato dal Mac in editor/) chiede i dati a "/api/...":
   qui quelle richieste vengono servite DENTRO il dispositivo, con le stesse
   risposte e gli stessi formati di APP_LED/app.py:
     - progetti, copie di emergenza, libreria gruppi/formazioni  (memoria del dispositivo)
     - analisi della musica (onda), stessa logica di audio_analyzer.py
     - controllo celle con le regole di generate.py (parsa_cella)
     - tabella .xlsx come quella del Mac (titolo, intestazioni, bordi, colori sezioni)
     - "⬇ PER IL MAC": zip con la cartella del progetto (progetto.ledshow.json + audio + xlsx)
     - "⬆ IMPORTA DAL MAC": legge zip di show del Mac (anche più show + _libreria.json)
   ===================================================================== */
(function () {
  'use strict';

  const REG = window.LED_REGISTRO;
  const fetchVero = window.fetch.bind(window);
  const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
  const EMERGENZA_MAX = 30, EMERGENZA_OGNI_S = 600;
  const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // ───────────────────────── memoria del dispositivo ─────────────────────────
  const DB = (function () {
    let p = null;
    const apri = () => p || (p = new Promise((ok, ko) => {
      const r = indexedDB.open('led-mini', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    }));
    const tx = async (modo, fn) => {
      const db = await apri();
      return new Promise((ok, ko) => {
        const t = db.transaction('kv', modo);
        const s = t.objectStore('kv');
        let ris;
        Promise.resolve(fn(s, (v) => { ris = v; })).catch(ko);
        t.oncomplete = () => ok(ris);
        t.onerror = () => ko(t.error);
        t.onabort = () => ko(t.error || new Error('salvataggio annullato (memoria piena?)'));
      });
    };
    return {
      get: (k) => tx('readonly', (s, fine) => { const q = s.get(k); q.onsuccess = () => fine(q.result); }),
      set: (k, v) => tx('readwrite', (s) => { s.put(v, k); }),
      del: (k) => tx('readwrite', (s) => { s.delete(k); }),
    };
  })();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  async function elencoProgetti() { return (await DB.get('progetti')) || {}; }
  async function salvaElenco(e) { await DB.set('progetti', e); }
  const adessoSec = () => Date.now() / 1000;

  // come _nome_progetto di app.py
  function nomeProgetto(nome) {
    let n = String(nome == null ? '' : nome).replace(/[^\p{L}\p{N}\p{M}_ \-]/gu, '').trim();
    n = n.replace(/\s+/g, ' ').slice(0, 60).trim();
    return (!n || n.startsWith('_')) ? '' : n;
  }

  function infoProgetto(nome, voce) {
    const info = { nome: nome, modificato: voce.modificato, racchette: null, marker: null, audio: !!voce.audioExt };
    try {
      const o = JSON.parse(voce.json);
      info.racchette = o.racchette != null ? o.racchette : null;
      info.marker = (o.markers || []).filter((m) => (m.ms || 0) > 0).length;
      info.audioNome = o.audioNome || '';
    } catch (e) { /* progetto rovinato: info minime */ }
    return info;
  }

  // ───────────────────────── risposte "come il server" ─────────────────────────
  const json = (obj, stato) => new Response(JSON.stringify(obj), {
    status: stato || 200, headers: { 'Content-Type': 'application/json' } });
  const errore = (msg, stato) => json({ error: msg }, stato || 400);
  const corpoJson = async (init) => {
    const b = init && init.body;
    if (b == null) return null;
    try {
      if (typeof b === 'string') return JSON.parse(b);
      if (b instanceof Blob) return JSON.parse(await b.text());
    } catch (e) { return null; }
    return null;
  };

  // ───────────────────────── registro (come /api/registro) ─────────────────────────
  function registroPerUi() {
    const eff = {};
    Object.entries(REG.effetti).forEach(([n, e]) => {
      eff[n] = { alias: e.alias || [], params: e.params, fx_pattern: e.fx_pattern || 'generic', attivo: e.attivo !== false };
    });
    return { colori: REG.colori, effetti: eff, blacklist: REG._blacklist || {} };
  }

  // ───────────────────────── regole delle celle (= generate.py) ─────────────────────────
  const COLORI = new Set(Object.keys(REG.colori));
  const EFFETTI = REG.effetti;
  const BLACKLIST = REG._blacklist || {};
  const ALIAS = {};
  Object.entries(EFFETTI).forEach(([nome, d]) => {
    if (d.attivo === false) return;
    ALIAS[nome] = nome;
    (d.alias || []).forEach((a) => { ALIAS[a] = nome; });
  });
  const MARCA_RIPETUTA = '​';
  const LETTERE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const coloriValidi = () => Array.from(COLORI).sort().join(', ');
  const isDigit = (s) => /^[0-9]+$/.test(s);

  function parsaTransizione(args, testo) {
    const uso = 'TRANSIZIONE DX|SX [LETTERA <A-Z>] <COLORE>';
    if (args.length < 2) throw new Error(`sintassi TRANSIZIONE non valida: '${testo}' (uso: '${uso}')`);
    const direzione = args[0];
    if (direzione !== 'DX' && direzione !== 'SX') throw new Error(`TRANSIZIONE: direzione '${direzione}' non valida, usa DX o SX (cella: '${testo}')`);
    let lettera = null, colore;
    if (args.length === 2) colore = args[1];
    else if (args.length === 4 && args[1] === 'LETTERA') {
      lettera = args[2];
      if (lettera.length !== 1 || !LETTERE.includes(lettera)) throw new Error(`TRANSIZIONE: lettera '${lettera}' deve essere A-Z (cella: '${testo}')`);
      colore = args[3];
    } else throw new Error(`sintassi TRANSIZIONE non valida: '${testo}' (uso: '${uso}')`);
    if (!COLORI.has(colore)) throw new Error(`colore non valido in '${testo}': '${colore}' (colori validi: ${coloriValidi()})`);
    const out = { direzione, colore };
    if (lettera) out.lettera = lettera;
    return ['effect', 'TRANSIZIONE', out];
  }

  function parsaHit(args, testo) {
    const uso = 'HIT <COLORE> [SECONDI di fade, es. 0.5]';
    if (!args.length || !COLORI.has(args[0])) throw new Error(`sintassi HIT non valida: '${testo}' (uso: '${uso}'; colori validi: ${coloriValidi()})`);
    const colore = args[0];
    let resto = args.slice(1);
    if (resto.length === 2 && isDigit(resto[0]) && isDigit(resto[1])) resto = [resto[0] + '.' + resto[1]];
    if (!resto.length) return ['effect', 'HIT', { colore }];
    if (resto.length !== 1) throw new Error(`sintassi HIT non valida: '${testo}' (uso: '${uso}')`);
    const v = resto[0].replace(/S+$/, '');
    const sec = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v) ? parseFloat(v) : NaN;
    if (isNaN(sec)) throw new Error(`HIT: durata del fade '${resto[0]}' non valida in '${testo}' (es. 0.5)`);
    if (!(sec >= 0.05 && sec <= 30)) throw new Error(`HIT: durata del fade tra 0.05 e 30 secondi (cella: '${testo}')`);
    return ['effect', 'HIT', { colore, fade: Math.round(sec * 1000) }];
  }

  function parsaCella(testo) {
    const ripetuta = testo.split(MARCA_RIPETUTA).length - 1;
    if (ripetuta) {
      const p = parsaCella(testo.split(MARCA_RIPETUTA).join(''));
      if (p[0] === 'effect' && ['SFUMATURA', 'HIT', 'FADE'].includes(p[1])) return [p[0], p[1], Object.assign({}, p[2], { ripetuta })];
      return p;
    }
    const t = testo.trim().toUpperCase().replace(/\(/g, ' ').replace(/\)/g, ' ').replace(/,/g, ' ');
    const tokens = t.split(/\s+/).filter(Boolean);
    if (!tokens.length) throw new Error('cella vuota dopo forward fill (anomalia)');
    let head = tokens[0], nHead = 1;
    if (tokens.length >= 2) {
      const due = tokens[0] + ' ' + tokens[1];
      if (ALIAS[due] || Object.entries(EFFETTI).some(([nome, d]) => d.attivo === false && (due === nome || (d.alias || []).includes(due)))) {
        head = due; nHead = 2;
      }
    }
    for (const [nomeEff, d] of Object.entries(EFFETTI)) {
      if (d.attivo !== false) continue;
      if (head === nomeEff || (d.alias || []).includes(head)) throw new Error(`effetto '${nomeEff}' e' disattivato: riattivalo dalla pagina Manage`);
    }
    for (const tok of tokens) if (Object.prototype.hasOwnProperty.call(BLACKLIST, tok)) throw new Error(`${tok} non valido: ${BLACKLIST[tok]} (cella: '${testo}')`);
    if (head === 'TRANSIZIONE') return parsaTransizione(tokens.slice(nHead), testo);
    if (head === 'HIT' && EFFETTI.HIT) return parsaHit(tokens.slice(nHead), testo);
    if (tokens.length === 1) {
      if (head === 'BUIO') return ['buio'];
      if (COLORI.has(head)) return ['solid', head];
      if (ALIAS[head]) {
        const nomeEff = ALIAS[head], d = EFFETTI[nomeEff];
        if (!d.params.length) return ['effect', nomeEff, {}];
        const sintassi = head + ' ' + d.params.map((p) => p.name.toUpperCase()).join(' ');
        throw new Error(`sintassi ${nomeEff} non valida: '${testo}' (uso: '${sintassi}')`);
      }
      throw new Error(`token singolo non riconosciuto: '${testo}'`);
    }
    if (ALIAS[head]) {
      const nomeEff = ALIAS[head], d = EFFETTI[nomeEff];
      const valori = tokens.slice(nHead);
      if (valori.length !== d.params.length) {
        const sintassi = head + ' ' + d.params.map((p) => p.name.toUpperCase()).join(' ');
        throw new Error(`sintassi ${nomeEff} non valida: '${testo}' (uso: '${sintassi}')`);
      }
      const out = {};
      d.params.forEach((p, i) => {
        const v = valori[i];
        if (p.type === 'color') {
          if (!COLORI.has(v) && !(nomeEff === 'SFUMATURA' && v === 'BUIO')) throw new Error(`colore non valido in '${testo}': '${v}' (colori validi: ${coloriValidi()})`);
          out[p.name] = v;
        } else if (p.type === 'int') {
          if (!isDigit(v)) throw new Error(`parametro '${p.name}' deve essere un numero in '${testo}', trovato '${v}'`);
          out[p.name] = parseInt(v, 10);
          if (p.name === 'bpm' && !(out.bpm >= 1 && out.bpm <= 600)) throw new Error(`BPM deve essere tra 1 e 600 in '${testo}', trovato ${v}`);
        } else if (p.type === 'char') {
          if (v.length !== 1 || !LETTERE.includes(v)) throw new Error(`parametro '${p.name}' deve essere una lettera A-Z in '${testo}', trovato '${v}'`);
          out[p.name] = v;
        } else throw new Error(`tipo parametro sconosciuto nel registro: ${p.type}`);
      });
      return ['effect', nomeEff, out];
    }
    throw new Error(`effetto non riconosciuto: '${testo}'`);
  }

  // controllo finale come genera_blocco_eventi + codice_evento (solo la parte che può dare errore)
  function controllaColonna(timecodes, colonna) {
    const parsati = colonna.map((v, i) => {
      try { return parsaCella(v); } catch (e) { throw new Error(`errore parsing timecode ${timecodes[i]}: ${e.message}`); }
    });
    parsati.forEach((p) => {
      if (p[0] !== 'effect' || ['TRANSIZIONE', 'HIT', 'SFUMATURA'].includes(p[1])) return;
      const d = EFFETTI[p[1]];
      const ordine = d.c_args_order;
      if (!ordine || !ordine.length) throw new Error(`manca 'c_args_order' nel registro per ${p[1]}`);
      const contesto = new Set(['t', 'inizio', 'fine'].concat(Object.keys(p[2])));
      ordine.forEach((tok) => { if (!contesto.has(tok)) throw new Error(`argomento '${tok}' richiesto da ${p[1]} non trovato nel contesto`); });
    });
  }

  // ───────────────────────── tabella .xlsx (= _xlsx_tabella di app.py) ─────────────────────────
  async function xlsxTabella(titolo, racchette, master, timecodes, sections, celle, telecomando) {
    const wb = new window.ExcelJS.Workbook();
    const ws = wb.addWorksheet(titolo.slice(0, 31).replace(/[\\/?*[\]:]/g, ' ') || 'SHOW');
    ws.getCell(1, 1).value = titolo;
    for (let i = 1; i <= racchette; i++) ws.getCell(2, i + 1).value = i === master ? `${i} master` : String(i);
    timecodes.forEach((tc, idx) => {
      ws.getCell(3 + idx, 1).value = tc;
      (celle ? celle[idx] : []).forEach((v, col) => { if (v) ws.getCell(3 + idx, col + 2).value = v; });
    });
    if (telecomando) {
      ws.getCell(2, racchette + 2).value = `${telecomando} master`;
      ws.getCell(3, racchette + 2).value = 'BUIO';
    }
    const lato = { style: 'thin', color: { argb: 'FF999999' } };
    const bordo = { left: lato, right: lato, top: lato, bottom: lato };
    for (let r = 2; r < 3 + timecodes.length; r++) for (let c = 1; c <= racchette + 1; c++) ws.getCell(r, c).border = bordo;
    (sections || []).forEach((sec) => {
      const start = parseInt(sec && sec.start_ms, 10), end = parseInt(sec && sec.end_ms, 10);
      if (isNaN(start) || isNaN(end)) return;
      const colore = String((sec && sec.color) || '').toUpperCase().replace(/^#/, '');
      if (!/^[0-9A-F]{6}$/.test(colore)) return;
      const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + colore }, bgColor: { argb: 'FF' + colore } };
      timecodes.forEach((tc, idx) => {
        if (start <= tc && tc <= end) for (let c = 1; c <= racchette + 1; c++) ws.getCell(3 + idx, c).fill = fill;
      });
    });
    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: TIPO_XLSX });
  }
  const nomeFileTitolo = (titolo) => titolo.replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().replace(/ /g, '_') + '.xlsx';
  const rispostaFile = (blob, nome) => new Response(blob, { status: 200, headers: {
    'Content-Type': blob.type || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${nome}"` } });

  async function esportaCoreografia(p) {
    if (!p || typeof p !== 'object') return errore('payload non valido (JSON dict richiesto)');
    const titolo = String(p.titolo || '').trim();
    const racchette = parseInt(p.racchette || 0, 10);
    let master = parseInt(p.master || 0, 10);
    const timecodes = (p.timecodes || []).map((x) => parseInt(x, 10));
    if (isNaN(racchette) || isNaN(master) || timecodes.some(isNaN)) return errore('racchette, master o timecode non validi');
    const righe = p.righe || [];
    const sections = Array.isArray(p.sections) ? p.sections : [];
    if (!titolo) return errore('titolo mancante');
    const telecomando = parseInt(p.telecomando || 0, 10) || 0;
    if (racchette < 1 || racchette > 99) return errore('racchette deve essere tra 1 e 99');
    if (telecomando) {
      if (!(racchette < telecomando && telecomando <= 99)) return errore(`il numero del telecomando deve essere piu' alto del numero di racchette (${racchette}) e al massimo 99`);
      master = 0;
    } else if (master < 1 || master > racchette) return errore(`master deve essere tra 1 e ${racchette}`);
    if (!timecodes.length) return errore("nessun marker da esportare oltre al punto 0 (da 0 al primo marker c'e' la fase di sincronizzazione)");
    if (timecodes.some((tc) => tc <= 0)) return errore('i timecode esportati devono essere maggiori di 0');
    for (let i = 1; i < timecodes.length; i++) if (timecodes[i] <= timecodes[i - 1]) return errore(`timecode non ordinati: ${timecodes[i - 1]} seguito da ${timecodes[i]}`);
    if (!Array.isArray(righe) || righe.length !== timecodes.length || righe.some((r) => !Array.isArray(r) || r.length !== racchette)) {
      return errore('griglia celle non coerente con marker e racchette');
    }
    const celle = righe.map((r) => r.map((v) => (v == null ? '' : String(v).trim())));
    const errori = [];
    for (let col = 0; col < racchette; col++) {
      if (!celle[0][col]) errori.push({ racchetta: col + 1, tc: timecodes[0], cella: '', msg: 'la prima riga deve avere un valore (es. BUIO)' });
    }
    const esito = {};
    celle.forEach((riga, i) => riga.forEach((v, col) => {
      if (!v) return;
      if (!(v in esito)) { try { parsaCella(v); esito[v] = null; } catch (e) { esito[v] = e.message; } }
      if (esito[v]) errori.push({ racchetta: col + 1, tc: timecodes[i], cella: v, msg: esito[v] });
    }));
    if (!errori.length) {
      for (let col = 0; col < racchette; col++) {
        const colonna = []; let ultimo = null;
        celle.forEach((riga) => { ultimo = riga[col] || ultimo; colonna.push(ultimo); });
        try { controllaColonna(timecodes, colonna); } catch (e) { errori.push({ racchetta: col + 1, tc: null, cella: '', msg: e.message }); }
      }
    }
    if (errori.length) {
      const e0 = errori[0];
      const dove = `racchetta ${e0.racchetta}` + (e0.tc != null ? `, marker ${e0.tc} ms` : '');
      return json({ error: `${dove}: ${e0.msg}`, errori: errori.slice(0, 200) }, 400);
    }
    const blob = await xlsxTabella(titolo, racchette, master, timecodes, sections, celle, telecomando);
    // come sul Mac: l'ultima tabella resta anche nel progetto (va nello zip "PER IL MAC")
    const nome = p.progetto ? nomeProgetto(p.progetto) : '';
    if (nome) {
      const el = await elencoProgetti();
      if (el[nome]) await DB.set('xlsx:' + nome, blob);
    }
    return rispostaFile(blob, nomeFileTitolo(titolo));
  }

  async function esportaDaAudio(p) {
    if (!p || typeof p !== 'object') return errore('payload non valido (JSON dict richiesto)');
    const titolo = String(p.titolo || '').trim();
    const racchette = parseInt(p.racchette || 0, 10) || 0;
    const master = parseInt(p.master || 0, 10) || 0;
    const beats = p.beats || [];
    if (!titolo) return errore('titolo mancante');
    if (racchette < 1) return errore('almeno 1 racchetta');
    if (master < 1 || master > racchette) return errore(`master deve essere tra 1 e ${racchette}`);
    if (!Array.isArray(beats) || !beats.length) return errore('nessun marker da esportare');
    const tcs = Array.from(new Set(beats.map((b) => parseInt(b, 10)))).filter((b) => b > 0).sort((a, b) => a - b);
    if (beats.some((b) => isNaN(parseInt(b, 10)))) return errore('marker non validi (devono essere numeri ms)');
    if (!tcs.length) return errore("nessun marker oltre al punto 0: inserisci almeno un marker per esportare (da 0 al primo marker sara' la fase di sincronizzazione)");
    const blob = await xlsxTabella(titolo, racchette, master, tcs, p.sections || [], null, 0);
    return rispostaFile(blob, nomeFileTitolo(titolo));
  }

  // ───────────────────────── musica (= audio_analyzer.estrai_waveform) ─────────────────────────
  const audioTemp = new Map();      // audio_id -> { blob, url }
  let ctxAnalisi = null;
  async function analizza(blob) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!ctxAnalisi) ctxAnalisi = new C();
    const dati = await blob.arrayBuffer();
    const buf = await new Promise((ok, ko) => ctxAnalisi.decodeAudioData(dati, ok, ko));
    const sr = buf.sampleRate, n = buf.length, ch = buf.numberOfChannels;
    const canali = [];
    for (let c = 0; c < ch; c++) canali.push(buf.getChannelData(c));
    const campione = (i) => { let s = 0; for (let c = 0; c < ch; c++) s += canali[c][i]; return Math.abs(s / ch); };
    // waveform: 5000 punti, media dei valori assoluti, normalizzata [0,1]
    const target = 5000;
    let onda = new Array(target).fill(0);
    if (n > 0 && n <= target) { for (let i = 0; i < n; i++) onda[i] = campione(i); }
    else if (n > target) {
      const w = Math.floor(n / target);
      for (let k = 0; k < target; k++) { let s = 0; const a = k * w; for (let i = a; i < a + w; i++) s += campione(i); onda[k] = s / w; }
    }
    let mx = Math.max.apply(null, onda);
    if (mx > 0) onda = onda.map((v) => v / mx);
    onda = onda.map((v) => Math.round(v * 10000) / 10000);
    // dettaglio per lo zoom: picco ogni 1/200 s
    const win = Math.max(1, Math.floor(sr / 200));
    const nd = Math.floor(n / win);
    let dett = new Array(nd);
    for (let k = 0; k < nd; k++) { let m = 0; const a = k * win; for (let i = a; i < a + win; i++) { const v = campione(i); if (v > m) m = v; } dett[k] = m; }
    mx = 0; for (let k = 0; k < nd; k++) if (dett[k] > mx) mx = dett[k];
    if (mx > 0) for (let k = 0; k < nd; k++) dett[k] = Math.round(dett[k] / mx * 1000) / 1000;
    return {
      durata_ms: Math.floor(n / sr * 1000),
      waveform: onda,
      waveform_ms: n > 5000 ? Math.floor(n / 5000) / sr * 1000 : 1000 / sr,
      dettaglio: dett,
      dettaglio_ms: Math.max(1, Math.floor(sr / 200)) / sr * 1000,
      beats: [0],
    };
  }
  function idCasuale() {
    const a = new Uint8Array(16); crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  function urlAudio(src) {
    const m = /^\/api\/audio\/([0-9a-f]{32})$/.exec(String(src || ''));
    return m && audioTemp.has(m[1]) ? audioTemp.get(m[1]).url : src;
  }
  // il lettore di riserva dell'editor usa new Audio("/api/audio/<id>"): lo giro sulla copia locale
  const AudioVero = window.Audio;
  window.Audio = function (src) { const a = new AudioVero(); if (src !== undefined) a.src = urlAudio(src); return a; };
  window.Audio.prototype = AudioVero.prototype;

  // ───────────────────────── progetti (= /api/progetti...) ─────────────────────────
  const ESTENSIONI_AUDIO = ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aif', '.aiff', '.aac'];
  function estensione(nomeFile) {
    const m = /\.[^.]+$/.exec(String(nomeFile || '').toLowerCase());
    return m && ESTENSIONI_AUDIO.includes(m[0]) ? m[0] : '.mp3';
  }
  const TIPO_AUDIO = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
    '.flac': 'audio/flac', '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.aac': 'audio/aac' };

  async function progettoValido(o) { return o && typeof o === 'object' && o.versione === 1 && Array.isArray(o.markers); }

  async function azioneProgetto(nome, p) {
    const el = await elencoProgetti();
    if (!el[nome]) return errore('progetto non trovato', 404);
    const cosa = p && p.cosa;
    if (cosa === 'rinomina' || cosa === 'duplica') {
      const nn = nomeProgetto(p.nuovo);
      if (!nn) return errore('nome non valido (usa lettere e numeri)');
      if (el[nn]) return errore(`esiste gia' un progetto chiamato "${nn}"`, 409);
      const voce = Object.assign({}, el[nome], { modificato: adessoSec() });
      try { const o = JSON.parse(voce.json); o.titolo = nn; voce.json = JSON.stringify(o); } catch (e) { /* lascia com'è */ }
      const audio = await DB.get('audio:' + nome), xlsx = await DB.get('xlsx:' + nome);
      if (audio) await DB.set('audio:' + nn, audio);
      if (xlsx) await DB.set('xlsx:' + nn, xlsx);
      el[nn] = voce;
      if (cosa === 'rinomina') { delete el[nome]; await DB.del('audio:' + nome); await DB.del('xlsx:' + nome); }
      await salvaElenco(el);
      return json({ ok: true, nome: nn });
    }
    if (cosa === 'elimina') {
      const cest = (await DB.get('cestino')) || {};
      const quando = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');
      cest[nome + ' ' + quando] = { voce: el[nome], audio: (await DB.get('audio:' + nome)) || null, xlsx: (await DB.get('xlsx:' + nome)) || null };
      // nel cestino del dispositivo restano solo gli ultimi 10 show eliminati
      const chiavi = Object.keys(cest).sort();
      while (chiavi.length > 10) delete cest[chiavi.shift()];
      await DB.set('cestino', cest);
      delete el[nome];
      await salvaElenco(el);
      await DB.del('audio:' + nome); await DB.del('xlsx:' + nome);
      return json({ ok: true });
    }
    if (cosa === 'cartella') {          // ⬇ PER IL MAC
      await esportaZip(nome);
      return json({ ok: true });
    }
    return errore('azione sconosciuta');
  }

  // ⬇ PER IL MAC: zip con la cartella dello show, identica a APP_LED/PROGETTI/<NOME>/
  async function esportaZip(nome) {
    const el = await elencoProgetti();
    const voce = el[nome];
    const zip = new window.JSZip();
    const cart = zip.folder(nome);
    cart.file('progetto.ledshow.json', voce.json);
    const audio = await DB.get('audio:' + nome);
    if (audio && voce.audioExt) cart.file('audio' + voce.audioExt, audio);
    const xlsx = await DB.get('xlsx:' + nome);
    if (xlsx) cart.file(nome + '.xlsx', xlsx);
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
    window.MiniApp.offriFile(blob, nome + '.zip', 'application/zip',
      `Show "${nome}" pronto per il Mac.`,
      'Sul Mac: salva lo zip, doppio clic su IMPORTA SHOW LED NEL MAC (cartella APP_IPAD), oppure aprilo e metti la cartella in APP_LED/PROGETTI.');
  }

  // ⬆ IMPORTA DAL MAC: zip con uno o più show (+ eventuale _libreria.json)
  function scegliZip() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.zip,application/zip,application/x-zip-compressed';
    inp.style.display = 'none';
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      if (f) await importaZip(f);
    });
    document.body.appendChild(inp);
    inp.click();
  }
  async function importaZip(file) {
    const t = window.toast || ((m) => alert(m));
    let zip;
    try { zip = await window.JSZip.loadAsync(file); } catch (e) { return t('Questo non è uno zip valido', 'err', 6000); }
    const voci = Object.keys(zip.files).filter((p) => !p.startsWith('__MACOSX/') && !zip.files[p].dir);
    const progetti = voci.filter((p) => /(^|\/)progetto\.ledshow\.json$/.test(p));
    const el = await elencoProgetti();
    const importati = [];
    for (const percorso of progetti) {
      const cartella = percorso.split('/').slice(0, -1);
      let testo;
      try { testo = await zip.file(percorso).async('string'); } catch (e) { continue; }
      let o;
      try { o = JSON.parse(testo); } catch (e) { continue; }
      if (!(await progettoValido(o))) continue;
      const nome = nomeProgetto(cartella[cartella.length - 1] || o.titolo || '');
      if (!nome) continue;
      if (el[nome] && !confirm(`Sul dispositivo c'è già uno show "${nome}".\nLo sostituisco con quello dello zip?`)) continue;
      const base = cartella.length ? cartella.join('/') + '/' : '';
      const fileAudio = voci.find((p) => p.startsWith(base) && /^audio\.[a-z0-9]+$/i.test(p.slice(base.length)));
      const fileXlsx = voci.find((p) => p === base + cartella[cartella.length - 1] + '.xlsx');
      let audioExt = null;
      await DB.del('audio:' + nome); await DB.del('xlsx:' + nome);
      if (fileAudio) {
        audioExt = estensione(fileAudio);
        const b = await zip.file(fileAudio).async('blob');
        await DB.set('audio:' + nome, new Blob([b], { type: TIPO_AUDIO[audioExt] || 'audio/mpeg' }));
      }
      if (fileXlsx) await DB.set('xlsx:' + nome, new Blob([await zip.file(fileXlsx).async('blob')], { type: TIPO_XLSX }));
      el[nome] = { json: testo, modificato: adessoSec(), audioExt: audioExt };
      importati.push(nome);
    }
    // libreria gruppi/formazioni: si UNISCE a quella del dispositivo (non cancella niente)
    const libPath = voci.find((p) => /(^|\/)_libreria\.json$/.test(p));
    let libAggiunte = 0;
    if (libPath) {
      try {
        const lz = JSON.parse(await zip.file(libPath).async('string'));
        const lib = (await DB.get('libreria')) || { gruppi: {}, formazioni: {} };
        ['gruppi', 'formazioni'].forEach((k) => Object.entries(lz[k] || {}).forEach(([n, v]) => {
          if (!(n in lib[k])) { lib[k][n] = v; libAggiunte++; }
        }));
        await DB.set('libreria', lib);
      } catch (e) { /* libreria rovinata: si ignora */ }
    }
    await salvaElenco(el);
    if (!importati.length && !libAggiunte) return t('Nello zip non ho trovato show da importare (serve la cartella con progetto.ledshow.json)', 'err', 8000);
    t((importati.length ? `Importati ${importati.length} show: ${importati.join(', ')}` : '') +
      (libAggiunte ? `${importati.length ? ' · ' : ''}${libAggiunte} gruppi/formazioni aggiunti alla libreria` : ''), 'ok', 8000);
    const apri = document.getElementById('co-open');
    if (apri) apri.click();       // ridisegna l'elenco dei tuoi show
  }

  // ───────────────────────── copie di emergenza (= /api/emergenza) ─────────────────────────
  async function salvaEmergenza(nomeGrezzo, testo) {
    let o;
    try { o = JSON.parse(testo); } catch (e) { return errore('progetto non valido'); }
    if (!(await progettoValido(o))) return errore('progetto non valido');
    const n = nomeProgetto(nomeGrezzo) || 'SENZA TITOLO';
    const em = (await DB.get('emergenza')) || {};
    const copie = em[n] || [];
    const ora = adessoSec();
    const ultima = copie[copie.length - 1];
    if (ultima && ora - ultima.nata < EMERGENZA_OGNI_S) { ultima.testo = testo; ultima.quando = ora; }
    else copie.push({ testo, nata: ora, quando: ora });
    while (copie.length > EMERGENZA_MAX) copie.shift();
    em[n] = copie;
    await DB.set('emergenza', em);
    return json({ ok: true });
  }
  async function ultimaEmergenza() {
    const em = (await DB.get('emergenza')) || {};
    let migliore = null;
    Object.entries(em).forEach(([n, copie]) => copie.forEach((c) => { if (!migliore || c.quando > migliore.quando) migliore = { n, c }; }));
    if (!migliore) return json({ progetto: null });
    try { return json({ progetto: JSON.parse(migliore.c.testo), nome: migliore.n, quando: migliore.c.quando }); } catch (e) { return json({ progetto: null }); }
  }

  // ───────────────────────── smistamento delle richieste ─────────────────────────
  async function servi(url, init) {
    const metodo = ((init && init.method) || 'GET').toUpperCase();
    const pathname = url.split('?')[0];
    const parti = pathname.split('/').filter(Boolean).map(decodeURIComponent);   // ["api", ...]

    if (pathname === '/api/registro') return json(registroPerUi());
    if (pathname === '/api/carica-audio' && metodo === 'POST') {
      const file = init.body && init.body.get && init.body.get('file');
      if (!file) return errore('nessun file caricato');
      if (file.size > MAX_AUDIO_BYTES) return errore('File troppo grande (max 50 MB)', 413);
      let info;
      try { info = await analizza(file); } catch (e) { return errore('Formato audio non supportato o file corrotto'); }
      const id = idCasuale();
      audioTemp.set(id, { blob: file, url: URL.createObjectURL(file) });
      return json(Object.assign({ audio_id: id, filename: file.name || 'audio.mp3' }, info));
    }
    if (parti[1] === 'audio' && parti.length === 3) {
      const a = audioTemp.get(parti[2]);
      return a ? new Response(a.blob, { status: 200, headers: { 'Content-Type': a.blob.type || 'audio/mpeg' } }) : errore('non trovato', 404);
    }
    if (pathname === '/api/pulisci-audio') {
      const p = await corpoJson(init);
      const a = p && audioTemp.get(p.audio_id);
      if (a) { URL.revokeObjectURL(a.url); audioTemp.delete(p.audio_id); }
      return json({ ok: true });
    }
    if (pathname === '/api/video-standard') return errore('sul dispositivo il video si scarica così com\'è', 501);
    if (pathname === '/api/esporta-xlsx-da-audio') return esportaDaAudio(await corpoJson(init));
    if (pathname === '/api/esporta-xlsx-coreografia') return esportaCoreografia(await corpoJson(init));
    if (pathname === '/api/valida-celle') {
      const p = await corpoJson(init);
      const celle = p && p.celle;
      if (!Array.isArray(celle) || celle.length > 5000) return errore("payload non valido (lista 'celle' richiesta)");
      const errori = {};
      new Set(celle.map(String)).forEach((c) => { try { parsaCella(c); } catch (e) { errori[c] = e.message; } });
      return json({ errori });
    }
    if (pathname === '/api/importa-tabella') {
      return errore("Sul telefono/iPad la tabella Excel non si importa: apri lo show come zip (APRI PROGETTO → ⬆ IMPORTA DAL MAC)");
    }
    if (pathname === '/api/libreria') {
      if (metodo === 'GET') {
        const lib = (await DB.get('libreria')) || {};
        return json({ gruppi: lib.gruppi || {}, formazioni: lib.formazioni || {} });
      }
      const p = await corpoJson(init);
      if (!p || typeof p.gruppi !== 'object' || typeof p.formazioni !== 'object') return errore('libreria non valida');
      await DB.set('libreria', { gruppi: p.gruppi, formazioni: p.formazioni });
      return json({ ok: true });
    }
    if (pathname === '/api/progetti-cartella') { scegliZip(); return json({ ok: true }); }
    if (pathname === '/api/progetti' && metodo === 'GET') {
      const el = await elencoProgetti();
      const out = Object.entries(el).map(([n, v]) => infoProgetto(n, v)).sort((a, b) => b.modificato - a.modificato);
      return json({ progetti: out, cartella: 'questo dispositivo (per portarli sul Mac: ⬇ PER IL MAC)' });
    }
    if (parti[0] === 'api' && parti[1] === 'progetti' && parti.length >= 3) {
      const nome = nomeProgetto(parti[2]);
      if (parti.length === 4 && parti[3] === 'azione') return azioneProgetto(nome, await corpoJson(init));
      if (parti.length === 4 && parti[3] === 'audio') {
        const el = await elencoProgetti();
        if (!nome || !el[nome]) return errore('progetto non trovato', 404);
        if (metodo === 'GET') {
          const b = await DB.get('audio:' + nome);
          return b ? new Response(b, { status: 200, headers: { 'Content-Type': b.type || 'audio/mpeg' } }) : errore('questo progetto non ha la musica salvata', 404);
        }
        const file = init.body && init.body.get && init.body.get('file');
        if (!file) return errore('nessun file');
        if (file.size > MAX_AUDIO_BYTES) return errore('File troppo grande (max 50 MB)', 413);
        const ext = estensione(file.name);
        await DB.set('audio:' + nome, new Blob([file], { type: file.type || TIPO_AUDIO[ext] }));
        el[nome].audioExt = ext;
        await salvaElenco(el);
        return json({ ok: true });
      }
      if (parti.length === 3 && metodo === 'GET') {
        const el = await elencoProgetti();
        if (!nome || !el[nome]) return errore('progetto non trovato', 404);
        try { return json(Object.assign({ progetto: JSON.parse(el[nome].json) }, infoProgetto(nome, el[nome]))); }
        catch (e) { return errore('file del progetto rovinato: guarda tra le copie automatiche', 500); }
      }
      if (parti.length === 3 && metodo === 'POST') {
        const testo = typeof init.body === 'string' ? init.body : await new Response(init.body).text();
        let o;
        try { o = JSON.parse(testo); } catch (e) { return errore('progetto non valido'); }
        if (!(await progettoValido(o))) return errore('progetto non valido');
        if (!nome) return errore('nome del progetto non valido (usa lettere e numeri)');
        const el = await elencoProgetti();
        el[nome] = Object.assign({}, el[nome] || {}, { json: JSON.stringify(o), modificato: adessoSec() });
        if (!('audioExt' in el[nome])) el[nome].audioExt = null;
        await salvaElenco(el);
        return json({ ok: true, nome: nome, cartella: 'questo dispositivo' });
      }
    }
    if (parti[0] === 'api' && parti[1] === 'emergenza') {
      if (parti.length === 3 && metodo === 'POST') {
        const testo = typeof init.body === 'string' ? init.body : await new Response(init.body).text();
        return salvaEmergenza(parti[2], testo);
      }
      if (parti.length === 2) return ultimaEmergenza();
    }
    if (pathname === '/api/ping' || pathname === '/api/shutdown') return json({ ok: true });
    return errore('funzione non disponibile su telefono/iPad', 404);
  }

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.startsWith('/api/')) {
      // ⬆ IMPORTA DAL MAC deve aprire la scelta del file DENTRO il tocco (regola dei browser)
      if (url === '/api/progetti-cartella') { scegliZip(); return Promise.resolve(json({ ok: true })); }
      return servi(url, init || {}).catch((e) => errore(e && e.message || String(e), 500));
    }
    return fetchVero(input, init);
  };
  const beaconVero = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
  navigator.sendBeacon = function (url, dati) {
    if (String(url).startsWith('/api/')) { servi(String(url), { method: 'POST', body: dati }).catch(() => {}); return true; }
    return beaconVero ? beaconVero(url, dati) : false;
  };

  // per le prove automatiche
  window.MiniLed = { parsaCella, nomeProgetto, importaZip, esportaZip, xlsxTabella, analizza };
})();
