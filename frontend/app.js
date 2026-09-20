const API_URL = "/chat";
const STORAGE_KEY = "resume-ai-chats-v1";

const state = { chats: [], activeId: null, sending: false };

const $ = (id) => document.getElementById(id);

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function activeChat() {
  return state.chats.find((c) => c.id === state.activeId) || null;
}

/* ---------- storage ---------- */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.chats = parsed.chats || [];
    state.activeId = parsed.activeId || null;
  } catch (e) { console.warn("load failed", e); }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ chats: state.chats, activeId: state.activeId })
  );
}

/* ---------- markdown ---------- */
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderMarkdown(text) {
  if (window.marked) {
    try {
      const fn = window.marked.parse || window.marked;
      if (typeof fn === "function") return fn(text);
    } catch (_) { /* fall through */ }
  }
  return escapeHtml(text).replace(/\n/g, "<br>");
}

/* ---------- rendering ---------- */
function renderChatList() {
  const list = $("chatList");
  list.innerHTML = "";
  state.chats
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .forEach((chat) => {
      const el = document.createElement("div");
      el.className = "chat-item" + (chat.id === state.activeId ? " active" : "");
      el.innerHTML = `<span class="title"></span><button class="del" title="Delete">×</button>`;
      el.querySelector(".title").textContent = chat.title || "New chat";
      el.addEventListener("click", (e) => {
        if (e.target.classList.contains("del")) return;
        selectChat(chat.id);
      });
      el.querySelector(".del").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteChat(chat.id);
      });
      list.appendChild(el);
    });
}

function buildWelcome() {
  const wrap = document.createElement("div");
  wrap.className = "welcome";
wrap.innerHTML =
    '<h1>Hi, I\'m Sanjeet 👋</h1>' +
    '<p>Ask me anything about my experience, skills, or projects — I\'ll answer from my resume.</p>' +
    '<div class="suggestions"></div>';
  const prompts = [
    "What are your top skills?",
    "Summarize your work experience.",
    "What projects have you built?",
    "How many years of experience do you have?",
  ];
  const box = wrap.querySelector(".suggestions");
  prompts.forEach((p) => {
    const b = document.createElement("button");
    b.className = "suggestion";
    b.textContent = p;
    b.addEventListener("click", () => sendMessage(p));
    box.appendChild(b);
  });
  return wrap;
}

function buildMessageEl(m) {
  const el = document.createElement("div");
  el.className = "msg " + m.role;
  if (m.role === "user") {
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = m.content;
    el.appendChild(bubble);
  } else {
    const content = document.createElement("div");
    content.className = "content";
    content.innerHTML = renderMarkdown(m.content);
    el.appendChild(content);
  }
  return el;
}

function renderMessages() {
  const container = $("messagesInner");
  const chat = activeChat();
  container.innerHTML = "";
  $("topbarTitle").textContent = chat?.title || "New chat";

  if (!chat || chat.messages.length === 0) {
    container.appendChild(buildWelcome());
    return;
  }
  chat.messages.forEach((m) => container.appendChild(buildMessageEl(m)));
  scrollToBottom();
}

function appendTyping(isFirstMessage) {
  const el = document.createElement("div");
  el.className = "msg assistant";
  el.id = "typingIndicator";
  const label = isFirstMessage
    ? '<span class="typing-label">Waking up the server, this may take 60s…</span> '
    : '';
  el.innerHTML =
    '<div class="content">' +
    label +
    '<span class="dots"><span></span><span></span><span></span></span>' +
    '</div>';
  $("messagesInner").appendChild(el);
  scrollToBottom();
}

function removeTyping() {
  const el = $("typingIndicator");
  if (el) el.remove();
}

function scrollToBottom() {
  const box = $("messages");
  box.scrollTop = box.scrollHeight;
}

/* ---------- actions ---------- */
function newChat() {
  const chat = { id: uid(), title: "New chat", messages: [], createdAt: Date.now() };
  state.chats.push(chat);
  state.activeId = chat.id;
  saveState();
  renderChatList();
  renderMessages();
  $("input").focus();
  if (window.innerWidth <= 720) $("sidebar").classList.add("collapsed");
}

function selectChat(id) {
  state.activeId = id;
  saveState();
  renderChatList();
  renderMessages();
  if (window.innerWidth <= 720) $("sidebar").classList.add("collapsed");
}

function deleteChat(id) {
  state.chats = state.chats.filter((c) => c.id !== id);
  if (state.activeId === id) state.activeId = state.chats[0]?.id || null;
  if (state.chats.length === 0) {
    state.chats = [];
    state.activeId = null;
    saveState();
    newChat();
    return;
  }
  saveState();
  renderChatList();
  renderMessages();
}

async function sendMessage(text) {
  if (state.sending) return;
  text = (text ?? $("input").value).trim();
  if (!text) return;

  let chat = activeChat();
  if (!chat) { newChat(); chat = activeChat(); }

  chat.messages.push({ role: "user", content: text });
  if (chat.title === "New chat") {
    chat.title = text.length > 40 ? text.slice(0, 40) + "…" : text;
  }

  $("input").value = "";
  autoResize();
  state.sending = true;
  $("sendBtn").disabled = true;

  saveState();
  renderChatList();
  renderMessages();

  // Create the assistant bubble immediately — empty for now
  const container = $("messagesInner");
  const assistantEl = document.createElement("div");
  assistantEl.className = "msg assistant";
  const contentEl = document.createElement("div");
  contentEl.className = "content";
  contentEl.innerHTML = '<span class="status-line">Waking up the server…</span>';
  assistantEl.appendChild(contentEl);
  container.appendChild(assistantEl);
  scrollToBottom();

  // Cycle through status messages during the wait
  const statusMessages = [
    "Waking up the server…",
    "Reading your resume…",
    "Analyzing the question…",
    "Formulating an answer…",
  ];
  let statusIdx = 0;
  const statusTimer = setInterval(() => {
    if (contentEl.querySelector(".status-line")) {
      statusIdx = Math.min(statusIdx + 1, statusMessages.length - 1);
      contentEl.querySelector(".status-line").textContent = statusMessages[statusIdx];
    }
  }, 4000);

  let answer = "";

  try {
    const res = await fetch("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: text }),
    });
    if (!res.ok) throw new Error("Server error " + res.status);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let firstChunk = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (firstChunk) {
        clearInterval(statusTimer);
        contentEl.innerHTML = "";
        firstChunk = false;
      }
      answer += decoder.decode(value, { stream: true });
      contentEl.innerHTML = renderMarkdown(answer);
      scrollToBottom();
    }

    if (!answer) answer = "(no answer)";
    chat.messages.push({ role: "assistant", content: answer });

  } catch (err) {
    clearInterval(statusTimer);
    answer = "**Error:** " + err.message + ". Please try again.";
    contentEl.innerHTML = renderMarkdown(answer);
    chat.messages.push({ role: "assistant", content: answer });
  } finally {
    clearInterval(statusTimer);
    state.sending = false;
    $("sendBtn").disabled = false;
    saveState();
    renderChatList();
  }
}

/* ---------- input ---------- */
function autoResize() {
  const ta = $("input");
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
}

/* ---------- init ---------- */
function init() {
  loadState();

  if (state.chats.length === 0) {
    newChat();
  } else {
    if (!activeChat()) state.activeId = state.chats[0].id;
    renderChatList();
    renderMessages();
  }

  if (window.innerWidth <= 720) $("sidebar").classList.add("collapsed");

  $("newChatBtn").addEventListener("click", newChat);
  $("menuBtn").addEventListener("click", () =>
    $("sidebar").classList.toggle("collapsed")
  );

  $("composerForm").addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage();
  });

  const ta = $("input");
  ta.addEventListener("input", autoResize);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  ta.focus();
}

document.addEventListener("DOMContentLoaded", init);