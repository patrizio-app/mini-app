/* =====================================================================
   MINI APP LED — cose del telefono/iPad attorno all'editor del Mac:
   - messaggi (toast) e "scarica file" → finestra "File pronto: Condividi / Salva"
   - pagine aperte dentro la app (mappa formazioni → STAMPA = salva PDF)
   - DITO = MOUSE su onda, mini-onda, palco e barra dell'anteprima
   - due dita sull'onda = zoom/scorrimento (su iPad lo fa già Safari)
   - BARRA COMANDI con i tasti che sul Mac si fanno da tastiera
   ===================================================================== */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ───────────────────────── messaggi (come app.js del Mac) ─────────────────────────
  let toastTimer = null;
  window.toast = function (msg, kind, ms) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show ' + (kind === 'err' ? 'err' : kind === 'ok' ? 'ok' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms || 3500);
  };

  // ───────────────────────── finestre della mini app ─────────────────────────
  function finestra(html, largo) {
    chiudiFinestra();
    const ov = document.createElement('div');
    ov.className = 'mini-ov' + (largo ? ' largo' : '');
    ov.id = 'mini-ov';
    ov.innerHTML = '<div class="mini-box">' + html + '</div>';
    ov.addEventListener('click', (e) => { if (e.target === ov) chiudiFinestra(); });
    document.body.appendChild(ov);
    return ov;
  }
  function chiudiFinestra() { const o = $('#mini-ov'); if (o) o.remove(); }

  async function condividi(blob, nome, tipo) {
    const file = new File([blob], nome, { type: tipo || blob.type || 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: nome }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /* File pronto: il pulsante serve perché "Condividi" va aperto da un tocco */
  function offriFile(blob, nome, tipo, titolo, nota) {
    const ov = finestra(
      '<div class="mini-h">' + esc(titolo || 'File pronto') + '</div>' +
      '<p class="mini-nome">' + esc(nome) + ' · ' + Math.max(1, Math.round(blob.size / 1024)) + ' KB</p>' +
      (nota ? '<p class="mini-nota">' + esc(nota) + '</p>' : '') +
      '<div class="mini-btns"><button class="mini-btn primario" id="mini-condividi">CONDIVIDI / SALVA</button>' +
      '<button class="mini-btn" id="mini-chiudi">CHIUDI</button></div>');
    $('#mini-condividi', ov).addEventListener('click', () => condividi(blob, nome, tipo));
    $('#mini-chiudi', ov).addEventListener('click', chiudiFinestra);
  }
  window.downloadBlob = function (blob, nome) { offriFile(blob, nome, blob.type, 'File pronto'); };

  /* Pagina dentro la app (es. mappa formazioni): STAMPA → nel menu di stampa si salva in PDF */
  function apriPagina(html, titolo) {
    const ov = finestra(
      '<div class="mini-pag-bar"><b>' + esc(titolo || '') + '</b>' +
      '<span class="mini-nota">STAMPA → nel menu scegli "Salva come PDF" / "Condividi"</span>' +
      '<button class="mini-btn primario" id="mini-stampa">STAMPA / PDF</button>' +
      '<button class="mini-btn" id="mini-chiudi">CHIUDI</button></div>' +
      '<iframe class="mini-pag" id="mini-pag"></iframe>', true);
    const fr = $('#mini-pag', ov);
    fr.srcdoc = html;
    $('#mini-stampa', ov).addEventListener('click', () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { window.print(); } });
    $('#mini-chiudi', ov).addEventListener('click', chiudiFinestra);
  }

  window.MiniApp = { offriFile, apriPagina, condividi, chiudiFinestra };

  // ───────────────────────── DITO = MOUSE ─────────────────────────
  const AREE = '#aa-canvas, #aa-mini, #co-stage, #co-ap-barra';
  const stato = { shift: false, trascino: null, ultimoTap: 0, ultimoXY: null, dueDita: null };
  const nativoGesti = 'ongesturestart' in window;          // Safari (iPad/iPhone): pizzico già gestito

  function mouse(tipo, bersaglio, punto, extra) {
    const ev = new MouseEvent(tipo, Object.assign({
      bubbles: true, cancelable: true, view: window, button: 0, buttons: tipo === 'mouseup' ? 0 : 1,
      clientX: punto.clientX, clientY: punto.clientY, screenX: punto.screenX, screenY: punto.screenY,
      shiftKey: stato.shift,
    }, extra || {}));
    (bersaglio || document.body).dispatchEvent(ev);
  }
  const sotto = (p) => document.elementFromPoint(p.clientX, p.clientY);

  document.addEventListener('touchstart', (e) => {
    const area = e.target.closest && e.target.closest(AREE);
    if (!area) return;
    if (e.touches.length === 2 && area.id === 'aa-canvas' && !nativoGesti) {   // Android: zoom/scorri onda
      e.preventDefault();
      if (stato.trascino) { mouse('mouseup', stato.trascino.el, stato.trascino.p); stato.trascino = null; }
      const [a, b] = e.touches;
      stato.dueDita = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
      return;
    }
    if (e.touches.length !== 1) return;
    e.preventDefault();
    const p = e.touches[0];
    const el = sotto(p) || e.target;
    // doppio tocco sul palco = doppio clic (apre il menu della racchetta)
    const ora = Date.now();
    const doppio = area.id === 'co-stage' && ora - stato.ultimoTap < 350 && stato.ultimoXY &&
      Math.hypot(p.clientX - stato.ultimoXY[0], p.clientY - stato.ultimoXY[1]) < 25;
    stato.ultimoTap = ora; stato.ultimoXY = [p.clientX, p.clientY];
    stato.trascino = { el, p, area };
    // Il browser manda i movimenti del dito all'elemento toccato all'INIZIO. Se l'editor lo
    // ridisegna (succede col palco), quell'elemento esce dalla pagina e i movimenti non arrivano
    // più al documento: li ascolto direttamente su di lui.
    const t0 = e.target;
    const suMossa = (ev) => { ev._mini = true; muovi(ev); };
    const suFine = (ev) => {
      ev._mini = true; fineTocco(ev);
      t0.removeEventListener('touchmove', suMossa); t0.removeEventListener('touchend', suFine); t0.removeEventListener('touchcancel', suFine);
    };
    t0.addEventListener('touchmove', suMossa, { passive: false });
    t0.addEventListener('touchend', suFine, { passive: false });
    t0.addEventListener('touchcancel', suFine, { passive: false });
    mouse('mousedown', el, p);
    if (doppio) { mouse('mouseup', el, p); mouse('dblclick', el, p, { detail: 2 }); stato.trascino = null; }
  }, { passive: false });

  function muovi(e) {
    if (stato.dueDita && e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const x = (a.clientX + b.clientX) / 2, y = (a.clientY + b.clientY) / 2;
      const wrap = document.getElementById('aa-canvas-wrap');
      if (wrap) {
        const fattore = d / stato.dueDita.d;
        if (Math.abs(fattore - 1) > 0.02) {
          wrap.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, ctrlKey: true, deltaY: -Math.log(fattore) / 0.012 }));
          stato.dueDita.d = d;
        }
        const dx = stato.dueDita.x - x;
        if (Math.abs(dx) > 1) {
          wrap.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaX: dx, deltaY: 0 }));
          stato.dueDita.x = x;
        }
      }
      return;
    }
    if (!stato.trascino) return;
    e.preventDefault();
    const p = e.touches[0];
    stato.trascino.p = p;
    mouse('mousemove', sotto(p) || stato.trascino.el, p);
  }
  document.addEventListener('touchmove', (e) => { if (!e._mini) muovi(e); }, { passive: false });

  function fineTocco(e) {
    if (stato.dueDita && e.touches.length < 2) stato.dueDita = null;
    if (!stato.trascino) return;
    const p = (e.changedTouches && e.changedTouches[0]) || stato.trascino.p;
    mouse('mouseup', sotto(p) || stato.trascino.el, p);
    stato.trascino = null;
  }
  document.addEventListener('touchend', (e) => { if (!e._mini) fineTocco(e); }, { passive: false });
  document.addEventListener('touchcancel', (e) => { if (!e._mini) fineTocco(e); }, { passive: false });

  // ───────────────────────── BARRA COMANDI (i tasti del Mac) ─────────────────────────
  function tasto(key, opz) {
    opz = opz || {};
    const code = key === ' ' ? 'Space' : (key.length === 1 ? 'Key' + key.toUpperCase() : key);
    const ev = new KeyboardEvent('keydown', {
      key, code, bubbles: true, cancelable: true,
      shiftKey: !!opz.shift || (opz.usaShift && stato.shift), metaKey: !!opz.meta, ctrlKey: !!opz.meta, altKey: !!opz.alt,
    });
    (document.activeElement && document.activeElement !== document.body && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)
      ? document.body : document).dispatchEvent(ev);
    if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) document.activeElement.blur();
  }

  const COMANDI = [
    // [etichetta, azione, titolo, gruppo]
    ['▶ / ❚❚', () => tasto(' '), 'play / pausa (spazio)', 'musica'],
    ['■', () => tasto('Escape'), 'stop (Esc)', 'musica'],
    ['＋ MARKER', () => tasto('m'), 'marker nel punto che sta suonando (M)', 'musica'],
    ['◀ 10ms', () => tasto('ArrowLeft', { usaShift: true }), 'indietro (con SELEZIONE MULTIPLA attiva: 100 ms)', 'musica'],
    ['10ms ▶', () => tasto('ArrowRight', { usaShift: true }), 'avanti (con SELEZIONE MULTIPLA attiva: 100 ms)', 'musica'],
    ['⇤ MARKER', () => tasto('['), 'marker precedente ( [ )', 'marker'],
    ['MARKER ⇥', () => tasto(']'), 'marker successivo ( ] )', 'marker'],
    ['✕ MARKER', () => tasto('Delete'), 'elimina i marker selezionati sull\'onda', 'marker'],
    ['INTERPOLA', () => tasto('i'), 'con 2 marker selezionati: marker in mezzo (I)', 'marker'],
    ['⟲ ANNULLA', () => tasto('z', { meta: true }), 'annulla (⌘Z)', 'modifica'],
    ['⟳ RIPETI', () => tasto('z', { meta: true, shift: true }), 'ripeti (⇧⌘Z)', 'modifica'],
    ['TUTTE', () => tasto('a'), 'seleziona tutte le racchette (A)', 'racchette'],
    ['BUIO', () => tasto('b'), 'BUIO alle selezionate (B)', 'racchette'],
    ['CANCELLA', () => tasto('x'), 'cancella l\'effetto delle selezionate (X)', 'racchette'],
    ['COPIA EFF.', () => tasto('c', { meta: true }), 'copia l\'effetto della racchetta selezionata (⌘C)', 'racchette'],
    ['INCOLLA EFF.', () => tasto('v', { meta: true }), 'incolla l\'effetto sulle selezionate (⌘V)', 'racchette'],
    ['COPIA FORMAZ.', () => tasto('c', { meta: true, shift: true }), 'copia la formazione (⇧⌘C)', 'racchette'],
    ['INCOLLA FORMAZ.', () => tasto('v', { meta: true, shift: true }), 'incolla la formazione (⇧⌘V)', 'racchette'],
    ['GRIGLIA', () => tasto('g'), 'griglia sul palco (G)', 'racchette'],
    ['ASSEGNA', () => tasto('Enter'), 'assegna l\'effetto (Invio)', 'racchette'],
  ];

  function costruisciBarra() {
    if ($('#mini-barra')) return;
    const barra = document.createElement('div');
    barra.id = 'mini-barra';
    barra.className = 'mini-barra';
    barra.innerHTML =
      '<button class="mini-k mini-shift" id="mini-shift" title="come tenere premuto ⇧ sul Mac: aggiunge alla selezione">⇧ SELEZIONE MULTIPLA</button>' +
      COMANDI.map((c, i) => '<button class="mini-k" data-k="' + i + '" title="' + esc(c[2]) + '">' + esc(c[0]) + '</button>').join('') +
      '<button class="mini-k mini-nascondi" id="mini-nascondi" title="nascondi la barra">▾</button>';
    document.body.appendChild(barra);
    const mostra = document.createElement('button');
    mostra.id = 'mini-mostra'; mostra.className = 'mini-mostra'; mostra.textContent = '⌨ COMANDI';
    mostra.style.display = 'none';
    document.body.appendChild(mostra);

    barra.addEventListener('pointerdown', (e) => e.preventDefault());   // il tocco sulla barra non toglie la selezione
    barra.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'mini-shift') {
        stato.shift = !stato.shift;
        b.classList.toggle('on', stato.shift);
        return;
      }
      if (b.id === 'mini-nascondi') { barra.style.display = 'none'; mostra.style.display = ''; document.body.classList.remove('con-barra'); return; }
      const c = COMANDI[+b.dataset.k];
      if (c) c[1]();
    });
    mostra.addEventListener('click', () => { barra.style.display = ''; mostra.style.display = 'none'; document.body.classList.add('con-barra'); });
    document.body.classList.add('con-barra');
  }

  // la barra serve solo con il dito (su un computer con tastiera non compare)
  const touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (touch) document.addEventListener('DOMContentLoaded', costruisciBarra);
  window.MiniTouch = { stato, tasto, costruisciBarra };
})();
