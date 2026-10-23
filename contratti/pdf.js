/* PDF della mini app Contratti.
 * Usa gli STESSI modelli del Mac (tpl/pdf_*.html, copiati da APP_CONTRATTI/templates) e lo stesso
 * foglio di stile (pdf.css), letti con Nunjucks (stessa sintassi di Jinja). Le pagine A4 vengono
 * impaginate qui e "fotografate" (html2canvas) dentro un PDF (jsPDF). */
(function () {
  'use strict';
  const L_ = window.LOGICA;
  const MM = 96 / 25.4;                                   // px per mm
  const W = Math.round(210 * MM), H = Math.round(297 * MM);  // 794 x 1123
  const MARGINI = { su: 13 * MM, dx: 15 * MM, giu: 16 * MM, sx: 15 * MM };   // come @page di pdf.css
  const ALTEZZA_UTILE = H - MARGINI.su - MARGINI.giu;

  let env = null, css = null;
  async function prepara() {
    if (env) return;
    const testo = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error('manca ' + u); return r.text(); };
    const [prev, contr, fatt, foglio] = await Promise.all(['tpl/pdf_preventivo.html', 'tpl/pdf_contratto.html', 'tpl/pdf_fattura.html', 'pdf.css'].map(testo));
    env = new nunjucks.Environment(null, { autoescape: true });
    env._tpl = { preventivo: prev, contratto: contr, fattura: fatt };
    const fonts = new URL('fonts/', location.href).href;
    css = foglio.replace(/url\("fonts\//g, 'url("' + fonts);
  }
  // stesse funzioni di AIUTI in APP_CONTRATTI/pdf.py
  function aiuti() {
    return {
      g: (x) => { const n = parseFloat(x); return isNaN(n) ? String(x) : String(n); },
      cap: (s) => (s || '').slice(0, 1).toUpperCase() + (s || '').slice(1),
      qta: (r) => L_.num(r.quantita || 1) || 1,
      importo_riga: (r) => L_.arrotonda((L_.num(r.quantita || 1) || 1) * L_.num(r.prezzo)),
    };
  }

  /** Stesso contesto di pdf.contesto() del Mac. */
  function contesto(p0, imp) {
    const E = imp.emittenti[p0.emittente];
    const C = p0.cliente || {};
    const L = p0.lingua || 'it';
    const K = L_.conti(p0, E);
    const giorni = (p0.giorni || []).filter(g => g.data || g.attivita);
    const prima = (giorni.find(g => g.data) || {}).data || '';
    const validita = L_.validita(p0.data_emissione, prima, p0.validita_giorni || 30, L);
    const p = Object.assign({}, p0, { show: Object.assign({}, p0.show || {}, { titolo: L_.tipoPrestazione(p0.show || {}, E, L) }) });
    const x = { p, E, C, K, cond: imp.condizioni, brand: imp.brand, lingua: L };
    const arts = L_.articoli(x);
    return Object.assign({}, x, aiuti(), {
      L, giorni, data_evento: prima, validita,
      articoli: arts, approvazione: L_.approvazione(arts, L), premesse: L_.premesse(x),
      parte_fornitore: L_.parteFornitore(x), parte_cliente: L_.parteCliente(x),
      ind_E: L_.indirizzo(E, L), ind_C: L_.indirizzo(C, L),
      dicitura: L_.dicituraIva(K.regime, C, L), saldo_testo: L_.testoSaldo(p, L),
      euro: (v) => L_.euro(v, L), dl: (s) => L_.dataLunga(s, L), db: L_.dataBreve,
      nazione: (c) => L_.nazione(c, L), stretto: '',
    });
  }
  function contestoFattura(f, imp) {
    const E = imp.emittenti[f.emittente];
    const C = f.cliente || {};
    const T = L_.totaliFattura(f);
    const estero = String(C.nazione || 'IT').toUpperCase() !== 'IT';
    return Object.assign({ f, E, C, T, estero, brand: imp.brand,
      ind_E: L_.indirizzo(E, 'it'), ind_C: L_.indirizzo(C, estero ? 'en' : 'it'),
      causale: L_.causale(f), bollo: L_.bolloDovuto(f, E, T),
      euro: (v) => L_.euro(v, 'it'), db: L_.dataBreve }, aiuti());
  }
  function html(tipo, ctx) { return env.renderString(env._tpl[tipo], ctx); }

  // ------------------------------------------------------------ impaginazione
  const CSS_PAGINE =
    'html,body{margin:0;padding:0;background:#fff}' +
    '.pagina{width:' + W + 'px;height:' + H + 'px;position:relative;background:#fff;overflow:hidden;box-sizing:border-box;' +
    'padding:' + MARGINI.su + 'px ' + MARGINI.dx + 'px ' + MARGINI.giu + 'px ' + MARGINI.sx + 'px}' +
    '.contenuto{height:' + ALTEZZA_UTILE + 'px;overflow:hidden;display:flow-root}' +
    '.piede-pag{position:absolute;left:' + MARGINI.sx + 'px;right:' + MARGINI.dx + 'px;bottom:' + (MARGINI.giu / 2 - 5) + 'px;' +
    'display:flex;justify-content:space-between;font:7pt "Helvetica Neue",Helvetica,Arial,sans-serif;color:#777}' +
    '#flusso{width:' + (W - MARGINI.sx - MARGINI.dx) + 'px;display:flow-root}' +
    // html2canvas spezza male il testo giustificato: sul telefono allineato a sinistra
    '.contratto .art p,.contratto .parti p{text-align:left !important;hyphens:none !important;-webkit-hyphens:none !important}';

  function blocchi(doc) {
    // pezzi "indivisibili": i blocchi del documento; gli articoli del contratto si spezzano per paragrafo
    const out = [];
    Array.from(doc.getElementById('flusso').children).forEach(el => {
      if (el.classList.contains('piede')) return;
      if (el.classList.contains('art') && !/page-break-inside/.test(el.getAttribute('style') || '')) {
        Array.from(el.children).forEach((c, i) => {
          const w = doc.createElement('div'); w.className = 'art'; if (i) w.style.marginTop = '0';
          w.appendChild(c); if (c.tagName === 'H3') w.dataset.conIlSeguente = '1';
          out.push(w);
        });
      } else out.push(el);
    });
    return out;
  }
  function impagina(doc) {
    const flusso = doc.getElementById('flusso');
    const piede = (flusso.querySelector('.piede') || {}).textContent || '';
    const pezzi = blocchi(doc);
    const pagine = [];
    const nuova = () => {
      const pg = doc.createElement('div'); pg.className = 'pagina';
      const c = doc.createElement('div'); c.className = 'contenuto'; pg.appendChild(c);
      doc.body.appendChild(pg); pagine.push(c); return c;
    };
    let cur = nuova();
    pezzi.forEach(b => {
      cur.appendChild(b);
      if (cur.scrollHeight > ALTEZZA_UTILE + 1 && cur.children.length > 1) {
        const sposta = [b];
        const prima = b.previousElementSibling;
        if (prima && prima.dataset.conIlSeguente && cur.children.length > 2) sposta.unshift(prima);
        cur = nuova();
        sposta.forEach(x => cur.appendChild(x));
      }
    });
    flusso.remove();
    pagine.forEach((c, i) => {
      const pd = doc.createElement('div'); pd.className = 'piede-pag';
      pd.innerHTML = '<span></span><span>' + (i + 1) + ' / ' + pagine.length + '</span>';
      pd.firstChild.textContent = piede.trim();
      c.parentNode.appendChild(pd);
    });
    return Array.from(doc.querySelectorAll('.pagina'));
  }

  async function caricaFont(doc) {
    try {
      const ff = new doc.defaultView.FontFace('Anton', 'url(' + new URL('fonts/Anton-Regular.woff2', location.href).href + ') format("woff2")');
      doc.fonts.add(await ff.load());
      await doc.fonts.ready;
    } catch (e) { /* senza Anton si usa il carattere di riserva */ }
  }

  /** Crea il PDF: tipo = 'preventivo' | 'contratto' | 'fattura'. Ritorna {blob, pagine, anteprima}. */
  async function creaPdf(tipo, ctx) {
    await prepara();
    const livelli = tipo === 'preventivo' ? ['', 'stretto', 'strettissimo'] : [''];
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;left:-12000px;top:0;width:' + W + 'px;height:' + H + 'px;border:0;background:#fff';
    document.body.appendChild(iframe);
    try {
      let doc, pagine;
      for (const liv of livelli) {
        let h = html(tipo, Object.assign({}, ctx, { stretto: liv }));
        h = h.replace(/<link rel="stylesheet" href="pdf\.css">/, '<style>' + css + CSS_PAGINE + '</style>')
          .replace(/(<body[^>]*>)/, '$1<div id="flusso">').replace('</body>', '</div><script src="' +
            new URL('vendor/html2canvas.min.js', location.href).href + '"><\/script></body>');
        await new Promise(res => { iframe.onload = res; iframe.srcdoc = h; });
        doc = iframe.contentDocument;
        await caricaFont(doc);
        await new Promise(r => setTimeout(r, 30));
        pagine = impagina(doc);
        if (pagine.length === 1) break;
      }
      const foto = iframe.contentWindow.html2canvas;
      if (!foto) throw new Error('html2canvas non caricato');
      const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
      let anteprima = '';
      for (let i = 0; i < pagine.length; i++) {
        const canvas = await foto(pagine[i], { scale: 2.5, backgroundColor: '#ffffff', logging: false, windowWidth: W, windowHeight: H,
          onclone: async (d2) => { await caricaFont(d2); } });
        const jpg = canvas.toDataURL('image/jpeg', 0.9);
        if (i) pdf.addPage();
        pdf.addImage(jpg, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
        if (!i) anteprima = jpg;
      }
      return { blob: pdf.output('blob'), pagine: pagine.length, anteprima };
    } finally {
      iframe.remove();
    }
  }

  // per il collaudo (Node): modelli e foglio di stile passati a mano
  function usaModelli(tpl, foglio) { env = new nunjucks.Environment(null, { autoescape: true }); env._tpl = tpl; css = foglio; }
  window.CONTRATTI_PDF = { prepara, contesto, contestoFattura, html, creaPdf, usaModelli };
})();
