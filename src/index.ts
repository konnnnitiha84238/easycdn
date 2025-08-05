import express, { Request, Response } from "express";
import axios from "axios";
import morgan from "morgan";
import * as cheerio from "cheerio";

const ORIGIN = "https://gomuraw3.global.ssl.fastly.net";
const EQUIVALENT_HOSTS = [
  new URL(ORIGIN).host,
  "gomuraw.com"
];
const PORT = process.env.PORT || 3000;
const hopByHop = [
  "connection","keep-alive","proxy-authenticate","proxy-authorization",
  "te","trailer","transfer-encoding","upgrade"
];
const REWRITE_RULES: Record<string, string[]> = {
  a:      ["href"],
  link:   ["href"],
  script: ["src"],
  img:    ["src"],
};
const app = express();
app.use(morgan("dev"));
app.get('/:encoded(https%3A.*|http%3A.*)', async (req: Request, res: Response) => {
  const target = decodeURIComponent(req.params.encoded);
  try {
    const upstream = await axios.get(target, {
      responseType: "stream",
      timeout: 10000,
      validateStatus: () => true
    });
    Object.entries(upstream.headers).forEach(([k, v]) => {
      if (!hopByHop.includes(k.toLowerCase()) && typeof v === "string") {
        res.setHeader(k, v);
      }
    });
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(upstream.status);
    (upstream.data as NodeJS.ReadableStream).pipe(res);
  } catch (err: any) {
    console.error(`Error fetching external ${target}:`, err.message);
    res.status(502).send("External origin unreachable.");
  }
});
app.use("*", async (req: Request, res: Response) => {
  const path = req.originalUrl;
  const url = ORIGIN + path;

  try {
    const upstream = await axios.get(url, {
      responseType: "stream",
      headers: {
        ...req.headers,
        host: new URL(ORIGIN).host
      },
      timeout: 10000,
      validateStatus: () => true
    });

    if (upstream.status < 200 || upstream.status >= 300) {
      res.status(upstream.status).send(`Upstream status ${upstream.status}`);
      return;
    }

    const contentType = upstream.headers["content-type"] || "";

    if (contentType.includes("text/html")) {
      const chunks: Buffer[] = [];
      for await (const chunk of upstream.data) {
        chunks.push(Buffer.from(chunk));
      }
      const html = Buffer.concat(chunks).toString("utf8");
      const $ = cheerio.load(html);
$("link, script, img, a").each((_, el) => {
  const $el = $(el);
  const tag = el.tagName.toLowerCase();
  for (const attr of REWRITE_RULES[tag] || []) {
    const v = $el.attr(attr);
    if (!v) continue;

    let newUrl: string | null = null;
    if (/^https?:\/\//i.test(v)) {
      newUrl = `/${encodeURIComponent(v)}`;
    }
    else if (v.startsWith("/")) {
      newUrl = v;
    }
    if (newUrl) {
      $el.attr(attr, newUrl);
    }
  }
});


      Object.entries(upstream.headers).forEach(([k, v]) => {
        if (!hopByHop.includes(k.toLowerCase()) && typeof v === "string") {
          res.setHeader(k, v);
        }
      });
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.status(upstream.status).send($.html());
      return;
    }

    Object.entries(upstream.headers).forEach(([k, v]) => {
      if (!hopByHop.includes(k.toLowerCase()) && typeof v === "string") {
        res.setHeader(k, v);
      }
    });
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(upstream.status);
    (upstream.data as NodeJS.ReadableStream).pipe(res);

  } catch (err: any) {
    console.error(`Error fetching ${url}:`, err.message);
    res.status(502).send("Origin unreachable.");
  }
});

app.listen(PORT, () => {
  console.log(`Proxy listening on http://localhost:${PORT}`);
});
