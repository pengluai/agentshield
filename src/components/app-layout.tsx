import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { AppSidebar } from './app-sidebar';
import { useAppStore } from '@/stores/appStore';
import type { ReactNode } from 'react';

interface AppLayoutProps {
  children: ReactNode;
  className?: string;
}

export function AppLayout({ children, className }: AppLayoutProps) {
  const { isExpanded } = useAppStore();

  return (
    <div className={cn('h-full min-h-0 bg-transparent', className)}>
      {/* Sidebar */}
      <AppSidebar />

      {/* Main Content */}
      <motion.main
        initial={false}
        animate={{
          marginLeft: isExpanded ? 240 : 72,
        }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
        className="h-full min-h-0"
      >
        {children}
      </motion.main>
    </div>
  );
}

// Page wrapper with gradient background
interface GradientPageProps {
  children: ReactNode;
  gradient: {
    from: string;
    via?: string;
    to: string;
  };
  className?: string;
}

export function GradientPage({ children, gradient, className }: GradientPageProps) {
  return (
    <div
      className={cn('min-h-screen relative', className)}
      style={{
        background: gradient.via
          ? `linear-gradient(135deg, ${gradient.from} 0%, ${gradient.via} 45%, ${gradient.to} 100%)`
          : `linear-gradient(135deg, ${gradient.from} 0%, ${gradient.to} 100%)`,
      }}
    >
      {children}
    </div>
  );
}
