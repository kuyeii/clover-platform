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
        <p>当前统一前端只开放第 10-A 骨架路由。</p>
      </div>
      <button type="button" className="primary-action" onClick={() => navigate("/workspace")}>
        返回工作台
      </button>
    </section>
  );
}
