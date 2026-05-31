;(function () {
  var slugPlaceholder = 'ARTICLE-SLUG'
  var defaultApiBase = 'http://217.154.208.191:3100/api/articles'

  var articleElement = document.querySelector('[data-sensus-article]')

  if (!articleElement) {
    return
  }

  var titleElement = document.getElementById('article-title')
  var metaElement = document.getElementById('article-meta')
  var taxonomyElement = document.getElementById('article-taxonomy')
  var statusElement = document.getElementById('article-status')
  var contentElement = document.getElementById('article-content')
  var featureFigureElement = document.getElementById('article-feature-media')
  var featureImageElement = document.getElementById('article-feature-image')
  var featureCaptionElement = document.getElementById('article-feature-caption')

  var searchParams = new URLSearchParams(window.location.search)
  var apiBase = searchParams.get('api') || getMetaContent('sensus-api-base') || defaultApiBase
  var articleSlug =
    searchParams.get('slug') ||
    normalizeConfiguredSlug(getMetaContent('sensus-article-slug')) ||
    deriveSlugFromPath(window.location.pathname)

  if (!titleElement || !metaElement || !contentElement || !statusElement) {
    return
  }

  loadArticle().catch(function (error) {
    renderError(error instanceof Error ? error.message : 'Unable to load article content.')
  })

  async function loadArticle() {
    if (!articleSlug) {
      throw new Error('No article slug is configured for this page.')
    }

    setStatus('Loading article...')

    var requestUrl = new URL(apiBase)
    requestUrl.searchParams.set('where[slug][equals]', articleSlug)
    requestUrl.searchParams.set('limit', '1')
    requestUrl.searchParams.set('depth', '1')

    var response = await fetch(requestUrl.toString(), {
      headers: {
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error('Article request failed with status ' + response.status + '.')
    }

    var payload = await response.json()
    var article = Array.isArray(payload.docs) ? payload.docs[0] : null

    if (!article) {
      throw new Error('No published article was returned for slug "' + articleSlug + '".')
    }

    renderArticle(article, requestUrl)
  }

  function renderArticle(article, requestUrl) {
    var summary = getSummary(article)
    var featureImage = getFeatureImage(article)
    var featureImageUrl =
      featureImage && featureImage.url ? toAbsoluteUrl(featureImage.url, requestUrl) : null

    titleElement.textContent = article.title || 'Untitled article'
    renderMeta(article)
    renderTaxonomy(article)
    renderFeatureMedia(featureImage, featureImageUrl)
    renderContent(article, summary, requestUrl)
    updateHead(article, summary, featureImageUrl)
    clearStatus()
  }

  function renderMeta(article) {
    var publishedLabel = formatDate(article.publishedAt)
    var authorProfiles = getAuthorProfiles(article)

    metaElement.textContent = ''

    if (publishedLabel) {
      metaElement.appendChild(document.createTextNode(publishedLabel + ' \u00a0 '))
    }

    if (authorProfiles.length === 0) {
      metaElement.appendChild(document.createTextNode('Editorial'))
      return
    }

    authorProfiles.forEach(function (authorProfile, index) {
      appendAuthorSeparator(index, authorProfiles.length)
      appendAuthorProfile(authorProfile)
    })
  }

  function getAuthorProfiles(article) {
    var authorProfile = article.authorProfile
    var authorProfiles = Array.isArray(authorProfile)
      ? authorProfile
      : authorProfile && typeof authorProfile === 'object'
        ? [authorProfile]
        : []

    return authorProfiles.filter(function (profile) {
      return profile && typeof profile === 'object' && getAuthorName(profile).length > 0
    })
  }

  function getAuthorName(authorProfile) {
    if (
      authorProfile &&
      typeof authorProfile.displayName === 'string' &&
      authorProfile.displayName.trim().length > 0
    ) {
      return authorProfile.displayName.trim()
    }

    if (
      authorProfile &&
      typeof authorProfile.username === 'string' &&
      authorProfile.username.trim().length > 0
    ) {
      return authorProfile.username.trim()
    }

    return ''
  }

  function appendAuthorSeparator(index, total) {
    if (index === 0) {
      return
    }

    if (total === 2) {
      metaElement.appendChild(document.createTextNode(' and '))
      return
    }

    if (index === total - 1) {
      metaElement.appendChild(document.createTextNode(', and '))
      return
    }

    metaElement.appendChild(document.createTextNode(', '))
  }

  function appendAuthorProfile(authorProfile) {
    var authorName = getAuthorName(authorProfile)
    var authorWebsite = authorProfile.website

    if (authorWebsite && isSafeHttpUrl(authorWebsite)) {
      var authorLink = document.createElement('a')
      authorLink.href = authorWebsite
      authorLink.rel = 'noopener noreferrer'
      authorLink.target = '_blank'
      authorLink.textContent = authorName
      metaElement.appendChild(authorLink)
      return
    }

    metaElement.appendChild(document.createTextNode(authorName))
  }

  function renderTaxonomy(article) {
    if (!taxonomyElement) {
      return
    }

    var categories = mapRelationshipTitles(article.categories)
    var tags = mapRelationshipTitles(article.tags)
    var parts = []

    if (categories.length > 0) {
      parts.push('Desk: ' + categories.join(', '))
    }

    if (tags.length > 0) {
      parts.push('Topics: ' + tags.join(', '))
    }

    if (parts.length === 0) {
      taxonomyElement.hidden = true
      taxonomyElement.textContent = ''
      return
    }

    taxonomyElement.hidden = false
    taxonomyElement.textContent = parts.join(' | ')
  }

  function renderFeatureMedia(featureImage, featureImageUrl) {
    if (
      !featureFigureElement ||
      !featureImageElement ||
      !featureCaptionElement ||
      !featureImageUrl
    ) {
      if (featureFigureElement) {
        featureFigureElement.hidden = true
      }

      return
    }

    featureFigureElement.hidden = false
    featureImageElement.src = featureImageUrl
    featureImageElement.alt = featureImage.alt || titleElement.textContent || 'Article image'
    featureCaptionElement.textContent = featureImage.alt || ''
    featureCaptionElement.hidden = featureCaptionElement.textContent.length === 0
  }

  function renderContent(article, summary, requestUrl) {
    contentElement.textContent = ''

    if (typeof article.contentHtml === 'string' && article.contentHtml.trim().length > 0) {
      contentElement.innerHTML = rewriteRelativeAssetUrls(article.contentHtml, requestUrl)
      return
    }

    var fallbackParagraph = document.createElement('p')
    fallbackParagraph.className = 'article-empty'
    fallbackParagraph.textContent =
      summary || 'This article does not have rendered body content yet.'
    contentElement.appendChild(fallbackParagraph)
  }

  function rewriteRelativeAssetUrls(html, requestUrl) {
    var fragment = document.createElement('div')
    fragment.innerHTML = html

    fragment.querySelectorAll('[src]').forEach(function (element) {
      var source = element.getAttribute('src')

      if (source) {
        element.setAttribute('src', toAbsoluteUrl(source, requestUrl))
      }
    })

    fragment.querySelectorAll('[srcset]').forEach(function (element) {
      var srcset = element.getAttribute('srcset')

      if (!srcset) {
        return
      }

      var rewrittenSrcset = srcset
        .split(',')
        .map(function (entry) {
          var trimmedEntry = entry.trim()

          if (!trimmedEntry) {
            return trimmedEntry
          }

          var pieces = trimmedEntry.split(/\s+/, 2)
          var absoluteUrl = toAbsoluteUrl(pieces[0], requestUrl)
          return pieces[1] ? absoluteUrl + ' ' + pieces[1] : absoluteUrl
        })
        .join(', ')

      element.setAttribute('srcset', rewrittenSrcset)
    })

    return fragment.innerHTML
  }

  function updateHead(article, summary, featureImageUrl) {
    var title = (article.title || 'Untitled article') + ' - Sensus MMC'
    document.title = title

    setMetaContent('name', 'description', summary)
    setMetaContent('property', 'og:url', window.location.href)
    setMetaContent('property', 'og:title', title)
    setMetaContent('property', 'og:description', summary)
    setMetaContent('name', 'twitter:title', title)
    setMetaContent('name', 'twitter:description', summary)

    if (featureImageUrl) {
      setMetaContent('property', 'og:image', featureImageUrl)
      setMetaContent('property', 'og:image:url', featureImageUrl)
      setMetaContent('property', 'og:image:secure_url', featureImageUrl)
      setMetaContent('name', 'twitter:image', featureImageUrl)
    }
  }

  function renderError(message) {
    titleElement.textContent = 'Article unavailable'
    metaElement.textContent = 'Unable to load article content.'
    contentElement.textContent = ''

    var errorParagraph = document.createElement('p')
    errorParagraph.className = 'article-empty'
    errorParagraph.textContent = message
    contentElement.appendChild(errorParagraph)

    if (taxonomyElement) {
      taxonomyElement.hidden = true
      taxonomyElement.textContent = ''
    }

    if (featureFigureElement) {
      featureFigureElement.hidden = true
    }

    setStatus(message, true)
  }

  function setStatus(message, isError) {
    statusElement.hidden = false
    statusElement.textContent = message
    statusElement.classList.toggle('article-status--error', Boolean(isError))
  }

  function clearStatus() {
    statusElement.hidden = true
    statusElement.textContent = ''
    statusElement.classList.remove('article-status--error')
  }

  function getSummary(article) {
    if (typeof article.excerpt === 'string' && article.excerpt.trim().length > 0) {
      return article.excerpt.trim()
    }

    if (typeof article.contentHtml === 'string' && article.contentHtml.trim().length > 0) {
      return article.contentHtml
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180)
    }

    return 'Sensus MMC article covering modded Minecraft news, pack updates, and community happenings.'
  }

  function getFeatureImage(article) {
    return article &&
      typeof article.featureImage === 'object' &&
      article.featureImage !== null &&
      'url' in article.featureImage
      ? article.featureImage
      : null
  }

  function mapRelationshipTitles(value) {
    if (!Array.isArray(value)) {
      return []
    }

    return value
      .filter(function (entry) {
        return entry && typeof entry === 'object' && 'title' in entry
      })
      .map(function (entry) {
        return entry.title
      })
      .filter(Boolean)
  }

  function formatDate(value) {
    if (!value) {
      return ''
    }

    var date = new Date(value)

    if (Number.isNaN(date.getTime())) {
      return ''
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(date)
  }

  function getMetaContent(name) {
    var meta = document.querySelector('meta[name="' + name + '"]')
    return meta ? meta.getAttribute('content') : ''
  }

  function setMetaContent(attributeName, attributeValue, content) {
    var selector = 'meta[' + attributeName + '="' + attributeValue + '"]'
    var meta = document.querySelector(selector)

    if (meta) {
      meta.setAttribute('content', content)
    }
  }

  function normalizeConfiguredSlug(value) {
    if (!value || value === slugPlaceholder) {
      return ''
    }

    return value.trim()
  }

  function deriveSlugFromPath(pathname) {
    var fileName = pathname.split('/').pop() || ''
    return fileName.replace(/\.html$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, '')
  }

  function isSafeHttpUrl(value) {
    try {
      var url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch (error) {
      return false
    }
  }

  function toAbsoluteUrl(value, requestUrl) {
    if (!value) {
      return value
    }

    try {
      return new URL(value, requestUrl.origin).toString()
    } catch (error) {
      return value
    }
  }
})()
