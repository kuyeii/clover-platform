type BrandMarkProps = {
  compact?: boolean;
};

const logoIcon = "/logo/logo-icon.svg";
const logoText = "/logo/logo-text.svg";

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2 sm:gap-3" aria-label="企智方">
      <span className={["grid shrink-0 place-items-center overflow-hidden rounded-lg", compact ? "h-9 w-9 sm:h-10 sm:w-10" : "h-10 w-10"].join(" ")}>
        <img src={logoIcon} alt="" className="h-full w-full object-contain" aria-hidden="true" />
      </span>
      <span className={["hidden min-w-0 shrink overflow-hidden min-[520px]:block", compact ? "h-10 w-32 sm:w-36" : "h-12 w-36"].join(" ")}>
        <img src={logoText} alt="企智方" className="h-full w-full object-contain object-left" />
      </span>
    </span>
  );
}
