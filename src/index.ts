import express, { Request, Response } from "express";
import axios from "axios";
import morgan from "morgan";

const ORIGIN = "https://gomuraw3.global.ssl.fastly.net";
const PORT = process.env.PORT || 3000;

const app = express();
app.use(morgan("dev"));

app.use("*", async (req: Request, res: Response) => {
  const urlPath = req.originalUrl;
  const originUrl = ORIGIN + urlPath;

  try {
    const response = await axios.get(originUrl, {
      responseType: "arraybuffer",
      headers: {
        ...req.headers,
        host: "gomuraw3.global.ssl.fastly.net"
      },
      timeout: 10000,
      validateStatus: () => true
    });

    Object.entries(response.headers).forEach(([key, value]) => {
      if (typeof value === "string") {
        res.setHeader(key, value);
      }
    });
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(response.status).send(response.data);
  } catch (err) {
    res.status(502).send("Origin unreachable.");
  }
});

app.listen(PORT, () => {
  console.log(`CDN proxy server running at http://localhost:${PORT}`);
});
