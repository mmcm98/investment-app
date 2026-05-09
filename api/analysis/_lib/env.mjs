/**
 * Server-only secrets (never VITE_* in bundled client). Vercel: set plain env vars.
 */
export function readAnalysisEnv(globalEnv) {
  const e = /** @type {Record<string,string|undefined>} */ (globalEnv ?? process.env ?? {})

  return {
    supabaseUrl:
      `${e.SUPABASE_URL ?? ''}`.trim() ||
      `${e.VITE_SUPABASE_URL ?? ''}`.trim(),
    supabaseAnonKey:
      `${e.SUPABASE_ANON_KEY ?? ''}`.trim() ||
      `${e.VITE_SUPABASE_ANON_KEY ?? ''}`.trim(),
    anthropicApiKey:
      `${e.ANTHROPIC_API_KEY ?? ''}`.trim() || `${e.ANTHROPIC_API_SECRET ?? ''}`.trim(),
    geminiApiKey:
      `${e.GEMINI_API_KEY ?? ''}`.trim() ||
      `${e.GOOGLE_GEMINI_API_KEY ?? ''}`.trim() ||
      `${e.VITE_GEMINI_API_KEY ?? ''}`.trim(),
    fmpApiKey:
      `${e.FMP_API_KEY ?? ''}`.trim() ||
      `${e.VITE_FMP_API_KEY ?? ''}`.trim() ||
      `${e.VITE_FMP ?? ''}`.trim(),
    claudeModel:
      `${e.CLAUDE_ANALYSIS_MODEL ?? ''}`.trim() || `${e.VITE_ANTHROPIC_ANALYSIS_MODEL ?? ''}`.trim() || `claude-opus-4-20250514`,
    briefingClaudeModel:
      `${e.CLAUDE_BRIEFING_MODEL ?? ''}`.trim() ||
      `${e.CLAUDE_ANALYSIS_MODEL ?? ''}`.trim() ||
      `${e.VITE_ANTHROPIC_ANALYSIS_MODEL ?? ''}`.trim() ||
      `claude-opus-4-20250514`,
    geminiModel: `${e.GEMINI_RESEARCH_MODEL ?? ''}`.trim() || `gemini-1.5-pro`,
    geminiFlashModel: `${e.GEMINI_FLASH_MODEL ?? ''}`.trim() || `gemini-2.0-flash`,
  }
}
