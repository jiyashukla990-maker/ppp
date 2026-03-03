import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get("/", (_req: Request, res: Response) => {
  res.send("Proxy running");
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.post("/api/apps", express.json(), async (req: Request, res: Response) => {
  const { name, supabaseUrl, userId } = req.body;

  if (!supabaseUrl || typeof supabaseUrl !== "string") {
    return res.status(400).json({ error: "Missing supabaseUrl" });
  }

  if (!supabaseUrl.includes("supabase.co")) {
    return res.status(400).json({ error: "Invalid Supabase project URL" });
  }

  const slug = nanoid(8);

  await prisma.app.create({
    data: {
      name: name ?? "Unnamed App",
      slug,
      supabaseUrl: supabaseUrl.replace(/\/$/, ""),
      userId: userId ?? null,
    },
  });

  res.json({
    message: "App created successfully",
    slug,
    proxyBase: `${req.protocol}://${req.get("host")}/${slug}`,
  });
});

app.all("/:slug/*", async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug;
    const path = req.params[0];

    if (!path) {
      return res.status(400).json({ error: "Missing path" });
    }

    const project = await prisma.app.findUnique({
      where: { slug },
    });

    if (!project) {
      return res.status(404).json({ error: "Invalid slug" });
    }

    const targetURL =
      `${project.supabaseUrl}/${path}` +
      (req.url.includes("?") ? `?${req.url.split("?")[1]}` : "");

    const headers = new Headers();

    for (const [key, value] of Object.entries(req.headers)) {
      if (
        value &&
        ![
          "host",
          "connection",
          "content-length",
          "x-forwarded-for",
          "x-real-ip",
          "cf-connecting-ip",
          "transfer-encoding",
        ].includes(key.toLowerCase())
      ) {
        headers.set(
          key,
          Array.isArray(value) ? value.join(",") : value
        );
      }
    }

    const response = await fetch(targetURL, {
      method: req.method,
      headers,
      body:
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : req,
      redirect: "follow",
    });

    res.status(response.status);

    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    if (response.body) {
      response.body.pipe(res);
    } else {
      res.end();
    }

  } catch (error) {
    res.status(500).json({ error: "Proxy failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});