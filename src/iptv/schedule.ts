// Regras de gravacao -> ocorrencias concretas (inicio/fim) a partir da EPG.
// Funcoes puras, sem dependencia de navegador, para facilitar teste.

import type { Occurrence, Programme, RecordingRule } from './types'

const MIN = 60_000
const DAY = 24 * 60 * MIN

export function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function titleMatches(title: string, rule: Pick<RecordingRule, 'title' | 'match'>) {
  const wanted = normalizeTitle(rule.title)
  if (!wanted) return false
  const actual = normalizeTitle(title)
  return rule.match === 'exact' ? actual === wanted : actual.includes(wanted)
}

export function parseTime(value: string | undefined) {
  const match = value?.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function minuteOfDay(ts: number) {
  const date = new Date(ts)
  return date.getHours() * 60 + date.getMinutes()
}

function circularDiff(a: number, b: number) {
  const diff = Math.abs(a - b) % 1440
  return Math.min(diff, 1440 - diff)
}

function startOfDay(ts: number) {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function atMinute(day: number, minutes: number) {
  const date = new Date(day)
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return date.getTime()
}

/** Dias (meia-noite local) entre from e to. */
function daysBetween(from: number, to: number) {
  const days: number[] = []
  for (let day = startOfDay(from); day <= to; day = startOfDay(day + DAY + 2 * 60 * MIN)) days.push(day)
  return days
}

/**
 * @param programmes EPG do canal da regra (null = EPG indisponivel).
 */
export function computeOccurrences(
  rule: RecordingRule,
  programmes: Programme[] | null,
  from: number,
  to: number,
): Occurrence[] {
  if (!rule.enabled) return []
  const padBefore = rule.padBeforeMin * MIN
  const padAfter = rule.padAfterMin * MIN
  const make = (programStart: number, programStop: number, title: string, source: Occurrence['source']): Occurrence => ({
    key: `${rule.id}@${programStart}`,
    ruleId: rule.id,
    title,
    channel: rule.channel,
    start: programStart - padBefore,
    stop: programStop + padAfter,
    programStart,
    programStop,
    source,
  })

  if (rule.kind === 'once') {
    if (!rule.start || !rule.stop) return []
    const occurrence = make(rule.start, rule.stop, rule.title || rule.channel.name, 'once')
    return occurrence.stop > from && occurrence.start < to ? [occurrence] : []
  }

  const usual = parseTime(rule.time)
  const duration = (rule.durationMin ?? 60) * MIN
  const result: Occurrence[] = []
  const days = daysBetween(from - DAY, to)

  if (rule.kind === 'daily') {
    if (usual == null) return []
    for (const day of days) {
      if (!rule.days.includes(new Date(day).getDay())) continue
      const start = atMinute(day, usual)
      const title = rule.title || titleAt(programmes, start) || rule.channel.name
      result.push(make(start, start + duration, title, 'time'))
    }
    return result.filter((item) => item.stop > from && item.start < to)
  }

  // series: procura o titulo na EPG
  const list = programmes ?? []
  for (const programme of list) {
    if (!titleMatches(programme.title, rule)) continue
    if (!rule.days.includes(new Date(programme.start).getDay())) continue
    if (rule.toleranceMin > 0 && usual != null && circularDiff(minuteOfDay(programme.start), usual) > rule.toleranceMin) continue
    result.push(make(programme.start, programme.stop, programme.title, 'epg'))
  }

  // Sem EPG naquele horario: grava no horario habitual.
  if (rule.fallbackToTime && usual != null) {
    for (const day of days) {
      if (!rule.days.includes(new Date(day).getDay())) continue
      const start = atMinute(day, usual)
      const window = Math.max(rule.toleranceMin, 60) * MIN
      const covered = list.some((item) => item.stop > start - window && item.start < start + duration + window)
      if (covered) continue
      result.push(make(start, start + duration, rule.title || rule.channel.name, 'time'))
    }
  }

  return dedupe(result.filter((item) => item.stop > from && item.start < to))
}

function titleAt(programmes: Programme[] | null, ts: number) {
  return programmes?.find((item) => item.start <= ts + 5 * MIN && item.stop > ts + 5 * MIN)?.title
}

/** Remove ocorrencias sobrepostas da mesma regra (ex.: dois blocos do mesmo programa colados). */
function dedupe(list: Occurrence[]) {
  const sorted = [...list].sort((a, b) => a.start - b.start)
  const out: Occurrence[] = []
  for (const item of sorted) {
    const last = out[out.length - 1]
    if (last && item.start < last.stop) {
      // Programa dividido em partes consecutivas na EPG: grava tudo num arquivo so.
      last.stop = Math.max(last.stop, item.stop)
      last.programStop = Math.max(last.programStop, item.programStop)
      continue
    }
    out.push({ ...item })
  }
  return out
}
