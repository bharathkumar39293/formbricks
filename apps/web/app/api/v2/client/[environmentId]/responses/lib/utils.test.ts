import { beforeEach, describe, expect, it, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { logger } from "@formbricks/logger";
import { TOrganizationBilling } from "@formbricks/types/organizations";
import { TSurvey } from "@formbricks/types/surveys/types";
import { responses } from "@/app/lib/api/response";
import { symmetricDecrypt } from "@/lib/crypto";
import { getOrganizationIdFromEnvironmentId } from "@/lib/utils/helper";
import { getIsSpamProtectionEnabled } from "@/modules/ee/license-check/lib/utils";
import { checkSurveyValidity } from "./utils";

vi.mock("@formbricks/database", () => ({
  prisma: {
    response: {
      count: vi.fn(),
    },
  },
}));

vi.mock("@/app/lib/api/response", () => ({
  responses: {
    badRequestResponse: vi.fn((msg) => new Response(msg, { status: 400 })),
    notFoundResponse: vi.fn((msg) => new Response(msg, { status: 404 })),
    tooManyRequestsResponse: vi.fn((msg) => new Response(msg, { status: 429 })),
  },
}));

vi.mock("@/lib/constants", () => ({
  ENCRYPTION_KEY: "test-key",
  IS_PRODUCTION: false,
  IS_FORMBRICKS_CLOUD: false,
  WEBAPP_URL: "http://localhost:3000",
}));

vi.mock("@/lib/utils/helper", () => ({
  getOrganizationIdFromEnvironmentId: vi.fn(),
}));

vi.mock("@formbricks/logger", () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock("@/lib/crypto", () => ({
  symmetricDecrypt: vi.fn(),
}));

vi.mock("@/modules/ee/license-check/lib/utils", () => ({
  getIsSpamProtectionEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/app/api/v2/client/[environmentId]/responses/lib/organization", () => ({
  getOrganizationBillingByEnvironmentId: vi.fn().mockResolvedValue({
    plan: "free",
    billing: {},
  }),
}));

const mockSurvey: TSurvey = {
  id: "survey-1",
  environmentId: "env-1",
  type: "link",
  status: "inProgress",
  questions: [],
  blocks: [],
  name: "Test Survey",
  maxSubmissionsPerBrowser: null,
  maxSubmissionsPerIp: null,
  isCaptureIpEnabled: true,
  singleUse: { enabled: false, isEncrypted: false },
  recaptcha: { enabled: false, threshold: 0.5 },
  displayLimit: null,
  endings: [],
  followUps: [],
  isBackButtonHidden: false,
  isSingleResponsePerEmailEnabled: false,
  isVerifyEmailEnabled: false,
  projectOverwrites: null,
  showLanguageSwitch: false,
  metadata: {},
  slug: null,
} as unknown as TSurvey;

const mockResponseInput = {
  surveyId: "survey-1",
  contactId: null,
  displayId: null,
  finished: false,
  data: {},
  meta: {},
  ttc: {},
  singleUseId: null,
  language: "en",
  variables: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  environmentId: "env-1",
};

const mockBillingData: TOrganizationBilling = {
  limits: {
    monthly: { responses: 0 },
    projects: 3,
  },
  usageCycleAnchor: new Date(),
  stripeCustomerId: "mock-stripe-customer-id",
};

describe("checkSurveyValidity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrganizationIdFromEnvironmentId).mockResolvedValue("cm8f4x9mm0001gx9h5b7d7h3q");
  });

  test("should return badRequestResponse if survey environmentId does not match", async () => {
    const survey = { ...mockSurvey, environmentId: "env-2" };
    const result = await checkSurveyValidity(survey as any, "env-1", mockResponseInput as any);
    expect(result).toBeInstanceOf(Response);
    expect(result?.status).toBe(400);
    expect(responses.badRequestResponse).toHaveBeenCalledWith(
      "Survey is part of another environment",
      {
        "survey.environmentId": "env-2",
        environmentId: "env-1",
      },
      true
    );
  });

  test("should return null if recaptcha is not enabled", async () => {
    const survey = { ...mockSurvey, recaptcha: { enabled: false, threshold: 0.5 } };
    const result = await checkSurveyValidity(survey as any, "env-1", mockResponseInput as any);
    expect(result).toBeNull();
  });
});

describe("checkSurveyValidity — submission limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.response.count).mockResolvedValue(0);
  });

  it("returns null when no limits are set", async () => {
    const result = await checkSurveyValidity(mockSurvey, "env-1", mockResponseInput as any);
    expect(result).toBeNull();
  });

  it("returns 429 when maxSubmissionsPerBrowser is exceeded (identified user via contactId)", async () => {
    vi.mocked(prisma.response.count).mockResolvedValue(1);
    const survey = { ...mockSurvey, maxSubmissionsPerBrowser: 1 };
    const input = { ...mockResponseInput, contactId: "contact-abc" };

    const result = await checkSurveyValidity(survey as any, "env-1", input as any);

    expect(result).not.toBeNull();
    expect(responses.tooManyRequestsResponse).toHaveBeenCalledWith(
      "Maximum number of submissions reached for this browser",
      true
    );
  });

  it("returns 429 when maxSubmissionsPerBrowser is exceeded (anonymous user via displayId)", async () => {
    vi.mocked(prisma.response.count).mockResolvedValue(1);
    const survey = { ...mockSurvey, maxSubmissionsPerBrowser: 1 };
    const input = { ...mockResponseInput, displayId: "display-xyz" };

    const result = await checkSurveyValidity(survey as any, "env-1", input as any);

    expect(result).not.toBeNull();
    expect(responses.tooManyRequestsResponse).toHaveBeenCalledWith(
      "Maximum number of submissions reached for this browser",
      true
    );
  });

  it("returns null when count is below maxSubmissionsPerBrowser", async () => {
    vi.mocked(prisma.response.count).mockResolvedValue(0);
    const survey = { ...mockSurvey, maxSubmissionsPerBrowser: 2 };
    const input = { ...mockResponseInput, contactId: "contact-abc" };

    const result = await checkSurveyValidity(survey as any, "env-1", input as any);
    expect(result).toBeNull();
  });

  it("returns 429 when maxSubmissionsPerIp is exceeded", async () => {
    vi.mocked(prisma.response.count).mockResolvedValue(1);
    const survey = { ...mockSurvey, maxSubmissionsPerIp: 1, isCaptureIpEnabled: true };

    const result = await checkSurveyValidity(survey as any, "env-1", mockResponseInput as any, "1.2.3.4");

    expect(result).not.toBeNull();
    expect(responses.tooManyRequestsResponse).toHaveBeenCalledWith(
      "Maximum number of submissions reached for this IP address",
      true
    );
  });

  it("skips IP check when isCaptureIpEnabled is false", async () => {
    vi.mocked(prisma.response.count).mockResolvedValue(999);
    const survey = { ...mockSurvey, maxSubmissionsPerIp: 1, isCaptureIpEnabled: false };

    const result = await checkSurveyValidity(survey as any, "env-1", mockResponseInput as any, "1.2.3.4");
    expect(result).toBeNull();
  });

  it("skips IP check for localhost IPs", async () => {
    vi.mocked(prisma.response.count).mockResolvedValue(999);
    const survey = { ...mockSurvey, maxSubmissionsPerIp: 1, isCaptureIpEnabled: true };

    const result1 = await checkSurveyValidity(survey as any, "env-1", mockResponseInput as any, "127.0.0.1");
    expect(result1).toBeNull();

    const result2 = await checkSurveyValidity(survey as any, "env-1", mockResponseInput as any, "::1");
    expect(result2).toBeNull();
  });
});
