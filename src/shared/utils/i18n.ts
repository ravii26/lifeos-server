export const SUPPORTED_LANGUAGES = ["en", "hi", "gu", "es"] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

// Message catalog. Keyed by the English message, mapping to translations.
// Empty for now — translate() falls back to the original message, so this
// is fully wired and ready: add entries here as translations are needed.
//
// Example:
//   "Login successful": { hi: "लॉगिन सफल", gu: "લૉગિન સફળ", es: "Inicio de sesión exitoso" },
const messages: Record<string, Partial<Record<SupportedLanguage, string>>> = {}

export const translate = (message: string, lang: string): string => {
  const entry = messages[message]
  if (!entry) return message
  return entry[lang as SupportedLanguage] ?? message
}
