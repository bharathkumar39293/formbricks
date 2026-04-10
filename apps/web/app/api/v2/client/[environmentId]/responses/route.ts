import { UAParser } from "ua-parser-js";
import { createCacheKey } from "@formbricks/cache";
import { ZEnvironmentId } from "@formbricks/types/environment";
import { InvalidInputError } from "@formbricks/types/errors";
import { TResponseWithQuotaFull } from "@formbricks/types/quota";
import { checkSurveyValidity } from "@/app/api/v2/client/[environmentId]/responses/lib/utils";
import { reportApiError } from "@/app/lib/api/api-error-reporter";
import { parseAndValidateJsonBody } from "@/app/lib/api/parse-and-validate-json-body";
import { responses } from "@/app/lib/api/response";
import { transformErrorToDetails } from "@/app/lib/api/validator";
import { sendToPipeline } from "@/app/lib/pipelines";
import { cache } from "@/lib/cache";
import { getSurvey } from "@/lib/survey/service";
import { getElementsFromBlocks } from "@/lib/survey/utils";
import { getClientIpFromHeaders } from "@/lib/utils/client-ip";
import { getOrganizationIdFromEnvironmentId } from "@/lib/utils/helper";
import { formatValidationErrorsForV1Api, validateResponseData } from "@/modules/api/lib/validation";
import { validateOtherOptionLengthForMultipleChoice } from "@/modules/api/v2/lib/element";
import { getIsContactsEnabled } from "@/modules/ee/license-check/lib/utils";
import { createQuotaFullObject } from "@/modules/ee/quotas/lib/helpers";
import { createResponseWithQuotaEvaluation } from "./lib/response";
import { TResponseInputV2, ZResponseInputV2 } from "./types/response";

interface Context {
  params: Promise<{
    environmentId: string;
  }>;
}

type TResponseSurvey = NonNullable<Awaited<ReturnType<typeof getSurvey>>>;

type TValidatedResponseInputResult =
  | {
      environmentId: string;
      responseInputData: TResponseInputV2;
    }
  | { response: Response };

const getCountry = (requestHeaders: Headers): string | undefined =>
  requestHeaders.get("CF-IPCountry") ||
  requestHeaders.get("X-Vercel-IP-Country") ||
  requestHeaders.get("CloudFront-Viewer-Country") ||
  undefined;

const getUnexpectedPublicErrorResponse = (): Response =>
  responses.internalServerErrorResponse("Something went wrong. Please try again.", true);

const parseAndValidateResponseInput = async (
  request: Request,
  environmentId: string
): Promise<TValidatedResponseInputResult> => {
  const environmentIdValidation = ZEnvironmentId.safeParse(environmentId);

  if (!environmentIdValidation.success) {
    return {
      response: responses.badRequestResponse(
        "Fields are missing or incorrectly formatted",
        transformErrorToDetails(environmentIdValidation.error),
        true
      ),
    };
  }

  const responseInputValidation = await parseAndValidateJsonBody({
    request,
    schema: ZResponseInputV2,
    buildInput: (jsonInput) => ({
      ...(jsonInput !== null && typeof jsonInput === "object" ? jsonInput : {}),
      environmentId,
    }),
    malformedJsonMessage: "Invalid JSON in request body",
  });

  if ("response" in responseInputValidation) {
    return responseInputValidation;
  }

  return {
    environmentId,
    responseInputData: responseInputValidation.data,
  };
};

const getContactsDisabledResponse = async (
  environmentId: string,
  contactId: string | null | undefined
): Promise<Response | null> => {
  if (!contactId) {
    return null;
  }

  const organizationId = await getOrganizationIdFromEnvironmentId(environmentId);
  const isContactsEnabled = await getIsContactsEnabled(organizationId);

  return isContactsEnabled
    ? null
    : responses.forbiddenResponse("User identification is only available for enterprise users.", true);
};

const validateResponseSubmission = async (
  environmentId: string,
  responseInputData: TResponseInputV2,
  survey: TResponseSurvey
): Promise<Response | null> => {
  const surveyCheckResult = await checkSurveyValidity(survey, environmentId, responseInputData);
  if (surveyCheckResult) {
    return surveyCheckResult;
  }

  const otherResponseInvalidQuestionId = validateOtherOptionLengthForMultipleChoice({
    responseData: responseInputData.data,
    surveyQuestions: getElementsFromBlocks(survey.blocks),
    responseLanguage: responseInputData.language,
  });

  if (otherResponseInvalidQuestionId) {
    return responses.badRequestResponse(
      `Response exceeds character limit`,
      {
        questionId: otherResponseInvalidQuestionId,
      },
      true
    );
  }

  const validationErrors = validateResponseData(
    survey.blocks,
    responseInputData.data,
    responseInputData.language ?? "en",
    survey.questions
  );

  return validationErrors
    ? responses.badRequestResponse(
        "Validation failed",
        formatValidationErrorsForV1Api(validationErrors),
        true
      )
    : null;
};

const createResponseForRequest = async ({
  request,
  survey,
  responseInputData,
  country,
}: {
  request: Request;
  survey: TResponseSurvey;
  responseInputData: TResponseInputV2;
  country: string | undefined;
}): Promise<TResponseWithQuotaFull | Response> => {
  const userAgent = request.headers.get("user-agent") || undefined;
  const agent = new UAParser(userAgent);

  try {
    const meta: TResponseInputV2["meta"] = {
      source: responseInputData?.meta?.source,
      url: responseInputData?.meta?.url,
      userAgent: {
        browser: agent.getBrowser().name,
        device: agent.getDevice().type || "desktop",
        os: agent.getOS().name,
      },
      country,
      action: responseInputData?.meta?.action,
      idempotencyKey: responseInputData?.meta?.idempotencyKey,
    };

    if (survey.isCaptureIpEnabled) {
      meta.ipAddress = await getClientIpFromHeaders();
    }

    return await createResponseWithQuotaEvaluation({
      ...responseInputData,
      meta,
    });
  } catch (error) {
    if (error instanceof InvalidInputError) {
      return responses.badRequestResponse(error.message, undefined, true);
    }

    const response = getUnexpectedPublicErrorResponse();
    reportApiError({
      request,
      status: response.status,
      error,
    });
    return response;
  }
};

export const OPTIONS = async (): Promise<Response> => {
  return responses.successResponse(
    {},
    true,
    // Cache CORS preflight responses for 1 hour (conservative approach)
    // Balances performance gains with flexibility for CORS policy changes
    "public, s-maxage=3600, max-age=3600"
  );
};

export const POST = async (request: Request, context: Context): Promise<Response> => {
  const params = await context.params;
  const validatedInput = await parseAndValidateResponseInput(request, params.environmentId);

  if ("response" in validatedInput) {
    return validatedInput.response;
  }

  const { environmentId, responseInputData } = validatedInput;

  const idempotencyKey = responseInputData.meta?.idempotencyKey;

  // Idempotency guard: use tryLock to atomically reserve the key before the DB write.
  // This eliminates the TOCTOU race where two overlapping retries can both miss
  // the cache check and each create a duplicate response.
  //
  // Flow:
  //   1. tryLock acquired  → this request is the "owner"; proceed to create.
  //   2. Cache hit (data)  → a previous owner already committed; return cached result.
  //   3. Lock miss + no data → another owner is still in flight; fall through and
  //      create (best-effort; acceptable for the rare in-flight collision window).
  //   4. Redis unavailable → graceful degradation; idempotency skipped silently.
  //
  // Self-hosted instances without Redis receive no idempotency protection;
  // this is consistent with other cache-dependent features in Formbricks.
  if (idempotencyKey) {
    const cacheKey = createCacheKey.response.idempotency(responseInputData.surveyId, idempotencyKey);

    // Check for an already-committed result first (fast path on retries after TTL is set).
    const existingResult = await cache.get<{ id: string; quotaFull?: boolean; quota?: object }>(cacheKey);
    if (existingResult.ok && existingResult.data) {
      return responses.successResponse(existingResult.data, true);
    }

    // Atomically reserve the key for 60 s (enough time for the DB write + pipeline).
    // If the lock is already held by another request, fall through to normal creation
    // (best-effort; the second writer will overwrite with the same logical result).
    await cache.tryLock(cacheKey, "1", 60_000);
  }

  const country = getCountry(request.headers);

  try {
    const contactsDisabledResponse = await getContactsDisabledResponse(
      environmentId,
      responseInputData.contactId
    );
    if (contactsDisabledResponse) {
      return contactsDisabledResponse;
    }

    const survey = await getSurvey(responseInputData.surveyId);
    if (!survey) {
      return responses.notFoundResponse("Survey", responseInputData.surveyId, true);
    }

    const validationResponse = await validateResponseSubmission(environmentId, responseInputData, survey);
    if (validationResponse) {
      return validationResponse;
    }

    const createdResponse = await createResponseForRequest({
      request,
      survey,
      responseInputData,
      country,
    });
    if (createdResponse instanceof Response) {
      return createdResponse;
    }
    const { quotaFull, ...responseData } = createdResponse;

    const quotaObj = createQuotaFullObject(quotaFull);
    const responseDataWithQuota = {
      id: responseData.id,
      ...quotaObj,
    };

    if (idempotencyKey) {
      // Cache the full quota-aware payload so retries receive the same quotaFull
      // state as the original commit — avoids the client skipping the quota flow
      // when the first request timed out on a quota-full response.
      // TTL: 24 hours (86_400_000 ms).
      const cacheKey = createCacheKey.response.idempotency(responseData.surveyId, idempotencyKey);
      await cache.set(cacheKey, responseDataWithQuota, 86_400_000);
    }

    sendToPipeline({
      event: "responseCreated",
      environmentId,
      surveyId: responseData.surveyId,
      response: responseData,
    });

    if (responseData.finished) {
      sendToPipeline({
        event: "responseFinished",
        environmentId,
        surveyId: responseData.surveyId,
        response: responseData,
      });
    }

    return responses.successResponse(responseDataWithQuota, true);
  } catch (error) {
    const response = getUnexpectedPublicErrorResponse();
    reportApiError({
      request,
      status: response.status,
      error,
    });
    return response;
  }
};
