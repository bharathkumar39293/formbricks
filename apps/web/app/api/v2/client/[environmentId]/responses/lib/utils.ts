import { prisma } from "@formbricks/database";
import { logger } from "@formbricks/logger";
import { TSurvey } from "@formbricks/types/surveys/types";
import { getOrganizationBillingByEnvironmentId } from "@/app/api/v2/client/[environmentId]/responses/lib/organization";
import { verifyRecaptchaToken } from "@/app/api/v2/client/[environmentId]/responses/lib/recaptcha";
import { TResponseInputV2 } from "@/app/api/v2/client/[environmentId]/responses/types/response";
import { responses } from "@/app/lib/api/response";
import { ENCRYPTION_KEY } from "@/lib/constants";
import { symmetricDecrypt } from "@/lib/crypto";
import { getIsSpamProtectionEnabled } from "@/modules/ee/license-check/lib/utils";

export const RECAPTCHA_VERIFICATION_ERROR_CODE = "recaptcha_verification_failed";

export const checkSurveyValidity = async (
  survey: TSurvey,
  environmentId: string,
  responseInput: TResponseInputV2,
  ipAddress?: string
): Promise<Response | null> => {
  if (survey.environmentId !== environmentId) {
    return responses.badRequestResponse(
      "Survey is part of another environment",
      {
        "survey.environmentId": survey.environmentId,
        environmentId,
      },
      true
    );
  }

  if (survey.type === "link" && survey.singleUse?.enabled) {
    if (!responseInput.singleUseId) {
      return responses.badRequestResponse("Missing single use id", {
        surveyId: survey.id,
        environmentId,
      });
    }

    if (!responseInput.meta?.url) {
      return responses.badRequestResponse("Missing or invalid URL in response metadata", {
        surveyId: survey.id,
        environmentId,
      });
    }

    let url;
    try {
      url = new URL(responseInput.meta.url);
    } catch (error: any) {
      return responses.badRequestResponse("Invalid URL in response metadata", {
        surveyId: survey.id,
        environmentId,
        error: error.message,
      });
    }
    const suId = url.searchParams.get("suId");
    if (!suId) {
      return responses.badRequestResponse("Missing single use id", {
        surveyId: survey.id,
        environmentId,
      });
    }

    if (survey.singleUse.isEncrypted) {
      const decryptedSuId = symmetricDecrypt(suId, ENCRYPTION_KEY);
      if (decryptedSuId !== responseInput.singleUseId) {
        return responses.badRequestResponse("Invalid single use id", {
          surveyId: survey.id,
          environmentId,
        });
      }
    } else if (responseInput.singleUseId !== suId) {
      return responses.badRequestResponse("Invalid single use id", {
        surveyId: survey.id,
        environmentId,
      });
    }
  }

  // Per-browser submission limit (best-effort: not transactionally safe under high concurrency).
  // Two simultaneous requests may both read count=0 and both pass, so the actual count may
  // slightly exceed the limit. Acceptable for anti-abuse purposes.
  // Strict enforcement would require a transactional check-and-insert or a Redis counter.
  //
  // Note: anonymous users with neither contactId nor displayId bypass this check entirely.
  // The IP-based limit below is the primary protection for fully-anonymous submissions.
  if (survey.maxSubmissionsPerBrowser && (responseInput.contactId || responseInput.displayId)) {
    const browserCount = await prisma.response.count({
      where: {
        surveyId: survey.id,
        OR: [
          ...(responseInput.contactId ? [{ contactId: responseInput.contactId }] : []),
          // displayId is session-scoped: limits reset if the user refreshes the page.
          // It provides best-effort protection within a single browsing session for anonymous users.
          ...(responseInput.displayId ? [{ displayId: responseInput.displayId }] : []),
        ],
      },
    });

    if (browserCount >= survey.maxSubmissionsPerBrowser) {
      return responses.tooManyRequestsResponse(
        "Maximum number of submissions reached for this browser",
        true
      );
    }
  }

  // Per-IP submission limit — also best-effort (same race condition caveat applies).
  // Only enforced when isCaptureIpEnabled is true to avoid unintended privacy concerns.
  // Note: shared NAT/proxies may affect multiple legitimate users sharing an IP.
  // Performance: at scale, an index on (surveyId, meta->ipAddress) would be needed here.
  // Skip localhost IPs (::1, 127.0.0.1) that indicate missing forwarding headers.
  if (
    survey.maxSubmissionsPerIp &&
    survey.isCaptureIpEnabled &&
    ipAddress &&
    ipAddress !== "::1" &&
    ipAddress !== "127.0.0.1"
  ) {
    const ipCount = await prisma.response.count({
      where: {
        surveyId: survey.id,
        meta: {
          path: ["ipAddress"],
          equals: ipAddress,
        },
      },
    });

    if (ipCount >= survey.maxSubmissionsPerIp) {
      return responses.tooManyRequestsResponse(
        "Maximum number of submissions reached for this IP address",
        true
      );
    }
  }

  if (survey.recaptcha?.enabled) {
    if (!responseInput.recaptchaToken) {
      logger.error("Missing recaptcha token");
      return responses.badRequestResponse(
        "Missing recaptcha token",
        {
          code: RECAPTCHA_VERIFICATION_ERROR_CODE,
        },
        true
      );
    }
    const billing = await getOrganizationBillingByEnvironmentId(environmentId);

    if (!billing) {
      return responses.notFoundResponse("Organization", null);
    }

    const isSpamProtectionEnabled = await getIsSpamProtectionEnabled(billing.stripe?.plan || "free");

    if (!isSpamProtectionEnabled) {
      logger.error("Spam protection is not enabled for this organization");
    }

    const isPassed = await verifyRecaptchaToken(responseInput.recaptchaToken, survey.recaptcha.threshold);
    if (!isPassed) {
      return responses.badRequestResponse(
        "reCAPTCHA verification failed",
        {
          code: RECAPTCHA_VERIFICATION_ERROR_CODE,
        },
        true
      );
    }
  }

  return null;
};
