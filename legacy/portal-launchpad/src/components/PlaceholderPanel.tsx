import { ReactNode } from "react";

interface PlaceholderPanelProps {
  title: string;
  description: string;
  children?: ReactNode;
}

export function PlaceholderPanel({
  title,
  description,
  children,
}: PlaceholderPanelProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-panel">
      <div className="mb-5 space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-sm leading-6 text-slate-600">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
