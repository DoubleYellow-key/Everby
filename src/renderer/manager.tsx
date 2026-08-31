import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bot, Brain, Check, CheckCircle2, ChevronRight, Eye, ListTodo, MessageCircle, PackagePlus, Palette, Play, Plus, Save, ShieldCheck, Sparkles, Sun, TimerOff, Trash2, UserRound } from "lucide-react";
import type { AppSnapshot, EmbeddingSettings, ModelSettings, PersonaProfile } from "../shared/contracts";
import { MotionSettings } from "./motion-settings";
import "./ui.css";
import "./role-picker.css";

type Tab = "companion" | "plans" | "persona" | "model" | "motions" | "memory" | "privacy" | "appearance";
const tabs: Array<{ id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "companion", label: "陪伴", icon: MessageCircle }, { id: "plans", label: "计划", icon: ListTodo }, { id: "persona", label: "角色", icon: UserRound },
  { id: "model", label: "模型", icon: Bot }, { id: "motions", label: "动作", icon: Sparkles },
  { id: "memory", label: "记忆", icon: Brain }, { id: "privacy", label: "隐私", icon: ShieldCheck }, { id: "appearance", label: "外观", icon: Palette }
];

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }): React.JSX.Element {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}><span/></button>;
}

function ModeControls({ snapshot, setStatus }: { snapshot: AppSnapshot; setStatus: (value: string) => void }): React.JSX.Element {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(timer); }, []);
  const mode = snapshot.actionMode;
  const remaining = mode.endsAt ? Math.max(0, mode.endsAt - now) : 0;
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor(remaining % 60_000 / 1_000);
  const active = snapshot.actionProfiles.find((profile) => profile.mode === mode.mode) ?? snapshot.actionProfiles[0];
  const customStates = snapshot.actionProfiles.filter((profile) => profile.mode !== "normal");
  const detail = mode.mode === "normal" ? "按常规状态自然轮换" : mode.endsAt ? `剩余 ${minutes}:${String(seconds).padStart(2, "0")}` : "持续到手动结束";
  async function start(next: string): Promise<void> {
    const profile = customStates.find((item) => item.mode === next);
    await window.everby.startActionMode(next);
    setStatus(`已进入${profile?.name ?? "自定义状态"}`);
  }
  return <div className="mode-control-panel">
    <div className="mode-current"><span><Sparkles size={19}/></span><div><strong>{active?.name ?? "常规"}</strong><small>{detail}</small></div>{mode.mode !== "normal" && <button className="secondary" onClick={() => void window.everby.stopActionMode().then(() => setStatus("已回到常规"))}><TimerOff size={16}/>结束状态</button>}</div>
    {customStates.length > 0 && <div className="mode-shortcuts"><div><span>切换状态</span>{customStates.map((profile) => <button key={profile.mode} className="secondary" disabled={profile.mode === mode.mode} onClick={() => void start(profile.mode)}>{profile.name}</button>)}</div></div>}
  </div>;
}

function dateValue(value: FormDataEntryValue | null): number | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  const time = new Date(text).getTime();
  return Number.isFinite(time) ? time : null;
}

function todoSchedule(todo: AppSnapshot["todos"][number]): string {
  const parts: string[] = [];
  if (todo.remindAt) parts.push(`提醒 ${new Date(todo.remindAt).toLocaleString()}`);
  else if (todo.dueAt) parts.push(`截止 ${new Date(todo.dueAt).toLocaleString()}`);
  if (todo.repeat === "daily") parts.push("每日");
  if (todo.source === "chat") parts.push("对话添加");
  return parts.join(" · ") || "未设时间";
}

function ManagerApp(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>("companion");
  const [status, setStatus] = useState("");
  useEffect(() => { void window.everby.getSnapshot().then(setSnapshot); const off = window.everby.onSnapshot(setSnapshot); document.documentElement.dataset.appReady = "true"; return () => { if (typeof off === "function") off(); }; }, []);
  if (!snapshot) return <div className="manager-loading">正在唤醒桌面伙伴…</div>;
  const activePet = snapshot.pets.find((pet) => pet.id === snapshot.activePetId) ?? snapshot.pets[0];
  if (!activePet) return <div className="manager-loading">没有找到可用角色</div>;

  async function savePersona(form: FormData): Promise<void> {
    const patch = Object.fromEntries(form) as unknown as Partial<PersonaProfile>; await window.everby.updatePersona(patch); setStatus("角色设定已保存");
  }
  async function saveModel(form: FormData): Promise<void> {
    const patch = Object.fromEntries(form) as unknown as Partial<ModelSettings> & { apiKey?: string }; patch.temperature = Number(patch.temperature); await window.everby.updateModel(patch); setStatus("模型设置已保存");
  }
  async function saveEmbedding(form: FormData): Promise<void> {
    const patch = Object.fromEntries(form) as unknown as Partial<EmbeddingSettings> & { apiKey?: string }; await window.everby.updateEmbedding(patch); setStatus("Embedding 设置已保存");
  }
  async function selectPet(petId: string, name: string): Promise<void> {
    await window.everby.selectPet(petId); setStatus(`已切换到 ${name}`);
  }
  async function importPet(): Promise<void> {
    try {
      const pet = await window.everby.importPet();
      if (!pet) return;
      await window.everby.selectPet(pet.id);
      setStatus(`已导入并切换到 ${pet.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "角色导入失败");
    }
  }
  async function createTodo(form: FormData): Promise<void> {
    await window.everby.createTodo({
      title: String(form.get("title") ?? ""), notes: String(form.get("notes") ?? ""),
      dueAt: dateValue(form.get("dueAt")), remindAt: dateValue(form.get("remindAt")),
      repeat: form.get("repeat") === "daily" ? "daily" : "none"
    });
    setStatus("计划已添加");
  }

  return <div className="manager-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Sun size={21}/></div><div><strong>Everby</strong><span>常伴你的桌面宠物</span></div></div>
      <nav aria-label="设置导航">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? "active" : ""} onClick={() => { setTab(id); setStatus(""); }}><Icon size={18}/><span>{label}</span><ChevronRight size={15}/></button>)}</nav>
      <div className="sidebar-foot"><span className="presence-dot"/>{activePet.name} 正在桌面陪伴</div>
    </aside>
    <main className="settings-main">
      {tab === "companion" && <section><PageTitle title="陪伴状态" description={`控制桌面上的 ${activePet.name}、状态计时和对话入口。`}/><div className="status-band"><div><span>当前角色</span><strong>{activePet.name}</strong><small>{snapshot.model.configured ? `已连接 ${snapshot.model.model}` : "离线动作模式"}</small></div><button className="primary" onClick={() => void window.everby.openChat()}><Play size={17}/>开始对话</button></div><ModeControls snapshot={snapshot} setStatus={setStatus}/><SettingRow title="显示桌宠" detail="隐藏后仍可从托盘恢复"><Toggle label="显示桌宠" checked={snapshot.settings.visible} onChange={(visible) => void window.everby.updateSettings({ visible })}/></SettingRow><SettingRow title="暂停背景动作" detail="保留提醒、点击、对话和拖拽反馈"><Toggle label="暂停背景动作" checked={snapshot.settings.paused} onChange={(paused) => void window.everby.updateSettings({ paused })}/></SettingRow><SettingRow title="主动陪伴" detail="遵守免打扰时间和每日频率"><Toggle label="主动陪伴" checked={snapshot.settings.proactiveEnabled} onChange={(proactiveEnabled) => void window.everby.updateSettings({ proactiveEnabled })}/></SettingRow></section>}
      {tab === "plans" && <section><PageTitle title="计划与提醒" description="管理本地清单、截止时间和提醒。"/><form className="todo-form" action={(form) => void createTodo(form)}><Field label="计划内容" wide><input name="title" required maxLength={160} placeholder="例如：整理本周进度"/></Field><Field label="截止时间"><input name="dueAt" type="datetime-local"/></Field><Field label="提醒时间"><input name="remindAt" type="datetime-local"/></Field><Field label="重复"><select name="repeat" defaultValue="none"><option value="none">不重复</option><option value="daily">每天</option></select></Field><Field label="备注"><input name="notes" maxLength={500}/></Field><button className="primary form-submit"><Plus size={17}/>添加计划</button></form><div className="plan-controls"><SettingRow title="定时提醒" detail="到点后显示系统通知和桌宠气泡"><Toggle label="定时提醒" checked={snapshot.settings.remindersEnabled} onChange={(remindersEnabled) => void window.everby.updateSettings({ remindersEnabled })}/></SettingRow><SettingRow title="AI 清单关注" detail="低频查看临近或逾期项目，并结合时间与已授权的应用名称回应"><Toggle label="AI 清单关注" checked={snapshot.settings.taskAssistantEnabled} onChange={(taskAssistantEnabled) => void window.everby.updateSettings({ taskAssistantEnabled })}/></SettingRow></div><div className="todo-list" aria-label="计划清单">{snapshot.todos.length === 0 ? <Empty icon={CheckCircle2} title="清单为空" detail="可以在这里添加，也可以直接在对话中告诉桌面伙伴。"/> : snapshot.todos.map((todo) => <div className={`todo-row ${todo.completedAt ? "completed" : ""}`} key={todo.id}><input type="checkbox" aria-label={`完成 ${todo.title}`} checked={todo.completedAt !== null} onChange={(event) => void window.everby.updateTodo(todo.id, { completed: event.target.checked })}/><div><strong>{todo.title}</strong><span>{todoSchedule(todo)}</span>{todo.notes && <small>{todo.notes}</small>}</div><button className="icon-button danger" title="删除计划" aria-label={`删除 ${todo.title}`} onClick={() => void window.everby.deleteTodo(todo.id)}><Trash2 size={17}/></button></div>)}</div></section>}
      {tab === "persona" && <section><PageTitle title="角色与人设" description="选择本机已安装的 Petdex 角色，每个角色拥有独立的人设、对话和记忆。"/><div className="pet-import-row"><button className="primary" onClick={() => void importPet()}><PackagePlus size={17}/>导入角色</button><small>支持 Petdex 角色文件夹或 .zip 压缩包，导入后自动切换</small></div><div className="pet-picker" role="listbox" aria-label="桌宠角色">{snapshot.pets.map((pet) => <button type="button" role="option" aria-selected={pet.id === snapshot.activePetId} key={pet.id} className={`pet-option ${pet.id === snapshot.activePetId ? "active" : ""}`} onClick={() => void selectPet(pet.id, pet.name)}><span className="pet-thumbnail" style={{ backgroundImage: `url(${pet.sheetUrl})` }}/><span className="pet-copy"><strong>{pet.name}</strong><small>{pet.source === "petdex" ? "Petdex 已安装" : "Everby 内置角色"}</small></span>{pet.id === snapshot.activePetId && <span className="pet-selected" title="当前角色"><Check size={17}/></span>}</button>)}</div><form key={snapshot.persona.petId} className="form-grid" action={(form) => void savePersona(form)}><Field label="名字"><input name="name" defaultValue={snapshot.persona.name}/></Field><Field label="对你的称呼"><input name="userAddress" defaultValue={snapshot.persona.userAddress}/></Field><Field label="角色背景" wide><textarea name="background" defaultValue={snapshot.persona.background} rows={4}/></Field><Field label="说话风格" wide><textarea name="speakingStyle" defaultValue={snapshot.persona.speakingStyle} rows={3}/></Field><Field label="行为边界" wide><textarea name="boundaries" defaultValue={snapshot.persona.boundaries} rows={3}/></Field><button className="primary form-submit"><Save size={17}/>保存角色</button></form></section>}
      {tab === "model" && <section><PageTitle title="模型连接" description="兼容 OpenAI Chat Completions 与 Embeddings 的服务，凭据由系统加密。"/><div className="status-band"><div><span>智能体状态</span><strong>{snapshot.agentStatus === "ready" ? "已就绪" : snapshot.agentStatus === "degraded" ? "降级运行" : "尚未配置"}</strong><small>{snapshot.agentCapabilities.toolCalling ? "工具调用可用" : "陪伴聊天可用时，待办与自动记忆工具将停用"}</small></div></div><form className="form-grid" action={(form) => void saveModel(form)}><Field label="Chat API Base URL" wide><input name="baseUrl" defaultValue={snapshot.model.baseUrl} placeholder="https://api.openai.com/v1"/></Field><Field label="聊天模型"><input name="model" defaultValue={snapshot.model.model}/></Field><Field label="Temperature"><input name="temperature" type="number" min="0" max="2" step="0.1" defaultValue={snapshot.model.temperature}/></Field><Field label="Chat API Key" wide><input name="apiKey" type="password" autoComplete="off" placeholder={snapshot.model.configured ? "已安全保存，留空则不修改" : "输入 API Key"}/></Field><div className="form-actions"><button className="primary"><Save size={17}/>保存连接</button><button type="button" className="secondary" onClick={() => void window.everby.testModel().then((result) => setStatus(result.message))}>探测能力</button></div></form><form className="form-grid" action={(form) => void saveEmbedding(form)}><Field label="Embedding API Base URL" wide><input name="baseUrl" defaultValue={snapshot.embedding.baseUrl}/></Field><Field label="Embedding 模型"><input name="model" defaultValue={snapshot.embedding.model}/></Field><Field label="Embedding API Key" wide><input name="apiKey" type="password" autoComplete="off" placeholder={snapshot.embedding.configured ? "已安全保存，留空则不修改" : "输入独立 API Key"}/></Field><button className="primary form-submit"><Save size={17}/>保存 Embedding</button></form></section>}
      {tab === "motions" && <MotionSettings snapshot={snapshot} setStatus={setStatus}/>}
      {tab === "memory" && <section><PageTitle title="长期记忆" description="事实与向量只保存在这台电脑，并按角色隔离。"/><SettingRow title="当前会话" detail={`保存 ${snapshot.messages.length} 条消息；清空会话不会删除长期记忆`}><button className="secondary danger-text" onClick={() => void window.everby.clearMessages()}><Trash2 size={16}/>清空会话</button></SettingRow><div className="memory-list">{snapshot.memories.length === 0 ? <Empty icon={Brain} title="还没有长期记忆" detail="明确说“记住”时会立即保存，稳定事实也可由后台整理。"/> : snapshot.memories.map((memory) => <div className="memory-row" key={memory.id}><div><strong>{memory.type} · {Math.round(memory.confidence * 100)}%</strong><span>{memory.content}</span><small>{new Date(memory.createdAt).toLocaleString()} · {memory.indexed ? "向量已索引" : "等待索引"}</small></div><button className="icon-button danger" title="删除记忆" onClick={() => void window.everby.deleteMemory(memory.id)}><Trash2 size={17}/></button></div>)}</div>{snapshot.memories.length > 0 && <button className="secondary danger-text" onClick={() => { if (confirm("确定清空当前角色的全部长期记忆吗？此操作不可撤销。")) void window.everby.clearMemories(); }}><Trash2 size={16}/>清空长期记忆</button>}</section>}
      {tab === "privacy" && <section><PageTitle title="隐私" description="上下文采集默认关闭，并且不会读取窗口内容。"/><SettingRow title="感知前台应用" detail="只读取应用名称；不保存标题、URL、文件名或截图"><Toggle label="感知前台应用" checked={snapshot.settings.activeAppEnabled} onChange={(activeAppEnabled) => void window.everby.updateSettings({ activeAppEnabled })}/></SettingRow><div className="privacy-note"><Eye size={19}/><p><strong>当前采集边界</strong><span>时间、系统空闲状态，以及你主动开启后的前台应用名称。锁屏时停止采集和主动消息。</span></p></div></section>}
      {tab === "appearance" && <section><PageTitle title="外观" description={`调整 ${activePet.name} 在桌面上的尺寸和层级。`}/><SettingRow title="始终置顶" detail={`让 ${activePet.name} 保持在普通窗口上方`}><Toggle label="始终置顶" checked={snapshot.settings.alwaysOnTop} onChange={(alwaysOnTop) => void window.everby.updateSettings({ alwaysOnTop })}/></SettingRow><label className="range-row"><span><strong>桌宠大小</strong><small>{Math.round(snapshot.settings.scale * 100)}%</small></span><input type="range" min="0.5" max="2" step="0.05" value={snapshot.settings.scale} onChange={(event) => void window.everby.updateSettings({ scale: Number(event.target.value) })}/></label></section>}
      {status && <div className="toast" role="status">{status}</div>}
    </main>
  </div>;
}

function PageTitle({ title, description }: { title: string; description: string }): React.JSX.Element { return <header className="page-title"><h1>{title}</h1><p>{description}</p></header>; }
function SettingRow({ title, detail, children }: React.PropsWithChildren<{ title: string; detail: string }>): React.JSX.Element { return <div className="setting-row"><div><strong>{title}</strong><span>{detail}</span></div>{children}</div>; }
function Field({ label, wide, children }: React.PropsWithChildren<{ label: string; wide?: boolean }>): React.JSX.Element { return <label className={wide ? "wide" : ""}><span>{label}</span>{children}</label>; }
function Empty({ icon: Icon, title, detail }: { icon: React.ComponentType<{ size?: number }>; title: string; detail: string }): React.JSX.Element { return <div className="empty"><Icon size={27}/><strong>{title}</strong><span>{detail}</span></div>; }
createRoot(document.getElementById("root")!).render(<ManagerApp/>);
