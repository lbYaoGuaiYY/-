;(function defineProviderAdapters(scope) {
  const providers = {
    chatgpt: {
      id: "chatgpt",
      label: "ChatGPT",
      hosts: ["chatgpt.com", "chat.openai.com"],
      newChatUrl: "https://chatgpt.com/",
      composerSelectors: [
        "#prompt-textarea",
        '[contenteditable="true"][data-lexical-editor="true"]',
        'textarea[placeholder*="Message"]',
        'textarea[placeholder*="消息"]',
      ],
      sendSelectors: [
        'button[data-testid="send-button"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="发送"]',
      ],
    },
    gemini: {
      id: "gemini",
      label: "Gemini",
      hosts: ["gemini.google.com"],
      newChatUrl: "https://gemini.google.com/app",
      composerSelectors: [
        '.ql-editor[contenteditable="true"]',
        '[contenteditable="true"][role="textbox"]',
        'textarea[aria-label*="prompt" i]',
      ],
      sendSelectors: [
        'button[aria-label*="Send message" i]',
        'button[aria-label*="发送消息"]',
        'button[aria-label*="发送"]',
        "button.send-button",
      ],
    },
  }

  function providerForUrl(value) {
    let host = ""
    try {
      host = new URL(value).hostname.replace(/^www\./, "")
    } catch {
      return null
    }
    return Object.values(providers).find((provider) => provider.hosts.includes(host)) ?? null
  }

  function firstMatching(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector)
      if (element) return element
    }
    return null
  }

  async function waitForElement(selectors, { timeout = 30_000, interval = 200 } = {}) {
    const deadline = Date.now() + timeout
    while (Date.now() <= deadline) {
      const element = firstMatching(selectors)
      if (element) return element
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
    throw new Error("生成页面结构已变化，没有找到输入框")
  }

  function setComposerText(composer, value) {
    composer.focus()
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const prototype =
        composer instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
      if (setter) setter.call(composer, value)
      else composer.value = value
    } else {
      composer.textContent = value
    }
    composer.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        data: value,
        inputType: "insertText",
      }),
    )
    composer.dispatchEvent(new Event("change", { bubbles: true }))
  }

  async function submitPrompt(provider, prompt) {
    if (!provider) throw new Error("当前站点不支持全自动生成")
    const composer = await waitForElement(provider.composerSelectors)
    setComposerText(composer, prompt)
    const send = await waitForElement(provider.sendSelectors)
    const deadline = Date.now() + 10_000
    while (send.disabled && Date.now() <= deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (send.disabled) throw new Error("生成页面暂时不允许发送提示词")
    send.click()
  }

  function buildItemPrompt(prompt, ordinal, total) {
    return `${String(prompt).trim()}\n\n请只生成 1 张高清、主体完整的图片。这是第 ${ordinal} / ${total} 张，请与前面结果保持同一主题但具有明显变化。不要解释，直接生成图片。`
  }

  scope.QingsheProviderAdapters = {
    buildItemPrompt,
    providerForUrl,
    providers,
    submitPrompt,
    waitForElement,
  }
})(globalThis)
