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

Esta versao usa dados demonstrativos em `src/App.tsx`. Para cobrir "todos os canais" em producao, o caminho correto e ligar um provedor de EPG licenciado, por exemplo Gracenote/Nielsen, TV Media, JustWatch/Guidebox quando aplicavel, APIs de operadoras ou outro fornecedor contratado.

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
