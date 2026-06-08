import {
  CalendarDays,
  ChevronRight,
  Clock3,
  Film,
  RadioTower,
  Search,
  SlidersHorizontal,
  Star,
  Trophy,
  Tv,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import './App.css'

type Category = 'Todos' | 'Aberta' | 'Esportes' | 'Filmes' | 'Series' | 'Noticias'

type Program = {
  id: string
  channel: string
  logo: string
  channelType: 'Aberta' | 'Fechada'
  title: string
  subtitle: string
  category: Exclude<Category, 'Todos' | 'Aberta'>
  start: string
  end: string
  live?: boolean
  recommended?: boolean
  rating: string
  nextAirings: string[]
}

const guideStart = 12 * 60
const guideSpan = 12 * 60
const timeSlots = ['12:00', '14:00', '16:00', '18:00', '20:00', '22:00', '00:00']

const programs: Program[] = [
  {
    id: 'vale-a-pena-ver-de-novo',
    channel: 'Globo',
    logo: 'G',
    channelType: 'Aberta',
    title: 'Vale a Pena Ver de Novo',
    subtitle: 'Novela reprise',
    category: 'Series',
    start: '17:05',
    end: '18:25',
    rating: 'Livre',
    nextAirings: ['Amanha, 17:05', 'Quarta, 17:05'],
  },
  {
    id: 'novela-das-nove',
    channel: 'Globo',
    logo: 'G',
    channelType: 'Aberta',
    title: 'Novela das Nove',
    subtitle: 'Drama nacional',
    category: 'Series',
    start: '21:20',
    end: '22:25',
    recommended: true,
    rating: '14',
    nextAirings: ['Amanha, 21:20', 'Quarta, 21:20'],
  },
  {
    id: 'cine-espetacular',
    channel: 'SBT',
    logo: 'S',
    channelType: 'Aberta',
    title: 'Cine Espetacular: O Plano Perfeito',
    subtitle: 'Filme de acao',
    category: 'Filmes',
    start: '22:30',
    end: '00:20',
    recommended: true,
    rating: '14',
    nextAirings: ['Sabado, 23:15', 'Domingo, 14:00'],
  },
  {
    id: 'jornal-record',
    channel: 'Record',
    logo: 'R',
    channelType: 'Aberta',
    title: 'Jornal da Record',
    subtitle: 'Resumo do dia',
    category: 'Noticias',
    start: '19:55',
    end: '21:00',
    rating: 'Livre',
    nextAirings: ['Amanha, 19:55'],
  },
  {
    id: 'brasil-urgente',
    channel: 'Band',
    logo: 'B',
    channelType: 'Aberta',
    title: 'Brasil Urgente',
    subtitle: 'Noticias ao vivo',
    category: 'Noticias',
    start: '16:00',
    end: '19:20',
    live: true,
    rating: '12',
    nextAirings: ['Amanha, 16:00'],
  },
  {
    id: 'roda-viva',
    channel: 'TV Cultura',
    logo: 'C',
    channelType: 'Aberta',
    title: 'Roda Viva',
    subtitle: 'Entrevista',
    category: 'Noticias',
    start: '22:00',
    end: '23:30',
    rating: 'Livre',
    nextAirings: ['Segunda que vem, 22:00'],
  },
  {
    id: 'brasileirao',
    channel: 'SporTV',
    logo: 'SP',
    channelType: 'Fechada',
    title: 'Brasileirao Serie A: Flamengo x Palmeiras',
    subtitle: 'Rodada nacional',
    category: 'Esportes',
    start: '19:00',
    end: '21:15',
    live: true,
    recommended: true,
    rating: 'Livre',
    nextAirings: ['Replay hoje, 23:40', 'Amanha, 10:00'],
  },
  {
    id: 'nba-hoje',
    channel: 'ESPN',
    logo: 'E',
    channelType: 'Fechada',
    title: 'SportsCenter',
    subtitle: 'Noticias e melhores momentos',
    category: 'Esportes',
    start: '20:00',
    end: '21:00',
    rating: 'Livre',
    nextAirings: ['Hoje, 23:00', 'Amanha, 07:00'],
  },
  {
    id: 'libertadores',
    channel: 'Paramount+',
    logo: 'P+',
    channelType: 'Fechada',
    title: 'Libertadores: Pre-jogo',
    subtitle: 'Mesa tática',
    category: 'Esportes',
    start: '21:00',
    end: '21:30',
    recommended: true,
    rating: 'Livre',
    nextAirings: ['Amanha, 18:30'],
  },
  {
    id: 'telecine-premium',
    channel: 'Telecine Premium',
    logo: 'TP',
    channelType: 'Fechada',
    title: 'Top Gun: Maverick',
    subtitle: 'Filme',
    category: 'Filmes',
    start: '20:10',
    end: '22:25',
    recommended: true,
    rating: '12',
    nextAirings: ['Quarta, 18:00', 'Sexta, 22:00', 'Domingo, 16:20'],
  },
  {
    id: 'tnt-cinema',
    channel: 'TNT',
    logo: 'T',
    channelType: 'Fechada',
    title: 'Homem-Aranha: Sem Volta para Casa',
    subtitle: 'Filme de aventura',
    category: 'Filmes',
    start: '18:30',
    end: '21:05',
    rating: '12',
    nextAirings: ['Amanha, 15:50', 'Sabado, 20:00'],
  },
  {
    id: 'warner-series',
    channel: 'Warner Channel',
    logo: 'W',
    channelType: 'Fechada',
    title: 'The Big Bang Theory',
    subtitle: 'Maratona',
    category: 'Series',
    start: '14:00',
    end: '18:00',
    rating: '10',
    nextAirings: ['Hoje, 23:30', 'Amanha, 14:00'],
  },
]

const categories: Category[] = ['Todos', 'Aberta', 'Esportes', 'Filmes', 'Series', 'Noticias']

function minutes(time: string) {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

function duration(start: string, end: string) {
  const startMinutes = minutes(start)
  const endMinutes = minutes(end)
  return endMinutes >= startMinutes ? endMinutes - startMinutes : endMinutes + 24 * 60 - startMinutes
}

function todayLabel() {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(new Date())
}

function App() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category>('Todos')
  const [selectedId, setSelectedId] = useState('brasileirao')

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

      return matchesQuery && matchesCategory
    })
  }, [category, query])

  const selected = programs.find((program) => program.id === selectedId) ?? programs[0]
  const recommendations = programs
    .filter((program) => program.recommended)
    .sort((a, b) => Number(b.category === 'Esportes') - Number(a.category === 'Esportes'))

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
            {visiblePrograms.map((program) => {
              const left = ((minutes(program.start) - guideStart) / guideSpan) * 100
              const width = (duration(program.start, program.end) / guideSpan) * 100

              return (
                <button
                  className={program.id === selected.id ? 'schedule-row selected' : 'schedule-row'}
                  key={program.id}
                  onClick={() => setSelectedId(program.id)}
                  type="button"
                >
                  <span className="channel-pill">
                    <span className="logo-dot">{program.logo}</span>
                    <span>
                      <strong>{program.channel}</strong>
                      <small>{program.channelType}</small>
                    </span>
                  </span>
                  <span className="timeline">
                    <span
                      className={`program-block ${program.category.toLowerCase()}`}
                      style={{ left: `${Math.max(0, left)}%`, width: `${Math.max(10, width)}%` }}
                    >
                      <span className="program-time">
                        {program.start} - {program.end}
                      </span>
                      <span className="program-title">{program.title}</span>
                      <span className="program-meta">
                        {program.live ? 'Ao vivo' : program.subtitle} · {program.rating}
                      </span>
                    </span>
                  </span>
                </button>
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
                    {program.channel} · {program.start}
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
              {selected.channel} · {selected.start} ate {selected.end} · Classificacao {selected.rating}
            </p>
          </div>
        </div>
        <div className="next-airings">
          <div className="next-title">
            <Clock3 size={16} />
            <span>Vai passar de novo</span>
          </div>
          {selected.nextAirings.map((airing) => (
            <span className="airing-chip" key={airing}>
              {airing}
            </span>
          ))}
        </div>
      </section>
    </main>
  )
}

export default App
