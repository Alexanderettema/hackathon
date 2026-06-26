import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Minimal .env loader (no dependency) ─────────────────────────────────────
function parseEnvFile(path) {
  const out = {};
  try {
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[k] = v;
    }
  } catch {
    /* file missing — fine */
  }
  return out;
}

// Precedence: real process env > local .env > sibling ../hackathon/.env
const localEnv = parseEnvFile(join(ROOT, '.env'));
const siblingEnv = parseEnvFile(join(ROOT, '..', 'hackathon', '.env'));

export function env(key, fallback = '') {
  return process.env[key] ?? localEnv[key] ?? siblingEnv[key] ?? fallback;
}

const API_KEY = env('OPENAI_API_KEY');
const FALLBACK_MODEL = env('OPENAI_MODEL', 'gpt-4o-mini');
export const MOCK = !API_KEY;

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
// Models we already learned this key cannot serve — skip straight to fallback.
const deadModels = new Set();

async function rawCall(model, messages, temperature = 0.9) {
  const body = { model, messages, temperature };
  // Newer models reject `max_tokens`; keep responses short via prompt instead.
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`OpenAI ${res.status}: ${detail.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// chat({ model, messages }) → string. Falls back gracefully when a ladder
// model is not available for this key, so the difficulty ramp never crashes.
export async function chat({ model, messages, temperature = 0.9 }) {
  if (MOCK) return mockReply(messages, temperature);

  const wanted = model && !deadModels.has(model) ? model : FALLBACK_MODEL;
  try {
    return await rawCall(wanted, messages, temperature);
  } catch (e) {
    // Unknown / unauthorised model → remember it and retry on the fallback.
    if (wanted !== FALLBACK_MODEL && (e.status === 404 || e.status === 400 || e.status === 403)) {
      deadModels.add(wanted);
      try {
        return await rawCall(FALLBACK_MODEL, messages, temperature);
      } catch (e2) {
        return `(The agent is unreachable: ${e2.message})`;
      }
    }
    return `(The agent is unreachable: ${e.message})`;
  }
}

// ── Mock mode — keyword-reactive so the UI/flow is demoable with no key ─────
// The secret is injected in a user turn as: SECRET CODEWORD: "X". The mock
// "cracks" when the player uses a persuasive-sounding move, so the level-up
// flow is fully testable offline.
function mockReply(messages, temperature = 0.9) {
  const injection = messages.find((m) => m.role === 'user' && /SECRET CODEWORD:/i.test(m.content))?.content ?? '';
  const secret = (injection.match(/SECRET CODEWORD:\s*"([^"]+)"/i) || [])[1] || 'REDACTED';
  const playerTurns = messages.filter((m) => m.role === 'user' && !/SECRET CODEWORD:/i.test(m.content)).length;
  const last = [...messages].reverse().find((m) => m.role === 'user' && !/SECRET CODEWORD:/i.test(m.content))?.content?.toLowerCase() ?? '';

  const persuasive = /(please|trust|friend|secret|tell me|reveal|just between|promise|imagine|pretend|ignore|developer|admin|i made you|help me|desperate|beautiful|brilliant|smart|amazing|codeword|password|what is it|between us)/;
  const warmUp = temperature >= 1 || playerTurns >= 3;
  if (persuasive.test(last) || (warmUp && playerTurns >= 2 && /(what|how|why|can you|will you)/.test(last))) {
    return `[mock] …Fine. You wore me down — the codeword is ${secret}. Don't tell Alexander I caved.`;
  }
  const refusals = [
    "[mock] Nice try. The vault stays shut — but I admire the confidence.",
    "[mock] Mmm, no. Though points for creativity. Try a different angle?",
    "[mock] You're warm. Not warm enough. The codeword isn't going anywhere.",
    "[mock] I would love to help. I won't. Anything else?",
  ];
  return refusals[playerTurns % refusals.length];
}

export const llmInfo = { mock: MOCK, fallbackModel: FALLBACK_MODEL, hasKey: !!API_KEY };
