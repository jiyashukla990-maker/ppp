import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";

export type AuthPayload = { userId: string; email: string };

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload;
    return decoded;
  } catch {
    return null;
  }
}

/** Sync user from OAuth profile: create or update by email, return user + token */
router.post("/sync-user", async (req: Request, res: Response) => {
  const { email, name, image } = req.body as {
    email?: string;
    name?: string;
    image?: string;
  };

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Missing email" });
  }

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: name ?? null,
      image: image ?? null,
    },
    update: {
      name: name ?? undefined,
      image: image ?? undefined,
    },
  });

  const token = signToken({ userId: user.id, email: user.email });
  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
    },
    token,
  });
});

export default router;
