import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

import {
  renderArticlePage,
  renderHomePage,
  renderTemplatePage,
  getSiteOrigin,
  rootDir,
} from './site.mjs'

const assetsDir = path.join(rootDir, 'assets')
const port = Number(process.env.PORT || 4173)

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

const sendHtml = (response, statusCode, html) => {
  response.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(html)
}

const sendText = (response, statusCode, message) => {
  response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end(message)
}

const normalizeTemplatePath = (requestPath) => {
  const pathname = requestPath.replace(/^\/+|\/+$/g, '')

  if (!pathname || pathname.includes('/')) {
    return null
  }

  const withoutExtension = pathname.endsWith('.html') ? pathname.slice(0, -5) : pathname

  if (
    !withoutExtension ||
    withoutExtension === 'index' ||
    !/^[a-z0-9_-]+$/i.test(withoutExtension)
  ) {
    return null
  }

  return withoutExtension
}

const resolveAssetPath = async (requestPath) => {
  const assetPath = requestPath.replace(/^\/assets\//, '')
  const targetPath = path.normalize(path.join(assetsDir, assetPath))

  if (!targetPath.startsWith(assetsDir)) {
    return null
  }

  try {
    const fileStats = await stat(targetPath)

    if (fileStats.isDirectory()) {
      return null
    }

    return targetPath
  } catch {
    return null
  }
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

  try {
    if (requestUrl.pathname === '/health') {
      sendText(response, 200, 'ok')
      return
    }

    if (requestUrl.pathname.startsWith('/assets/')) {
      const filePath = await resolveAssetPath(requestUrl.pathname)

      if (!filePath) {
        sendText(response, 404, 'Not found')
        return
      }

      const ext = path.extname(filePath)
      response.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      })
      createReadStream(filePath).pipe(response)
      return
    }

    const siteOrigin = getSiteOrigin(request)

    if (
      requestUrl.pathname === '/' ||
      requestUrl.pathname === '/index' ||
      requestUrl.pathname === '/index.html'
    ) {
      sendHtml(response, 200, await renderHomePage(siteOrigin))
      return
    }

    const articleMatch = requestUrl.pathname.match(/^\/articles\/([^/]+?)(?:\.html)?$/)

    if (articleMatch) {
      const slug = decodeURIComponent(articleMatch[1])
      const articlePage = await renderArticlePage(slug, siteOrigin)

      if (!articlePage) {
        sendText(response, 404, 'Not found')
        return
      }

      sendHtml(response, 200, articlePage)
      return
    }

    const templateName = normalizeTemplatePath(requestUrl.pathname)

    if (templateName) {
      try {
        sendHtml(response, 200, await renderTemplatePage(templateName, siteOrigin))
        return
      } catch {
        sendText(response, 404, 'Not found')
        return
      }
    }

    sendText(response, 404, 'Not found')
  } catch (error) {
    console.error(error)
    sendText(response, 500, 'Internal Server Error')
  }
})

server.listen(port, () => {
  console.log(`Sensus server available at http://localhost:${port}`)
})
