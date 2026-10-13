# Grade Agora TV

Player IPTV para PC que roda no navegador (deploy na Vercel), com guia de programacao (EPG) e
**gravacao agendada pela EPG — inclusive todo dia no horario do programa**. A grade de TV
aberta/fechada original continua disponivel em `#/grade`.

## Player IPTV

- **Playlists M3U** (URL ou arquivo do PC, com `url-tvg`, `tvg-id`, `group-title`, `#EXTVLCOPT`) e
  **Xtream Codes** (ao vivo, filmes e series). Links `get.php?username=...` viram Xtream automaticamente.
- Reproducao HLS (hls.js), MPEG-TS (mpegts.js) e MP4; troca automatica entre `.m3u8`/`.ts` e
  direto/proxy quando um caminho falha. Favoritos, busca, grupos, PageUp/PageDown para zapear,
  tela cheia (duplo clique) e picture-in-picture.
- **EPG**: por canal via API Xtream, XMLTV do provedor, ou qualquer URL XMLTV (`.xml`/`.xml.gz`) —
  inclusive a EPG brasileira deste repositorio (`/epg/br-priority.xml`). Casa canais por `tvg-id`
  ou pelo nome ("BR: Globo SP FHD" = "Globo SP"). Ajuste de fuso por playlist.
- **Guia** em grade (24 h) por grupo.

### Gravacao

- **Gravar agora**: ate o fim do programa atual, por X minutos ou ate parar.
- **Gravar esta exibicao**: qualquer programa futuro da EPG.
- **Todo dia (EPG)**: procura o titulo na EPG todos os dias e grava no horario em que ele passar.
  Por padrao so considera exibicoes perto do horario habitual (±1h30) para nao gravar reprises;
  se a emissora atrasar/estender o programa, a gravacao acompanha a EPG. Opcional: gravar no
  horario habitual quando a EPG do dia estiver vazia.
- **Horario fixo**: dias da semana + hora + duracao, sem depender da EPG.
- Margens antes/depois configuraveis.

### Gravador do PC (grava com o site fechado)

O gravador do PC (`server/local`) roda escondido no seu computador, junto com o proxy local. O
site sincroniza com ele os agendamentos; ele consulta a EPG sozinho, grava e salva os arquivos numa
pasta do PC (padrao: `Videos\Grade Agora`). **Nao precisa deixar o site aberto** — so o PC ligado
e com internet. Enquanto houver agendamentos ativos ele impede o Windows de suspender sozinho.

No Windows, de dois cliques em `scripts\windows\instalar-proxy.cmd` (ou rode no PowerShell). Ele
instala as dependencias, gera o gravador, inicia escondido e configura para iniciar com o Windows
(se cair, reinicia). Depois, no site, em **Ajustes > Endereco do proxy**, use
`http://127.0.0.1:8787/api/proxy`: o site detecta o gravador e passa a usa-lo. Log em
`%LOCALAPPDATA%\GradeAgoraProxy.log`; estado em `%LOCALAPPDATA%\GradeAgora\estado.json`. Para
remover: `scripts\windows\desinstalar-proxy.cmd`. Em outros sistemas: `npm run local`.

Sem o gravador do PC, o site grava pelo proprio navegador (Web Worker + armazenamento do
navegador, movendo para uma pasta escolhida no Chrome/Edge) — nesse modo a aba precisa ficar
aberta. Arquivos `.ts` abrem no VLC; para `.mp4`: `ffmpeg -i in.ts -c copy out.mp4`.

### Proxy (`/api/proxy`)

Servidores IPTV quase nunca liberam CORS e costumam ser `http://`, que uma pagina `https` nao
pode acessar. A funcao `api/proxy.js` repassa as requisicoes (com User-Agent de VLC), libera CORS
e reescreve playlists HLS. Ela recusa uso por outros sites e hosts de rede privada.

Limites da Vercel: cada requisicao dura no maximo 5 min (o player e o gravador reconectam
sozinhos) e todo o video passa pela sua cota de trafego. Alguns provedores tambem recusam video
para IPs de datacenter (erro HTTP 520/403 no player). Por isso o recomendado e usar o proxy do
gravador do PC (`http://127.0.0.1:8787/api/proxy`): o video sai do seu IP, como no VLC.

Audio AC-3/Dolby nao toca no Chrome (limitacao do navegador); o Edge costuma tocar. A gravacao
funciona em qualquer caso.

Playlists, senhas e agendamentos ficam salvos apenas no navegador.

## Grade de TV (`#/grade`)

### O que esta pronto

- Grade horizontal por canal e horario.
- Busca por programa, filme, jogo, canal ou categoria.
- Filtros por TV aberta, esportes, filmes, series e noticias.
- Sugestoes do dia com prioridade para futebol.
- Detalhe do programa selecionado com proximas exibicoes.
- Layout responsivo para desktop e celular.

### Dados de programacao

O app prioriza fontes brasileiras do projeto `iptv-org/epg`.

A fonte padrao e `/api/br-epg?source=br-priority`, que consulta em tempo real os canais brasileiros listados em `sites/mi.tv/mi.tv_br.channels.xml`. Existem presets para:

- Brasil prioritario
- TV aberta BR
- Esportes BR
- Filmes BR

Essas fontes sao brasileiras/portugues do Brasil e entram antes de qualquer fonte global. Se a fonte externa falhar, o app usa dados demonstrativos para continuar navegavel.

A estrutura esperada por programa e:

```ts
{
  channel: string
  channelType: 'Aberta' | 'Fechada'
  title: string
  category: 'Esportes' | 'Filmes' | 'Series' | 'Noticias'
  start: string
  end: string
  nextAirings: string[]
}
```

## Como rodar

```bash
npm install
npm run dev     # o proxy /api/proxy tambem funciona no dev server
npm test        # testes de M3U, HLS, XMLTV e regras de agendamento
```

## Como publicar

```bash
npm run build
vercel --prod
```

## Atualizar o EPG brasileiro estatico

Opcionalmente, no GitHub, rode manualmente o workflow **Update Brazilian EPG** ou espere a rotina diaria. Ele baixa o `iptv-org/epg`, gera arquivos em `public/epg/` e commita os dados atualizados. O app nao depende mais desse arquivo para mostrar a grade inicial.
