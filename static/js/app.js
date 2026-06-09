/* ═══════════════════════════════════════════════════════════════
   GeminiChat — Frontend Logic  v3
   Conversation history sidebar · Inline sources · Scrollable
   ═══════════════════════════════════════════════════════════════ */
"use strict";

// ── DOM refs ──────────────────────────────────────────────────────
const chatWindow    = document.getElementById("chat-window");
const messageInput  = document.getElementById("message-input");
const sendBtn       = document.getElementById("send-btn");
const convList      = document.getElementById("conv-list");
const convEmpty     = document.getElementById("conv-empty");
const newChatBtn    = document.getElementById("new-chat-btn");
const historyCount  = document.getElementById("history-count");
const charCount     = document.getElementById("char-count");
const searchTag     = document.getElementById("search-tag");
const apiTestBtn    = document.getElementById("api-test-btn");
const toastContainer= document.getElementById("toast-container");
const topbarTitle   = document.getElementById("topbar-title");
const hamburgerBtn  = document.getElementById("hamburger-btn");
const sidebar       = document.getElementById("sidebar");
const overlay       = document.getElementById("sidebar-overlay");
const emptyState    = document.getElementById("empty-state");

// Status dots
const geminiDot   = document.getElementById("gemini-dot");
const geminiLabel = document.getElementById("gemini-label");
const searchDot   = document.getElementById("search-dot");
const searchLabel = document.getElementById("search-label");

// ── Active conversation state ─────────────────────────────────────
let activeConvId = null;

// ── Real-time keyword detection ────────────────────────────────────
const REALTIME_KEYWORDS = [
  "current","latest","today","now","price","weather","forecast",
  "news","bitcoin","btc","eth","ethereum","usd","inr","mumbai",
  "delhi","stock","exchange rate","live","trending","breaking",
  "just","recently","right now","score","match","rate","market",
  "crypto","nifty","sensex","rupee","dollar","population",
];
function isRealTimeQuery(text) {
  const lower = text.toLowerCase();
  return REALTIME_KEYWORDS.some(kw => lower.includes(kw));
}

// ── Utilities ─────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])
  );
}

function showToast(message, type = "info", duration = 4000) {
  const icons = { success:"✓", error:"✕", info:"·" };
  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span>${icons[type]||"·"}</span><span>${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = "opacity .25s, transform .25s";
    toast.style.opacity = "0";
    toast.style.transform = "translateX(18px)";
    setTimeout(() => toast.remove(), 260);
  }, duration);
}

function scrollToBottom() {
  chatWindow.scrollTo({ top: chatWindow.scrollHeight, behavior: "smooth" });
}

function removeEmptyState() {
  if (emptyState && emptyState.parentNode) emptyState.remove();
}

// ── Textarea helpers ──────────────────────────────────────────────
function resizeTextarea() {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + "px";
}
function resetTextarea() {
  messageInput.value = "";
  messageInput.style.height = "52px";
  charCount.textContent = "";
  sendBtn.disabled = true;
  setSearchIndicator(false);
}
function setSearchIndicator(on) {
  searchTag?.classList.toggle("hidden", !on);
}

// ── Mobile sidebar ────────────────────────────────────────────────
function openSidebar() {
  sidebar?.classList.add("open");
  overlay?.classList.remove("hidden");
  hamburgerBtn?.setAttribute("aria-expanded", "true");
}
function closeSidebar() {
  sidebar?.classList.remove("open");
  overlay?.classList.add("hidden");
  hamburgerBtn?.setAttribute("aria-expanded", "false");
}
hamburgerBtn?.addEventListener("click", () => {
  sidebar?.classList.contains("open") ? closeSidebar() : openSidebar();
});
overlay?.addEventListener("click", closeSidebar);

// ════════════════════════════════════════════════════════════════════
// CONVERSATION LIST
// ════════════════════════════════════════════════════════════════════

function getDomain(url) {
  try { return new URL(url).hostname.replace("www.", ""); }
  catch { return ""; }
}

async function loadConversations() {
  try {
    const resp = await fetch("/api/conversations");
    const data = await resp.json();
    renderConvList(data.conversations || [], data.activeSid);
    activeConvId = data.activeSid;
  } catch {
    // silent fail
  }
}

function renderConvList(convs, activeSid) {
  if (!convList) return;

  // Filter out empty/untitled ones with 0 messages unless active
  const visible = convs.filter(c => c.messageCount > 0 || c.id === activeSid);

  if (visible.length === 0) {
    if (convEmpty) convEmpty.style.display = "";
    // Remove old items
    convList.querySelectorAll(".conv-item").forEach(el => el.remove());
    return;
  }
  if (convEmpty) convEmpty.style.display = "none";

  // Remove old items
  convList.querySelectorAll(".conv-item").forEach(el => el.remove());

  visible.forEach(conv => {
    const item = document.createElement("div");
    item.className = "conv-item" + (conv.id === activeSid ? " conv-item--active" : "");
    item.dataset.sid = conv.id;
    item.setAttribute("role", "listitem");

    item.innerHTML = `
      <button class="conv-item-btn" title="${escapeHtml(conv.title)}" aria-label="${escapeHtml(conv.title)}" aria-current="${conv.id === activeSid ? 'true' : 'false'}">
        <span class="conv-item-icon">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </span>
        <span class="conv-item-title">${escapeHtml(conv.title)}</span>
      </button>
      <button class="conv-delete-btn" title="Delete conversation" aria-label="Delete conversation">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    `;

    // Switch conversation on click
    item.querySelector(".conv-item-btn").addEventListener("click", () => {
      switchConversation(conv.id);
      closeSidebar();
    });

    // Delete conversation
    item.querySelector(".conv-delete-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${conv.title}"?`)) return;
      await deleteConversation(conv.id);
    });

    convList.appendChild(item);
  });
}

async function switchConversation(sid) {
  if (sid === activeConvId) return;
  try {
    const resp = await fetch("/api/conversations/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid }),
    });
    const data = await resp.json();
    if (!resp.ok) { showToast("Could not switch conversation", "error"); return; }

    activeConvId = sid;

    // Re-render chat window with this conversation's history
    renderChatHistory(data.history || [], data.title);

    // Update topbar title
    if (topbarTitle) topbarTitle.textContent = data.title || "GeminiChat";

    // Update count
    updateHistoryCount(data.history?.length || 0);

    // Refresh conv list to update active highlight
    await loadConversations();

    scrollToBottom();
  } catch {
    showToast("Network error", "error");
  }
}

async function deleteConversation(sid) {
  try {
    const resp = await fetch("/api/conversations/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid }),
    });
    const data = await resp.json();

    // If deleted conv was active, the server switched to another — reload page
    if (data.activeSid !== activeConvId) {
      window.location.reload();
    } else {
      await loadConversations();
    }
  } catch {
    showToast("Could not delete conversation", "error");
  }
}

function renderChatHistory(history, title) {
  // Clear window
  chatWindow.innerHTML = "";

  if (!history || history.length === 0) {
    // Show hero state
    const hero = document.createElement("div");
    hero.className = "hero-state";
    hero.id = "empty-state";
    hero.innerHTML = `
      <div class="hero-spike" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
          <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
          <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
          <line x1="19.07" y1="4.93" x2="16.24" y2="7.76"/><line x1="7.76" y1="16.24" x2="4.93" y2="19.07"/>
        </svg>
      </div>
      <h2 class="hero-headline">What can I help you with?</h2>
      <p class="hero-sub">Ask anything — I remember the full conversation and can search the web for live facts.</p>
    `;
    chatWindow.appendChild(hero);
    bindSuggestionCards();
  } else {
    history.forEach(item => appendMessage(item.role, item.content, false, []));
  }
}

// ════════════════════════════════════════════════════════════════════
// MESSAGE RENDERING
// ════════════════════════════════════════════════════════════════════

function appendMessage(role, text, isTyping = false, sources = []) {
  removeEmptyState();

  const article = document.createElement("article");
  article.className = `message message--${role}${isTyping ? " typing-indicator" : ""}`;
  article.setAttribute("role", "article");

  const aiSVG = `
    <div class="msg-avatar msg-avatar--ai" aria-hidden="true">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
        <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
        <line x1="19.07" y1="4.93" x2="16.24" y2="7.76"/><line x1="7.76" y1="16.24" x2="4.93" y2="19.07"/>
      </svg>
    </div>`;

  const userSVG = `
    <div class="msg-avatar msg-avatar--user" aria-hidden="true">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
      </svg>
    </div>`;

  // Build sources HTML (only for assistant messages)
  let sourcesHtml = "";
  if (role === "assistant" && sources && sources.length > 0) {
    const cards = sources.map(s => {
      const domain = getDomain(s.link);
      return `
        <a class="source-card" href="${escapeHtml(s.link)}" target="_blank" rel="noopener noreferrer">
          <span class="source-card-title">${escapeHtml(s.title)}</span>
          ${s.snippet ? `<span class="source-card-snippet">${escapeHtml(s.snippet.slice(0, 100))}</span>` : ""}
          ${domain ? `<span class="source-card-from">${escapeHtml(domain)}</span>` : ""}
        </a>`;
    }).join("");
    sourcesHtml = `
      <div class="msg-sources">
        <div class="msg-sources-label">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Live sources used
        </div>
        <div class="msg-sources-grid">${cards}</div>
      </div>`;
  }

  const bodyContent = isTyping
    ? `<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>`
    : escapeHtml(text);

  if (role === "assistant") {
    article.innerHTML = `
      ${aiSVG}
      <div class="msg-body">
        <p class="msg-author">Gemini</p>
        <div class="msg-text">${bodyContent}</div>
        ${sourcesHtml}
      </div>`;
  } else {
    article.innerHTML = `
      <div class="msg-body">
        <p class="msg-author">You</p>
        <div class="msg-text">${bodyContent}</div>
      </div>
      ${userSVG}`;
  }

  chatWindow.appendChild(article);
  scrollToBottom();
  return article;
}

function updateHistoryCount(count) {
  if (historyCount) historyCount.textContent = count;
}

// ════════════════════════════════════════════════════════════════════
// SEND MESSAGE
// ════════════════════════════════════════════════════════════════════

async function sendMessage() {
  const message = messageInput.value.trim();
  if (!message) return;

  appendMessage("user", message);
  resetTextarea();

  const typingBubble = appendMessage("assistant", "", true, []);
  sendBtn.disabled = true;
  sendBtn.classList.add("loading");

  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await resp.json();

    typingBubble.remove();
    sendBtn.classList.remove("loading");
    sendBtn.disabled = false;

    if (!resp.ok) {
      appendMessage("assistant", data.error || "Something went wrong.", false, []);
      showToast(
        resp.status === 429 ? "⏳ API quota — wait a moment" : (data.error || "Error"),
        "error",
        resp.status === 429 ? 6000 : 4000
      );
      return;
    }

    // Render reply with inline sources
    appendMessage("assistant", data.reply, false, data.searchResults || []);
    updateHistoryCount(data.historyLength || 0);

    // Update conversation title in sidebar
    if (data.convTitle && data.convTitle !== "New conversation") {
      if (topbarTitle) topbarTitle.textContent = data.convTitle;
      // Refresh conv list to show updated title + move to top
      await loadConversations();
    }

    if (data.searched) {
      const sources = (data.searchSources || []).join(", ") || "Web";
      showToast(`🔍 Live search · ${sources}`, "info", 3000);
    }

  } catch (err) {
    typingBubble.remove();
    sendBtn.classList.remove("loading");
    sendBtn.disabled = false;
    appendMessage("assistant", "⚠️ Network error. Check your connection.", false, []);
    showToast("Network error", "error");
  }
}

// ════════════════════════════════════════════════════════════════════
// API STATUS TEST
// ════════════════════════════════════════════════════════════════════

async function testApis() {
  if (apiTestBtn) { apiTestBtn.textContent = "Checking…"; apiTestBtn.disabled = true; }
  [geminiDot, searchDot].forEach(d => { if(d) d.className = "status-dot dot-loading"; });

  try {
    const resp = await fetch("/api/test");
    const data = await resp.json();

    // Gemini
    if (geminiDot) geminiDot.className = `status-dot ${data.gemini?.ok ? "dot-ok" : "dot-error"}`;
    if (geminiLabel) geminiLabel.textContent = data.gemini?.ok
      ? `Gemini 3.5 Flash`
      : `Gemini · Error`;

    // Search
    const s = data.search || {};
    const searchOk = s.ok || s.ddgs || s.googleapi || s.google_custom;
    if (searchDot) searchDot.className = `status-dot ${searchOk ? "dot-ok" : "dot-warn"}`;
    if (searchLabel) {
      const engines = [];
      if (s.ddgs)          engines.push("DuckDuckGo");
      if (s.googleapi)     engines.push("GoogleAPI");
      if (s.google_custom) engines.push("Custom");
      searchLabel.textContent = engines.length ? engines.join(", ") : "Search · Off";
    }

    if (data.gemini?.ok) {
      showToast("Gemini connected · Ready", "success", 2500);
    } else {
      showToast(`Gemini: ${data.gemini?.error || "Error"}`, "error", 5000);
    }
  } catch {
    showToast("Could not reach /api/test", "error");
    [geminiDot, searchDot].forEach(d => { if(d) d.className = "status-dot dot-error"; });
  } finally {
    if (apiTestBtn) { apiTestBtn.textContent = "Check status"; apiTestBtn.disabled = false; }
  }
}

// ════════════════════════════════════════════════════════════════════
// NEW CHAT
// ════════════════════════════════════════════════════════════════════

async function startNewChat() {
  try {
    const resp = await fetch("/api/conversations/new", { method: "POST" });
    const data = await resp.json();
    if (data.ok) {
      activeConvId = data.sid;
      renderChatHistory([], "New conversation");
      if (topbarTitle) topbarTitle.textContent = "GeminiChat";
      updateHistoryCount(0);
      await loadConversations();
      messageInput.focus();
      closeSidebar();
    }
  } catch {
    showToast("Could not start new chat", "error");
  }
}

newChatBtn?.addEventListener("click", startNewChat);

// ════════════════════════════════════════════════════════════════════
// SUGGESTION CARDS  (hero state)
// ════════════════════════════════════════════════════════════════════

function bindSuggestionCards() {
  document.querySelectorAll(".suggestion-card").forEach(card => {
    card.addEventListener("click", () => {
      messageInput.value = card.dataset.prompt || "";
      resizeTextarea();
      sendBtn.disabled = false;
      setSearchIndicator(isRealTimeQuery(messageInput.value));
      sendMessage();
    });
  });
}

// ════════════════════════════════════════════════════════════════════
// TEXTAREA EVENTS
// ════════════════════════════════════════════════════════════════════

messageInput?.addEventListener("input", () => {
  resizeTextarea();
  const trimmed = messageInput.value.trim();
  sendBtn.disabled = !trimmed;
  charCount.textContent = messageInput.value.length > 0 ? `${messageInput.value.length}` : "";
  setSearchIndicator(trimmed.length > 0 && isRealTimeQuery(messageInput.value));
});

messageInput?.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!messageInput.value.trim()) return;
    sendMessage();
  }
});

sendBtn?.addEventListener("click", sendMessage);
apiTestBtn?.addEventListener("click", testApis);

// Sidebar prompt items
document.querySelectorAll(".prompt-item").forEach(btn => {
  btn.addEventListener("click", () => {
    const text = btn.dataset.prompt;
    if (!text) return;
    messageInput.value = text;
    resizeTextarea();
    sendBtn.disabled = false;
    setSearchIndicator(isRealTimeQuery(text));
    messageInput.focus();
    sendMessage();
    closeSidebar();
  });
});

// ════════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════════

window.addEventListener("DOMContentLoaded", async () => {
  // Bind suggestion cards that exist in template (server-rendered)
  bindSuggestionCards();

  // Load conversation list
  await loadConversations();

  // Run API health check
  setTimeout(testApis, 800);

  // Fetch current history count
  try {
    const r = await fetch("/api/history");
    const d = await r.json();
    updateHistoryCount((d.history || []).length);
  } catch { /* silent */ }

  scrollToBottom();
  messageInput?.focus();
});
