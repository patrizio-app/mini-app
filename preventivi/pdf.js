/* Mini PPP — generazione PDF del preventivo sull'iPad.
 * Riproduce APP_PPP/templates/pdf_preventivo.html + pdf_generator.py (layout V13,
 * A4 verticale, stesse regole su validità, conferma, IVA e densità tabella).
 * Il PDF viene "fotografato" (html2canvas) e messo in un A4 (jsPDF).
 */
(function () {
  'use strict';

  const MESI_IT = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
  const MESI_EN = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const LETTERE = 'ABCDEFGHIJKLMNOP';
  const GIORNO_MS = 86400000;

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Arrotondamento come Python (metà al pari), per avere le stesse cifre del Mac
  function arrotonda(x) {
    // metà esatta → pari (come Python); altrimenti al più vicino
    const f = Math.floor(x);
    if (x - f === 0.5) return (f % 2 === 0) ? f : f + 1;
    return Math.round(x);
  }

  // '{:,.0f}'.format(x).replace(',', '.')  →  6.500
  function euro0(x) {
    const n = arrotonda(Number(x) || 0);
    const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (n < 0 ? '-' : '') + s;
  }

  function parseIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  function oggiMezzanotte() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }
  function fmtData(d, lang) {
    const mesi = lang === 'en' ? MESI_EN : MESI_IT;
    return String(d.getDate()).padStart(2, '0') + ' ' + mesi[d.getMonth()] + ' ' + d.getFullYear();
  }
  function formattaData(iso, lang) {
    if (!iso) return '';
    const d = parseIso(iso);
    return d ? fmtData(d, lang) : iso;
  }
  function aggiungiGiorni(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }
  function giorniTra(a, b) { // b - a, in giorni interi
    return Math.round((b - a) / GIORNO_MS);
  }

  function calcolaDataConferma(emiIso, eveIso, validita, lang) {
    const dEmi = parseIso(emiIso) || oggiMezzanotte();
    const dStd = aggiungiGiorni(dEmi, parseInt(validita, 10) || 30);
    let dFin = dStd;
    if (eveIso) {
      const dEve = parseIso(eveIso);
      if (dEve) {
        const dMin = aggiungiGiorni(dEve, -7);
        if (dMin <= new Date()) {
          return lang === 'it' ? 'il prima possibile' : 'as soon as possible';
        }
        dFin = dStd < dMin ? dStd : dMin;
      }
    }
    return fmtData(dFin, lang);
  }

  function calcolaGiorniValidita(emiIso, eveIso, validitaDefault) {
    const dEmi = parseIso(emiIso) || oggiMezzanotte();
    if (eveIso) {
      const dEve = parseIso(eveIso);
      if (dEve) {
        const g = giorniTra(dEmi, aggiungiGiorni(dEve, -7));
        if (g < 0) return 0;
        return Math.min(parseInt(validitaDefault, 10), g);
      }
    }
    return parseInt(validitaDefault, 10);
  }

  function totaleOpzione(op) {
    let t = Number(op.cachet) || 0;
    const nCoord = parseInt(op.coord_n, 10) || 0;
    if (nCoord > 0) t += nCoord * (Number(op.coord_cachet) || 0);
    t += Number(op.extra_importo) || 0;
    (op.voci_extra || []).forEach(v => { t += Number(v.costo) || 0; });
    return t;
  }

  function nomeFile(prev) {
    const lang = prev.lingua || 'it';
    const cliente = (prev.cliente || 'preventivo').split('')
      .filter(c => /[\p{L}\p{N} _-]/u.test(c)).join('').trim().replace(/ /g, '_').slice(0, 30);
    const num = (prev.numero || 'PREV').replace(/\//g, '-');
    return num + '_' + cliente + '_' + lang.toUpperCase() + '.pdf';
  }

  /** Corpo HTML della pagina: traduzione 1:1 del modello Jinja di PPP. */
  function corpoHtml(prev, cfg, assetsUrl) {
    const lang = prev.lingua === 'en' ? 'en' : 'it';
    const L = cfg.pdf_labels[lang] || cfg.pdf_labels.it;
    const brand = cfg.brand;
    const cosaIncl = cfg.cosa_includiamo[lang] || [];
    const extraDisp = cfg.extra_disponibili[lang] || [];
    const T = cfg.termini;

    const opzioni = (prev.opzioni || []).map(op => {
      const totale = totaleOpzione(op);
      const nCoord = parseInt(op.coord_n, 10) || 0;
      const voci = op.voci_extra || [];
      const vociTot = voci.reduce((s, v) => s + (Number(v.costo) || 0), 0);
      return Object.assign({}, op, {
        totale: totale,
        prestazione: Math.round((totale - vociTot) * 100) / 100,
        voci_extra: voci,
        has_voci: voci.length > 0,
        n_coord: nCoord,
        show_coord: nCoord > 0,
        coord_label: nCoord === 1 ? L.persona_in_piu : L.persone_in_piu,
      });
    });

    const emiIso = prev.data_emissione || '';
    const eveIso = prev.data_evento || '';
    const dataEmissione = formattaData(emiIso || isoOggi(), lang);
    const dataEvento = eveIso ? formattaData(eveIso, lang) : '';
    const termini = prev.termini || {};
    const validitaDefault = parseInt(termini.validita_giorni, 10) || T.validita_giorni;
    const validitaGiorni = calcolaGiorniValidita(emiIso, eveIso, validitaDefault);
    const accontoPerc = parseInt(termini.acconto_percentuale, 10) || T.acconto_percentuale;
    const saldoTempi = termini.saldo_tempi || (lang === 'it' ? T.saldo_tempi_it : T.saldo_tempi_en);
    const dataConferma = calcolaDataConferma(emiIso, eveIso, validitaDefault, lang);
    const almenoUnaIva = (prev.opzioni || []).some(op => op.mostra_iva);
    const ivaLabel = almenoUnaIva ? L.tutti_iva : L.tutti_no_iva;
    const mostraIncl = prev.mostra_includiamo !== false;
    const mostraExtra = prev.mostra_extra !== false;
    const layout = prev.layout === 'tabella' ? 'tabella' : 'cards';
    const showday = prev.showday || '';
    const anno = prev.anno || String(cfg.anno_default);

    const n = opzioni.length;
    const density = n <= 4 ? 'few' : n <= 7 ? 'medium' : n <= 11 ? 'many' : 'lots';
    const h = [];

    h.push('<div class="page density-' + density + '">');
    h.push('<div class="head-bar"><div class="left">' +
      '<img src="' + assetsUrl + '/logo_white.png">' +
      '<div class="crew">PING PONG PANG<small>' + esc(L.header_quotation) + ' ' + esc(anno) + '</small></div>' +
      '</div><div class="right">' +
      '<span class="label">' + esc(L.n_preventivo) + '</span> <strong>' + esc(prev.numero) + '</strong><br>' +
      '<span class="date">' + esc(dataEmissione) + '</span></div></div>');

    h.push('<div class="meta-bar">' +
      cella(L.cliente, prev.cliente || '—') +
      cella(L.evento, prev.nome_evento || (dataEvento || '—')) +
      cella(L.location, prev.luogo || '—') +
      cella(L.validita, validitaGiorni + ' ' + L.giorni) + '</div>');

    h.push('<div class="body">');
    h.push('<div class="show"><div class="kicker">' + esc(L.the_performance) + '</div>' +
      '<h2>' + esc(prev.titolo_show) + '</h2><p>' + esc(prev.descrizione_show) + '</p></div>');

    if (mostraIncl) {
      const meta = Math.floor(cosaIncl.length / 2) + cosaIncl.length % 2;
      h.push('<div class="includes-strip"><div class="label-strip">' + esc(L.cosa_includiamo) + '</div>' +
        '<div class="includes-cols"><ul>' + cosaIncl.slice(0, meta).map(v => '<li>' + esc(v) + '</li>').join('') +
        '</ul><ul>' + cosaIncl.slice(meta).map(v => '<li>' + esc(v) + '</li>').join('') + '</ul></div></div>');
    }

    let titolo = L.opzioni;
    if (layout === 'tabella') titolo = L.listino;
    else if (opzioni.length === 1) titolo = L.cachet_singolo;
    h.push('<div class="sec-title-row">' +
      (showday ? '<span class="showday-badge">' + esc(L.showday) + ' ' + esc(showday) + '</span>' : '') +
      '<h2>' + esc(titolo) + '</h2><div class="iva-note">' + esc(ivaLabel) + '</div></div>');

    const inc = (flag) => flag ? L.incluso : L.a_carico_cliente;

    if (layout === 'tabella') {
      h.push('<table class="price-table"><thead><tr>' +
        '<th class="num">' + esc(L.ballerini) + '</th><th>' + esc(L.durata) + '</th>' +
        '<th class="num">' + esc(L.uscite) + '</th><th class="fee">' + esc(L.prezzo) + '</th></tr></thead><tbody>');
      let prevDancers = null; let tier = 0;
      opzioni.forEach(op => {
        if (op.n_ballerini !== prevDancers) {
          tier += 1; prevDancers = op.n_ballerini;
          h.push('<tr class="tier-sep"><td colspan="4"><span class="tier-label-num">' + esc(op.n_ballerini) +
            '</span>' + esc(L.ballerini) + '</td></tr>');
        }
        h.push('<tr class="' + (op.consigliata ? 'recommended ' : '') + 'tier-' + tier + '">' +
          '<td class="spec-cell">' + esc(op.n_ballerini || '—') +
          (op.show_coord ? '<span class="coord-note">+' + op.n_coord + ' Coord.</span>' : '') + '</td>' +
          '<td>' + esc(op.durata || '—') + '</td>' +
          '<td class="spec-cell">' + esc(op.uscite || '—') + '</td>' +
          '<td class="fee-cell">' + (op.consigliata ? '<span class="reco-tag">' + esc(L.consigliata) + '</span>' : '') +
          '€ ' + euro0(op.totale) + (op.mostra_iva ? '<span class="fee-iva">' + esc(L.iva_suffix) + '</span>' : '') +
          '</td></tr>');
      });
      h.push('</tbody></table>');
      if (opzioni.length) {
        const o = opzioni[0];
        h.push('<div class="table-ie-note"><strong>' + esc(L.viaggio) + ':</strong> ' + esc(inc(o.include_viaggio)) + ' · ' +
          '<strong>' + esc(L.pasti) + ':</strong> ' + esc(inc(o.include_pasti)) + ' · ' +
          '<strong>' + esc(L.alloggio) + ':</strong> ' + esc(inc(o.include_alloggio)) + '</div>');
      }
    } else {
      opzioni.forEach((op, i) => {
        h.push('<div class="option ' + (op.consigliata ? 'recommended' : '') + '"><div class="option-top">' +
          '<div class="opt-letter-cell"><span class="opt-letter">' + LETTERE[i] + '</span></div>' +
          '<div class="opt-body">' +
          spec(L.ballerini, op.n_ballerini || '—') + '<div class="spec-sep"></div>' +
          spec(L.durata, op.durata || '—') + '<div class="spec-sep"></div>' +
          spec(L.uscite, op.uscite || '—') +
          (op.show_coord ? '<div class="spec-sep"></div><div class="spec spec-extra"><span class="spec-label">' +
            esc(op.coord_label) + '</span><span class="spec-val green">' + op.n_coord + ' Coordinator</span></div>' : '') +
          '</div><div class="price-cell"><span class="price">€ ' + euro0(op.prestazione) + '</span>' +
          (op.mostra_iva ? '<span class="price-iva">' + esc(L.iva_suffix) + '</span>' : '') + '</div></div>');
        if (op.has_voci) {
          h.push('<div class="opt-costi">');
          op.voci_extra.forEach(v => {
            h.push('<div class="opt-costi-row"><span class="opt-costi-voce"><strong>' + esc(v.titolo) + '</strong>' +
              (v.dettagli ? '<span class="opt-costi-dett"> — ' + esc(v.dettagli) + '</span>' : '') +
              '</span><span class="opt-costi-prezzo">€ ' + euro0(v.costo) + '</span></div>');
          });
          h.push('<div class="opt-costi-row opt-costi-tot"><span class="opt-costi-voce">' + (lang === 'en' ? 'Total' : 'Totale') +
            '</span><span class="opt-costi-prezzo">€ ' + euro0(op.totale) +
            (op.mostra_iva ? '<span class="opt-costi-iva">' + esc(L.iva_suffix) + '</span>' : '') + '</span></div></div>');
        }
        h.push('<div class="option-bottom">' +
          ie(L.viaggio, op.include_viaggio) + ie(L.pasti, op.include_pasti) + ie(L.alloggio, op.include_alloggio) +
          '</div></div>');
      });
    }

    if (mostraExtra) {
      h.push('<div class="extra-strip"><div class="label">' + esc(L.extra_disponibili) + '</div><ul>' +
        extraDisp.map(e => '<li><strong>' + esc(e.titolo) + '</strong> — ' + esc(e.desc) + '</li>').join('') +
        '</ul></div>');
    }
    h.push('</div>'); // .body

    h.push('<div class="terms-strip">' +
      termine(L.validita_label, validitaGiorni + ' ' + L.giorni) +
      termine(L.conferma_entro, dataConferma || '—') +
      termine(L.acconto, accontoPerc + '% ' + L.alla_firma) +
      termine(L.saldo, saldoTempi) + '</div>');
    h.push('<div class="foot-bar"><span><strong>Ping Pong Pang Crew</strong> · ' + esc(brand.sito) + ' · ' +
      esc(brand.email) + ' · ' + esc(brand.telefono) + '</span><span class="green">© ' + esc(anno) + '</span></div>');
    h.push('</div>');
    return h.join('');

    function cella(lbl, val) {
      return '<div class="cell"><div class="label">' + esc(lbl) + '</div><div class="val">' + esc(val) + '</div></div>';
    }
    function spec(lbl, val) {
      return '<div class="spec"><span class="spec-label">' + esc(lbl) + '</span><span class="spec-val">' + esc(val) + '</span></div>';
    }
    function ie(lbl, flag) {
      return '<div class="ie-cell"><span class="ie-label">' + esc(lbl) + '</span><span class="ie-status ' +
        (flag ? 'in' : 'out') + '">' + esc(inc(flag)) + '</span></div>';
    }
    function termine(lbl, val) {
      return '<div><div class="label">' + esc(lbl) + '</div><div class="val">' + esc(val) + '</div></div>';
    }
  }

  function isoOggi() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Piccole correzioni perché il browser impagini come il motore di PPP (WeasyPrint):
  // - WeasyPrint non "inclina" da solo il font Anton (che non ha il corsivo): qui
  //   dichiariamo lo stesso file anche come corsivo, così il browser non lo deforma;
  // - WeasyPrint non applica l'altezza minima della griglia delle opzioni;
  // - WeasyPrint disegna le pillole Incluso/A carico un po' più larghe (misurato).
  function CORREZIONI_CSS(assetsUrl) {
    return "\n@font-face{font-family:'Anton';font-style:italic;font-weight:400;" +
      "src:url('" + assetsUrl + "/Anton-Regular.woff2') format('woff2'),url('" + assetsUrl + "/Anton-Regular.woff') format('woff');}" +
      "\n.option-top{min-height:0;}" +
      "\n.option-bottom .ie-status{padding-left:calc(2mm + 7px);padding-right:calc(2mm + 10px);}\n";
  }

  function documentoHtml(prev, cfg, conScript) {
    const assetsUrl = new URL('assets', location.href).href.replace(/\/$/, '');
    const lang = prev.lingua === 'en' ? 'en' : 'it';
    const L = cfg.pdf_labels[lang] || cfg.pdf_labels.it;
    const css = window.PDF_CSS.split('__ASSETS__').join(assetsUrl)
      .split('__CONSIGLIATA__').join(String(L.consigliata).replace(/'/g, "\\'")) + CORREZIONI_CSS(assetsUrl);
    const h2c = new URL('vendor/html2canvas.min.js', location.href).href;
    return '<!DOCTYPE html><html lang="' + lang + '"><head><meta charset="utf-8"><style>' + css +
      '</style></head><body>' + corpoHtml(prev, cfg, assetsUrl) +
      (conScript ? '<script src="' + h2c + '"><\/script>' : '') + '</body></html>';
  }

  // Il font Anton deve essere caricato anche nella pagina principale: è lì che
  // html2canvas disegna il testo. Senza, i titoli escono col font sbagliato.
  let antonPronto = null;
  function caricaAnton(doc) {
    const url = new URL('assets/Anton-Regular.woff2', location.href).href;
    const W = doc.defaultView;
    const facce = ['normal', 'italic'].map(stile =>
      new W.FontFace('Anton', 'url(' + url + ') format("woff2")', { style: stile, weight: '400' }));
    return Promise.all(facce.map(ff => ff.load().then(f => { doc.fonts.add(f); })));
  }

  /** Crea il PDF. Ritorna {blob, nome, anteprima (dataURL jpeg)}. */
  async function creaPdf(prev, cfg) {
    if (!antonPronto) antonPronto = caricaAnton(document).catch(() => { antonPronto = null; });
    await antonPronto;
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;left:-12000px;top:0;width:794px;height:1123px;border:0;background:#fff;';
    document.body.appendChild(iframe);
    try {
      await new Promise((resolve) => {
        iframe.onload = resolve;
        iframe.srcdoc = documentoHtml(prev, cfg, true);
      });
      const doc = iframe.contentDocument;
      // aspetta font Anton e logo
      try {
        await caricaAnton(doc);
        await doc.fonts.load("italic 20pt 'Anton'");
        await doc.fonts.ready;
      } catch (e) { /* ignora */ }
      await Promise.all(Array.from(doc.images).map(img => img.complete ? null :
        new Promise(r => { img.onload = r; img.onerror = r; })));
      await new Promise(r => setTimeout(r, 60));

      const pagina = doc.querySelector('.page');
      // Il "fotografo" (html2canvas) lavora DENTRO la finestra del preventivo:
      // così misura i testi con gli stessi caratteri con cui sono impaginati.
      const fotografo = iframe.contentWindow.html2canvas;
      if (!fotografo) throw new Error('html2canvas non caricato');
      const canvas = await fotografo(pagina, {
        scale: 3,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        windowWidth: 794,
        windowHeight: 1123,
        // html2canvas lavora su una COPIA della pagina: anche lì il font Anton deve
        // essere caricato prima di misurare le posizioni, altrimenti i testi grandi
        // finiscono spostati in basso.
        onclone: async (copiaDoc) => {
          try {
            await caricaAnton(copiaDoc);
            await copiaDoc.fonts.load("italic 20pt 'Anton'");
            await copiaDoc.fonts.ready;
            copiaDoc.body.offsetHeight; // forza il ricalcolo dell'impaginazione
          } catch (e) { /* ignora */ }
        },
      });
      const jpeg = canvas.toDataURL('image/jpeg', 0.92);
      const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
      pdf.setProperties({ title: prev.numero || 'Preventivo', author: 'Ping Pong Pang Crew' });
      pdf.addImage(jpeg, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      const blob = pdf.output('blob');
      return { blob: blob, nome: nomeFile(prev), anteprima: jpeg };
    } finally {
      iframe.remove();
    }
  }

  window.PPP_PDF = {
    creaPdf: creaPdf,
    totaleOpzione: totaleOpzione,
    euro0: euro0,
    documentoHtml: documentoHtml,
    nomeFile: nomeFile,
    formattaData: formattaData,
  };
})();
