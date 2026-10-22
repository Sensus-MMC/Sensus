import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const cli = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, '').split('=');
    return [key, value.length ? value.join('=') : true];
  })
);

const base = cli.base || process.env.SENSUS_TABLET_BASE || 'https://sensusmmc.news/';
const outDir = path.resolve(cli.out || 'tablet');
const maxArticles = Number(cli['max-articles'] ?? 10);
const extraPaths = String(cli.extras ?? '/about').split(',').map((value) => value.trim()).filter(Boolean);
const viewport = { width: 614, height: 616 };
const dpr = 3;
const tileSize = 2048;
const contentWidth = 307;
const sourceWidth = viewport.width * dpr;
const sourceHeight = viewport.height * dpr;

function resolveBase(value) {
  if (/^https?:\/\//i.test(value)) return value.endsWith('/') ? value : `${value}/`;
  const absolute = path.resolve(value);
  return pathToFileURL(absolute.endsWith(path.sep) ? absolute : `${absolute}${path.sep}`).href;
}

function installSeed() {
  let state = 0x9e3779b9;
  Math.random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function prepareDocument() {
  const height = Math.max(
    document.documentElement.scrollHeight,
    document.body ? document.body.scrollHeight : 0,
    window.innerHeight
  );
  const width = window.innerWidth;
  const canvas = document.getElementById('bg-canvas');
  if (canvas) {
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => height });
    Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => width });
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.zIndex = '-1';
    window.dispatchEvent(new Event('resize'));
  }
  window.scrollTo(0, 0);
  return { width, height };
}

function pageIdFor(url) {
  const parsed = new URL(url);
  if (parsed.pathname === '/' || parsed.pathname === '/index.html') return 'home';
  const trimmed = parsed.pathname.replace(/^\/+|\/+$/g, '');
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 96) || 'page';
}

function relativeUrl(url, origin) {
  const parsed = new URL(url);
  if (parsed.origin !== origin) return parsed.href;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function isSkippable(href) {
  return !href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:') || href === '#';
}

async function waitForContent(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    await Promise.all(
      Array.from(document.images).map((image) => {
        if (image.complete) return Promise.resolve();
        return new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        });
      })
    );
  });
}

async function readFeed(page, origin) {
  return page.evaluate(({ pageOrigin, scaleFactor }) => {
    const text = (element, selector) => element.querySelector(selector)?.textContent?.trim() || '';
    const absolute = (value) => {
      if (!value) return '';
      try {
        return new URL(value, document.baseURI).href;
      } catch {
        return '';
      }
    };
    const entries = Array.from(document.querySelectorAll('.article-entry'));
    return entries.map((entry, index) => {
      const anchor = entry.querySelector('h3 a, h2 a, .title a, a[href]');
      const time = entry.querySelector('time');
      const image = entry.querySelector('img');
      return {
        index,
        title: anchor?.textContent?.trim() || '',
        url: absolute(anchor?.getAttribute('href')),
        date: time?.getAttribute('datetime') || time?.textContent?.trim() || '',
        author: text(entry, '.meta-author'),
        excerpt: text(entry, '.excerpt'),
        image: absolute(image?.getAttribute('src')),
        origin: pageOrigin
      };
    });
  }, { pageOrigin: origin, scaleFactor: dpr });
}

async function readLinks(page, origin) {
  return page.evaluate(({ pageOrigin, scaleFactor }) => {
    const seen = new Set();
    return Array.from(document.querySelectorAll('a[href]'))
      .map((anchor) => {
        const rect = anchor.getBoundingClientRect();
        let url;
        try {
          url = new URL(anchor.getAttribute('href'), document.baseURI);
        } catch {
          return null;
        }
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        const href = url.origin === pageOrigin ? `${url.pathname}${url.search}${url.hash}` : url.href;
        if (href === '#' || href.startsWith('javascript:')) return null;
        const key = `${href}|${Math.round(rect.left)}|${Math.round(rect.top)}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return {
          x: Math.round((rect.left + window.scrollX) * scaleFactor),
          y: Math.round((rect.top + window.scrollY) * scaleFactor),
          width: Math.round(rect.width * scaleFactor),
          height: Math.round(rect.height * scaleFactor),
          href,
          external: url.origin !== pageOrigin,
          text: (anchor.textContent || '').trim().slice(0, 160)
        };
      })
      .filter((link) => link && link.width > 0 && link.height > 0);
  }, { pageOrigin: origin, scaleFactor: dpr });
}

function cropTile(image, tileY) {
  const tile = new PNG({ width: tileSize, height: tileSize });
  const contentHeight = Math.min(tileSize, image.height - tileY);
  for (let y = 0; y < tileSize; y += 1) {
    const sourceY = Math.min(tileY + y, image.height - 1);
    for (let x = 0; x < tileSize; x += 1) {
      const sourceX = Math.min(x, image.width - 1);
      const sourceIndex = (sourceY * image.width + sourceX) * 4;
      const targetIndex = (y * tileSize + x) * 4;
      tile.data[targetIndex] = image.data[sourceIndex];
      tile.data[targetIndex + 1] = image.data[sourceIndex + 1];
      tile.data[targetIndex + 2] = image.data[sourceIndex + 2];
      tile.data[targetIndex + 3] = image.data[sourceIndex + 3];
    }
  }
  return { tile, contentHeight };
}

async function writeTiles(image, pageDir, id) {
  const tiles = [];
  const count = Math.ceil(image.height / tileSize);
  await mkdir(pageDir, { recursive: true });
  for (let index = 0; index < count; index += 1) {
    const tileY = index * tileSize;
    const { tile, contentHeight } = cropTile(image, tileY);
    const name = `${String(index).padStart(4, '0')}.png`;
    await writeFile(path.join(pageDir, name), PNG.sync.write(tile));
    tiles.push({
      file: `${id}/${name}`,
      x: 0,
      y: tileY,
      width: tileSize,
      height: tileSize,
      contentWidth: image.width,
      contentHeight
    });
  }
  return tiles;
}

async function capturePage(page, url, id, origin, withLinks) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  const title = await page.title();
  if (/just a moment|attention required|cloudflare/i.test(title)) {
    throw new Error(`Blocked by Cloudflare at ${url}`);
  }
  await waitForContent(page);
  const fonts = await page.evaluate(() => ({
    georgia: document.fonts.check('18px Georgia'),
    arial: document.fonts.check('18px Arial')
  }));
  if ((!fonts.georgia || !fonts.arial) && !cli['allow-font-fallback']) {
    throw new Error(`Missing capture fonts at ${url}: ${JSON.stringify(fonts)}`);
  }
  await page.addStyleTag({
    content:
      'html{scrollbar-width:none}::-webkit-scrollbar{display:none}*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'
  });
  const metrics = await page.evaluate(prepareDocument);
  await page.waitForTimeout(600);
  const buffer = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
  const image = PNG.sync.read(buffer);
  if (image.width !== sourceWidth) {
    throw new Error(`Unexpected capture width ${image.width} at ${url}`);
  }
  const links = withLinks ? await readLinks(page, origin) : [];
  const pageDir = path.join(outDir, 'pages', id);
  const tiles = await writeTiles(image, pageDir, id);
  return {
    id,
    url: relativeUrl(url, origin),
    title,
    sourceWidth: image.width,
    sourceHeight: image.height,
    cssWidth: metrics.width,
    cssHeight: metrics.height,
    tiles,
    links: links.filter((link) => link.y < image.height && link.x < image.width)
  };
}

async function main() {
  const origin = new URL(resolveBase(base)).origin;
  const entry = new URL(resolveBase(base)).href;
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: dpr,
    isMobile: false,
    hasTouch: false,
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    colorScheme: 'dark',
    reducedMotion: 'reduce'
  });
  await context.addInitScript(installSeed);
  const page = await context.newPage();
  try {
    const home = await capturePage(page, entry, 'home', origin, true);
    const rawFeed = await readFeed(page, origin);
    const posts = [];
    const seenIds = new Set();
    for (const raw of rawFeed) {
      if (!raw.url) continue;
      const parsed = new URL(raw.url);
      if (parsed.origin !== origin) continue;
      let id = pageIdFor(raw.url);
      if (seenIds.has(id)) {
        let suffix = 2;
        while (seenIds.has(`${id}-${suffix}`)) suffix += 1;
        id = `${id}-${suffix}`;
      }
      seenIds.add(id);
      posts.push({
        id,
        title: raw.title,
        url: relativeUrl(raw.url, origin),
        date: raw.date,
        author: raw.author,
        excerpt: raw.excerpt,
        image: raw.image,
        page: id
      });
    }
    const pages = [home];
    for (const post of posts.slice(0, maxArticles)) {
      const url = new URL(post.url, entry).href;
      const captured = await capturePage(page, url, post.id, origin, true);
      pages.push(captured);
      post.page = captured.id;
    }
    for (const extra of extraPaths) {
      const url = new URL(extra, entry).href;
      const id = pageIdFor(url);
      if (pages.some((captured) => captured.id === id)) continue;
      pages.push(await capturePage(page, url, id, origin, true));
    }
    const manifest = {
      schema: 1,
      generated: new Date().toISOString(),
      viewport: {
        cssWidth: viewport.width,
        cssHeight: viewport.height,
        dpr,
        sourceWidth,
        sourceHeight,
        scale: contentWidth / sourceWidth
      },
      fonts: { georgia: true, arial: true },
      pages
    };
    await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(
      path.join(outDir, 'feed.json'),
      `${JSON.stringify({ schema: 1, generated: manifest.generated, posts }, null, 2)}\n`
    );
    process.stdout.write(
      `captured ${pages.length} page(s), ${posts.length} post(s), ${pages.reduce((sum, item) => sum + item.tiles.length, 0)} tile(s)\n`
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
