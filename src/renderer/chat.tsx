import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageCircle, Minus, Send, Settings, Square, Trash2 } from "lucide-react";
import type { AppSnapshot, ChatMessage } from "../shared/contracts";
import "./ui.css";

function ChatApp(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.everby.getSnapshot().then(setSnapshot);
    const offSnapshot = window.everby.onSnapshot(setSnapshot);
    const offDelta = window.everby.onChatDelta((event) => {
      if (event.error) setError(event.error);
      setDraft((value) => value + event.delta);
      if (event.done) { setRequestId(null); setDraft(""); }
    });
    document.documentElement.dataset.appReady = "true";
    return () => { if (typeof offSnapshot === "function") offSnapshot(); if (typeof offDelta === "function") offDelta(); };
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [snapshot?.messages.length, draft]);

  async function send(): Promise<void> {
    if (!text.trim() || requestId) return;
    setError(""); setDraft(""); const content = text.trim(); setText("");
    try { setRequestId(await window.everby.sendMessage(content)); } catch (reason) { setError(reason instanceof Error ? reason.message : "发送失败"); }
  }

  const messages: ChatMessage[] = snapshot?.messages ?? [];
  return <main className="chat-shell">
    <header className="chat-titlebar">
      <div className="title-identity"><span className="presence-dot"/><strong>{snapshot?.persona.name ?? "Daily"}</strong><span>陪着你</span></div>
      <div className="title-actions">
        <button className="icon-button" title="设置" aria-label="打开设置" onClick={() => void window.everby.openManager()}><Settings size={17}/></button>
        <button className="icon-button" title="收起" aria-label="收起对话" onClick={() => window.close()}><Minus size={18}/></button>
      </div>
    </header>
    <section className="messages" aria-live="polite">
      {messages.length === 0 && <div className="chat-empty"><MessageCircle size={28}/><strong>现在想聊点什么？</strong><span>我会把重要的事留在本地记忆里。</span></div>}
      {messages.map((message) => <div className={`message ${message.role}`} key={message.id}>{message.content}</div>)}
      {draft && <div className="message assistant streaming">{draft}<span className="caret"/></div>}
      {error && <div className="inline-error" role="alert">{error}</div>}
      <div ref={endRef}/>
    </section>
    <footer className="composer">
      <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={`和${snapshot?.persona.name ?? "角色"}说点什么`} aria-label="消息" rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}/>
      <div className="composer-actions">
        <button className="icon-button" title="清空记录" aria-label="清空记录" onClick={() => void window.everby.clearMessages()}><Trash2 size={17}/></button>
        {requestId ? <button className="send-button stop" title="停止" aria-label="停止生成" onClick={() => void window.everby.stopMessage(requestId)}><Square size={15}/></button> : <button className="send-button" title="发送" aria-label="发送消息" disabled={!text.trim()} onClick={() => void send()}><Send size={17}/></button>}
      </div>
    </footer>
  </main>;
}

createRoot(document.getElementById("root")!).render(<ChatApp/>);
