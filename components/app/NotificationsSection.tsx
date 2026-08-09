'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';
import { BellRing, Check, ChevronsUpDown, Loader2 } from 'lucide-react';

import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { usePushRegistration } from '@/hooks/use-push-registration';
import { reminderMinuteOptions } from '@/lib/reminderSchedule';
import { getUserTimezone } from '@/lib/timezone';
import { cn } from '@/lib/utils';

/**
 * Daily reminder settings.
 *
 * Two things happen when the toggle goes on, in this order and for a reason:
 * the device registers for push (which must run inside the click gesture — iOS
 * will not show its permission prompt otherwise), and only then is the
 * preference saved. Saving first would leave a user with reminders "on" and no
 * device to deliver to, which looks like the feature is broken.
 */

/** Sensible default when a user enables reminders without picking a time. */
const DEFAULT_MINUTE_LOCAL = 9 * 60;

/** All IANA zones, or just the detected one where Intl cannot enumerate them. */
function supportedTimeZones(detected: string): string[] {
  const withValues = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  try {
    const zones = withValues.supportedValuesOf?.('timeZone');
    if (zones && zones.length > 0) return zones;
  } catch {
    // Fall through.
  }
  return [detected];
}

export function NotificationsSection() {
  const t = useTranslations('AppPage.settings.notifications');
  const locale = useLocale();

  const settings = useQuery(api.features.notifications.getReminderSettings);
  const updateSettings = useMutation(
    api.features.notifications.updateReminderSettings,
  );
  const sendTest = useMutation(api.features.notifications.sendTestNotification);

  const enabled = settings?.enabled === true;
  const { status, busy, subscribe, unsubscribe } = usePushRegistration(enabled);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [zonePickerOpen, setZonePickerOpen] = useState(false);

  const detectedZone = useMemo(() => getUserTimezone(), []);
  const activeZone = settings?.timeZone ?? detectedZone;
  const minuteLocal = settings?.minuteLocal ?? null;

  // Locale-aware 12h/24h formatting, driven off a fixed UTC instant so the
  // label depends only on the chosen minute-of-day.
  const formatMinute = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    });
    return (minute: number) =>
      formatter.format(
        new Date(Date.UTC(2000, 0, 1, Math.floor(minute / 60), minute % 60)),
      );
  }, [locale]);

  const timeOptions = useMemo(() => reminderMinuteOptions(), []);
  const zones = useMemo(() => supportedTimeZones(detectedZone), [detectedZone]);

  // Still loading, or unauthenticated (the query returns null) — render nothing
  // rather than a control whose state would flip under the user.
  if (settings === undefined || settings === null) return null;

  const selectedMinute = settings.minuteLocal ?? DEFAULT_MINUTE_LOCAL;

  const handleToggle = async (next: boolean) => {
    setSaving(true);
    try {
      if (next) {
        // Registration first: this call chain reaches
        // Notification.requestPermission() without an intervening await, which
        // is what keeps it inside the user gesture on iOS.
        const registered = await subscribe();
        if (!registered) {
          toast.error(
            status === 'denied' ? t('deniedToast') : t('permissionFailed'),
          );
          return;
        }
        await updateSettings({
          enabled: true,
          minuteLocal: selectedMinute,
          timeZone: activeZone,
          locale,
        });
        toast.success(t('enabledToast'));
        return;
      }

      await updateSettings({ enabled: false });
      await unsubscribe();
      toast.success(t('disabledToast'));
    } catch (error) {
      console.error('[notifications] toggle failed', error);
      toast.error(t('error'));
    } finally {
      setSaving(false);
    }
  };

  const handleMinuteChange = async (value: string) => {
    setSaving(true);
    try {
      await updateSettings({ minuteLocal: Number(value) });
      toast.success(t('savedToast'));
    } catch (error) {
      console.error('[notifications] time change failed', error);
      toast.error(t('error'));
    } finally {
      setSaving(false);
    }
  };

  const handleZoneChange = async (zone: string) => {
    setZonePickerOpen(false);
    if (zone === activeZone) return;
    setSaving(true);
    try {
      await updateSettings({ timeZone: zone });
      toast.success(t('savedToast'));
    } catch (error) {
      console.error('[notifications] timezone change failed', error);
      toast.error(t('error'));
    } finally {
      setSaving(false);
    }
  };

  const handleSendTest = async () => {
    setTesting(true);
    try {
      await sendTest({});
      toast.success(t('testSentToast'));
    } catch (error) {
      console.error('[notifications] test send failed', error);
      toast.error(t('error'));
    } finally {
      setTesting(false);
    }
  };

  const pending = saving || busy;

  return (
    <div className="space-y-4">
      <label className="label-form">{t('label')}</label>

      {status === 'unsupported' ? (
        // Covers iOS Safari in a tab, where the Push API is only exposed to a
        // home-screen web app, as well as older desktop browsers.
        <p className="text-sm text-muted-foreground">{t('unsupported')}</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="daily-reminder" className="text-sm font-medium">
                {t('toggleLabel')}
              </Label>
              <p className="text-muted-xs">{t('description')}</p>
            </div>
            <Switch
              id="daily-reminder"
              checked={enabled}
              disabled={pending}
              onCheckedChange={(next) => void handleToggle(next)}
              data-testid="settings-notifications-toggle"
            />
          </div>

          {status === 'denied' && !enabled && (
            <p className="text-sm text-muted-foreground">{t('denied')}</p>
          )}

          {enabled && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reminder-time" className="text-sm font-medium">
                  {t('timeLabel')}
                </Label>
                <Select
                  value={String(selectedMinute)}
                  disabled={pending}
                  onValueChange={(value) => void handleMinuteChange(value)}
                >
                  <SelectTrigger
                    id="reminder-time"
                    className="w-full sm:w-40"
                    data-testid="settings-notifications-time"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {timeOptions.map((minute) => (
                      <SelectItem key={minute} value={String(minute)}>
                        {formatMinute(minute)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {minuteLocal === null && (
                  <p className="text-muted-xs">{t('timeHint')}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  {t('timezoneLabel')}
                </Label>
                <Popover open={zonePickerOpen} onOpenChange={setZonePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={zonePickerOpen}
                      disabled={pending}
                      className="w-full justify-between sm:w-72"
                      data-testid="settings-notifications-timezone"
                    >
                      <span className="truncate">{activeZone}</span>
                      <ChevronsUpDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[min(18rem,90vw)] p-0"
                    align="start"
                  >
                    <Command>
                      <CommandInput placeholder={t('timezoneSearch')} />
                      <CommandList>
                        <CommandEmpty>{t('timezoneEmpty')}</CommandEmpty>
                        <CommandGroup>
                          {zones.map((zone) => (
                            <CommandItem
                              key={zone}
                              value={zone}
                              onSelect={() => void handleZoneChange(zone)}
                            >
                              <Check
                                className={cn(
                                  'h-4 w-4',
                                  zone === activeZone
                                    ? 'opacity-100'
                                    : 'opacity-0',
                                )}
                              />
                              {zone}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <p className="text-muted-xs">
                  {t('timezoneHint', { zone: detectedZone })}
                </p>
              </div>

              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => void handleSendTest()}
                disabled={pending || testing || settings.deviceCount === 0}
                data-testid="settings-notifications-test"
              >
                {testing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <BellRing className="h-4 w-4" />
                )}
                {t('sendTest')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
