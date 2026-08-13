import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

export function StaggerList({ children, delay = 0 }: { children: ReactNode[]; delay?: number }) {
  return (
    <>
      {Array.isArray(children)
        ? children.map((child, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: delay + i * 0.06, ease: [0.4, 0, 0.2, 1] }}
            >
              {child}
            </motion.div>
          ))
        : children}
    </>
  );
}
