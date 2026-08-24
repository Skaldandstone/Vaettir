import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.AUTH_JWT_SECRET;
const JWT_EXPIRY = "7d";

function getSecret(): string {
  if (!JWT_SECRET) {
    throw new Error("AUTH_JWT_SECRET is not set");
  }
  return JWT_SECRET;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface SessionTokenPayload {
  userId: string;
}

export function signSessionToken(payload: SessionTokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: JWT_EXPIRY });
}

export function verifySessionToken(token: string): SessionTokenPayload | null {
  try {
    return jwt.verify(token, getSecret()) as SessionTokenPayload;
  } catch {
    return null;
  }
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length).trim() || null;
}
