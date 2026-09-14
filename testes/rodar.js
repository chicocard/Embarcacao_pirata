'use strict';

/**
 * Teste de ponta a ponta, sem depender de WhatsApp nem de Ollama.
 *
 * Sobe nada: assume que o servidor ja esta rodando em BASE.
 * Uso:  node testes/rodar.js  [http://localhost:3000]
 */

const BASE = process.argv[2] || process.env.BASE || 'http://localhost:3100';

let passou = 0, falhou = 0;

function ok(nome, condicao, detalhe) {
    if (condicao) { passou++; console.log('  OK   ' + nome); }
    else { falhou++; console.log('  FALHA ' + nome + (detalhe ? '  -> ' + detalhe : '')); }
}

async function json(caminho, opcoes) {
    const r = await fetch(BASE + caminho, opcoes);
    let corpo = null;
    try { corpo = await r.json(); } catch { corpo = null; }
    return { status: r.status, corpo };
}

function amanhaMais(dias) {
    const d = new Date(Date.now() + dias * 86400000);
    return d.toISOString().split('T')[0];
}

(async () => {
    console.log('Testando ' + BASE + '\n');

    // ---- 1. saude ----
    console.log('1. Servidor');
    const saude = await json('/api/saude');
    ok('responde /api/saude', saude.status === 200 && saude.corpo.ok);

    // ---- 2. roteiros ----
    console.log('\n2. Roteiros');
    const rot = await json('/api/reservas/roteiros');
    ok('lista roteiros', rot.status === 200 && Array.isArray(rot.corpo) && rot.corpo.length > 0);
    const roteiro = rot.corpo[0];
    ok('roteiro traz preco', roteiro && roteiro.preco_centavos > 0);

    // ---- 3. validacoes da reserva ----
    console.log('\n3. Validacoes (o servidor precisa recusar lixo)');
    const data = amanhaMais(10);

    const semNada = await json('/api/reservas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    ok('recusa pedido vazio', semNada.status === 400);

    const dataPassada = await json('/api/reservas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: 'Teste', whatsapp: '73999998888',
            roteiro_id: roteiro.id, data_passeio: '2020-01-01', num_pessoas: 2 })
    });
    ok('recusa data no passado', dataPassada.status === 400);

    const foneRuim = await json('/api/reservas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: 'Teste', whatsapp: '123',
            roteiro_id: roteiro.id, data_passeio: data, num_pessoas: 2 })
    });
    ok('recusa whatsapp invalido', foneRuim.status === 400);

    const acimaDaCapacidade = await json('/api/reservas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: 'Teste', whatsapp: '73999998888',
            roteiro_id: roteiro.id, data_passeio: data, num_pessoas: 99 })
    });
    ok('recusa mais pessoas que a capacidade', acimaDaCapacidade.status === 400);

    // ---- 4. reserva de verdade ----
    console.log('\n4. Reserva');
    const nova = await json('/api/reservas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: 'Joao da Silva', whatsapp: '(73) 99999-8888',
            roteiro_id: roteiro.id, data_passeio: data, num_pessoas: 2 })
    });
    ok('cria a reserva', nova.status === 200 && nova.corpo.sucesso, JSON.stringify(nova.corpo));

    const esperado = roteiro.preco_centavos * 2;
    ok('calcula o valor no servidor', nova.corpo && nova.corpo.valor_centavos === esperado,
       `esperado ${esperado}, veio ${nova.corpo && nova.corpo.valor_centavos}`);
    ok('gera o Pix copia e cola', !!(nova.corpo && nova.corpo.pix_payload &&
       nova.corpo.pix_payload.startsWith('000201')));
    ok('gera a imagem do QR Code', !!(nova.corpo && nova.corpo.pix_imagem &&
       nova.corpo.pix_imagem.startsWith('data:image/png')));
    ok('devolve codigo curto', !!(nova.corpo && nova.corpo.codigo && nova.corpo.codigo.length === 6));

    const reservaId = nova.corpo.reserva_id;
    const codigo = nova.corpo.codigo;

    // ---- 5. o cliente nao consegue forjar o valor ----
    console.log('\n5. Seguranca do pagamento');
    const formData = new FormData();
    formData.append('reserva_id', reservaId);
    formData.append('valor_centavos', '1');          // tentativa de forjar
    formData.append('comprovante', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')],
        { type: 'image/png' }), 'comprovante.png');

    const envio = await fetch(BASE + '/api/pagamentos/upload', { method: 'POST', body: formData });
    const envioCorpo = await envio.json().catch(() => ({}));
    ok('aceita o comprovante', envio.status === 200 && envioCorpo.sucesso, JSON.stringify(envioCorpo));

    // arquivo de tipo proibido
    const fd2 = new FormData();
    fd2.append('reserva_id', reservaId);
    fd2.append('comprovante', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'x.html');
    const envioRuim = await fetch(BASE + '/api/pagamentos/upload', { method: 'POST', body: fd2 });
    ok('recusa arquivo html', envioRuim.status === 400);

    // ---- 6. painel ----
    console.log('\n6. Painel do capitao');
    const semLogin = await json('/api/admin/painel');
    ok('painel exige login', semLogin.status === 401);

    const loginRuim = await json('/api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: 'erick', senha: 'errada' })
    });
    ok('recusa senha errada', loginRuim.status === 401);

    const login = await json('/api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: process.env.ADMIN_USER || 'erick',
                               senha: process.env.ADMIN_PASSWORD || 'senha-de-teste-123' })
    });
    ok('aceita a senha certa', login.status === 200 && !!login.corpo.token, JSON.stringify(login.corpo));

    const cab = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (login.corpo.token || '') };

    const painel = await json('/api/admin/painel', { headers: cab });
    ok('abre o painel', painel.status === 200);
    ok('mostra o comprovante pendente',
       painel.corpo && painel.corpo.pendentes && painel.corpo.pendentes.length >= 1);

    const valorRegistrado = painel.corpo.pendentes[0] && painel.corpo.pendentes[0].valor_centavos;
    ok('IGNORA o valor forjado pelo cliente', valorRegistrado === esperado,
       `esperado ${esperado}, gravado ${valorRegistrado}`);

    // ---- 7. aprovacao ----
    console.log('\n7. Aprovacao');
    const aprovar = await json(`/api/admin/reservas/${codigo}/aprovar`, { method: 'POST', headers: cab });
    ok('aprova pelo codigo curto', aprovar.status === 200 && aprovar.corpo.sucesso,
       JSON.stringify(aprovar.corpo));

    const situacao = await json(`/api/reservas/${codigo}/situacao`);
    ok('reserva fica confirmada', situacao.corpo && situacao.corpo.situacao === 'Confirmada',
       JSON.stringify(situacao.corpo));

    // ---- 8. mensagens na fila ----
    console.log('\n8. Fila de avisos');
    const painel2 = await json('/api/admin/painel', { headers: cab });
    const fila = (painel2.corpo && painel2.corpo.sistema && painel2.corpo.sistema.fila) || [];
    const total = fila.reduce((s, f) => s + f.n, 0);
    ok('avisos foram enfileirados', total >= 3, JSON.stringify(fila));

    const db = require('../server/db');
    const textos = db.prepare('SELECT texto FROM fila_envio').all();
    const comBug = textos.filter(t => /\$\{|\\\$/.test(t.texto));
    ok('nenhuma mensagem com ${variavel} sem substituir', comBug.length === 0,
       comBug.map(t => t.texto.substring(0, 80)).join(' | '));
    ok('mensagem do cliente cita o valor certo',
       textos.some(t => t.texto.includes('R$ ' + (esperado / 100).toFixed(2).replace('.', ','))));

    // ---- 9. atendimento sem LLM ----
    console.log('\n9. Atendimento automatico (camada sem LLM)');
    const atendimento = require('../server/agents/atendimento');
    const precos = atendimento.respostaDireta('quanto custa o passeio?');
    ok('responde preco a partir do banco', !!precos && precos.includes('R$'));
    ok('nao inventa valor', atendimento.verificarResposta('O passeio custa R$ 999,00') !== null);
    ok('aceita valor que existe na tabela',
       atendimento.verificarResposta('O passeio custa ' +
         (roteiro.preco_centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })) === null);
    ok('recusa o modelo se declarando robo',
       atendimento.verificarResposta('Sou uma inteligencia artificial e posso ajudar') !== null);
    const disp = atendimento.respostaDeDisponibilidade('tem vaga dia ' +
        data.split('-')[2] + '/' + data.split('-')[1] + '?');
    ok('responde disponibilidade de uma data', !!disp && disp.includes('lugar'));

    // ---- 10. Pix ----
    console.log('\n10. Pix');
    const pix = require('../server/lib/pix');
    const p = pix.gerarPayload({ chave: '12345678909', nome: 'Erick', cidade: 'Caravelas',
                                 valor: 150, txid: 'ABC123' });
    ok('CRC do BR Code confere', pix.crc16(p.slice(0, -4)) === p.slice(-4));
    ok('payload tem o valor', p.includes('5406150.00'));

    console.log(`\n=======================================`);
    console.log(`  ${passou} passaram, ${falhou} falharam`);
    console.log(`=======================================`);
    process.exit(falhou ? 1 : 0);
})().catch(e => { console.error('\nERRO NO TESTE:', e); process.exit(1); });
