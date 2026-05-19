"use client";

import { CalendarCheckIcon, CalendarIcon, ClockIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { parseFromMode, serializeToMode, toCalendarDate } from "@/lib/date-picker-adapter";
import type { DateRange, TimeOverride } from "@/lib/date-picker-adapter";
import { formatDateForDisplay } from "@/lib/utils/datetime";
import { Button } from "@/modules/ui/components/button";
import { Calendar } from "@/modules/ui/components/calendar";
import { Input } from "@/modules/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/ui/components/popover";

const DEFAULT_LOCALE = "en-US";

// Single mode — backwards compatible, no `mode` prop required
export interface SingleDatePickerProps {
  mode?: "single";
  date?: Date | null;
  updateSurveyDate?: (date: Date) => void;
  minDate?: Date;
  maxDate?: Date;
  onClearDate?: () => void;
  clearButtonId?: string;
  clearButtonLabel?: string;
  locale?: string;
  disabled?: boolean;
}

// Contact ISO mode — single date serialized as ISO string
export interface ContactIsoDatePickerProps {
  mode: "contact-iso";
  value?: string | null;
  onChange: (value: string) => void;
  minDate?: Date;
  maxDate?: Date;
  onClearDate?: () => void;
  disabled?: boolean;
}

// Range mode — for contacts/segments
export interface RangeDatePickerProps {
  mode: "range" | "segment-range";
  value?: [string, string] | null;
  onChange: (value: [string, string]) => void;
  minDate?: Date;
  maxDate?: Date;
  onClearDate?: () => void;
  disabled?: boolean;
}

// Analysis mode — for CustomFilter, with optional time override
export interface AnalysisDatePickerProps {
  mode: "analysis";
  value?: DateRange;
  onChange: (value: DateRange) => void;
  minDate?: Date;
  maxDate?: Date;
  onClearDate?: () => void;
  disabled?: boolean;
}

export type DatePickerProps =
  | SingleDatePickerProps
  | ContactIsoDatePickerProps
  | RangeDatePickerProps
  | AnalysisDatePickerProps;

const getDefaultMinDate = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
};

export const DatePicker = (props: DatePickerProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const mode = props.mode || "single";
  const disabled = props.disabled || false;
  const minDate = props.minDate;
  const maxDate = props.maxDate;
  const onClearDate = props.onClearDate;

  // Mode-specific values extracted to simple variables for clean hook dependencies
  const singleProps = mode === "single" ? (props as SingleDatePickerProps) : null;
  const contactIsoProps = mode === "contact-iso" ? (props as ContactIsoDatePickerProps) : null;
  const rangeProps = mode === "range" || mode === "segment-range" ? (props as RangeDatePickerProps) : null;
  const analysisProps = mode === "analysis" ? (props as AnalysisDatePickerProps) : null;

  const singleDate = singleProps?.date;
  const locale = singleProps?.locale || DEFAULT_LOCALE;
  const clearButtonId = singleProps?.clearButtonId;
  const clearButtonLabel = singleProps?.clearButtonLabel;
  const updateSurveyDate = singleProps?.updateSurveyDate;

  const contactIsoValue = contactIsoProps?.value;
  const onContactIsoChange = contactIsoProps?.onChange;

  const rangeValue = rangeProps?.value;
  const onRangeChange = rangeProps?.onChange;

  const analysisValue = analysisProps?.value;
  const onAnalysisChange = analysisProps?.onChange;

  // Effective minDate for legacy single mode if minDate omitted
  const effectiveMinDate = minDate ?? (mode === "single" ? getDefaultMinDate() : undefined);

  // Time overrides for analysis mode
  const [timeOverrides, setTimeOverrides] = useState<TimeOverride>({
    fromHour: 0,
    fromMinute: 0,
    toHour: 23,
    toMinute: 59,
  });

  // Sync initial time overrides when analysis value changes
  useEffect(() => {
    if (mode === "analysis" && analysisValue) {
      if (analysisValue.from && analysisValue.to) {
        setTimeOverrides({
          fromHour: analysisValue.from.getUTCHours(),
          fromMinute: analysisValue.from.getUTCMinutes(),
          toHour: analysisValue.to.getUTCHours(),
          toMinute: analysisValue.to.getUTCMinutes(),
        });
      }
    }
  }, [mode, analysisValue]);

  // Compute disabled matcher array for react-day-picker
  const disabledDays = [
    effectiveMinDate ? { before: effectiveMinDate } : false,
    maxDate ? { after: maxDate } : false,
  ].filter(Boolean) as any;

  // Internal selection state for range modes while picking
  const [internalRange, setInternalRange] = useState<DateRange | undefined>(undefined);

  // Sync internal range with props
  useEffect(() => {
    if (mode === "range" || mode === "segment-range") {
      const parsed = parseFromMode("segment-range", rangeValue || ["", ""]);
      if (parsed.from && parsed.to) {
        setInternalRange({
          from: new Date(parsed.from.year, parsed.from.month - 1, parsed.from.day),
          to: new Date(parsed.to.year, parsed.to.month - 1, parsed.to.day),
        });
      } else {
        setInternalRange(undefined);
      }
    } else if (mode === "analysis") {
      setInternalRange(analysisValue);
    }
  }, [mode, rangeValue, analysisValue]);

  // Handle clear
  const handleClear = () => {
    if (onClearDate) {
      onClearDate();
    }
    setInternalRange(undefined);
  };

  // Compute display text
  let displayText: string | undefined = undefined;

  if (mode === "single") {
    if (singleDate) {
      displayText = formatDateForDisplay(singleDate, locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    }
  } else if (mode === "contact-iso") {
    const parsed = parseFromMode("contact-iso", contactIsoValue || "");
    if (parsed.from) {
      const displayObj = new Date(parsed.from.year, parsed.from.month - 1, parsed.from.day);
      displayText = formatDateForDisplay(displayObj, locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    }
  } else if (mode === "range" || mode === "segment-range") {
    const parsed = parseFromMode("segment-range", rangeValue || ["", ""]);
    if (parsed.from && parsed.to) {
      const fromObj = new Date(parsed.from.year, parsed.from.month - 1, parsed.from.day);
      const toObj = new Date(parsed.to.year, parsed.to.month - 1, parsed.to.day);
      displayText = `${formatDateForDisplay(fromObj, locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })} - ${formatDateForDisplay(toObj, locale, {
        day: "numeric",
        month: "short",
      })}`;
    }
  } else if (mode === "analysis") {
    if (analysisValue?.from && analysisValue?.to) {
      displayText = `${formatDateForDisplay(analysisValue.from, locale, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })} - ${formatDateForDisplay(analysisValue.to, locale, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }
  }

  // Handle Calendar Select
  const handleSingleSelect = useCallback(
    (selectedDay: Date | undefined) => {
      if (!selectedDay) return;
      if (mode === "single") {
        if (updateSurveyDate) {
          updateSurveyDate(selectedDay);
        }
      } else if (mode === "contact-iso") {
        const cd = toCalendarDate(selectedDay);
        const iso = serializeToMode("contact-iso", cd);
        if (onContactIsoChange) {
          onContactIsoChange(iso);
        }
      }
      setIsOpen(false);
    },
    [mode, updateSurveyDate, onContactIsoChange]
  );

  const handleRangeSelect = useCallback(
    (newRange: DateRange | undefined) => {
      setInternalRange(newRange);
      if (newRange?.from && newRange?.to) {
        const fromCd = toCalendarDate(newRange.from);
        const toCd = toCalendarDate(newRange.to);

        if (mode === "range" || mode === "segment-range") {
          if (onRangeChange) {
            const res = serializeToMode("segment-range", fromCd, toCd);
            onRangeChange(res);
          }
          setIsOpen(false);
        } else if (mode === "analysis") {
          if (onAnalysisChange) {
            const res = serializeToMode("analysis", fromCd, toCd, timeOverrides);
            onAnalysisChange(res);
          }
        }
      }
    },
    [mode, onRangeChange, onAnalysisChange, timeOverrides]
  );

  const handleTimeChange = useCallback(
    (timeStr: string, isFrom: boolean) => {
      const [h, m] = timeStr.split(":").map((v) => Number.parseInt(v, 10));
      if (Number.isNaN(h) || Number.isNaN(m)) return;

      const nextOverrides = {
        ...timeOverrides,
        [isFrom ? "fromHour" : "toHour"]: h,
        [isFrom ? "fromMinute" : "toMinute"]: m,
      };
      setTimeOverrides(nextOverrides);

      if (mode === "analysis" && internalRange?.from && internalRange?.to && onAnalysisChange) {
        const fromCd = toCalendarDate(internalRange.from);
        const toCd = toCalendarDate(internalRange.to);
        const res = serializeToMode("analysis", fromCd, toCd, nextOverrides);
        onAnalysisChange(res);
      }
    },
    [mode, internalRange, timeOverrides, onAnalysisChange]
  );

  // Time input strings
  const formatTimeInput = (h: number, m: number) =>
    `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;

  return (
    <div className="flex items-center gap-2">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          {displayText ? (
            <Button
              variant="ghost"
              disabled={disabled}
              className={cn(
                "w-[280px] justify-start border border-slate-300 bg-white text-left font-normal",
                !displayText && "text-muted-foreground bg-slate-800"
              )}
              ref={btnRef}>
              <CalendarCheckIcon className="mr-2 h-4 w-4" />
              <span>{displayText}</span>
            </Button>
          ) : (
            <Button
              variant="ghost"
              disabled={disabled}
              className={cn(
                "text-muted-foreground w-[280px] justify-start border border-slate-300 bg-white text-left font-normal"
              )}
              onClick={() => setIsOpen(true)}
              ref={btnRef}>
              <CalendarIcon className="mr-2 h-4 w-4" />
              <span>{t("common.pick_a_date")}</span>
            </Button>
          )}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-auto rounded-lg border border-slate-200 bg-white p-3 shadow-md">
          {mode === "single" || mode === "contact-iso" ? (
            <Calendar
              mode="single"
              required
              selected={
                mode === "single"
                  ? singleDate || undefined
                  : contactIsoValue
                    ? (() => {
                        const parsed = parseFromMode("contact-iso", contactIsoValue || "");
                        return parsed.from
                          ? new Date(parsed.from.year, parsed.from.month - 1, parsed.from.day)
                          : undefined;
                      })()
                    : undefined
              }
              onSelect={handleSingleSelect}
              disabled={disabledDays}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <Calendar
                mode="range"
                selected={internalRange}
                onSelect={handleRangeSelect}
                disabled={disabledDays}
                numberOfMonths={mode === "analysis" ? 2 : 1}
              />
              {mode === "analysis" && internalRange?.from && internalRange?.to && (
                <div className="mt-2 flex items-center justify-between gap-4 border-t border-slate-200 px-2 pt-3">
                  <div className="flex items-center gap-2">
                    <ClockIcon className="h-4 w-4 text-slate-500" />
                    <span className="text-sm font-medium text-slate-700">
                      {t("common.start_time", "Start Time")}:
                    </span>
                    <Input
                      type="time"
                      className="h-8 w-28 bg-white"
                      value={formatTimeInput(timeOverrides.fromHour ?? 0, timeOverrides.fromMinute ?? 0)}
                      onChange={(e) => handleTimeChange(e.target.value, true)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <ClockIcon className="h-4 w-4 text-slate-500" />
                    <span className="text-sm font-medium text-slate-700">
                      {t("common.end_time", "End Time")}:
                    </span>
                    <Input
                      type="time"
                      className="h-8 w-28 bg-white"
                      value={formatTimeInput(timeOverrides.toHour ?? 23, timeOverrides.toMinute ?? 59)}
                      onChange={(e) => handleTimeChange(e.target.value, false)}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
      {displayText && onClearDate && (
        <Button
          aria-label={clearButtonLabel}
          data-testid={clearButtonId}
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={handleClear}
          className="h-8 w-8 p-0 hover:bg-slate-200">
          <XIcon className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
};

export const UnifiedDatePicker = DatePicker;
