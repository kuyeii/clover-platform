import { motion } from "framer-motion";
import { ToolkitApp } from "../types/app";
import { AppCard } from "./AppCard";

interface CloverLauncherProps {
  apps: ToolkitApp[];
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

export function CloverLauncher({ apps }: CloverLauncherProps) {
  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-auto bg-white px-5 pb-8 pt-4 md:overflow-hidden md:px-8 md:pb-16 md:pt-4 lg:px-12 lg:pb-12 lg:pt-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-slate-100/50 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-sky-50/50 to-transparent" />

      <div className="relative mx-auto grid w-full max-w-8xl flex-1 grid-cols-1 gap-3 md:grid-cols-2 md:grid-rows-2 md:gap-4">
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
            <AppCard app={app} />
          </motion.div>
        ))}
      </div>
    </section>
  );
}
