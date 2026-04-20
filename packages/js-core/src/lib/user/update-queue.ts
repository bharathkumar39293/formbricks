/* eslint-disable @typescript-eslint/no-empty-function -- required for singleton pattern */
import { Config } from "@/lib/common/config";
import { Logger } from "@/lib/common/logger";
import { sendUpdates } from "@/lib/user/update";
import type { TAttributes, TUpdates } from "@/types/config";

export class UpdateQueue {
  private static instance: UpdateQueue | null = null;
  private updates: TUpdates | null = null;
  private debounceTimeout: NodeJS.Timeout | null = null;
  private pendingFlush: Promise<void> | null = null;
  private readonly DEBOUNCE_DELAY = 500;
  private readonly PENDING_WORK_TIMEOUT = 5000;

  private constructor() {}

  public static getInstance(): UpdateQueue {
    UpdateQueue.instance ??= new UpdateQueue();

    return UpdateQueue.instance;
  }

  public updateUserId(userId: string): void {
    if (!this.updates) {
      this.updates = {
        userId,
        attributes: {},
      };
    } else {
      this.updates = {
        ...this.updates,
        userId,
      };
    }
  }

  public updateAttributes(attributes: TAttributes): void {
    const config = Config.getInstance();
    // Get userId from updates first, then fallback to config
    const userId = this.updates?.userId ?? config.get().user.data.userId ?? "";

    if (!this.updates) {
      this.updates = {
        userId,
        attributes,
      };
    } else {
      this.updates = {
        ...this.updates,
        userId,
        attributes: { ...this.updates.attributes, ...attributes },
      };
    }
  }

  public getUpdates(): TUpdates | null {
    return this.updates;
  }

  public clearUpdates(): void {
    this.updates = null;
  }

  public isEmpty(): boolean {
    return !this.updates;
  }

  public hasPendingWork(): boolean {
    return this.updates !== null || this.pendingFlush !== null;
  }

  public async waitForPendingWork(): Promise<boolean> {
    if (!this.hasPendingWork()) return true;

    const flush = this.pendingFlush ?? this.processUpdates();
    try {
      const succeeded = await Promise.race([
        flush.then(() => true as const),
        new Promise<false>((resolve) => {
          setTimeout(() => {
            resolve(false);
          }, this.PENDING_WORK_TIMEOUT);
        }),
      ]);
      return succeeded;
    } catch {
      return false;
    }
  }

  public async processUpdates(): Promise<void> {
    const logger = Logger.getInstance();
    if (!this.updates) {
      return;
    }

    // If a flush is already in flight, reuse it instead of creating a new promise
    if (this.pendingFlush) {
      return this.pendingFlush;
    }

    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }

    const flushPromise = new Promise<void>((resolve, reject) => {
      const handler = async (): Promise<void> => {
        this.debounceTimeout = null;
        try {
          let currentUpdates = { ...this.updates };
          // Capture original attributes BEFORE any in-handler mutation (e.g., language stripping)
          // This ensures the cleanup diff correctly represents what was sent vs what arrived concurrently
          const originalAttributes = { ...(this.updates?.attributes ?? {}) };
          const config = Config.getInstance();

          if (Object.keys(currentUpdates).length > 0) {
            // Get userId from either updates or config
            const effectiveUserId = currentUpdates.userId ?? config.get().user.data.userId;
            const isLanguageInUpdates = currentUpdates.attributes?.language;

            if (!effectiveUserId && isLanguageInUpdates) {
              // no user id set but the updates contain a language
              // we need to set this language in the local config:
              config.update({
                ...config.get(),
                user: {
                  ...config.get().user,
                  data: {
                    ...config.get().user.data,
                    language: currentUpdates.attributes?.language as string | undefined,
                  },
                },
              });

              logger.debug("Updated language successfully");

              const { language: _, ...remainingAttributes } = currentUpdates.attributes ?? {};

              // remove language from attributes
              currentUpdates = {
                ...currentUpdates,
                attributes: remainingAttributes,
              };
            }

            if (Object.keys(currentUpdates.attributes ?? {}).length > 0 && !effectiveUserId) {
              const errorMessage =
                "Formbricks can't set attributes without a userId! Please set a userId first with the setUserId function";
              logger.error(errorMessage);
              this.clearUpdates();
            }

            // Only send updates if we have a userId (either from updates or local storage)
            if (effectiveUserId) {
              const previousUserId = config.get().user.data.userId;
              const isNewUser = currentUpdates.userId && currentUpdates.userId !== previousUserId;
              const hasAttributes = Object.keys(currentUpdates.attributes ?? {}).length > 0;

              const result = await sendUpdates({
                updates: {
                  userId: effectiveUserId,
                  attributes: currentUpdates.attributes ?? {},
                },
              });

              if (result.ok) {
                if (isNewUser) {
                  logger.debug(`User successfully identified: ${effectiveUserId}`);
                }
                // Only log success message if there were no warnings (e.g., skipped attributes)
                if (hasAttributes && !result.data.hasWarnings) {
                  const attributeKeys = Object.keys(currentUpdates.attributes ?? {}).join(", ");
                  logger.debug(`Attributes successfully set: ${attributeKeys}`);
                }
              } else {
                logger.error(
                  `Failed to send updates: ${result.error.responseMessage ?? result.error.message}`
                );
              }
            }
          }

          if (this.updates) {
            const sentUserId = currentUpdates.userId;
            // Use originalAttributes (pre-mutation) so locally-handled attributes
            // (e.g., language applied to config) are correctly treated as "sent"
            const sentAttributes = originalAttributes;

            const remainingAttributes: TAttributes = {};
            for (const [key, value] of Object.entries(this.updates.attributes ?? {})) {
              if (!(key in sentAttributes) || sentAttributes[key] !== value) {
                remainingAttributes[key] = value as string | number | boolean;
              }
            }

            // Preserve updates if attributes changed OR if userId changed during the flush
            const userIdChanged = this.updates.userId != null && this.updates.userId !== sentUserId;

            if (Object.keys(remainingAttributes).length > 0 || userIdChanged) {
              this.updates = {
                userId: this.updates.userId,
                attributes: remainingAttributes,
              };
            } else {
              this.clearUpdates();
            }
          }

          this.pendingFlush = null;

          // Await follow-up flush BEFORE resolving so that callers of await processUpdates()
          // and waitForPendingWork() see a fully drained queue, not an intermediate state
          if (this.updates) {
            await this.processUpdates();
          }

          resolve();
        } catch (error: unknown) {
          this.pendingFlush = null;
          logger.error(
            `Failed to process updates: ${error instanceof Error ? error.message : "Unknown error"}`
          );
          reject(error as Error);
        }
      };

      this.debounceTimeout = setTimeout(() => void handler(), this.DEBOUNCE_DELAY);
    });

    this.pendingFlush = flushPromise;
    return flushPromise;
  }
}
