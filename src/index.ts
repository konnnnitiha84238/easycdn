import express, { Request, Response } from "express";
import { createProxyMiddleware, responseInterceptor } from "http-proxy-middleware";
import cheerio from "cheerio";
import path from "path";

const ORIGIN = "https://gomuraw3.global.ssl.fastly.net";
const PORT = process.env.PORT || 3000;

const app = express()
app.use((req: Request, res: Response, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  next();
});
app.use(
  "/public",
  express.static(path.join(__dirname, "public"), { maxAge: "1h" })
)
app.use(
  "*",

  createProxyMiddleware({
    target: ORIGIN,
    changeOrigin: true,
    selfHandleResponse: true,
    onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
      const contentType = proxyRes.headers["content-type"] || "";
      if (contentType.includes("text/html")) {
        const html = responseBuffer.toString("utf8");
        const $ = cheerio.load(html);

        $("[href], [src], meta[property]").each((_, el) => {
          const $el = $(el);
          const attrs = ["href", "src", "content"];
          attrs.forEach(attr => {
            let v = $el.attr(attr);
            if (!v) return;
            try {
              const parsed = new URL(v, ORIGIN);
              if (
                parsed.host.includes("gomuraw.com") ||
                parsed.host.includes("gomuraw3.global.ssl.fastly.net")
              ) {
                const newUrl = parsed.pathname + parsed.search;
                $el.attr(attr, newUrl);
              }
            } catch {}
          });
        });

        return $.html();
      }

      return responseBuffer;
    }),
    onError: (err, req, res) => {
      console.error("Proxy error:", err);
      res.status(502).send("Bad Gateway");
    },
  })
);

app.listen(PORT, () => console.log(`Proxy listening on http://localhost:${PORT}`));
