import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { PrismaClient } from "@prisma/client";

/* ----------------------------- */
/* File Logger (for ngrok/deployed) */
/* ----------------------------- */

const LOG_FILE = path.join(process.cwd(), "server.log");

function log(...args: unknown[]) {
  const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(...args);
}

function logError(...args: unknown[]) {
  const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  const line = `[${new Date().toISOString()}] [ERROR] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.error(...args);
}

const app = express();
const PORT = process.env.PORT || 3000;

/* ----------------------------- */
/* Middleware */
/* ----------------------------- */

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Debug logger
app.use((req, _res, next) => {
  log(`${req.method} ${req.url}`);
  next();
});

/* ----------------------------- */
/* Database */
/* ----------------------------- */

const prisma = new PrismaClient();

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
  log("BODY:", req.body);

  const { name, supabaseUrl, userId } = req.body;

  if (!supabaseUrl || typeof supabaseUrl !== "string") {
    return res.status(400).json({
      error:
        "Missing supabaseUrl. Make sure Content-Type: application/json is set.",
    });
  }

  if (!supabaseUrl.includes("supabase.co")) {
    return res
      .status(400)
      .json({ error: "Invalid Supabase project URL." });
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
    proxyBase: `http://localhost:${PORT}/p/${slug}`,
  });
});

/* ----------------------------- */
/* Main Proxy Route */
/* ----------------------------- */

app.all("/p/:slug/*path", async (req: Request, res: Response) => {
  try {
    const slug = Array.isArray(req.params.slug)
      ? req.params.slug[0]
      : (req.params.slug ?? "");
    const path = Array.isArray(req.params.path)
      ? req.params.path.join("/")
      : (req.params.path ?? "");

    const project = await prisma.app.findUnique({
      where: { slug },
    });

    if (!project) {
      return res.status(404).json({ error: "Invalid slug" });
    }

    // Allow only specific Supabase paths
    const allowedPrefixes = ["rest/v1", "auth/v1", "storage/v1"];

    if (!allowedPrefixes.some((prefix) => path.startsWith(prefix))) {
      return res.status(403).json({ error: "Route not allowed" });
    }

    const queryString = req.url.includes("?")
      ? "?" + req.url.split("?")[1]
      : "";

    const targetURL = `${project.supabaseUrl}/${path}${queryString}`;

    log("Forwarding to:", targetURL);

    // Clone headers safely
    const headers: Record<string, string> = {};

    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") {
        headers[key] = value;
      }
    }

    // Remove unsafe headers
    delete headers.host;
    delete headers["x-forwarded-for"];
    delete headers["cf-connecting-ip"];
    delete headers["x-real-ip"];

    const response = await fetch(targetURL, {
      method: req.method,
      headers,
      body:
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : JSON.stringify(req.body),
    });

    const buffer = await response.arrayBuffer();

    res.status(response.status);

    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    res.send(Buffer.from(buffer));
  } catch (error) {
    logError("Proxy error:", error);
    res.status(500).json({ error: "Proxy failed" });
  }
});

/* ----------------------------- */
/* Start Server */
/* ----------------------------- */

app.listen(PORT, () => {
  log(`Server running on http://localhost:${PORT}`);
});