import { Parser } from 'htmlparser2';
import { withSafeFetch, redactSsrfError } from '../../common/security/ssrf-guard';

export async function readStudioResponse(
  response: { body: { getReader(): ReadableStreamDefaultReader<Uint8Array> } | null },
  limit = 262144,
): Promise<string> {
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (reader)
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > limit) throw new Error('Response exceeds 256 KB.');
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  return Buffer.concat(chunks).toString('utf8');
}
const clean = (value: string) =>
  value
    .replace(/[\t\r ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
const excluded = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'nav',
  'footer',
  'form',
]);
const blocks = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'li',
  'br',
  'tr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);
export function extractStudioHtml(html: string, url: string, mode = 'auto', maxChars = 20000) {
  const stack: {
    name: string;
    skip: boolean;
    main: boolean;
    article: boolean;
    heading?: { text: string };
    link?: { url: string; text: string };
  }[] = [];
  let title = '';
  const text: string[] = [];
  const main: string[] = [];
  const article: string[] = [];
  const headings: string[] = [];
  const links: { url: string; text: string }[] = [];
  const add = (value: string) => {
    text.push(value);
    if (stack.some(frame => frame.main)) main.push(value);
    if (stack.some(frame => frame.article)) article.push(value);
  };
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (stack.length >= 256) throw new Error('Website markup is too deeply nested.');
        const parent = stack[stack.length - 1];
        const skip =
          !!parent?.skip ||
          excluded.has(name) ||
          'hidden' in attrs ||
          attrs['aria-hidden'] === 'true' ||
          /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.style || '');
        const frame: (typeof stack)[number] = { name, skip, main: name === 'main', article: name === 'article' };
        if (!skip && /^h[1-6]$/.test(name)) frame.heading = { text: '' };
        if (!skip && name === 'a' && links.length < 20 && attrs.href)
          try {
            const link = new URL(attrs.href, url);
            if (['https:', 'http:'].includes(link.protocol) && !link.username && !link.password)
              frame.link = { url: link.href, text: '' };
          } catch {
            /* Ignore invalid links. */
          }
        stack.push(frame);
        if (!skip && blocks.has(name)) add('\n');
      },
      ontext(value) {
        if (stack.some(frame => frame.name === 'title')) {
          title += value;
          return;
        }
        if (stack.some(frame => frame.skip || frame.name === 'head')) return;
        add(value);
        for (const frame of stack) {
          if (frame.heading) frame.heading.text += value;
          if (frame.link) frame.link.text += value;
        }
      },
      onclosetag() {
        const frame = stack.pop();
        if (!frame || frame.skip) return;
        if (frame.heading && headings.length < 20) headings.push(clean(frame.heading.text).slice(0, 500));
        if (frame.link && links.length < 20)
          links.push({ url: frame.link.url, text: clean(frame.link.text).slice(0, 300) });
        if (blocks.has(frame.name)) add('\n');
      },
    },
    { decodeEntities: true },
  );
  parser.end(html);
  const allText = clean(text.join(''));
  const mainText = clean(main.join(''));
  const articleText = clean(article.join(''));
  const content =
    mode === 'main'
      ? mainText
      : mode === 'article'
        ? articleText
        : mode === 'body'
          ? allText
          : articleText || mainText || allText;
  if (!content)
    throw new Error('No readable website text found. Use a public server-rendered HTML page or plain text.');
  return {
    url,
    title: clean(title).slice(0, 300),
    text: content.slice(0, maxChars),
    headings,
    links,
    truncated: content.length > maxChars,
    characters: content.length,
    fetchedAt: new Date().toISOString(),
  };
}
export async function fetchStudioWebsite(rawUrl: string, mode: string, maxChars: number) {
  if (
    !['auto', 'main', 'article', 'body'].includes(mode) ||
    !Number.isInteger(maxChars) ||
    maxChars < 500 ||
    maxChars > 24000
  )
    throw new Error('Choose a website region and text limit of 500–24000 characters.');
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
    throw new Error('Website URLs require HTTPS without embedded credentials, on port 443.');
  try {
    return await withSafeFetch(
      url.href,
      {
        method: 'GET',
        headers: { Accept: 'text/html, text/plain', 'User-Agent': 'Waply-Studio/1.0' },
        signal: AbortSignal.timeout(10000),
      },
      async response => {
        if (!response.ok) throw new Error(`Website returned HTTP ${response.status}`);
        const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!['text/html', 'application/xhtml+xml', 'text/plain'].includes(type))
          throw new Error('Website step supports HTML or plain text only.');
        const source = await readStudioResponse(response);
        if (type === 'text/plain') {
          const text = clean(source);
          if (!text) throw new Error('Website returned empty text.');
          return {
            url: url.href,
            title: '',
            text: text.slice(0, maxChars),
            headings: [],
            links: [],
            truncated: text.length > maxChars,
            characters: text.length,
            fetchedAt: new Date().toISOString(),
          };
        }
        return extractStudioHtml(source, url.href, mode, maxChars);
      },
    );
  } catch (error) {
    throw new Error(redactSsrfError(error), { cause: error });
  }
}
