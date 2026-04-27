"use client";

import { Calendar as CalendarIcon, Clock, X } from "lucide-react";
import React, { useMemo } from "react";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/cn";
import { DatePickerMode, adaptToMode, normalizeRange, parseUnknown } from "@/lib/date-picker-adapter";
import { Button } from "@/modules/ui/components/button";
import { Calendar } from "@/modules/ui/components/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/ui/components/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/ui/components/select";

interface UnifiedDatePickerProps {
  value: any;
  onChange: (value: any) => void;
  mode: DatePickerMode;
  includeTime?: boolean;
  placeholder?: string;
  className?: string;
  disabled?: any;
}

export const UnifiedDatePicker = ({
  value,
  onChange,
  mode,
  includeTime = false,
  placeholder = "Pick a date",
  className,
  disabled,
}: UnifiedDatePickerProps) => {
  // 1. Current value from parent
  const parsedValue = useMemo(() => parseUnknown(value), [value]);

  // 2. Local state for "In-Progress" selections to avoid emitting partials
  const [localSelection, setLocalSelection] = React.useState<Date | DateRange | null>(null);

  // Sync local state when external value changes
  React.useEffect(() => {
    setLocalSelection(parsedValue);
  }, [parsedValue]);

  const internalValue = localSelection;

  // 2. Derive selection for react-day-picker
  const selectionMode =
    mode === "analysis" || mode === "segment-range" || mode === "survey-legacy" ? "range" : "single";

  const handleSelect = (selected: any) => {
    setLocalSelection(selected);

    if (!selected) {
      onChange(adaptToMode(mode, null));
      return;
    }

    // 3. Normalize selection
    const normalized = normalizeRange(selected, includeTime);
    if (!normalized) return;

    // 4. Guard: Don't emit partial ranges for strict modes
    if ((mode === "segment-range" || mode === "survey-legacy") && normalized.from && !normalized.to) {
      return;
    }

    // 5. Adapt back to legacy format
    onChange(adaptToMode(mode, normalized));
  };

  const handleTimeChange = (type: "from" | "to", part: "hour" | "minute", val: string) => {
    if (!internalValue) return;

    const from = internalValue instanceof Date ? internalValue : internalValue.from;
    const to = internalValue instanceof Date ? undefined : internalValue.to;

    const targetDate = type === "from" ? from : to;
    if (!targetDate) return;

    const newDate = new Date(targetDate);
    if (part === "hour") newDate.setHours(parseInt(val, 10));
    if (part === "minute") newDate.setMinutes(parseInt(val, 10));

    const newRange = { from: type === "from" ? newDate : from, to: type === "to" ? newDate : to };

    // Normalize before adapting!
    const normalized = normalizeRange(newRange, true);
    setLocalSelection(normalized);
    onChange(adaptToMode(mode, normalized));
  };

  const formattedLabel = useMemo(() => {
    if (!internalValue) return placeholder;
    if (internalValue instanceof Date) {
      return internalValue.toLocaleDateString();
    }
    const { from, to } = internalValue;
    if (from && !to) return `${from.toLocaleDateString()} - ...`;
    if (from && to) return `${from.toLocaleDateString()} - ${to.toLocaleDateString()}`;
    return placeholder;
  }, [internalValue, placeholder]);

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={"outline"}
            className={cn(
              "w-full justify-start text-left font-normal",
              !internalValue && "text-muted-foreground"
            )}>
            <CalendarIcon className="mr-2 h-4 w-4" />
            {formattedLabel}
            {internalValue && (
              <X
                className="ml-auto h-4 w-4 opacity-50 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(null);
                }}
              />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-4" align="start">
          <Calendar
            mode={selectionMode as any}
            selected={internalValue as any}
            onSelect={handleSelect}
            initialFocus
            disabled={disabled}
          />
          {includeTime && internalValue && (
            <div className="mt-4 space-y-4 border-t pt-4">
              <TimeInputGroup
                label="Start Time"
                date={internalValue instanceof Date ? internalValue : internalValue.from}
                onChange={(p, v) => handleTimeChange("from", p, v)}
              />
              {selectionMode === "range" && (
                <TimeInputGroup
                  label="End Time"
                  date={internalValue instanceof Date ? undefined : internalValue.to}
                  onChange={(p, v) => handleTimeChange("to", p, v)}
                />
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
};

const TimeInputGroup = ({
  label,
  date,
  onChange,
}: {
  label: string;
  date?: Date;
  onChange: (part: "hour" | "minute", val: string) => void;
}) => {
  if (!date) return null;

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
        <Clock className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-1">
        <Select value={String(date.getHours())} onValueChange={(v) => onChange("hour", v)}>
          <SelectTrigger className="h-8 w-[70px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 24 }).map((_, i) => (
              <SelectItem key={i} value={String(i)}>
                {String(i).padStart(2, "0")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm">:</span>
        <Select value={String(date.getMinutes())} onValueChange={(v) => onChange("minute", v)}>
          <SelectTrigger className="h-8 w-[70px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }).map((_, i) => (
              <SelectItem key={i * 5} value={String(i * 5)}>
                {String(i * 5).padStart(2, "0")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
