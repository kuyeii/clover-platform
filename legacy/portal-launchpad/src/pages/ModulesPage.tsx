import { appsConfig } from "../config/apps.config";
import { AppStatusBadge } from "../components/AppStatusBadge";
import { HealthIndicator } from "../components/HealthIndicator";

export function ModulesPage() {
  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-panel">
        <div className="space-y-3">
          <h2 className="text-3xl font-semibold text-slate-950">模块总览</h2>
          <p className="text-sm leading-7 text-slate-600">
            当前模块仍独立运行，门户只展示入口、状态、健康信息、仓库名和健康检查地址。
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-panel">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left">
            <thead className="bg-slate-50">
              <tr>
                {["模块", "描述", "状态", "健康", "入口地址", "健康地址", "仓库"].map((label) => (
                  <th
                    key={label}
                    className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {appsConfig.map((app) => (
                <tr key={app.id} className="align-top">
                  <td className="px-4 py-4">
                    <div className="space-y-1">
                      <p className="font-semibold text-slate-900">{app.name}</p>
                      <p className="text-xs text-slate-500">{app.shortName}</p>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-sm leading-6 text-slate-600">
                    {app.description}
                  </td>
                  <td className="px-4 py-4">
                    <AppStatusBadge status={app.status} />
                  </td>
                  <td className="px-4 py-4">
                    <HealthIndicator healthStatus={app.healthStatus} />
                  </td>
                  <td className="px-4 py-4 text-sm text-slate-700">{app.url}</td>
                  <td className="px-4 py-4 text-sm text-slate-700">{app.healthUrl}</td>
                  <td className="px-4 py-4 text-sm font-medium text-slate-700">
                    {app.moduleRepo}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
