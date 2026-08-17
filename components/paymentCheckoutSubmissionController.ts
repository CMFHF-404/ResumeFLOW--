export type PaymentCheckoutSubmission = Readonly<{
  generation: number;
  orderId: string;
}>;

export type PaymentCheckoutSubmissionController = {
  beginSubmission(orderId: string): PaymentCheckoutSubmission;
  markPageHidden(): void;
  shouldRecoverFromWatchdog(submission: PaymentCheckoutSubmission): boolean;
  consumePersistedPageShow(): string | null;
  invalidate(): void;
};

class DefaultPaymentCheckoutSubmissionController
implements PaymentCheckoutSubmissionController {
  private generation = 0;
  private activeSubmission: PaymentCheckoutSubmission | null = null;
  private pageHidden = false;

  beginSubmission(orderId: string): PaymentCheckoutSubmission {
    this.generation += 1;
    const submission = {
      generation: this.generation,
      orderId,
    };
    this.activeSubmission = submission;
    this.pageHidden = false;
    return submission;
  }

  markPageHidden(): void {
    if (this.activeSubmission) this.pageHidden = true;
  }

  shouldRecoverFromWatchdog(submission: PaymentCheckoutSubmission): boolean {
    return Boolean(
      this.activeSubmission
      && this.activeSubmission.generation === submission.generation
      && !this.pageHidden
    );
  }

  consumePersistedPageShow(): string | null {
    const orderId = this.activeSubmission?.orderId ?? null;
    this.generation += 1;
    this.activeSubmission = null;
    this.pageHidden = false;
    return orderId;
  }

  invalidate(): void {
    this.generation += 1;
    this.activeSubmission = null;
    this.pageHidden = false;
  }
}

export const createPaymentCheckoutSubmissionController = ():
PaymentCheckoutSubmissionController => (
  new DefaultPaymentCheckoutSubmissionController()
);
