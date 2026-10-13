import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rewriteHlsPlaylist } from '../server/proxy-core.js'
import { parseHls } from '../src/iptv/hls.ts'
import { parseM3u, xtreamHlsAlternative } from '../src/iptv/m3u.ts'
import { computeOccurrences, titleMatches } from '../src/iptv/schedule.ts'
import type { Programme, RecordingRule } from '../src/iptv/types.ts'
import { normalizeName, parseXmltvDate, parseXmltvStream } from '../src/iptv/xmltv.ts'

const M3U = `#EXTM3U url-tvg="http://epg.example/guide.xml.gz"
#EXTINF:-1 tvg-id="Globo.br" tvg-name="Globo SP" tvg-logo="http://logo/globo.png" group-title="Abertos, BR",Globo SP FHD
http://srv.example:8080/user1/pass1/101
#EXTINF:-1 tvg-id="" group-title="Filmes",Matrix (1999)
http://srv.example:8080/movie/user1/pass1/555.mkv
#EXTINF:-1,Canal sem atributos
#EXTVLCOPT:http-user-agent=MeuApp/1.0
https://cdn.example/live/stream.m3u8
`

test('parseM3u le canais, filmes, EPG e opcoes', () => {
  const parsed = parseM3u(M3U)
  assert.deepEqual(parsed.epgUrls, ['http://epg.example/guide.xml.gz'])
  assert.equal(parsed.channels.length, 2)
  assert.equal(parsed.movies.length, 1)

  const globo = parsed.channels[0]
  assert.equal(globo.name, 'Globo SP FHD')
  assert.equal(globo.group, 'Abertos, BR')
  assert.equal(globo.epgId, 'Globo.br')
  assert.equal(globo.logo, 'http://logo/globo.png')
  assert.deepEqual(globo.altUrls, ['http://srv.example:8080/live/user1/pass1/101.m3u8'])

  assert.equal(parsed.movies[0].name, 'Matrix (1999)')
  assert.equal(parsed.movies[0].ext, 'mkv')

  const plain = parsed.channels[1]
  assert.equal(plain.group, 'Sem grupo')
  assert.equal(plain.headers?.userAgent, 'MeuApp/1.0')
  assert.equal(plain.altUrls, undefined)
})

test('parseM3u gera ids estaveis e unicos', () => {
  const a = parseM3u(M3U)
  const b = parseM3u(M3U)
  assert.equal(a.channels[0].id, b.channels[0].id)
  const dup = parseM3u('#EXTM3U\n#EXTINF:-1,X\nhttp://a/1\n#EXTINF:-1,X\nhttp://a/2\n')
  assert.notEqual(dup.channels[0].id, dup.channels[1].id)
})

test('xtreamHlsAlternative', () => {
  assert.deepEqual(xtreamHlsAlternative('http://h:80/live/u/p/9.ts'), ['http://h:80/live/u/p/9.m3u8'])
  assert.equal(xtreamHlsAlternative('https://cdn/live/stream.m3u8'), undefined)
})

test('parseHls media e master', () => {
  const media = parseHls(
    `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:120
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:6.0,
seg120.ts
#EXTINF:6.0,
/abs/seg121.ts?token=1`,
    'http://h/path/index.m3u8',
  )
  assert.equal(media.kind, 'media')
  if (media.kind !== 'media') return
  assert.equal(media.segments.length, 2)
  assert.equal(media.segments[0].seq, 120)
  assert.equal(media.segments[1].seq, 121)
  assert.equal(media.segments[0].uri, 'http://h/path/seg120.ts')
  assert.equal(media.segments[1].uri, 'http://h/abs/seg121.ts?token=1')
  assert.equal(media.segments[0].key?.uri, 'http://h/path/key.bin')

  const master = parseHls(
    `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
hi.m3u8`,
    'http://h/master.m3u8',
  )
  assert.equal(master.kind, 'master')
  if (master.kind !== 'master') return
  assert.deepEqual(
    master.variants.map((variant) => [variant.uri, variant.bandwidth]),
    [
      ['http://h/low.m3u8', 800000],
      ['http://h/hi.m3u8', 5000000],
    ],
  )
})

test('rewriteHlsPlaylist deixa URIs absolutas', () => {
  const out = rewriteHlsPlaylist('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nseg1.m4s\n', 'http://h/a/b.m3u8')
  assert.match(out, /URI="http:\/\/h\/a\/init\.mp4"/)
  assert.match(out, /^http:\/\/h\/a\/seg1\.m4s$/m)
})

test('XMLTV: datas, nomes e parser incremental', async () => {
  assert.equal(parseXmltvDate('20261013210000 -0300'), Date.parse('2026-10-14T00:00:00Z'))
  assert.equal(normalizeName('BR: Globo SP FHD'), 'globosp')
  assert.equal(normalizeName('SBT (HD)'), 'sbt')

  const xml = `<?xml version="1.0"?><tv>
<channel id="globo.br"><display-name>Globo</display-name></channel>
<channel id="other"><display-name>Outro Canal</display-name></channel>
<channel id="sbt.br"><display-name>SBT</display-name></channel>
<programme start="20261013200000 -0300" stop="20261013210000 -0300" channel="globo.br"><title lang="pt">Jornal &amp; Cia</title><desc>Noticias</desc></programme>
<programme start="20261013200000 -0300" stop="20261013210000 -0300" channel="other"><title>Ignorado</title></programme>
<programme start="20261013200000 -0300" stop="20261013213000 -0300" channel="sbt.br"><title><![CDATA[Programa do Ratinho]]></title></programme>
</tv>`
  const bytes = new TextEncoder().encode(xml)
  // entrega em pedacos pequenos para testar elementos cortados entre chunks
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < bytes.length; index += 37) controller.enqueue(bytes.slice(index, index + 37))
      controller.close()
    },
  })
  const index = await parseXmltvStream(stream, {
    wantedIds: new Set(['globo.br']),
    wantedNames: new Set(['sbt']),
    from: 0,
    to: Number.MAX_SAFE_INTEGER,
  })
  assert.deepEqual(Object.keys(index.programmes).sort(), ['globo.br', 'sbt.br'])
  assert.equal(index.programmes['globo.br'][0].title, 'Jornal & Cia')
  assert.equal(index.programmes['globo.br'][0].desc, 'Noticias')
  assert.equal(index.programmes['sbt.br'][0].title, 'Programa do Ratinho')
  assert.equal(index.names.sbt, 'sbt.br')
})

// ---------- agendamento ----------

const channel = { playlistId: 'p', channelId: 'c', name: 'Globo', url: 'http://x/1' }

function rule(patch: Partial<RecordingRule>): RecordingRule {
  return {
    id: 'r1',
    kind: 'series',
    enabled: true,
    channel,
    title: 'Jornal Nacional',
    match: 'contains',
    days: [0, 1, 2, 3, 4, 5, 6],
    time: '20:30',
    durationMin: 45,
    toleranceMin: 90,
    fallbackToTime: false,
    padBeforeMin: 2,
    padAfterMin: 5,
    createdAt: 0,
    ...patch,
  }
}

function at(day: number, hh: number, mm = 0) {
  // datas locais para nao depender do fuso da maquina
  return new Date(2026, 9, day, hh, mm).getTime()
}

const epg: Programme[] = [
  { start: at(13, 20, 30), stop: at(13, 21, 15), title: 'Jornal Nacional' },
  { start: at(14, 20, 40), stop: at(14, 21, 20), title: 'Jornal Nacional' }, // atrasou 10 min
  { start: at(15, 2, 0), stop: at(15, 2, 45), title: 'Jornal Nacional (reprise)' },
  { start: at(15, 20, 30), stop: at(15, 21, 15), title: 'Futebol' }, // nao passa nesse dia
]

test('titleMatches ignora acento e caixa', () => {
  assert.ok(titleMatches('JORNAL NACIONAL - Edição de sábado', { title: 'jornal nacional', match: 'contains' }))
  assert.ok(!titleMatches('Jornal Nacional ed. 2', { title: 'Jornal Nacional', match: 'exact' }))
})

test('serie: segue o horario da EPG todo dia e ignora reprises fora da janela', () => {
  const list = computeOccurrences(rule({}), epg, at(13, 0), at(16, 0))
  assert.equal(list.length, 2)
  assert.equal(list[0].programStart, at(13, 20, 30))
  assert.equal(list[0].start, at(13, 20, 28))
  assert.equal(list[0].stop, at(13, 21, 20))
  assert.equal(list[1].programStart, at(14, 20, 40))
})

test('serie: qualquer horario inclui reprises', () => {
  const list = computeOccurrences(rule({ toleranceMin: 0 }), epg, at(13, 0), at(16, 0))
  assert.equal(list.length, 3)
})

test('serie: respeita dias da semana', () => {
  const day13 = new Date(at(13, 12)).getDay()
  const list = computeOccurrences(rule({ days: [day13] }), epg, at(13, 0), at(16, 0))
  assert.equal(list.length, 1)
  assert.equal(list[0].programStart, at(13, 20, 30))
})

test('serie: fallback para horario fixo so quando a EPG esta vazia', () => {
  const list = computeOccurrences(rule({ fallbackToTime: true }), epg, at(13, 0), at(18, 0))
  // dia 15 tem EPG (Futebol) -> nao grava; dias 16 e 17 sem EPG -> grava no horario habitual
  const days = list.map((item) => new Date(item.programStart).getDate())
  assert.deepEqual(days, [13, 14, 16, 17])
  const fallback = list.find((item) => new Date(item.programStart).getDate() === 16)
  assert.equal(fallback?.source, 'time')
  assert.equal(fallback?.programStart, at(16, 20, 30))
  assert.equal(fallback?.programStop, at(16, 21, 15))
})

test('diario: horario fixo usa o titulo da EPG se existir', () => {
  const list = computeOccurrences(rule({ kind: 'daily', title: '' }), epg, at(13, 0), at(15, 0))
  assert.equal(list.length, 2)
  assert.equal(list[0].title, 'Jornal Nacional')
  assert.equal(list[0].programStop - list[0].programStart, 45 * 60_000)
})

test('uma vez e regra desativada', () => {
  const once = computeOccurrences(rule({ kind: 'once', start: at(13, 10), stop: at(13, 11) }), null, at(13, 0), at(14, 0))
  assert.equal(once.length, 1)
  assert.equal(once[0].start, at(13, 9, 58))
  assert.equal(computeOccurrences(rule({ enabled: false }), epg, at(13, 0), at(16, 0)).length, 0)
})

test('programa dividido em dois blocos vira uma gravacao so', () => {
  const split: Programme[] = [
    { start: at(13, 20, 30), stop: at(13, 21, 0), title: 'Jornal Nacional' },
    { start: at(13, 21, 0), stop: at(13, 21, 20), title: 'Jornal Nacional' },
  ]
  const list = computeOccurrences(rule({}), split, at(13, 0), at(14, 0))
  assert.equal(list.length, 1)
  assert.equal(list[0].programStop, at(13, 21, 20))
})
