import { ReactNode } from "react";

type PlaceholderCardProps = {
  title: string;
  eyebrow?: string;
  children: ReactNode;
};

export function PlaceholderCard({ title, eyebrow, children }: PlaceholderCardProps) {
  return (
    <article className="placeholder-card">
      {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
      <h2>{title}</h2>
      <div className="placeholder-body">{children}</div>
    </article>
  );
}
