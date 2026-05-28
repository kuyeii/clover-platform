import { motion } from "framer-motion";
import type { NavigateFn } from "../routes";
import type { ToolkitApp } from "../shared/types/app";
import { AppCard } from "./AppCard";

interface CloverLauncherProps {
  apps: ToolkitApp[];
  navigate: NavigateFn;
}

const cardVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.985 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.32,
      delay: index * 0.05,
      ease: [0.22, 1, 0.36, 1],
    },
  }),
  hover: {
    scale: 1.012,
    transition: {
      duration: 0.18,
      ease: [0.22, 1, 0.36, 1],
    },
  },
};

export function CloverLauncher({ apps, navigate }: CloverLauncherProps) {
  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-auto bg-mist px-5 pb-10 pt-6 md:overflow-hidden md:px-8 md:pb-14 md:pt-7 lg:px-12 lg:pb-16 lg:pt-8">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-surface-soft to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-brand-50/44 to-transparent" />

      <div className="relative grid w-full flex-1 grid-cols-1 gap-5 md:grid-cols-2 md:grid-rows-2 md:gap-6 lg:gap-8">
        {apps.map((app, index) => (
          <motion.div
            key={app.id}
            custom={index}
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            whileHover="hover"
            className="h-full min-h-0"
          >
            <AppCard app={app} navigate={navigate} />
          </motion.div>
        ))}
      </div>
    </section>
  );
}
