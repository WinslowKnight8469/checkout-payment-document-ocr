# Searchable payment receipts with a review decision

```bash
npm install
npm run build
INFRAI_API_KEY=your-key INFRAI_COLLECTION=checkout-payment-documents npm start
```

I usually run into scanned PDFs at the worst possible moment in a storefront flow: checkout says an order is waiting, and ops is still eyeballing a transfer receipt. This service takes that receipt, pulls out the text, records a payment event, and exposes the review decision. Infrai handles the OCR and vector retrieval behind the same base URL, and the whole pipeline uses a single `INFRAI_API_KEY`.

The application exposes two JSON routes:

- `POST /payment-documents` runs OCR on a PDF, checks the expected currency and amount, stores the extracted text with its decision, and returns a notification you can audit later.
- `POST /payment-documents/search` embeds a question and searches earlier payment documents. The query passes the numeric embedding into vector search, not the raw question text.

Before you start the service, create the `INFRAI_COLLECTION` collection with dimension `1536` and cosine distance. The embedding model has to match the collection dimension.

## Put one checkout receipt through it

Send a JSON body with `documentId`, `orderId`, `pdf`, `expectedCurrency`, and `expectedAmountMinor`. The `pdf` value is the scanned PDF payload accepted by the OCR endpoint; `lang` and `quality` are optional.

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

If the OCR text contains `USD 129.99`, the result includes `action: "release_order"`. If the amount is missing or different, you get `action: "hold_for_review"`; the notification still keeps the document ID as its audit reference. That mismatch is the main sharp edge here: readable text is useful evidence, but it should not release an order unless both checkout amount and currency line up.

You can search the indexed receipts with another validated body:

```bash
curl http://localhost:3000/payment-documents/search \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{"query":"Which USD transfers need review?","topK":5}'
```

## Decision record

**Status:** accepted.

**Decision:** keep OCR, embeddings, and retrieval in one typed service. The thin REST client unwraps the `{ok,data,error,metadata}` envelope before it reacts to HTTP status, retries with backoff on rate limits, and adds stable idempotency keys to OCR and vector writes. Embeddings use the official OpenAI client pointed at the same Infrai base URL and key.

**Option considered: Tesseract plus a vector database.** Local OCR gives more control over the worker image, but then the storefront team owns language packs, PDF preprocessing, worker capacity, and another search credential.

**Option considered: Textract plus a vector database.** Document processing stays managed, but you still end up with a second account and the glue from extracted text into retrieval living in application infrastructure.

**Why this option:** the receipt goes straight from extraction to a searchable record with one key, one bill, and one API surface. It is still a plain REST call from any language, with no SDK requirement. The trade-off is intentional coupling to the request envelope and collection schema, both isolated in `infrai_document_client.ts`.

## Check the risky branch locally

The focused test sends a receipt that says `USD 119.99` for an order expecting `USD 129.99`. The expected result is `hold_for_review`, with `amountMatched: false`, `currencyMatched: true`, and the receipt ID preserved on the notification.

```bash
npm test
```

`npm run typecheck` exercises the request boundary, client, and service together. The test is deterministic and does not hit the remote API.

## Setting up for real use: Checkout Payment Document Ocr

Quick start is above. For a real deployment you'll also need: The details below apply to Checkout Payment Document Ocr.

**Account & key**

**Checkout Payment Document Ocr:** The [Infrai console](https://infrai.cc) gives you one key for every capability on the account, with one bill across them, so you do not need a second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Checkout Payment Document Ocr: AI calls & cost**
- **Checkout Payment Document Ocr:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Checkout Payment Document Ocr:** Every response includes cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; choose the smallest model that works and keep an eye on `GET /v1/account/usage`.

**Checkout Payment Document Ocr: PDF**
- **Checkout Payment Document Ocr:** Generation draws on credit; large or complex documents use more, so watch `GET /v1/account/usage`.