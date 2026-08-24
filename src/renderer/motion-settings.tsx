import React, { useEffect, useMemo, useRef, useState } from "react";
import { Copy, PackagePlus, Pencil, Play, Plus, Save, Sparkles, Trash2, X } from "lucide-react";
import { frameAtTime } from "../core/timeline";
import { ACTION_INTENTS, type ActionIntent, type ActionRule, type AppSnapshot, type CreateActionRuleInput, type MotionCatalog, type PetAnimation } from "../shared/contracts";

type MotionView = "library" | "rules" | "packs";
type DraftRule = CreateActionRuleInput & { id?: string };
const week = [{ value: 1, label: "一" }, { value: 2, label: "二" }, { value: 3, label: "三" }, { value: 4, label: "四" }, { value: 5, label: "五" }, { value: 6, label: "六" }, { value: 0, label: "日" }];
const intentLabels: Record<ActionIntent, string> = { idle: "待机", greet: "问候", happy: "开心", encourage: "鼓励", think: "思考", work: "工作", wait: "等待", celebrate: "庆祝", tired: "疲劳", confused: "困惑" };

function newRoutine(actionId: string): DraftRule {
  return {
    name: "日常动作", actionId, enabled: true, durationSeconds: 8,
    trigger: { type: "routine", weekdays: [0, 1, 2, 3, 4, 5, 6], startTime: "08:00", endTime: "23:00", minIntervalMinutes: 10, maxIntervalMinutes: 20, probability: 1 }
  };
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
      if (frame.src) {
        const image = images.get(frame.src);
        if (image?.complete) context.drawImage(image, 0, 0, 192, 208);
      } else if (atlas.complete) context.drawImage(atlas, frame.x, frame.y, frame.width, frame.height, 0, 0, 192, 208);
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

function RuleEditor({ draft, actions, onChange, onSave, onCancel }: {
  draft: DraftRule; actions: PetAnimation[]; onChange: (next: DraftRule) => void; onSave: () => void; onCancel: () => void;
}): React.JSX.Element {
  const routine = draft.trigger.type === "routine" ? draft.trigger : null;
  const event = draft.trigger.type === "event" ? draft.trigger : null;
  return <form className="rule-editor" onSubmit={(formEvent) => { formEvent.preventDefault(); onSave(); }}>
    <div className="rule-editor-head"><div><strong>{draft.id ? "编辑触发规则" : "新建触发规则"}</strong><span>{draft.id ? "修改后立即应用" : "规则仅用于当前角色"}</span></div><button type="button" className="icon-button" title="关闭" aria-label="关闭规则编辑器" onClick={onCancel}><X size={17}/></button></div>
    <div className="rule-form-grid">
      <label><span>规则名称</span><input value={draft.name} maxLength={80} required onChange={(e) => onChange({ ...draft, name: e.target.value })}/></label>
      <label><span>播放动作</span><select value={draft.actionId} onChange={(e) => onChange({ ...draft, actionId: e.target.value })}>{actions.map((action) => <option key={action.id} value={action.id}>{actionName(action)} · {action.source === "extension" ? action.packName : "基础"}{action.enabled === false ? "（已停用）" : ""}</option>)}</select></label>
      <label><span>触发方式</span><select value={draft.trigger.type} onChange={(e) => onChange({ ...draft, trigger: e.target.value === "routine" ? newRoutine(draft.actionId).trigger : { type: "event", event: "pet_click", probability: 1, cooldownSeconds: 5 } })}><option value="routine">日常调度</option><option value="event">事件触发</option></select></label>
      <label><span>循环动作时长</span><span className="number-field"><input type="number" min={1} max={60} value={draft.durationSeconds} onChange={(e) => onChange({ ...draft, durationSeconds: Number(e.target.value) })}/><small>秒</small></span></label>
      {routine && <>
        <label><span>开始时间</span><input type="time" value={routine.startTime} onChange={(e) => onChange({ ...draft, trigger: { ...routine, startTime: e.target.value } })}/></label>
        <label><span>结束时间</span><input type="time" value={routine.endTime} onChange={(e) => onChange({ ...draft, trigger: { ...routine, endTime: e.target.value } })}/></label>
        <label><span>最小间隔</span><span className="number-field"><input type="number" min={1} max={10080} value={routine.minIntervalMinutes} onChange={(e) => onChange({ ...draft, trigger: { ...routine, minIntervalMinutes: Number(e.target.value) } })}/><small>分钟</small></span></label>
        <label><span>最大间隔</span><span className="number-field"><input type="number" min={routine.minIntervalMinutes} max={10080} value={routine.maxIntervalMinutes} onChange={(e) => onChange({ ...draft, trigger: { ...routine, maxIntervalMinutes: Number(e.target.value) } })}/><small>分钟</small></span></label>
        <fieldset className="weekday-field"><legend>生效星期</legend><div>{week.map((day) => <button type="button" key={day.value} aria-pressed={routine.weekdays.includes(day.value)} className={routine.weekdays.includes(day.value) ? "selected" : ""} onClick={() => onChange({ ...draft, trigger: { ...routine, weekdays: routine.weekdays.includes(day.value) ? routine.weekdays.filter((value) => value !== day.value) : [...routine.weekdays, day.value] } })}>{day.label}</button>)}</div></fieldset>
      </>}
      {event && <>
        <label><span>事件</span><select aria-label="事件类型" value={event.event} onChange={(e) => { const value = e.target.value as typeof event.event; onChange({ ...draft, trigger: { ...event, event: value, intent: value === "conversation_intent" ? (event.intent ?? "happy") : undefined } }); }}><option value="pet_click">点击桌宠</option><option value="conversation_intent">对话语义</option><option value="reminder">提醒到期</option></select></label>
        {event.event === "conversation_intent" && <label><span>语义意图</span><select value={event.intent ?? "happy"} onChange={(e) => onChange({ ...draft, trigger: { ...event, intent: e.target.value as ActionIntent } })}>{ACTION_INTENTS.map((intent) => <option key={intent} value={intent}>{intentLabels[intent]}</option>)}</select></label>}
        <label><span>冷却时间</span><span className="number-field"><input type="number" min={0} max={86400} value={event.cooldownSeconds} onChange={(e) => onChange({ ...draft, trigger: { ...event, cooldownSeconds: Number(e.target.value) } })}/><small>秒</small></span></label>
      </>}
      <label className="probability-field"><span>触发概率 <strong>{Math.round(draft.trigger.probability * 100)}%</strong></span><input type="range" min={0} max={1} step={0.05} value={draft.trigger.probability} onChange={(e) => onChange({ ...draft, trigger: { ...draft.trigger, probability: Number(e.target.value) } })}/></label>
    </div>
    <div className="rule-editor-actions"><button className="primary"><Save size={16}/>保存规则</button><Toggle label="启用规则" checked={draft.enabled} onChange={(enabled) => onChange({ ...draft, enabled })}/></div>
  </form>;
}

function describeRule(rule: ActionRule): string {
  if (rule.trigger.type === "routine") return `${rule.trigger.startTime}–${rule.trigger.endTime} · ${rule.trigger.minIntervalMinutes}–${rule.trigger.maxIntervalMinutes} 分钟 · ${Math.round(rule.trigger.probability * 100)}%`;
  const event = rule.trigger.event === "pet_click" ? "点击桌宠" : rule.trigger.event === "reminder" ? "提醒到期" : `对话：${intentLabels[rule.trigger.intent ?? "happy"]}`;
  return `${event} · 冷却 ${rule.trigger.cooldownSeconds} 秒 · ${Math.round(rule.trigger.probability * 100)}%`;
}

export function MotionSettings({ snapshot, setStatus }: { snapshot: AppSnapshot; setStatus: (value: string) => void }): React.JSX.Element {
  const [view, setView] = useState<MotionView>("library");
  const [catalog, setCatalog] = useState<MotionCatalog | null>(null);
  const [selectedId, setSelectedId] = useState("idle");
  const [draft, setDraft] = useState<DraftRule | null>(null);
  const activePet = snapshot.pets.find((pet) => pet.id === snapshot.activePetId) ?? snapshot.pets[0];
  const packSignature = snapshot.motionPacks.map((pack) => `${pack.packId}:${pack.version}:${pack.enabled}`).join("|");
  useEffect(() => { void window.everby.getMotionCatalog().then((value) => { setCatalog(value); if (!value.actions.some((action) => action.id === selectedId)) setSelectedId(value.actions[0]?.id ?? ""); }); }, [snapshot.activePetId, packSignature]);
  const actions = catalog?.actions ?? [];
  const selected = actions.find((action) => action.id === selectedId) ?? actions[0];
  const available = useMemo(() => new Set(actions.filter((action) => action.enabled !== false).map((action) => action.id)), [actions]);

  async function saveRule(): Promise<void> {
    if (!draft) return;
    try {
      const { id, ...input } = draft;
      if (id) await window.everby.updateActionRule(id, input); else await window.everby.createActionRule(input);
      setDraft(null); setStatus("动作规则已保存");
    } catch (error) { setStatus(error instanceof Error ? error.message : "动作规则保存失败"); }
  }

  async function importPack(): Promise<void> {
    try { const pack = await window.everby.importMotion(); if (pack) setStatus(`已导入 ${pack.name}`); }
    catch (error) { setStatus(error instanceof Error ? error.message : "动作扩展导入失败"); }
  }

  return <section className="motions-page">
    <header className="page-title"><h1>动作</h1><p>{activePet?.name} 的动作、触发规则和扩展包。</p></header>
    <div className="segmented" role="tablist" aria-label="动作设置视图">
      {([['library', '动作库'], ['rules', '触发规则'], ['packs', '扩展包']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? "active" : ""} onClick={() => { setView(id); setDraft(null); }}>{label}</button>)}
    </div>

    {view === "library" && <div className="motion-library">
      <div className="action-list" role="listbox" aria-label="可用动作">{actions.map((action) => <button key={action.id} role="option" aria-selected={selected?.id === action.id} className={selected?.id === action.id ? "active" : ""} onClick={() => setSelectedId(action.id)}><span><strong>{actionName(action)}</strong><small>{action.id}</small></span><em className={action.source === "extension" ? "extension" : "base"}>{action.source === "extension" ? action.packName : "基础"}</em></button>)}</div>
      {selected && <div className="action-inspector"><ActionPreview action={selected} sheetUrl={activePet?.sheetUrl ?? ""}/><div className="action-title"><div><strong>{actionName(selected)}</strong><span>{selected.id}</span></div><button className="primary icon-command" title="在桌面播放" aria-label={`播放 ${actionName(selected)}`} disabled={selected.enabled === false} onClick={() => void window.everby.previewAction(selected.id)}><Play size={18}/></button></div><dl><div><dt>来源</dt><dd>{selected.source === "extension" ? selected.packName : "基础动作"}</dd></div><div><dt>模式</dt><dd>{selected.loop ? "循环" : "单次"}</dd></div><div><dt>时长</dt><dd>{(actionDuration(selected) / 1000).toFixed(1)} 秒</dd></div><div><dt>语义</dt><dd>{selected.intents.map((intent) => intentLabels[intent]).join("、") || "无"}</dd></div></dl>{selected.enabled === false && <p className="motion-warning">扩展包已停用，启用后可播放。</p>}</div>}
    </div>}

    {view === "rules" && <>
      <div className="section-actions"><button className="primary" disabled={actions.length === 0} onClick={() => setDraft(newRoutine(actions.find((action) => action.enabled !== false)?.id ?? actions[0]?.id ?? "idle"))}><Plus size={17}/>新建规则</button></div>
      {draft && <RuleEditor draft={draft} actions={actions} onChange={setDraft} onSave={() => void saveRule()} onCancel={() => setDraft(null)}/>}
      <div className="rule-list">{snapshot.actionRules.length === 0 ? <div className="motion-empty"><Sparkles size={26}/><strong>还没有触发规则</strong></div> : snapshot.actionRules.map((rule) => <div className={`rule-row ${available.has(rule.actionId) ? "" : "unavailable"}`} key={rule.id}><div><strong>{rule.name}</strong><span>{actionName(actions.find((action) => action.id === rule.actionId) ?? { id: rule.actionId, loop: false, weight: 1, intents: [], frames: [] })} · {describeRule(rule)}</span>{!available.has(rule.actionId) && <small>动作不可用，规则不会执行</small>}</div><Toggle label={`启用 ${rule.name}`} checked={rule.enabled} onChange={(enabled) => void window.everby.updateActionRule(rule.id, { enabled })}/><button className="icon-button" title="复制" aria-label={`复制 ${rule.name}`} onClick={() => void window.everby.createActionRule({ name: `${rule.name} 副本`, actionId: rule.actionId, enabled: false, durationSeconds: rule.durationSeconds, trigger: rule.trigger })}><Copy size={16}/></button><button className="icon-button" title="编辑" aria-label={`编辑 ${rule.name}`} onClick={() => setDraft({ id: rule.id, name: rule.name, actionId: rule.actionId, enabled: rule.enabled, durationSeconds: rule.durationSeconds, trigger: rule.trigger })}><Pencil size={16}/></button><button className="icon-button danger" title="删除" aria-label={`删除 ${rule.name}`} onClick={() => void window.everby.deleteActionRule(rule.id)}><Trash2 size={16}/></button></div>)}</div>
    </>}

    {view === "packs" && <>
      <div className="section-actions"><button className="primary" onClick={() => void importPack()}><PackagePlus size={17}/>导入 .soulmotion</button></div>
      <div className="motion-pack-list">{snapshot.motionPacks.length === 0 ? <div className="motion-empty"><Sparkles size={26}/><strong>还没有扩展动作</strong></div> : snapshot.motionPacks.map((pack) => <div className="motion-pack" key={pack.packId}><div className="motion-pack-head"><div><strong>{pack.name}</strong><span>v{pack.version} · {pack.animationCount} 个动作</span></div><Toggle label={`启用 ${pack.name}`} checked={pack.enabled} onChange={(enabled) => void window.everby.setMotionEnabled(pack.packId, enabled)}/><button className="icon-button danger" title="卸载" aria-label={`卸载 ${pack.name}`} onClick={() => void window.everby.removeMotion(pack.packId)}><Trash2 size={17}/></button></div><div className="pack-actions">{actions.filter((action) => action.packId === pack.packId).map((action) => <button key={action.id} onClick={() => { setSelectedId(action.id); setView("library"); }}><span>{actionName(action)}</span><Play size={14}/></button>)}</div></div>)}</div>
    </>}
  </section>;
}
