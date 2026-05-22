import { PlaceholderCard } from "../shared/components/PlaceholderCard";

export function LoginPage() {
  return (
    <section className="page-stack">
      <div className="page-heading">
        <span className="eyebrow">/login</span>
        <h1>统一登录页占位</h1>
        <p>
          第 10-B 将迁移 legacy Portal 登录能力。当前正式入口仍是
          <code>legacy/portal-launchpad</code>。
        </p>
      </div>

      <PlaceholderCard title="当前边界" eyebrow="第 10-A">
        <ul className="clean-list">
          <li>不实现真实登录。</li>
          <li>不接入 Portal session token 生命周期。</li>
          <li>不写长期 localStorage token。</li>
          <li>只保留后续登录迁移的页面落位。</li>
        </ul>
      </PlaceholderCard>
    </section>
  );
}
