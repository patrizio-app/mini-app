/* Mini app CONTRATTI (telefono / iPad): stessi moduli e stessi documenti dell'app del Mac.
 * I dati restano SOLO sul dispositivo (IndexedDB). Dal Mac arrivano con un file
 * (PREPARA CONTRATTI PER IPAD), al Mac tornano con "Esporta per il Mac" (IMPORTA CONTRATTI NEL MAC). */
(function () {
  'use strict';
  const L = window.LOGICA;
  const PDF = window.CONTRATTI_PDF;
  L.usaTesti(window.TESTI_CONTRATTO);

  // ───────────────────────── utilità
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const copia = o => JSON.parse(JSON.stringify(o));
  const num = L.num, euro = v => L.euro(v, 'it');
  const ora = () => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };
  const nuovoId = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), b => b.toString(16).padStart(2, '0')).join('');
  let tToast = null;
  function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.remove('nascosto'); clearTimeout(tToast); tToast = setTimeout(() => e.classList.add('nascosto'), 2800); }
  function prendi(o, k) { return k.split('.').reduce((x, p) => (x == null ? undefined : x[p]), o); }
  function metti(o, k, v) { const ps = k.split('.'); let x = o; ps.slice(0, -1).forEach(p => { if (typeof x[p] !== 'object' || x[p] === null) x[p] = {}; x = x[p]; }); x[ps[ps.length - 1]] = v; }
  function caricaCampi(obj, box) { $$('[data-k]', box).forEach(el => { const v = prendi(obj, el.dataset.k); if (el.type === 'checkbox') el.checked = !!v; else el.value = v == null ? '' : v; }); }
  function leggiCampi(obj, box) { $$('[data-k]', box).forEach(el => metti(obj, el.dataset.k, el.type === 'checkbox' ? el.checked : el.value.trim())); return obj; }
  function nomeFile(s) { return (String(s || '').replace(/[^\w\- ]/g, '').trim().replace(/\s+/g, '_').slice(0, 40)) || 'cliente'; }

  // ───────────────────────── archivio del dispositivo
  const DB = (function () {
    let p = null;
    const apri = () => p || (p = new Promise((ok, ko) => { const r = indexedDB.open('contratti-mini', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); }));
    return {
      async get(k) { const db = await apri(); return new Promise((ok, ko) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ko(q.error); }); },
      async set(k, v) { const db = await apri(); return new Promise((ok, ko) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => ok(); t.onerror = () => ko(t.error); }); },
    };
  })();
  const st = { imp: null, pratiche: [], fatture: [], clienti: [], ppp: [], numeri_ppp: [], mac: null };
  function unisci(base, sopra) {
    const out = copia(base);
    Object.entries(sopra || {}).forEach(([k, v]) => { out[k] = (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') ? unisci(out[k], v) : v; });
    return out;
  }
  async function carica() {
    st.imp = unisci(window.BASE_IMPOSTAZIONI, await DB.get('imp'));
    st.pratiche = (await DB.get('pratiche')) || [];
    st.fatture = (await DB.get('fatture')) || [];
    st.clienti = (await DB.get('clienti')) || [];
    st.ppp = (await DB.get('ppp')) || [];
    st.numeri_ppp = (await DB.get('numeri_ppp')) || [];
    st.mac = (await DB.get('mac')) || null;
  }
  const salvaTutto = () => Promise.all(['imp', 'pratiche', 'fatture', 'clienti', 'ppp', 'numeri_ppp', 'mac'].map(k => DB.set(k, st[k])));
  const datiPronti = () => Object.values(st.imp.emittenti).some(E => E.piva && E.iban);

  // ognuno (ASD / Patrizio) ha la sua numerazione; niente in comune con PPP
  function prossimoNumero(anno, emittente) {
    emittente = emittente || 'patrizio';
    return L.prossimoNumero(anno, st.pratiche.filter(p => p.emittente === emittente).map(p => p.numero), st.imp.emittenti[emittente]);
  }
  function ricordaCliente(c) {
    const nome = String(c.ragione_sociale || '').trim(); if (!nome) return;
    const nuovo = {}; L.CAMPI_CLIENTE.forEach(k => { nuovo[k] = c[k] || ''; }); nuovo._qui = true;
    const i = st.clienti.findIndex(x => String(x.ragione_sociale || '').trim().toLowerCase() === nome.toLowerCase());
    if (i >= 0) st.clienti[i] = nuovo; else st.clienti.push(nuovo);
    st.clienti.sort((a, b) => a.ragione_sociale.toLowerCase().localeCompare(b.ragione_sociale.toLowerCase()));
  }

  // ───────────────────────── file: condividi / salva
  async function offri(blob, nome, tipo) {
    const file = new File([blob], nome, { type: tipo });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: nome }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  }
  let pronto = null;
  function apriOverlay(t, h) { $('#overlay-titolo').textContent = t; $('#overlay-corpo').innerHTML = h; $('#overlay').classList.remove('nascosto'); }
  function chiudiOverlay() { $('#overlay').classList.add('nascosto'); $('#overlay-corpo').innerHTML = ''; pronto = null; }
  $('#overlay-chiudi').onclick = chiudiOverlay;
  function finestraFile(titolo, blob, nome, tipo, anteprima, nota) {
    pronto = { blob, nome, tipo };
    apriOverlay(titolo, (anteprima ? '<img class="anteprima" alt="Anteprima" src="' + anteprima + '">' : '') +
      '<p class="sotto">' + esc(nome) + '</p><button class="btn nero" id="ov-condividi" type="button">Salva / Condividi</button>' +
      (nota ? '<p class="sotto">' + nota + '</p>' : ''));
    $('#ov-condividi').onclick = () => pronto && offri(pronto.blob, pronto.nome, pronto.tipo);
  }
  async function mostraPdf(tipo, p) {
    const NOMI = { preventivo: ['Preventivo', 'Quotation'], contratto: ['Contratto', 'Agreement'] };
    apriOverlay(NOMI[tipo][0] + ' ' + (p.numero || ''), '<div class="caricamento"><div class="spinner"></div>Creo il PDF…</div>');
    try {
      const r = await PDF.creaPdf(tipo, PDF.contesto(p, st.imp));
      const Lg = (p.lingua || 'it').toUpperCase();
      const nome = `${NOMI[tipo][Lg === 'IT' ? 0 : 1]}_${String(p.numero || '000').replace('/', '-')}_${nomeFile(p.cliente.ragione_sociale)}_${Lg}.pdf`;
      finestraFile(NOMI[tipo][0] + ' ' + p.numero, r.blob, nome, 'application/pdf', r.anteprima,
        r.pagine > 1 ? r.pagine + ' pagine' : 'Mandalo al cliente via WhatsApp o email.');
    } catch (e) { $('#overlay-corpo').innerHTML = '<p class="err">PDF non creato: ' + esc(e && e.message || e) + '</p>'; }
  }

  // ───────────────────────── viste
  const V = $('#vista');
  function vai(h) { if (location.hash === h) mostra(); else location.hash = h; }
  window.addEventListener('hashchange', mostra);
  function mostra() {
    const [rotta, id] = (location.hash.slice(1) || 'elenco').split('/');
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    $$('header nav a').forEach(a => a.classList.toggle('on', a.dataset.tab === ({ pratica: 'elenco', fattura: 'fatture' }[rotta] || rotta)));
    window.scrollTo(0, 0);
    V.oninput = null; V.onchange = null; chiudiOverlay();
    if (!datiPronti() && rotta !== 'dati') return vistaBenvenuto();
    if (rotta === 'pratica') return vistaPratica((id || '').split('?')[0], q);
    if (rotta === 'fatture') return vistaFatture();
    if (rotta === 'fattura') return vistaFattura((id || '').split('?')[0], q);
    if (rotta === 'dati') return vistaDati();
    return vistaElenco();
  }

  function vistaBenvenuto() {
    V.innerHTML = `<h1>Contratti</h1>
      <div class="card"><h2>Prima di iniziare</h2>
      <p>Servono i dati di chi emette (ASD e P.IVA: indirizzi, IBAN…). Per sicurezza <b>non sono nella app</b>: li porti dal Mac.</p>
      <ol><li>Sul Mac: cartella <b>APP_IPAD</b> → doppio clic su <b>PREPARA CONTRATTI PER IPAD</b>.</li>
      <li>Manda a te stesso il file <b>contratti-dati-ipad.json</b> (WhatsApp, email…).</li>
      <li>Qui: <b>Dati → Carica dati dal Mac</b>.</li></ol>
      <a class="btn nero" href="#dati">Vai a Dati</a></div>`;
  }

  // ---------- elenco preventivi e contratti
  const STATI = { bozza: 'Bozza', inviato: 'Inviato', firmato: 'Firmato', annullato: 'Annullato' };
  function vistaElenco() {
    const righe = st.pratiche.slice().sort((a, b) => String(b.creato_il || '').localeCompare(String(a.creato_il || '')));
    V.innerHTML = `<div class="testa-pagina"><h1>Preventivi e contratti</h1><a class="btn nero" href="#pratica/nuova">＋ Nuovo</a></div>
      <div class="schede">${righe.length ? righe.map(p => {
        const E = st.imp.emittenti[p.emittente] || {};
        const K = L.conti(p, E);
        const d = ((p.giorni || []).find(g => g.data) || {}).data;
        return `<div class="scheda"><div class="su"><div><b>${esc(p.numero)}</b> · <b>${esc(p.cliente.ragione_sociale || '—')}</b>
          <div class="sub">${esc(p.evento.nome || '')}${d ? ' · ' + L.dataBreve(d) : ''} · ${euro(K.totale)} ${p._qui ? '· <b>fatto qui</b>' : ''}</div></div>
          <span class="chip ${esc(p.emittente)}">${p.emittente === 'asd' ? 'ASD' : 'Patrizio'}</span></div>
          <div class="az"><button class="btn piccolo" data-pdf="preventivo" data-id="${p.id}">Preventivo</button>
          <button class="btn piccolo" data-pdf="contratto" data-id="${p.id}">Contratto</button>
          <a class="btn piccolo" href="#fattura/nuova?pratica=${p.id}&quota=${num(p.acconto_perc) > 0 ? 'acconto' : 'totale'}">Fattura</a>
          <a class="btn piccolo leggero" href="#pratica/${p.id}">Modifica</a>
          <button class="btn piccolo leggero" data-duplica="${p.id}">Duplica</button>
          <select class="stato" data-stato="${p.id}">${Object.entries(STATI).map(([k, v]) => `<option value="${k}"${p.stato === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
          <button class="btn piccolo leggero" data-elimina="${p.id}">Elimina</button></div></div>`;
      }).join('') : '<div class="vuoto">Nessun preventivo o contratto: usa ＋ Nuovo.</div>'}</div>`;
    $$('[data-pdf]', V).forEach(b => b.onclick = () => mostraPdf(b.dataset.pdf, st.pratiche.find(p => p.id === b.dataset.id)));
    $$('[data-duplica]', V).forEach(b => b.onclick = () => vai('#pratica/nuova?da=' + b.dataset.duplica));
    $$('[data-stato]', V).forEach(s => s.onchange = async () => { const p = st.pratiche.find(x => x.id === s.dataset.stato); p.stato = s.value; p._qui = true; p.aggiornato_il = ora(); await salvaTutto(); toast('Stato aggiornato'); });
    $$('[data-elimina]', V).forEach(b => b.onclick = async () => {
      const p = st.pratiche.find(x => x.id === b.dataset.elimina);
      if (!confirm('Eliminare ' + p.numero + ' ' + (p.cliente.ragione_sociale || '') + ' da questo dispositivo?')) return;
      st.pratiche = st.pratiche.filter(x => x !== p); await salvaTutto(); vistaElenco();
    });
  }

  // ---------- modulo preventivo + contratto
  const opzNazioni = () => L.NAZIONI.map(([c, it]) => `<option value="${c}">${esc(it)}</option>`).join('');
  const opzRegimi = () => Object.entries(L.REGIMI_IVA).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  const opzClienti = () => st.clienti.length ? `<label>Scegli dalla rubrica<select id="rubrica"><option value="">— nuovo cliente —</option>${st.clienti.map((c, i) => `<option value="${i}">${esc(c.ragione_sociale)}</option>`).join('')}</select></label>` : '';
  const sceltaEmittenti = (testoSotto) => `<div class="scelta">${Object.entries(st.imp.emittenti).map(([k, E]) =>
    `<label><input type="radio" name="emittente" value="${k}"><b>${esc(E.etichetta)}</b><span>${esc(testoSotto(E))}</span></label>`).join('')}</div>`;
  function campiCliente(conReferente) {
    return `<div class="riga"><label class="x2">Ragione sociale / nome *<input data-k="cliente.ragione_sociale"></label>
      <label>Tipo<select data-k="cliente.categoria"><option value="azienda">Azienda / ente / agenzia</option><option value="privato">Privato (persona)</option></select></label>
      <label>Nazione<select data-k="cliente.nazione">${opzNazioni()}</select></label></div>
      <div class="riga"><label class="x2">Indirizzo<input data-k="cliente.indirizzo"></label><label class="stretto">N. civico<input data-k="cliente.civico"></label>
      <label class="stretto">CAP<input data-k="cliente.cap" inputmode="numeric"></label><label>Città<input data-k="cliente.comune"></label>
      <label class="stretto solo-it">Provincia<input data-k="cliente.provincia" maxlength="2"></label></div>
      <div class="riga"><label>P.IVA / VAT number<input data-k="cliente.piva"></label><label class="solo-it">Codice fiscale<input data-k="cliente.cf"></label>
      <label class="solo-it stretto">Codice SDI<input data-k="cliente.sdi" maxlength="7"></label><label class="solo-it">PEC<input data-k="cliente.pec" type="email"></label></div>
      <div class="riga">${conReferente ? '<label>Referente (chi firma)<input data-k="cliente.referente"></label><label>Ruolo<input data-k="cliente.ruolo_referente"></label>' : ''}
      <label>Email<input data-k="cliente.email" type="email"></label>${conReferente ? '<label>Telefono<input data-k="cliente.telefono" type="tel"></label>' : ''}</div>`;
  }

  function righe(box, campi, vuota) {
    function aggiungi(r) {
      const d = document.createElement('div'); d.className = 'r';
      campi.forEach(c => { const i = document.createElement('input'); i.type = c.tipo || 'text'; i.placeholder = c.ph || ''; i.dataset.c = c.k; i.value = r[c.k] == null ? '' : r[c.k]; i.style.flex = c.flex || '1'; if (c.step) i.step = c.step; if (c.tipo === 'number') i.inputMode = 'decimal'; i.addEventListener('input', () => box.dispatchEvent(new Event('cambio'))); d.appendChild(i); });
      const x = document.createElement('button'); x.type = 'button'; x.className = 'btn piccolo leggero'; x.textContent = '✕';
      x.onclick = () => { d.remove(); box.dispatchEvent(new Event('cambio')); }; d.appendChild(x); box.appendChild(d);
    }
    return {
      carica(l) { box.innerHTML = ''; (l && l.length ? l : [vuota()]).forEach(aggiungi); box.dispatchEvent(new Event('cambio')); },
      aggiungi() { aggiungi(vuota()); },
      leggi() { return $$('.r', box).map(d => { const o = {}; $$('input', d).forEach(i => { o[i.dataset.c] = i.value.trim(); }); return o; }).filter(o => Object.values(o).some(v => v)); },
      box,
    };
  }
  const DEF = {
    it: { voce: 'Cachet spettacolo', att: 'Spettacolo', prove: "soundcheck e prova spazio il giorno dell'evento",
      desc: 'Show originale, energico e dinamico che fonde danza, sport e tecnologia, con coreografie dal nostro repertorio e effetti luminosi LED.' },
    en: { voce: 'Show fee', att: 'Show', prove: 'soundcheck and stage rehearsal on the event day',
      desc: 'An original, high-energy and dynamic show blending dance, sport and technology, with choreographies from our repertoire and LED light effects.' },
  };
  function notaRegime(reg, naz) {
    if (reg === 'forfettario') return 'Nessuna IVA: regime forfettario (nel documento va la dicitura di legge).';
    if (reg === 'estero') return L.UE.includes(naz) ? 'Cliente UE: niente IVA, reverse charge (art. 7-quinquies). Serve la VAT del cliente.' : 'Cliente extra-UE: operazione non soggetta IVA (art. 7-quinquies).';
    return "IVA in fattura con l'aliquota indicata.";
  }

  function vistaPratica(id, q) {
    let P;
    if (id && id !== 'nuova') P = copia(st.pratiche.find(p => p.id === id) || {});
    else if (q.get('da')) {
      P = copia(st.pratiche.find(p => p.id === q.get('da')));
      Object.assign(P, { id: '', stato: 'bozza', data_emissione: L.iso(L.oggi()), anno: L.iso(L.oggi()).slice(0, 4), _qui: true });
      P.numero = prossimoNumero(P.anno, P.emittente);
    } else P = L.praticaVuota(st.imp, 'patrizio', prossimoNumero(L.iso(L.oggi()).slice(0, 4), 'patrizio'));
    if (!P.emittente) return vai('#elenco');
    const nuovo = !P.id;
    V.innerHTML = `<div class="testa-pagina"><h1>${nuovo ? 'Nuovo preventivo e contratto' : 'N. ' + esc(P.numero)}</h1><a class="btn leggero" href="#elenco">← Elenco</a></div>
      ${nuovo && st.ppp.length ? `<div class="card"><h2>Parti da un preventivo PPP <span class="aiuto" style="margin:0;font-weight:400">(facoltativo)</span></h2><div class="riga">
        <label class="x2">Preventivo PPP<select id="ppp-scelta"><option value="">— nessuno, compilo da zero —</option>${st.ppp.map((x, i) => `<option value="${i}">${esc(x.numero)} · ${esc(x.cliente)} · ${esc(x.nome_evento || '')} ${L.dataBreve(x.data_evento || '')}</option>`).join('')}</select></label>
        <label id="ppp-opz-box" style="display:none">Opzione<select id="ppp-opz"></select></label></div></div>` : ''}
      <div class="card"><h2><span class="n">1</span> Chi emette</h2>${sceltaEmittenti(E => E.ragione_sociale + ' · P.IVA ' + E.piva)}
        <div class="riga" style="margin-top:14px"><label class="stretto">Lingua<select data-k="lingua"><option value="it">Italiano</option><option value="en">English</option></select></label>
        <label class="stretto">Numero<input data-k="numero"></label><label class="stretto">Data<input type="date" data-k="data_emissione"></label></div></div>
      <div class="card"><h2><span class="n">2</span> Cliente</h2>${opzClienti()}${campiCliente(true)}</div>
      <div class="card"><h2><span class="n">3</span> Evento e programma</h2>
        <div class="riga"><label class="x2">Nome evento *<input data-k="evento.nome"></label><label>Location<input data-k="evento.location"></label><label>Indirizzo / città<input data-k="evento.indirizzo"></label></div>
        <label class="check"><input type="checkbox" data-k="evento.aperto"> Evento all'aperto</label>
        <div style="margin-top:12px"><div class="aiuto" style="margin:0 0 6px">Programma: una riga per ogni momento (arrivo, prove, show…)</div>
        <div class="lista-righe" id="giorni"></div><button class="btn piccolo" type="button" id="add-giorno">＋ Aggiungi riga</button></div></div>
      <div class="card"><h2><span class="n">4</span> La prestazione</h2>
        <div class="riga"><label class="x2">Tipo di prestazione <span style="font-weight:400">(va nel contratto)</span><input data-k="show.titolo" id="tipo-prest"></label>
        <label>Durata <span style="font-weight:400">(va nel contratto)</span><input data-k="show.durata" placeholder="es. 2 x 5 min"></label><label class="stretto">Uscite<input data-k="show.uscite"></label></div>
        <div class="riga"><label>N. ballerini <span style="font-weight:400">(facoltativo, solo preventivo)</span><input data-k="show.performer"></label>
        <label>Persone in trasferta <span style="font-weight:400">(facoltativo)</span><input data-k="show.team"></label></div>
        <label>Descrizione <span style="font-weight:400">(solo preventivo)</span><textarea data-k="show.descrizione"></textarea></label>
        <label>Prove incluse <span style="font-weight:400">(solo preventivo)</span><input data-k="show.prove"></label></div>
      <div class="card"><h2><span class="n">5</span> Compenso e spese</h2><div class="lista-righe" id="voci"></div><button class="btn piccolo" type="button" id="add-voce">＋ Aggiungi voce</button>
        <div class="riga" style="margin-top:14px"><label class="x2">IVA<select data-k="regime_iva" id="regime">${opzRegimi()}</select></label>
        <label class="stretto" id="aliq-box">Aliquota %<input data-k="aliquota_iva" type="number" step="1" inputmode="decimal"></label></div>
        <div class="aiuto" id="regime-nota"></div><div class="tot" id="totali"></div>
        <div class="riga" style="margin-top:14px">${[['viaggio', 'Viaggio'], ['vitto', 'Vitto'], ['alloggio', 'Alloggio']].map(([k, n]) => `<label>${n}<select data-k="spese.${k}"><option value="cliente">A carico del cliente</option><option value="incluso">Incluso nel compenso</option></select></label>`).join('')}</div>
        <label>Note su spese/ospitalità <span style="font-weight:400">(facoltativo)</span><input data-k="spese_note"></label></div>
      <div class="card"><h2><span class="n">6</span> Condizioni</h2>
        <div class="riga"><label class="stretto">Acconto %<input type="number" data-k="acconto_perc" step="5" min="0" max="100" inputmode="decimal"></label>
        <label class="x2">Saldo<select data-k="saldo" id="saldo"><option value="7_dopo">entro 7 giorni dopo l'evento</option><option value="prima">il giorno dell'evento, prima dello show</option>
          <option value="7_prima">entro 7 giorni prima dell'evento</option><option value="30_dopo">entro 30 giorni dopo l'evento</option><option value="altro">altro (scrivo io)…</option></select></label>
        <label class="x2" id="saldo-testo-box">Testo saldo<input data-k="saldo_testo"></label><label class="stretto">Validità (giorni)<input type="number" data-k="validita_giorni" inputmode="numeric"></label></div>
        <label>Esigenze tecniche particolari <span style="font-weight:400">(facoltativo)</span><input data-k="esigenze"></label>
        <div class="riga"><label class="x2">Accordi particolari nel contratto<textarea data-k="note_contratto"></textarea></label><label class="x2">Nota in fondo al preventivo<textarea data-k="note_preventivo"></textarea></label></div></div>
      <div class="pied"><span class="esito" id="esito"></span>
        <span id="dopo" style="display:none"><button class="btn" id="ap-prev" type="button">Preventivo</button><button class="btn" id="ap-contr" type="button">Contratto</button></span>
        <button class="btn nero" id="salva" type="button">Salva</button></div>`;

    const esito = (t, c) => { const e = $('#esito'); e.textContent = t; e.className = 'esito ' + (c || ''); };
    let regimeToccato = !!P.id;
    const EM = st.imp.emittenti;
    const G = righe($('#giorni'), [{ k: 'data', tipo: 'date', flex: '0 0 150px' }, { k: 'attivita', ph: 'Attività', flex: '2' }, { k: 'orario', ph: 'Orario', flex: '0 0 110px' }],
      () => ({ data: ((G && G.leggi().slice(-1)[0]) || {}).data || '', attivita: '', orario: '' }));
    const VO = righe($('#voci'), [{ k: 'descrizione', ph: 'Descrizione', flex: '3' }, { k: 'importo', ph: 'Importo €', tipo: 'number', step: '0.01', flex: '0 0 130px' }], () => ({ descrizione: '', importo: '' }));
    $('#add-giorno').onclick = () => G.aggiungi(); $('#add-voce').onclick = () => VO.aggiungi();
    const emittente = () => { const r = $('input[name=emittente]:checked'); return r ? r.value : ''; };
    function carica(p) { caricaCampi(p, V); $$('input[name=emittente]').forEach(r => { r.checked = r.value === p.emittente; }); G.carica(p.giorni); VO.carica(p.voci); aggiorna(); }
    function aggiorna() {
      const naz = $('[data-k="cliente.nazione"]').value;
      $$('.solo-it', V).forEach(el => { el.style.display = naz === 'IT' ? '' : 'none'; });
      if (!regimeToccato) $('#regime').value = L.regimeProposto(EM[emittente()] || {}, { nazione: naz });
      const reg = $('#regime').value;
      $('#aliq-box').style.display = reg === 'iva' ? '' : 'none';
      if (reg === 'iva' && !num($('[data-k=aliquota_iva]').value)) $('[data-k=aliquota_iva]').value = (EM[emittente()] || {}).aliquota_iva || 22;
      let nota = notaRegime(reg, naz);
      if (reg === 'iva' && (EM[emittente()] || {}).regime === 'forfettario') nota = "⚠️ Sei in regime forfettario: di solito NON si applica l'IVA.";
      $('#regime-nota').textContent = nota;
      $('#saldo-testo-box').style.display = $('#saldo').value === 'altro' ? '' : 'none';
      const K = L.conti({ voci: VO.leggi(), regime_iva: reg, aliquota_iva: $('[data-k=aliquota_iva]').value, acconto_perc: $('[data-k=acconto_perc]').value }, EM[emittente()] || {});
      $('#totali').innerHTML = (K.aliquota ? `<span>Imponibile ${euro(K.imponibile)}</span><span>IVA ${K.aliquota}% ${euro(K.iva)}</span>` : '') +
        `<span>Totale <b>${euro(K.totale)}</b></span>` + (K.acconto ? `<span>Acconto ${euro(K.acconto)} · Saldo ${euro(K.saldo)}</span>` : '');
    }
    V.oninput = aggiorna; V.onchange = aggiorna; VO.box.addEventListener('cambio', aggiorna);
    $('#regime').addEventListener('change', () => { regimeToccato = true; });
    let lingua = P.lingua || 'it';
    function cambiaLingua(nuova) {
      if (nuova === lingua) return;
      const da = DEF[lingua], a = DEF[nuova];
      $$('[data-k="show.descrizione"], [data-k="show.prove"], #voci input[data-c=descrizione], #giorni input[data-c=attivita]').forEach(i => { const k = Object.keys(da).find(k => da[k] === i.value); if (k) i.value = a[k]; });
      lingua = nuova;
    }
    function aggiornaTipo() {
      const el = $('#tipo-prest'); const tutti = Object.values(window.TESTI_CONTRATTO.tipo_prestazione).flatMap(x => Object.values(x));
      if (el.value && !tutti.includes(el.value)) return;
      el.value = L.tipoPredefinito(EM[emittente()] || {}, $('[data-k=lingua]').value);
    }
    $('[data-k=lingua]').addEventListener('change', e => { cambiaLingua(e.target.value); aggiornaTipo(); });
    $$('input[name=emittente]').forEach(r => r.addEventListener('change', () => {
      regimeToccato = false;
      if (!P.id) $('[data-k=numero]').value = prossimoNumero(String($('[data-k=data_emissione]').value || L.iso(L.oggi())).slice(0, 4), r.value);
      aggiornaTipo(); aggiorna();
    }));
    $('[data-k="cliente.nazione"]').addEventListener('change', () => { regimeToccato = false; aggiorna(); });
    const rub = $('#rubrica');
    if (rub) rub.onchange = () => { const c = st.clienti[rub.value]; if (!c) return; Object.entries(c).forEach(([k, v]) => { const el = $(`[data-k="cliente.${k}"]`); if (el) el.value = v || ''; }); if (!c.nazione) $('[data-k="cliente.nazione"]').value = 'IT'; regimeToccato = false; aggiorna(); };
    // da PPP (stessa logica del Mac)
    let datiPPP = null;
    function applicaOpzione() {
      if (!datiPPP) return;
      const o = datiPPP.opzioni[num($('#ppp-opz').value)] || {};
      $('[data-k=lingua]').value = datiPPP.lingua; cambiaLingua(datiPPP.lingua);
      const p = leggi();
      if (datiPPP.cliente && !p.cliente.ragione_sociale) { p.cliente.ragione_sociale = datiPPP.cliente; const c = st.clienti.find(x => (x.ragione_sociale || '').toLowerCase() === datiPPP.cliente.toLowerCase()); if (c) Object.assign(p.cliente, c); }
      Object.assign(p.evento, datiPPP.evento);
      if (datiPPP.giorni.length) p.giorni = datiPPP.giorni;
      if (datiPPP.show.descrizione) p.show.descrizione = datiPPP.show.descrizione;
      p.show.prove = DEF[p.lingua].prove; Object.assign(p.show, o.show || {});
      p.voci = o.voci || p.voci; p.spese = o.spese || p.spese;
      p.acconto_perc = datiPPP.acconto_perc; p.validita_giorni = datiPPP.validita_giorni;
      if (datiPPP.saldo_testo) { p.saldo = 'altro'; p.saldo_testo = datiPPP.saldo_testo; } else p.saldo = '7_dopo';
      regimeToccato = false; carica(p); aggiornaTipo();
      esito('Dati copiati dal preventivo PPP ' + datiPPP.rif + ': completa indirizzo e P.IVA del cliente.', 'ok');
    }
    if ($('#ppp-scelta')) $('#ppp-scelta').onchange = () => {
      if ($('#ppp-scelta').value === '') return;
      datiPPP = L.daPPP(st.ppp[num($('#ppp-scelta').value)]);
      const sel = $('#ppp-opz'); sel.innerHTML = '';
      datiPPP.opzioni.forEach((o, i) => sel.add(new Option(o.nome, i)));
      const cons = datiPPP.opzioni.findIndex(o => o.nome.includes('consigliata')); if (cons >= 0) sel.value = cons;
      $('#ppp-opz-box').style.display = datiPPP.opzioni.length > 1 ? '' : 'none';
      applicaOpzione();
    };
    if ($('#ppp-opz')) $('#ppp-opz').onchange = applicaOpzione;

    function leggi() {
      const p = copia(P); leggiCampi(p, V);
      p.emittente = emittente(); p.giorni = G.leggi(); p.voci = VO.leggi();
      p.acconto_perc = num(p.acconto_perc); p.validita_giorni = num(p.validita_giorni) || 30; p.aliquota_iva = num(p.aliquota_iva);
      return p;
    }
    let salvata = P.id ? P : null;
    async function salva() {
      const p = leggi();
      if (!p.emittente) return esito('Scegli chi emette (punto 1).', 'err');
      if (!p.cliente.ragione_sociale) return esito('Manca il nome del cliente (punto 2).', 'err');
      if (!p.evento.nome) return esito("Manca il nome dell'evento (punto 3).", 'err');
      if (!p.voci.some(v => num(v.importo))) return esito('Manca il compenso (punto 5).', 'err');
      p.numero = String(p.numero || '').trim() || prossimoNumero(String(p.data_emissione || L.iso(L.oggi())).slice(0, 4), p.emittente);
      p.anno = p.numero.includes('/') ? p.numero.split('/').pop() : String(p.data_emissione).slice(0, 4);
      if (st.pratiche.some(x => x.numero === p.numero && x.emittente === p.emittente && x.id !== p.id) && !confirm('Il numero ' + p.numero + ' è già usato. Salvo lo stesso?')) return esito('Non salvato: cambia il numero.', 'err');
      const t = ora();
      if (!p.id) { p.id = nuovoId(); p.creato_il = t; st.pratiche.push(p); } else { const i = st.pratiche.findIndex(x => x.id === p.id); st.pratiche[i >= 0 ? i : st.pratiche.length] = p; }
      p.aggiornato_il = t; p._qui = true; delete p.file;
      ricordaCliente(p.cliente);
      await salvaTutto();
      salvata = p; P.id = p.id;
      history.replaceState(null, '', '#pratica/' + p.id);
      esito('✓ Salvato.', 'ok'); $('#dopo').style.display = '';
    }
    $('#salva').onclick = salva;
    $('#ap-prev').onclick = () => salvata && mostraPdf('preventivo', salvata);
    $('#ap-contr').onclick = () => salvata && mostraPdf('contratto', salvata);
    carica(P);
    if (!P.id) aggiornaTipo();
    if (P.id) $('#dopo').style.display = '';
  }

  // ---------- fatture
  function vistaFatture() {
    const righeF = st.fatture.slice().sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')) || String(b.creato_il || '').localeCompare(String(a.creato_il || '')));
    const prat = st.pratiche.slice().sort((a, b) => String(b.creato_il || '').localeCompare(String(a.creato_il || '')));
    V.innerHTML = `<div class="testa-pagina"><h1>Fatture</h1><a class="btn nero" href="#fattura/nuova">＋ Da zero</a></div>
      <div class="card"><h2>Fattura da un contratto</h2><div class="riga">
        <label class="x2">Evento<select id="da-pratica"><option value="">— scegli —</option>${prat.map(p => `<option value="${p.id}" data-acc="${num(p.acconto_perc)}">${esc(p.numero)} · ${esc(p.cliente.ragione_sociale)} · ${esc(p.evento.nome)}</option>`).join('')}</select></label>
        <label>Cosa fatturi<select id="quota"><option value="acconto">Acconto</option><option value="saldo">Saldo</option><option value="totale">Tutto in una fattura</option></select></label>
        <label style="flex:0 0 auto;align-self:flex-end"><button class="btn nero" id="vai" type="button">Prepara</button></label></div></div>
      <div class="info">Sul sito dell'Agenzia delle Entrate (<b>Fatture e Corrispettivi</b>) importa il file XML nella procedura web, controlla e invia. Al cliente estero manda anche la copia PDF.</div>
      <div class="schede">${righeF.length ? righeF.map(f => {
        const T = L.totaliFattura(f);
        return `<div class="scheda"><div class="su"><div><b>n. ${esc(f.numero)}</b> · ${L.dataBreve(f.data)} · <b>${esc(f.cliente.ragione_sociale)}</b>
          <div class="sub">${esc(((f.righe || [])[0] || {}).descrizione || '').slice(0, 80)} · ${euro(T.totale)} ${f._qui ? '· <b>fatta qui</b>' : ''}</div></div>
          <span class="chip ${esc(f.emittente)}">${f.emittente === 'asd' ? 'ASD' : 'Patrizio'}</span></div>
          <div class="az"><button class="btn piccolo nero" data-xml="${f.id}">⬇ XML</button><button class="btn piccolo" data-fpdf="${f.id}">Copia PDF</button>
          <a class="btn piccolo leggero" href="#fattura/${f.id}">Modifica</a><button class="btn piccolo leggero" data-elimina="${f.id}">Elimina</button></div></div>`;
      }).join('') : '<div class="vuoto">Nessuna fattura preparata.</div>'}</div>`;
    $('#da-pratica').onchange = () => { const o = $('#da-pratica').selectedOptions[0]; $('#quota').value = o && num(o.dataset.acc) > 0 ? 'acconto' : 'totale'; };
    $('#vai').onclick = () => { if (!$('#da-pratica').value) return toast('Scegli un evento'); vai('#fattura/nuova?pratica=' + $('#da-pratica').value + '&quota=' + $('#quota').value); };
    $$('[data-xml]', V).forEach(b => b.onclick = () => mostraXml(st.fatture.find(f => f.id === b.dataset.xml)));
    $$('[data-fpdf]', V).forEach(b => b.onclick = () => mostraPdfFattura(st.fatture.find(f => f.id === b.dataset.fpdf)));
    $$('[data-elimina]', V).forEach(b => b.onclick = async () => {
      const f = st.fatture.find(x => x.id === b.dataset.elimina);
      if (!confirm('Eliminare la bozza n. ' + f.numero + ' da questo dispositivo?\n(Non tocca nulla sul sito dell\'Agenzia.)')) return;
      st.fatture = st.fatture.filter(x => x !== f); await salvaTutto(); vistaFatture();
    });
  }
  function xmlDi(f) {
    if (!f._xml) { const r = L.fatturaXml(f, st.imp.emittenti[f.emittente]); f._xml = r.xml; f._xml_nome = r.nome; }
    return { nome: f._xml_nome, xml: f._xml };
  }
  function mostraXml(f) {
    const r = xmlDi(f);
    finestraFile('Fattura n. ' + f.numero + ' – XML', new Blob([r.xml], { type: 'application/xml' }), r.nome, 'application/xml', '',
      'Salvalo in File (o mandalo a te). Poi sul sito dell\'Agenzia: Fatture e Corrispettivi → procedura web → importa il file → controlla → invia.');
  }
  async function mostraPdfFattura(f) {
    apriOverlay('Fattura n. ' + f.numero, '<div class="caricamento"><div class="spinner"></div>Creo il PDF…</div>');
    try {
      const r = await PDF.creaPdf('fattura', PDF.contestoFattura(f, st.imp));
      finestraFile('Fattura n. ' + f.numero + ' – copia PDF', r.blob, `Fattura_${f.numero}_${String(f.data).slice(0, 4)}_${nomeFile(f.cliente.ragione_sociale)}.pdf`, 'application/pdf', r.anteprima,
        'Copia di cortesia: il documento valido è l\'XML trasmesso all\'Agenzia.');
    } catch (e) { $('#overlay-corpo').innerHTML = '<p class="err">PDF non creato: ' + esc(e && e.message || e) + '</p>'; }
  }

  function vistaFattura(id, q) {
    let F;
    if (id && id !== 'nuova') F = copia(st.fatture.find(f => f.id === id) || {});
    else if (q.get('pratica')) { const p = st.pratiche.find(x => x.id === q.get('pratica')); if (!p) return vai('#fatture'); F = L.fatturaDaPratica(p, q.get('quota') || 'totale', st.imp); }
    else F = L.fatturaVuota(st.imp, 'patrizio');
    if (!F.emittente) return vai('#fatture');
    const EM = st.imp.emittenti;
    V.innerHTML = `<div class="testa-pagina"><h1>${F.id ? 'Fattura n. ' + esc(F.numero) : 'Nuova fattura'}</h1><a class="btn leggero" href="#fatture">← Fatture</a></div>
      ${F.pratica_id ? '<div class="info">Dati presi dal contratto: controlla e correggi se serve.</div>' : ''}
      <div class="card"><h2><span class="n">1</span> Chi emette, numero e data</h2>${sceltaEmittenti(E => E.ragione_sociale + ' · ultima fattura: n. ' + (E.ultima_fattura || 0))}
        <div class="riga" style="margin-top:14px"><label class="stretto">Numero<input data-k="numero" inputmode="numeric"></label><label class="stretto">Data<input type="date" data-k="data"></label>
        <label>Tipo documento<select data-k="tipo_documento"><option value="TD01">TD01 – Fattura</option><option value="TD02">TD02 – Acconto/anticipo</option><option value="TD04">TD04 – Nota di credito</option></select></label>
        <label>Pagamento<select data-k="condizioni_pagamento"><option value="TP02">Pagamento completo</option><option value="TP01">A rate</option><option value="TP03">Anticipo</option></select></label>
        <label class="stretto">Scadenza<input type="date" data-k="scadenza"></label></div>
        <div class="aiuto">Se nel frattempo hai fatto altre fatture (sul Mac o sul sito), correggi il numero.</div></div>
      <div class="card"><h2><span class="n">2</span> Cliente</h2>${opzClienti()}${campiCliente(false)}</div>
      <div class="card"><h2><span class="n">3</span> Righe e importi</h2><div class="lista-righe" id="righe"></div><button class="btn piccolo" type="button" id="add-riga">＋ Aggiungi riga</button>
        <div class="riga" style="margin-top:14px"><label class="x2">IVA<select data-k="regime_iva" id="regime">${opzRegimi()}</select></label><label class="stretto" id="aliq-box">Aliquota %<input type="number" data-k="aliquota_iva" inputmode="decimal"></label></div>
        <div class="aiuto" id="regime-nota"></div><div class="aiuto" id="bollo-nota"></div>
        <div class="riga" id="estero-box"><label>Ritenuta estera %<input type="number" data-k="ritenuta_estera_perc" step="0.01" inputmode="decimal"></label><label>Oppure importo che incassi €<input type="number" data-k="importo_pagamento" step="0.01" inputmode="decimal"></label></div>
        <div class="tot" id="totali"></div>
        <label style="margin-top:12px">Causale / dicitura fiscale <span style="font-weight:400">(vuota = automatica)</span><textarea data-k="causale" style="min-height:44px"></textarea></label>
        <label>Nota solo sulla copia PDF<input data-k="note"></label></div>
      <div class="pied"><span class="esito" id="esito"></span><span id="dopo" style="display:none"><button class="btn nero" id="b-xml" type="button">⬇ XML</button><button class="btn" id="b-pdf" type="button">Copia PDF</button></span>
        <button class="btn nero" id="salva" type="button">Prepara la fattura</button></div>`;
    const esito = (t, c) => { const e = $('#esito'); e.textContent = t; e.className = 'esito ' + (c || ''); };
    let regimeToccato = !!F.id || !!F.pratica_id;
    const R = righe($('#righe'), [{ k: 'descrizione', ph: 'Descrizione', flex: '3' }, { k: 'quantita', ph: 'Q.tà', tipo: 'number', step: '1', flex: '0 0 70px' }, { k: 'prezzo', ph: 'Prezzo €', tipo: 'number', step: '0.01', flex: '0 0 120px' }], () => ({ descrizione: '', quantita: '1', prezzo: '' }));
    $('#add-riga').onclick = () => R.aggiungi();
    const emittente = () => { const r = $('input[name=emittente]:checked'); return r ? r.value : ''; };
    function aggiorna() {
      const naz = $('[data-k="cliente.nazione"]').value;
      $$('.solo-it', V).forEach(el => { el.style.display = naz === 'IT' ? '' : 'none'; });
      if (!regimeToccato) $('#regime').value = L.regimeProposto(EM[emittente()] || {}, { nazione: naz });
      const reg = $('#regime').value;
      $('#aliq-box').style.display = reg === 'iva' ? '' : 'none';
      if (reg === 'iva' && !num($('[data-k=aliquota_iva]').value)) $('[data-k=aliquota_iva]').value = (EM[emittente()] || {}).aliquota_iva || 22;
      $('#regime-nota').textContent = notaRegime(reg, naz);
      $('#estero-box').style.display = naz !== 'IT' ? '' : 'none';
      const f = leggi(), T = L.totaliFattura(f);
      $('#totali').innerHTML = `<span>Imponibile ${euro(T.imponibile)}</span>` + (T.aliquota ? `<span>IVA ${T.aliquota}% ${euro(T.iva)}</span>` : '') +
        `<span>Totale documento <b>${euro(T.totale)}</b></span>` + (Math.abs(T.da_pagare - T.totale) > 0.004 ? `<span>Da incassare ${euro(T.da_pagare)}</span>` : '');
      $('#bollo-nota').textContent = L.bolloDovuto(f, EM[emittente()] || {}, T) ? 'Marca da bollo virtuale € 2,00 inserita nel file.' : '';
    }
    V.oninput = aggiorna; V.onchange = aggiorna; R.box.addEventListener('cambio', aggiorna);
    $('#regime').addEventListener('change', () => { regimeToccato = true; });
    $$('input[name=emittente]').forEach(r => r.addEventListener('change', () => { regimeToccato = false; if (!F.id) $('[data-k=numero]').value = num(EM[r.value].ultima_fattura) + 1; aggiorna(); }));
    $('[data-k="cliente.nazione"]').addEventListener('change', () => { regimeToccato = false; aggiorna(); });
    const rub = $('#rubrica');
    if (rub) rub.onchange = () => { const c = st.clienti[rub.value]; if (!c) return; Object.entries(c).forEach(([k, v]) => { const el = $(`[data-k="cliente.${k}"]`); if (el) el.value = v || ''; }); regimeToccato = false; aggiorna(); };
    function leggi() { const f = copia(F); leggiCampi(f, V); f.emittente = emittente(); f.righe = R.leggi(); f.aliquota_iva = num(f.aliquota_iva); delete f._xml; delete f._xml_nome; return f; }
    let salvata = F.id ? F : null;
    async function salva() {
      const f = leggi();
      if (!f.emittente) return esito('Scegli chi emette.', 'err');
      const manca = [['ragione sociale del cliente', f.cliente.ragione_sociale], ['numero fattura', f.numero], ['data', f.data]].filter(x => !String(x[1] || '').trim()).map(x => x[0]);
      if (!L.totaliFattura(f).righe.length) manca.push('almeno una riga con descrizione');
      if (manca.length) return esito('Manca: ' + manca.join(', '), 'err');
      const doppia = st.fatture.find(x => x.id !== f.id && x.emittente === f.emittente && String(x.numero) === String(f.numero) && String(x.data).slice(0, 4) === String(f.data).slice(0, 4));
      if (doppia && !confirm('La fattura n. ' + f.numero + ' del ' + String(f.data).slice(0, 4) + ' esiste già. Salvo lo stesso?')) return esito('Non salvata.', 'err');
      const t = ora();
      if (!f.id) { f.id = nuovoId(); f.creato_il = t; st.fatture.push(f); } else { const i = st.fatture.findIndex(x => x.id === f.id); st.fatture[i >= 0 ? i : st.fatture.length] = f; }
      f.aggiornato_il = t; f._qui = true; delete f.xml_file; delete f.pdf_file;
      xmlDi(f);
      const n = parseInt(String(f.numero).split('/')[0], 10), E = st.imp.emittenti[f.emittente];
      if (!isNaN(n) && n > num(E.ultima_fattura) && String(f.data).slice(0, 4) === String(new Date().getFullYear())) E.ultima_fattura = n;
      ricordaCliente(f.cliente);
      await salvaTutto();
      salvata = f; F.id = f.id; history.replaceState(null, '', '#fattura/' + f.id);
      esito('✓ Pronta.', 'ok'); $('#dopo').style.display = '';
    }
    $('#salva').onclick = salva;
    $('#b-xml').onclick = () => salvata && mostraXml(salvata);
    $('#b-pdf').onclick = () => salvata && mostraPdfFattura(salvata);
    caricaCampi(F, V); $$('input[name=emittente]').forEach(r => { r.checked = r.value === F.emittente; });
    R.carica(F.righe); aggiorna();
    if (F.id) $('#dopo').style.display = '';
  }

  // ---------- dati: dal Mac, verso il Mac, impostazioni
  function vistaDati() {
    const quiP = st.pratiche.filter(p => p._qui).length, quiF = st.fatture.filter(f => f._qui).length;
    const campi = [['ragione_sociale', 'Nome / ragione sociale'], ['indirizzo', 'Indirizzo'], ['civico', 'N. civico'], ['cap', 'CAP'], ['comune', 'Comune'], ['provincia', 'Prov.'],
      ['piva', 'P.IVA'], ['cf', 'Codice fiscale'], ['nascita', 'Dati di nascita (persona)'], ['email', 'Email'], ['telefono', 'Telefono'], ['rappresentante', 'Chi firma'],
      ['intestatario', 'Intestatario conto'], ['iban', 'IBAN'], ['swift', 'BIC/SWIFT'], ['banca', 'Banca'], ['assicurazione', 'Assicurazione'],
      ['denominazione_xml', 'Nome nella fattura XML'], ['cf_trasmittente', 'C.F. di chi trasmette'], ['ultima_fattura', 'Ultima fattura (n.)']];
    V.innerHTML = `<h1>Dati</h1>
      <div class="card"><h2>Dal Mac</h2>
        <p class="aiuto" style="margin:0 0 10px">${st.mac ? 'Ultimi dati caricati: <b>' + esc(st.mac.creato_il) + '</b>' : 'Nessun dato caricato dal Mac.'}</p>
        <p class="aiuto">Sul Mac: <b>APP_IPAD → PREPARA CONTRATTI PER IPAD</b>, poi manda a te il file <b>contratti-dati-ipad.json</b>.</p>
        <label class="btn nero" style="display:inline-flex">Carica dati dal Mac (.json)<input type="file" id="f-mac" accept=".json,application/json" hidden></label></div>
      <div class="card"><h2>Verso il Mac</h2>
        <p class="aiuto" style="margin:0 0 10px">Fatti o modificati qui: <b>${quiP}</b> preventivi/contratti e <b>${quiF}</b> fatture.</p>
        <button class="btn nero" id="esporta" type="button" ${quiP + quiF ? '' : 'disabled'}>Esporta per il Mac</button>
        <p class="aiuto" style="margin-top:10px">Poi sul Mac: salva il file in Download e fai doppio clic su <b>IMPORTA CONTRATTI NEL MAC</b>.</p></div>
      ${Object.entries(st.imp.emittenti).map(([k, E]) => `<details class="card"><summary><b>${esc(E.etichetta)}</b> – dati di chi emette</summary>
        <div class="riga" style="margin-top:12px">${campi.map(([c, n]) => `<label class="${['indirizzo', 'iban', 'assicurazione', 'ragione_sociale'].includes(c) ? 'x2' : ''}">${n}<input data-k="emittenti.${k}.${c}"></label>`).join('')}</div></details>`).join('')}
      <details class="card"><summary><b>Condizioni standard</b></summary><div class="riga" style="margin-top:12px">
        ${[['acconto_perc', 'Acconto %'], ['giorni_acconto', 'Giorni per l\'acconto'], ['validita_giorni', 'Validità (giorni)'], ['penale_giorni_1', '1° limite penali (giorni)'], ['penale_giorni_2', '2° limite (giorni)'], ['penale_perc_2', '% tra i limiti'], ['penale_perc_3', '% sotto il 2°'], ['foro', 'Foro competente']]
          .map(([c, n]) => `<label class="stretto">${n}<input data-k="condizioni.${c}"></label>`).join('')}</div></details>
      <div class="pied"><span class="esito" id="esito"></span><button class="btn nero" id="salva-imp" type="button">Salva dati</button></div>`;
    caricaCampi(st.imp, V);
    $('#salva-imp').onclick = async () => {
      const o = leggiCampi({}, V);
      Object.entries(o.emittenti || {}).forEach(([k, E]) => Object.assign(st.imp.emittenti[k], E, { ultima_fattura: parseInt(E.ultima_fattura || 0, 10) || 0 }));
      Object.entries(o.condizioni || {}).forEach(([k, v]) => { st.imp.condizioni[k] = k === 'foro' ? v : num(v); });
      st.imp._qui = true;
      await salvaTutto(); $('#esito').textContent = '✓ Salvati'; $('#esito').className = 'esito ok';
    };
    $('#f-mac').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await caricaDalMac(f); };
    $('#esporta').onclick = esporta;
  }
  async function caricaDalMac(file) {
    let j;
    try { j = JSON.parse(await file.text()); if (j.tipo !== 'contratti-dati-ipad') throw new Error(); } catch (e) {
      return alert('Questo non è il file giusto.\nScegli “contratti-dati-ipad.json” creato sul Mac con “PREPARA CONTRATTI PER IPAD”.');
    }
    // i dati del Mac sostituiscono quelli vecchi, ma ciò che hai fatto qui (e non ancora importato) resta
    const tieni = (locali, mac) => {
      const m = new Map(mac.map(x => [x.id, x]));
      locali.filter(x => x._qui).forEach(x => { const y = m.get(x.id); if (!y || String(x.aggiornato_il || '') > String(y.aggiornato_il || '')) m.set(x.id, x); });
      return Array.from(m.values());
    };
    const ultime = {}; Object.entries(st.imp.emittenti).forEach(([k, E]) => { ultime[k] = num(E.ultima_fattura); });
    st.imp = unisci(window.BASE_IMPOSTAZIONI, j.impostazioni || {});
    Object.entries(st.imp.emittenti).forEach(([k, E]) => { E.ultima_fattura = Math.max(num(E.ultima_fattura), ultime[k] || 0); });
    st.pratiche = tieni(st.pratiche, j.pratiche || []);
    st.fatture = tieni(st.fatture, j.fatture || []);
    const cl = new Map((j.clienti || []).map(c => [String(c.ragione_sociale || '').toLowerCase(), c]));
    st.clienti.filter(c => c._qui).forEach(c => cl.set(String(c.ragione_sociale || '').toLowerCase(), c));
    st.clienti = Array.from(cl.values()).sort((a, b) => String(a.ragione_sociale).toLowerCase().localeCompare(String(b.ragione_sociale).toLowerCase()));
    st.ppp = j.preventivi_ppp || []; st.numeri_ppp = j.numeri_ppp || [];
    st.mac = { creato_il: j.creato_il };
    await salvaTutto();
    toast('Dati del Mac caricati: ' + st.pratiche.length + ' contratti, ' + st.fatture.length + ' fatture');
    vai('#elenco');
  }
  async function esporta() {
    const pulisci = x => { const y = copia(x); delete y._qui; delete y._xml; delete y._xml_nome; return y; };
    const out = {
      tipo: 'contratti-da-importare', versione: 1, creato_il: ora(),
      pratiche: st.pratiche.filter(p => p._qui).map(pulisci),
      fatture: st.fatture.filter(f => f._qui).map(f => Object.assign(pulisci(f), { xml_inviato_nome: f._xml_nome || '' })),
      clienti: st.clienti.filter(c => c._qui).map(pulisci),
      ultime_fatture: Object.fromEntries(Object.entries(st.imp.emittenti).map(([k, E]) => [k, num(E.ultima_fattura)])),
    };
    const nome = 'contratti-da-importare-' + out.creato_il.replace(/[: ]/g, '-') + '.json';
    finestraFile('Esporta per il Mac', new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }), nome, 'application/json', '',
      'Mandalo a te (WhatsApp, email…). Sul Mac salvalo in Download e fai doppio clic su IMPORTA CONTRATTI NEL MAC.');
  }

  // ───────────────────────── avvio
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  carica().then(mostra).catch(e => { V.innerHTML = '<p class="err">Errore: ' + esc(e.message) + '</p>'; });
  window.__mini = { st, salvaTutto };            // per il collaudo
})();
