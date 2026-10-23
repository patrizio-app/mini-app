/* LOGICA della mini app Contratti: stessa identica logica dell'app del Mac (APP_CONTRATTI).
 *   calcoli.py   → conti, IVA, date, importi
 *   testi.py     → frasi del contratto (dal file unico testi_contratto.json)
 *   fattura_xml.py → file XML della fattura elettronica
 *   app.py       → evento vuoto, fattura vuota / da contratto, dati da un preventivo PPP
 * Se cambi qualcosa lì, cambialo anche qui: il collaudo (strumenti/confronta_logica.js) controlla che
 * Mac e telefono diano risultati identici. Funziona nel browser (window.LOGICA) e in Node (collaudo). */
(function (radice) {
  'use strict';
  let TESTI = null;                                    // contenuto di testi_contratto.json
  function usaTesti(t) { TESTI = t; }

  // ============================================================ calcoli.py
  const UE = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT',
    'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'];
  const NAZIONI = [
    ['IT', 'Italia', 'Italy'], ['FR', 'Francia', 'France'], ['ES', 'Spagna', 'Spain'],
    ['DE', 'Germania', 'Germany'], ['PT', 'Portogallo', 'Portugal'], ['BE', 'Belgio', 'Belgium'],
    ['NL', 'Paesi Bassi', 'Netherlands'], ['AT', 'Austria', 'Austria'], ['DK', 'Danimarca', 'Denmark'],
    ['SE', 'Svezia', 'Sweden'], ['FI', 'Finlandia', 'Finland'], ['IE', 'Irlanda', 'Ireland'],
    ['LU', 'Lussemburgo', 'Luxembourg'], ['GR', 'Grecia', 'Greece'], ['CY', 'Cipro', 'Cyprus'],
    ['MT', 'Malta', 'Malta'], ['RO', 'Romania', 'Romania'], ['BG', 'Bulgaria', 'Bulgaria'],
    ['PL', 'Polonia', 'Poland'], ['CZ', 'Repubblica Ceca', 'Czech Republic'], ['HU', 'Ungheria', 'Hungary'],
    ['HR', 'Croazia', 'Croatia'], ['SI', 'Slovenia', 'Slovenia'], ['SK', 'Slovacchia', 'Slovakia'],
    ['LT', 'Lituania', 'Lithuania'], ['LV', 'Lettonia', 'Latvia'], ['EE', 'Estonia', 'Estonia'],
    ['GB', 'Regno Unito', 'United Kingdom'], ['CH', 'Svizzera', 'Switzerland'], ['NO', 'Norvegia', 'Norway'],
    ['SM', 'San Marino', 'San Marino'], ['MC', 'Monaco', 'Monaco'], ['AL', 'Albania', 'Albania'],
    ['RS', 'Serbia', 'Serbia'], ['TR', 'Turchia', 'Turkey'], ['SA', 'Arabia Saudita', 'Saudi Arabia'],
    ['AE', 'Emirati Arabi Uniti', 'United Arab Emirates'], ['QA', 'Qatar', 'Qatar'], ['KW', 'Kuwait', 'Kuwait'],
    ['BH', 'Bahrein', 'Bahrain'], ['OM', 'Oman', 'Oman'], ['EG', 'Egitto', 'Egypt'], ['MA', 'Marocco', 'Morocco'],
    ['US', 'Stati Uniti', 'United States'], ['CA', 'Canada', 'Canada'], ['MX', 'Messico', 'Mexico'],
    ['BR', 'Brasile', 'Brazil'], ['AR', 'Argentina', 'Argentina'], ['CN', 'Cina', 'China'],
    ['JP', 'Giappone', 'Japan'], ['KR', 'Corea del Sud', 'South Korea'], ['SG', 'Singapore', 'Singapore'],
    ['IN', 'India', 'India'], ['AU', 'Australia', 'Australia'], ['ZA', 'Sudafrica', 'South Africa'],
  ];
  const MESI_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto',
    'settembre', 'ottobre', 'novembre', 'dicembre'];
  const MESI_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December'];
  const REGIMI_IVA = { forfettario: 'Regime forfettario (senza IVA)', iva: 'Con IVA', estero: 'Cliente estero (non soggetta – reverse charge)' };

  function nazione(codice, lingua) {
    const n = NAZIONI.find(x => x[0] === String(codice || '').toUpperCase());
    if (!n) return codice || '';
    return (lingua || 'it') === 'it' ? n[1] : n[2];
  }
  // come round(x, 2) di Python: arrotonda il valore ESATTO del numero, pari sul mezzo esatto
  function arrotonda(x) {
    x = Number(x);
    if (!isFinite(x)) return 0;
    const neg = x < 0, s = Math.abs(x).toFixed(40);          // cifre decimali esatte
    const [i, d] = s.split('.');
    let cent = BigInt(i) * 100n + BigInt(d.slice(0, 2));
    const resto = d.slice(2);
    if (resto[0] > '5' || (resto[0] === '5' && /[1-9]/.test(resto.slice(1)))) cent += 1n;
    else if (resto[0] === '5' && cent % 2n === 1n) cent += 1n;   // mezzo esatto: pari
    const v = Number(cent) / 100;
    return neg && v !== 0 ? -v : v;
  }
  function num(x) {
    const n = parseFloat(String(x == null ? '' : x).replace(',', '.'));
    return isNaN(n) ? 0 : arrotonda(n);
  }
  function euro(x, lingua) {
    const v = num(x);
    let [i, d] = Math.abs(v).toFixed(2).split('.');
    const sep = (lingua || 'it') === 'it' ? ['.', ','] : [',', '.'];
    i = i.replace(/\B(?=(\d{3})+(?!\d))/g, sep[0]);
    return '€ ' + (v < 0 ? '-' : '') + i + sep[1] + d;
  }
  function _d(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d) ? null : d;
  }
  const iso = d => d.toISOString().slice(0, 10);
  function oggi() { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); }
  function dataBreve(s) {
    const d = _d(s); if (!d) return s || '';
    return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + d.getUTCFullYear();
  }
  function dataLunga(s, lingua) {
    const d = _d(s); if (!d) return s || '';
    return d.getUTCDate() + ' ' + ((lingua || 'it') === 'it' ? MESI_IT : MESI_EN)[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function piuGiorni(s, n) { const d = _d(s); return d ? iso(new Date(d.getTime() + parseInt(n, 10) * 864e5)) : ''; }
  function validita(emissione, evento, giorni, lingua) {
    const dEmi = _d(emissione) || oggi();
    let fine = new Date(dEmi.getTime() + Math.trunc(num(giorni) || 30) * 864e5);
    const dEv = _d(evento);
    if (dEv) {
      const limite = new Date(dEv.getTime() - 7 * 864e5);
      if (limite <= oggi()) return (lingua || 'it') === 'it' ? 'il prima possibile' : 'as soon as possible';
      if (limite < fine) fine = limite;
    }
    return dataLunga(iso(fine), lingua);
  }
  function regimeProposto(E, C) {
    if (String(C.nazione || 'IT').toUpperCase() !== 'IT') return 'estero';
    return E.regime === 'forfettario' ? 'forfettario' : 'iva';
  }
  function conti(p, E) {
    const voci = (p.voci || []).filter(v => String(v.descrizione || '').trim() || num(v.importo));
    const imponibile = arrotonda(voci.reduce((s, v) => s + num(v.importo), 0));
    const regime = p.regime_iva || 'iva';
    const aliquota = regime === 'iva' ? num(p.aliquota_iva != null ? p.aliquota_iva : (E.aliquota_iva != null ? E.aliquota_iva : 22)) : 0;
    const iva = arrotonda(imponibile * aliquota / 100);
    const totale = arrotonda(imponibile + iva);
    const perc = num(p.acconto_perc || 0);
    const acconto = arrotonda(totale * perc / 100);
    return { voci, imponibile, regime, aliquota, iva, totale, acconto_perc: perc, acconto, saldo: arrotonda(totale - acconto) };
  }
  const SALDO = {
    prima: ["entro il giorno dell'evento, prima dell'inizio dello spettacolo", 'on the day of the event, before the start of the performance'],
    '7_prima': ["entro 7 giorni prima della data dell'evento", 'no later than 7 days before the event date'],
    '7_dopo': ["entro 7 giorni dalla data dell'evento", 'within 7 days after the event date'],
    '30_dopo': ["entro 30 giorni dalla data dell'evento", 'within 30 days after the event date'],
  };
  function testoSaldo(p, lingua) {
    const k = p.saldo || '7_dopo';
    if (k === 'altro') return String(p.saldo_testo || '').trim();
    const t = SALDO[k] || SALDO['7_dopo'];
    return (lingua || 'it') === 'it' ? t[0] : t[1];
  }

  // ============================================================ testi.py
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function g(x) { const n = parseFloat(x); return isNaN(n) ? String(x) : String(n); }
  function vero(cond, V) {
    if (!cond) return true;
    return cond.split('&').every(pz => { const neg = pz.startsWith('!'); return !!V[pz.replace(/^!+/, '')] !== neg; });
  }
  const riempi = (t, V) => String(t).replace(/\{(\w+)\}/g, (m, k) => (V[k] == null ? '' : String(V[k])));
  function frase(voce, V, L) {
    if (!vero(voce.se, V)) return '';
    const corpo = voce[L] != null ? voce[L] : (voce.t != null ? voce.t : '');
    if (Array.isArray(corpo)) return corpo.filter(p => vero(p.se, V)).map(p => riempi(p[L] != null ? p[L] : (p.t || ''), V)).join('');
    return riempi(corpo, V);
  }
  const pezzi = (lista, V) => lista.filter(p => vero(p.se, V)).map(p => riempi(p.t || '', V)).join('');
  const riga = (...xs) => xs.filter(x => x).join(', ');
  function indirizzo(x, lingua) {
    lingua = lingua || 'it';
    const via = [x.indirizzo || '', x.civico || ''].filter(v => v).join(' ').trim();
    const luogo = [x.cap || '', x.comune || '', x.provincia ? '(' + x.provincia + ')' : ''].filter(v => v).join(' ');
    const naz = String(x.nazione || 'IT').toUpperCase();
    return riga(via, luogo, (naz !== 'IT' || lingua !== 'it') ? nazione(naz, lingua) : '');
  }
  function dicituraIva(regime, C, L) {
    const D = TESTI.diciture;
    if (regime === 'forfettario') return D.forfettario[L];
    if (regime === 'estero') return D[UE.includes(String(C.nazione || 'IT').toUpperCase()) ? 'estero_ue' : 'estero_extra'][L];
    return '';
  }
  function tipoPredefinito(E, L) { return TESTI.tipo_prestazione[E.tipo === 'asd' ? 'asd' : 'persona'][L]; }
  function tipoPrestazione(S, E, L) {
    const tit = String(S.titolo || '').trim();
    const diSerie = Object.values(TESTI.tipo_prestazione).flatMap(x => Object.values(x));
    return (!tit || diSerie.includes(tit)) ? tipoPredefinito(E, L) : tit;
  }
  function lista(xs, L) {
    if (!xs.length) return '';
    if (xs.length === 1) return xs[0];
    return xs.slice(0, -1).join(', ') + TESTI.liste.e[L] + xs[xs.length - 1];
  }
  function variabili(x) {
    const p = x.p, E = x.E, C = x.C, K = x.K, cond = x.cond, L = x.lingua;
    const S = p.show || {}, ev = p.evento || {}, sp = p.spese || {};
    const privato = C.categoria === 'privato';
    const LS = TESTI.liste;
    const vs = { performer: esc(S.performer || ''), durata: esc(S.durata || ''), uscite: esc(S.uscite || '') };
    const datiShow = ['performer', 'durata', 'uscite'].map((k, i) => S[k] ? riempi(LS.dati_show[L][i], vs) : null).filter(v => v != null);
    const voci3 = ['viaggio', 'vitto', 'alloggio'];
    const inc = voci3.filter(k => sp[k] !== 'cliente').map(k => LS.spese[L][k]);
    const cli = voci3.filter(k => sp[k] === 'cliente').map(k => LS.spese[L][k]);
    const rip = p.riprese || 'social';
    const assic = E.assicurazione || '';
    const nascitaEn = String(E.nascita || '').replace('nato a', 'born in').replace(' il ', ' on ');
    const cfPiva = E.cf === E.piva
      ? (L === 'it' ? 'C.F. e P.IVA ' : 'tax code and VAT no. IT') + esc(E.piva)
      : (L === 'it' ? 'C.F. ' + esc(E.cf) + ' e P.IVA ' + esc(E.piva) : 'tax code ' + esc(E.cf) + ', VAT no. IT' + esc(E.piva));
    return {
      asd: E.tipo === 'asd', nome_E: esc(E.ragione_sociale), ind_E: esc(indirizzo(E, L)),
      cf_E: esc(E.cf), piva_E: esc(E.piva), cf_piva_E: cfPiva,
      rapp_E: esc(E.rappresentante || '______________________'),
      ruolo_firma: esc(E.ruolo_firma || 'legale rappresentante'),
      nascita: esc(E.nascita || ''), nascita_en: esc(nascitaEn),
      privato, nome_C: esc(C.ragione_sociale || '______________________'),
      ind_C: esc(indirizzo(C, L) || '______________________'),
      cf_C: esc(C.cf || ''), piva_C: esc(C.piva || ''),
      cf_C_diverso: !!C.cf && C.cf !== C.piva,
      referente: esc(C.referente || ''), ruolo_ref: esc(C.ruolo_referente || ''),
      numero: esc(p.numero), data_preventivo: dataBreve(p.data_emissione),
      titolo_show: esc(S.titolo || ''), evento_nome: esc(ev.nome || '—'),
      tipo_prestazione: esc(tipoPrestazione(S, E, L)),
      durata: esc(S.durata || ''), uscite: esc(S.uscite || ''),
      luogo: esc(riga(ev.location, ev.indirizzo)),
      dati_show: datiShow.join('; '), descrizione: esc(S.descrizione || ''),
      prove: esc(S.prove || ''), aperto: !!ev.aperto,
      estero: String(C.nazione || 'IT').toUpperCase() !== 'IT',
      imponibile: euro(K.imponibile, L), con_iva: K.regime === 'iva', iva_perc: g(K.aliquota),
      iva: euro(K.iva, L), totale: euro(K.totale, L),
      voci_elenco: K.voci.length > 1 ? K.voci.map(v => esc(v.descrizione) + ': ' + euro(v.importo, L)).join('; ') : '',
      dicitura: dicituraIva(K.regime, C, L),
      inclusi: lista(inc, L), a_carico: lista(cli, L), spese_note: esc(p.spese_note || ''),
      intestatario: esc(E.intestatario), iban: esc(E.iban), swift: esc(E.swift), banca: esc(E.banca),
      acconto: K.acconto_perc > 0, acconto_perc: g(K.acconto_perc), acconto_importo: euro(K.acconto, L),
      giorni_acconto: g(cond.giorni_acconto), saldo_importo: euro(K.saldo, L),
      saldo_testo: esc(testoSaldo(p, L)),
      g1: String(Math.trunc(parseFloat(cond.penale_giorni_1))), g2: String(Math.trunc(parseFloat(cond.penale_giorni_2))),
      p2: g(cond.penale_perc_2), p3: g(cond.penale_perc_3),
      rip_no: rip === 'no', rip_esteso: rip === 'esteso', rip_social: rip !== 'no' && rip !== 'esteso',
      riprese_note: esc(p.riprese_note || ''),
      assicurazione: esc(assic), assic_rcto: assic.includes('RCT/O'),
      non_soll: (p.non_sollecitazione == null ? true : !!p.non_sollecitazione) && !privato,
      ns_mesi: g(cond.non_sollecitazione_mesi), ns_penale: g(cond.non_sollecitazione_penale_perc),
      note_contratto: esc(p.note_contratto || ''), foro: esc(cond.foro || ''),
      team: esc(S.team || ''), esigenze: esc(p.esigenze || ''),
    };
  }
  function articoli(x) {
    const V = variabili(x), L = x.lingua, A = [];
    TESTI.articoli.forEach(a => {
      if (!vero(a.se, V)) return;
      A.push({ k: a.k, titolo: a.titolo[L], par: a.par.map(v => frase(v, V, L)).filter(q => q), programma: !!a.programma });
    });
    A.forEach((a, i) => { a.n = i + 1; });
    return A;
  }
  function premesse(x) {
    const V = variabili(x), P = TESTI.premesse;
    return { titolo: P.titolo[x.lingua], par: P.par.map(v => frase(v, V, x.lingua)) };
  }
  function approvazione(arts, L) {
    const rif = arts.filter(a => TESTI.da_approvare.includes(a.k)).map(a => a.n + ' (' + a.titolo + ')');
    return TESTI.approvazione[L].replace('{rif}', rif.join('; '));
  }
  const parteFornitore = x => pezzi(TESTI.parti.fornitore[x.lingua], variabili(x));
  const parteCliente = x => pezzi(TESTI.parti.cliente[x.lingua], variabili(x));

  // ============================================================ fattura_xml.py
  const SOST = { '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '€': 'EUR', ' ': ' ', '•': '-' };
  function latino(s) {
    return Array.from(String(s)).map(c => {
      if (SOST[c] != null) return SOST[c];
      if (c.codePointAt(0) < 256) return c;
      const base = c.normalize('NFKD').replace(/[^\u0000-ÿ]/g, '');
      return base || '?';
    }).join('');
  }
  const testo = (s, n) => latino(String(s == null ? '' : s).split(/\s+/).filter(x => x).join(' ')).slice(0, n);
  const f2 = x => num(x).toFixed(2);
  function totaliFattura(f) {
    const righe = (f.righe || []).filter(r => String(r.descrizione || '').trim());
    const regime = f.regime_iva || 'iva';
    const aliq = regime === 'iva' ? num(f.aliquota_iva != null ? f.aliquota_iva : 22) : 0;
    const imponibile = arrotonda(righe.reduce((s, r) => s + arrotonda(num(r.quantita || 1) * num(r.prezzo)), 0));
    const iva = arrotonda(imponibile * aliq / 100);
    const totale = arrotonda(imponibile + iva);
    const rit = num(f.ritenuta_estera_perc || 0);
    const daPagare = num(f.importo_pagamento) || arrotonda(totale * (100 - rit) / 100);
    return { righe, regime, aliquota: aliq, imponibile, iva, totale, da_pagare: daPagare };
  }
  const natura = r => ({ forfettario: 'N2.2', estero: 'N2.1' }[r] || '');
  function causale(f) {
    if (String(f.causale || '').trim()) return f.causale.trim();
    return dicituraIva(f.regime_iva || 'iva', f.cliente || {}, 'it');
  }
  const bolloDovuto = (f, E, T) => !!E.bollo_virtuale && T.regime !== 'iva' && T.imponibile > 77.47;

  /** Ritorna {nome, xml}: stesso tracciato FPR12 del Mac (il Mac lo indenta, il contenuto è identico). */
  function fatturaXml(f, E, progressivo) {
    const C = f.cliente || {};
    const T = totaliFattura(f);
    const naz = String(C.nazione || 'IT').toUpperCase();
    const ALF = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const prog = progressivo || Array.from({ length: 5 }, () => ALF[Math.floor(Math.random() * ALF.length)]).join('');
    const x = (s) => latino(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const el = (tag, v) => '<' + tag + '>' + x(v) + '</' + tag + '>';
    const bl = (tag, ...figli) => '<' + tag + '>' + figli.join('') + '</' + tag + '>';
    const sede = (o, nz) => {
      const cap = String(o.cap || '').trim();
      return bl('Sede',
        el('Indirizzo', testo(o.indirizzo || '-', 60)),
        String(o.civico || '').trim() ? el('NumeroCivico', testo(o.civico, 8)) : '',
        el('CAP', nz === 'IT' && /^\d{5}$/.test(cap) ? cap : '00000'),
        el('Comune', testo(o.comune || '-', 60)),
        nz === 'IT' && String(o.provincia || '').trim() ? el('Provincia', o.provincia.trim().toUpperCase().slice(0, 2)) : '',
        el('Nazione', nz));
    };
    // trasmissione
    let dest;
    if (naz !== 'IT') dest = el('CodiceDestinatario', 'XXXXXXX');
    else {
      const sdi = String(C.sdi || '').trim().toUpperCase();
      dest = el('CodiceDestinatario', sdi.length === 7 ? sdi : '0000000') +
        (sdi.length !== 7 && String(C.pec || '').trim() ? el('PECDestinatario', C.pec.trim()) : '');
    }
    const DT = bl('DatiTrasmissione',
      bl('IdTrasmittente', el('IdPaese', 'IT'), el('IdCodice', String(E.cf_trasmittente || E.cf || '').toUpperCase())),
      el('ProgressivoInvio', prog), el('FormatoTrasmissione', 'FPR12'), dest);
    const CP = bl('CedentePrestatore',
      bl('DatiAnagrafici', bl('IdFiscaleIVA', el('IdPaese', 'IT'), el('IdCodice', E.piva)),
        el('CodiceFiscale', String(E.cf).toUpperCase()),
        bl('Anagrafica', el('Denominazione', testo(E.denominazione_xml || E.ragione_sociale, 80))),
        el('RegimeFiscale', E.regime_fiscale_xml || (E.regime === 'forfettario' ? 'RF19' : 'RF01'))),
      sede(E, 'IT'));
    let piva = String(C.piva || '').replace(/ /g, '').toUpperCase();
    if (piva.slice(0, 2) === naz && piva.length > 2 && !/^\d/.test(piva.slice(0, 2))) piva = piva.slice(2);
    let idf = '';
    if (piva) idf = bl('IdFiscaleIVA', el('IdPaese', naz), el('IdCodice', piva.slice(0, 28)));
    else if (naz !== 'IT') idf = bl('IdFiscaleIVA', el('IdPaese', naz), el('IdCodice', '99999999999'));
    const cfC = naz === 'IT' && String(C.cf || '').trim() ? el('CodiceFiscale', C.cf.trim().toUpperCase()) : '';
    const CC = bl('CessionarioCommittente',
      bl('DatiAnagrafici', idf, cfC, bl('Anagrafica', el('Denominazione', testo(C.ragione_sociale, 80)))),
      sede(C, naz));
    // corpo
    let caus = latino(causale(f)), causali = '';
    while (caus) { causali += el('Causale', caus.slice(0, 200)); caus = caus.slice(200); }
    const DG = bl('DatiGeneraliDocumento',
      el('TipoDocumento', f.tipo_documento || 'TD01'), el('Divisa', 'EUR'),
      el('Data', f.data || iso(oggi())), el('Numero', String(f.numero || '1')),
      bolloDovuto(f, E, T) ? bl('DatiBollo', el('BolloVirtuale', 'SI'), el('ImportoBollo', '2.00')) : '',
      el('ImportoTotaleDocumento', f2(T.totale)), causali);
    const nat = natura(T.regime);
    const linee = T.righe.map((r, i) => {
      const q = num(r.quantita || 1) || 1;
      return bl('DettaglioLinee', el('NumeroLinea', i + 1), el('Descrizione', testo(r.descrizione, 1000)),
        el('Quantita', f2(q)), el('PrezzoUnitario', f2(r.prezzo)), el('PrezzoTotale', f2(arrotonda(q * num(r.prezzo)))),
        el('AliquotaIVA', f2(T.aliquota)), nat ? el('Natura', nat) : '');
    }).join('');
    const rif = T.regime === 'forfettario' ? 'Art. 1, c. 54-89, L. 190/2014'
      : 'Art. 7-quinquies DPR 633/72' + (UE.includes(naz) ? ' - reverse charge' : '');
    const riep = bl('DatiRiepilogo', el('AliquotaIVA', f2(T.aliquota)), nat ? el('Natura', nat) : '',
      el('ImponibileImporto', f2(T.imponibile)), el('Imposta', f2(T.iva)),
      !nat ? el('EsigibilitaIVA', 'I') : el('RiferimentoNormativo', rif));
    const DP = bl('DettaglioPagamento',
      el('Beneficiario', testo(E.intestatario || E.ragione_sociale, 200)), el('ModalitaPagamento', 'MP05'),
      el('DataRiferimentoTerminiPagamento', f.data || iso(oggi())),
      f.scadenza ? el('DataScadenzaPagamento', f.scadenza) : '',
      el('ImportoPagamento', f2(T.da_pagare)),
      E.banca ? el('IstitutoFinanziario', testo(E.banca, 80)) : '',
      el('IBAN', String(E.iban).replace(/ /g, '')), E.swift ? el('BIC', E.swift) : '');
    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" versione="FPR12">' +
      bl('FatturaElettronicaHeader', DT, CP, CC) +
      bl('FatturaElettronicaBody', bl('DatiGenerali', DG), bl('DatiBeniServizi', linee, riep),
        bl('DatiPagamento', el('CondizioniPagamento', f.condizioni_pagamento || 'TP02'), DP)) +
      '</p:FatturaElettronica>\n';
    return { nome: 'IT' + E.piva + '_' + prog + '.xml', xml };
  }

  // ============================================================ app.py
  const CAMPI_CLIENTE = ['ragione_sociale', 'indirizzo', 'civico', 'cap', 'comune', 'provincia', 'nazione',
    'categoria', 'piva', 'cf', 'sdi', 'pec', 'referente', 'ruolo_referente', 'email', 'telefono'];
  function clienteVuoto() { const c = {}; CAMPI_CLIENTE.forEach(k => { c[k] = ''; }); c.nazione = 'IT'; c.categoria = 'azienda'; return c; }
  function praticaVuota(imp, emittente, numero) {
    emittente = emittente || 'patrizio';
    const E = imp.emittenti[emittente], cond = imp.condizioni, oggiIso = iso(oggi());
    return {
      id: '', numero: numero || '', anno: oggiIso.slice(0, 4), data_emissione: oggiIso,
      lingua: 'it', emittente, stato: 'bozza',
      cliente: clienteVuoto(),
      evento: { nome: '', location: '', indirizzo: '', aperto: false },
      giorni: [{ data: '', attivita: 'Spettacolo', orario: '' }],
      show: {
        titolo: tipoPredefinito(E, 'it'),
        descrizione: 'Show originale, energico e dinamico che fonde danza, sport e tecnologia, con coreografie dal nostro repertorio e effetti luminosi LED.',
        performer: '', durata: '', uscite: '1', prove: "soundcheck e prova spazio il giorno dell'evento", team: '',
      },
      voci: [{ descrizione: 'Cachet spettacolo', importo: '' }],
      regime_iva: E.regime === 'forfettario' ? E.regime : 'iva',
      aliquota_iva: E.aliquota_iva != null ? E.aliquota_iva : 22,
      spese: { viaggio: 'cliente', vitto: 'cliente', alloggio: 'cliente' }, spese_note: '',
      acconto_perc: cond.acconto_perc, saldo: cond.saldo, saldo_testo: '', validita_giorni: cond.validita_giorni,
      riprese: 'social', riprese_note: '', esigenze: '', note_contratto: '', note_preventivo: '',
    };
  }
  function fatturaVuota(imp, emittente) {
    emittente = emittente || 'patrizio';
    const E = imp.emittenti[emittente];
    return {
      id: '', emittente, numero: String(parseInt(E.ultima_fattura || 0, 10) + 1), data: iso(oggi()),
      tipo_documento: 'TD01', pratica_id: '', cliente: clienteVuoto(),
      righe: [{ descrizione: '', quantita: '1', prezzo: '' }],
      regime_iva: E.regime === 'forfettario' ? 'forfettario' : 'iva', aliquota_iva: E.aliquota_iva != null ? E.aliquota_iva : 22,
      causale: '', condizioni_pagamento: 'TP02', ritenuta_estera_perc: '', importo_pagamento: '', scadenza: '', note: '',
    };
  }
  function fatturaDaPratica(p, quota, imp) {
    const E = imp.emittenti[p.emittente];
    const K = conti(p, E);
    const f = fatturaVuota(imp, p.emittente);
    f.pratica_id = p.id;
    f.cliente = JSON.parse(JSON.stringify(p.cliente || {}));
    f.regime_iva = K.regime; f.aliquota_iva = K.aliquota;
    const ev = p.evento || {};
    const prima = ((p.giorni || []).find(g => g.data) || {}).data || '';
    const en = p.lingua === 'en';
    const tit = (p.show || {}).titolo || tipoPredefinito(E, en ? 'en' : 'it');
    const base = tit.slice(0, 1).toUpperCase() + tit.slice(1) + ' – ' + (ev.nome || '') +
      (ev.location ? ' – ' + ev.location : '') + (prima ? ' – ' + dataBreve(prima) : '') +
      ' (' + (en ? 'contract' : 'contratto') + ' n. ' + p.numero + ')';
    if (quota === 'totale') {
      f.righe = K.voci.map((v, i) => ({ descrizione: i === 0 ? v.descrizione + ' – ' + base : v.descrizione, quantita: '1', prezzo: num(v.importo) }));
    } else {
      const perc = quota === 'acconto' ? K.acconto_perc : 100 - K.acconto_perc;
      const nome = en ? (quota === 'acconto' ? 'Deposit' : 'Balance') : (quota === 'acconto' ? 'Acconto' : 'Saldo');
      f.righe = [{ descrizione: nome + ' ' + g(perc) + '% – ' + base, quantita: '1', prezzo: arrotonda(K.imponibile * perc / 100) }];
      f.tipo_documento = 'TD01';
    }
    f.condizioni_pagamento = 'TP02';
    return f;
  }
  function daPPP(q) {
    const opz = (q.opzioni || []).map((o, i) => {
      const voci = [{ descrizione: q.lingua !== 'en' ? 'Cachet spettacolo' : 'Show fee', importo: o.cachet || 0 }];
      const nc = parseInt(o.coord_n || 0, 10), cc = parseFloat(o.coord_cachet || 0);
      if (nc && cc) voci.push({ descrizione: nc + ' persona/e in più', importo: nc * cc });
      if (parseFloat(o.extra_importo || 0)) voci.push({ descrizione: 'Extra', importo: o.extra_importo });
      (o.voci_extra || []).forEach(v => voci.push({ descrizione: [v.titolo, v.dettagli].filter(x => x).join(' – '), importo: v.costo || 0 }));
      const perf = String(o.n_ballerini || '');
      return {
        nome: 'Opzione ' + String.fromCharCode(65 + i) + ': ' + perf + ' performer · ' + euro(voci.reduce((s, v) => s + num(v.importo), 0)) + (o.consigliata ? ' (consigliata)' : ''),
        show: { durata: o.durata || '', uscite: o.uscite || '' },
        voci,
        spese: { viaggio: o.include_viaggio ? 'incluso' : 'cliente', vitto: o.include_pasti ? 'incluso' : 'cliente', alloggio: o.include_alloggio ? 'incluso' : 'cliente' },
      };
    });
    const t = q.termini || {};
    return {
      lingua: q.lingua || 'it', cliente: q.cliente || '',
      evento: { nome: q.nome_evento || '', location: q.luogo || '' },
      giorni: q.data_evento ? [{ data: q.data_evento, attivita: q.lingua !== 'en' ? 'Spettacolo' : 'Show', orario: '' }] : [],
      show: { descrizione: String(q.descrizione_show || '').replace(/\s*ping pong pang crew\s*/gi, ' ').trim() },
      opzioni: opz, rif: q.numero, numero: q.numero || '',
      acconto_perc: t.acconto_percentuale != null ? t.acconto_percentuale : 30,
      validita_giorni: t.validita_giorni != null ? t.validita_giorni : 30,
      saldo_testo: t.saldo_tempi || '',
    };
  }
  function prossimoNumero(anno, numeri) {
    anno = String(anno); let n = 0;
    numeri.forEach(u => { const m = /^(\d+)\/(\d{4})$/.exec(String(u || '').trim()); if (m && m[2] === anno) n = Math.max(n, parseInt(m[1], 10)); });
    return String(n + 1).padStart(3, '0') + '/' + anno;
  }

  const LOGICA = {
    usaTesti, UE, NAZIONI, REGIMI_IVA, CAMPI_CLIENTE, SALDO,
    nazione, num, arrotonda, euro, dataBreve, dataLunga, piuGiorni, validita, regimeProposto, conti, testoSaldo,
    indirizzo, dicituraIva, tipoPredefinito, tipoPrestazione, variabili, articoli, premesse, approvazione,
    parteFornitore, parteCliente, esc,
    latino, totaliFattura, causale, bolloDovuto, fatturaXml,
    praticaVuota, fatturaVuota, fatturaDaPratica, daPPP, prossimoNumero, iso, oggi,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = LOGICA;
  else radice.LOGICA = LOGICA;
})(typeof window !== 'undefined' ? window : globalThis);
