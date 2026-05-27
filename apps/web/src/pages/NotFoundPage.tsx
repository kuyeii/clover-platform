import type { NavigateFn } from "../routes";

type NotFoundPageProps = {
  navigate: NavigateFn;
};

export function NotFoundPage({ navigate }: NotFoundPageProps) {
  return (
    <section className="page-stack">
      <div className="page-heading">
        <span className="eyebrow">404</span>
        <h1>页面不存在</h1>
        <p>未找到对应页面，请返回工作台重新选择。</p>
      </div>
      <button type="button" className="primary-action" onClick={() => navigate("/workspace")}>
        返回工作台
      </button>
    </section>
  );
}
