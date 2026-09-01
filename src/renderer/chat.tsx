import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ImagePlus, MessageCircle, Minus, Send, Settings, Square, Trash2, X } from "lucide-react";
import type { AppSnapshot, ChatImageAttachment, ChatImageSource, ChatMessage } from "../shared/contracts";
import "./ui.css";

function ChatApp(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
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
    if ((!text.trim() && attachments.length === 0) || requestId) return;
    setError(""); setDraft(""); const content = text.trim(); setText("");
    try { setRequestId(await window.everby.sendMessage(content, attachments)); setAttachments([]); } catch (reason) { setText(content); setError(reason instanceof Error ? reason.message : "发送失败"); }
  }

  async function selectImages(): Promise<void> {
    if (requestId) return;
    try {
      const selected = await window.everby.selectChatImages();
      setAttachments((current) => [...current, ...selected].slice(0, 3));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "图片读取失败"); }
  }

  async function preparePastedImages(files: File[]): Promise<void> {
    const available = Math.max(0, 3 - attachments.length);
    if (!available) { setError("每次最多附加 3 张图片"); return; }
    const supported = files.filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type)).slice(0, available);
    if (!supported.length) return;
    try {
      const sources: ChatImageSource[] = await Promise.all(supported.map(async (file) => ({
        name: file.name || "clipboard-image.png", mimeType: file.type as ChatImageSource["mimeType"],
        dataUrl: await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }),
        size: file.size
      })));
      const prepared = await window.everby.prepareChatImages(sources);
      setAttachments((current) => [...current, ...prepared].slice(0, 3));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "粘贴图片失败"); }
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
      {messages.map((message) => <div className={`message ${message.role}`} key={message.id}>{message.attachments?.length > 0 && <div className="message-images">{message.attachments.map((image) => <img key={image.id} src={image.dataUrl} alt={image.name}/>)}</div>}<span>{message.content}</span></div>)}
      {draft && <div className="message assistant streaming">{draft}<span className="caret"/></div>}
      {error && <div className="inline-error" role="alert">{error}</div>}
      <div ref={endRef}/>
    </section>
    <footer className="composer">
      {attachments.length > 0 && <div className="attachment-strip" aria-label="待发送图片">{attachments.map((image) => <div key={image.id}><img src={image.dataUrl} alt={image.name}/><button type="button" title="移除图片" aria-label={`移除 ${image.name}`} onClick={() => setAttachments((items) => items.filter((item) => item.id !== image.id))}><X size={13}/></button></div>)}</div>}
      <textarea value={text} onChange={(event) => setText(event.target.value)} onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.some((file) => file.type.startsWith("image/"))) void preparePastedImages(files); }} placeholder={`和${snapshot?.persona.name ?? "角色"}说点什么`} aria-label="消息" rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}/>
      <div className="composer-actions">
        <div className="composer-tools"><button className="icon-button" title="添加图片" aria-label="添加图片" disabled={Boolean(requestId) || attachments.length >= 3} onClick={() => void selectImages()}><ImagePlus size={17}/></button><button className="icon-button" title="清空记录" aria-label="清空记录" onClick={() => void window.everby.clearMessages()}><Trash2 size={17}/></button></div>
        {requestId ? <button className="send-button stop" title="停止" aria-label="停止生成" onClick={() => void window.everby.stopMessage(requestId)}><Square size={15}/></button> : <button className="send-button" title="发送" aria-label="发送消息" disabled={!text.trim() && attachments.length === 0} onClick={() => void send()}><Send size={17}/></button>}
      </div>
    </footer>
  </main>;
}

createRoot(document.getElementById("root")!).render(<ChatApp/>);
