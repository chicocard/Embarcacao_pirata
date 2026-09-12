const http = require('http');

function gerarLegendaOllama(descricaoFoto) {
    return new Promise((resolve, reject) => {
        const prompt = \`Você é o capitão Erick Zebedeu da Embarcação Pirata, passeios de lancha em Caravelas, Bahia. 
O tema é diário de bordo e pirata amigável.
Crie uma legenda curta (máximo 4 linhas) e engajadora para o Instagram sobre esta foto/vídeo: "\${descricaoFoto}".
Não inclua aspas na resposta, apenas a legenda pronta e adicione algumas hashtags.\`;

        const data = JSON.stringify({
            model: process.env.OLLAMA_MODEL || 'qwen2.5:3b',
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
                'Content-Length': data.length
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    resolve(json.response.trim());
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', e => reject(e));
        req.write(data);
        req.end();
    });
}

async function handleConteudoMessage(mensagem, responder) {
    if (mensagem.toLowerCase().startsWith('post: ')) {
        const descricao = mensagem.substring(6).trim();
        try {
            const legenda = await gerarLegendaOllama(descricao);
            await responder(\`🏴‍☠️ *Sugestão de Legenda:*\n\n\${legenda}\`);
        } catch (error) {
            console.error('Erro ao gerar legenda:', error);
            await responder('Ahoy! Tive um problema no maquinário (Ollama) ao gerar a legenda.');
        }
        return true; // handled
    }
    return false; // not handled
}

module.exports = { handleConteudoMessage };
