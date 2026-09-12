const cron = require('node-cron');
const db = require('../db');
const { getSocket } = require('../whatsapp/bot'); // Usar a exportação correta

function initPosVenda() {
    // Roda todos os dias às 10:00 da manhã
    cron.schedule('0 10 * * *', async () => {
        console.log('[PosVenda] Verificando passeios concluídos...');
        
        // 2 dias atrás
        const dataAlvo = new Date();
        dataAlvo.setDate(dataAlvo.getDate() - 2);
        const dataFormatada = dataAlvo.toISOString().split('T')[0];

        const concluidos = db.prepare(`
            SELECT r.id as reserva_id, c.whatsapp, c.nome
            FROM reservas r
            JOIN clientes c ON r.cliente_id = c.id
            WHERE r.status = 'confirmada' AND r.data_passeio = ?
        `).all(dataFormatada);

        const socket = getSocket();
        if (!socket) {
            console.error('[PosVenda] Socket do WhatsApp não está ativo.');
            return;
        }

        for (const passeio of concluidos) {
            try {
                const numeroFormatado = `\${passeio.whatsapp}@s.whatsapp.net`;
                const msg = `Ahoy, \${passeio.nome}! 🏴‍☠️🚢\n\nEspero que tenha gostado da nossa aventura na Embarcação Pirata há uns dias!\nQueria te pedir um favorzinho: poderia me mandar aqui uma frase dizendo o que achou do passeio, ou uma foto bacana que você tirou?\n\nVamos adorar colocar no nosso diário de bordo (site)! 😉`;
                
                await socket.sendMessage(numeroFormatado, { text: msg });
                
                // Marca a reserva como concluída para não mandar de novo
                db.prepare("UPDATE reservas SET status = 'concluida' WHERE id = ?").run(passeio.reserva_id);
                
                // Pequena pausa para evitar ban
                await new Promise(r => setTimeout(r, 2000));
            } catch (err) {
                console.error(`Erro ao enviar pós-venda para \${passeio.whatsapp}:`, err);
            }
        }
    });
}

module.exports = { initPosVenda };
