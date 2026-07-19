/**
 * Shared scroll-into-view animation preset for landing-page sections.
 * Spread onto a `motion.*` element; override `transition` inline where a
 * section needs a stagger delay.
 */
export const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.6, ease: 'easeOut' as const },
};
