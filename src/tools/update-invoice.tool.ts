import { updateQuickbooksInvoice } from "../handlers/update-quickbooks-invoice.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "update_invoice";
const toolDescription =
  "Update an existing invoice in QuickBooks Online by ID (sparse update). The invoice is read first; patch is shallow-merged over it and sent with sparse: true, Id, and the current SyncToken. " +
  "patch uses QuickBooks field names, so TxnDate, DueDate, ClassRef, Line, and LinkedTxn pass through. " +
  "Line and LinkedTxn each replace the whole array: to add a second estimate for the same customer, send the existing lines plus the new lines, and the existing LinkedTxn plus { TxnId, TxnType: 'Estimate' } for the second estimate. " +
  "Keep CustomerRef as that customer's Id (a sub-customer or job is its own Customer Id). " +
  "Put ClassRef on SalesItemLineDetail for per-line class, or on the invoice for per-transaction class. " +
  "A line may include LinkedTxn with TxnLineId set to the source estimate line Id (Line.Id).";

const toolSchema = z.object({
  invoice_id: z.string().min(1),
  patch: z.record(z.any()),
});

const toolHandler = async ({ params }: any) => {
  const response = await updateQuickbooksInvoice(params);
  if (response.isError) {
    return { content: [{ type: "text" as const, text: `Error updating invoice: ${response.error}` }] };
  }
  return {
    content: [
      { type: "text" as const, text: `Invoice updated successfully:` },
      { type: "text" as const, text: JSON.stringify(response.result, null, 2) },
    ],
  };
};

export const UpdateInvoiceTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
}; 