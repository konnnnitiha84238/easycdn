import express, { Request, Response } from "express";
import axios from "axios";
import morgan from "morgan";
import cheerio from "cheerio";

const ORIGIN = "https://gomuraw3.global.ssl.fastly.net";  // ここだけ
const PORT = process.env.PORT || 3000;
const hopByHop = [
  "connection","keep-alive","proxy-authenticate","proxy-authorization",
  "te","trailer","transfer-encoding","upgrade"
];

const app = express();
app.use(morgan("dev"));

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

    // ステータスチェック
    if (upstream.status < 200 || upstream.status >= 300) {
      res.status(upstream.status).send(`Upstream status ${upstream.status}`);
      return;
    }

    const contentType = upstream.headers["content-type"] || "";

    // HTML の場合はバッファリングして書き換え
    if (contentType.includes("text/html")) {
      const chunks: Buffer[] = [];
      for await (const chunk of upstream.data) {
        chunks.push(Buffer.from(chunk));
      }
      const html = Buffer.concat(chunks).toString("utf8");
      const $ = cheerio.load(html);

      // href, src, content属性をプロキシパスに書き換え
      $("link, script, img, a, meta").each((_, el) => {
        const $el = $(el);
        ["href", "src", "content"].forEach(attr => {
          const v = $el.attr(attr);
          if (v && (v.startsWith("/") || v.startsWith("http"))) {
            // 絶対URLはエンコードして“/proxy/実URL”に、ルート相対はそのまま
            const newUrl = v.startsWith("http")
              ? `/proxy/${encodeURIComponent(v)}`
              : v;
            $el.attr(attr, newUrl);
          }
        });
      });

      // ヘッダー転送
      Object.entries(upstream.headers).forEach(([k, v]) => {
        if (!hopByHop.includes(k.toLowerCase()) && typeof v === "string") {
          res.setHeader(k, v);
        }
      });
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.status(upstream.status).send($.html());
      return;
    }

    // HTML以外はそのままストリームをパイプ
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
