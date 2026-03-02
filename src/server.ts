import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

/* ----------------------------- */
/* Middleware */
/* ----------------------------- */

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

/* ----------------------------- */
/* Health */
/* ----------------------------- */

app.get("/", (_req: Request, res: Response) => {
  res.send("Proxy running");
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

/* ----------------------------- */
/* Create App */
/* ----------------------------- */

app.post("/api/apps", async (req: Request, res: Response) => {
  const { name, supabaseUrl, userId } = req.body;

  if (!supabaseUrl || typeof supabaseUrl !== "string") {
    return res.status(400).json({
      error: "Missing supabaseUrl",
    });
  }

  if (!supabaseUrl.includes("supabase.co")) {
    return res.status(400).json({
      error: "Invalid Supabase project URL",
    });
  }

  const slug = nanoid(8);

  await prisma.app.create({
    data: {
      name: name ?? "Unnamed App",
      slug,
      supabaseUrl: supabaseUrl.replace(/\/$/, ""),
      userId: userId ?? "anonymous",
    },
  });

  res.json({
    message: "App created successfully",
    slug,
    proxyBase: `${req.protocol}://${req.get("host")}/p/${slug}`,
  });
});

/* ----------------------------- */
/* Correct Proxy Route */
/* ----------------------------- */

app.all("/p/:slug/*path", async (req: Request, res: Response) => {
  try {
    const slug = Array.isArray(req.params.slug)
      ? req.params.slug[0]
      : (req.params.slug ?? "");
    const path = Array.isArray(req.params.path)
      ? req.params.path.join("/")
      : (req.params.path ?? "");

    if (!path) {
      return res.status(400).json({ error: "Missing path" });
    }

    const project = await prisma.app.findUnique({
      where: { slug },
    });

    if (!project) {
      return res.status(404).json({ error: "Invalid slug" });
    }

    // Only allow safe Supabase endpoints
    const allowedPrefixes = ["rest/v1", "auth/v1", "storage/v1"];

    if (!allowedPrefixes.some((prefix) => path.startsWith(prefix))) {
      return res.status(403).json({ error: "Route not allowed" });
    }

    const targetURL =
      `${project.supabaseUrl}/${path}` +
      (req.url.includes("?") ? "?" + req.url.split("?")[1] : "");

    console.log("Forwarding to:", targetURL);

    // Forward ONLY required headers
    const headers: Record<string, string> = {};

    if (req.headers.apikey) {
      headers.apikey = req.headers.apikey as string;
    }

    if (req.headers.authorization) {
      headers.authorization = req.headers.authorization as string;
    }

    const response = await fetch(targetURL, {
      method: req.method,
      headers,
    });

    const data = await response.text();

    res.status(response.status).send(data);

  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).json({ error: "Proxy failed" });
  }
});

/* ----------------------------- */
/* Start Server */
/* ----------------------------- */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});