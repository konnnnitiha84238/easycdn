import express, { Request, Response } from "express";
import axios from "axios";
import morgan from "morgan";
import * as cheerio from "cheerio";

const ORIGIN = "https://gomuraw3.global.ssl.fastly.net";
const PORT = process.env.PORT || 3000;
const hopByHop = [
  "connection","keep-alive","proxy-authenticate","proxy-authorization",
  "te","trailer","transfer-encoding","upgrade"
];

const app = express();
app.use(morgan("dev"));
app.get("/", async (req: Request, res: Response) => {
  const target = req.query.url;
  if (typeof target !== "string") {
    return res.status(400).send("Missing `url` query parameter");
  }

  let fetchUrl: string;
  try {
    fetchUrl = decodeURIComponent(target);
    const upstream = await axios.get(fetchUrl, {
      responseType: "stream",
      headers: { host: new URL(fetchUrl).host },
      timeout: 10000,
      validateStatus: () => true
    });
    if (upstream.status < 200 || upstream.status >= 300) {
      return res.status(upstream.status).send(`Upstream status ${upstream.status}`);
    }
    Object.entries(upstream.headers).forEach(([k, v]) => {
      if (!hopByHop.includes(k.toLowerCase()) && typeof v === "string") {
        res.setHeader(k, v);
      }
    })
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(upstream.status);
    (upstream.data as NodeJS.ReadableStream).pipe(res);

  } catch (err: any) {
    console.error(`Error proxying ${target}:`, err.message);
    res.status(502).send("Failed to fetch target URL");
  }
});
app.use("*", async (req: Request, res: Response) => {
  const origPath = req.originalUrl;
  let fetchUrl: string;
  if (origPath.startsWith("/proxy/")) {
    fetchUrl = decodeURIComponent(origPath.replace(/^\/proxy\//, ""));
  } else {
    fetchUrl = ORIGIN + origPath;
  }

  try {
    const upstream = await axios.get(fetchUrl, {
      responseType: "stream",
      headers: { ...req.headers, host: new URL(fetchUrl).host },
      timeout: 10000,
      validateStatus: () => true
    });

    if (upstream.status < 200 || upstream.status >= 300) {
      return res.status(upstream.status).send(`Upstream status ${upstream.status}`);
    }

    const contentType = upstream.headers["content-type"] || "";
    if (contentType.includes("text/html")) {
      const chunks: Buffer[] = [];
      for await (const chunk of upstream.data) {
        chunks.push(Buffer.from(chunk));
      }
      const html = Buffer.concat(chunks).toString("utf8");
      const $ = cheerio.load(html);
      $("link, script, img, a, meta").each((_, el) => {
        const $el = $(el);
        for (const attr of ["href", "src", "content"] as const) {
          const v = $el.attr(attr);
          if (v && (v.startsWith("/") || v.startsWith("http"))) {
            const newUrl = v.startsWith("http")
              ? `/proxy/${encodeURIComponent(v)}`
              : v;
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
      return res.status(upstream.status).send($.html());
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
    console.error(`Error fetching ${fetchUrl}:`, err.message);
    res.status(502).send("Origin unreachable.");
  }
});

app.listen(PORT, () => {
  console.log(`Proxy listening on http://localhost:${PORT}`);
});
