'use strict';

/* Painel do capitão.
   Nada aqui é simulado: todos os botões falam com a API de verdade.
   (A versão anterior deste arquivo exibia dados inventados — "Jack Sparrow",
   "Anne Bonny" — e os botões só mostravam um alerta.) */

document.addEventListener('DOMContentLoaded', () => {

    const $ = (id) => document.getElementById(id);
    const CHAVE_TOKEN = 'pirata_token';
    let token = null;

    try { token = sessionStorage.getItem(CHAVE_TOKEN); } catch { token = null; }

    // ------------------------------------------------------------------
    function txt(v) { return document.createTextNode(v === null || v === undefined ? '' : String(v)); }

    function celula(conteudo) {
        const td = document.createElement('td');
        if (conteudo instanceof Node) td.appendChild(conteudo);
        else td.appendChild(txt(conteudo));
        return td;
    }

    function etiqueta(situacao) {
        const mapa = {
            confirmada: ['ok', 'Confirmada'],
            concluida: ['neutra', 'Concluída'],
            aguardando_pagamento: ['espera', 'Aguardando Pix'],
            pendente: ['espera', 'A conferir'],
            cancelada: ['ruim', 'Cancelada']
        };
        const [classe, rotulo] = mapa[situacao] || ['neutra', situacao];
        const span = document.createElement('span');
        span.className = 'etiqueta ' + classe;
        span.appendChild(txt(rotulo));
        return span;
    }

    function botao(rotulo, classe, aoClicar) {
        const b = document.createElement('button');
        b.className = 'btn-brass btn-small ' + (classe || '');
        b.appendChild(txt(rotulo));
        b.addEventListener('click', aoClicar);
        return b;
    }

    function mostrar(el, msg, classe) {
        el.textContent = msg;
        el.className = 'status-msg' + (classe ? ' ' + classe : '');
    }

    function reais(centavos) {
        const n = Math.round(Number(centavos) || 0);
        const i = String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return 'R$ ' + i + ',' + String(n % 100).padStart(2, '0');
    }

    function dataBr(iso) {
        const p = String(iso || '').split('-');
        return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : (iso || '');
    }

    function vazio(corpo, colunas, mensagem) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = colunas;
        td.style.textAlign = 'center';
        td.style.color = 'var(--tinta-fraca)';
        td.appendChild(txt(mensagem));
        tr.appendChild(td);
        corpo.appendChild(tr);
    }

    // ------------------------------------------------------------------
    async function api(caminho, opcoes = {}) {
        const cabecalhos = Object.assign({}, opcoes.headers || {});
        if (token) cabecalhos.Authorization = 'Bearer ' + token;
        if (opcoes.body && !cabecalhos['Content-Type']) cabecalhos['Content-Type'] = 'application/json';

        const r = await fetch('/api/admin' + caminho, Object.assign({}, opcoes, { headers: cabecalhos }));
        if (r.status === 401) { sair(); throw new Error('Sessão expirada.'); }

        const corpo = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(corpo.erro || 'Erro na operação.');
        return corpo;
    }

    // ------------------------------------------------------------------
    // Login
    // ------------------------------------------------------------------
    $('form-login').addEventListener('submit', async (e) => {
        e.preventDefault();
        const status = $('login-status');
        mostrar(status, 'Entrando...', 'info');
        try {
            const r = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usuario: $('login-usuario').value, senha: $('login-senha').value })
            });
            const corpo = await r.json();
            if (!r.ok) throw new Error(corpo.erro || 'Falha no login.');

            token = corpo.token;
            try { sessionStorage.setItem(CHAVE_TOKEN, token); } catch { /* modo privado */ }
            entrar();
        } catch (erro) {
            mostrar(status, erro.message, 'error');
        }
    });

    function sair() {
        token = null;
        try { sessionStorage.removeItem(CHAVE_TOKEN); } catch { /* nada */ }
        $('tela-painel').classList.add('escondido');
        $('tela-login').classList.remove('escondido');
    }

    $('btn-sair').addEventListener('click', (e) => { e.preventDefault(); sair(); });

    function entrar() {
        $('tela-login').classList.add('escondido');
        $('tela-painel').classList.remove('escondido');
        carregarPainel();
        carregarBloqueios();
        carregarAjustes();
    }

    // ------------------------------------------------------------------
    // Abas
    // ------------------------------------------------------------------
    document.querySelectorAll('[data-aba]').forEach(el => {
        if (el.tagName !== 'A') return;
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const alvo = el.dataset.aba;
            document.querySelectorAll('section.aba').forEach(s => {
                s.classList.toggle('escondido', s.dataset.aba !== alvo);
            });
            if (alvo === 'reservas') carregarReservas();
            if (alvo === 'conversas') carregarConversas();
        });
    });

    // ------------------------------------------------------------------
    // Painel
    // ------------------------------------------------------------------
    async function carregarPainel() {
        let dados;
        try { dados = await api('/painel'); } catch { return; }

        const cartoes = $('cartoes');
        cartoes.innerHTML = '';
        [['Passeios hoje', dados.hoje.length],
         ['A conferir', dados.pendentes.length],
         ['Sem comprovante', dados.sem_comprovante.length],
         ['Clientes', dados.totais.clientes],
         ['Confirmadas', dados.totais.confirmadas],
         ['Faturado', dados.totais.faturado_formatado]].forEach(([rotulo, valor]) => {
            const c = document.createElement('div');
            c.className = 'cartao';
            const n = document.createElement('div'); n.className = 'numero'; n.appendChild(txt(valor));
            const r = document.createElement('div'); r.className = 'rotulo'; r.appendChild(txt(rotulo));
            c.append(n, r);
            cartoes.appendChild(c);
        });

        const s = dados.sistema;
        const naFila = (s.fila.find(f => f.status === 'pendente') || {}).n || 0;
        $('barra-sistema').textContent =
            'WhatsApp: ' + (s.whatsapp ? 'conectado' : 'DESCONECTADO') +
            '  ·  Robô (IA): ' + (s.llm ? 'ativo' : 'fora do ar') +
            '  ·  Avisos na fila: ' + naFila;

        preencherPasseios($('tab-hoje'), dados.hoje);
        preencherPasseios($('tab-amanha'), dados.amanha);
        preencherConferir(dados.pendentes);
        preencherSemComprovante(dados.sem_comprovante);
    }

    function preencherPasseios(corpo, lista) {
        corpo.innerHTML = '';
        if (!lista.length) { vazio(corpo, 6, 'Nenhum passeio.'); return; }

        lista.forEach(r => {
            const tr = document.createElement('tr');
            const link = document.createElement('a');
            link.href = 'https://wa.me/' + r.cliente_whatsapp;
            link.target = '_blank';
            link.rel = 'noopener';
            link.appendChild(txt('chamar'));

            tr.append(
                celula(r.roteiro_nome),
                celula(r.cliente_nome),
                celula(r.num_pessoas),
                celula(reais(r.valor_centavos)),
                celula(etiqueta(r.status)),
                celula(link)
            );
            corpo.appendChild(tr);
        });
    }

    function preencherConferir(lista) {
        const corpo = $('tab-conferir');
        corpo.innerHTML = '';
        if (!lista.length) { vazio(corpo, 6, 'Nada para conferir.'); return; }

        lista.forEach(p => {
            const tr = document.createElement('tr');
            const acoes = document.createElement('div');

            acoes.append(
                botao('ver comprovante', 'btn-neutro', () => abrirComprovante(p.comprovante_arquivo)),
                botao('aprovar', '', async (e) => {
                    e.target.disabled = true;
                    try { await api('/reservas/' + p.reserva_id + '/aprovar', { method: 'POST' }); carregarPainel(); }
                    catch (erro) { alert(erro.message); e.target.disabled = false; }
                }),
                botao('recusar', 'btn-perigo', async (e) => {
                    if (!confirm('Recusar o pagamento de ' + p.nome + '? A reserva será cancelada e o cliente avisado.')) return;
                    e.target.disabled = true;
                    try { await api('/reservas/' + p.reserva_id + '/recusar', { method: 'POST', body: '{}' }); carregarPainel(); }
                    catch (erro) { alert(erro.message); e.target.disabled = false; }
                })
            );

            const codigo = document.createElement('code');
            codigo.appendChild(txt(String(p.reserva_id).replace(/-/g, '').substring(0, 6).toUpperCase()));

            tr.append(
                celula(codigo),
                celula(p.nome),
                celula(p.roteiro_nome),
                celula(dataBr(p.data_passeio)),
                celula(reais(p.valor_centavos)),
                celula(acoes)
            );
            corpo.appendChild(tr);
        });
    }

    function preencherSemComprovante(lista) {
        const corpo = $('tab-sem-comprovante');
        corpo.innerHTML = '';
        if (!lista.length) { vazio(corpo, 6, 'Nenhuma.'); return; }

        lista.forEach(r => {
            const tr = document.createElement('tr');
            const link = document.createElement('a');
            link.href = 'https://wa.me/' + r.whatsapp;
            link.target = '_blank'; link.rel = 'noopener';
            link.appendChild(txt('cobrar'));

            const codigo = document.createElement('code');
            codigo.appendChild(txt(String(r.reserva_id).replace(/-/g, '').substring(0, 6).toUpperCase()));

            tr.append(celula(codigo), celula(r.nome), celula(r.roteiro_nome),
                      celula(dataBr(r.data_passeio)), celula(reais(r.valor_centavos)), celula(link));
            corpo.appendChild(tr);
        });
    }

    /* O comprovante fica fora da pasta pública e só sai por rota autenticada,
       então não dá para usar <img src>. Buscamos com o token e abrimos o blob. */
    async function abrirComprovante(arquivo) {
        try {
            const r = await fetch('/api/pagamentos/comprovante/' + encodeURIComponent(arquivo), {
                headers: { Authorization: 'Bearer ' + token }
            });
            if (!r.ok) throw new Error('Não consegui abrir o comprovante.');
            const blob = await r.blob();
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank', 'noopener');
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (erro) { alert(erro.message); }
    }

    // ------------------------------------------------------------------
    // Todas as reservas
    // ------------------------------------------------------------------
    async function carregarReservas() {
        const corpo = $('tab-reservas');
        corpo.innerHTML = '';
        const status = $('filtro-status').value;

        let lista;
        try { lista = await api('/reservas' + (status ? '?status=' + status : '')); } catch { return; }
        if (!lista.length) { vazio(corpo, 7, 'Nenhuma reserva.'); return; }

        lista.forEach(r => {
            const tr = document.createElement('tr');
            const codigo = document.createElement('code');
            codigo.appendChild(txt(r.codigo));
            tr.append(celula(codigo), celula(r.data_formatada), celula(r.nome),
                      celula(r.roteiro_nome), celula(r.num_pessoas),
                      celula(r.valor_formatado), celula(etiqueta(r.status)));
            corpo.appendChild(tr);
        });
    }

    $('filtro-status').addEventListener('change', carregarReservas);

    // ------------------------------------------------------------------
    // Conversas
    // ------------------------------------------------------------------
    let jidAberto = null;

    async function carregarConversas() {
        const caixa = $('lista-conversas');
        caixa.innerHTML = '';

        let lista;
        try { lista = await api('/conversas'); } catch { return; }
        if (!lista.length) {
            caixa.appendChild(txt('Nenhuma conversa nas últimas 72 horas.'));
            return;
        }

        const rotulos = { bot: ['espera', 'Robô atendendo'], humano: ['ok', 'Você assumiu'],
                          silencio: ['ruim', 'Silenciada'], novo: ['neutra', 'Não classificada'] };

        lista.forEach(c => {
            const item = document.createElement('div');
            item.className = 'conversa-item';

            const esquerda = document.createElement('div');
            const nome = document.createElement('strong');
            nome.appendChild(txt(c.nome || c.telefone));
            const sub = document.createElement('div');
            sub.style.fontSize = '.82rem';
            sub.style.color = 'var(--tinta-fraca)';
            sub.appendChild(txt(c.telefone));
            esquerda.append(nome, sub);

            const [classe, rotulo] = rotulos[c.modo] || ['neutra', c.modo];
            const marca = document.createElement('span');
            marca.className = 'etiqueta ' + classe;
            marca.appendChild(txt(rotulo));

            const direita = document.createElement('div');
            direita.append(marca, ' ', botao('abrir', 'btn-neutro', () => abrirConversa(c)));

            item.append(esquerda, direita);
            caixa.appendChild(item);
        });
    }

    async function abrirConversa(conversa) {
        jidAberto = conversa.jid;
        $('janela-conversa').classList.remove('escondido');
        $('conversa-titulo').textContent = (conversa.nome || conversa.telefone) + ' — ' + conversa.telefone;

        const caixa = $('conversa-mensagens');
        caixa.innerHTML = '';

        let mensagens;
        try { mensagens = await api('/conversas/' + encodeURIComponent(conversa.jid) + '/mensagens'); }
        catch { return; }

        const quem = { cliente: 'Cliente', bot: 'Robô', capitao: 'Você', sistema: 'Sistema' };
        mensagens.forEach(m => {
            const balao = document.createElement('div');
            balao.className = 'balao ' + m.autor;
            const rotulo = document.createElement('span');
            rotulo.className = 'quem';
            rotulo.appendChild(txt(quem[m.autor] || m.autor));
            balao.append(rotulo, txt(m.texto));
            caixa.appendChild(balao);
        });
        caixa.scrollTop = caixa.scrollHeight;
    }

    $('btn-conversa-enviar').addEventListener('click', async () => {
        const texto = $('conversa-texto').value.trim();
        if (!jidAberto || !texto) return;
        try {
            await api('/conversas/' + encodeURIComponent(jidAberto) + '/enviar',
                      { method: 'POST', body: JSON.stringify({ texto }) });
            $('conversa-texto').value = '';
            mostrar($('conversa-status'), 'Enviado. O robô ficou calado nessa conversa.', 'success');
            carregarConversas();
        } catch (erro) { mostrar($('conversa-status'), erro.message, 'error'); }
    });

    async function trocarModo(modo, mensagem) {
        if (!jidAberto) return;
        try {
            await api('/conversas/' + encodeURIComponent(jidAberto) + '/modo',
                      { method: 'POST', body: JSON.stringify({ modo }) });
            mostrar($('conversa-status'), mensagem, 'success');
            carregarConversas();
        } catch (erro) { mostrar($('conversa-status'), erro.message, 'error'); }
    }

    $('btn-conversa-bot').addEventListener('click', () => trocarModo('bot', 'O robô voltou a atender.'));
    $('btn-conversa-calar').addEventListener('click', () => trocarModo('silencio', 'Conversa silenciada.'));

    // ------------------------------------------------------------------
    // Agenda
    // ------------------------------------------------------------------
    async function carregarBloqueios() {
        const corpo = $('tab-bloqueios');
        corpo.innerHTML = '';

        let lista;
        try { lista = await api('/bloqueios'); } catch { return; }
        if (!lista.length) { vazio(corpo, 3, 'Nenhuma data bloqueada.'); return; }

        lista.forEach(b => {
            const tr = document.createElement('tr');
            tr.append(
                celula(dataBr(b.data_passeio)),
                celula(b.motivo || '-'),
                celula(botao('liberar', 'btn-perigo', async () => {
                    await api('/bloqueios/' + b.data_passeio, { method: 'DELETE' });
                    carregarBloqueios();
                }))
            );
            corpo.appendChild(tr);
        });
    }

    $('form-bloqueio').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await api('/bloqueios', { method: 'POST',
                body: JSON.stringify({ data: $('bloq-data').value, motivo: $('bloq-motivo').value }) });
            $('form-bloqueio').reset();
            carregarBloqueios();
        } catch (erro) { alert(erro.message); }
    });

    // ------------------------------------------------------------------
    // Ajustes
    // ------------------------------------------------------------------
    async function carregarAjustes() {
        const caixaR = $('lista-roteiros-admin');
        caixaR.innerHTML = '';

        let roteiros;
        try { roteiros = await api('/roteiros'); } catch { return; }

        roteiros.forEach(r => {
            const bloco = document.createElement('div');
            bloco.className = 'cartao';
            bloco.style.marginBottom = '12px';

            const nome = document.createElement('input');
            nome.value = r.nome;

            const desc = document.createElement('textarea');
            desc.rows = 2; desc.value = r.descricao || '';

            const preco = document.createElement('input');
            preco.type = 'number'; preco.step = '0.01'; preco.min = '0';
            preco.value = (r.preco_centavos / 100).toFixed(2);

            const capacidade = document.createElement('input');
            capacidade.type = 'number'; capacidade.min = '1'; capacidade.value = r.capacidade_max || 10;

            const foto = document.createElement('input');
            foto.placeholder = 'https://... ou /fotos/lancha.jpg';
            foto.value = r.foto_url || '';

            const ativo = document.createElement('input');
            ativo.type = 'checkbox'; ativo.checked = !!r.ativo;

            const rotulo = (t, el) => {
                const d = document.createElement('div'); d.className = 'form-group';
                const l = document.createElement('label'); l.appendChild(txt(t));
                d.append(l, el); return d;
            };

            const linhaAtivo = document.createElement('label');
            linhaAtivo.style.display = 'flex'; linhaAtivo.style.gap = '8px'; linhaAtivo.style.alignItems = 'center';
            ativo.style.width = 'auto';
            linhaAtivo.append(ativo, txt('Aparece no site'));

            bloco.append(
                rotulo('Nome', nome),
                rotulo('Descrição', desc),
                rotulo('Preço por pessoa (R$)', preco),
                rotulo('Capacidade máxima', capacidade),
                rotulo('Foto (endereço da imagem)', foto),
                linhaAtivo,
                botao('Salvar', '', async (e) => {
                    e.target.disabled = true;
                    try {
                        await api('/roteiros/' + r.id, { method: 'PUT', body: JSON.stringify({
                            nome: nome.value,
                            descricao: desc.value,
                            preco_centavos: Math.round(parseFloat(preco.value) * 100),
                            duracao_min: r.duracao_min,
                            capacidade_max: parseInt(capacidade.value, 10),
                            foto_url: foto.value.trim(),
                            ativo: ativo.checked
                        }) });
                        e.target.textContent = 'Salvo';
                        setTimeout(() => { e.target.textContent = 'Salvar'; e.target.disabled = false; }, 1800);
                    } catch (erro) { alert(erro.message); e.target.disabled = false; }
                })
            );
            caixaR.appendChild(bloco);
        });

        const caixaC = $('lista-conhecimento');
        caixaC.innerHTML = '';

        let conhecimento;
        try { conhecimento = await api('/conhecimento'); } catch { return; }

        conhecimento.forEach(k => {
            const bloco = document.createElement('div');
            bloco.className = 'cartao';
            bloco.style.marginBottom = '12px';

            const pergunta = document.createElement('input');
            pergunta.value = k.pergunta;

            const resposta = document.createElement('textarea');
            resposta.rows = 3; resposta.value = k.resposta;

            const l1 = document.createElement('label'); l1.appendChild(txt('Assunto'));
            const l2 = document.createElement('label'); l2.appendChild(txt('O que o robô responde'));

            bloco.append(l1, pergunta, l2, resposta,
                botao('Salvar', '', async (e) => {
                    e.target.disabled = true;
                    try {
                        await api('/conhecimento/' + k.id, { method: 'PUT',
                            body: JSON.stringify({ pergunta: pergunta.value, resposta: resposta.value, ativo: true }) });
                        e.target.textContent = 'Salvo';
                        setTimeout(() => { e.target.textContent = 'Salvar'; e.target.disabled = false; }, 1800);
                    } catch (erro) { alert(erro.message); e.target.disabled = false; }
                }));
            caixaC.appendChild(bloco);
        });
    }

    $('form-senha').addEventListener('submit', async (e) => {
        e.preventDefault();
        const status = $('senha-status');
        try {
            await api('/senha', { method: 'POST', body: JSON.stringify({
                senha_atual: $('senha-atual').value, senha_nova: $('senha-nova').value }) });
            mostrar(status, 'Senha trocada.', 'success');
            $('form-senha').reset();
        } catch (erro) { mostrar(status, erro.message, 'error'); }
    });

    // ------------------------------------------------------------------
    if (token) entrar(); else sair();
    setInterval(() => { if (token) carregarPainel(); }, 60000);
});
