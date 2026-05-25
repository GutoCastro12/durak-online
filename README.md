# Durak Online 🃏

Jogo de cartas Durak multiplayer em tempo real. Crie uma sala, mande o link pros amigos e joguem juntos. Lugares vazios viram bots.

## O que tem aqui

- `server.js` — servidor (Node + WebSocket). É a "fonte da verdade": roda as regras, valida cada jogada e sincroniza todos em tempo real. Cada jogador só recebe as próprias cartas (ninguém vê a mão do outro).
- `engine.js` — o motor de regras do Durak (o mesmo validado em +100 mil partidas).
- `public/index.html` — o jogo no navegador (tela inicial, sala de espera e mesa).
- `package.json`, `render.yaml` — configuração pra hospedar.

## Rodar no seu computador (teste rápido)

Você precisa do Node.js 18 ou superior instalado.

```bash
npm install
npm start
```

Abra `http://localhost:3000` no navegador. Pra testar com "amigos" na mesma máquina, abra várias abas.

## Publicar de graça (pra jogar com amigos pela internet)

A forma mais simples é o **Render** (tem plano gratuito). Passo a passo:

### 1. Coloque o código no GitHub
- Crie uma conta no GitHub (se não tiver).
- Crie um repositório novo (ex: `durak-online`).
- Suba estes arquivos pra lá. Pelo site do GitHub dá pra arrastar os arquivos direto em "Add file → Upload files". **Não suba a pasta `node_modules`** (o `.gitignore` já cuida disso se você usar git).

### 2. Crie o serviço no Render
- Acesse https://render.com e entre com sua conta do GitHub.
- Clique em **New → Web Service**.
- Escolha o repositório `durak-online`.
- O Render lê o arquivo `render.yaml` e preenche tudo sozinho. Se pedir manualmente:
  - **Build Command:** `npm install`
  - **Start Command:** `node server.js`
  - **Plan:** Free
- Clique em **Create Web Service** e aguarde alguns minutos.

### 3. Pronto!
- O Render te dá um endereço tipo `https://durak-online.onrender.com`.
- Abra esse endereço, clique em **Criar e convidar**, e mande o link da sala (ex: `https://durak-online.onrender.com/sala/AB12`) pros seus amigos.

> Observação sobre o plano gratuito do Render: se ninguém usar por uns 15 minutos, o servidor "dorme" e a primeira visita seguinte demora ~30s pra acordar. Depois disso fica normal. É só esperar a primeira tela carregar.

### Alternativa: Railway ou Fly.io
Funcionam igual — conectam no GitHub e detectam Node automaticamente. Use os mesmos comandos (`npm install` / `node server.js`).

## Como jogar

1. **Criar sala:** digite seu nome, escolha quantos lugares (2 a 6) e clique em criar.
2. **Convidar:** copie o link e mande pros amigos. Cada um abre, digita o nome e entra.
3. **Bots:** o anfitrião pode adicionar/remover bots pra preencher os lugares.
4. **Começar:** só o anfitrião começa. Lugares vazios viram bots automaticamente.
5. Na mesa: toque nas cartas destacadas pra jogar; botões pra atacar, transferir, pegar ou passar. Você sempre aparece embaixo.

Se alguém cair, um bot assume o lugar e a pessoa pode voltar reabrindo o link (volta pro mesmo assento).
