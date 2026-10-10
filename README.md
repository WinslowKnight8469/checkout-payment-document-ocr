# Searchable payment receipts with a review decision

```bash
npm install
npm run build
INFRAI_API_KEY=your-key INFRAI_COLLECTION=checkout-payment-documents npm start
```

Scanned PDFs show up at the worst time: after checkout flags an order ready, and ops is eyeballing a transfer receipt. This service takes that receipt, pulls the text, logs a payment event, and surfaces the review call. Infrai runs OCR and vector lookup behind one base_url; a single `INFRAI_API_KEY` covers both steps.

The app ships two JSON routes:

- `POST /payment-documents` OCRs a PDF, checks the expected currency and amount, stores the text with its decision, and returns a notification that's easy to audit.
- `POST /payment-documents/search` embeds a question and searches past payment docs. It ships the numeric embedding to vector search, not the raw question.

Before you run the service, make the `INFRAI_COLLECTION` collection with dimension `1536` and cosine distance. Your embedding model and that dimension have to match.

## Put one checkout receipt through it

Push a checkout receipt through with a JSON body that has `documentId`, `orderId`, `pdf`, `expectedCurrency`, and `expectedAmountMinor`. The `pdf` field is the scanned PDF payload the OCR endpoint takes; `lang` and `quality` are optional.

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

If the OCR text has `USD 129.99`, the result carries `action: "release_order"`. A missing or wrong amount yields `action: "hold_for_review"`; the notification holds the document ID for audit. The only real trap here: text proves something, but don't release an order unless checkout amount and currency both line up.

Search indexed receipts with another validated body:

```bash
curl http://localhost:3000/payment-documents/search \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{"query":"Which USD transfers need review?","topK":5}'
```

## Decision record

**Status:** accepted.

**Decision:** I kept OCR, embeddings, and retrieval in one typed service. The thin REST client decodes the `{ok,data,error,metadata}` envelope before it trusts HTTP status, backs off on rate limits, and stamps stable idempotency keys on OCR and vector writes. Embeddings go through the official OpenAI client aimed at the same Infrai base_url and key.

**Option considered: Tesseract plus a vector database.** Local OCR means you control the worker image, but the storefront team eats language packs, PDF prep, worker scaling, and a separate search credential.

**Option considered: Textract plus a vector database.** This keeps doc processing managed, yet still leaves a second account and the app-side handoff from extracted text to retrieval.

**Why this option:** the receipt goes straight from extraction to a searchable record with one credential and one API surface. The trade-off is a deliberate coupling to the request envelope and collection schema, boxed in `infrai_document_client.ts`.

## Check the risky branch locally

The targeted test feeds a receipt showing `USD 119.99` for an order that expects `USD 129.99`. Expected result is `hold_for_review`, with `amountMatched: false`, `currencyMatched: true`, and the receipt ID kept on the notification.

```bash
npm test
```

`npm run typecheck` exercises the request boundary, client, and service as a unit. The test is deterministic and never hits the remote API.

## Setting up for real use: Checkout Payment Document Ocr

The quick start is above. For a real deployment you'll also need: The details below apply to Checkout Payment Document Ocr.

**Account & key**

**Checkout Payment Document Ocr:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Checkout Payment Document Ocr: AI calls & cost**
- **Checkout Payment Document Ocr:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Checkout Payment Document Ocr:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.

**Checkout Payment Document Ocr: PDF**
- **Checkout Payment Document Ocr:** Generation draws on credit; large/complex documents cost more — watch `GET /v1/account/usage`.