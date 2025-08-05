import express, { Request, Response } from "express";
import axios from "axios";
import morgan from "morgan";
import * as cheerio from "cheerio";

const ORIGIN = "https://gomuraw3.global.ssl.fastly.net";
const PORT = process.env.PORT || 3000;
// hop-by-hop headers to remove
const HOP_BY_HOP = [
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade"
];

// Only rewrite these tags + attributes
const REWRITE_RULES: Record<string, string[]> = {
  a:      ["href"],
  link:   ["href"],
  script: ["src"],
  img:    ["src"]
};

const app = express();
app.use(morgan("dev"));

// Proxy absolute URLs: /{encodedUrl}
app.get('/:encoded(https%3A.*|http%3A.*)', async (req: Request, res: Response) => {
  const target = decodeURIComponent(req.params.encoded);
  try {
    const upstream = await axios.get(target, {
      responseType: "stream",
      timeout: 10000,
      validateStatus: () => true
    });
    // forward headers
    Object.entries(upstream.headers).forEach(([k, v]) => {
      if (!HOP_BY_HOP.includes(k.toLowerCase()) && typeof v === "string") {
        res.setHeader(k, v);
      }
    });
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(upstream.status);
    (upstream.data as NodeJS.ReadableStream).pipe(res);
  } catch (err: any) {
    console.error(`Error fetching external ${target}: ${err.message}`);
    res.status(502).send("External origin unreachable.");
  }
});

// Proxy everything else from ORIGIN
app.use('*', async (req: Request, res: Response) => {
  const url = ORIGIN + req.originalUrl;

  try {
    const upstream = await axios.get(url, {
      responseType: "stream",
      headers: { ...req.headers, host: new URL(ORIGIN).host },
      timeout: 10000,
      validateStatus: () => true
    });

    // If not HTML, stream binary
    const ct = upstream.headers["content-type"] || '';
    if (!ct.includes('text/html')) {
      Object.entries(upstream.headers).forEach(([k, v]) => {
        if (!HOP_BY_HOP.includes(k.toLowerCase()) && typeof v === 'string') {
          res.setHeader(k, v);
        }
      });
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(upstream.status);
      (upstream.data as NodeJS.ReadableStream).pipe(res);
      return;
    }

    // For HTML: buffer, rewrite, send
    const buffers: Buffer[] = [];
    for await (const chunk of upstream.data) buffers.push(Buffer.from(chunk));
    const html = Buffer.concat(buffers).toString('utf8');
    const $ = cheerio.load(html);

    // Apply whitelist-based URL rewriting
    Object.entries(REWRITE_RULES).forEach(([tag, attrs]) => {
      $(tag).each((_, el) => {
        const $el = $(el);
        attrs.forEach(attr => {
          const v = $el.attr(attr);
          if (!v) return;
          let newUrl: string | null = null;
          if (/^https?:\/\//i.test(v)) {
            newUrl = `/${encodeURIComponent(v)}`;
          } else if (v.startsWith('/')) {
            newUrl = v;
          }
          if (newUrl) $el.attr(attr, newUrl);
        });
      });
    });

    // Forward headers and send modified HTML
    Object.entries(upstream.headers).forEach(([k, v]) => {
      if (!HOP_BY_HOP.includes(k.toLowerCase()) && typeof v === 'string') {
        res.setHeader(k, v);
      }
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(upstream.status).send($.html());

  } catch (err: any) {
    console.error(`Error fetching ${url}: ${err.message}`);
    res.status(502).send('Origin unreachable.');
  }
});

app.listen(PORT, () => {
  console.log(`Proxy listening on http://localhost:${PORT}`);
});
