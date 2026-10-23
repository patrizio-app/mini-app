/* Mini PPP Preventivi — app d'emergenza (iPad / Android / iPhone).
 * Compili i campi come su PPP del Mac → crei il PDF (stessa grafica) → lo mandi come vuoi.
 * Tutto resta sul dispositivo (IndexedDB). Al ritorno: "Esporta per il Mac" e, sul Mac,
 * doppio clic su "IMPORTA PREVENTIVI NEL MAC" → entrano in PPP nello stesso formato.
 */
(function () {
  'use strict';

  // ───────────────────────── utilità ─────────────────────────
  const $ = (s, r) => (r || document).querySelector(s);
  const LETTERE = 'ABCDEFGHIJKLMNOP';
  const MAX_OPZIONI = 15;
  const CFG = window.PPP_CONFIG;

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function isoOggi() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function adessoTesto() {
    const d = new Date();
    return isoOggi() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function nuovoId() { // come PPP: 10 caratteri esadecimali
    const a = new Uint8Array(5);
    window.crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  }
  function aFloat(s) { // come _to_float di PPP (accetta anche la virgola)
    if (s === '' || s == null) return 0;
    const n = parseFloat(String(s).replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  function copia(o) { return JSON.parse(JSON.stringify(o)); }
  function euro(n) { return '€ ' + window.PPP_PDF.euro0(n); }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  // ───────────────────────── archivio del dispositivo (IndexedDB) ─────────────────────────
  const DB = (function () {
    let dbp = null;
    function apri() {
      if (!dbp) {
        dbp = new Promise((res, rej) => {
          const r = indexedDB.open('ppp-preventivi', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      }
      return dbp;
    }
    async function get(k) {
      const db = await apri();
      return new Promise((res, rej) => {
        const q = db.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
    }
    async function set(k, v) {
      const db = await apri();
      return new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    }
    return { get, set };
  })();

  // ───────────────────────── stato ─────────────────────────
  const st = {
    mac: null,        // archivio dal Mac (facoltativo): {creato_il, preventivi, ultimi_numeri}
    miei: [],         // preventivi fatti su questo dispositivo (formato PPP)
    lavoro: null,     // {modo:'nuovo'|'modifica', id, doc}
    filtro: { q: '', origine: 'tutti' },
  };

  function archivioCompleto() {
    const mac = (st.mac && st.mac.preventivi || []).map(p => Object.assign({}, p, { _origine: 'mac' }));
    const qui = st.miei.map(p => Object.assign({}, p, { _origine: 'qui' }));
    return mac.concat(qui);
  }
  function trova(id) { return archivioCompleto().find(p => p.id === id) || null; }

  function numeroSuggerito(anno) { // come prossimo_numero_preventivo di PPP
    anno = String(anno || new Date().getFullYear());
    let max = 0;
    const leggi = (num) => {
      const m = /^(\d+)\/(\d{4})$/.exec(String(num || '').trim());
      if (m && m[2] === anno) max = Math.max(max, parseInt(m[1], 10));
    };
    archivioCompleto().forEach(p => leggi(p.numero));
    if (st.mac && st.mac.ultimi_numeri) leggi(st.mac.ultimi_numeri[anno]);
    return String(max + 1).padStart(3, '0') + '/' + anno;
  }

  function nuovaOpzione() { // come una nuova opzione in PPP (IVA spuntata di default)
    return {
      n_ballerini: '', durata: '', uscite: '', cachet: '', coord_n: 0, coord_cachet: '',
      extra_importo: 0, voci_extra: [],
      include_viaggio: false, include_pasti: false, include_alloggio: false,
      mostra_iva: true, consigliata: false,
    };
  }

  function nuovoDoc() {
    const anno = String(new Date().getFullYear());
    return {
      lingua: 'it', anno: anno, numero: numeroSuggerito(anno),
      cliente: '', nome_evento: '', data_emissione: isoOggi(), data_evento: '', luogo: '', showday: '',
      titolo_show: CFG.descrizioni_show.it.titolo,
      descrizione_show: CFG.descrizioni_show.it.testo,
      mostra_includiamo: true, mostra_extra: true, layout: 'cards',
      termini: {
        validita_giorni: CFG.termini.validita_giorni,
        acconto_percentuale: CFG.termini.acconto_percentuale,
        saldo_tempi: '',
      },
      opzioni: [],
      _cond: { viaggio: false, pasti: true, alloggio: false, iva: false, coord_n: 0, coord_cachet: '' },
    };
  }

  function docDaPreventivo(p) {
    const d = copia(p);
    delete d._origine;
    d.termini = d.termini || { validita_giorni: 30, acconto_percentuale: 30, saldo_tempi: '' };
    d._cond = d._cond || { viaggio: false, pasti: true, alloggio: false, iva: false, coord_n: 0, coord_cachet: '' };
    d.opzioni = (d.opzioni || []).map(o => Object.assign(nuovaOpzione(), o));
    return d;
  }

  let salvaLavoroTimer = null;
  function salvaLavoro() {
    clearTimeout(salvaLavoroTimer);
    salvaLavoroTimer = setTimeout(() => {
      DB.set('lavoro', st.lavoro).then(() => {
        const s = $('#stato-salv');
        if (s && st.lavoro && st.lavoro.modo === 'nuovo') s.textContent = 'Bozza salvata sul dispositivo';
      }).catch(() => {});
    }, 350);
  }

  // ───────────────────────── navigazione ─────────────────────────
  function vai(rotta) {
    if (location.hash === '#' + rotta) render();
    else location.hash = rotta;
  }
  window.addEventListener('hashchange', render);

  function rottaCorrente() {
    const h = (location.hash || '#preventivo').slice(1);
    const i = h.indexOf('/');
    const nome = i < 0 ? h : h.slice(0, i);
    const param = i < 0 ? '' : decodeURIComponent(h.slice(i + 1));
    return { nome: nome || 'preventivo', param: param };
  }

  function render() {
    const r = rottaCorrente();
    document.querySelectorAll('.tabs button').forEach(b => {
      const attivo = b.dataset.vai === r.nome || (r.nome === 'scheda' && b.dataset.vai === 'archivio');
      b.classList.toggle('attivo', attivo);
    });
    const v = $('#vista');
    if (r.nome === 'archivio') v.innerHTML = vistaArchivio();
    else if (r.nome === 'scheda') v.innerHTML = vistaScheda(r.param);
    else if (r.nome === 'dati') v.innerHTML = vistaDati();
    else v.innerHTML = vistaEditor();
    window.scrollTo(0, 0);
    if (r.nome === 'archivio') {
      const q = $('#cerca');
      if (q) q.addEventListener('input', () => { st.filtro.q = q.value; $('#lista-arch').innerHTML = listaArchivio(); });
    }
    if (r.nome === 'preventivo') controllaNumero();
  }

  // ───────────────────────── EDITOR (come il form di PPP) ─────────────────────────
  function vistaEditor() {
    if (!st.lavoro) {
      st.lavoro = { modo: 'nuovo', id: null, doc: nuovoDoc() };
      salvaLavoro();
    }
    const d = st.lavoro.doc;
    const modifica = st.lavoro.modo === 'modifica';
    const ultimoMac = st.mac && (st.mac.ultimi_numeri || {})[d.anno];
    const h = [];

    h.push('<div class="riga-btn" style="justify-content:space-between;margin-bottom:6px">' +
      '<h1>' + (modifica ? 'Modifica preventivo' : 'Nuovo preventivo') + '</h1>' +
      '<button class="btn btn-ghost btn-piccolo" data-azione="nuovo-vuoto">+ Nuovo vuoto</button></div>');

    h.push('<section class="card"><h2>Dati generali</h2><div class="griglia">' +
      sel('Lingua *', 'lingua', d.lingua, [['it', 'Italiano'], ['en', 'English']]) +
      txt('Anno *', 'anno', d.anno, 'inputmode="numeric" maxlength="4"') +
      '<label class="campo">Numero preventivo *<input type="text" data-f="numero" value="' + esc(d.numero) + '" placeholder="001/2026" inputmode="numeric">' +
      '<span class="sotto">' + (ultimoMac ? 'Ultimo sul Mac: <strong>' + esc(ultimoMac) + '</strong>' :
        (st.mac ? 'Nessun numero ' + esc(d.anno) + ' sul Mac' : 'Controlla tu che non sia già usato sul Mac')) + '</span>' +
      '<span id="avviso-numero"></span></label>' +
      '</div><div class="griglia due" style="margin-top:12px">' +
      txt('Cliente *', 'cliente', d.cliente, 'placeholder="es: ITA Basket — FIP" autocomplete="off"') +
      txt('Nome evento', 'nome_evento', d.nome_evento, 'placeholder="es: ITA Basket Final Eight 2026"') +
      '</div><div class="griglia" style="margin-top:12px">' +
      dat('Data emissione *', 'data_emissione', d.data_emissione) +
      dat('Data evento', 'data_evento', d.data_evento) +
      txt('Luogo', 'luogo', d.luogo, 'placeholder="es: Bologna"') +
      txt('Showday', 'showday', d.showday, 'placeholder="es: 1, 2, 3…"') +
      '</div></section>');

    h.push('<section class="card"><h2>Show</h2><div class="griglia due">' +
      '<label class="campo largo">Titolo show<input type="text" data-f="titolo_show" value="' + esc(d.titolo_show) + '"></label>' +
      '<label class="campo largo">Descrizione show<textarea data-f="descrizione_show" rows="4">' + esc(d.descrizione_show) + '</textarea></label>' +
      '</div><div class="riga-btn" style="margin-top:10px">' +
      '<button class="btn btn-piccolo" data-azione="reset-testi" data-lingua="it">Reset IT</button>' +
      '<button class="btn btn-piccolo" data-azione="reset-testi" data-lingua="en">Reset EN</button></div>' +
      '<h3 style="margin:16px 0 4px">Visibilità sezioni</h3><div class="spunte">' +
      chk('Mostra “Cosa includiamo”', 'mostra_includiamo', d.mostra_includiamo !== false) +
      chk('Mostra “Extra disponibili a richiesta”', 'mostra_extra', d.mostra_extra !== false) +
      '</div></section>');

    h.push('<section class="card"><h2>Opzioni del preventivo</h2><div class="griglia">' +
      sel('Modalità presentazione PDF', 'layout', d.layout, [['cards', 'Card opzioni (A, B, C… — max 4-5)'], ['tabella', 'Tabella prezzi / listino (molte righe)']]) +
      '</div><p class="sotto" style="margin-top:8px">Per ogni opzione: ballerini, durata, uscite, cachet, coordinator, costi aggiuntivi, ' +
      'viaggio/pasti/alloggio. Massimo 1 “Consigliata”. In modalità <strong>Tabella</strong> fino a 15 righe: più righe, più la tabella si comprime.</p>' +
      (d.layout === 'tabella' ? strumentiTabella(d) : '') + '</section>');

    h.push('<div id="opzioni">' + htmlOpzioni(d) + '</div>');
    h.push('<button class="btn btn-nero" data-azione="add-opz" style="width:100%;margin-bottom:14px"' +
      (d.opzioni.length >= MAX_OPZIONI ? ' disabled' : '') + '>+ Aggiungi opzione</button>');

    h.push('<section class="card"><h2>Termini di pagamento</h2><div class="griglia">' +
      txt('Validità (giorni)', 'termini.validita_giorni', d.termini.validita_giorni, 'inputmode="numeric"') +
      txt('Acconto (%)', 'termini.acconto_percentuale', d.termini.acconto_percentuale, 'inputmode="numeric"') +
      '<label class="campo largo">Saldo (testo)<input type="text" data-f="termini.saldo_tempi" value="' + esc(d.termini.saldo_tempi) +
      '" placeholder="lascia vuoto per default (' + esc(d.lingua === 'en' ? CFG.termini.saldo_tempi_en : CFG.termini.saldo_tempi_it) + ')"></label>' +
      '</div></section>');

    h.push('<div class="azioni-fisse"><span class="stato-salvataggio" id="stato-salv">' +
      (modifica ? 'Stai modificando ' + esc(d.numero) : 'Bozza salvata sul dispositivo') + '</span>' +
      '<button class="btn" data-azione="salva">Salva</button>' +
      '<button class="btn btn-primario" data-azione="salva-pdf">Salva e crea PDF</button></div>');
    return h.join('');
  }

  function strumentiTabella(d) {
    const k = d._cond;
    return '<div class="costi"><h3 style="margin-bottom:8px">Impostazioni condivise (tutte le righe)</h3>' +
      '<div class="spunte">' +
      chk('Viaggio incluso', '_cond.viaggio', k.viaggio) + chk('Pasti inclusi', '_cond.pasti', k.pasti) +
      chk('Alloggio incluso', '_cond.alloggio', k.alloggio) + chk('Mostra “+ IVA”', '_cond.iva', k.iva) +
      '</div><div class="griglia" style="margin-top:8px">' +
      txt('Coordinator (n.)', '_cond.coord_n', k.coord_n, 'inputmode="numeric"') +
      txt('Cachet coordinator (€/cad.)', '_cond.coord_cachet', k.coord_cachet, 'inputmode="decimal" placeholder="0"') +
      '</div><p class="sotto" style="margin-top:6px">Valgono per tutte le righe (anche quelle già inserite) e per le nuove.</p></div>';
  }

  function htmlOpzioni(d) {
    if (!d.opzioni.length) return '<div class="card vuoto">Nessuna opzione. Premi <strong>+ Aggiungi opzione</strong>.</div>';
    return d.opzioni.map((o, i) => htmlOpzione(o, i)).join('');
  }

  function htmlOpzione(o, i) {
    const tot = window.PPP_PDF.totaleOpzione(normOpzione(o));
    return '<div class="opzione' + (o.consigliata ? ' consigliata' : '') + '" data-opz="' + i + '">' +
      '<div class="opzione-testa"><div class="sx"><span class="lettera">' + LETTERE[i] + '</span>' +
      '<span class="totale-opz" id="tot-' + i + '">' + euro(tot) + '</span></div>' +
      '<div class="riga-btn"><label class="spunta"><input type="checkbox" data-o="' + i + '" data-f="consigliata"' +
      (o.consigliata ? ' checked' : '') + '> Consigliata</label>' +
      '<button class="btn btn-icona btn-ghost" aria-label="Elimina opzione ' + LETTERE[i] + '" data-azione="del-opz" data-i="' + i + '">×</button></div></div>' +
      '<div class="griglia">' +
      '<label class="campo">Ballerini<input type="text" data-o="' + i + '" data-f="n_ballerini" value="' + esc(o.n_ballerini) + '" placeholder="es: 12"></label>' +
      '<label class="campo">Durata<input type="text" list="lista-durate" data-o="' + i + '" data-f="durata" value="' + esc(o.durata) + '" placeholder="es: 5 min"></label>' +
      '<label class="campo">Uscite<input type="text" data-o="' + i + '" data-f="uscite" value="' + esc(o.uscite) + '" placeholder="es: 1 oppure 2 da 7/8\'"></label>' +
      '<label class="campo">Cachet base (€)<input type="text" inputmode="decimal" data-o="' + i + '" data-f="cachet" value="' + esc(o.cachet) + '" placeholder="es: 8500"></label>' +
      '<label class="campo">+ Coordinator (n.)<input type="text" inputmode="numeric" data-o="' + i + '" data-f="coord_n" value="' + esc(o.coord_n) + '" placeholder="0"></label>' +
      '<label class="campo">Cachet coordinator (€/cad.)<input type="text" inputmode="decimal" data-o="' + i + '" data-f="coord_cachet" value="' + esc(o.coord_cachet) + '" placeholder="es: 500"></label>' +
      '</div>' +
      '<div class="costi"><div class="costi-testa"><span>Costi aggiuntivi (viaggio, pasti, alloggio…)</span>' +
      '<button class="btn btn-piccolo" data-azione="add-voce" data-i="' + i + '">+ Costo</button></div>' +
      (o.voci_extra || []).map((v, j) =>
        '<div class="voce"><input type="text" data-o="' + i + '" data-v="' + j + '" data-f="titolo" value="' + esc(v.titolo) + '" placeholder="Titolo (es: Viaggio)" aria-label="Titolo costo">' +
        '<input class="voce-dett" type="text" data-o="' + i + '" data-v="' + j + '" data-f="dettagli" value="' + esc(v.dettagli) + '" placeholder="Dettagli (opzionali)" aria-label="Dettagli costo">' +
        '<input type="text" inputmode="decimal" data-o="' + i + '" data-v="' + j + '" data-f="costo" value="' + esc(v.costo) + '" placeholder="€" aria-label="Costo in euro">' +
        '<button class="btn btn-icona btn-ghost" aria-label="Elimina costo" data-azione="del-voce" data-i="' + i + '" data-j="' + j + '">×</button></div>'
      ).join('') + '</div>' +
      '<div class="spunte" style="margin-top:8px">' +
      chkO('Viaggio incluso', i, 'include_viaggio', o.include_viaggio) +
      chkO('Pasti inclusi', i, 'include_pasti', o.include_pasti) +
      chkO('Alloggio incluso', i, 'include_alloggio', o.include_alloggio) +
      chkO('Mostra “+ IVA”', i, 'mostra_iva', o.mostra_iva) +
      '</div></div>' +
      (i === 0 ? '<datalist id="lista-durate"><option value="5 min"><option value="10 min"><option value="15 min"><option value="30 min">' +
        '<option value="1 x 5/7 Min o 2 x 3/4 Min"></datalist>' : '');
  }

  function txt(lbl, f, v, extra) {
    return '<label class="campo">' + esc(lbl) + '<input type="text" data-f="' + f + '" value="' + esc(v) + '" ' + (extra || '') + '></label>';
  }
  function dat(lbl, f, v) {
    return '<label class="campo">' + esc(lbl) + '<input type="date" data-f="' + f + '" value="' + esc(v) + '"></label>';
  }
  function sel(lbl, f, v, opts) {
    return '<label class="campo">' + esc(lbl) + '<select data-f="' + f + '">' +
      opts.map(o => '<option value="' + esc(o[0]) + '"' + (String(v) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') +
      '</select></label>';
  }
  function chk(lbl, f, v) {
    return '<label class="spunta"><input type="checkbox" data-f="' + f + '"' + (v ? ' checked' : '') + '> ' + esc(lbl) + '</label>';
  }
  function chkO(lbl, i, f, v) {
    return '<label class="spunta"><input type="checkbox" data-o="' + i + '" data-f="' + f + '"' + (v ? ' checked' : '') + '> ' + esc(lbl) + '</label>';
  }
  function setPercorso(obj, percorso, val) {
    const p = percorso.split('.');
    let o = obj;
    for (let k = 0; k < p.length - 1; k++) { o[p[k]] = o[p[k]] || {}; o = o[p[k]]; }
    o[p[p.length - 1]] = val;
  }

  function aggiornaOpzioni() {
    const box = $('#opzioni');
    if (box) box.innerHTML = htmlOpzioni(st.lavoro.doc);
    const add = document.querySelector('[data-azione="add-opz"]');
    if (add) add.disabled = st.lavoro.doc.opzioni.length >= MAX_OPZIONI;
  }
  function aggiornaTotale(i) {
    const o = st.lavoro.doc.opzioni[i];
    const t = $('#tot-' + i);
    if (o && t) t.textContent = euro(window.PPP_PDF.totaleOpzione(normOpzione(o)));
  }
  function applicaCondivise(o) { // come applySharedToBlock di PPP
    const k = st.lavoro.doc._cond;
    o.include_viaggio = !!k.viaggio;
    o.include_pasti = !!k.pasti;
    o.include_alloggio = !!k.alloggio;
    o.mostra_iva = !!k.iva;
    o.coord_n = k.coord_n || 0;
    if (k.coord_cachet !== '' && k.coord_cachet != null) o.coord_cachet = k.coord_cachet;
  }

  function controllaNumero() {
    const box = $('#avviso-numero');
    if (!box || !st.lavoro) return;
    const num = String(st.lavoro.doc.numero || '').trim();
    if (!num) { box.innerHTML = ''; return; }
    if (!/^\d{1,3}\/\d{4}$/.test(num)) {
      box.innerHTML = '<div class="avviso">Formato: NNN/AAAA (es. 054/2026)</div>';
      return;
    }
    const usato = archivioCompleto().find(p => (p.numero || '') === num && p.id !== st.lavoro.id);
    if (usato) {
      box.innerHTML = '<div class="avviso">⚠ ' + esc(num) + ' è già usato ' + (usato._origine === 'mac' ? 'sul Mac' : 'qui') +
        ' (cliente: ' + esc(usato.cliente || '—') + '). ' +
        (usato._origine === 'mac' ? 'Cambialo.' : 'Salvando lo sovrascrivi.') + '</div>';
    } else box.innerHTML = '';
  }

  // ── normalizzazione e salvataggio: identici a _parse_preventivo_form di PPP ──
  function normOpzione(o) {
    return {
      n_ballerini: String(o.n_ballerini || '').trim().slice(0, 10),
      durata: String(o.durata || '').trim().slice(0, 50),
      uscite: String(o.uscite || '').trim().slice(0, 10),
      cachet: Math.max(0, aFloat(o.cachet)),
      coord_n: Math.max(0, Math.min(parseInt(o.coord_n, 10) || 0, 50)),
      coord_cachet: Math.max(0, aFloat(o.coord_cachet)),
      extra_importo: 0,
      voci_extra: (o.voci_extra || []).map(v => ({
        titolo: String(v.titolo || '').trim().slice(0, 100),
        dettagli: String(v.dettagli || '').trim().slice(0, 300),
        costo: Math.max(0, aFloat(v.costo)),
      })).filter(v => v.titolo || v.costo > 0).slice(0, 30),
      include_viaggio: !!o.include_viaggio,
      include_pasti: !!o.include_pasti,
      include_alloggio: !!o.include_alloggio,
      mostra_iva: !!o.mostra_iva,
      consigliata: !!o.consigliata,
    };
  }

  function docPulito(d) {
    const opz = d.opzioni.map(normOpzione).filter(o => o.n_ballerini || o.cachet);
    let vista = false;
    opz.forEach(o => { if (o.consigliata) { if (vista) o.consigliata = false; else vista = true; } });
    let anno = String(d.anno || '').trim();
    if (!/^\d+$/.test(anno) || +anno < 2000 || +anno > 2100) anno = String(CFG.anno_default);
    let val = parseInt(d.termini.validita_giorni, 10);
    if (isNaN(val)) val = CFG.termini.validita_giorni;
    let acc = parseInt(d.termini.acconto_percentuale, 10);
    if (isNaN(acc)) acc = CFG.termini.acconto_percentuale;
    return {
      lingua: d.lingua === 'en' ? 'en' : 'it',
      anno: anno,
      cliente: String(d.cliente || '').trim().slice(0, 200),
      nome_evento: String(d.nome_evento || '').trim().slice(0, 200),
      data_emissione: d.data_emissione || isoOggi(),
      data_evento: d.data_evento || '',
      luogo: String(d.luogo || '').trim().slice(0, 100),
      showday: String(d.showday || '').trim().slice(0, 50),
      titolo_show: String(d.titolo_show || '').trim().slice(0, 500),
      descrizione_show: String(d.descrizione_show || '').trim().slice(0, 5000),
      mostra_includiamo: d.mostra_includiamo !== false,
      mostra_extra: d.mostra_extra !== false,
      layout: d.layout === 'tabella' ? 'tabella' : 'cards',
      termini: {
        validita_giorni: val,
        acconto_percentuale: Math.max(0, Math.min(acc, 100)),
        saldo_tempi: String(d.termini.saldo_tempi || '').trim().slice(0, 200),
      },
      opzioni: opz,
      numero: String(d.numero || '').trim(),
    };
  }

  function valida(p) {
    if (!p.cliente) return 'Manca il cliente.';
    if (!/^\d{1,3}\/\d{4}$/.test(p.numero)) return 'Numero preventivo non valido (formato NNN/AAAA, es. 054/2026).';
    if (!p.opzioni.length) return 'Inserire almeno un’opzione con ballerini e cachet.';
    return null;
  }

  async function salva() {
    const L = st.lavoro;
    const p = docPulito(L.doc);
    const err = valida(p);
    if (err) { alert(err); return null; }

    const usato = archivioCompleto().find(x => (x.numero || '') === p.numero && x.id !== L.id);
    if (usato && usato._origine === 'mac') {
      if (!confirm('Il numero ' + p.numero + ' è già usato sul Mac (cliente: ' + (usato.cliente || '—') +
        ').\nMeglio usare un numero libero.\n\nSalvare comunque con questo numero?')) return null;
    } else if (usato) {
      if (!confirm('Stai per SOVRASCRIVERE il preventivo ' + p.numero + ' (cliente: ' + (usato.cliente || '—') + '). Confermi?')) return null;
      st.miei = st.miei.filter(x => x.id !== usato.id);
    }

    const ora = adessoTesto();
    if (L.modo === 'modifica' && L.id) {
      const vecchio = st.miei.find(x => x.id === L.id);
      p.id = L.id;
      p.stato = (vecchio && vecchio.stato) || 'emesso';
      p.creato_il = (vecchio && vecchio.creato_il) || ora;
      p.aggiornato_il = ora;
      st.miei = st.miei.filter(x => x.id !== L.id);
    } else {
      p.id = nuovoId();
      p.stato = 'emesso';
      p.creato_il = ora;
    }
    st.miei.push(p);
    await DB.set('miei', st.miei);
    st.lavoro = { modo: 'modifica', id: p.id, doc: docDaPreventivo(p) };
    st.lavoro.doc._cond = L.doc._cond;
    await DB.set('lavoro', st.lavoro);
    return p;
  }

  // ───────────────────────── ARCHIVIO ─────────────────────────
  function vistaArchivio() {
    const f = st.filtro;
    const chip = (v, l) => '<button class="chip' + (f.origine === v ? ' attivo' : '') + '" data-azione="filtro" data-origine="' + v + '">' + l + '</button>';
    return '<h1>Archivio preventivi</h1>' +
      '<div class="filtri"><input type="search" id="cerca" placeholder="Cerca cliente, evento, luogo, numero…" value="' + esc(f.q) + '">' +
      chip('tutti', 'Tutti') + chip('qui', 'Fatti qui') + (st.mac ? chip('mac', 'Dal Mac') : '') + '</div>' +
      '<div class="lista" id="lista-arch">' + listaArchivio() + '</div>';
  }

  function listaArchivio() {
    const q = st.filtro.q.trim().toLowerCase();
    let lista = archivioCompleto();
    if (st.filtro.origine !== 'tutti') lista = lista.filter(p => p._origine === st.filtro.origine);
    if (q) lista = lista.filter(p => ['cliente', 'nome_evento', 'luogo', 'numero'].some(k => String(p[k] || '').toLowerCase().includes(q)));
    lista.sort((a, b) => String(b.creato_il || '').localeCompare(String(a.creato_il || '')));
    if (!lista.length) {
      return '<div class="vuoto">' + (archivioCompleto().length ? 'Nessun preventivo trovato.' :
        'Ancora nessun preventivo. Quelli che salvi compaiono qui.') + '</div>';
    }
    return lista.map(p => {
      const tot = (p.opzioni || []).map(o => window.PPP_PDF.totaleOpzione(o)).filter(x => x > 0);
      const mn = Math.min.apply(null, tot), mx = Math.max.apply(null, tot);
      const range = tot.length ? (mn === mx ? euro(mn) : euro(mn) + ' – ' + euro(mx)) : '—';
      const meta = [p.nome_evento, p.luogo, p.data_evento ? window.PPP_PDF.formattaData(p.data_evento, 'it') : '']
        .filter(Boolean).map(esc).join(' · ');
      return '<button class="voce-arch" data-azione="apri-scheda" data-id="' + esc(p.id) + '">' +
        '<div class="r1"><span class="num">' + esc(p.numero || '—') + '</span>' +
        '<span class="badge ' + (p._origine === 'mac' ? 'mac' : 'ipad') + '">' + (p._origine === 'mac' ? 'Mac' : 'Fatto qui') + '</span></div>' +
        '<div class="cli">' + esc(p.cliente || '—') + '</div>' +
        '<div class="meta">' + (meta || '&nbsp;') + '</div>' +
        '<div class="meta">' + (p.opzioni || []).length + ' opzioni · ' + range + '</div></button>';
    }).join('');
  }

  function vistaScheda(id) {
    const p = trova(id);
    if (!p) return '<h1>Preventivo</h1><div class="card vuoto">Preventivo non trovato.</div>';
    const qui = p._origine === 'qui';
    const lang = p.lingua === 'en' ? 'en' : 'it';
    const righe = (p.opzioni || []).map((o, i) =>
      '<tr><td><strong>' + LETTERE[i] + '</strong>' + (o.consigliata ? ' ★' : '') + '</td><td>' + esc(o.n_ballerini || '—') +
      '</td><td>' + esc(o.durata || '—') + '</td><td>' + esc(o.uscite || '—') + '</td><td class="n">' +
      euro(window.PPP_PDF.totaleOpzione(o)) + (o.mostra_iva ? ' + IVA' : '') + '</td></tr>').join('');
    return '<div class="riga-btn" style="justify-content:space-between"><h1>' + esc(p.numero || 'Preventivo') + '</h1>' +
      '<span class="badge ' + (qui ? 'ipad' : 'mac') + '">' + (qui ? 'Fatto qui' : 'Dal Mac') + '</span></div>' +
      '<div class="card"><dl class="info">' +
      '<dt>Cliente</dt><dd>' + esc(p.cliente || '—') + '</dd>' +
      '<dt>Evento</dt><dd>' + esc(p.nome_evento || '—') + '</dd>' +
      '<dt>Luogo</dt><dd>' + esc(p.luogo || '—') + '</dd>' +
      '<dt>Data evento</dt><dd>' + esc(p.data_evento ? window.PPP_PDF.formattaData(p.data_evento, lang) : '—') + '</dd>' +
      '<dt>Emesso il</dt><dd>' + esc(p.data_emissione ? window.PPP_PDF.formattaData(p.data_emissione, lang) : '—') + '</dd>' +
      '<dt>Lingua</dt><dd>' + (lang === 'en' ? 'English' : 'Italiano') + '</dd>' +
      '</dl></div>' +
      '<div class="card"><h2>' + esc(p.titolo_show || 'Opzioni') + '</h2><div class="tab-scroll"><table class="tab"><thead><tr>' +
      '<th></th><th>Ballerini</th><th>Durata</th><th>Uscite</th><th style="text-align:right">Totale</th></tr></thead><tbody>' +
      (righe || '<tr><td colspan="5">Nessuna opzione</td></tr>') + '</tbody></table></div></div>' +
      '<div class="riga-btn">' +
      '<button class="btn btn-primario" data-azione="pdf-scheda" data-id="' + esc(p.id) + '">Crea PDF</button>' +
      '<button class="btn" data-azione="duplica" data-id="' + esc(p.id) + '">Duplica</button>' +
      (qui ? '<button class="btn" data-azione="modifica" data-id="' + esc(p.id) + '">Modifica</button>' +
        '<button class="btn btn-pericolo" data-azione="elimina" data-id="' + esc(p.id) + '">Elimina</button>' : '') +
      '<button class="btn btn-ghost" data-azione="vai" data-rotta="archivio">← Archivio</button></div>' +
      (qui ? '' : '<p class="sotto" style="margin-top:12px">I preventivi del Mac qui si consultano, si ristampano o si duplicano.</p>');
  }

  // ───────────────────────── DATI ─────────────────────────
  function vistaDati() {
    const h = ['<h1>Dati</h1>'];
    h.push('<section class="card"><h2>Rientro al Mac</h2>' +
      '<p>Preventivi fatti qui: <strong>' + st.miei.length + '</strong>. Sono salvati solo su questo dispositivo.</p>' +
      '<ol class="sotto" style="padding-left:20px;margin:10px 0">' +
      '<li>Tocca <strong>Esporta per il Mac</strong> e mandati il file (WhatsApp, email…).</li>' +
      '<li>Sul Mac salvalo, poi doppio clic su <strong>IMPORTA PREVENTIVI NEL MAC</strong> (cartella APPS → APP_IPAD).</li>' +
      '<li>I preventivi entrano in PPP nello stesso formato, con il loro PDF.</li></ol>' +
      '<div class="riga-btn"><button class="btn btn-primario" data-azione="esporta"' + (st.miei.length ? '' : ' disabled') + '>Esporta per il Mac</button>' +
      '<label class="btn" style="cursor:pointer">Reimporta un export<input type="file" accept=".json,application/json" data-file="backup" class="hidden"></label></div>' +
      '<p class="sotto" style="margin-top:10px">L’export vale anche come backup: “Reimporta” lo rimette su questo o su un altro dispositivo.</p></section>');

    h.push('<section class="card"><h2>Archivio dal Mac (facoltativo)</h2>');
    if (st.mac) {
      const un = st.mac.ultimi_numeri || {};
      h.push('<dl class="info"><dt>Aggiornato il</dt><dd>' + esc(st.mac.creato_il || '—') + '</dd>' +
        '<dt>Preventivi</dt><dd>' + (st.mac.preventivi || []).length + '</dd>' +
        Object.keys(un).sort().map(a => '<dt>Ultimo n. ' + esc(a) + '</dt><dd>' + esc(un[a]) + '</dd>').join('') + '</dl>');
    } else {
      h.push('<p>Serve solo per consultare/duplicare i vecchi preventivi e per conoscere l’ultimo numero usato sul Mac.</p>');
    }
    h.push('<ol class="sotto" style="padding-left:20px;margin:10px 0">' +
      '<li>Sul Mac: doppio clic su <strong>PREPARA PREVENTIVI PER IPAD</strong>.</li>' +
      '<li>Mandati il file <strong>ppp-dati-ipad.json</strong> (WhatsApp, email…) e salvalo sul dispositivo.</li>' +
      '<li>Qui: <strong>Carica archivio</strong>.</li></ol>' +
      '<label class="btn" style="cursor:pointer">' + (st.mac ? 'Aggiorna archivio' : 'Carica archivio') +
      '<input type="file" accept=".json,application/json" data-file="mac" class="hidden"></label></section>');

    h.push('<section class="card"><h2>Privacy</h2><p class="sotto">Tutto resta su questo dispositivo: la app non manda nulla a internet. ' +
      'I file li mandi tu, a chi vuoi.</p></section>');
    return h.join('');
  }

  async function caricaArchivioMac(file) {
    try {
      const j = JSON.parse(await file.text());
      if (j.tipo !== 'ppp-dati-ipad' || !Array.isArray(j.preventivi)) throw new Error('formato');
      st.mac = { creato_il: j.creato_il, preventivi: j.preventivi, ultimi_numeri: j.ultimi_numeri || {} };
      await DB.set('mac', st.mac);
      toast('Archivio caricato: ' + j.preventivi.length + ' preventivi dal Mac');
      render();
    } catch (e) {
      alert('Questo non è il file giusto.\nScegli “ppp-dati-ipad.json” creato sul Mac con “PREPARA PREVENTIVI PER IPAD”.');
    }
  }

  async function reimporta(file) {
    try {
      const j = JSON.parse(await file.text());
      if (j.tipo !== 'ppp-preventivi-da-importare' || !Array.isArray(j.preventivi)) throw new Error('formato');
      const ids = new Set(st.miei.map(p => p.id));
      let nuovi = 0;
      j.preventivi.forEach(p => { if (p && p.id && !ids.has(p.id)) { st.miei.push(p); nuovi++; } });
      await DB.set('miei', st.miei);
      toast(nuovi ? 'Reimportati ' + nuovi + ' preventivi' : 'Niente di nuovo da reimportare');
      render();
    } catch (e) {
      alert('File non valido: scegli un export fatto con “Esporta per il Mac”.');
    }
  }

  async function condividiFile(blob, nome, tipo) {
    const file = new File([blob], nome, { type: tipo });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: nome });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ───────────────────────── PDF ─────────────────────────
  let pdfPronto = null;
  function apriOverlay(titolo, html) {
    $('#overlay-titolo').textContent = titolo;
    $('#overlay-corpo').innerHTML = html;
    $('#overlay').classList.remove('hidden');
  }
  function chiudiOverlay() {
    $('#overlay').classList.add('hidden');
    $('#overlay-corpo').innerHTML = '';
    pdfPronto = null;
  }
  async function mostraPdf(p) {
    apriOverlay('PDF ' + (p.numero || ''), '<div class="caricamento"><div class="spinner"></div>Creo il PDF…</div>');
    try {
      const pulito = Object.assign({}, p);
      delete pulito._origine;
      pdfPronto = await window.PPP_PDF.creaPdf(pulito, CFG);
      $('#overlay-corpo').innerHTML =
        '<img class="anteprima" alt="Anteprima del PDF" src="' + pdfPronto.anteprima + '">' +
        '<p class="sotto">' + esc(pdfPronto.nome) + '</p>' +
        '<div class="riga-btn"><button class="btn btn-primario" data-azione="condividi-pdf">Salva / Condividi PDF</button></div>' +
        '<p class="sotto" style="margin-top:10px">Puoi salvarlo nel dispositivo o mandarlo subito su WhatsApp, email…</p>';
    } catch (e) {
      $('#overlay-corpo').innerHTML = '<p class="errore">Non sono riuscito a creare il PDF: ' + esc(e && e.message || e) + '</p>';
    }
  }

  // ───────────────────────── eventi ─────────────────────────
  document.addEventListener('click', async (ev) => {
    const tab = ev.target.closest('.tabs button');
    if (tab) { vai(tab.dataset.vai); return; }
    const b = ev.target.closest('[data-azione]');
    if (!b) return;
    const a = b.dataset.azione;
    const L = st.lavoro;
    const i = b.dataset.i != null ? parseInt(b.dataset.i, 10) : null;

    if (a === 'vai') { vai(b.dataset.rotta); return; }
    if (a === 'add-opz') {
      const o = nuovaOpzione();
      if (L.doc.layout === 'tabella') applicaCondivise(o);
      L.doc.opzioni.push(o);
      aggiornaOpzioni(); salvaLavoro();
      const ultimo = document.querySelector('[data-opz="' + (L.doc.opzioni.length - 1) + '"]');
      if (ultimo) ultimo.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (a === 'del-opz') {
      if (!confirm('Eliminare l’opzione ' + LETTERE[i] + '?')) return;
      L.doc.opzioni.splice(i, 1); aggiornaOpzioni(); salvaLavoro(); return;
    }
    if (a === 'add-voce') { L.doc.opzioni[i].voci_extra.push({ titolo: '', dettagli: '', costo: '' }); aggiornaOpzioni(); salvaLavoro(); return; }
    if (a === 'del-voce') { L.doc.opzioni[i].voci_extra.splice(parseInt(b.dataset.j, 10), 1); aggiornaOpzioni(); salvaLavoro(); return; }
    if (a === 'reset-testi') {
      const t = CFG.descrizioni_show[b.dataset.lingua];
      L.doc.titolo_show = t.titolo; L.doc.descrizione_show = t.testo;
      $('[data-f="titolo_show"]').value = t.titolo;
      $('[data-f="descrizione_show"]').value = t.testo;
      salvaLavoro(); return;
    }
    if (a === 'nuovo-vuoto') {
      const d = L && L.doc;
      if (d && (d.cliente || d.opzioni.length) && !confirm('Iniziare un preventivo nuovo?\n' +
        (L.modo === 'modifica' ? 'Le modifiche NON salvate andranno perse.' : 'La bozza attuale verrà cancellata.'))) return;
      st.lavoro = { modo: 'nuovo', id: null, doc: nuovoDoc() };
      await DB.set('lavoro', st.lavoro);
      render(); return;
    }
    if (a === 'salva') { const p = await salva(); if (p) { toast('Salvato ' + p.numero); render(); } return; }
    if (a === 'salva-pdf') { const p = await salva(); if (p) { render(); mostraPdf(p); } return; }
    if (a === 'condividi-pdf') { if (pdfPronto) await condividiFile(pdfPronto.blob, pdfPronto.nome, 'application/pdf'); return; }
    if (a === 'filtro') {
      st.filtro.origine = b.dataset.origine;
      document.querySelectorAll('.chip').forEach(c => c.classList.toggle('attivo', c.dataset.origine === st.filtro.origine));
      $('#lista-arch').innerHTML = listaArchivio();
      return;
    }
    if (a === 'apri-scheda') { vai('scheda/' + encodeURIComponent(b.dataset.id)); return; }
    if (a === 'pdf-scheda') { const p = trova(b.dataset.id); if (p) mostraPdf(p); return; }
    if (a === 'duplica' || a === 'modifica') {
      const p = trova(b.dataset.id);
      if (!p) return;
      const d0 = L && L.doc;
      if (d0 && (d0.cliente || d0.opzioni.length) && !(L.modo === 'modifica' && L.id === p.id) &&
        !confirm('Sostituire il preventivo che stai scrivendo?\n' +
          (L.modo === 'modifica' ? 'Le modifiche non salvate andranno perse.' : 'La bozza attuale verrà cancellata.'))) return;
      const doc = docDaPreventivo(p);
      if (a === 'duplica') { // come "Duplica" di PPP: svuota cliente, evento, luogo, data evento
        doc.anno = String(new Date().getFullYear());
        doc.numero = numeroSuggerito(doc.anno);
        doc.cliente = ''; doc.nome_evento = ''; doc.luogo = ''; doc.data_evento = '';
        doc.data_emissione = isoOggi();
        ['id', 'stato', 'creato_il', 'aggiornato_il', 'pdf_file'].forEach(k => { delete doc[k]; });
        st.lavoro = { modo: 'nuovo', id: null, doc: doc };
      } else {
        st.lavoro = { modo: 'modifica', id: p.id, doc: doc };
      }
      await DB.set('lavoro', st.lavoro);
      vai('preventivo');
      return;
    }
    if (a === 'elimina') {
      const p = trova(b.dataset.id);
      if (!p || !confirm('Eliminare il preventivo ' + (p.numero || '') + ' (' + (p.cliente || '—') + ')?\nNon si può annullare.')) return;
      st.miei = st.miei.filter(x => x.id !== p.id);
      await DB.set('miei', st.miei);
      if (st.lavoro && st.lavoro.id === p.id) { st.lavoro = null; await DB.set('lavoro', null); }
      toast('Eliminato'); vai('archivio'); return;
    }
    if (a === 'esporta') {
      const dati = { tipo: 'ppp-preventivi-da-importare', versione: 1, creato_il: adessoTesto(), preventivi: st.miei };
      const blob = new Blob([JSON.stringify(dati, null, 1)], { type: 'application/json' });
      await condividiFile(blob, 'preventivi-da-importare-' + isoOggi() + '.json', 'application/json');
      return;
    }
  });

  $('#overlay-chiudi').addEventListener('click', chiudiOverlay);
  $('#overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') chiudiOverlay(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') chiudiOverlay(); });

  function suModifica(ev) {
    const el = ev.target;
    if (el.dataset.file) {
      if (ev.type !== 'change') return;
      const f = el.files && el.files[0];
      if (f) (el.dataset.file === 'mac' ? caricaArchivioMac(f) : reimporta(f));
      el.value = '';
      return;
    }
    if (!st.lavoro) return;
    const d = st.lavoro.doc;
    const val = el.type === 'checkbox' ? el.checked : el.value;
    const f = el.dataset.f;
    if (!f) return;

    if (el.dataset.o != null) {
      const i = parseInt(el.dataset.o, 10);
      const o = d.opzioni[i];
      if (!o) return;
      if (el.dataset.v != null) o.voci_extra[parseInt(el.dataset.v, 10)][f] = val;
      else {
        o[f] = val;
        if (f === 'consigliata') {
          if (val) d.opzioni.forEach((x, k) => { if (k !== i) x.consigliata = false; });
          aggiornaOpzioni();
        }
      }
      aggiornaTotale(i);
      salvaLavoro();
      return;
    }

    setPercorso(d, f, val);
    if (f === 'numero') controllaNumero();
    if (f === 'anno' && st.lavoro.modo === 'nuovo' && /^\d{4}$/.test(val) && ev.type === 'change') {
      d.numero = numeroSuggerito(val);
      const n = $('[data-f="numero"]'); if (n) n.value = d.numero;
      controllaNumero();
    }
    if (f === 'lingua') { // come PPP: se il testo è ancora quello standard dell'altra lingua, lo traduce
      const nuovi = CFG.descrizioni_show[val === 'en' ? 'en' : 'it'];
      const altri = CFG.descrizioni_show[val === 'en' ? 'it' : 'en'];
      if (String(d.titolo_show).trim() === altri.titolo.trim()) d.titolo_show = nuovi.titolo;
      if (String(d.descrizione_show).trim() === altri.testo.trim()) d.descrizione_show = nuovi.testo;
      render();
    }
    if (f === 'layout') render();
    if (f.indexOf('_cond.') === 0) { // come autoApplyShared di PPP
      d.opzioni.forEach(applicaCondivise);
      if (ev.type === 'change') aggiornaOpzioni();
    }
    salvaLavoro();
  }
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.type === 'checkbox' || el.tagName === 'SELECT' || el.dataset.file) return; // gestiti da "change"
    suModifica(ev);
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'date' || el.dataset.file || el.dataset.f === 'anno' ||
      (el.dataset.f || '').indexOf('_cond.') === 0) suModifica(ev);
  });

  // ───────────────────────── avvio ─────────────────────────
  async function avvio() {
    try {
      st.mac = (await DB.get('mac')) || null;
      st.miei = (await DB.get('miei')) || [];
      st.lavoro = (await DB.get('lavoro')) || null;
    } catch (e) {
      $('#vista').innerHTML = '<div class="card errore">Impossibile aprire l’archivio del dispositivo. ' +
        'Se sei in navigazione privata, aprila in una finestra normale.</div>';
      return;
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if (!location.hash) location.replace('#preventivo');
    render();
    const sicuro = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if ('serviceWorker' in navigator && sicuro) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  avvio();
})();
