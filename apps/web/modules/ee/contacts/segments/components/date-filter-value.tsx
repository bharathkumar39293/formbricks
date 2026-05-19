"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TDateOperator, TSegmentFilterValue, TTimeUnit } from "@formbricks/types/segment";
import { cn } from "@/lib/cn";
import { DatePicker } from "@/modules/ui/components/date-picker";
import { Input } from "@/modules/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/ui/components/select";

interface DateFilterValueProps {
  operator: TDateOperator;
  value: TSegmentFilterValue;
  onChange: (value: TSegmentFilterValue) => void;
  viewOnly?: boolean;
}

export function DateFilterValue({ operator, value, onChange, viewOnly }: DateFilterValueProps) {
  const { t } = useTranslation();
  const [error, setError] = useState("");

  // Relative time operators: isOlderThan, isNewerThan
  if (operator === "isOlderThan" || operator === "isNewerThan") {
    const relativeValue =
      typeof value === "object" && "amount" in value && "unit" in value
        ? value
        : { amount: 1, unit: "days" as TTimeUnit };

    return (
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          className={cn("h-9 w-20 bg-white", error && "border border-red-500 focus:border-red-500")}
          disabled={viewOnly}
          value={relativeValue.amount}
          onChange={(e) => {
            const amount = Number.parseInt(e.target.value, 10);
            if (Number.isNaN(amount) || amount < 1) {
              setError(t("workspace.segments.value_must_be_positive"));
              return;
            }
            setError("");
            onChange({ amount, unit: relativeValue.unit });
          }}
        />
        <Select
          disabled={viewOnly}
          value={relativeValue.unit}
          onValueChange={(unit: TTimeUnit) => {
            onChange({ amount: relativeValue.amount, unit });
          }}>
          <SelectTrigger className="flex w-auto items-center justify-center bg-white" hideArrow>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="days">{t("common.days")}</SelectItem>
            <SelectItem value="weeks">{t("common.weeks")}</SelectItem>
            <SelectItem value="months">{t("common.months")}</SelectItem>
            <SelectItem value="years">{t("common.years")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }

  // Between operator: needs two date inputs -> unified to range
  if (operator === "isBetween") {
    const betweenValue = Array.isArray(value) && value.length === 2 ? value : ["", ""];

    return (
      <DatePicker
        mode="segment-range"
        value={betweenValue as [string, string]}
        onChange={(val) => onChange(val)}
        disabled={viewOnly}
      />
    );
  }

  // Absolute date operators: isBefore, isAfter, isSameDay
  // Use a single date picker
  const dateValue = typeof value === "string" ? value : "";

  return (
    <DatePicker mode="contact-iso" value={dateValue} onChange={(val) => onChange(val)} disabled={viewOnly} />
  );
}
