import crypto from "crypto";

const ALGO = "aes-256-gcm";
const KEY_HEX = process.env.CNIC_ENC_KEY || "";
const KEY = KEY_HEX ? Buffer.from(KEY_HEX, "hex") : null;

export function encryptPII(text: string) {
    if (!KEY) return undefined;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, KEY, iv);
    const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return iv.toString("hex") + ":" + tag.toString("hex") + ":" + encrypted.toString("hex");
}

export function decryptPII(token: string) {
    if (!KEY || !token) return undefined;
    const parts = token.split(":");
    if (parts.length !== 3) return undefined;
    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const encrypted = Buffer.from(parts[2], "hex");
    const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
}

export function maskCnic(raw: string) {
    if (!raw) return "";
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 13) {

        return `${digits.slice(0, 5)}-*******-${digits.slice(12)}`;
    }

    if (digits.length <= 5) return digits;
    return `${digits.slice(0, 3)}${"*".repeat(Math.max(0, digits.length - 5))}${digits.slice(-2)}`;
}
