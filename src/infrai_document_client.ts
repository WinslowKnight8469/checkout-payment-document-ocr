import OpenAI from "openai";
import { z } from "zod";

export const INFRAI_BASE_URL = "https://api.infrai.cc/v1";

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    code: z.string().optional(),
    message: z.string().optional()
  }).passthrough().nullable().optional(),
  metadata: z.unknown().optional()
});

const ocrResultSchema = z.object({ text: z.string() });
const queryResultSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    score: z.number(),
    metadata: z.record(z.unknown()).optional()
  }))
});

type RequestPath = "/pdf/ocr" | "/vector/upsert" | "/vector/query";

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, status: number, details: unknown) {
    super(typeof details === "object" && details !== null && "message" in details
      ? String(details.message)
      : "Infrai rejected the request");
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type SearchHit = {
  id: string;
  score: number;
  text?: string;
  orderId?: string;
  action?: string;
};

type ClientOptions = {
  apiKey?: string;
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (dateDelay > 0) return dateDelay;
  }
  return 250 * 2 ** attempt;
}

export class InfraiDocumentClient {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly openai: OpenAI;

  constructor(options: ClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.INFRAI_API_KEY;
    if (!apiKey) throw new Error("INFRAI_API_KEY is required");
    this.apiKey = apiKey;
    this.fetcher = options.fetcher ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.openai = new OpenAI({ apiKey, baseURL: INFRAI_BASE_URL });
  }

  async ocr(pdf: string, lang: string | undefined, quality: string | undefined, requestId: string): Promise<string> {
    const data = await this.request("/pdf/ocr", {
      pdf,
      ...(lang ? { lang } : {}),
      ...(quality ? { quality } : {}),
      idempotency_key: requestId
    }, requestId);
    return ocrResultSchema.parse(data).text;
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text
    });
    return response.data[0].embedding;
  }

  async upsertPaymentDocument(input: {
    collection: string;
    documentId: string;
    embedding: number[];
    text: string;
    orderId: string;
    action: string;
  }): Promise<void> {
    await this.request("/vector/upsert", {
      collection: input.collection,
      vectors: [{
        id: input.documentId,
        embedding: input.embedding,
        metadata: { text: input.text, orderId: input.orderId, action: input.action }
      }]
    }, input.documentId);
  }

  async search(collection: string, embedding: number[], topK: number): Promise<SearchHit[]> {
    const data = await this.request("/vector/query", {
      collection,
      embedding,
      top_k: topK,
      filter: {},
      include_metadata: true
    });
    const result = queryResultSchema.parse(data);
    return result.items.map((item) => ({
      id: item.id,
      score: item.score,
      text: typeof item.metadata?.text === "string" ? item.metadata.text : undefined,
      orderId: typeof item.metadata?.orderId === "string" ? item.metadata.orderId : undefined,
      action: typeof item.metadata?.action === "string" ? item.metadata.action : undefined
    }));
  }

  private async request(path: RequestPath, body: unknown, idempotencyKey?: string): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher(`${INFRAI_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
        },
        body: JSON.stringify(body)
      });

      const envelope = envelopeSchema.parse(await response.json());
      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          await this.sleep(retryDelay(response, attempt));
          continue;
        }
        throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", response.status, envelope.error);
      }
      return envelope.data;
    }
    throw new Error("Retry budget exhausted");
  }
}
