import {
  CalendarDays,
  ChevronRight,
  Clock3,
  Film,
  Loader2,
  RadioTower,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Star,
  Trophy,
  Tv,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import './App.css'

type Category = 'Todos' | 'Aberta' | 'Esportes' | 'Filmes' | 'Series' | 'Noticias'
type ProgramCategory = Exclude<Category, 'Todos' | 'Aberta'>

type Program = {
  id: string
  channel: string
  channelId: string
  logo: string
  channelType: 'Aberta' | 'Fechada'
  title: string
  subtitle: string
  category: ProgramCategory
  start: string
  end: string
  startMs: number
  endMs: number
  live?: boolean
  recommended?: boolean
  rating: string
  nextAirings: string[]
}

type GuideStatus = 'idle' | 'loading' | 'ready' | 'fallback' | 'error'

type IptvGuideJson = {
  channels?: Array<{
    xmltv_id?: string
    id?: string
    name?: string
    display_name?: string
    logo?: string
  }>
  programs?: Array<{
    channel?: string
    start?: number | string
    stop?: number | string
    titles?: Array<{ value?: string }>
    title?: string
    subTitles?: Array<{ value?: string }>
    descriptions?: Array<{ value?: string }>
    categories?: Array<{ value?: string } | string>
    ratings?: Array<{ value?: string } | string>
  }>
}

type GuideValueList = Array<{ value?: string } | string>

const DEFAULT_EPG_URL = import.meta.env.VITE_EPG_URL || '/api/br-epg?source=pay-tv'
const brazilianSources = [
  {
    name: 'TV fechada BR',
    guideUrl: '/api/br-epg?source=pay-tv',
    detail: 'Canais fechados brasileiros do mi.tv, sem afiliadas abertas',
  },
  {
    name: 'Brasil prioritario',
    guideUrl: '/api/br-epg?source=br-priority',
    detail: 'Grade menor com canais fechados populares',
  },
  {
    name: 'TV aberta BR',
    guideUrl: '/api/br-epg?source=open-tv',
    detail: 'Globo, SBT, Record, Band, Cultura e redes abertas',
  },
  {
    name: 'Esportes BR',
    guideUrl: '/api/br-epg?source=sports',
    detail: 'SporTV, ESPN, Premiere e canais esportivos',
  },
  {
    name: 'Filmes BR',
    guideUrl: '/api/br-epg?source=movies',
    detail: 'Telecine, TNT, Warner, Megapix e canais de cinema',
  },
]
const guideStart = 12 * 60
const guideSpan = 12 * 60
const timeSlots = ['12:00', '14:00', '16:00', '18:00', '20:00', '22:00', '00:00']
const categories: Category[] = ['Todos', 'Aberta', 'Esportes', 'Filmes', 'Series', 'Noticias']

const fallbackPrograms: Program[] = [
  createFallbackProgram('vale-a-pena-ver-de-novo', 'Globo', 'G', 'Aberta', 'Vale a Pena Ver de Novo', 'Novela reprise', 'Series', '17:05', '18:25', 'Livre', ['Amanha, 17:05', 'Quarta, 17:05']),
  createFallbackProgram('novela-das-nove', 'Globo', 'G', 'Aberta', 'Novela das Nove', 'Drama nacional', 'Series', '21:20', '22:25', '14', ['Amanha, 21:20', 'Quarta, 21:20'], true),
  createFallbackProgram('cine-espetacular', 'SBT', 'S', 'Aberta', 'Cine Espetacular: O Plano Perfeito', 'Filme de acao', 'Filmes', '22:30', '00:20', '14', ['Sabado, 23:15', 'Domingo, 14:00'], true),
  createFallbackProgram('jornal-record', 'Record', 'R', 'Aberta', 'Jornal da Record', 'Resumo do dia', 'Noticias', '19:55', '21:00', 'Livre', ['Amanha, 19:55']),
  createFallbackProgram('brasil-urgente', 'Band', 'B', 'Aberta', 'Brasil Urgente', 'Noticias ao vivo', 'Noticias', '16:00', '19:20', '12', ['Amanha, 16:00'], false, true),
  createFallbackProgram('roda-viva', 'TV Cultura', 'C', 'Aberta', 'Roda Viva', 'Entrevista', 'Noticias', '22:00', '23:30', 'Livre', ['Segunda que vem, 22:00']),
  createFallbackProgram('brasileirao', 'SporTV', 'SP', 'Fechada', 'Brasileirao Serie A: Flamengo x Palmeiras', 'Rodada nacional', 'Esportes', '19:00', '21:15', 'Livre', ['Replay hoje, 23:40', 'Amanha, 10:00'], true, true),
  createFallbackProgram('nba-hoje', 'ESPN', 'E', 'Fechada', 'SportsCenter', 'Noticias e melhores momentos', 'Esportes', '20:00', '21:00', 'Livre', ['Hoje, 23:00', 'Amanha, 07:00']),
  createFallbackProgram('libertadores', 'Paramount+', 'P+', 'Fechada', 'Libertadores: Pre-jogo', 'Mesa tatica', 'Esportes', '21:00', '21:30', 'Livre', ['Amanha, 18:30'], true),
  createFallbackProgram('telecine-premium', 'Telecine Premium', 'TP', 'Fechada', 'Top Gun: Maverick', 'Filme', 'Filmes', '20:10', '22:25', '12', ['Quarta, 18:00', 'Sexta, 22:00', 'Domingo, 16:20'], true),
  createFallbackProgram('tnt-cinema', 'TNT', 'T', 'Fechada', 'Homem-Aranha: Sem Volta para Casa', 'Filme de aventura', 'Filmes', '18:30', '21:05', '12', ['Amanha, 15:50', 'Sabado, 20:00']),
  createFallbackProgram('warner-series', 'Warner Channel', 'W', 'Fechada', 'The Big Bang Theory', 'Maratona', 'Series', '14:00', '18:00', '10', ['Hoje, 23:30', 'Amanha, 14:00']),
]

function createFallbackProgram(
  id: string,
  channel: string,
  logo: string,
  channelType: Program['channelType'],
  title: string,
  subtitle: string,
  category: ProgramCategory,
  start: string,
  end: string,
  rating: string,
  nextAirings: string[],
  recommended = false,
  live = false,
): Program {
  const today = new Date()
  const startMs = dateAt(today, start).getTime()
  let endDate = dateAt(today, end)
  if (endDate.getTime() <= startMs) endDate = new Date(endDate.getTime() + 24 * 60 * 60 * 1000)

  return {
    id,
    channel,
    channelId: channel,
    logo,
    channelType,
    title,
    subtitle,
    category,
    start,
    end,
    startMs,
    endMs: endDate.getTime(),
    live,
    recommended,
    rating,
    nextAirings,
  }
}

function App() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category>('Todos')
  const [selectedId, setSelectedId] = useState('brasileirao')
  const [epgUrl, setEpgUrl] = useState(DEFAULT_EPG_URL)
  const [programs, setPrograms] = useState(fallbackPrograms)
  const [guideStatus, setGuideStatus] = useState<GuideStatus>('idle')
  const [guideMessage, setGuideMessage] = useState('Dados demonstrativos carregados.')

  useEffect(() => {
    async function loadInitialGuide() {
      setGuideStatus('loading')
      setGuideMessage('Carregando EPG...')

      try {
        const loadedPrograms = await fetchGuide(DEFAULT_EPG_URL)
        if (loadedPrograms.length < 4) {
          setGuideStatus('fallback')
          setGuideMessage('Fonte EPG carregou poucos programas para a grade. Mantive o fallback local.')
          return
        }

        setPrograms(loadedPrograms)
        setSelectedId(loadedPrograms[0].id)
        setGuideStatus('ready')
        setGuideMessage(`${loadedPrograms.length} exibicoes carregadas via iptv-org/XMLTV.`)
      } catch (error) {
        setGuideStatus('fallback')
        setGuideMessage(readGuideError(error))
      }
    }

    void loadInitialGuide()
  }, [])

  async function loadGuide(url = epgUrl) {
    setGuideStatus('loading')
    setGuideMessage('Carregando EPG...')

    try {
      const loadedPrograms = await fetchGuide(url)
      if (loadedPrograms.length < 4) {
        setPrograms(fallbackPrograms)
        setSelectedId(fallbackPrograms[6].id)
        setGuideStatus('fallback')
        setGuideMessage('Fonte EPG carregou poucos programas para a grade. Mantive o fallback local.')
        return
      }

      setPrograms(loadedPrograms)
      setSelectedId(loadedPrograms[0].id)
      setGuideStatus('ready')
      setGuideMessage(`${loadedPrograms.length} exibicoes carregadas via iptv-org/XMLTV.`)
    } catch (error) {
      setPrograms(fallbackPrograms)
      setSelectedId(fallbackPrograms[6].id)
      setGuideStatus('fallback')
      setGuideMessage(readGuideError(error))
    }
  }

  const visiblePrograms = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return programs.filter((program) => {
      const matchesQuery =
        !normalizedQuery ||
        [program.title, program.subtitle, program.channel, program.category].some((value) =>
          value.toLowerCase().includes(normalizedQuery),
        )
      const matchesCategory =
        category === 'Todos' ||
        (category === 'Aberta' ? program.channelType === 'Aberta' : program.category === category)

      return matchesQuery && matchesCategory && overlapsGuideWindow(program)
    })
  }, [category, programs, query])

  const visibleRows = useMemo(() => {
    const rows = new Map<string, Program[]>()
    visiblePrograms.forEach((program) => {
      const current = rows.get(program.channelId) ?? []
      current.push(program)
      rows.set(program.channelId, current)
    })

    return [...rows.values()].map((row) => row.sort((a, b) => a.startMs - b.startMs))
  }, [visiblePrograms])

  const selected = programs.find((program) => program.id === selectedId) ?? visiblePrograms[0] ?? programs[0]
  const recommendations = useMemo(() => buildRecommendations(programs), [programs])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Tv size={20} />
          </span>
          <div>
            <h1>Grade Agora</h1>
            <p>TV aberta e fechada em uma linha de horarios</p>
          </div>
        </div>

        <div className="toolbar">
          <button className="date-button" type="button" aria-label="Selecionar data">
            <CalendarDays size={17} />
            <span>{todayLabel()}</span>
          </button>
          <label className="search-box">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar programa, filme, jogo ou canal"
            />
          </label>
        </div>
      </header>

      <section className="source-row" aria-label="Fonte de dados EPG">
        <label className="source-input">
          <span>EPG</span>
          <input value={epgUrl} onChange={(event) => setEpgUrl(event.target.value)} />
        </label>
        <button className="load-button" type="button" onClick={() => void loadGuide()}>
          {guideStatus === 'loading' ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
          <span>Carregar</span>
        </button>
        <p className={`source-status ${guideStatus}`}>{guideMessage}</p>
        <div className="source-presets" aria-label="Fontes brasileiras priorizadas">
          {brazilianSources.map((source) => (
            <button
              className={source.guideUrl === epgUrl ? 'source-chip active' : 'source-chip'}
              key={source.guideUrl}
              onClick={() => {
                setEpgUrl(source.guideUrl)
                setGuideMessage(source.detail)
              }}
              title={source.detail}
              type="button"
            >
              {source.name}
            </button>
          ))}
        </div>
      </section>

      <section className="control-row" aria-label="Filtros da grade">
        <div className="filter-title">
          <SlidersHorizontal size={17} />
          <span>Filtros</span>
        </div>
        <div className="segments">
          {categories.map((item) => (
            <button
              className={item === category ? 'segment active' : 'segment'}
              key={item}
              onClick={() => setCategory(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
        <div className="signal">
          <RadioTower size={16} />
          <span>{visiblePrograms.length} exibicoes encontradas</span>
        </div>
      </section>

      <div className="content-grid">
        <section className="guide-panel" aria-label="Grade de horarios">
          <div className="time-header">
            <div className="channel-label">Canal</div>
            <div className="time-track">
              {timeSlots.map((slot) => (
                <span key={slot}>{slot}</span>
              ))}
            </div>
          </div>

          <div className="schedule-list">
            {visibleRows.map((row) => {
              const channel = row[0]

              return (
                <div
                  className={row.some((program) => program.id === selected.id) ? 'schedule-row selected' : 'schedule-row'}
                  key={channel.channelId}
                >
                  <span className="channel-pill">
                    <span className="logo-dot">{channel.logo}</span>
                    <span>
                      <strong>{channel.channel}</strong>
                      <small>{channel.channelType}</small>
                    </span>
                  </span>
                  <span className="timeline">
                    {row.map((program) => {
                      const left = ((timeToGuideMinute(program.start) - guideStart) / guideSpan) * 100
                      const width = (duration(program.start, program.end) / guideSpan) * 100

                      return (
                        <button
                          className={
                            program.id === selected.id
                              ? `program-block selected ${program.category.toLowerCase()}`
                              : `program-block ${program.category.toLowerCase()}`
                          }
                          key={program.id}
                          onClick={() => setSelectedId(program.id)}
                          style={{ left: `${Math.max(0, left)}%`, width: `${Math.max(10, Math.min(100, width))}%` }}
                          type="button"
                        >
                          <span className="program-time">
                            {program.start} - {program.end}
                          </span>
                          <span className="program-title">{program.title}</span>
                          <span className="program-meta">
                            {program.live ? 'Ao vivo' : program.subtitle} - {program.rating}
                          </span>
                        </button>
                      )
                    })}
                  </span>
                </div>
              )
            })}
          </div>
        </section>

        <aside className="side-panel" aria-label="Sugestoes do dia">
          <div className="panel-heading">
            <div>
              <h2>Sugestoes do dia</h2>
              <p>Priorizando jogos, filmes e reprises uteis</p>
            </div>
            <Star size={19} />
          </div>

          <div className="recommendation-list">
            {recommendations.map((program) => (
              <button
                className={program.id === selected.id ? 'recommendation active' : 'recommendation'}
                key={program.id}
                onClick={() => setSelectedId(program.id)}
                type="button"
              >
                <span className="recommendation-icon">
                  {program.category === 'Esportes' ? <Trophy size={18} /> : <Film size={18} />}
                </span>
                <span>
                  <strong>{program.title}</strong>
                  <small>
                    {program.channel} - {program.start}
                  </small>
                </span>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        </aside>
      </div>

      <section className="detail-drawer" aria-label="Detalhes do programa selecionado">
        <div className="detail-main">
          <span className={`category-token ${selected.category.toLowerCase()}`}>{selected.category}</span>
          <div>
            <h2>{selected.title}</h2>
            <p>
              {selected.channel} - {selected.start} ate {selected.end} - Classificacao {selected.rating}
            </p>
          </div>
        </div>
        <div className="next-airings">
          <div className="next-title">
            <Clock3 size={16} />
            <span>Vai passar de novo</span>
          </div>
          {selected.nextAirings.length ? (
            selected.nextAirings.map((airing) => (
              <span className="airing-chip" key={airing}>
                {airing}
              </span>
            ))
          ) : (
            <span className="airing-chip">Sem reprise encontrada no EPG carregado</span>
          )}
        </div>
      </section>
    </main>
  )
}

async function fetchGuide(url: string): Promise<Program[]> {
  const isRemoteUrl = /^https?:\/\//i.test(url)
  const response = await fetch(isRemoteUrl ? `/api/epg?url=${encodeURIComponent(url)}` : url)
  if (!response.ok) throw new Error(`EPG retornou ${response.status}. Confira a URL ou a origem permitida.`)

  const text = await response.text()
  if (text.trim().startsWith('<!doctype')) {
    throw new Error('EPG brasileiro ainda nao foi gerado. Rode o workflow Update Brazilian EPG.')
  }
  const programs = url.endsWith('.json') || text.trim().startsWith('{') ? parseGuideJson(JSON.parse(text)) : parseXmltv(text)

  return buildNextAirings(programs)
    .filter((program) => Number.isFinite(program.startMs) && Number.isFinite(program.endMs))
    .sort((a, b) => a.channel.localeCompare(b.channel) || a.startMs - b.startMs)
    .slice(0, 5000)
}

function readGuideError(error: unknown) {
  if (error instanceof Error) return error.message
  return 'Nao foi possivel carregar o EPG. Mantive dados demonstrativos.'
}

function parseGuideJson(data: IptvGuideJson): Program[] {
  const channels = new Map(
    (data.channels ?? []).map((channel) => [
      channel.xmltv_id ?? channel.id ?? '',
      {
        name: channel.name ?? channel.display_name ?? channel.xmltv_id ?? channel.id ?? 'Canal',
        logo: channel.logo,
      },
    ]),
  )

  return (data.programs ?? []).map((item, index) => {
    const channelId = item.channel ?? 'canal'
    const channel = channels.get(channelId)
    const title = item.titles?.[0]?.value ?? item.title ?? 'Programa sem titulo'
    const subtitle = item.subTitles?.[0]?.value ?? item.descriptions?.[0]?.value ?? 'EPG iptv-org'
    const startDate = parseGuideDate(item.start)
    const endDate = parseGuideDate(item.stop)
    const rating = readFirstValue(item.ratings) || 'Livre'
    const category = inferCategory(`${title} ${subtitle} ${readFirstValue(item.categories)}`)

    return {
      id: `${channelId}-${startDate.getTime()}-${index}`,
      channel: channel?.name ?? channelId.replace(/@.*/, '').replace(/\.\w+$/, ''),
      channelId,
      logo: initials(channel?.name ?? channelId),
      channelType: inferChannelType(channel?.name ?? channelId),
      title,
      subtitle: compact(subtitle, 80),
      category,
      start: formatTime(startDate),
      end: formatTime(endDate),
      startMs: startDate.getTime(),
      endMs: endDate.getTime(),
      live: startDate.getTime() <= Date.now() && endDate.getTime() >= Date.now(),
      recommended: isRecommendation(title, category),
      rating,
      nextAirings: [],
    }
  })
}

function parseXmltv(xml: string): Program[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const channels = new Map<string, { name: string; logo?: string }>()

  doc.querySelectorAll('channel').forEach((node) => {
    const id = node.getAttribute('id') ?? ''
    const name = node.querySelector('display-name')?.textContent?.trim() || id
    const logo = node.querySelector('icon')?.getAttribute('src') ?? undefined
    channels.set(id, { name, logo })
  })

  return [...doc.querySelectorAll('programme')].map((node, index) => {
    const channelId = node.getAttribute('channel') ?? 'canal'
    const channel = channels.get(channelId)
    const title = node.querySelector('title')?.textContent?.trim() || 'Programa sem titulo'
    const subtitle =
      node.querySelector('sub-title')?.textContent?.trim() ||
      node.querySelector('desc')?.textContent?.trim() ||
      'EPG XMLTV'
    const startDate = parseXmltvDate(node.getAttribute('start'))
    const endDate = parseXmltvDate(node.getAttribute('stop'))
    const category = inferCategory(`${title} ${subtitle} ${node.querySelector('category')?.textContent ?? ''}`)
    const rating = node.querySelector('rating value')?.textContent?.trim() || 'Livre'

    return {
      id: `${channelId}-${startDate.getTime()}-${index}`,
      channel: channel?.name ?? channelId.replace(/@.*/, '').replace(/\.\w+$/, ''),
      channelId,
      logo: initials(channel?.name ?? channelId),
      channelType: inferChannelType(channel?.name ?? channelId),
      title,
      subtitle: compact(subtitle, 80),
      category,
      start: formatTime(startDate),
      end: formatTime(endDate),
      startMs: startDate.getTime(),
      endMs: endDate.getTime(),
      live: startDate.getTime() <= Date.now() && endDate.getTime() >= Date.now(),
      recommended: isRecommendation(title, category),
      rating,
      nextAirings: [],
    }
  })
}

function buildNextAirings(items: Program[]) {
  return items.map((program) => {
    const nextAirings = items
      .filter((candidate) => candidate.title === program.title && candidate.startMs > program.startMs)
      .slice(0, 3)
      .map((candidate) => formatAiring(candidate.startMs))

    return { ...program, nextAirings }
  })
}

function buildRecommendations(items: Program[]) {
  const recommended = items
    .filter((program) => program.recommended || program.category === 'Esportes' || program.category === 'Filmes')
    .sort((a, b) => Number(b.category === 'Esportes') - Number(a.category === 'Esportes') || a.startMs - b.startMs)

  return (recommended.length ? recommended : items).slice(0, 5)
}

function parseGuideDate(value: number | string | undefined) {
  if (typeof value === 'number') return new Date(value)
  if (!value) return new Date(Number.NaN)
  if (/^\d+$/.test(value)) return new Date(Number(value))
  if (/^\d{14}/.test(value)) return parseXmltvDate(value)
  return new Date(value)
}

function parseXmltvDate(value: string | null) {
  if (!value) return new Date(Number.NaN)
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/)
  if (!match) return new Date(value)

  const [, year, month, day, hour, minute, second, offset = '+0000'] = match
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${offset.slice(0, 3)}:${offset.slice(3)}`
  return new Date(iso)
}

function readFirstValue(values: GuideValueList = []) {
  const first = values[0]
  if (!first) return ''
  return typeof first === 'string' ? first : first.value ?? ''
}

function inferCategory(text: string): ProgramCategory {
  const value = text.toLowerCase()
  if (/(futebol|soccer|sports?|esporte|nba|formula|ufc|tennis|volei|basquete|campeonato|league)/.test(value)) {
    return 'Esportes'
  }
  if (/(movie|filme|cinema|film|thriller|comedy|drama)/.test(value)) return 'Filmes'
  if (/(news|jornal|noticia|report|ao vivo|breaking)/.test(value)) return 'Noticias'
  return 'Series'
}

function inferChannelType(channel: string): Program['channelType'] {
  return /globo|sbt|record|band|cultura|rede tv|redevida|gazeta/i.test(channel) ? 'Aberta' : 'Fechada'
}

function isRecommendation(title: string, category: ProgramCategory) {
  return category === 'Esportes' || category === 'Filmes' || /futebol|brasileirao|libertadores|copa/i.test(title)
}

function overlapsGuideWindow(program: Program) {
  const start = timeToGuideMinute(program.start)
  const end = timeToGuideMinute(program.end)
  const normalizedEnd = end <= start ? end + 24 * 60 : end
  return normalizedEnd > guideStart && start < guideStart + guideSpan
}

function timeToGuideMinute(time: string) {
  const value = minutes(time)
  return value < guideStart ? value + 24 * 60 : value
}

function minutes(time: string) {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

function duration(start: string, end: string) {
  const startMinutes = timeToGuideMinute(start)
  const endMinutes = timeToGuideMinute(end)
  return endMinutes >= startMinutes ? endMinutes - startMinutes : endMinutes + 24 * 60 - startMinutes
}

function dateAt(date: Date, time: string) {
  const [hour, minute] = time.split(':').map(Number)
  const next = new Date(date)
  next.setHours(hour, minute, 0, 0)
  return next
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Sao_Paulo',
  }).format(date)
}

function formatAiring(value: number) {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value))
}

function todayLabel() {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(new Date())
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function compact(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value
}

export default App
