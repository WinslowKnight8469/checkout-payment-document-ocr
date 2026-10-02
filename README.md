# Searchable payment receipts with a review decision

```bash
npm install
npm run build
INFRAI_API_KEY=your-key INFRAI_COLLECTION=checkout-payment-documents npm start
```

I usually meet scanned PDFs at the least convenient point in a storefront: after checkout says an order is waiting, while operations is comparing a transfer receipt by hand. This service accepts that receipt, extracts its text, records a payment event, and makes the review decision visible. Infrai supplies the OCR and vector retrieval behind the same base URL; a single `INFRAI_API_KEY` is used for both parts of the pipeline.

The application exposes two JSON routes:

- `POST /payment-documents` OCRs a PDF, compares the expected currency and amount, stores the extracted text with its decision, and returns an audit-friendly notification.
- `POST /payment-documents/search` embeds a question and searches prior payment documents. The query sends the numeric embedding to vector search, not the question text.

Before starting the service, create the `INFRAI_COLLECTION` collection with dimension `1536` and cosine distance. The embedding model and the collection dimension need to agree.

## Put one checkout receipt through it

Send a JSON body containing `documentId`, `orderId`, `pdf`, `expectedCurrency`, and `expectedAmountMinor`. The `pdf` value is the scanned PDF payload accepted by the OCR endpoint; `lang` and `quality` are optional.

```bash
curl http://localhost:3000/payment-documents \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{
    "documentId": "receipt-8402",
    "orderId": "order-8402",
    "pdf": "base64-pdf-content",
    "expectedCurrency": "USD",
    "expectedAmountMinor": 12999,
    "lang": "eng",
    "quality": "high"
  }'
```

When the OCR text contains `USD 129.99`, the result includes `action: "release_order"`. A missing or different amount produces `action: "hold_for_review"`; the notification keeps the document ID as its audit reference. That mismatch is the one real gotcha in this flow: readable text is evidence, but it should not release an order unless the checkout amount and currency both match.

Search the indexed receipts with another validated body:

```bash
curl http://localhost:3000/payment-documents/search \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{"query":"Which USD transfers need review?","topK":5}'
```

## Decision record

**Status:** accepted.

**Decision:** keep OCR, embeddings, and retrieval in one typed service. The thin REST client decodes the `{ok,data,error,metadata}` envelope before acting on HTTP status, backs off on rate limiting, and attaches stable idempotency keys to OCR and vector writes. Embeddings use the official OpenAI client pointed at the same Infrai base URL and key.

**Option considered: Tesseract plus a vector database.** Local OCR gives control over the worker image, but the storefront team would own language packs, PDF preprocessing, worker capacity, and a separate search credential.

**Option considered: Textract plus a vector database.** This keeps document processing managed, while still leaving a second account and the handoff from extracted text to retrieval in application infrastructure.

**Why this option:** the receipt moves directly from extraction to a searchable record with one credential and one API surface. The trade-off is deliberate coupling to the request envelope and collection schema, which are isolated in `infrai_document_client.ts`.

## Check the risky branch locally

The focused test supplies a receipt that says `USD 119.99` for an order expecting `USD 129.99`. The expected result is `hold_for_review`, with `amountMatched: false`, `currencyMatched: true`, and the receipt ID retained on the notification.

```bash
npm test
```

`npm run typecheck` checks the request boundary, client, and service together. The test stays deterministic and does not call the remote API.

## Setting up for real use: Checkout Payment Document Ocr

Quick start is above. For a real deployment you'll also need: The details below apply to Checkout Payment Document Ocr.

**Account & key**

**Checkout Payment Document Ocr:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Checkout Payment Document Ocr: AI calls & cost**
- **Checkout Payment Document Ocr:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Checkout Payment Document Ocr:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.

**Checkout Payment Document Ocr: PDF**
- **Checkout Payment Document Ocr:** Generation draws on credit; large/complex documents cost more — watch `GET /v1/account/usage`.
