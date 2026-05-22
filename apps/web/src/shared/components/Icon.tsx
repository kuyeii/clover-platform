type IconName =
  | "arrow"
  | "back"
  | "building"
  | "chart"
  | "check"
  | "close"
  | "download"
  | "file"
  | "grid"
  | "key"
  | "lock"
  | "logout"
  | "message"
  | "plus"
  | "refresh"
  | "save"
  | "search"
  | "send"
  | "shield"
  | "spark"
  | "upload"
  | "user"
  | "users";

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  } as const;

  const paths: Record<IconName, JSX.Element> = {
    arrow: (
      <>
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </>
    ),
    back: <path d="M15 18 9 12l6-6" />,
    building: (
      <>
        <path d="M5 20V5.8C5 4.8 5.8 4 6.8 4h10.4c1 0 1.8.8 1.8 1.8V20" />
        <path d="M8.5 8h2M13.5 8h2M8.5 12h2M13.5 12h2M8.5 16h2M13.5 16h2" />
      </>
    ),
    chart: (
      <>
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="m7 15 3-3 3 2 5-7" />
      </>
    ),
    check: <path d="M20 6 9 17l-5-5" />,
    close: (
      <>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </>
    ),
    download: (
      <>
        <path d="M12 4v10" />
        <path d="m8 10 4 4 4-4" />
        <path d="M5 20h14" />
      </>
    ),
    file: (
      <>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
      </>
    ),
    grid: (
      <>
        <path d="M4 4h7v7H4z" />
        <path d="M13 4h7v7h-7z" />
        <path d="M4 13h7v7H4z" />
        <path d="M13 13h7v7h-7z" />
      </>
    ),
    key: (
      <>
        <circle cx="7.5" cy="15.5" r="3.5" />
        <path d="m10 13 8-8" />
        <path d="m15 5 2 2" />
        <path d="m13 7 2 2" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    logout: (
      <>
        <path d="M10 17 15 12 10 7" />
        <path d="M15 12H3" />
        <path d="M21 4v16" />
      </>
    ),
    message: (
      <>
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 12a8 8 0 0 1-14.9 4" />
        <path d="M4 12A8 8 0 0 1 18.9 8" />
        <path d="M18 3v5h-5" />
        <path d="M6 21v-5h5" />
      </>
    ),
    save: (
      <>
        <path d="M5 5a2 2 0 0 1 2-2h10l2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
        <path d="M8 3v6h8" />
        <path d="M8 21v-6h8v6" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    send: (
      <>
        <path d="m22 2-7 20-4-9-9-4z" />
        <path d="M22 2 11 13" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z" />
        <path d="m9 12 2 2 4-5" />
      </>
    ),
    spark: (
      <>
        <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6L12 3Z" />
        <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M5 20h14" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 20c1.4-4 4-6 7.5-6s6.1 2 7.5 6" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M2.5 20c1.2-3.2 3.4-5 6.5-5s5.3 1.8 6.5 5" />
        <path d="M16 5.5a3 3 0 0 1 0 5" />
        <path d="M18 15c1.6.7 2.8 2.2 3.5 5" />
      </>
    ),
  };

  return (
    <svg className={`ui-icon ${className}`.trim()} {...common}>
      {paths[name]}
    </svg>
  );
}
