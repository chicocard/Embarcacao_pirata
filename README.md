# Embarcação Pirata

Site de reservas, avisos no WhatsApp do capitão e atendimento automático com
inteligência artificial rodando na própria máquina — tudo dentro da conta
gratuita da Oracle Cloud.

---

## O que o sistema faz

**Para o cliente**

* Vê os roteiros e preços atualizados, escolhe a data e vê quantos lugares sobraram.
* Recebe o Pix na hora, com QR Code e código copia-e-cola, já com o valor certo.
* Envia o comprovante pela própria página.
* Consulta a situação da reserva pelo código.
* Recebe confirmação, lembrete na véspera e pedido de depoimento — tudo no WhatsApp.

**Para o Erick, no celular dele**

* Aviso de **reserva nova**, de **comprovante recebido** e de **cliente novo no WhatsApp**.
* **Resumo do dia às 7h**: quem embarca hoje, quem não pagou, o que falta conferir.
* **Entra no chat com o cliente** de dois jeitos:
  1. **Responde a mensagem de aviso** (aquele "responder" do WhatsApp, arrastando para o lado).
     O texto vai direto para o cliente. Ele nem precisa abrir a conversa.
  2. **Digita direto na conversa do cliente**. O robô percebe e se cala sozinho.
* **Comandos no próprio WhatsApp**: `#hoje`, `#reservas`, `#aprovar ABC123`,
  `#bloquear 15/03 mar ruim`, e outros. Digite `#ajuda` para a lista.
* Painel web com as reservas, os comprovantes (para ver a imagem), as conversas,
  a agenda e os preços.

**O robô (IA local)**

* Responde preço, roteiros, disponibilidade de data, o que levar, como pagar.
* **Nunca** negocia desconto, confirma pagamento ou garante data: nesses assuntos
  ele chama o Erick na hora e fica quieto.
* Preço e agenda saem do banco de dados, não da cabeça do modelo.
* Toda resposta gerada pela IA passa por uma conferência antes de sair: se citar
  um valor que não existe na tabela, ou se disser que é um robô, a resposta é
  jogada fora e o Erick é chamado.

---

## AVISO IMPORTANTE: o robô roda no número pessoal do Erick

Foi a opção escolhida, e ela funciona. Mas você precisa saber de três coisas:

1. **A Meta pode bloquear o número.** O Baileys não é uma biblioteca oficial do
   WhatsApp. O risco é baixo com uso normal, mas existe — e se acontecer, o Erick
   perde o WhatsApp **pessoal** dele, com as conversas da família junto.
   Um chip separado só do barco custa uns poucos reais por mês e elimina esse risco.
   **Fica a recomendação.** Se ele quiser trocar depois, é só mudar
   `CAPITAO_WHATSAPP` no `.env`, apagar a pasta da sessão e ler o QR Code de novo.

2. **O robô não sai respondendo todo mundo.** Por padrão (`BOT_MODO_PADRAO=palavra_chave`)
   ele só responde sozinho para quem:
   * já fez uma reserva pelo site, **ou**
   * escreveu alguma palavra do negócio (passeio, lancha, reserva, preço, mergulho…).

   A mãe do Erick mandando "chegou bem, filho?" não recebe resposta de robô.
   Grupos são ignorados sempre. Se ainda assim algum contato não deve nunca receber
   resposta automática, coloque o número em `BOT_NUMEROS_BLOQUEADOS`, ou mande `#calar`
   dentro daquela conversa.

3. **O que o Erick digita tem prioridade.** No instante em que ele escreve na
   conversa de um cliente, o robô se cala ali por 12 horas. Para devolver antes,
   ele manda `#bot` naquela conversa.

---

## O que era preciso consertar no código anterior

Vale registrar, porque são erros que se repetem quando o código é gerado por IA
sem alguém rodar:

| Problema | Consequência |
|---|---|
| `server/agents/conteudo.js` com crases escapadas (`` \` ``) | Erro de sintaxe: o arquivo não carrega. E ele não era importado em lugar nenhum, então o recurso "post:" do README **nunca existiu**. |
| `\${variavel}` escapado em `posvenda.js` e `admin.js` | O cliente receberia literalmente *"Sua reserva (${reserva_id}) está garantida"*. |
| Upload em `public/uploads/`, servido estaticamente, sem checar tipo | Qualquer pessoa na internet subia um `.html` com script e ele era servido no domínio do site. |
| `valor_centavos` vindo do formulário do cliente | Dava para registrar um pagamento de R$ 1,00 numa reserva de R$ 2.500. |
| `JWT_SECRET` com valor padrão `'secret'` | Qualquer um forjava um token de administrador. |
| Sem limite de tentativas no login | Senha descoberta por força bruta. |
| `admin.js` do front-end totalmente simulado | Os botões "aprovar" e "rejeitar" só mostravam um alerta. Nada acontecia. |
| Sem checagem de lotação | Dez pessoas reservavam o mesmo barco de 8 lugares no mesmo dia. |
| Notificação enviada direto pelo Baileys | Se o WhatsApp estivesse fora do ar no instante da reserva, o aviso se perdia para sempre. |

Todos corrigidos. Há testes automáticos cobrindo cada um deles (veja abaixo).

---

# INSTALAÇÃO — passo a passo

## Parte 1 — Preparar o servidor Oracle (uma vez só)

Você já tem a instância **ARM Ampere A1 (4 OCPU / 24 GB)**. É a máquina certa:
o modelo de IA roda com folga nela.

### 1.1 Entrar no servidor

No terminal do seu computador (PowerShell no Windows serve):

```bash
ssh -i ~/.ssh/sua-chave.key ubuntu@SEU.IP.DA.ORACLE
```

### 1.2 Conferir que a máquina é a que você pensa

```bash
uname -m        # tem que aparecer: aarch64
nproc           # tem que aparecer: 4
free -h         # tem que aparecer: algo perto de 24Gi
```

Se aparecer `x86_64` e 1 GB de RAM, é a instância micro — **ela não roda IA**.
Me avise que eu ajusto o plano.

### 1.3 Instalar o Docker

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc > /dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker $USER
```

**Saia do servidor e entre de novo** (`exit` e depois o `ssh` outra vez) para o
grupo `docker` valer. Confira:

```bash
docker run --rm hello-world
```

### 1.4 Abrir as portas

São **dois** lugares, e esquecer um dos dois é o motivo mais comum de "o site não abre".

**a) No painel da Oracle** (pelo navegador):
Networking → Virtual Cloud Networks → sua VCN → Security Lists → Default Security List
→ *Add Ingress Rules*:

| Source CIDR | IP Protocol | Destination Port |
|---|---|---|
| 0.0.0.0/0 | TCP | 80 |
| 0.0.0.0/0 | TCP | 443 |

**b) No firewall de dentro da máquina** (o Ubuntu da Oracle vem com o iptables fechado):

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

---

## Parte 2 — Instalar o sistema

### 2.1 Baixar o código

```bash
cd ~
git clone https://github.com/chicocard/Embarcacao_pirata.git
cd Embarcacao_pirata
```

### 2.2 Criar o arquivo de configuração

```bash
cp .env.example .env
nano .env
```

Preencha, no mínimo:

| Campo | O que colocar |
|---|---|
| `PIX_KEY` | A chave Pix **exata** do Erick. CPF só números, ou telefone com DDI, ou e-mail, ou chave aleatória. |
| `PIX_NOME` | Nome do recebedor, até 25 letras, **sem acento**. |
| `PIX_CIDADE` | Cidade, até 15 letras, sem acento. Ex.: `CARAVELAS`. |
| `CAPITAO_WHATSAPP` | `55` + DDD + número, só dígitos. Ex.: `5573999998888`. |
| `ADMIN_USER` | Login do painel. Ex.: `erick`. |
| `ADMIN_PASSWORD` | Uma senha longa. Use pelo menos 12 caracteres. |
| `JWT_SECRET` | Gere com o comando abaixo e cole. |
| `URL_PUBLICA` | `https://seudominio.com.br` (ou `http://SEU.IP` se ainda não tiver domínio). |

Para gerar a `JWT_SECRET`:

```bash
openssl rand -hex 32
```

Salve o arquivo: `Ctrl+O`, `Enter`, `Ctrl+X`.

**Confira que o `.env` está protegido:**

```bash
chmod 600 .env
```

### 2.3 Subir os containers

```bash
docker compose up -d --build
```

A primeira vez demora: ele baixa o Node, o Ollama e compila as dependências.
Uns 5 a 10 minutos.

### 2.4 Baixar o modelo de IA

```bash
docker compose exec ollama ollama pull qwen2.5:3b-instruct-q4_K_M
```

São cerca de 2 GB. Depois disso, teste:

```bash
docker compose exec ollama ollama run qwen2.5:3b-instruct-q4_K_M "responda apenas: ok"
```

> **Se a máquina for mais fraca do que se espera**, ou se as respostas demorarem
> mais de 30 segundos, troque por um modelo menor. No `.env`:
> `OLLAMA_MODEL=qwen2.5:1.5b-instruct-q4_K_M`, depois
> `docker compose exec ollama ollama pull qwen2.5:1.5b-instruct-q4_K_M` e
> `docker compose restart app`.

### 2.5 Conectar o WhatsApp

```bash
docker compose logs -f app
```

Vai aparecer um QR Code grande, desenhado com caracteres, no terminal.

No celular do Erick: **WhatsApp → Configurações → Aparelhos conectados →
Conectar um aparelho** → aponte a câmera para a tela do computador.

Quando aparecer `Conectado ao WhatsApp.` no log, está pronto. Saia do log com `Ctrl+C`
(isso **não** derruba o sistema; ele continua rodando).

### 2.6 Testar

No navegador: `http://SEU.IP.DA.ORACLE`

Faça uma reserva de mentira com o seu próprio número. O celular do Erick tem que
receber o aviso em poucos segundos.

---

## Parte 3 — HTTPS (faça isso antes de usar de verdade)

Sem HTTPS, a senha do painel do Erick viaja em texto puro pela internet.
Qualquer pessoa no mesmo Wi-Fi consegue ler.

### 3.1 Apontar o domínio

No painel de onde você registrou o domínio, crie um registro tipo **A** apontando
para o IP da Oracle. Espere uns minutos.

### 3.2 Configurar e subir o Caddy

```bash
nano Caddyfile      # troque "seudominio.com.br" pelo seu domínio de verdade
docker compose --profile https up -d
```

O Caddy pega o certificado gratuito sozinho e renova sozinho. Não há mais nada a fazer.

### 3.3 Atualizar a URL

No `.env`, mude `URL_PUBLICA` para `https://seudominio.com.br` e reinicie:

```bash
docker compose restart app
```

---

## Parte 4 — Primeiro acesso ao painel

1. Abra `https://seudominio.com.br/admin.html`
2. Entre com o `ADMIN_USER` e a `ADMIN_PASSWORD` do `.env`.
3. Vá em **Ajustes** e ajuste os roteiros, os preços e as fotos.
4. Ainda em Ajustes, revise **Respostas do robô** — é o que a IA sabe responder.
   Escreva do jeito que o Erick falaria.
5. **Apague a linha `ADMIN_PASSWORD` do `.env`.** Ela só serve para criar o usuário
   na primeira vez; depois disso quem manda é a senha guardada (criptografada) no banco.

```bash
nano .env           # apague a linha ADMIN_PASSWORD
docker compose restart app
```

Se o Erick esquecer a senha:

```bash
docker compose exec app node ferramentas/trocar-senha.js erick "a nova senha bem comprida"
```

---

## Como o Erick usa no dia a dia

### Recebendo um aviso

Chega no WhatsApp dele, no chat com ele mesmo:

```
NOVA RESERVA  [A7F2C1]

Cliente: Maria Souza  (cliente novo)
WhatsApp: https://wa.me/5573988887777
Roteiro: Expedição Submarina (Mergulho)
Data: 26/09/2026
Pessoas: 3
Valor: R$ 750,00

Situação: aguardando o Pix.

Responda ESTA mensagem para falar com o cliente.
```

### Falando com o cliente

**Jeito 1 — respondendo o aviso.** Arrasta a mensagem para o lado (aquele "responder"
de sempre), escreve e manda. O texto sai para a Maria. Ele nem abre a conversa dela.

**Jeito 2 — na conversa da Maria mesmo.** Abre o chat dela e escreve normalmente.
O robô percebe e se cala ali por 12 horas.

Para devolver ao robô: manda `#bot` dentro daquela conversa.

### Comandos

Digite `#ajuda` no WhatsApp dele mesmo para ver a lista. Os mais usados:

| Comando | O que faz |
|---|---|
| `#hoje` | quem embarca hoje, com link para chamar cada um |
| `#amanha` | idem, amanhã |
| `#reservas` | comprovantes esperando conferência |
| `#aprovar A7F2C1` | confirma o pagamento e avisa o cliente na hora |
| `#recusar A7F2C1` | recusa e avisa o cliente |
| `#bloquear 15/03 mar ruim` | tira o dia do site |
| `#liberar 15/03` | devolve o dia |
| `#fila` | quantos avisos estão esperando para sair |
| `post: baleia pulando hoje de manhã` | a IA devolve uma legenda pronta para o Instagram |

---

## Manutenção

```bash
# ver o que está acontecendo
docker compose logs -f app

# reiniciar depois de mexer no .env
docker compose restart app

# atualizar o código
git pull && docker compose up -d --build

# ver se está tudo vivo
curl http://localhost:3000/api/saude
```

### Backup (faça, e faça funcionar)

Todos os dados — reservas, clientes, conversas, comprovantes — ficam num volume
do Docker. Para copiar tudo para um arquivo:

```bash
docker run --rm \
  -v embarcacao_pirata_dados:/dados \
  -v $(pwd):/saida \
  alpine tar czf /saida/backup-$(date +%F).tar.gz -C /dados .
```

Guarde esse arquivo **fora do servidor**. Um backup que mora na mesma máquina
não é backup.

Para restaurar:

```bash
docker compose down
docker run --rm -v embarcacao_pirata_dados:/dados -v $(pwd):/entrada \
  alpine sh -c "rm -rf /dados/* && tar xzf /entrada/backup-2026-09-14.tar.gz -C /dados"
docker compose up -d
```

Sugestão: coloque o backup no `cron` para rodar toda madrugada.

---

## Testes

O sistema tem dois conjuntos de testes automáticos. Rode-os depois de qualquer mudança.

```bash
# 1. Site e API (precisa do servidor rodando)
node testes/rodar.js http://localhost:3000

# 2. Lógica do WhatsApp (não precisa de conexão real)
node testes/whatsapp.js
```

O segundo simula o cliente escrevendo, o Erick digitando, os comandos e as respostas
por citação — e confere que o robô fala quando deve e cala quando deve.

---

## Rodando sem Docker (para testar no seu Windows)

Se você quiser mexer no código na sua máquina antes de subir:

```bash
npm install
cp .env.example .env
# no .env, para testar sem WhatsApp e sem IA:
#   WHATSAPP_ATIVO=false
#   OLLAMA_ATIVO=false
npm start
```

Abra `http://localhost:3000`.

---

## Estrutura dos arquivos

```
server/
  config.js              lê o .env e recusa configuração inválida na hora de subir
  db.js                  esquema do banco e dados iniciais
  index.js               sobe o site, a API, o WhatsApp e as rotinas
  lib/
    pix.js               gera o Pix copia-e-cola (BR Code do Banco Central)
    sqlite.js            usa better-sqlite3, ou o SQLite do próprio Node se ele faltar
    util.js              telefone, datas, dinheiro
    log.js
  services/
    reservas.js          regras: preço, lotação, datas bloqueadas
    pagamentos.js        comprovante, aprovação, recusa
    conversas.js         quem está no comando de cada conversa: robô ou Erick
  whatsapp/
    bot.js               conexão e reconexão (Baileys)
    outbox.js            fila durável de envio, com repetição
    router.js            decide quem falou e o que fazer
    capitao.js           comandos e resposta por citação
  agents/
    llm.js               cliente do Ollama
    atendimento.js       resposta ao cliente, com conferência antes de enviar
    notificador.js       os avisos que chegam no celular
    conteudo.js          legendas para o Instagram
    posvenda.js          rotinas de horário fixo
  routes/                as rotas HTTP
  middleware/auth.js     login, senha e bloqueio por tentativa
public/                  o site e o painel (sem framework, sem build)
testes/                  os testes automáticos
ferramentas/             troca de senha pela linha de comando
```

---

## Segurança — o que está feito e o que falta

**Feito**

* Senha guardada com bcrypt, custo 12. Nunca em texto puro.
* `JWT_SECRET` obrigatória, mínimo 32 caracteres; o sistema **se recusa a subir** com
  a chave de exemplo.
* Login bloqueia por 15 minutos depois de 8 tentativas erradas do mesmo IP.
* Comprovantes fora da pasta pública, só acessíveis com login.
* Upload aceita só JPG, PNG, WEBP e PDF, até 5 MB, com nome gerado pelo servidor.
* Preço e valor calculados **sempre** no servidor.
* Cabeçalhos de segurança (helmet) e política de conteúdo restrita.
* Limite de requisições por minuto.
* Banco com chaves estrangeiras ligadas e transações nas operações de dinheiro.
* A pasta da sessão do WhatsApp está no `.gitignore` — **se ela vazar, quem tiver o
  arquivo entra no WhatsApp do Erick.** Confira que ela nunca foi para o GitHub.

**O que ainda depende de você**

1. **Rodar o HTTPS.** Sem isso, o resto perde muito do sentido.
2. **Backup automático.** Está documentado acima; falta colocar no cron.
3. **Conferir o histórico do Git.** Se em algum commit antigo entrou um `.env` com
   chave Pix ou senha, esses dados estão públicos no GitHub para sempre — apagar o
   arquivo depois não resolve. Verifique com:
   ```bash
   git log --all --full-history -- .env server/whatsapp/auth_info_baileys
   ```
   Se aparecer alguma coisa, troque a senha e a `JWT_SECRET`, e me avise para
   limparmos o histórico.
4. **Considerar o chip separado** para o WhatsApp do barco.
