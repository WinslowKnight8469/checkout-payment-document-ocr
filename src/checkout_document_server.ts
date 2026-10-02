import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { InfraiDocumentClient, InfraiError } from "./infrai_document_client.js";
import { PaymentDocumentService } from "./payment_document_service.js";

const port = Number(process.env.PORT ?? 3000);
const collection = process.env.INFRAI_COLLECTION ?? "checkout-payment-documents";
const service = new PaymentDocumentService(new InfraiDocumentClient(), collection);

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/payment-documents") {
      send(response, 201, await service.ingest(await readJson(request)));
      return;
    }
    if (request.method === "POST" && request.url === "/payment-documents/search") {
      send(response, 200, await service.search(await readJson(request)));
      return;
    }
    send(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      send(response, 400, { error: "Invalid request body" });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { error: error.code, message: error.message });
      return;
    }
    console.error(error);
    send(response, 502, { error: "Document processing failed" });
  }
}).listen(port, () => {
  console.log(`Checkout document service listening on http://localhost:${port}`);
});
