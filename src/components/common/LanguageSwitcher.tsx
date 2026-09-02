import React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { updateMyProfile } from '@/services/api';
import { SUPPORTED_LANGUAGES } from '@/types/types';

interface LanguageSwitcherProps {
  compact?: boolean;
}

export function LanguageSwitcher({ compact = false }: LanguageSwitcherProps) {
  const { lang, setLang } = useLanguage();
  const { homatchUser } = useAuth();
  const current = SUPPORTED_LANGUAGES.find(l => l.code === lang);

  const handleSelect = (code: typeof lang) => {
    setLang(code);
    // Best-effort persistence to the account so the choice follows the user
    // to a new device/session. Never blocks the instant UI language switch,
    // and never overwrites anything if it fails.
    if (homatchUser?.id && homatchUser.preferred_language !== code) {
      void updateMyProfile(homatchUser.id, { preferred_language: code });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground h-8 px-2 font-medium text-xs"
        >
          <span className="uppercase tracking-wide">{lang}</span>
          {!compact && <ChevronDown className="h-3 w-3 opacity-60" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px] bg-card border-border z-[60]">
        {SUPPORTED_LANGUAGES.map(l => (
          <DropdownMenuItem
            key={l.code}
            onClick={() => handleSelect(l.code)}
            className={`flex items-center justify-between cursor-pointer text-sm ${
              l.code === lang ? 'text-primary font-medium' : 'text-foreground'
            }`}
          >
            <span>{l.nativeLabel}</span>
            <span className="text-xs text-muted-foreground uppercase ml-3">{l.code}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
