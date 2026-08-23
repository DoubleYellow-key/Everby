import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bot, Brain, Check, ChevronRight, Eye, MessageCircle, PackagePlus, Palette, Play, Save, ShieldCheck, Sparkles, Sun, Trash2, UserRound } from "lucide-react";
import type { AppSnapshot, ModelSettings, PersonaProfile } from "../shared/contracts";
import "./ui.css";
import "./role-picker.css";

type Tab = "companion" | "persona" | "model" | "motions" | "memory" | "privacy" | "appearance";
const tabs: Array<{ id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "companion", label: "陪伴", icon: MessageCircle }, { id: "persona", label: "角色", icon: UserRound },
  { id: "model", label: "模型", icon: Bot }, { id: "motions", label: "动作扩展", icon: Sparkles },
  { id: "memory", label: "记忆", icon: Brain }, { id: "privacy", label: "隐私", icon: ShieldCheck }, { id: "appearance", label: "外观", icon: Palette }
];

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }): React.JSX.Element {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}><span/></button>;
}

function ManagerApp(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>("companion");
  const [status, setStatus] = useState("");
  useEffect(() => { void window.souldesk.getSnapshot().then(setSnapshot); const off = window.souldesk.onSnapshot(setSnapshot); document.documentElement.dataset.appReady = "true"; return () => { if (typeof off === "function") off(); }; }, []);
  if (!snapshot) return <div className="manager-loading">正在唤醒桌面伙伴…</div>;
  const activePet = snapshot.pets.find((pet) => pet.id === snapshot.activePetId) ?? snapshot.pets[0];
  if (!activePet) return <div className="manager-loading">没有找到可用角色</div>;

  async function savePersona(form: FormData): Promise<void> {
    const patch = Object.fromEntries(form) as unknown as Partial<PersonaProfile>; await window.souldesk.updatePersona(patch); setStatus("角色设定已保存");
  }
  async function saveModel(form: FormData): Promise<void> {
    const patch = Object.fromEntries(form) as unknown as Partial<ModelSettings> & { apiKey?: string }; patch.temperature = Number(patch.temperature); await window.souldesk.updateModel(patch); setStatus("模型设置已保存");
  }
  async function selectPet(petId: string, name: string): Promise<void> {
    await window.souldesk.selectPet(petId); setStatus(`已切换到 ${name}`);
  }

  return <div className="manager-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Sun size={21}/></div><div><strong>SoulDesk</strong><span>本地陪伴智能体</span></div></div>
      <nav aria-label="设置导航">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? "active" : ""} onClick={() => { setTab(id); setStatus(""); }}><Icon size={18}/><span>{label}</span><ChevronRight size={15}/></button>)}</nav>
      <div className="sidebar-foot"><span className="presence-dot"/>{activePet.name} 正在桌面陪伴</div>
    </aside>
    <main className="settings-main">
      {tab === "companion" && <section><PageTitle title="陪伴状态" description={`控制桌面上的 ${activePet.name} 和对话入口。`}/><div className="status-band"><div><span>当前角色</span><strong>{activePet.name}</strong><small>{snapshot.model.configured ? `已连接 ${snapshot.model.model}` : "离线动作模式"}</small></div><button className="primary" onClick={() => void window.souldesk.openChat()}><Play size={17}/>开始对话</button></div><SettingRow title="显示桌宠" detail="隐藏后仍可从托盘恢复"><Toggle label="显示桌宠" checked={snapshot.settings.visible} onChange={(visible) => void window.souldesk.updateSettings({ visible })}/></SettingRow><SettingRow title="暂停日常动作" detail="保留点击和对话响应"><Toggle label="暂停日常动作" checked={snapshot.settings.paused} onChange={(paused) => void window.souldesk.updateSettings({ paused })}/></SettingRow><SettingRow title="主动陪伴" detail="遵守免打扰时间和每日频率"><Toggle label="主动陪伴" checked={snapshot.settings.proactiveEnabled} onChange={(proactiveEnabled) => void window.souldesk.updateSettings({ proactiveEnabled })}/></SettingRow></section>}
      {tab === "persona" && <section><PageTitle title="角色与人设" description="选择本机已安装的 Petdex 角色，每个角色拥有独立的人设、对话和记忆。"/><div className="pet-picker" role="listbox" aria-label="桌宠角色">{snapshot.pets.map((pet) => <button type="button" role="option" aria-selected={pet.id === snapshot.activePetId} key={pet.id} className={`pet-option ${pet.id === snapshot.activePetId ? "active" : ""}`} onClick={() => void selectPet(pet.id, pet.name)}><span className="pet-thumbnail" style={{ backgroundImage: `url(${pet.sheetUrl})` }}/><span className="pet-copy"><strong>{pet.name}</strong><small>{pet.source === "petdex" ? "Petdex 已安装" : "SoulDesk 内置角色"}</small></span>{pet.id === snapshot.activePetId && <span className="pet-selected" title="当前角色"><Check size={17}/></span>}</button>)}</div><form key={snapshot.persona.petId} className="form-grid" action={(form) => void savePersona(form)}><Field label="名字"><input name="name" defaultValue={snapshot.persona.name}/></Field><Field label="对你的称呼"><input name="userAddress" defaultValue={snapshot.persona.userAddress}/></Field><Field label="角色背景" wide><textarea name="background" defaultValue={snapshot.persona.background} rows={4}/></Field><Field label="说话风格" wide><textarea name="speakingStyle" defaultValue={snapshot.persona.speakingStyle} rows={3}/></Field><Field label="行为边界" wide><textarea name="boundaries" defaultValue={snapshot.persona.boundaries} rows={3}/></Field><button className="primary form-submit"><Save size={17}/>保存角色</button></form></section>}
      {tab === "model" && <section><PageTitle title="模型连接" description="兼容 OpenAI Chat Completions 的服务。API Key 由系统凭据加密。"/><form className="form-grid" action={(form) => void saveModel(form)}><Field label="API Base URL" wide><input name="baseUrl" defaultValue={snapshot.model.baseUrl} placeholder="https://api.openai.com/v1"/></Field><Field label="模型"><input name="model" defaultValue={snapshot.model.model}/></Field><Field label="Temperature"><input name="temperature" type="number" min="0" max="2" step="0.1" defaultValue={snapshot.model.temperature}/></Field><Field label="API Key" wide><input name="apiKey" type="password" autoComplete="off" placeholder={snapshot.model.configured ? "已安全保存，留空则不修改" : "输入 API Key"}/></Field><div className="form-actions"><button className="primary"><Save size={17}/>保存连接</button><button type="button" className="secondary" onClick={() => void window.souldesk.testModel().then((result) => setStatus(result.message))}>测试连接</button></div></form></section>}
      {tab === "motions" && <section><PageTitle title="动作扩展" description="为当前角色追加动作，无需替换基础资源。"/><button className="primary" onClick={() => void window.souldesk.importMotion()}><PackagePlus size={17}/>导入 .soulmotion</button><div className="motion-list">{snapshot.motionPacks.length === 0 ? <Empty icon={Sparkles} title="还没有扩展动作" detail="基础的九组 Codex 动作已经可以正常使用。"/> : snapshot.motionPacks.map((pack) => <div className="motion-row" key={pack.packId}><div><strong>{pack.name}</strong><span>v{pack.version} · {pack.animationCount} 个动作</span></div><Toggle label={`启用 ${pack.name}`} checked={pack.enabled} onChange={(enabled) => void window.souldesk.setMotionEnabled(pack.packId, enabled)}/><button className="icon-button danger" title="卸载" onClick={() => void window.souldesk.removeMotion(pack.packId)}><Trash2 size={17}/></button></div>)}</div></section>}
      {tab === "memory" && <section><PageTitle title="本地记忆" description="对话和摘要仅保存在这台电脑。"/><div className="memory-block"><span>滚动摘要</span><p>{snapshot.memorySummary || "还没有形成长期摘要。继续聊一阵后，重要偏好会出现在这里。"}</p></div><SettingRow title="最近消息" detail={`当前保存 ${snapshot.messages.length} 条，最多 200 条`}><button className="secondary danger-text" onClick={() => void window.souldesk.clearMessages()}><Trash2 size={16}/>清空</button></SettingRow></section>}
      {tab === "privacy" && <section><PageTitle title="隐私" description="上下文采集默认关闭，并且不会读取窗口内容。"/><SettingRow title="感知前台应用" detail="只读取应用名称；不保存标题、URL、文件名或截图"><Toggle label="感知前台应用" checked={snapshot.settings.activeAppEnabled} onChange={(activeAppEnabled) => void window.souldesk.updateSettings({ activeAppEnabled })}/></SettingRow><div className="privacy-note"><Eye size={19}/><p><strong>当前采集边界</strong><span>时间、系统空闲状态，以及你主动开启后的前台应用名称。锁屏时停止采集和主动消息。</span></p></div></section>}
      {tab === "appearance" && <section><PageTitle title="外观" description={`调整 ${activePet.name} 在桌面上的尺寸和层级。`}/><SettingRow title="始终置顶" detail={`让 ${activePet.name} 保持在普通窗口上方`}><Toggle label="始终置顶" checked={snapshot.settings.alwaysOnTop} onChange={(alwaysOnTop) => void window.souldesk.updateSettings({ alwaysOnTop })}/></SettingRow><label className="range-row"><span><strong>桌宠大小</strong><small>{Math.round(snapshot.settings.scale * 100)}%</small></span><input type="range" min="0.5" max="2" step="0.05" value={snapshot.settings.scale} onChange={(event) => void window.souldesk.updateSettings({ scale: Number(event.target.value) })}/></label></section>}
      {status && <div className="toast" role="status">{status}</div>}
    </main>
  </div>;
}

function PageTitle({ title, description }: { title: string; description: string }): React.JSX.Element { return <header className="page-title"><h1>{title}</h1><p>{description}</p></header>; }
function SettingRow({ title, detail, children }: React.PropsWithChildren<{ title: string; detail: string }>): React.JSX.Element { return <div className="setting-row"><div><strong>{title}</strong><span>{detail}</span></div>{children}</div>; }
function Field({ label, wide, children }: React.PropsWithChildren<{ label: string; wide?: boolean }>): React.JSX.Element { return <label className={wide ? "wide" : ""}><span>{label}</span>{children}</label>; }
function Empty({ icon: Icon, title, detail }: { icon: React.ComponentType<{ size?: number }>; title: string; detail: string }): React.JSX.Element { return <div className="empty"><Icon size={27}/><strong>{title}</strong><span>{detail}</span></div>; }
createRoot(document.getElementById("root")!).render(<ManagerApp/>);
