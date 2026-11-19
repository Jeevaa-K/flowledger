const Groq = require('groq-sdk');
require('../config');

// ── Strips <think>...</think> reasoning tags from LLM responses ───────────────
function cleanLLMOutput(text) {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text;
  if (cleaned.includes('</think>')) {
    cleaned = cleaned.split('</think>').pop();
  } else if (cleaned.includes('<think>')) {
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
    cleaned = cleaned.replace(/<think>[\s\S]*$/gi, '');
  }
  return cleaned.trim();
}

// ── Groq ──────────────────────────────────────────────────────
let groq = null;
const apiKey = process.env.GROQ_API_KEY;
console.log(apiKey ? 'GROQ_API_KEY configured' : 'GROQ_API_KEY not set — AI features disabled');
if (apiKey) { groq = new Groq({ apiKey }); console.log('Groq AI enabled'); }

// Verified active chat models from GET https://api.groq.com/openai/v1/models:
// 1. qwen/qwen3.8-27b
// 2. openai/gpt-oss-120b
// 3. openai/gpt-oss-20b
const KNOWN_ACTIVE_MODELS = [
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b'
];

const PRIMARY_MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';

const GROQ_MODELS = Array.from(new Set([
  PRIMARY_MODEL,
  ...KNOWN_ACTIVE_MODELS
])).filter(Boolean);

// Validate configured model on startup asynchronously
if (groq && process.env.NODE_ENV !== 'test') {
  (async () => {
    try {
      const list = await groq.models.list();
      const activeIds = (list.data || []).filter(m => m.active !== false).map(m => m.id);
      if (!activeIds.includes(PRIMARY_MODEL)) {
        console.warn(`Warning: Configured GROQ_MODEL '${PRIMARY_MODEL}' is not in Groq's active models list (${activeIds.filter(id => !id.includes('whisper') && !id.includes('guard')).join(', ')}). Fallback models will be attempted.`);
      } else {
        console.log(`Groq model '${PRIMARY_MODEL}' validated and active`);
      }
    } catch (err) {
      // In offline/sandboxed environments, fallback to static check
      if (!KNOWN_ACTIVE_MODELS.includes(PRIMARY_MODEL)) {
        console.warn(`Warning: Configured GROQ_MODEL '${PRIMARY_MODEL}' is not in verified active models (${KNOWN_ACTIVE_MODELS.join(', ')}).`);
      }
    }
  })();
}

async function createGroqCompletion(params) {
  if (!groq) throw new Error('Groq AI is not configured');
  const preferredModel = params.model || PRIMARY_MODEL;
  const modelsToTry = preferredModel
    ? Array.from(new Set([preferredModel, ...GROQ_MODELS]))
    : GROQ_MODELS;

  let lastErr = null;
  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    try {
      if (i > 0) {
        console.warn(`Attempting fallback Groq model '${model}' (primary '${preferredModel}' failed: ${lastErr?.message || 'unavailable'})...`);
      }
      const completion = await groq.chat.completions.create({
        ...params,
        model
      });
      if (i > 0) {
        console.warn(`Warning: AI request completed using fallback model '${model}' instead of preferred model '${preferredModel}'`);
      }
      return completion;
    } catch (err) {
      lastErr = err;
      const isNotFound =
        err.status === 404 ||
        err.code === 'model_not_found' ||
        err.code === 'model_decommissioned' ||
        (err.message && (
          err.message.includes('does not exist') ||
          err.message.includes('not have access') ||
          err.message.includes('decommissioned') ||
          err.message.includes('no longer supported') ||
          err.message.includes('deprecated') ||
          err.message.includes('model_not_found')
        ));
      if (isNotFound) {
        console.warn(`Groq model '${model}' not available (${err.code || err.status}: ${err.message || ''}), attempting next fallback model...`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ── Langfuse ──────────────────────────────────────────────────
let langfuse = null;
if (
  process.env.LANGFUSE_PUBLIC_KEY &&
  process.env.LANGFUSE_PUBLIC_KEY.startsWith('pk-lf-') &&
  !process.env.LANGFUSE_PUBLIC_KEY.includes('your-') &&
  process.env.LANGFUSE_SECRET_KEY &&
  process.env.LANGFUSE_SECRET_KEY.startsWith('sk-lf-') &&
  !process.env.LANGFUSE_SECRET_KEY.includes('your-') &&
  process.env.NODE_ENV !== 'test'
) {
  const { Langfuse } = require('langfuse'); // loaded only when tracing is configured
  langfuse = new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com'
  });
  console.log('Langfuse tracing enabled');
}

module.exports = { groq, langfuse, GROQ_MODELS, createGroqCompletion, cleanLLMOutput };
