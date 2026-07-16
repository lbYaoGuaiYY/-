export const SITE_ADAPTERS = [
  { id: "chatgpt", label: "ChatGPT", hosts: ["chatgpt.com", "chat.openai.com"] },
  { id: "gemini", label: "Gemini", hosts: ["gemini.google.com"] },
  { id: "aistudio", label: "AI Studio", hosts: ["aistudio.google.com"] },
  { id: "claude", label: "Claude", hosts: ["claude.ai"] },
  { id: "copilot", label: "Copilot", hosts: ["copilot.microsoft.com"] },
]

export function siteForHost(value) {
  const host = value.replace(/^www\./, "")
  return (
    SITE_ADAPTERS.find((adapter) => adapter.hosts.includes(host)) ?? {
      id: "generic",
      label: "当前网页",
      hosts: [host],
    }
  )
}
