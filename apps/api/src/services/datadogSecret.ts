import {z} from "zod";
import {decryptToken} from "./tokenEncryption.js";

/** Legacy settings remain readable. New secrets are never stored plaintext. */
export function readDatadogSecret(organization:{datadogWebhookSecret:string|null;encryptedDatadogWebhookSecret?:unknown}){
  if(!organization.encryptedDatadogWebhookSecret)return organization.datadogWebhookSecret;
  const encrypted=z.object({ciphertext:z.string(),iv:z.string(),authTag:z.string()}).parse(organization.encryptedDatadogWebhookSecret);
  // Corrupt ciphertext fails closed rather than falling back to an older secret.
  return decryptToken(encrypted);
}
