import React from "react";

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }): React.JSX.Element {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}><span/></button>;
}

export function PageTitle({ title, description }: { title: string; description: string }): React.JSX.Element {
  return <header className="page-title"><h1>{title}</h1><p>{description}</p></header>;
}
