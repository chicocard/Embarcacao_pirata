const { getSocket } = require('../whatsapp/bot');
const http = require('http'); // Usando módulo nativo para evitar dependências extras

/**
 * Envia requisição para a API local do Ollama
 * @param {string} prompt - Mensagem do usuário
 * @returns {Promise<string>} - Resposta do LLM
 */
function chamarOllama(prompt) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            model: "llama3", // Modifique para o modelo local desejado
            prompt: prompt,
            stream: false
        });

        const options = {
            hostname: 'localhost',
            port: 11434,
            path: '/api/generate',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const json = JSON.parse(body);
                        resolve(json.response);
                    } catch (e) {
                        reject(new Error('Erro ao parsear resposta do Ollama'));
                    }
                } else {
                    reject(new Error(`Ollama API retornou status ${res.statusCode}`));
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(data);
        req.end();
    });
}

/**
 * Configura o listener para interceptar mensagens recebidas e responder via Ollama
 */
function iniciarAtendimento() {
    const sock = getSocket();
    
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        
        // Ignorar mensagens enviadas por nós mesmos, status, ou que não sejam texto simples
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') return;
        
        const texto = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!texto) return;

        const remetente = msg.key.remoteJid;
        console.log(`[Atendimento] Mensagem recebida de ${remetente}: ${texto}`);

        try {
            // Chamada assíncrona ao Ollama usando a interface REST local
            const respostaBot = await chamarOllama(texto);
            
            // Responde no WhatsApp usando o Baileys
            await sock.sendMessage(remetente, { text: respostaBot });
            console.log(`[Atendimento] Resposta enviada para ${remetente}`);
        } catch (error) {
            console.error('[Atendimento] Erro ao processar:', error.message);
        }
    });
}

module.exports = {
    iniciarAtendimento,
    chamarOllama
};
