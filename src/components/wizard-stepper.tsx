import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface Step {
  id: string;
  label: string;
}

interface WizardStepperProps {
  steps: Step[];
  currentStep: number;
  accentColor?: string;
  className?: string;
}

export function WizardStepper({
  steps,
  currentStep,
  accentColor = '#14B8A6',
  className,
}: WizardStepperProps) {
  return (
    <div className={cn('flex items-center justify-center', className)}>
      {steps.map((step, index) => {
        const isCompleted = index < currentStep;
        const isActive = index === currentStep;
        const isPending = index > currentStep;

        return (
          <div key={step.id} className="flex items-center">
            {/* Step indicator */}
            <div className="flex flex-col items-center">
              <motion.div
                initial={false}
                animate={{
                  scale: isActive ? 1.1 : 1,
                  boxShadow: isActive ? `0 0 20px ${accentColor}60` : 'none',
                }}
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center',
                  'transition-colors duration-300',
                  isCompleted && 'bg-white/20',
                  isActive && 'border-2',
                  isPending && 'border-2 border-white/20'
                )}
                style={{
                  backgroundColor: isCompleted
                    ? `${accentColor}40`
                    : isActive
                      ? accentColor
                      : 'transparent',
                  borderColor: isActive ? accentColor : undefined,
                }}
              >
                {isCompleted ? (
                  <Check className="w-4 h-4 text-white" />
                ) : (
                  <span
                    className={cn(
                      'text-sm font-medium',
                      isActive ? 'text-white' : 'text-white/40'
                    )}
                  >
                    {index + 1}
                  </span>
                )}
              </motion.div>

              {/* Step label */}
              <span
                className={cn(
                  'mt-2 text-xs font-medium whitespace-nowrap',
                  isActive ? 'text-white' : 'text-white/50'
                )}
              >
                {step.label}
              </span>
            </div>

            {/* Connecting line */}
            {index < steps.length - 1 && (
              <div
                className={cn(
                  'w-12 h-0.5 mx-2 mb-6',
                  isCompleted ? 'bg-white/30' : 'bg-white/10'
                )}
                style={{
                  backgroundColor: isCompleted ? `${accentColor}60` : undefined,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
