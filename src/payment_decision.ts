import { z } from "zod";

export const paymentDocumentRequest = z.object({
  documentId: z.string().min(1),
  orderId: z.string().min(1),
  pdf: z.string().min(1),
  expectedCurrency: z.string().length(3).transform((value) => value.toUpperCase()),
  expectedAmountMinor: z.number().int().nonnegative(),
  lang: z.string().min(2).optional(),
  quality: z.string().min(1).optional()
});

export type PaymentDocumentRequest = z.infer<typeof paymentDocumentRequest>;

export type PaymentDecision = {
  paymentEvent: "payment_document_received";
  action: "release_order" | "hold_for_review";
  notification: {
    audience: "checkout_operations";
    summary: string;
    auditReference: string;
  };
  signals: {
    amountMatched: boolean;
    currencyMatched: boolean;
  };
};

function amountCandidates(amountMinor: number): string[] {
  const major = (amountMinor / 100).toFixed(2);
  return [major, major.replace(".", ","), amountMinor.toString()];
}

export function decidePaymentAction(
  request: Pick<PaymentDocumentRequest, "documentId" | "orderId" | "expectedCurrency" | "expectedAmountMinor">,
  extractedText: string
): PaymentDecision {
  const normalized = extractedText.toUpperCase();
  const currencyMatched = normalized.includes(request.expectedCurrency.toUpperCase());
  const amountMatched = amountCandidates(request.expectedAmountMinor).some((value) => normalized.includes(value));
  const action = amountMatched && currencyMatched ? "release_order" : "hold_for_review";

  return {
    paymentEvent: "payment_document_received",
    action,
    notification: {
      audience: "checkout_operations",
      summary: action === "release_order"
        ? `Payment evidence matched order ${request.orderId}`
        : `Payment evidence needs review for order ${request.orderId}`,
      auditReference: request.documentId
    },
    signals: { amountMatched, currencyMatched }
  };
}
