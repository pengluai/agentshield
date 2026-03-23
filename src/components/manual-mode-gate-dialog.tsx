import { AlertTriangle, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isEnglishLocale } from '@/constants/i18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ManualModeGateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  impacts: string[];
  manualLabel: string;
  onManual: () => void;
  onUpgrade: () => void;
  upgradeLabel?: string;
}

export function ManualModeGateDialog({
  open,
  onOpenChange,
  title,
  description,
  impacts,
  manualLabel,
  onManual,
  onUpgrade,
  upgradeLabel = isEnglishLocale ? '⚡ Upgrade Pro' : '⚡ 升级 Pro',
}: ManualModeGateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl border-amber-200/30 bg-slate-950 text-slate-100">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2 text-amber-200">
            <AlertTriangle className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-slate-300">{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
          {impacts.map((impact) => (
            <p key={impact} className="leading-6">
              {impact}
            </p>
          ))}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            className="border-white/20 bg-white/5 text-slate-200 hover:bg-white/10"
            onClick={() => {
              onOpenChange(false);
              onManual();
            }}
          >
            {manualLabel}
          </Button>
          <Button
            className="bg-amber-400 text-slate-950 hover:bg-amber-300"
            onClick={() => {
              onOpenChange(false);
              onUpgrade();
            }}
          >
            <Crown className="h-4 w-4" />
            {upgradeLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
