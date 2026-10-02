import { z } from "zod";
import { InfraiDocumentClient } from "./infrai_document_client.js";
import { decidePaymentAction, paymentDocumentRequest } from "./payment_decision.js";

export const paymentSearchRequest = z.object({
  query: z.string().min(2),
  topK: z.number().int().min(1).max(20).default(5)
});

export class PaymentDocumentService {
  private readonly client: InfraiDocumentClient;
  private readonly collection: string;

  constructor(client: InfraiDocumentClient, collection: string) {
    this.client = client;
    this.collection = collection;
  }

  async ingest(body: unknown) {
    const request = paymentDocumentRequest.parse(body);
    const text = await this.client.ocr(request.pdf, request.lang, request.quality, `ocr-${request.documentId}`);
    const decision = decidePaymentAction(request, text);
    const embedding = await this.client.embed(text);
    await this.client.upsertPaymentDocument({
      collection: this.collection,
      documentId: request.documentId,
      embedding,
      text,
      orderId: request.orderId,
      action: decision.action
    });
    return { documentId: request.documentId, searchableText: text, decision };
  }

  async search(body: unknown) {
    const request = paymentSearchRequest.parse(body);
    const embedding = await this.client.embed(request.query);
    return {
      query: request.query,
      hits: await this.client.search(this.collection, embedding, request.topK)
    };
  }
}
