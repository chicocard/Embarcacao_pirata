'use strict';

/* Site do cliente. Sem framework de proposito: um arquivo, sem build,
   carrega rapido em 3G e o Erick consegue ler o que esta escrito aqui. */

document.addEventListener('DOMContentLoaded', () => {

    const $ = (id) => document.getElementById(id);
    let roteiros = [];

    // -----------------------------------------------------------------
    function texto(valor) {
        const n = document.createTextNode(String(valor === null || valor === undefined ? '' : valor));
        return n;
    }

    function mostrar(elemento, mensagem, classe) {
        elemento.textContent = mensagem;
        elemento.className = 'status-msg' + (classe ? ' ' + classe : '');
    }

    function reais(centavos) {
        const n = Math.round(Number(centavos) || 0);
        const inteiros = String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return 'R$ ' + inteiros + ',' + String(n % 100).padStart(2, '0');
    }

    function dataBr(iso) {
        if (!iso) return '';
        const p = String(iso).split('-');
        return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
    }

    // -----------------------------------------------------------------
    // Roteiros
    // -----------------------------------------------------------------
    async function carregarRoteiros() {
        const caixa = $('lista-roteiros');
        const seletor = $('roteiro');

        try {
            const resposta = await fetch('/api/reservas/roteiros');
            roteiros = await resposta.json();
        } catch {
            caixa.textContent = 'Não consegui carregar os roteiros. Recarregue a página.';
            return;
        }

        caixa.innerHTML = '';
        roteiros.forEach(r => {
            const cartao = document.createElement('div');
            cartao.className = 'roteiro-item';

            if (r.foto_url) {
                const foto = document.createElement('img');
                foto.src = r.foto_url;
                foto.alt = r.nome;
                foto.loading = 'lazy';
                cartao.appendChild(foto);
            }

            const h3 = document.createElement('h3');
            h3.appendChild(texto(r.nome));

            const p = document.createElement('p');
            p.appendChild(texto(r.descricao || ''));

            const preco = document.createElement('div');
            preco.className = 'preco';
            preco.appendChild(texto(r.preco_formatado));

            const detalhe = document.createElement('small');
            const horas = r.duracao_min >= 1440
                ? Math.round(r.duracao_min / 1440) + ' dia(s)'
                : Math.round(r.duracao_min / 60) + 'h';
            detalhe.appendChild(texto('por pessoa · ' + horas + ' · até ' + r.capacidade_max + ' pessoas'));
            preco.appendChild(detalhe);

            cartao.append(h3, p, preco);
            caixa.appendChild(cartao);

            const opcao = document.createElement('option');
            opcao.value = r.id;
            opcao.appendChild(texto(r.nome + ' — ' + r.preco_formatado));
            seletor.appendChild(opcao);
        });

        atualizarTotal();
    }

    // -----------------------------------------------------------------
    // Total e disponibilidade
    // -----------------------------------------------------------------
    function roteiroEscolhido() {
        return roteiros.find(r => r.id === $('roteiro').value) || null;
    }

    function atualizarTotal() {
        const r = roteiroEscolhido();
        const pessoas = parseInt($('num_pessoas').value, 10);
        const alvo = $('valor-total');

        if (!r || !Number.isFinite(pessoas) || pessoas < 1) {
            alvo.textContent = 'selecione o roteiro e o número de pessoas';
            return;
        }
        alvo.textContent = reais(r.preco_centavos * pessoas) +
            '  (' + reais(r.preco_centavos) + ' × ' + pessoas + ')';
    }

    let temporizadorVagas = null;
    async function conferirVagas() {
        const r = roteiroEscolhido();
        const data = $('data_passeio').value;
        const aviso = $('aviso-vagas');

        if (!r || !data) { aviso.textContent = ''; return; }

        try {
            const resposta = await fetch(
                '/api/reservas/disponibilidade?roteiro_id=' + encodeURIComponent(r.id) +
                '&data=' + encodeURIComponent(data));
            const dados = await resposta.json();

            if (dados.bloqueada) {
                aviso.textContent = 'O capitão bloqueou essa data. Escolha outro dia.';
                aviso.style.color = 'var(--vermelho)';
            } else if (dados.vagas === 0) {
                aviso.textContent = 'Lotado nesse dia para este roteiro.';
                aviso.style.color = 'var(--vermelho)';
            } else {
                aviso.textContent = dados.vagas + ' lugar(es) disponível(is).';
                aviso.style.color = 'var(--verde)';
            }
        } catch { aviso.textContent = ''; }
    }

    ['roteiro', 'num_pessoas'].forEach(id =>
        $(id).addEventListener('input', () => { atualizarTotal(); conferirVagas(); }));

    $('data_passeio').addEventListener('change', () => {
        clearTimeout(temporizadorVagas);
        temporizadorVagas = setTimeout(conferirVagas, 150);
    });

    // data mínima: amanhã
    const amanha = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    $('data_passeio').min = amanha;

    // -----------------------------------------------------------------
    // Reserva
    // -----------------------------------------------------------------
    $('form-reserva').addEventListener('submit', async (e) => {
        e.preventDefault();
        const status = $('form-status');
        const botao = $('btn-enviar');

        const dados = {
            nome: $('nome').value.trim(),
            whatsapp: $('whatsapp').value.trim(),
            roteiro_id: $('roteiro').value,
            data_passeio: $('data_passeio').value,
            num_pessoas: parseInt($('num_pessoas').value, 10)
        };

        if (!dados.nome || !dados.whatsapp || !dados.roteiro_id || !dados.data_passeio) {
            mostrar(status, 'Preencha todos os campos.', 'error');
            return;
        }

        botao.disabled = true;
        mostrar(status, 'Registrando...', 'info');

        try {
            const resposta = await fetch('/api/reservas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dados)
            });
            const corpo = await resposta.json();

            if (!resposta.ok || !corpo.sucesso) throw new Error(corpo.erro || 'Não consegui registrar.');

            mostrar(status, 'Reserva registrada. Agora é só pagar.', 'success');

            $('res-codigo').textContent = corpo.codigo;
            $('res-roteiro').textContent = corpo.roteiro;
            $('res-data').textContent = dataBr(corpo.data_passeio);
            $('res-pessoas').textContent = corpo.num_pessoas;
            $('res-valor').textContent = corpo.valor_formatado;

            if (corpo.pix_imagem) {
                $('pix-qrcode').src = corpo.pix_imagem;
                $('pix-qrcode').classList.remove('escondido');
            } else {
                $('pix-qrcode').classList.add('escondido');
            }

            $('pix-copiacola').textContent = corpo.pix_payload;
            $('pix-area').classList.remove('escondido');
            $('comp-codigo').value = corpo.codigo;

            $('pix-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (erro) {
            mostrar(status, erro.message, 'error');
            botao.disabled = false;
        }
    });

    $('btn-copiar').addEventListener('click', async () => {
        const codigo = $('pix-copiacola').textContent;
        try {
            await navigator.clipboard.writeText(codigo);
            $('btn-copiar').textContent = 'Copiado!';
            setTimeout(() => { $('btn-copiar').textContent = 'Copiar código Pix'; }, 2500);
        } catch {
            const faixa = document.createRange();
            faixa.selectNodeContents($('pix-copiacola'));
            const selecao = window.getSelection();
            selecao.removeAllRanges();
            selecao.addRange(faixa);
        }
    });

    // -----------------------------------------------------------------
    // Comprovante
    // -----------------------------------------------------------------
    $('form-comprovante').addEventListener('submit', async (e) => {
        e.preventDefault();
        const status = $('comp-status');
        const botao = $('btn-comprovante');
        const arquivo = $('comp-arquivo').files[0];
        const codigo = $('comp-codigo').value.trim().toUpperCase();

        if (!codigo || codigo.length !== 6) { mostrar(status, 'Digite o código de 6 caracteres.', 'error'); return; }
        if (!arquivo) { mostrar(status, 'Anexe o comprovante.', 'error'); return; }
        if (arquivo.size > 5 * 1024 * 1024) { mostrar(status, 'Arquivo maior que 5 MB.', 'error'); return; }

        botao.disabled = true;
        mostrar(status, 'Enviando...', 'info');

        try {
            // o servidor aceita o código curto ou o id completo
            const consulta = await fetch('/api/reservas/' + encodeURIComponent(codigo) + '/situacao');
            if (!consulta.ok) throw new Error('Não achei essa reserva. Confira o código.');

            const dados = new FormData();
            dados.append('reserva_id', codigo);
            dados.append('comprovante', arquivo);

            const resposta = await fetch('/api/pagamentos/upload', { method: 'POST', body: dados });
            const corpo = await resposta.json();
            if (!resposta.ok || !corpo.sucesso) throw new Error(corpo.erro || 'Falha no envio.');

            mostrar(status, corpo.mensagem, 'success');
            $('form-comprovante').reset();
        } catch (erro) {
            mostrar(status, erro.message, 'error');
        } finally {
            botao.disabled = false;
        }
    });

    // -----------------------------------------------------------------
    // Consulta
    // -----------------------------------------------------------------
    $('form-consulta').addEventListener('submit', async (e) => {
        e.preventDefault();
        const alvo = $('cons-resultado');
        const codigo = $('cons-codigo').value.trim().toUpperCase();

        if (codigo.length !== 6) { mostrar(alvo, 'Digite os 6 caracteres do código.', 'error'); return; }

        try {
            const resposta = await fetch('/api/reservas/' + encodeURIComponent(codigo) + '/situacao');
            const dados = await resposta.json();
            if (!resposta.ok) throw new Error(dados.erro || 'Não encontrei.');

            alvo.className = 'status-msg';
            alvo.textContent = '';
            const lista = document.createElement('dl');
            lista.className = 'resumo-reserva';
            [['Roteiro', dados.roteiro],
             ['Data', dataBr(dados.data_passeio)],
             ['Pessoas', dados.num_pessoas],
             ['Valor', dados.valor_formatado],
             ['Situação', dados.situacao]].forEach(([rotulo, valor]) => {
                const dt = document.createElement('dt'); dt.appendChild(texto(rotulo));
                const dd = document.createElement('dd'); dd.appendChild(texto(valor));
                lista.append(dt, dd);
            });
            alvo.appendChild(lista);
        } catch (erro) {
            mostrar(alvo, erro.message, 'error');
        }
    });

    carregarRoteiros();
});
