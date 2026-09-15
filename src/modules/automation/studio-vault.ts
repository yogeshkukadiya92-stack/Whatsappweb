import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function vaultKey(): Buffer {
  const value = process.env.STUDIO_VAULT_KEY || '';
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('Studio vault requires a base64 32-byte key.');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('Studio vault key is invalid.');
  return key;
}
export function studioVaultReady(): boolean {
  try {
    vaultKey();
    return true;
  } catch {
    return false;
  }
}
export function sealStudioSecret(secret: string, scope: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', vaultKey(), iv);
  cipher.setAAD(Buffer.from(scope));
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}
export function openStudioSecret(value: string, scope: string): string {
  try {
    const [version, iv, tag, data, extra] = value.split('.');
    if (version !== 'v1' || extra !== undefined) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', vaultKey(), Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(scope));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Studio credential cannot be decrypted. Ask an administrator to reconnect.');
  }
}
