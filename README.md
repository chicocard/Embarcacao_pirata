# Embarcação Pirata 🏴‍☠️

Sistema completo de reservas de lancha, atendimento via WhatsApp com Inteligência Artificial, e painel administrativo, projetado para rodar gratuitamente.

## 🚀 Como instalar e rodar (Passo a Passo)

Este guia foi feito para que qualquer pessoa consiga rodar o sistema, mesmo sem ser programador. Siga as etapas abaixo com atenção!

### Passo 1: Instalar os programas necessários
1. **Node.js**: Baixe e instale a versão LTS (recomendada) em [nodejs.org](https://nodejs.org/).
2. **Ollama** (A Inteligência Artificial):
   - Baixe em [ollama.com](https://ollama.com) e instale.
   - Abra seu terminal (Prompt de Comando ou PowerShell) e digite:
     \`\`\`bash
     ollama run qwen2.5:3b
     \`\`\`
   - Isso vai baixar o "cérebro" da IA. Pode demorar uns minutinhos dependendo da internet. Quando terminar, você pode fechar o terminal.

### Passo 2: Configurar o projeto
1. Baixe os arquivos deste projeto para o seu computador.
2. Abra a pasta do projeto no seu terminal.
3. Instale as dependências (as pecinhas que o sistema usa):
   \`\`\`bash
   npm install
   \`\`\`
4. Crie uma cópia do arquivo \`.env.example\` e mude o nome para \`.env\`.
5. Abra esse arquivo \`.env\` num bloco de notas e preencha as suas informações:
   - \`PIX_KEY\`: A sua chave Pix exata.
   - \`ERICK_WHATSAPP\`: Seu número com DDD (ex: 5573999999999). É para ele que os avisos vão chegar.
   - \`ADMIN_USER\` e \`ADMIN_PASSWORD\`: O login e senha que você usará para entrar no painel.

### Passo 3: Rodar o Sistema
No terminal, dentro da pasta do projeto, digite:
\`\`\`bash
npm start
\`\`\`

1. **Conectando o WhatsApp**: O terminal vai exibir um "QR Code" gigante de texto. Abra o WhatsApp no seu celular, vá em Aparelhos Conectados, e escaneie a tela do computador, igual faz no WhatsApp Web.
2. **Site no ar**: Assim que conectar, abra seu navegador e acesse:
   - Para o site do cliente: \`http://localhost:3000\`
   - Para o painel de aprovação: \`http://localhost:3000/admin.html\`

## 🛠️ Como usar os Agentes de IA
- **Atendimento Mágico**: Se um turista mandar mensagem para o número que você escaneou o QR code, o bot vai responder sozinho as perguntas comuns (preços, roteiros) usando o Ollama!
- **Criador de Legendas**: Se VOCÊ mandar uma mensagem (do número configurado como \`ERICK_WHATSAPP\`) começando com \`post: \` (Exemplo: *post: baleia jubarte pulando hoje*), a IA vai te mandar de volta uma legenda pronta e pirata para você copiar e colar no Instagram!
- **Pós-venda**: A cada dois dias após um passeio, o sistema vai mandar uma mensagem automática pro turista pedindo uma foto ou depoimento.

## ☁️ Colocando na Nuvem (Grátis)
Para deixar 24h ligado sem usar seu PC, recomendamos criar uma conta na **Oracle Cloud** (plano Always Free), que te dá um servidor de graça para sempre. Basta seguir os mesmos passos acima lá dentro!
