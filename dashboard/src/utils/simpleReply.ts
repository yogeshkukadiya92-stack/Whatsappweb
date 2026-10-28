import type { StudioDefinition } from '../services/api';

export function simpleReply(name: string, keywords: string, text: string) {
  const words = [
    ...new Set(
      keywords
        .split(',')
        .map(word => word.trim())
        .filter(Boolean),
    ),
  ];
  if (!name.trim() || !text.trim() || !words.length) throw new Error('Name, keywords and reply are required.');
  const definition: StudioDefinition = {
    audience: 'direct',
    cooldownSeconds: 60,
    keywords: words,
    steps: [{ id: crypto.randomUUID(), type: 'reply', label: 'WhatsApp reply', config: { text: text.trim() } }],
  };
  return { name: name.trim(), enabled: false, definition };
}
