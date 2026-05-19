import { AnimatePresence, motion } from "framer-motion";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { ToolkitApp } from "../types/app";

interface EmbeddedAppViewportProps {
  app: ToolkitApp;
  isVisible: boolean;
}

export function EmbeddedAppViewport({ app, isVisible }: EmbeddedAppViewportProps) {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setIsLoaded(false);
  }, [app.id]);

  return (
    <section
      aria-hidden={!isVisible}
      className={[
        "absolute inset-0 flex min-h-0 flex-1 flex-col bg-slate-100 transition-opacity duration-200",
        isVisible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
      ].join(" ")}
    >
      <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white">
        <iframe
          key={app.id}
          title={`${app.name} 内嵌应用`}
          src={app.url}
          onLoad={() => setIsLoaded(true)}
          allow="clipboard-read; clipboard-write; fullscreen"
          className="block h-full min-h-0 w-full flex-1 border-0 bg-white"
        />

        <AnimatePresence>
          {!isLoaded ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 flex items-center justify-center bg-white/92 px-4"
            >
              <div className="flex max-w-md flex-col items-center gap-4 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                  <LoaderCircle className="h-7 w-7 animate-spin" />
                </div>
                <div className="space-y-2">
                  <p className="text-lg font-semibold text-slate-900">
                    正在进入 {app.name}
                  </p>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </section>
  );
}
