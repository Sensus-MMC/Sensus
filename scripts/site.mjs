import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const rootDir = path.resolve(__dirname, '..')

export const config = {
  apiBase: process.env.SENSUS_API_BASE || 'http://127.0.0.1:3100/api/articles',
  defaultOgImage: process.env.SENSUS_OG_IMAGE || null,
  siteDescription:
    'Sensus is a bi-weekly newsletter covering modded Minecraft news, pack updates, and community happenings.',
  siteName: 'Sensus MMC',
  siteOrigin: process.env.SENSUS_SITE_ORIGIN?.replace(/\/$/, '') || null,
}

const ogImageTypeMap = new Map([
  ['.gif', 'image/gif'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
])

const getDefaultOgImage = (siteOrigin) =>
  config.defaultOgImage || `${siteOrigin.replace(/\/$/, '')}/assets/Sensus-banner.webp`

const getOgImageType = (value) => {
  try {
    const pathname = new URL(value, 'https://sensusmmc.news').pathname.toLowerCase()
    return ogImageTypeMap.get(path.extname(pathname)) || 'image/webp'
  } catch {
    return 'image/webp'
  }
}

const templateCache = new Map()

const getCachedTemplate = async (relativePath) => {
  if (!templateCache.has(relativePath)) {
    templateCache.set(relativePath, readFile(path.join(rootDir, relativePath), 'utf8'))
  }

  return templateCache.get(relativePath)
}

const getHeaderValue = (value) => {
  if (Array.isArray(value)) {
    return value[0] || ''
  }

  return value || ''
}

export const getSiteOrigin = (request) => {
  if (config.siteOrigin) {
    return config.siteOrigin
  }

  const forwardedProto = getHeaderValue(request?.headers['x-forwarded-proto']).split(',')[0].trim()
  const forwardedHost = getHeaderValue(request?.headers['x-forwarded-host']).split(',')[0].trim()
  const protocol = forwardedProto || (request?.socket?.encrypted ? 'https' : 'http')
  const host =
    forwardedHost ||
    getHeaderValue(request?.headers.host) ||
    `localhost:${process.env.PORT || 4173}`

  return `${protocol}://${host}`.replace(/\/$/, '')
}

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const stripHtml = (value) =>
  value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const formatDate = (value) => {
  if (!value) {
    return 'Unscheduled'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Unscheduled'
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

const resolveMedia = (value) =>
  value && typeof value === 'object' && value !== null && 'url' in value ? value : null

const getApiOrigin = () => {
  try {
    return new URL(config.apiBase).origin
  } catch {
    return ''
  }
}

const absoluteAssetUrl = (value) => {
  if (!value) {
    return ''
  }

  try {
    return new URL(value, getApiOrigin()).toString()
  } catch {
    return value
  }
}

const rewriteRelativeAssetUrls = (html) => {
  if (!html) {
    return ''
  }

  return html
    .replace(/(src=")([^":][^"]*)"/g, (_match, prefix, src) => `${prefix}${absoluteAssetUrl(src)}"`)
    .replace(/(srcset=")([^"]*)"/g, (_match, prefix, srcset) => {
      const rewritten = srcset
        .split(',')
        .map((entry) => {
          const trimmed = entry.trim()

          if (!trimmed) {
            return trimmed
          }

          const [assetUrl, descriptor] = trimmed.split(/\s+/, 2)
          const nextUrl = absoluteAssetUrl(assetUrl)
          return descriptor ? `${nextUrl} ${descriptor}` : nextUrl
        })
        .join(', ')

      return `${prefix}${rewritten}"`
    })
}

const getRelationshipTitles = (value) =>
  Array.isArray(value)
    ? value
        .filter((entry) => entry && typeof entry === 'object' && 'title' in entry)
        .map((entry) => entry.title)
        .filter(Boolean)
    : []

const getAuthorProfiles = (article) => {
  const authorProfile = article.authorProfile

  if (Array.isArray(authorProfile)) {
    return authorProfile
  }

  if (authorProfile && typeof authorProfile === 'object') {
    return [authorProfile]
  }

  return []
}

const getAuthorLabel = (profile) => {
  if (typeof profile?.displayName === 'string' && profile.displayName.trim().length > 0) {
    return profile.displayName.trim()
  }

  if (typeof profile?.username === 'string' && profile.username.trim().length > 0) {
    return profile.username.trim()
  }

  return ''
}

const joinAuthorNames = (names) => {
  if (names.length === 0) {
    return 'Editorial'
  }

  if (names.length === 1) {
    return names[0]
  }

  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`
  }

  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

const getAuthorName = (article) => {
  const names = getAuthorProfiles(article).map(getAuthorLabel).filter(Boolean)

  return joinAuthorNames(names)
}

const getSummary = (article) => {
  if (typeof article.excerpt === 'string' && article.excerpt.trim().length > 0) {
    return article.excerpt.trim()
  }

  if (typeof article.contentHtml === 'string' && article.contentHtml.trim().length > 0) {
    return stripHtml(article.contentHtml).slice(0, 180)
  }

  return config.siteDescription
}

const getDateTimeAttribute = (value) => {
  if (!value) {
    return ''
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toISOString()
}

const buildMetaLine = (article) => {
  const formattedDate = escapeHtml(formatDate(article.publishedAt))
  const dateTime = getDateTimeAttribute(article.publishedAt)
  const timeMarkup = dateTime
    ? `<time class="meta-time" datetime="${dateTime}">${formattedDate}</time>`
    : `<span class="meta-time">${formattedDate}</span>`

  return `<span class="meta-item meta-item--time">${timeMarkup}</span><span class="meta-separator" aria-hidden="true">•</span><span class="meta-item meta-item--author"><span class="meta-byline">By</span><span class="meta-author">${escapeHtml(getAuthorName(article))}</span></span>`
}

const buildTaxonomyGroup = (label, values) => {
  if (values.length === 0) {
    return ''
  }

  const chips = values
    .map((value) => `<span class="article-taxonomy-chip">${escapeHtml(value)}</span>`)
    .join('')

  return `<div class="article-taxonomy-group">
    <span class="article-taxonomy-label">${escapeHtml(label)}</span>
    <div class="article-taxonomy-values">${chips}</div>
  </div>`
}

const buildArticleTaxonomy = (article) => {
  const desks = getRelationshipTitles(article.categories)
  const topics = getRelationshipTitles(article.tags)
  const groups = [buildTaxonomyGroup('Desk', desks), buildTaxonomyGroup('Topics', topics)].filter(
    Boolean,
  )

  if (groups.length === 0) {
    return ''
  }

  return `<div class="article-taxonomy">${groups.join('')}</div>`
}

const buildArticleContent = (article) => {
  const parts = []
  const featureImage = resolveMedia(article.featureImage)

  if (featureImage?.url) {
    const featureAlt = featureImage.alt ? escapeHtml(featureImage.alt) : escapeHtml(article.title)
    parts.push(
      `<p><img src="${escapeHtml(absoluteAssetUrl(featureImage.url))}" alt="${featureAlt}"></p>`,
    )
  }

  if (typeof article.contentHtml === 'string' && article.contentHtml.trim().length > 0) {
    parts.push(rewriteRelativeAssetUrls(article.contentHtml))
  } else if (typeof article.excerpt === 'string' && article.excerpt.trim().length > 0) {
    parts.push(`<p>${escapeHtml(article.excerpt.trim())}</p>`)
  } else {
    parts.push('<p>No article body is available yet.</p>')
  }

  return parts.join('\n')
}

const renderTemplate = (template, replacements) => {
  let output = template

  for (const [key, value] of Object.entries(replacements)) {
    output = output.replaceAll(`{{${key}}}`, value)
  }

  return output
}

const fetchPayload = async (requestUrl) => {
  const response = await fetch(requestUrl, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch articles: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

export const fetchAllArticles = async () => {
  const docs = []
  let nextPage = 1

  while (nextPage) {
    const requestUrl = new URL(config.apiBase)
    requestUrl.searchParams.set('depth', '1')
    requestUrl.searchParams.set('limit', '50')
    requestUrl.searchParams.set('page', String(nextPage))
    requestUrl.searchParams.set('sort', '-publishedAt')

    const payload = await fetchPayload(requestUrl)
    docs.push(...(Array.isArray(payload.docs) ? payload.docs : []))
    nextPage = payload.hasNextPage ? payload.nextPage : null
  }

  return docs
}

export const fetchArticleBySlug = async (slug) => {
  const requestUrl = new URL(config.apiBase)
  requestUrl.searchParams.set('depth', '1')
  requestUrl.searchParams.set('limit', '1')
  requestUrl.searchParams.set('where[slug][equals]', slug)

  const payload = await fetchPayload(requestUrl)
  return Array.isArray(payload.docs) && payload.docs.length > 0 ? payload.docs[0] : null
}

const renderArticleEntry = (article) => {
  const summary = escapeHtml(getSummary(article))
  const title = escapeHtml(article.title || 'Untitled article')
  const url = `/articles/${encodeURIComponent(article.slug)}`

  return `<div class="article-entry">
            <img class="entry-icon" src="assets/Sensus-logo.png" alt="">
            <div class="entry-text">
                <h3><a href="${url}">${title}</a></h3>
                <div class="meta">${buildMetaLine(article)}</div>
                <div class="excerpt">${summary}</div>
            </div>
        </div>`
}

export const renderHomePage = async (siteOrigin) => {
  const template = await getCachedTemplate('index.html')
  const articles = await fetchAllArticles()
  const ogImage = getDefaultOgImage(siteOrigin)
  const listings =
    articles.length > 0
      ? articles.map(renderArticleEntry).join('\n')
      : `<div class="article-entry">
            <img class="entry-icon" src="assets/Sensus-logo.png" alt="">
            <div class="entry-text">
                <h3>No issues published yet</h3>
                <div class="meta">Editorial</div>
                <div class="excerpt">Publish a Payload article to populate this page.</div>
            </div>
        </div>`

  return renderTemplate(template, {
    ARTICLE_LISTINGS: listings,
    OG_IMAGE: escapeHtml(ogImage),
    OG_IMAGE_TYPE: escapeHtml(getOgImageType(ogImage)),
    SITE_ORIGIN: siteOrigin,
  })
}

export const renderTemplatePage = async (pageName, siteOrigin) => {
  const templatePath = `${pageName}.html`

  await access(path.join(rootDir, templatePath))

  const template = await getCachedTemplate(templatePath)
  const ogImage = getDefaultOgImage(siteOrigin)

  return renderTemplate(template, {
    OG_IMAGE: escapeHtml(ogImage),
    OG_IMAGE_TYPE: escapeHtml(getOgImageType(ogImage)),
    SITE_ORIGIN: siteOrigin,
  })
}

export const renderArticlePage = async (slug, siteOrigin) => {
  const article = await fetchArticleBySlug(slug)

  if (!article) {
    return null
  }

  const template = await getCachedTemplate(path.join('articles', '_template.html'))
  const title = article.title || 'Untitled article'
  const summary = getSummary(article)
  const featureImage = resolveMedia(article.featureImage)
  const ogImage = featureImage?.url
    ? absoluteAssetUrl(featureImage.url)
    : getDefaultOgImage(siteOrigin)
  const articleUrl = `${siteOrigin}/articles/${encodeURIComponent(article.slug)}`

  return renderTemplate(template, {
    ARTICLE_BODY: buildArticleContent(article),
    ARTICLE_HEADING: escapeHtml(title),
    ARTICLE_META: buildMetaLine(article),
    ARTICLE_TAXONOMY: buildArticleTaxonomy(article),
    ARTICLE_URL: articleUrl,
    OG_IMAGE: escapeHtml(ogImage),
    OG_IMAGE_TYPE: escapeHtml(getOgImageType(ogImage)),
    PAGE_DESCRIPTION: escapeHtml(summary),
    PAGE_TITLE: escapeHtml(`${title} - ${config.siteName}`),
  })
}
