import { Meta, StoryObj } from "@storybook/react";
import { UnifiedDatePicker } from "./index";

const meta: Meta<typeof UnifiedDatePicker> = {
  title: "UI/DatePicker",
  component: UnifiedDatePicker,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  argTypes: {
    mode: {
      control: "select",
      options: ["analysis", "contact-iso", "segment-range", "survey-legacy"],
      description: "Defining the persistence contract and UI behavior",
    },
    includeTime: {
      control: "boolean",
      description: "Enable high-precision time selection",
    },
    onChange: { action: "changed" },
  },
};

export default meta;
type Story = StoryObj<typeof UnifiedDatePicker>;

export const AnalysisMode: Story = {
  args: {
    mode: "analysis",
    includeTime: true,
    placeholder: "Pick a date range with time",
    value: {
      from: new Date(),
      to: new Date(new Date().getTime() + 24 * 60 * 60 * 1000),
    },
  },
};

export const ContactMode: Story = {
  args: {
    mode: "contact-iso",
    placeholder: "Select birth date (ISO Format)",
    value: "2024-04-26T00:00:00.000Z",
  },
};

export const SegmentMode: Story = {
  args: {
    mode: "segment-range",
    placeholder: "Filter by range (JSON Array)",
    value: ["2024-04-26T00:00:00.000Z", "2024-04-28T23:59:59.999Z"],
  },
};

export const SurveyLegacyMode: Story = {
  args: {
    mode: "survey-legacy",
    placeholder: "Validation rule (Comma Separated)",
    value: "2024-04-26,2024-04-28",
  },
};
