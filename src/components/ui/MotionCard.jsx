import { motion } from 'framer-motion'

const fadeEnter = {

  initial: { opacity: 0, y: 6 },

  animate: { opacity: 1, y: 0 },

  transition: { duration: 0.15, ease: [0.4, 0, 0.2, 1] },

}

/** @param {{ children?: import('react').ReactNode, className?: string }} props */

export function MotionCard({ children, className = '' }) {
  return (
    <motion.div {...fadeEnter} className={className}>

      {children}

    </motion.div>

  )

}
