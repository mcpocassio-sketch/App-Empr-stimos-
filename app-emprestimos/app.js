/* Meus Empréstimos — controle de empréstimos pessoais
 * HTML/CSS/JS puro, dados salvos no localStorage do navegador.
 * Quando aberto como Artifact no Claude, também sincroniza com o armazenamento
 * privado da conta (capacidade `db`) e usa a capacidade `downloads` para exportar.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'emprestimos.dados.v1';
  const PASS_KEY = 'emprestimos.senha.v1';
  const SESSION_KEY = 'emprestimos.sessao';
  const METODO_KEY = 'emprestimos.metodoLucro';

  const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const MESES_LONGO = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  const STATUS_LABEL = {
    'em-dia': 'Em dia',
    'atrasado': 'Atrasado',
    'quitado': 'Quitado',
    'calote': 'Calote'
  };
  const PARCELA_LABEL = {
    'paga': 'Paga',
    'parcial': 'Parcial',
    'vencida': 'Vencida',
    'a-vencer': 'A vencer'
  };

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtMoney = (v) => brl.format(round2(v || 0));
  const num2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtNum = (v) => num2.format(round2(v || 0));
  const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
  const EPS = 0.005;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** Aceita "1.234,56", "1234,56", "1234.56", "R$ 1.234,56". */
  function parseMoney(str) {
    if (typeof str === 'number') return str;
    let s = String(str || '').replace(/[R$\s]/g, '').trim();
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return isFinite(n) ? round2(n) : NaN;
  }

  function moneyInput(v) {
    return v == null || v === '' ? '' : round2(v).toFixed(2).replace('.', ',');
  }

  function todayISO() {
    const d = new Date();
    return toISO(d);
  }

  function toISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function fromISO(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function fmtDate(s) {
    if (!s) return '—';
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }

  /** Soma meses mantendo o dia (ajusta para o último dia do mês quando necessário). */
  function addMonths(iso, n) {
    const d = fromISO(iso);
    const day = d.getDate();
    const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, lastDay));
    return toISO(target);
  }

  function isValidISO(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2500);
  }

  // localStorage/sessionStorage podem falhar (navegação privada, bloqueio de dados).
  const store = {
    get(k, area) { try { return (area || localStorage).getItem(k); } catch (_) { return null; } },
    set(k, v, area) { try { (area || localStorage).setItem(k, v); return true; } catch (_) { return false; } },
    del(k, area) { try { (area || localStorage).removeItem(k); } catch (_) { /* ignora */ } }
  };
  const session = {
    get: (k) => { try { return store.get(k, sessionStorage); } catch (_) { return null; } },
    set: (k, v) => { try { store.set(k, v, sessionStorage); } catch (_) { /* ignora */ } },
    del: (k) => { try { store.del(k, sessionStorage); } catch (_) { /* ignora */ } }
  };

  /**
   * Janela de escolha dentro da página (substitui confirm/alert, que não
   * funcionam em todos os lugares). Resolve com o `value` do botão tocado
   * ou null se a janela for fechada.
   */
  function choose(message, buttons) {
    return new Promise((resolve) => {
      const dlg = $('#ask-dialog');
      $('#ask-msg').textContent = message;
      const box = $('#ask-btns');
      box.innerHTML = '';
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        if (dlg.open) dlg.close();
        resolve(v);
      };
      buttons.forEach((b) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'btn ' + (b.cls || '');
        el.textContent = b.label;
        el.addEventListener('click', () => finish(b.value));
        box.appendChild(el);
      });
      dlg.addEventListener('close', () => finish(null), { once: true });
      dlg.showModal();
    });
  }

  const ask = (message, okLabel = 'Confirmar', danger = false) =>
    choose(message, [
      { label: 'Cancelar', value: false },
      { label: okLabel, value: true, cls: danger ? 'btn-danger-solid' : 'btn-primary' }
    ]).then((v) => v === true);

  const notify = (message) => choose(message, [{ label: 'OK', value: true, cls: 'btn-primary' }]);

  // Capacidades do Claude (só existem quando o app roda como Artifact).
  const hasClaude = () => !!(window.claude && typeof window.claude.use === 'function');
  let downloadsNs;
  function getDownloads() {
    if (downloadsNs === undefined) {
      downloadsNs = hasClaude() ? Promise.resolve(window.claude.use('downloads')).catch(() => null) : Promise.resolve(null);
    }
    return downloadsNs;
  }

  /** Salva um arquivo; retorna true se foi salvo. */
  async function download(filename, content, mime) {
    const ns = await getDownloads();
    if (ns) {
      try {
        await ns.save({ filename, data: content });
        return true;
      } catch (e) {
        if (e && e.code === 'declined') return false;
        if (e && e.code === 'rate_limited') { toast('Aguarde um instante e tente de novo.'); return false; }
        console.error(e);
        toast('Não foi possível salvar o arquivo aqui.');
        return false;
      }
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Armazenamento
  // ---------------------------------------------------------------------------

  let db = { versao: 1, emprestimos: [] };

  function load() {
    try {
      const raw = store.get(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.emprestimos)) db = parsed;
      }
    } catch (e) {
      console.error(e);
      toast('Não foi possível ler os dados salvos.');
    }
  }

  function saveLocal() {
    return store.set(STORAGE_KEY, JSON.stringify(db));
  }

  function save() {
    db.atualizadoEm = new Date().toISOString();
    const okLocal = saveLocal();
    if (cloud.ref) pushCloud();
    else if (!okLocal) toast('Erro ao salvar: o armazenamento do navegador está cheio ou bloqueado.');
  }

  // --- Sincronização com a conta do Claude (somente dentro do Claude) ---

  const cloud = { ref: null, loading: false, writing: false, dirty: false };

  function cloudBody() {
    return {
      versao: 1,
      atualizadoEm: db.atualizadoEm || new Date().toISOString(),
      emprestimos: db.emprestimos,
      senha: store.get(PASS_KEY) || ''
    };
  }

  /** Grava o estado na nuvem, uma gravação por vez (junta alterações seguidas). */
  async function pushCloud() {
    if (!cloud.ref) return;
    if (cloud.writing) { cloud.dirty = true; return; }
    cloud.writing = true;
    try {
      do {
        cloud.dirty = false;
        try {
          await cloud.ref.set(JSON.parse(JSON.stringify(cloudBody())));
        } catch (e) {
          console.error(e);
          if (e && e.code === 'quota_exceeded') toast('Limite de armazenamento atingido. Exporte um backup.');
          else if (e && e.code === 'unavailable') { await new Promise((r) => setTimeout(r, 800 + Math.random() * 800)); cloud.dirty = true; }
          else { toast('Não foi possível salvar na sua conta. Os dados ficaram salvos só neste aparelho.'); break; }
        }
      } while (cloud.dirty);
    } finally {
      cloud.writing = false;
    }
  }

  async function initCloud() {
    if (!hasClaude()) return;
    cloud.loading = true;
    if (!$('#lock').hidden) setupLock();
    try {
      const [dbNs, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      const id = dbNs && user ? await user.id() : null;
      if (!id) return;
      const ref = dbNs.doc('data/users/' + id + '/estado');
      const snap = await ref.get();
      cloud.ref = ref;
      const remoto = snap.exists ? snap.data() : null;
      const remotoMaisNovo = remoto && Array.isArray(remoto.emprestimos) &&
        (!db.atualizadoEm || (remoto.atualizadoEm || '') >= db.atualizadoEm);
      if (remoto && remoto.senha) store.set(PASS_KEY, remoto.senha);
      if (remotoMaisNovo) {
        db = { versao: 1, atualizadoEm: remoto.atualizadoEm, emprestimos: JSON.parse(JSON.stringify(remoto.emprestimos)) };
        saveLocal();
        route();
      } else if (db.emprestimos.length || store.get(PASS_KEY)) {
        pushCloud();
      }
    } catch (e) {
      console.error(e);
    } finally {
      cloud.loading = false;
      if (!$('#lock').hidden) setupLock();
    }
  }

  const getLoan = (id) => db.emprestimos.find((l) => l.id === id);

  // ---------------------------------------------------------------------------
  // Cálculos
  // ---------------------------------------------------------------------------

  /** Calcula tudo que é derivado de um empréstimo (status, pago, atraso, parcelas). */
  function calc(loan) {
    const hoje = todayISO();
    const pago = round2(loan.pagamentos.reduce((s, p) => s + p.valor, 0));
    const restante = round2(Math.max(0, loan.valorTotal - pago));

    // Distribui o total pago pelas parcelas em ordem de vencimento.
    let disponivel = pago;
    const parcelas = loan.parcelas
      .slice()
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
      .map((p, i) => {
        const aplicado = round2(Math.min(p.valor, Math.max(0, disponivel)));
        disponivel = round2(disponivel - aplicado);
        const falta = round2(p.valor - aplicado);
        let st;
        if (falta <= EPS) st = 'paga';
        else if (p.vencimento < hoje) st = 'vencida';
        else if (aplicado > EPS) st = 'parcial';
        else st = 'a-vencer';
        return { ...p, numero: i + 1, pagoParcela: aplicado, falta, status: st };
      });

    const emAtraso = round2(
      parcelas.filter((p) => p.status === 'vencida').reduce((s, p) => s + p.falta, 0)
    );

    let status;
    if (loan.calote) status = 'calote';
    else if (pago + EPS >= loan.valorTotal) status = 'quitado';
    else if (emAtraso > EPS) status = 'atrasado';
    else status = 'em-dia';

    const proxima = parcelas.find((p) => p.status !== 'paga') || null;
    const recuperado = pago + EPS >= loan.valorEmprestado;

    return { pago, restante, parcelas, emAtraso, status, proxima, recuperado };
  }

  function totals() {
    const t = {
      emprestado: 0,
      aReceber: 0,
      recebido: 0,
      pendente: 0,
      atraso: 0,
      perdido: 0,
      lucroReal: 0,
      lucroPrevisto: 0,
      lucroLiquido: 0,
      qtd: { 'em-dia': 0, atrasado: 0, quitado: 0, calote: 0 },
      qtdLucroReal: 0
    };

    for (const loan of db.emprestimos) {
      const c = calc(loan);
      t.qtd[c.status]++;
      t.emprestado += loan.valorEmprestado;
      t.recebido += c.pago;

      if (c.status === 'calote') {
        // Perda = capital que não voltou.
        t.perdido += Math.max(0, loan.valorEmprestado - c.pago);
      } else {
        t.aReceber += loan.valorTotal;
        t.pendente += c.restante;
        t.atraso += c.emAtraso;
        t.lucroPrevisto += loan.valorTotal - loan.valorEmprestado;
      }

      // Lucro real: só conta empréstimos quitados ou cujo capital já voltou.
      if (c.status === 'quitado' || c.recuperado) {
        t.lucroReal += c.pago - loan.valorEmprestado;
        t.qtdLucroReal++;
      }
    }

    t.lucroLiquido = t.lucroReal - t.perdido;
    for (const k of Object.keys(t)) if (typeof t[k] === 'number') t[k] = round2(t[k]);
    return t;
  }

  // ---------------------------------------------------------------------------
  // Senha
  // ---------------------------------------------------------------------------

  async function hashPass(pass) {
    const data = new TextEncoder().encode('emprestimos::' + pass);
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', data);
      return 'sha256:' + Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    // Alternativa simples quando crypto.subtle não está disponível.
    let h = 5381;
    for (const b of data) h = ((h << 5) + h + b) >>> 0;
    return 'djb2:' + h.toString(16);
  }

  function setupLock() {
    const hasPass = !!store.get(PASS_KEY);
    const pass2 = $('#lock-pass2');
    $('#lock-error').hidden = true;
    $('#lock-pass').value = '';
    pass2.value = '';
    $('#lock-btn').disabled = false;
    if (!hasPass && cloud.loading) {
      $('#lock-msg').textContent = 'Carregando seus dados…';
      pass2.hidden = true;
      pass2.required = false;
      $('#lock-btn').textContent = 'Aguarde…';
      $('#lock-btn').disabled = true;
    } else if (hasPass) {
      $('#lock-msg').textContent = 'Digite sua senha para entrar.';
      pass2.hidden = true;
      pass2.required = false;
      $('#lock-btn').textContent = 'Entrar';
    } else {
      $('#lock-msg').textContent = 'Primeiro acesso: crie uma senha para proteger o app.';
      pass2.hidden = false;
      pass2.required = true;
      $('#lock-btn').textContent = 'Criar senha e entrar';
    }
    $('#app').hidden = true;
    $('#lock').hidden = false;
    setTimeout(() => $('#lock-pass').focus(), 50);
  }

  async function onLockSubmit(e) {
    e.preventDefault();
    const err = $('#lock-error');
    const p1 = $('#lock-pass').value;
    const stored = store.get(PASS_KEY);
    err.hidden = true;
    if (!stored && cloud.loading) return;

    if (!stored) {
      const p2 = $('#lock-pass2').value;
      if (p1.length < 4) return showErr(err, 'A senha precisa ter pelo menos 4 caracteres.');
      if (p1 !== p2) return showErr(err, 'As senhas não conferem.');
      store.set(PASS_KEY, await hashPass(p1));
      if (cloud.ref) pushCloud();
    } else if ((await hashPass(p1)) !== stored) {
      $('#lock-pass').value = '';
      return showErr(err, 'Senha incorreta.');
    }
    session.set(SESSION_KEY, '1');
    unlock();
  }

  function showErr(el, msg) {
    el.textContent = msg;
    el.hidden = false;
  }

  function unlock() {
    $('#lock').hidden = true;
    $('#app').hidden = false;
    route();
  }

  function lock() {
    session.del(SESSION_KEY);
    setupLock();
  }

  // ---------------------------------------------------------------------------
  // Roteamento
  // ---------------------------------------------------------------------------

  const view = () => $('#view');
  let listFilter = { pessoa: '', status: '', busca: '' };
  let formState = null; // estado do formulário de empréstimo em edição

  function setHeader(title, back) {
    $('#title').textContent = title;
    $('#btn-back').hidden = !back;
    document.title = title + ' · Meus Empréstimos';
  }

  function setNav(name) {
    $$('.bottomnav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
  }

  function route() {
    if ($('#app').hidden) return;
    // Rotas no formato #nome ou #nome-id (aceita também o formato antigo #/nome/id).
    const hash = location.hash.replace(/^#\/?/, '').replace('/', '-');
    const i = hash.indexOf('-');
    const nome = i < 0 ? hash : hash.slice(0, i);
    const arg = i < 0 ? '' : hash.slice(i + 1);
    window.scrollTo(0, 0);

    switch (nome) {
      case '':
      case 'painel': return renderPainel();
      case 'lista': return renderLista();
      case 'novo': return renderForm(null);
      case 'editar': return renderForm(arg);
      case 'emprestimo': return renderDetalhe(arg);
      case 'config': return renderConfig();
      case 'mensal': return renderMensal();
      default: location.hash = '#painel';
    }
  }

  // ---------------------------------------------------------------------------
  // Painel
  // ---------------------------------------------------------------------------

  function renderPainel() {
    setHeader('Painel', false);
    setNav('painel');
    const t = totals();
    const neg = t.lucroReal < 0;

    const proximos = db.emprestimos
      .map((l) => ({ l, c: calc(l) }))
      .filter((x) => x.c.status === 'atrasado' || x.c.status === 'em-dia')
      .filter((x) => x.c.proxima)
      .sort((a, b) => a.c.proxima.vencimento.localeCompare(b.c.proxima.vencimento))
      .slice(0, 5);

    view().innerHTML = `
      <div class="hero ${neg ? 'negative' : ''}">
        <div class="hero-label">💰 Lucro real</div>
        <div class="hero-value">${fmtMoney(t.lucroReal)}</div>
        <div class="hero-sub">
          Recebido − emprestado, em ${t.qtdLucroReal} empréstimo(s) quitado(s) ou com capital já recuperado.
        </div>
        ${t.perdido > 0 ? `<div class="hero-sub" style="margin-top:6px">Descontando calotes: <strong>${fmtMoney(t.lucroLiquido)}</strong></div>` : ''}
      </div>

      <div class="stats">
        <div class="stat teal wide">
          <div class="stat-label">Lucro previsto</div>
          <div class="stat-value">${fmtMoney(t.lucroPrevisto)}</div>
        </div>
        <div class="stat blue">
          <div class="stat-label">Total emprestado</div>
          <div class="stat-value">${fmtMoney(t.emprestado)}</div>
        </div>
        <div class="stat blue">
          <div class="stat-label">Total a receber</div>
          <div class="stat-value">${fmtMoney(t.aReceber)}</div>
        </div>
        <div class="stat green">
          <div class="stat-label">Já recebido</div>
          <div class="stat-value">${fmtMoney(t.recebido)}</div>
        </div>
        <div class="stat teal">
          <div class="stat-label">Pendente</div>
          <div class="stat-value">${fmtMoney(t.pendente)}</div>
        </div>
        <div class="stat orange">
          <div class="stat-label">Em atraso</div>
          <div class="stat-value">${fmtMoney(t.atraso)}</div>
        </div>
        <div class="stat red">
          <div class="stat-label">Perdido (calotes)</div>
          <div class="stat-value">${fmtMoney(t.perdido)}</div>
        </div>
      </div>

      ${cardMesAtual()}

      <div class="card">
        <h2>Empréstimos por status</h2>
        <div class="counts">
          ${Object.keys(STATUS_LABEL).map((k) => `
            <a class="badge ${k}" href="#lista" data-status="${k}">${STATUS_LABEL[k]}: ${t.qtd[k]}</a>
          `).join('')}
        </div>
      </div>

      <div class="card">
        <h2>Próximos vencimentos</h2>
        ${proximos.length ? proximos.map(({ l, c }) => `
          <a class="list-row" href="#emprestimo-${l.id}" style="color:inherit;text-decoration:none">
            <div class="grow">
              <div><strong>${esc(l.nome)}</strong></div>
              <div class="sub">Parcela ${c.proxima.numero}/${c.parcelas.length} · vence ${fmtDate(c.proxima.vencimento)}</div>
            </div>
            <div class="amount">${fmtMoney(c.proxima.falta)}<br><span class="badge ${c.status}">${STATUS_LABEL[c.status]}</span></div>
          </a>
        `).join('') : '<p class="muted">Nenhuma parcela em aberto.</p>'}
      </div>

      ${db.emprestimos.length === 0 ? `
        <div class="empty">
          <p>Você ainda não cadastrou nenhum empréstimo.</p>
          <a class="btn btn-primary" href="#novo">＋ Cadastrar empréstimo</a>
        </div>` : ''}
    `;

    $$('[data-status]', view()).forEach((a) =>
      a.addEventListener('click', () => {
        listFilter = { pessoa: '', status: a.dataset.status, busca: '' };
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Lucro mensal
  // ---------------------------------------------------------------------------

  function getMetodo() {
    return store.get(METODO_KEY) === 'capital' ? 'capital' : 'proporcional';
  }

  const mesKey = (iso) => iso.slice(0, 7);
  const mesLabel = (key) => `${MESES_LONGO[Number(key.slice(5, 7)) - 1]} de ${key.slice(0, 4)}`;

  /**
   * Distribui o lucro de cada pagamento no mês em que ele foi recebido.
   * - proporcional: cada pagamento carrega a mesma fração de juros do empréstimo
   *   (ex.: emprestou 1.000 para receber 1.300 → 23% de cada pagamento é lucro).
   * - capital: os pagamentos devolvem primeiro o valor emprestado; só o que passa
   *   dele é lucro (o total bate com o "lucro real" do painel).
   * Calotes entram como perda no mês em que foram marcados.
   */
  function lucroPorMes(metodo) {
    const meses = {};
    const mes = (key) => meses[key] || (meses[key] = {
      recebido: 0, lucro: 0, perdas: 0, emprestado: 0, pagamentos: [], calotes: []
    });

    for (const loan of db.emprestimos) {
      mes(mesKey(loan.data)).emprestado += loan.valorEmprestado;

      const fracao = loan.valorTotal > 0 ? (loan.valorTotal - loan.valorEmprestado) / loan.valorTotal : 0;
      let acumulado = 0;
      let capitalVoltou = 0;
      const pags = loan.pagamentos.slice().sort((a, b) => a.data.localeCompare(b.data));

      for (const p of pags) {
        let lucro;
        if (metodo === 'capital') {
          lucro = Math.max(0, acumulado + p.valor - loan.valorEmprestado) - Math.max(0, acumulado - loan.valorEmprestado);
        } else {
          // Até o total combinado, aplica a fração de juros; o que passar do total é lucro integral.
          const dentro = Math.max(0, Math.min(p.valor, loan.valorTotal - acumulado));
          lucro = dentro * fracao + (p.valor - dentro);
        }
        acumulado += p.valor;
        capitalVoltou += p.valor - lucro;
        const m = mes(mesKey(p.data));
        m.recebido += p.valor;
        m.lucro += lucro;
        m.pagamentos.push({ loan, pag: p, lucro: round2(lucro) });
      }

      if (loan.calote) {
        const perda = round2(Math.max(0, loan.valorEmprestado - capitalVoltou));
        if (perda > 0) {
          const ultimo = pags.length ? pags[pags.length - 1].data : loan.data;
          const m = mes(mesKey(loan.caloteEm || ultimo));
          m.perdas += perda;
          m.calotes.push({ loan, perda });
        }
      }
    }

    for (const m of Object.values(meses)) {
      m.recebido = round2(m.recebido);
      m.lucro = round2(m.lucro);
      m.perdas = round2(m.perdas);
      m.emprestado = round2(m.emprestado);
      m.liquido = round2(m.lucro - m.perdas);
      m.pagamentos.sort((a, b) => b.pag.data.localeCompare(a.pag.data));
    }
    return meses;
  }

  function cardMesAtual() {
    if (!db.emprestimos.length) return '';
    const meses = lucroPorMes(getMetodo());
    const atual = mesKey(todayISO());
    const anterior = mesKey(addMonths(atual + '-01', -1));
    const a = meses[atual] || { liquido: 0, recebido: 0 };
    const b = meses[anterior] || { liquido: 0 };
    const diff = round2(a.liquido - b.liquido);
    return `
      <a class="card month-card" href="#mensal">
        <div>
          <div class="stat-label">Lucro de ${MESES_LONGO[Number(atual.slice(5)) - 1].toLowerCase()}</div>
          <div class="stat-value" style="color:${a.liquido < 0 ? 'var(--red)' : 'var(--green)'}">${fmtMoney(a.liquido)}</div>
          <div class="hint">Recebido no mês: ${fmtMoney(a.recebido)} ·
            ${diff === 0 ? 'igual ao mês passado' : `${diff > 0 ? '▲' : '▼'} ${fmtMoney(Math.abs(diff))} vs. mês passado`}</div>
        </div>
        <span class="month-card-link">Ver mês a mês ›</span>
      </a>`;
  }

  let mensalSel = null; // { ano, mes } selecionado na tela mensal

  function renderMensal() {
    setHeader('Lucro mensal', false);
    setNav('mensal');

    const metodo = getMetodo();
    const meses = lucroPorMes(metodo);
    const hoje = todayISO();
    const anoAtual = Number(hoje.slice(0, 4));
    const anos = Array.from(new Set(Object.keys(meses).map((k) => Number(k.slice(0, 4))).concat(anoAtual)))
      .sort((a, b) => b - a);

    if (!mensalSel || !anos.includes(mensalSel.ano)) mensalSel = { ano: anoAtual, mes: null };
    const ano = mensalSel.ano;
    const dados = MESES.map((_, i) => {
      const key = `${ano}-${String(i + 1).padStart(2, '0')}`;
      return { key, i, ...(meses[key] || { recebido: 0, lucro: 0, perdas: 0, emprestado: 0, liquido: 0, pagamentos: [], calotes: [] }) };
    });
    const comDados = dados.filter((d) => d.recebido || d.perdas || d.emprestado);

    if (mensalSel.mes == null) {
      const mesAtual = Number(hoje.slice(5, 7)) - 1;
      mensalSel.mes = ano === anoAtual ? mesAtual : (comDados.length ? comDados[comDados.length - 1].i : 11);
    }

    const tot = dados.reduce((t, d) => {
      t.recebido += d.recebido; t.lucro += d.lucro; t.perdas += d.perdas; t.liquido += d.liquido; t.emprestado += d.emprestado;
      return t;
    }, { recebido: 0, lucro: 0, perdas: 0, liquido: 0, emprestado: 0 });
    // Média só dos meses já decorridos (no ano atual) ou dos 12 meses (anos passados).
    const mesesDecorridos = ano === anoAtual ? Number(hoje.slice(5, 7)) : ano < anoAtual ? 12 : 0;
    const media = mesesDecorridos ? tot.liquido / mesesDecorridos : 0;
    const melhor = comDados.length ? comDados.reduce((m, d) => (d.liquido > m.liquido ? d : m)) : null;
    const temPerdas = tot.perdas > 0;

    view().innerHTML = `
      <div class="filters filters-2">
        <select id="m-ano" aria-label="Ano">
          ${anos.map((a) => `<option ${a === ano ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
        <select id="m-metodo" aria-label="Como calcular o lucro">
          <option value="proporcional" ${metodo === 'proporcional' ? 'selected' : ''}>Juros por pagamento</option>
          <option value="capital" ${metodo === 'capital' ? 'selected' : ''}>Capital primeiro</option>
        </select>
      </div>
      <p class="hint" style="margin:-4px 4px 12px">
        ${metodo === 'proporcional'
          ? 'Cada pagamento recebido tem uma parte de juros (lucro) e uma parte de devolução do valor emprestado.'
          : 'Os pagamentos devolvem primeiro o valor emprestado; só o que passar dele conta como lucro. A soma de todos os meses bate com o lucro real do painel.'}
      </p>

      <div class="stats">
        <div class="stat green">
          <div class="stat-label">Lucro em ${ano}${temPerdas ? ' (líquido)' : ''}</div>
          <div class="stat-value">${fmtMoney(tot.liquido)}</div>
        </div>
        <div class="stat teal">
          <div class="stat-label">Média por mês</div>
          <div class="stat-value">${fmtMoney(media)}</div>
        </div>
        <div class="stat blue">
          <div class="stat-label">Recebido em ${ano}</div>
          <div class="stat-value">${fmtMoney(tot.recebido)}</div>
        </div>
        <div class="stat green">
          <div class="stat-label">Melhor mês</div>
          <div class="stat-value">${melhor && melhor.liquido > 0 ? `${MESES[melhor.i]} · ${fmtMoney(melhor.liquido)}` : '—'}</div>
        </div>
      </div>

      <div class="card">
        <h2>Lucro${temPerdas ? ' líquido' : ''} mês a mês</h2>
        ${chartMensal(dados, mensalSel.mes)}
        <p class="hint" style="text-align:center">Toque em um mês para ver os detalhes.</p>
      </div>

      <div id="m-detalhe">${detalheMes(dados[mensalSel.mes], metodo)}</div>

      <h3 class="section-title">Tabela de ${ano} (valores em R$)</h3>
      <div class="card table-wrap">
        <table class="table">
          <thead><tr>
            <th>Mês</th><th>Recebido</th><th>Lucro</th>${temPerdas ? '<th>Perdas</th><th>Líquido</th>' : ''}
          </tr></thead>
          <tbody>
            ${dados.map((d) => `
              <tr data-mes="${d.i}" class="${d.i === mensalSel.mes ? 'sel' : ''}">
                <td>${MESES[d.i]}</td>
                <td>${fmtNum(d.recebido)}</td>
                <td class="${d.lucro < 0 ? 'neg' : d.lucro > 0 ? 'pos' : ''}">${fmtNum(d.lucro)}</td>
                ${temPerdas ? `<td class="${d.perdas > 0 ? 'neg' : ''}">${d.perdas > 0 ? '−' + fmtNum(d.perdas) : fmtNum(0)}</td>
                <td class="${d.liquido < 0 ? 'neg' : d.liquido > 0 ? 'pos' : ''}"><strong>${fmtNum(d.liquido)}</strong></td>` : ''}
              </tr>`).join('')}
          </tbody>
          <tfoot><tr>
            <td>Total</td><td>${fmtNum(tot.recebido)}</td><td>${fmtNum(tot.lucro)}</td>
            ${temPerdas ? `<td>−${fmtNum(tot.perdas)}</td><td>${fmtNum(tot.liquido)}</td>` : ''}
          </tr></tfoot>
        </table>
      </div>
    `;

    $('#m-ano').addEventListener('change', (e) => {
      mensalSel = { ano: Number(e.target.value), mes: null };
      renderMensal();
    });
    $('#m-metodo').addEventListener('change', (e) => {
      store.set(METODO_KEY, e.target.value);
      renderMensal();
    });
    $$('[data-mes]', view()).forEach((el) =>
      el.addEventListener('click', () => {
        mensalSel.mes = Number(el.dataset.mes);
        renderMensal();
        $('#m-detalhe').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      })
    );
  }

  /** Gráfico de barras simples (HTML/CSS) com linha do zero; meses negativos ficam abaixo dela. */
  function chartMensal(dados, sel) {
    const H = 160;
    const maxPos = Math.max(0, ...dados.map((d) => d.liquido));
    const maxNeg = Math.max(0, ...dados.map((d) => -d.liquido));
    const escala = maxPos + maxNeg || 1;
    const hPos = maxNeg ? (H * maxPos) / escala : H;
    const hNeg = H - hPos;

    const colunas = dados.map((d) => {
      const altura = Math.abs(d.liquido) / escala * H;
      const visivel = d.liquido !== 0 ? Math.max(altura, 3) : 0;
      const neg = d.liquido < 0;
      return `
        <button type="button" class="bar-col ${d.i === sel ? 'sel' : ''}" data-mes="${d.i}"
          aria-label="${MESES_LONGO[d.i]}: ${fmtMoney(d.liquido)}">
          <span class="bar-pos" style="height:${hPos}px">
            ${!neg && visivel ? `<span class="bar" style="height:${visivel}px"></span>` : ''}
          </span>
          <span class="bar-neg" style="height:${hNeg}px">
            ${neg ? `<span class="bar bar-down" style="height:${visivel}px"></span>` : ''}
          </span>
          <span class="bar-label">${MESES[d.i].charAt(0)}<span class="bar-label-rest">${MESES[d.i].slice(1)}</span></span>
        </button>`;
    }).join('');

    return `
      <div class="chart" role="img" aria-label="Gráfico de lucro mensal">
        <div class="chart-axis">
          <span>${fmtShort(maxPos)}</span>
          ${maxNeg ? `<span>−${fmtShort(maxNeg)}</span>` : '<span>0</span>'}
        </div>
        <div class="chart-bars" style="--zero:${hPos}px">${colunas}</div>
      </div>`;
  }

  /** Valor curto para o eixo: 1,2 mil, 850, etc. */
  function fmtShort(v) {
    if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace('.', ',') + ' mil';
    return String(Math.round(v));
  }

  function detalheMes(d, metodo) {
    const pags = d.pagamentos;
    return `
      <div class="card">
        <h2>${mesLabel(d.key)}</h2>
        <div class="kv">
          <div><span>Recebido</span><strong>${fmtMoney(d.recebido)}</strong></div>
          <div><span>Lucro</span><strong style="color:${d.lucro < 0 ? 'var(--red)' : 'var(--green)'}">${fmtMoney(d.lucro)}</strong></div>
          <div><span>Devolução de capital</span><strong>${fmtMoney(d.recebido - d.lucro)}</strong></div>
          ${d.perdas > 0 ? `
            <div><span>Perdas (calotes)</span><strong style="color:var(--red)">−${fmtMoney(d.perdas)}</strong></div>
            <div><span>Lucro líquido</span><strong style="color:${d.liquido < 0 ? 'var(--red)' : 'var(--green)'}">${fmtMoney(d.liquido)}</strong></div>` : ''}
          <div><span>Emprestado no mês</span><strong>${fmtMoney(d.emprestado)}</strong></div>
        </div>

        <h3 class="section-title" style="margin-left:0">Pagamentos recebidos (${pags.length})</h3>
        ${pags.length ? pags.map((x) => `
          <a class="list-row" href="#emprestimo-${x.loan.id}" style="color:inherit;text-decoration:none">
            <div class="grow">
              <div><strong>${esc(x.loan.nome)}</strong></div>
              <div class="sub">${fmtDate(x.pag.data)}${x.pag.obs ? ' · ' + esc(x.pag.obs) : ''}</div>
            </div>
            <div class="amount">${fmtMoney(x.pag.valor)}<br>
              <span class="sub" style="color:${x.lucro > 0 ? 'var(--green)' : 'var(--muted)'}">lucro ${fmtMoney(x.lucro)}</span>
            </div>
          </a>`).join('') : '<p class="muted">Nenhum pagamento recebido neste mês.</p>'}

        ${d.calotes.length ? `
          <h3 class="section-title" style="margin-left:0">Calotes (${d.calotes.length})</h3>
          ${d.calotes.map((x) => `
            <a class="list-row" href="#emprestimo-${x.loan.id}" style="color:inherit;text-decoration:none">
              <div class="grow"><strong>${esc(x.loan.nome)}</strong></div>
              <div class="amount" style="color:var(--red)">−${fmtMoney(x.perda)}</div>
            </a>`).join('')}` : ''}

        ${metodo === 'capital' && d.recebido > 0 && d.lucro === 0
          ? '<p class="hint">Neste método, o lucro só aparece depois que o valor emprestado já voltou por completo.</p>' : ''}
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Lista
  // ---------------------------------------------------------------------------

  function renderLista() {
    setHeader('Empréstimos', false);
    setNav('lista');

    const pessoas = Array.from(new Set(db.emprestimos.map((l) => l.nome.trim())))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (listFilter.pessoa && !pessoas.includes(listFilter.pessoa)) listFilter.pessoa = '';

    view().innerHTML = `
      <div class="filters">
        <input type="search" id="f-busca" placeholder="🔎 Buscar por nome ou observação" value="${esc(listFilter.busca)}">
        <select id="f-pessoa">
          <option value="">Todas as pessoas</option>
          ${pessoas.map((p) => `<option ${p === listFilter.pessoa ? 'selected' : ''}>${esc(p)}</option>`).join('')}
        </select>
        <select id="f-status">
          <option value="">Todos os status</option>
          ${Object.keys(STATUS_LABEL).map((k) => `<option value="${k}" ${k === listFilter.status ? 'selected' : ''}>${STATUS_LABEL[k]}</option>`).join('')}
        </select>
      </div>
      <div id="lista-resumo" class="hint" style="margin:0 4px 10px"></div>
      <div id="lista-itens"></div>
    `;

    const update = () => {
      listFilter.busca = $('#f-busca').value;
      listFilter.pessoa = $('#f-pessoa').value;
      listFilter.status = $('#f-status').value;
      renderListaItens();
    };
    $('#f-busca').addEventListener('input', update);
    $('#f-pessoa').addEventListener('change', update);
    $('#f-status').addEventListener('change', update);
    renderListaItens();
  }

  function filteredLoans() {
    const busca = listFilter.busca.trim().toLowerCase();
    return db.emprestimos
      .map((l) => ({ l, c: calc(l) }))
      .filter(({ l, c }) => {
        if (listFilter.pessoa && l.nome.trim() !== listFilter.pessoa) return false;
        if (listFilter.status && c.status !== listFilter.status) return false;
        if (busca && !(l.nome.toLowerCase().includes(busca) || (l.obs || '').toLowerCase().includes(busca))) return false;
        return true;
      })
      .sort((a, b) => b.l.data.localeCompare(a.l.data));
  }

  function renderListaItens() {
    const itens = filteredLoans();
    const box = $('#lista-itens');
    const totalEmp = itens.reduce((s, x) => s + x.l.valorEmprestado, 0);
    const totalRest = itens.reduce((s, x) => s + (x.c.status === 'calote' ? 0 : x.c.restante), 0);
    $('#lista-resumo').textContent = itens.length
      ? `${itens.length} empréstimo(s) · emprestado ${fmtMoney(totalEmp)} · falta receber ${fmtMoney(totalRest)}`
      : '';

    if (!itens.length) {
      box.innerHTML = db.emprestimos.length
        ? '<div class="empty">Nenhum empréstimo encontrado com esses filtros.</div>'
        : '<div class="empty"><p>Nenhum empréstimo cadastrado.</p><a class="btn btn-primary" href="#novo">＋ Cadastrar empréstimo</a></div>';
      return;
    }

    box.innerHTML = itens.map(({ l, c }) => {
      const pct = l.valorTotal > 0 ? Math.min(100, (c.pago / l.valorTotal) * 100) : 0;
      let info;
      if (c.status === 'quitado') info = 'Quitado';
      else if (c.status === 'calote') info = `Perda: ${fmtMoney(Math.max(0, l.valorEmprestado - c.pago))}`;
      else if (c.proxima) info = `Próx.: ${fmtDate(c.proxima.vencimento)} · ${fmtMoney(c.proxima.falta)}`;
      else info = '';
      return `
        <a class="loan-item" href="#emprestimo-${l.id}">
          <div class="loan-top">
            <span class="loan-name">${esc(l.nome)}</span>
            <span class="badge ${c.status}">${STATUS_LABEL[c.status]}</span>
          </div>
          <div class="loan-meta">
            ${fmtDate(l.data)} · Emprestou ${fmtMoney(l.valorEmprestado)} · Receber ${fmtMoney(l.valorTotal)}
          </div>
          <div class="loan-meta">
            Recebido ${fmtMoney(c.pago)} de ${fmtMoney(l.valorTotal)}${info ? ' · ' + info : ''}
            ${c.emAtraso > 0 && c.status === 'atrasado' ? ` · <strong style="color:var(--orange)">Atraso ${fmtMoney(c.emAtraso)}</strong>` : ''}
          </div>
          <div class="progress"><div style="width:${pct}%"></div></div>
        </a>`;
    }).join('');
  }

  // ---------------------------------------------------------------------------
  // Detalhe
  // ---------------------------------------------------------------------------

  function renderDetalhe(id) {
    const loan = getLoan(id);
    if (!loan) {
      toast('Empréstimo não encontrado.');
      location.hash = '#lista';
      return;
    }
    setHeader(loan.nome, true);
    setNav('lista');
    const c = calc(loan);
    const lucroPrev = loan.valorTotal - loan.valorEmprestado;
    const lucroAtual = c.pago - loan.valorEmprestado;
    const pagamentos = loan.pagamentos.slice().sort((a, b) => b.data.localeCompare(a.data));

    view().innerHTML = `
      <div class="card">
        <div class="loan-top" style="margin-bottom:14px">
          <h2 style="margin:0">${esc(loan.nome)}</h2>
          <span class="badge ${c.status}">${STATUS_LABEL[c.status]}</span>
        </div>
        <div class="kv">
          <div><span>Data</span><strong>${fmtDate(loan.data)}</strong></div>
          <div><span>Emprestado</span><strong>${fmtMoney(loan.valorEmprestado)}</strong></div>
          <div><span>Total a receber</span><strong>${fmtMoney(loan.valorTotal)}</strong></div>
          <div><span>Recebido</span><strong style="color:var(--green)">${fmtMoney(c.pago)}</strong></div>
          <div><span>Falta receber</span><strong>${fmtMoney(c.restante)}</strong></div>
          <div><span>Em atraso</span><strong style="color:${c.emAtraso > 0 ? 'var(--orange)' : 'inherit'}">${fmtMoney(c.emAtraso)}</strong></div>
          <div><span>Lucro previsto</span><strong>${fmtMoney(lucroPrev)}</strong></div>
          <div><span>Lucro até agora</span><strong style="color:${lucroAtual >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtMoney(lucroAtual)}</strong></div>
          <div><span>Juros</span><strong>${loan.valorEmprestado > 0 ? ((lucroPrev / loan.valorEmprestado) * 100).toFixed(1).replace('.', ',') + '%' : '—'}</strong></div>
        </div>
        ${loan.obs ? `<div class="obs">${esc(loan.obs)}</div>` : ''}
        <div class="row-btns">
          ${c.status !== 'calote' ? '<button class="btn btn-primary" id="d-pagar">＋ Registrar pagamento</button>' : ''}
          <a class="btn" href="#editar-${loan.id}">✏️ Editar</a>
        </div>
      </div>

      <h3 class="section-title">Parcelas (${c.parcelas.length})</h3>
      <div class="card">
        ${c.parcelas.map((p) => `
          <div class="list-row">
            <div class="grow">
              <div><strong>${p.numero}ª parcela</strong> · ${fmtDate(p.vencimento)}</div>
              <div class="sub">Pago ${fmtMoney(p.pagoParcela)} de ${fmtMoney(p.valor)}</div>
            </div>
            <div class="amount">
              ${fmtMoney(p.valor)}<br>
              <span class="badge ${p.status}">${PARCELA_LABEL[p.status]}</span>
            </div>
          </div>`).join('')}
        <p class="hint">Os pagamentos são abatidos das parcelas em ordem de vencimento.</p>
      </div>

      <h3 class="section-title">Histórico de pagamentos (${pagamentos.length})</h3>
      <div class="card">
        ${pagamentos.length ? pagamentos.map((p) => `
          <div class="list-row">
            <div class="grow">
              <div><strong>${fmtDate(p.data)}</strong></div>
              ${p.obs ? `<div class="sub">${esc(p.obs)}</div>` : ''}
            </div>
            <div class="amount" style="color:var(--green)">${fmtMoney(p.valor)}</div>
            <div class="actions">
              <button class="btn btn-sm" data-edit-pay="${p.id}" aria-label="Editar pagamento">✏️</button>
              <button class="btn btn-sm btn-danger" data-del-pay="${p.id}" aria-label="Excluir pagamento">🗑️</button>
            </div>
          </div>`).join('') : '<p class="muted">Nenhum pagamento registrado.</p>'}
      </div>

      <div class="row-btns">
        ${loan.calote
          ? '<button class="btn btn-warn" id="d-calote">↩️ Desmarcar calote</button>'
          : '<button class="btn btn-warn" id="d-calote">⚠️ Marcar como calote</button>'}
        <button class="btn btn-danger" id="d-excluir">🗑️ Excluir empréstimo</button>
      </div>
    `;

    const pagar = $('#d-pagar');
    if (pagar) pagar.addEventListener('click', () => openPayDialog(loan, null));

    $$('[data-edit-pay]').forEach((b) =>
      b.addEventListener('click', () => {
        const pay = loan.pagamentos.find((p) => p.id === b.dataset.editPay);
        if (pay) openPayDialog(loan, pay);
      })
    );
    $$('[data-del-pay]').forEach((b) =>
      b.addEventListener('click', async () => {
        const pay = loan.pagamentos.find((p) => p.id === b.dataset.delPay);
        if (!pay) return;
        if (!(await ask(`Excluir o pagamento de ${fmtMoney(pay.valor)} em ${fmtDate(pay.data)}?`, 'Excluir', true))) return;
        loan.pagamentos = loan.pagamentos.filter((p) => p.id !== pay.id);
        save();
        toast('Pagamento excluído.');
        renderDetalhe(loan.id);
      })
    );

    $('#d-calote').addEventListener('click', async () => {
      const msg = loan.calote
        ? 'Desmarcar calote? O status voltará a ser calculado automaticamente.'
        : `Marcar o empréstimo de ${loan.nome} como calote? O valor não recuperado entra como perda.`;
      if (!(await ask(msg, loan.calote ? 'Desmarcar' : 'Marcar calote', !loan.calote))) return;
      loan.calote = !loan.calote;
      if (loan.calote) loan.caloteEm = todayISO();
      else delete loan.caloteEm;
      save();
      toast(loan.calote ? 'Marcado como calote.' : 'Calote desmarcado.');
      renderDetalhe(loan.id);
    });

    $('#d-excluir').addEventListener('click', async () => {
      if (!(await ask(`Excluir o empréstimo de ${loan.nome} e todos os seus pagamentos? Esta ação não pode ser desfeita.`, 'Excluir', true))) return;
      db.emprestimos = db.emprestimos.filter((l) => l.id !== loan.id);
      save();
      toast('Empréstimo excluído.');
      location.hash = '#lista';
    });
  }

  // ---------------------------------------------------------------------------
  // Modal de pagamento
  // ---------------------------------------------------------------------------

  let payCtx = null;

  function openPayDialog(loan, pay) {
    payCtx = { loanId: loan.id, payId: pay ? pay.id : null };
    const c = calc(loan);
    $('#pay-title').textContent = pay ? 'Editar pagamento' : 'Registrar pagamento';
    $('#pay-data').value = pay ? pay.data : todayISO();
    $('#pay-valor').value = pay ? moneyInput(pay.valor) : (c.proxima ? moneyInput(c.proxima.falta) : '');
    $('#pay-obs').value = pay ? pay.obs || '' : (c.proxima ? `Parcela ${c.proxima.numero}/${c.parcelas.length}` : '');
    $('#pay-error').hidden = true;
    const dlg = $('#pay-dialog');
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    setTimeout(() => $('#pay-valor').select(), 50);
  }

  function closePayDialog() {
    const dlg = $('#pay-dialog');
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
    payCtx = null;
  }

  async function onPaySubmit(e) {
    e.preventDefault();
    if (!payCtx) return closePayDialog();
    const loan = getLoan(payCtx.loanId);
    if (!loan) return closePayDialog();
    const data = $('#pay-data').value;
    const valor = parseMoney($('#pay-valor').value);
    const obs = $('#pay-obs').value.trim();
    const err = $('#pay-error');

    if (!isValidISO(data)) return showErr(err, 'Informe a data do pagamento.');
    if (!(valor > 0)) return showErr(err, 'Informe um valor maior que zero.');

    // Avisa se o pagamento ultrapassa o total a receber.
    const outros = loan.pagamentos.filter((p) => p.id !== payCtx.payId).reduce((s, p) => s + p.valor, 0);
    if (outros + valor > loan.valorTotal + EPS) {
      if (!(await ask(`Com este pagamento o total recebido (${fmtMoney(outros + valor)}) passa do total a receber (${fmtMoney(loan.valorTotal)}). Salvar mesmo assim?`, 'Salvar'))) return;
      if (!payCtx) return;
    }

    if (payCtx.payId) {
      const pay = loan.pagamentos.find((p) => p.id === payCtx.payId);
      Object.assign(pay, { data, valor, obs });
      toast('Pagamento atualizado.');
    } else {
      loan.pagamentos.push({ id: uid(), data, valor, obs });
      toast('Pagamento registrado.');
    }
    save();
    closePayDialog();
    renderDetalhe(loan.id);
  }

  // ---------------------------------------------------------------------------
  // Formulário de empréstimo
  // ---------------------------------------------------------------------------

  function renderForm(id) {
    const loan = id ? getLoan(id) : null;
    if (id && !loan) {
      toast('Empréstimo não encontrado.');
      location.hash = '#lista';
      return;
    }
    setHeader(loan ? 'Editar empréstimo' : 'Novo empréstimo', !!loan);
    setNav(loan ? 'lista' : 'novo');

    const hoje = todayISO();
    formState = {
      id: loan ? loan.id : null,
      parcelas: loan
        ? loan.parcelas.slice().sort((a, b) => a.vencimento.localeCompare(b.vencimento)).map((p) => ({ ...p }))
        : []
    };
    const primeiroVenc = formState.parcelas.length ? formState.parcelas[0].vencimento : addMonths(hoje, 1);
    const pessoas = Array.from(new Set(db.emprestimos.map((l) => l.nome.trim())));

    view().innerHTML = `
      <form id="loan-form" class="card" autocomplete="off" novalidate>
        <label>Nome de quem pegou
          <input type="text" id="l-nome" list="l-pessoas" required value="${esc(loan ? loan.nome : '')}" placeholder="Ex.: João Silva">
          <datalist id="l-pessoas">${pessoas.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
        </label>
        <label>Data do empréstimo
          <input type="date" id="l-data" required value="${loan ? loan.data : hoje}">
        </label>
        <div class="grid-2">
          <label>Valor emprestado (R$)
            <input type="text" inputmode="decimal" id="l-valor" required value="${loan ? moneyInput(loan.valorEmprestado) : ''}" placeholder="0,00">
          </label>
          <label>Total a receber (R$)
            <input type="text" inputmode="decimal" id="l-total" required value="${loan ? moneyInput(loan.valorTotal) : ''}" placeholder="0,00">
          </label>
        </div>
        <p class="hint" id="l-juros" style="margin:-6px 0 12px"></p>
        <div class="grid-2">
          <label>Nº de parcelas
            <input type="number" id="l-nparc" min="1" max="120" step="1" inputmode="numeric" required value="${formState.parcelas.length || 1}">
          </label>
          <label>1º vencimento
            <input type="date" id="l-venc" required value="${primeiroVenc}">
          </label>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin:4px 0 10px">
          <strong>Parcelas</strong>
          <button type="button" class="btn btn-sm" id="l-gerar">🔄 Recalcular parcelas</button>
        </div>
        <div id="l-parcelas"></div>
        <p class="parc-sum" id="l-soma"></p>
        <p class="hint">As datas são mensais a partir do 1º vencimento, mas você pode ajustar cada data e valor.</p>

        <label style="margin-top:14px">Observações
          <textarea id="l-obs" placeholder="Anotações livres (combinado, telefone, garantia...)">${esc(loan ? loan.obs || '' : '')}</textarea>
        </label>

        <p id="l-error" class="error" hidden></p>
        <div class="row-btns">
          <button type="button" class="btn" id="l-cancelar">Cancelar</button>
          <button type="submit" class="btn btn-primary">💾 Salvar</button>
        </div>
      </form>
    `;

    if (!formState.parcelas.length) gerarParcelas();
    else renderParcelasForm();
    updateJuros();

    $('#l-valor').addEventListener('input', updateJuros);
    $('#l-total').addEventListener('input', () => { updateJuros(); gerarParcelas(true); });
    $('#l-nparc').addEventListener('change', () => gerarParcelas());
    $('#l-venc').addEventListener('change', () => gerarParcelas());
    $('#l-gerar').addEventListener('click', () => gerarParcelas());
    $('#l-cancelar').addEventListener('click', () => {
      location.hash = loan ? `#emprestimo-${loan.id}` : '#painel';
    });
    $('#loan-form').addEventListener('submit', onLoanSubmit);
  }

  function updateJuros() {
    const v = parseMoney($('#l-valor').value);
    const t = parseMoney($('#l-total').value);
    const el = $('#l-juros');
    if (v > 0 && t > 0) {
      const lucro = t - v;
      const pct = ((lucro / v) * 100).toFixed(1).replace('.', ',');
      el.textContent = `Lucro previsto: ${fmtMoney(lucro)} (${pct}% sobre o valor emprestado)`;
    } else {
      el.textContent = '';
    }
  }

  /** Gera parcelas mensais de valor igual. Com somenteValores=true mantém as datas atuais. */
  function gerarParcelas(somenteValores) {
    const n = Math.max(1, Math.min(120, parseInt($('#l-nparc').value, 10) || 1));
    $('#l-nparc').value = n;
    const total = parseMoney($('#l-total').value);
    const venc = $('#l-venc').value || addMonths(todayISO(), 1);
    const base = total > 0 ? Math.floor((total / n) * 100) / 100 : 0;

    const novas = [];
    for (let i = 0; i < n; i++) {
      const antiga = formState.parcelas[i];
      const valor = total > 0 ? (i === n - 1 ? round2(total - base * (n - 1)) : base) : 0;
      novas.push({
        id: antiga ? antiga.id : uid(),
        vencimento: somenteValores && antiga ? antiga.vencimento : addMonths(venc, i),
        valor
      });
    }
    formState.parcelas = novas;
    renderParcelasForm();
  }

  function renderParcelasForm() {
    const box = $('#l-parcelas');
    box.innerHTML = formState.parcelas.map((p, i) => `
      <div class="parc-row">
        <span class="parc-num">${i + 1}ª</span>
        <input type="date" data-pi="${i}" data-pf="vencimento" value="${p.vencimento}" aria-label="Vencimento da parcela ${i + 1}">
        <input type="text" inputmode="decimal" data-pi="${i}" data-pf="valor" value="${moneyInput(p.valor)}" aria-label="Valor da parcela ${i + 1}">
      </div>`).join('');

    $$('[data-pi]', box).forEach((inp) =>
      inp.addEventListener('input', () => {
        const p = formState.parcelas[Number(inp.dataset.pi)];
        if (inp.dataset.pf === 'valor') p.valor = parseMoney(inp.value) || 0;
        else p.vencimento = inp.value;
        updateSoma();
      })
    );
    updateSoma();
  }

  function updateSoma() {
    const soma = round2(formState.parcelas.reduce((s, p) => s + (p.valor || 0), 0));
    const total = parseMoney($('#l-total').value);
    const el = $('#l-soma');
    const ok = total > 0 && Math.abs(soma - total) <= EPS;
    el.className = 'parc-sum' + (ok || !(total > 0) ? '' : ' bad');
    el.textContent = `Soma das parcelas: ${fmtMoney(soma)}` +
      (total > 0 && !ok ? ` — diferente do total a receber (${fmtMoney(total)})` : '');
  }

  async function onLoanSubmit(e) {
    e.preventDefault();
    const err = $('#l-error');
    err.hidden = true;

    const nome = $('#l-nome').value.trim();
    const data = $('#l-data').value;
    const valorEmprestado = parseMoney($('#l-valor').value);
    const valorTotal = parseMoney($('#l-total').value);
    const obs = $('#l-obs').value.trim();
    const parcelas = formState.parcelas.map((p) => ({ id: p.id, vencimento: p.vencimento, valor: round2(p.valor) }));

    if (!nome) return showErr(err, 'Informe o nome de quem pegou o empréstimo.');
    if (!isValidISO(data)) return showErr(err, 'Informe a data do empréstimo.');
    if (!(valorEmprestado > 0)) return showErr(err, 'Informe o valor emprestado.');
    if (!(valorTotal > 0)) return showErr(err, 'Informe o valor total a receber.');
    if (!parcelas.length) return showErr(err, 'Informe ao menos uma parcela.');
    if (parcelas.some((p) => !isValidISO(p.vencimento))) return showErr(err, 'Preencha a data de vencimento de todas as parcelas.');
    if (parcelas.some((p) => !(p.valor > 0))) return showErr(err, 'Todas as parcelas precisam ter valor maior que zero.');
    const soma = round2(parcelas.reduce((s, p) => s + p.valor, 0));
    if (Math.abs(soma - valorTotal) > EPS) {
      return showErr(err, `A soma das parcelas (${fmtMoney(soma)}) precisa ser igual ao total a receber (${fmtMoney(valorTotal)}). Use "Recalcular parcelas" ou ajuste os valores.`);
    }
    if (valorTotal < valorEmprestado &&
        !(await ask('O total a receber é menor que o valor emprestado (prejuízo). Salvar mesmo assim?', 'Salvar'))) return;
    if (!formState) return;

    parcelas.sort((a, b) => a.vencimento.localeCompare(b.vencimento));

    let loan;
    if (formState.id) {
      loan = getLoan(formState.id);
      Object.assign(loan, { nome, data, valorEmprestado, valorTotal, parcelas, obs, atualizadoEm: new Date().toISOString() });
      toast('Empréstimo atualizado.');
    } else {
      loan = {
        id: uid(), nome, data, valorEmprestado, valorTotal, parcelas, obs,
        calote: false, pagamentos: [], criadoEm: new Date().toISOString()
      };
      db.emprestimos.push(loan);
      toast('Empréstimo cadastrado.');
    }
    save();
    formState = null;
    location.hash = `#emprestimo-${loan.id}`;
  }

  // ---------------------------------------------------------------------------
  // Dados (backup, CSV, senha)
  // ---------------------------------------------------------------------------

  function renderConfig() {
    setHeader('Dados e segurança', false);
    setNav('config');
    const nPag = db.emprestimos.reduce((s, l) => s + l.pagamentos.length, 0);

    view().innerHTML = `
      <div class="card">
        <h2>Backup</h2>
        <p class="muted" style="margin-top:0">
          Seus dados ficam salvos apenas neste navegador (${db.emprestimos.length} empréstimo(s), ${nPag} pagamento(s)).
          Faça backups com frequência para não perder nada.
        </p>
        <div class="row-btns">
          <button class="btn btn-primary" id="c-export">⬇️ Exportar backup (JSON)</button>
          <button class="btn" id="c-import">⬆️ Importar backup</button>
        </div>
      </div>

      <div class="card">
        <h2>Planilha</h2>
        <p class="muted" style="margin-top:0">Exporta a lista de empréstimos em CSV (abre no Excel / Google Planilhas).</p>
        <div class="row-btns">
          <button class="btn" id="c-csv">📄 Exportar empréstimos (CSV)</button>
          <button class="btn" id="c-csv-pag">📄 Exportar pagamentos (CSV)</button>
          <button class="btn" id="c-csv-mes">📄 Exportar lucro mensal (CSV)</button>
        </div>
      </div>

      <div class="card">
        <h2>Senha</h2>
        <form id="c-senha-form" autocomplete="off">
          <label>Senha atual <input type="password" id="c-atual" required></label>
          <label>Nova senha <input type="password" id="c-nova" required></label>
          <label>Confirme a nova senha <input type="password" id="c-nova2" required></label>
          <p id="c-senha-err" class="error" hidden></p>
          <button class="btn btn-primary btn-block" type="submit">Alterar senha</button>
        </form>
        <p class="hint">A senha impede que outras pessoas abram o app neste aparelho, mas não criptografa os dados.</p>
      </div>

      <div class="card">
        <h2>Zona de perigo</h2>
        <button class="btn btn-danger btn-block" id="c-apagar">🗑️ Apagar todos os dados</button>
      </div>
    `;

    $('#c-export').addEventListener('click', exportJSON);
    $('#c-import').addEventListener('click', () => $('#import-file').click());
    $('#c-csv').addEventListener('click', exportCSV);
    $('#c-csv-pag').addEventListener('click', exportPagamentosCSV);
    $('#c-csv-mes').addEventListener('click', exportMensalCSV);
    $('#c-senha-form').addEventListener('submit', onChangePass);
    $('#c-apagar').addEventListener('click', async () => {
      if (!(await ask('Apagar TODOS os empréstimos e pagamentos?', 'Apagar', true))) return;
      if (!(await ask('Tem certeza? Recomendamos exportar um backup antes. Esta ação não pode ser desfeita.', 'Apagar tudo', true))) return;
      db = { versao: 1, emprestimos: [] };
      save();
      toast('Dados apagados.');
      renderConfig();
    });
  }

  async function onChangePass(e) {
    e.preventDefault();
    const err = $('#c-senha-err');
    err.hidden = true;
    const atual = $('#c-atual').value;
    const nova = $('#c-nova').value;
    const nova2 = $('#c-nova2').value;
    if ((await hashPass(atual)) !== store.get(PASS_KEY)) return showErr(err, 'Senha atual incorreta.');
    if (nova.length < 4) return showErr(err, 'A nova senha precisa ter pelo menos 4 caracteres.');
    if (nova !== nova2) return showErr(err, 'As novas senhas não conferem.');
    store.set(PASS_KEY, await hashPass(nova));
    if (cloud.ref) pushCloud();
    e.target.reset();
    toast('Senha alterada.');
  }

  function stamp() {
    const d = new Date();
    return toISO(d) + '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  }

  async function exportJSON() {
    const payload = {
      app: 'meus-emprestimos',
      versao: 1,
      exportadoEm: new Date().toISOString(),
      emprestimos: db.emprestimos
    };
    if (await download(`emprestimos-backup_${stamp()}.json`, JSON.stringify(payload, null, 2), 'application/json')) {
      toast('Backup exportado.');
    }
  }

  /** Valida e normaliza um empréstimo vindo de um backup. Retorna null se inválido. */
  function normalizeLoan(l) {
    if (!l || typeof l !== 'object') return null;
    const num = (v) => (typeof v === 'number' ? round2(v) : parseMoney(v));
    const loan = {
      id: String(l.id || uid()),
      nome: String(l.nome || '').trim(),
      data: String(l.data || ''),
      valorEmprestado: num(l.valorEmprestado),
      valorTotal: num(l.valorTotal),
      obs: String(l.obs || ''),
      calote: !!l.calote,
      criadoEm: l.criadoEm || new Date().toISOString(),
      parcelas: Array.isArray(l.parcelas) ? l.parcelas.map((p) => ({
        id: String((p && p.id) || uid()),
        vencimento: String((p && p.vencimento) || ''),
        valor: num(p && p.valor)
      })) : [],
      pagamentos: Array.isArray(l.pagamentos) ? l.pagamentos.map((p) => ({
        id: String((p && p.id) || uid()),
        data: String((p && p.data) || ''),
        valor: num(p && p.valor),
        obs: String((p && p.obs) || '')
      })) : []
    };
    if (l.atualizadoEm) loan.atualizadoEm = l.atualizadoEm;
    if (loan.calote && isValidISO(l.caloteEm)) loan.caloteEm = l.caloteEm;
    if (!loan.nome || !isValidISO(loan.data) || !(loan.valorEmprestado >= 0) || !(loan.valorTotal >= 0)) return null;
    if (loan.parcelas.some((p) => !isValidISO(p.vencimento) || !(p.valor >= 0))) return null;
    if (loan.pagamentos.some((p) => !isValidISO(p.data) || !(p.valor >= 0))) return null;
    if (!loan.parcelas.length) loan.parcelas = [{ id: uid(), vencimento: loan.data, valor: loan.valorTotal }];
    return loan;
  }

  function onImportFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (_) {
        return notify('Arquivo inválido: não é um backup em JSON.');
      }
      const lista = Array.isArray(parsed) ? parsed : parsed && parsed.emprestimos;
      if (!Array.isArray(lista)) return notify('Arquivo inválido: não contém empréstimos.');

      const validos = lista.map(normalizeLoan).filter(Boolean);
      const invalidos = lista.length - validos.length;
      if (!validos.length) return notify('Nenhum empréstimo válido encontrado no arquivo.');

      const msg = `O backup contém ${validos.length} empréstimo(s)` +
        (invalidos ? ` (${invalidos} inválido(s) serão ignorados)` : '') +
        '.\n\nSubstituir: apaga os dados atuais e usa só o backup.\n' +
        'Juntar: mantém os dados atuais e acrescenta o backup (empréstimos repetidos são atualizados).';
      const opcao = await choose(msg, [
        { label: 'Cancelar', value: null },
        { label: 'Juntar', value: 'juntar' },
        { label: 'Substituir', value: 'substituir', cls: 'btn-primary' }
      ]);
      if (opcao === 'substituir') {
        db = { versao: 1, emprestimos: validos };
      } else if (opcao === 'juntar') {
        const byId = new Map(db.emprestimos.map((l) => [l.id, l]));
        validos.forEach((l) => byId.set(l.id, l));
        db = { versao: 1, emprestimos: Array.from(byId.values()) };
      } else {
        return;
      }
      save();
      toast('Backup importado.');
      route();
    };
    reader.onerror = () => notify('Não foi possível ler o arquivo.');
    reader.readAsText(file);
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  const csvNum = (v) => round2(v).toFixed(2).replace('.', ',');

  function toCSV(rows) {
    // BOM + ponto e vírgula: abre corretamente no Excel em português.
    return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
  }

  async function exportCSV() {
    if (!db.emprestimos.length) return toast('Não há empréstimos para exportar.');
    const rows = [[
      'Nome', 'Data', 'Valor emprestado', 'Total a receber', 'Lucro previsto', 'Recebido',
      'Falta receber', 'Em atraso', 'Status', 'Parcelas', 'Parcelas pagas', 'Próximo vencimento', 'Observações'
    ]];
    db.emprestimos
      .slice()
      .sort((a, b) => a.data.localeCompare(b.data))
      .forEach((l) => {
        const c = calc(l);
        rows.push([
          l.nome, fmtDate(l.data), csvNum(l.valorEmprestado), csvNum(l.valorTotal),
          csvNum(l.valorTotal - l.valorEmprestado), csvNum(c.pago), csvNum(c.restante),
          csvNum(c.emAtraso), STATUS_LABEL[c.status], c.parcelas.length,
          c.parcelas.filter((p) => p.status === 'paga').length,
          c.proxima && c.status !== 'calote' ? fmtDate(c.proxima.vencimento) : '',
          l.obs || ''
        ]);
      });
    if (await download(`emprestimos_${stamp()}.csv`, toCSV(rows), 'text/csv;charset=utf-8')) toast('CSV exportado.');
  }

  async function exportPagamentosCSV() {
    const rows = [['Nome', 'Data do empréstimo', 'Data do pagamento', 'Valor', 'Observação']];
    db.emprestimos.forEach((l) =>
      l.pagamentos
        .slice()
        .sort((a, b) => a.data.localeCompare(b.data))
        .forEach((p) => rows.push([l.nome, fmtDate(l.data), fmtDate(p.data), csvNum(p.valor), p.obs || '']))
    );
    if (rows.length === 1) return toast('Não há pagamentos para exportar.');
    if (await download(`pagamentos_${stamp()}.csv`, toCSV(rows), 'text/csv;charset=utf-8')) toast('CSV exportado.');
  }

  async function exportMensalCSV() {
    const metodo = getMetodo();
    const meses = lucroPorMes(metodo);
    const keys = Object.keys(meses).sort();
    if (!keys.length) return toast('Não há dados para exportar.');
    const rows = [['Mês', 'Emprestado no mês', 'Recebido', 'Lucro', 'Perdas (calotes)', 'Lucro líquido', 'Método']];
    const nomeMetodo = metodo === 'capital' ? 'Capital volta primeiro' : 'Juros em cada pagamento';
    keys.forEach((k) => {
      const m = meses[k];
      rows.push([`${k.slice(5)}/${k.slice(0, 4)}`, csvNum(m.emprestado), csvNum(m.recebido),
        csvNum(m.lucro), csvNum(m.perdas), csvNum(m.liquido), nomeMetodo]);
    });
    if (await download(`lucro-mensal_${stamp()}.csv`, toCSV(rows), 'text/csv;charset=utf-8')) toast('CSV exportado.');
  }

  // ---------------------------------------------------------------------------
  // Inicialização
  // ---------------------------------------------------------------------------

  function init() {
    load();
    $('#lock-form').addEventListener('submit', onLockSubmit);
    $('#btn-lock').addEventListener('click', lock);
    $('#btn-back').addEventListener('click', () => history.length > 1 ? history.back() : (location.hash = '#lista'));
    $('#ask-dialog').addEventListener('cancel', (e) => { e.preventDefault(); $('#ask-dialog').close(); });
    $('#pay-form').addEventListener('submit', onPaySubmit);
    $('#pay-cancel').addEventListener('click', closePayDialog);
    $('#import-file').addEventListener('change', onImportFile);
    window.addEventListener('hashchange', route);

    // Mantém os dados sincronizados se o app estiver aberto em outra aba.
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) { load(); route(); }
    });

    if (store.get(PASS_KEY) && session.get(SESSION_KEY) === '1') unlock();
    else setupLock();
    initCloud();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
