import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import { prisma } from "./lib/prisma.js";
import authRoutes from "./routes/auth.js";
import { requireAuth, type AuthenticatedRequest } from "./middleware/auth.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);

app.get("/", (_req: Request, res: Response) => {
  res.send("Proxy running");
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.get("/api/apps", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const apps = await prisma.app.findMany({
    where: { userId: req.userId! },
    orderBy: { id: "desc" },
    select: { id: true, slug: true, supabaseUrl: true, name: true },
  });
  res.json(apps);
});

app.post("/api/apps", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { name, supabaseUrl, slug: requestedSlug } = req.body;

  if (!supabaseUrl || typeof supabaseUrl !== "string") {
    return res.status(400).json({ error: "Missing supabaseUrl" });
  }

  if (!supabaseUrl.includes("supabase.co")) {
    return res.status(400).json({ error: "Invalid Supabase project URL" });
  }

  const count = await prisma.app.count({ where: { userId: req.userId! } });
  if (count >= 2) {
    return res.status(400).json({
      error: "You can create a maximum of 2 proxies. Delete one to create a new one.",
    });
  }

  const slug =
    typeof requestedSlug === "string" && /^[a-z0-9-]+$/.test(requestedSlug)
      ? requestedSlug
      : nanoid(8);

  try {
    await prisma.app.create({
      data: {
        name: name ?? "Unnamed App",
        slug,
        supabaseUrl: supabaseUrl.replace(/\/$/, ""),
        userId: req.userId!,
      },
    });
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === "P2002") {
      return res.status(400).json({ error: `Slug "${slug}" is already taken` });
    }
    return res.status(500).json({ error: "Failed to create app. Please try again." });
  }

  res.json({
    message: "App created successfully",
    slug,
    proxyBase: `${req.protocol}://${req.get("host")}/${slug}`,
  });
});

app.delete("/api/apps/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const id = typeof req.params.id === "string" ? req.params.id : req.params.id?.[0];
  if (!id) return res.status(400).json({ error: "Missing app id" });
  const existing = await prisma.app.findFirst({
    where: { id, userId: req.userId! },
  });
  if (!existing) {
    return res.status(404).json({ error: "App not found" });
  }
  await prisma.app.delete({ where: { id } });
  res.json({ success: true });
});

app.all("/:slug/*path", async (req: Request, res: Response) => {
  try {
    const slug = typeof req.params.slug === "string" ? req.params.slug : req.params.slug?.[0];
    const pathParam = req.params.path;
    const path = Array.isArray(pathParam) ? pathParam.join("/") : typeof pathParam === "string" ? pathParam : "";

    if (!path || !slug) {
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
        req.method === "GET" || req.method === "HEAD" ? undefined : (req as unknown as RequestInit["body"]),
      redirect: "follow",
    });

    res.status(response.status);

    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    if (response.body) {
      const { Readable } = await import("stream");
      Readable.fromWeb(response.body as import("stream/web").ReadableStream).pipe(res);
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