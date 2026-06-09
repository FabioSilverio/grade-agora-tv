# Grade Agora

Aplicativo web para ver programacoes de TV aberta e fechada em uma guia de horarios simples de escanear.

## O que esta pronto

- Grade horizontal por canal e horario.
- Busca por programa, filme, jogo, canal ou categoria.
- Filtros por TV aberta, esportes, filmes, series e noticias.
- Sugestoes do dia com prioridade para futebol.
- Detalhe do programa selecionado com proximas exibicoes.
- Layout responsivo para desktop e celular.

## Dados de programacao

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
npm run dev
```

## Como publicar

```bash
npm run build
vercel --prod
```

## Atualizar o EPG brasileiro estatico

Opcionalmente, no GitHub, rode manualmente o workflow **Update Brazilian EPG** ou espere a rotina diaria. Ele baixa o `iptv-org/epg`, gera arquivos em `public/epg/` e commita os dados atualizados. O app nao depende mais desse arquivo para mostrar a grade inicial.
