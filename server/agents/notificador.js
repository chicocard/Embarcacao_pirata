const { getSocket } = require('../whatsapp/bot');

/**
 * Envia uma mensagem para o capitão ou número específico
 * @param {string} numero - Número no formato DDI+DDD+NUMERO (ex: 5511999999999 sem o +)
 * @param {string} mensagem - Texto da mensagem
 */
async function notificar(numero, mensagem) {
    try {
        const sock = getSocket();
        const jid = `${numero}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: mensagem });
        console.log(`[Notificador] Mensagem enviada para ${numero}`);
    } catch (error) {
        console.error(`[Notificador] Erro ao enviar mensagem para ${numero}:`, error.message);
    }
}

module.exports = {
    notificar
};
