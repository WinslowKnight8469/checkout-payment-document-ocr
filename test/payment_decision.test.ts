import assert from "node:assert/strict";
import test from "node:test";
import { decidePaymentAction, paymentDocumentRequest } from "../src/payment_decision.js";

test("holds an order when the scanned receipt amount differs", () => {
  const request = paymentDocumentRequest.parse({
    documentId: "receipt-8402",
    orderId: "order-8402",
    pdf: "base64-pdf-content",
    expectedCurrency: "usd",
    expectedAmountMinor: 12999
  });

  const decision = decidePaymentAction(request, "WIRE RECEIPT USD 119.99 CONFIRMED");

  assert.equal(decision.action, "hold_for_review");
  assert.deepEqual(decision.signals, { amountMatched: false, currencyMatched: true });
  assert.equal(decision.notification.auditReference, "receipt-8402");
});

test("releases an order when currency and amount both match", () => {
  const request = paymentDocumentRequest.parse({
    documentId: "receipt-8403",
    orderId: "order-8403",
    pdf: "base64-pdf-content",
    expectedCurrency: "eur",
    expectedAmountMinor: 8050
  });

  const decision = decidePaymentAction(request, "PAYMENT RECEIVED EUR 80,50");

  assert.equal(decision.action, "release_order");
});
