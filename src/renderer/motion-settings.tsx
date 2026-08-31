import React, { useEffect, useMemo, useRef, useState } from "react";
import { Copy, PackagePlus, Pencil, Play, Plus, Save, Sparkles, Trash2, X } from "lucide-react";
import { frameAtTime } from "../core/timeline";
import { ACTION_INTENTS, type ActionIntent, type ActionProfile, type ActionRule, type ActionRuleEvent, type AppSnapshot, type CreateActionProfileInput, type CreateActionRuleInput, type MotionCatalog, type PetAnimation } from "../shared/contracts";

type MotionView = "library" | "modes" | "rules" | "packs";
type DraftRule = CreateActionRuleInput & { id?: string };
const intentLabels: Record<ActionIntent, string> = { idle: "待机", greet: "问候", happy: "开心", encourage: "鼓励", think: "思考", work: "工作", wait: "等待", celebrate: "庆祝", tired: "疲劳", confused: "困惑" };
const stateEventLabels: Record<ActionRuleEvent, string> = { pet_click: "点击桌宠", conversation_intent: "对话回应", reminder: "提醒到期" };

function newEventRule(actionId: string): DraftRule {
  return { name: "点击回应", actionId, enabled: true, durationSeconds: 8, trigger: { type: "event", event: "pet_click", probability: 1, cooldownSeconds: 5 } };
}
function actionName(action: PetAnimation): string { return action.label || action.id; }
function actionDuration(action: PetAnimation): number { return action.frames.reduce((total, frame) => total + frame.durationMs, 0); }

function ActionPreview({ action, sheetUrl }: { action: PetAnimation; sheetUrl: string }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    const atlas = new Image(); atlas.crossOrigin = "anonymous"; atlas.src = sheetUrl;
    const images = new Map<string, HTMLImageElement>();
    for (const frame of action.frames) if (frame.src && !images.has(frame.src)) { const image = new Image(); image.crossOrigin = "anonymous"; image.src = frame.src; images.set(frame.src, image); }
    let animationFrame = 0;
    const started = performance.now();
    const draw = (now: number) => {
      context.clearRect(0, 0, 192, 208);
      const frame = action.frames[frameAtTime(action.frames, now - started, true)];
      if (frame.src) { const image = images.get(frame.src); if (image?.complete) context.drawImage(image, 0, 0, 192, 208); }
      else if (atlas.complete) context.drawImage(atlas, frame.x, frame.y, frame.width, frame.height, 0, 0, 192, 208);
      animationFrame = requestAnimationFrame(draw);
    };
    animationFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrame);
  }, [action, sheetUrl]);
  return <canvas ref={ref} className="motion-preview-canvas" width={192} height={208} aria-label={`${actionName(action)} 动作预览`}/>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }): React.JSX.Element {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}><span/></button>;
}

function RuleEditor({ draft, actions, onChange, onSave, onCancel }: { draft: DraftRule; actions: PetAnimation[]; onChange: (next: DraftRule) => void; onSave: () => void; onCancel: () => void }): React.JSX.Element {
  const trigger = draft.trigger;
  return <form className="rule-editor" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
    <div className="rule-editor-head"><div><strong>{draft.id ? "编辑事件规则" : "新建事件规则"}</strong><span>提醒、对话或点击发生时执行</span></div><button type="button" className="icon-button" title="关闭" aria-label="关闭规则编辑器" onClick={onCancel}><X size={17}/></button></div>
    <div className="rule-form-grid">
      <label><span>规则名称</span><input value={draft.name} maxLength={80} required onChange={(event) => onChange({ ...draft, name: event.target.value })}/></label>
      <label><span>播放动作</span><select value={draft.actionId} onChange={(event) => onChange({ ...draft, actionId: event.target.value })}>{actions.map((action) => <option key={action.id} value={action.id}>{actionName(action)} · {action.source === "extension" ? action.packName : "基础"}{action.enabled === false ? "（已停用）" : ""}</option>)}</select></label>
      <label><span>事件</span><select aria-label="事件类型" value={trigger.event} onChange={(event) => { const value = event.target.value as typeof trigger.event; onChange({ ...draft, trigger: { ...trigger, event: value, intent: value === "conversation_intent" ? (trigger.intent ?? "happy") : undefined } }); }}><option value="pet_click">点击桌宠</option><option value="conversation_intent">对话语义</option><option value="reminder">提醒到期</option></select></label>
      {trigger.event === "conversation_intent" && <label><span>语义意图</span><select value={trigger.intent ?? "happy"} onChange={(event) => onChange({ ...draft, trigger: { ...trigger, intent: event.target.value as ActionIntent } })}>{ACTION_INTENTS.map((intent) => <option key={intent} value={intent}>{intentLabels[intent]}</option>)}</select></label>}
      <label><span>循环动作时长</span><span className="number-field"><input type="number" min={1} max={60} value={draft.durationSeconds} onChange={(event) => onChange({ ...draft, durationSeconds: Number(event.target.value) })}/><small>秒</small></span></label>
      <label><span>冷却时间</span><span className="number-field"><input type="number" min={0} max={86400} value={trigger.cooldownSeconds} onChange={(event) => onChange({ ...draft, trigger: { ...trigger, cooldownSeconds: Number(event.target.value) } })}/><small>秒</small></span></label>
      <label className="probability-field"><span>触发概率 <strong>{Math.round(trigger.probability * 100)}%</strong></span><input type="range" min={0} max={1} step={0.05} value={trigger.probability} onChange={(event) => onChange({ ...draft, trigger: { ...trigger, probability: Number(event.target.value) } })}/></label>
    </div>
    <div className="rule-editor-actions"><button className="primary"><Save size={16}/>保存规则</button><Toggle label="启用规则" checked={draft.enabled} onChange={(enabled) => onChange({ ...draft, enabled })}/></div>
  </form>;
}

function ModeEditor({ profile, actions, onSave, onDelete }: { profile: ActionProfile; actions: PetAnimation[]; onSave: (profile: ActionProfile) => void; onDelete: (profile: ActionProfile) => void }): React.JSX.Element {
  const [draft, setDraft] = useState(profile);
  const [addActionId, setAddActionId] = useState("");
  useEffect(() => setDraft(profile), [profile]);
  const available = new Set(actions.filter((action) => action.enabled !== false).map((action) => action.id));
  const candidates = actions.filter((action) => !draft.items.some((item) => item.actionId === action.id) && action.id !== "idle");
  const totalWeight = draft.items.reduce((sum, item) => sum + item.weight, 0);
  const labelFor = (id: string) => actionName(actions.find((action) => action.id === id) ?? { id, loop: false, weight: 1, intents: [], frames: [] });
  function patchItem(actionId: string, weight: number): void { setDraft({ ...draft, items: draft.items.map((item) => item.actionId === actionId ? { ...item, weight } : item) }); }
  function addItem(): void { if (!addActionId) return; setDraft({ ...draft, items: [...draft.items, { actionId: addActionId, weight: 1 }] }); setAddActionId(""); }
  function setEventAction(event: ActionRuleEvent, actionId: string): void {
    const next = { ...draft.eventActions };
    if (!actionId) delete next[event];
    else next[event] = { actionId, durationSeconds: next[event]?.durationSeconds ?? 3 };
    setDraft({ ...draft, eventActions: next });
  }
  return <article className="mode-editor">
    <header><div>{profile.mode === "normal" ? <strong>常规</strong> : <input aria-label={`${profile.name}状态名称`} value={draft.name} maxLength={30} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/>}<span>{profile.mode === "normal" ? "默认状态，不能删除" : draft.defaultDurationMinutes > 0 ? `默认持续 ${draft.defaultDurationMinutes} 分钟` : "持续到手动结束"}</span></div><div className="mode-ratio"><strong>{Math.round(draft.activityRatio * 100)}%</strong><span>非待机</span></div></header>
    <div className="state-basics"><label><span>背景策略</span><select aria-label={`${profile.name}背景策略`} value={draft.strategy} onChange={(event) => setDraft({ ...draft, strategy: event.target.value as ActionProfile["strategy"] })}><option value="weighted">动作池轮换</option><option value="fixed">固定动作</option></select></label><label><span>单次动作时长</span><span className="number-field"><input aria-label={`${profile.name}单次动作时长`} type="number" min={3} max={300} value={draft.actionDurationSeconds} onChange={(event) => setDraft({ ...draft, actionDurationSeconds: Number(event.target.value) })}/><small>秒</small></span></label>{profile.mode !== "normal" && <label><span>默认状态时长</span><span className="number-field"><input aria-label={`${profile.name}默认状态时长`} type="number" min={0} max={480} value={draft.defaultDurationMinutes} onChange={(event) => setDraft({ ...draft, defaultDurationMinutes: Number(event.target.value) })}/><small>分钟</small></span></label>}</div>
    <label className="activity-slider"><span>目标活跃度</span><input aria-label={`${profile.name}目标活跃度`} type="range" min={5} max={95} step={5} value={draft.activityRatio * 100} onChange={(event) => setDraft({ ...draft, activityRatio: Number(event.target.value) / 100 })}/><small>预计待机 {Math.round((1 - draft.activityRatio) * 100)}% · 非待机 {Math.round(draft.activityRatio * 100)}%</small></label>
    {draft.strategy === "fixed" ? <label className="fixed-action"><span>固定动作</span><select aria-label={`${profile.name}固定动作`} value={draft.items[0]?.actionId ?? "working"} onChange={(event) => setDraft({ ...draft, items: [{ actionId: event.target.value, weight: 1 }], fallbackActionId: event.target.value })}>{actions.filter((action) => action.id !== "idle").map((action) => <option key={action.id} value={action.id}>{actionName(action)} · {action.source === "extension" ? action.packName : "基础"}</option>)}</select>{!available.has(draft.items[0]?.actionId ?? "") && <small className="unavailable-copy">当前动作不可用，将自动使用 {labelFor(draft.fallbackActionId)}</small>}</label> : <div className="profile-items">
      {draft.items.map((item) => <div className={!available.has(item.actionId) ? "unavailable" : ""} key={item.actionId}><span><strong>{labelFor(item.actionId)}</strong><small>{available.has(item.actionId) ? `预计选择 ${totalWeight ? Math.round(item.weight / totalWeight * 100) : 0}%` : "不可用，将跳过"}</small></span><label><span>权重</span><input aria-label={`${labelFor(item.actionId)} 权重`} type="number" min={1} max={10} value={item.weight} onChange={(event) => patchItem(item.actionId, Number(event.target.value))}/></label><button type="button" className="icon-button danger" title="移除动作" aria-label={`移除 ${labelFor(item.actionId)}`} disabled={draft.items.length <= 1} onClick={() => setDraft({ ...draft, items: draft.items.filter((entry) => entry.actionId !== item.actionId) })}><Trash2 size={16}/></button></div>)}
      <div className="profile-add"><select aria-label={`添加${profile.name}动作`} value={addActionId} onChange={(event) => setAddActionId(event.target.value)}><option value="">选择动作</option>{candidates.map((action) => <option key={action.id} value={action.id}>{actionName(action)} · {action.source === "extension" ? action.packName : "基础"}</option>)}</select><button type="button" className="secondary" disabled={!addActionId} onClick={addItem}><Plus size={16}/>添加</button></div>
    </div>}
    <div className="state-events"><strong>状态内事件动作</strong>{(["pet_click", "conversation_intent", "reminder"] as ActionRuleEvent[]).map((event) => <div key={event}><label><span>{stateEventLabels[event]}</span><select aria-label={`${profile.name}${stateEventLabels[event]}动作`} value={draft.eventActions[event]?.actionId ?? ""} onChange={(change) => setEventAction(event, change.target.value)}><option value="">跟随全局规则</option>{actions.filter((action) => action.enabled !== false).map((action) => <option key={action.id} value={action.id}>{actionName(action)}</option>)}</select></label>{draft.eventActions[event] && <label><span>播放时长</span><span className="number-field"><input aria-label={`${profile.name}${stateEventLabels[event]}时长`} type="number" min={1} max={300} value={draft.eventActions[event]!.durationSeconds} onChange={(change) => setDraft({ ...draft, eventActions: { ...draft.eventActions, [event]: { ...draft.eventActions[event]!, durationSeconds: Number(change.target.value) } } })}/><small>秒</small></span></label>}</div>)}</div>
    <footer>{profile.mode !== "normal" && <button type="button" className="secondary danger-text" onClick={() => onDelete(profile)}><Trash2 size={16}/>删除状态</button>}<button type="button" className="primary" onClick={() => onSave(draft)}><Save size={16}/>保存状态</button></footer>
  </article>;
}

function describeRule(rule: ActionRule): string {
  const event = rule.trigger.event === "pet_click" ? "点击桌宠" : rule.trigger.event === "reminder" ? "提醒到期" : `对话：${intentLabels[rule.trigger.intent ?? "happy"]}`;
  return `${event} · 冷却 ${rule.trigger.cooldownSeconds} 秒 · ${Math.round(rule.trigger.probability * 100)}%`;
}

export function MotionSettings({ snapshot, setStatus }: { snapshot: AppSnapshot; setStatus: (value: string) => void }): React.JSX.Element {
  const [view, setView] = useState<MotionView>("library");
  const [catalog, setCatalog] = useState<MotionCatalog | null>(null);
  const [selectedId, setSelectedId] = useState("idle");
  const [draft, setDraft] = useState<DraftRule | null>(null);
  const [newStateName, setNewStateName] = useState("");
  const activePet = snapshot.pets.find((pet) => pet.id === snapshot.activePetId) ?? snapshot.pets[0];
  const packSignature = snapshot.motionPacks.map((pack) => `${pack.packId}:${pack.version}:${pack.enabled}`).join("|");
  useEffect(() => { void window.everby.getMotionCatalog().then((value) => { setCatalog(value); if (!value.actions.some((action) => action.id === selectedId)) setSelectedId(value.actions[0]?.id ?? ""); }); }, [snapshot.activePetId, packSignature]);
  const actions = catalog?.actions ?? [];
  const selected = actions.find((action) => action.id === selectedId) ?? actions[0];
  const available = useMemo(() => new Set(actions.filter((action) => action.enabled !== false).map((action) => action.id)), [actions]);
  async function saveRule(): Promise<void> { if (!draft) return; try { const { id, ...input } = draft; if (id) await window.everby.updateActionRule(id, input); else await window.everby.createActionRule(input); setDraft(null); setStatus("事件规则已保存"); } catch (error) { setStatus(error instanceof Error ? error.message : "事件规则保存失败"); } }
  async function saveProfile(profile: ActionProfile): Promise<void> { try { const { petId: _petId, mode: _mode, updatedAt: _updatedAt, ...input } = profile; await window.everby.updateActionProfile(profile.mode, input); setStatus(`${profile.name}状态已保存`); } catch (error) { setStatus(error instanceof Error ? error.message : "状态配置保存失败"); } }
  async function createProfile(): Promise<void> {
    const name = newStateName.trim(); if (!name) return;
    const preferred = actions.find((action) => action.id === "working" && action.enabled !== false) ?? actions.find((action) => action.id !== "idle" && action.enabled !== false);
    if (!preferred) { setStatus("没有可用于状态的动作"); return; }
    const input: CreateActionProfileInput = { name, activityRatio: 0.7, strategy: "fixed", items: [{ actionId: preferred.id, weight: 1 }], fallbackActionId: preferred.id, actionDurationSeconds: 60, defaultDurationMinutes: 45, eventActions: {} };
    try { await window.everby.createActionProfile(input); setNewStateName(""); setStatus(`已创建${name}状态`); } catch (error) { setStatus(error instanceof Error ? error.message : "状态创建失败"); }
  }
  async function deleteProfile(profile: ActionProfile): Promise<void> { if (!confirm(`确定删除“${profile.name}”状态吗？`)) return; try { await window.everby.deleteActionProfile(profile.mode); setStatus(`${profile.name}状态已删除`); } catch (error) { setStatus(error instanceof Error ? error.message : "状态删除失败"); } }
  async function importPack(): Promise<void> { try { const pack = await window.everby.importMotion(); if (pack) setStatus(`已导入 ${pack.name}`); } catch (error) { setStatus(error instanceof Error ? error.message : "动作扩展导入失败"); } }

  return <section className="motions-page">
    <header className="page-title"><h1>动作</h1><p>{activePet?.name} 的动作导演、事件回应和扩展包。</p></header>
    <div className="segmented motion-tabs" role="tablist" aria-label="动作设置视图">{([['library', '动作库'], ['modes', '状态模式'], ['rules', '事件规则'], ['packs', '扩展包']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? "active" : ""} onClick={() => { setView(id); setDraft(null); }}>{label}</button>)}</div>
    {view === "library" && <div className="motion-library"><div className="action-list" role="listbox" aria-label="可用动作">{actions.map((action) => <button key={action.id} role="option" aria-selected={selected?.id === action.id} className={selected?.id === action.id ? "active" : ""} onClick={() => setSelectedId(action.id)}><span><strong>{actionName(action)}</strong><small>{action.id}</small></span><em className={action.source === "extension" ? "extension" : "base"}>{action.source === "extension" ? action.packName : "基础"}</em></button>)}</div>{selected && <div className="action-inspector"><ActionPreview action={selected} sheetUrl={activePet?.sheetUrl ?? ""}/><div className="action-title"><div><strong>{actionName(selected)}</strong><span>{selected.id}</span></div><button className="primary icon-command" title="在桌面播放" aria-label={`播放 ${actionName(selected)}`} disabled={selected.enabled === false} onClick={() => void window.everby.previewAction(selected.id)}><Play size={18}/></button></div><dl><div><dt>来源</dt><dd>{selected.source === "extension" ? selected.packName : "基础动作"}</dd></div><div><dt>模式</dt><dd>{selected.loop ? "循环" : "单次"}</dd></div><div><dt>时长</dt><dd>{(actionDuration(selected) / 1000).toFixed(1)} 秒</dd></div><div><dt>语义</dt><dd>{selected.intents.map((intent) => intentLabels[intent]).join("、") || "无"}</dd></div></dl>{selected.enabled === false && <p className="motion-warning">扩展包已停用，启用后可播放。</p>}</div>}</div>}
    {view === "modes" && <><div className="state-create"><input aria-label="新状态名称" placeholder="状态名称" maxLength={30} value={newStateName} onChange={(event) => setNewStateName(event.target.value)}/><button className="primary" disabled={!newStateName.trim() || actions.length === 0} onClick={() => void createProfile()}><Plus size={17}/>新建状态</button></div><div className="mode-list">{snapshot.actionProfiles.map((profile) => <ModeEditor key={profile.mode} profile={profile} actions={actions} onSave={(value) => void saveProfile(value)} onDelete={(value) => void deleteProfile(value)}/>)}</div></>}
    {view === "rules" && <><div className="section-actions"><button className="primary" disabled={actions.length === 0} onClick={() => setDraft(newEventRule(actions.find((action) => action.enabled !== false)?.id ?? actions[0]?.id ?? "wave"))}><Plus size={17}/>新建规则</button></div>{draft && <RuleEditor draft={draft} actions={actions} onChange={setDraft} onSave={() => void saveRule()} onCancel={() => setDraft(null)}/>}<div className="rule-list">{snapshot.actionRules.length === 0 ? <div className="motion-empty"><Sparkles size={26}/><strong>还没有事件规则</strong></div> : snapshot.actionRules.map((rule) => <div className={`rule-row ${available.has(rule.actionId) ? "" : "unavailable"}`} key={rule.id}><div><strong>{rule.name}</strong><span>{actionName(actions.find((action) => action.id === rule.actionId) ?? { id: rule.actionId, loop: false, weight: 1, intents: [], frames: [] })} · {describeRule(rule)}</span>{!available.has(rule.actionId) && <small>动作不可用，规则不会执行</small>}</div><Toggle label={`启用 ${rule.name}`} checked={rule.enabled} onChange={(enabled) => void window.everby.updateActionRule(rule.id, { enabled })}/><button className="icon-button" title="复制" aria-label={`复制 ${rule.name}`} onClick={() => void window.everby.createActionRule({ name: `${rule.name} 副本`, actionId: rule.actionId, enabled: false, durationSeconds: rule.durationSeconds, trigger: rule.trigger })}><Copy size={16}/></button><button className="icon-button" title="编辑" aria-label={`编辑 ${rule.name}`} onClick={() => setDraft({ id: rule.id, name: rule.name, actionId: rule.actionId, enabled: rule.enabled, durationSeconds: rule.durationSeconds, trigger: rule.trigger })}><Pencil size={16}/></button><button className="icon-button danger" title="删除" aria-label={`删除 ${rule.name}`} onClick={() => void window.everby.deleteActionRule(rule.id)}><Trash2 size={16}/></button></div>)}</div></>}
    {view === "packs" && <><div className="section-actions"><button className="primary" onClick={() => void importPack()}><PackagePlus size={17}/>导入 .soulmotion</button></div><div className="motion-pack-list">{snapshot.motionPacks.length === 0 ? <div className="motion-empty"><Sparkles size={26}/><strong>还没有扩展动作</strong></div> : snapshot.motionPacks.map((pack) => <div className="motion-pack" key={pack.packId}><div className="motion-pack-head"><div><strong>{pack.name}</strong><span>v{pack.version} · {pack.animationCount} 个动作</span></div><Toggle label={`启用 ${pack.name}`} checked={pack.enabled} onChange={(enabled) => void window.everby.setMotionEnabled(pack.packId, enabled)}/><button className="icon-button danger" title="卸载" aria-label={`卸载 ${pack.name}`} onClick={() => void window.everby.removeMotion(pack.packId)}><Trash2 size={17}/></button></div><div className="pack-actions">{actions.filter((action) => action.packId === pack.packId).map((action) => <button key={action.id} onClick={() => { setSelectedId(action.id); setView("library"); }}><span>{actionName(action)}</span><Play size={14}/></button>)}</div></div>)}</div></>}
  </section>;
}
