const Groq = require('groq-sdk');

// ── Groq ──────────────────────────────────────────────────────
let groq = null;
const apiKey = process.env.GROQ_API_KEY;
console.log(apiKey ? '🔑 GROQ_API_KEY configured' : '⚠️  GROQ_API_KEY not set — AI features disabled');
if (apiKey) { groq = new Groq({ apiKey }); console.log('✅ Groq AI enabled'); }

// Candidate Groq models to try in fallback sequence if a specific model returns 404
const GROQ_MODELS = [
  process.env.GROQ_MODEL,
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
  'llama-3.1-8b-instant',
  'llama3-70b-8192',
  'llama3-8b-8192',
  'mixtral-8x7b-32768'
].filter(Boolean);

async function createGroqCompletion(params) {
  if (!groq) throw new Error('Groq AI is not configured');
  const preferredModel = params.model;
  const modelsToTry = preferredModel
    ? Array.from(new Set([preferredModel, ...GROQ_MODELS]))
    : GROQ_MODELS;

  let lastErr = null;
  for (const model of modelsToTry) {
    try {
      const completion = await groq.chat.completions.create({
        ...params,
        model
      });
      return completion;
    } catch (err) {
      lastErr = err;
      const isNotFound = err.status === 404 ||
        err.code === 'model_not_found' ||
        (err.message && (err.message.includes('does not exist') || err.message.includes('not have access')));
      if (isNotFound) {
        console.warn(`⚠️ Groq model '${model}' not available (404), attempting next fallback model...`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ── Langfuse ──────────────────────────────────────────────────
let langfuse = null;
if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY && process.env.NODE_ENV !== 'test') {
  const { Langfuse } = require('langfuse'); // loaded only when tracing is configured
  langfuse = new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com'
  });
  console.log('✅ Langfuse tracing enabled');
}

module.exports = { groq, langfuse, GROQ_MODELS, createGroqCompletion };
