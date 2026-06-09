const CHANNELS_URL = 'https://raw.githubusercontent.com/iptv-org/epg/master/sites/mi.tv/mi.tv_br.channels.xml'

const PROFILES = {
  'pay-tv': { mode: 'pay-tv', limit: 120 },
  'br-priority': { mode: 'pay-tv', limit: 80 },
  'open-tv': { mode: 'patterns', limit: 60, patterns: [/globo/i, /sbt/i, /record/i, /^band$/i, /cultura/i, /rede tv/i, /gazeta/i, /futura/i] },
  sports: { mode: 'patterns', limit: 80, patterns: [/sportv/i, /espn/i, /premiere/i, /band sports/i, /bandsports/i, /combate/i, /canal off/i, /fox sports/i, /golf/i] },
  movies: { mode: 'patterns', limit: 80, patterns: [/telecine/i, /^tnt$/i, /warner/i, /megapix/i, /canal brasil/i, /space/i, /cinemax/i, /hbo/i, /paramount/i, /studio universal/i, /universal tv/i, /sony/i, /axn/i, /amc/i] },
}

export default async function handler(request, response) {
  const source = String(request.query.source || 'br-priority')
  const profile = PROFILES[source] || PROFILES['br-priority']
  const date = saoPauloDate()

  try {
    const channels = await loadBrazilianChannels(profile)
    const selectedChannels = channels.slice(0, profile.limit)
    const programs = []

    await Promise.all(
      selectedChannels.map(async (channel, index) => {
        const channelPrograms = await loadMiTvPrograms(channel, date, index)
        programs.push(...channelPrograms)
      }),
    )

    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600')
    response.status(200).json({
      date: date.replaceAll('-', ''),
      channels: selectedChannels.map((channel, index) => ({
        xmltv_id: channel.xmltvId,
        name: channel.name,
        site: 'mi.tv',
        site_id: channel.siteId,
        lang: 'pt',
        logo: channel.logo,
        index,
      })),
      programs: programs.sort((a, b) => a.start - b.start),
    })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load Brazilian EPG.',
    })
  }
}

async function loadBrazilianChannels(profile) {
  const xml = await fetch(CHANNELS_URL).then((res) => res.text())
  const channels = []
  const channelRegex = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g
  let match

  while ((match = channelRegex.exec(xml))) {
    const attrs = parseAttrs(match[1])
    const name = decodeXml(match[2].trim())
    const siteId = attrs.site_id || ''
    const id = siteId.split('#')[1]

    if (!id || !shouldUseChannel(name, profile)) continue

    channels.push({
      id,
      name,
      siteId,
      xmltvId: attrs.xmltv_id || `${slug(name)}.br@SD`,
      logo: `https://cdn.mitvstatic.com/channels/br_${id}_m.png`,
    })
  }

  return dedupeChannels(channels)
}

function shouldUseChannel(name, profile) {
  if (/\$nameFromProvider/i.test(name)) return false
  if (profile.mode === 'pay-tv') return isPayTvChannel(name)
  return profile.patterns.some((pattern) => pattern.test(name))
}

function isPayTvChannel(name) {
  const normalized = normalize(name)

  if (/(adulto|hustler|playboy|sexy|sexpriv[eé]|venus|private)/.test(normalized)) return false
  if (/(assembleia|camara|senado|justica|legislativo|universit|tval|tv uf|furb tv)/.test(normalized)) return false
  if (/(cancao nova|aparecida|boa vontade|rede vida|pai eterno|rit|rbi|nazare|ewtn)/.test(normalized)) return false
  if (/(shop|polishop|shoptime|mega tv|ideal tv)/.test(normalized)) return false

  if (/(bandnews|bandsports|band sports)/.test(normalized)) return true

  const openOrLocal =
    /(^|\b)(globo|sbt|record|rede tv|gazeta|cultura|tv brasil|cnt|futura)(\b|$)/.test(normalized) ||
    /^band(?!news|sports| sports)/.test(normalized) ||
    /(eptv|intertv|nsc tv|rbs tv|rpc|tv anhanguera|tv bahia|tv tem|tv tribuna|verdes mares|vanguarda|mirante|liberal|fronteira|cabugi|planicie|serra mar|alto litoral|roraima|piaui|maranhao|goiania|maceio|belem|manaus|amazonas|nordeste|brasilia|curitiba|campinas|ribeirao|chapeco|criciuma|florianopolis|joinville|porto alegre|rio grande|belo horizonte|natal|recife)/.test(
      normalized,
    )

  return !openOrLocal
}

async function loadMiTvPrograms(channel, date, channelIndex) {
  const url = `https://mi.tv/br/async/channel/${channel.id}/${date}/0`
  const html = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'pt-BR,pt;q=0.9,en;q=0.7',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    },
  }).then((res) => (res.ok ? res.text() : ''))

  const items = [...html.matchAll(/<li\b(?![^>]*class="native")[^>]*>[\s\S]*?program-link[\s\S]*?<\/li>/g)]
    .map((item) => parseMiTvItem(item[0], channel, date))
    .filter(Boolean)

  return items.map((item, index) => {
    const next = items[index + 1]
    return {
      site: 'mi.tv',
      channel: channel.xmltvId,
      start: item.start,
      stop: next?.start && next.start > item.start ? next.start : item.start + 60 * 60 * 1000,
      titles: [{ value: item.title, lang: 'pt' }],
      subTitles: item.subtitle ? [{ value: item.subtitle, lang: 'pt' }] : [],
      descriptions: item.description ? [{ value: item.description, lang: 'pt' }] : [],
      categories: item.subtitle ? [{ value: item.subtitle, lang: 'pt' }] : [],
      ratings: [],
      _channelSort: channelIndex,
    }
  })
}

function parseMiTvItem(html, channel, date) {
  const time = readTag(html, 'span', 'time')
  const title = stripTags(readTag(html, 'h2')).trim()
  if (!time || !title) return null

  return {
    title: decodeXml(title),
    subtitle: decodeXml(readTag(html, 'span', 'sub-title')),
    description: decodeXml(stripTags(readTag(html, 'p', 'synopsis')).replace(/\s+/g, ' ').trim()),
    start: new Date(`${date}T${time}:00-03:00`).getTime(),
    channel,
  }
}

function readTag(html, tag, className) {
  const classPart = className ? `[^>]*class=["'][^"']*${className}[^"']*["'][^>]*` : '[^>]*'
  const match = html.match(new RegExp(`<${tag}\\b${classPart}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match?.[1] || ''
}

function parseAttrs(value) {
  const attrs = {}
  for (const match of value.matchAll(/(\w+)="([^"]*)"/g)) attrs[match[1]] = decodeXml(match[2])
  return attrs
}

function dedupeChannels(channels) {
  const seen = new Set()
  return channels.filter((channel) => {
    const key = normalize(channel.name).replace(/\s+(hd|sd)$/i, '').replace(/\s+brazil$/i, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalize(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'e')
    .replace(/\s+/g, ' ')
    .trim()
}

function saoPauloDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const get = (type) => parts.find((part) => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function stripTags(value) {
  return value.replace(/<[^>]*>/g, ' ')
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function slug(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}
