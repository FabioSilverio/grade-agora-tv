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

Como funciona: o gravador roda num Web Worker (nao e pausado em aba de segundo plano), baixa o
stream sem recodificar (segmentos HLS ou TS continuo, reconectando sozinho) e escreve no
armazenamento do navegador (OPFS). Ao terminar, move o arquivo para a **pasta escolhida no PC**
(Chrome/Edge). Arquivos `.ts` abrem no VLC; para `.mp4`: `ffmpeg -i in.ts -c copy out.mp4`.

**Importante:** como e um site, as gravacoes acontecem no navegador. Deixe a aba aberta (pode
ficar minimizada) e o PC sem suspender. Depois de reabrir o navegador, clique em
"Autorizar pasta" (exigencia do navegador).

### Proxy (`/api/proxy`)

Servidores IPTV quase nunca liberam CORS e costumam ser `http://`, que uma pagina `https` nao
pode acessar. A funcao `api/proxy.js` repassa as requisicoes (com User-Agent de VLC), libera CORS
e reescreve playlists HLS. Ela recusa uso por outros sites e hosts de rede privada.

Limites da Vercel: cada requisicao dura no maximo 5 min (o player e o gravador reconectam
sozinhos; HLS quase nao sente) e todo o video passa pela sua cota de trafego. Para gravar
muito, rode o proxy no proprio PC:

```bash
npm run proxy   # http://localhost:8787/api/proxy
```

e em **Ajustes > Endereco do proxy** use `http://localhost:8787/api/proxy`.

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
